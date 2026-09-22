import { initializeApp, type FirebaseApp } from 'firebase/app';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, type Firestore } from 'firebase/firestore';
import {
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  getIdTokenResult,
  type Auth,
  type User,
} from 'firebase/auth';
import {
  initializeAppCheck,
  ReCaptchaV3Provider,
  type AppCheck,
} from 'firebase/app-check';

/**
 * Configuración de Firebase Firestore y Auth.
 * Soporta variables con prefijo VITE_ o FIREBASE_.
 */
const firebaseConfig = {
  apiKey: (import.meta.env.VITE_FIREBASE_API_KEY || import.meta.env.FIREBASE_API_KEY || '') as string,
  authDomain: (import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || import.meta.env.FIREBASE_AUTH_DOMAIN || '') as string,
  projectId: (import.meta.env.VITE_FIREBASE_PROJECT_ID || import.meta.env.FIREBASE_PROJECT_ID || '') as string,
  storageBucket: (import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || import.meta.env.FIREBASE_STORAGE_BUCKET || '') as string,
  messagingSenderId: (import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || import.meta.env.FIREBASE_MESSAGING_SENDER_ID || '') as string,
  appId: (import.meta.env.VITE_FIREBASE_APP_ID || import.meta.env.FIREBASE_APP_ID || '') as string,
  measurementId: (import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || import.meta.env.FIREBASE_MEASUREMENT_ID || '') as string,
};

let app: FirebaseApp | null = null;
let db: Firestore | null = null;
let auth: Auth | null = null;
let appCheck: AppCheck | null = null;
let isConfigured = false;

/**
 * Inicializa Firebase si las credenciales han sido configuradas.
 * Detecta automáticamente si las llaves siguen siendo las de ejemplo.
 */
export function initFirebase(): { db: Firestore | null; isConfigured: boolean } {
  if (app) return { db, isConfigured };

  const hasRealKeys =
    Boolean(firebaseConfig.apiKey) &&
    !firebaseConfig.apiKey.includes('XXXXXXXX') &&
    Boolean(firebaseConfig.projectId) &&
    !firebaseConfig.projectId.includes('tu-proyecto');

  if (!hasRealKeys) {
    console.warn(
      '[Firebase] Credenciales no configuradas. Usando localStorage como respaldo.'
    );
    return { db: null, isConfigured: false };
  }

  try {
    app = initializeApp(firebaseConfig);
    db = initializeFirestore(app, {
      localCache: persistentLocalCache({
        tabManager: persistentMultipleTabManager(),
      }),
    });
    auth = getAuth(app);
    isConfigured = true;

    // Inicialización de Firebase App Check (mitigación de abuso / fuerza bruta)
    const recaptchaSiteKey = (
      import.meta.env.VITE_RECAPTCHA_SITE_KEY ||
      import.meta.env.VITE_FIREBASE_APPCHECK_KEY ||
      ''
    ) as string;

    if (typeof window !== 'undefined') {
      try {
        if (import.meta.env.DEV && !recaptchaSiteKey) {
          // Permite token de depuración para desarrollo local
          // @ts-expect-error - Flag global de depuración para App Check en desarrollo
          self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
        }

        if (recaptchaSiteKey) {
          appCheck = initializeAppCheck(app, {
            provider: new ReCaptchaV3Provider(recaptchaSiteKey),
            isTokenAutoRefreshEnabled: true,
          });
          console.log('[Firebase] App Check inicializado con reCAPTCHA.');
        }
      } catch (appCheckErr) {
        console.warn('[Firebase] No se pudo inicializar App Check (opcional):', appCheckErr);
      }
    }

    console.log('[Firebase] Firestore y Auth inicializados correctamente.');
  } catch (err) {
    console.error('[Firebase] Error al inicializar:', err);
    app = null;
    db = null;
    auth = null;
    appCheck = null;
    isConfigured = false;
  }

  return { db, isConfigured };
}

/**
 * Retorna la instancia actual de App Check, o null si no está configurada.
 */
export function getAppCheckInstance(): AppCheck | null {
  if (!app) {
    initFirebase();
  }
  return appCheck;
}

/**
 * Retorna la instancia actual de Firestore, o null si no está configurada.
 */
export function getFirestoreInstance(): Firestore | null {
  if (!app) {
    const result = initFirebase();
    return result.db;
  }
  return db;
}

/**
 * Retorna la instancia actual de Auth, o null si no está configurada.
 */
export function getAuthInstance(): Auth | null {
  if (!app) {
    initFirebase();
  }
  return auth;
}

/**
 * Verifica si Firebase está configurado y listo para usar.
 * Inicializa automáticamente si es la primera vez que se llama.
 */
export function isFirebaseReady(): boolean {
  if (!app) {
    initFirebase();
  }
  return isConfigured && db !== null;
}

/**
 * Retorna el usuario actual de Firebase o null si no hay sesión iniciada.
 */
export function getCurrentUser(): User | null {
  const authInstance = getAuthInstance();
  return authInstance?.currentUser ?? null;
}

/**
 * Verifica si el usuario actual está genuinamente autenticado (no anónimo).
 */
export function isUserAuthenticated(): boolean {
  const user = getCurrentUser();
  return Boolean(user && !user.isAnonymous);
}

