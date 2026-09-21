import {
  isUserAuthenticated,
  getCurrentAdminEmail,
  signInAdmin,
  signOutAdmin,
  isFirebaseReady,
} from './firebaseConfig';

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0']);

function getHostname(): string {
  if (typeof window === 'undefined') {
    return '';
  }
  return window.location.hostname;
}

function getSearch(): string {
  if (typeof window === 'undefined') {
    return '';
  }
  return window.location.search;
}

export function isLocalEnvironment(hostname = getHostname()): boolean {
  return !hostname || LOCAL_HOSTNAMES.has(hostname) || hostname.endsWith('.local');
}

/**
 * Obtiene el correo por defecto de administrador configurado, o un valor seguro sugerido.
 */
export function getDefaultAdminEmail(): string {
  const envEmail = (import.meta.env.VITE_ADMIN_EMAIL as string | undefined)?.trim();
  return envEmail || 'admin@familyandfriendssteam.firebaseapp.com';
}

/**
 * Códigos de error de autenticación normalizados a nivel de dominio.
 * Desacoplan la capa de presentación (UI) de cualquier proveedor de autenticación subyacente (Firebase, Supabase, Auth0, backend propio, etc.).
 */
export type AuthErrorCode =
  | 'invalid-credentials'
  | 'rate-limited'
  | 'network-error'
  | 'unknown-error';

export interface AuthResult {
  success: boolean;
  error?: string;
  errorCode?: AuthErrorCode;
  retryAfterSeconds?: number;
}

export interface AdminAccessState {
  canManageContent: boolean;
  isLocalEnvironment: boolean;
  isReadOnly: boolean;
  isAuthenticated: boolean;
  adminEmail: string | null;
  requestedAdmin: boolean;
}

/**
 * Obtiene el estado actual de acceso administrativo para la interfaz de usuario (UI).
 *
 * NOTA DE SEGURIDAD:
 * Los valores aquí expuestos (`canManageContent`, `isReadOnly`) controlan únicamente la
 * experiencia de usuario en el frontend (renderizado condicional de botones y edición).
 * La autorización real e inquebrantable reside en las reglas del servidor (`firestore.rules`),
 * que exigen un token de Firebase Auth válido con privilegios de administrador para cualquier mutación.
 */
export function getAdminAccessState(options?: {
  hostname?: string;
  search?: string;
}): AdminAccessState {
  const hostname = options?.hostname ?? getHostname();
  const search = options?.search ?? getSearch();
  const localEnvironment = isLocalEnvironment(hostname);
  const authenticated = isUserAuthenticated();
  const adminEmail = getCurrentAdminEmail();
  const firebaseReady = isFirebaseReady();

  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const requestedAdmin = params.get('admin') === 'true' || params.get('admin') === '1';

  // Si Firebase no está configurado (modo offline/desarrollo sin backend), se permite edición local.
  // En producción o con Firebase activo, SOLAMENTE un usuario autenticado puede escribir.
  const canManage = authenticated || (localEnvironment && !firebaseReady);

  return {
    canManageContent: canManage,
    isLocalEnvironment: localEnvironment,
    isReadOnly: !canManage,
    isAuthenticated: authenticated,
    adminEmail,
    requestedAdmin,
  };
}

interface MappedAuthError {
  message: string;
  code: AuthErrorCode;
  retryAfterSeconds?: number;
}

/**
 * Traduce códigos de error específicos del proveedor (Firebase Authentication) a
 * conceptos de dominio normalizados (`AuthErrorCode`) y mensajes seguros conforme a OWASP.
 * Evita la enumeración de cuentas o filtración de detalles internos del proveedor.
 */
function mapAuthError(err: unknown): MappedAuthError {
  if (!err || typeof err !== 'object') {
    return {
      message: 'Credenciales incorrectas o error al autenticar.',
      code: 'invalid-credentials',
    };
  }

  const rawCode = 'code' in err ? String(err.code) : '';

  switch (rawCode) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
    case 'auth/invalid-email':
      // Mensaje unificado para prevenir enumeración de cuentas
      return {
        message: 'Credenciales incorrectas. Intenta nuevamente.',
        code: 'invalid-credentials',
      };
    case 'auth/too-many-requests':
      return {
        message: 'Demasiados intentos fallidos. Por seguridad, el acceso ha sido bloqueado temporalmente.',
        code: 'rate-limited',
        retryAfterSeconds: 60,
      };
    case 'auth/network-request-failed':
      return {
        message: 'Error de conexión con el servidor. Verifica tu red e intenta nuevamente.',
        code: 'network-error',
      };
    case 'auth/user-disabled':
    case 'auth/operation-not-allowed':
    default:
      // Detalles técnicos o no previstos no se exponen al usuario final
      return {
        message: 'No se pudo verificar la sesión. Intenta nuevamente.',
        code: 'unknown-error',
      };
  }
}

/**
 * Inicia sesión de administrador mediante Firebase Authentication usando la contraseña ingresada.
 * Resuelve el correo de administrador internamente desde las variables de entorno.
 * La solicitud se despacha directamente a Google Identity Toolkit mediante el SDK de cliente.
 */
export async function loginAdminWithPassword(
  password: string
): Promise<AuthResult> {
  return loginAdminWithCredentials(getDefaultAdminEmail(), password);
}

/**
 * Cerrojo a nivel de servicio (In-Flight Mutex).
 * Evita condiciones de carrera y peticiones concurrentes en el runtime de JavaScript
 * si múltiples eventos asíncronos se disparan antes de que el estado de React actualice la UI.
 */
let activeAuthPromise: Promise<AuthResult> | null = null;

/**
 * Inicia sesión de administrador mediante el SDK cliente de Firebase Auth (BaaS).
 * Las credenciales viajan directamente a la API de Google, que emite un ID Token criptográfico.
 * Implementa deduplicación de peticiones en vuelo (in-flight singleton).
 */
export async function loginAdminWithCredentials(
  email: string,
  password: string
): Promise<AuthResult> {
  // Si ya hay una verificación en curso en este runtime, reutilizar la misma promesa
  if (activeAuthPromise) {
    return activeAuthPromise;
  }

  activeAuthPromise = (async () => {
    try {
      const targetEmail = email.trim() || getDefaultAdminEmail();
      await signInAdmin(targetEmail, password);
      return { success: true };
    } catch (err) {
      console.warn('[AccessControl] Error al autenticar administrador:', err);
      const mapped = mapAuthError(err);
      return {
        success: false,
        error: mapped.message,
        errorCode: mapped.code,
        retryAfterSeconds: mapped.retryAfterSeconds,
      };
    } finally {
      activeAuthPromise = null;
    }
  })();

  return activeAuthPromise;
}

/**
 * Cierra la sesión activa de administrador.
 */
export async function logoutAdmin(): Promise<void> {
  await signOutAdmin();
}

/**
 * Desbloquea la sesión de administrador validando credenciales mediante Firebase Auth.
 * Admite pasar correo opcional; si no se provee, utiliza el correo de administrador configurado.
 */
export async function unlockWithPin(
  enteredPin: string,
  email?: string
): Promise<AuthResult> {
  const targetEmail = email?.trim() || getDefaultAdminEmail();
  return loginAdminWithCredentials(targetEmail, enteredPin);
}

/**
 * Cierra la sesión activa de administrador (alias de compatibilidad).
 */
export async function clearAdminSession(): Promise<void> {
  await logoutAdmin();
}

export function requestAdminUnlock(options?: {
  hostname?: string;
  search?: string;
}): boolean {
  const state = getAdminAccessState(options);
  return state.canManageContent;
}
