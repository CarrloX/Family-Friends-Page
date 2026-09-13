import { initializeApp, type FirebaseApp } from 'firebase/app';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, type Firestore } from 'firebase/firestore';
import {
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  type Auth,
  type User,
} from 'firebase/auth';

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

    console.log('[Firebase] Firestore y Auth inicializados correctamente.');
  } catch (err) {
    console.error('[Firebase] Error al inicializar:', err);
    app = null;
    db = null;
    auth = null;
    isConfigured = false;
  }

  return { db, isConfigured };
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
 * Obtiene el email del usuario administrador autenticado actualmente.
 */
export function getCurrentAdminEmail(): string | null {
  const user = getCurrentUser();
  return user ? user.email : null;
}

/**
 * Permite suscribirse a cambios de estado de autenticación de Firebase.
 * Retorna una función para cancelar la suscripción.
 */
export function subscribeToAuthState(callback: (user: User | null) => void): () => void {
  const authInstance = getAuthInstance();
  if (!authInstance) {
    callback(null);
    return () => {};
  }
  return onAuthStateChanged(authInstance, (user) => {
    callback(user && !user.isAnonymous ? user : null);
  });
}

/**
 * Inicia sesión de administrador con correo y contraseña en Firebase Auth.
 * La verificación se realiza de manera segura en los servidores de Google Firebase.
 */
export async function signInAdmin(email: string, password: string): Promise<User> {
  const authInstance = getAuthInstance();
  if (!authInstance) {
    throw new Error('Firebase Auth no está disponible o no se ha configurado.');
  }

  const credential = await signInWithEmailAndPassword(authInstance, email.trim(), password);
  return credential.user;
}

/**
 * Cierra la sesión activa de Firebase Auth.
 */
export async function signOutAdmin(): Promise<void> {
  const authInstance = getAuthInstance();
  if (authInstance) {
    await signOut(authInstance);
  }
}