/**
 * Obtiene el email configurado para el administrador en las variables de entorno.
 * Falla explícitamente si `VITE_ADMIN_EMAIL` no ha sido definido para prevenir configuraciones ocultas.
 */
export function getConfiguredAdminEmail(): string {
  const envEmail = (
    import.meta.env.VITE_ADMIN_EMAIL ||
    import.meta.env.ADMIN_EMAIL ||
    ''
  ) as string;

  const email = envEmail.trim();
  if (!email) {
    throw new Error('VITE_ADMIN_EMAIL no está configurado en las variables de entorno.');
  }

  return email;
}

/**
 * Obtiene el email del usuario autenticado actualmente.
 */
export function getCurrentAdminEmail(): string | null {
  const user = getCurrentUser();
  return user ? user.email : null;
}

// ─── Estado en memoria de autorización (Custom Claims) ───────────────
let cachedIsAdmin = false;
let cachedClaims: Record<string, unknown> = {};

/**
 * Evalúa si un usuario posee privilegios de administrador basándose en:
 * 1. Prioridad: Custom Claim `request.auth.token.admin == true` (recomendación oficial de Firebase).
 * 2. Criterio de respaldo/transición: Correo de administrador configurado (alineado con firestore.rules).
 */
export function evaluateUserIsAdmin(user: User | null, claims?: Record<string, unknown>): boolean {
  if (!user || user.isAnonymous) return false;

  const currentClaims = claims ?? cachedClaims;
  if (currentClaims.admin === true) {
    return true;
  }

  try {
    const configuredEmail = getConfiguredAdminEmail();
    if (user.email?.toLowerCase() === configuredEmail.toLowerCase()) {
      return true;
    }
  } catch {
    // Si VITE_ADMIN_EMAIL no está configurado, la autorización depende exclusivamente del Custom Claim
  }

  return false;
}

/**
 * Verifica de forma síncrona si el usuario actual posee autorización de administrador
 * según los claims validados en memoria.
 */
export function isCurrentUserAdmin(): boolean {
  return cachedIsAdmin;
}

/**
 * Retorna los claims actuales del usuario autenticado almacenados en memoria.
 */
export function getCurrentUserClaims(): Record<string, unknown> {
  return { ...cachedClaims };
}

/**
 * Refresca de forma asíncrona los claims del token del usuario actual mediante Firebase Auth.
 * Permite forzar la revalidación contra Google Identity Toolkit (BaaS) con `forceRefresh = true`.
 */
export async function refreshCurrentUserClaims(forceRefresh = false): Promise<boolean> {
  const user = getCurrentUser();
  if (!user || user.isAnonymous) {
    cachedIsAdmin = false;
    cachedClaims = {};
    return false;
  }

  try {
    const tokenResult = await getIdTokenResult(user, forceRefresh);
    cachedClaims = (tokenResult.claims ?? {}) as Record<string, unknown>;
    cachedIsAdmin = evaluateUserIsAdmin(user, cachedClaims);
  } catch (err) {
    if (import.meta.env.DEV) {
      console.warn('[Firebase] Error al obtener claims del token:', err);
    }
    cachedIsAdmin = evaluateUserIsAdmin(user, cachedClaims);
  }

  return cachedIsAdmin;
}

/**
 * Permite suscribirse a cambios de estado de autenticación y autorización de Firebase.
 * Resuelve y almacena los claims del token ANTES de invocar el callback, evitando condiciones
 * de carrera o flashes de estado desautorizado en la UI.
 * Retorna una función para cancelar la suscripción.
 */
export function subscribeToAuthState(
  callback: (user: User | null, isAdmin: boolean) => void
): () => void {
  const authInstance = getAuthInstance();
  if (!authInstance) {
    callback(null, false);
    return () => {};
  }
  return onAuthStateChanged(authInstance, async (user) => {
    if (user && !user.isAnonymous) {
      await refreshCurrentUserClaims(false);
      callback(user, cachedIsAdmin);
    } else {
      cachedIsAdmin = false;
      cachedClaims = {};
      callback(null, false);
    }
  });
}

/**
 * Inicia sesión de administrador mediante el SDK cliente de Firebase Auth.
 * La autenticación se resuelve directamente contra la API de Google Identity Toolkit (BaaS).
 * Tras autenticar, fuerza la lectura inmediata de los Custom Claims emitidos en el token.
 */
export async function signInAdmin(email: string, password: string): Promise<User> {
  const authInstance = getAuthInstance();
  if (!authInstance) {
    throw new Error('Firebase Auth no está disponible o no se ha configurado.');
  }

  const credential = await signInWithEmailAndPassword(authInstance, email.trim(), password);
  // Refrescar claims inmediatamente tras iniciar sesión para reflejar rol de forma instantánea
  await refreshCurrentUserClaims(true);
  return credential.user;
}

/**
 * Cierra la sesión activa de Firebase Auth y limpia la caché de autorización en memoria.
 */
export async function signOutAdmin(): Promise<void> {
  const authInstance = getAuthInstance();
  cachedIsAdmin = false;
  cachedClaims = {};
  if (authInstance) {
    await signOut(authInstance);
  }
}
