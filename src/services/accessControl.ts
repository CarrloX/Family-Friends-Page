import {
  isUserAuthenticated,
  isCurrentUserAdmin,
  getCurrentUserEmail,
  getConfiguredAdminEmail,
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
 * Modo de desarrollo local activo (entorno local sin backend Firebase configurado).
 * En este modo, todas las mutaciones quedan confinadas exclusivamente a localStorage.
 */
export function isLocalDevelopmentMode(
  hostname = getHostname(),
  firebaseReady = isFirebaseReady()
): boolean {
  return isLocalEnvironment(hostname) && !firebaseReady;
}

/**
 * Obtiene el correo por defecto de administrador configurado, o un valor seguro sugerido.
 */
export function getDefaultAdminEmail(): string {
  return getConfiguredAdminEmail();
}

/**
 * Códigos de error de autenticación y autorización normalizados a nivel de dominio.
 * Desacoplan la capa de presentación (UI) de cualquier proveedor de autenticación subyacente (Firebase, Supabase, Auth0, backend propio, etc.).
 */
export type AuthErrorCode =
  | 'invalid-credentials'
  | 'unauthorized'
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
  /** Permiso efectivo para mutar y gestionar contenido en la interfaz */
  canManageContent: boolean;
  /** Autorización: ¿Posee el usuario el rol/claim de administrador verificado? */
  isAdmin: boolean;
  /** Autenticación: ¿Existe una sesión válida de Firebase Auth? (No anónimo) */
  isAuthenticated: boolean;
  /** Correo electrónico de la sesión activa de Firebase Auth */
  adminEmail: string | null;
  /** Modo de solo lectura activo cuando el usuario carece de privilegios de gestión */
  isReadOnly: boolean;
  /** Indica si se ejecuta en un entorno de desarrollo local (localhost, 127.0.0.1) */
  isLocalEnvironment: boolean;
  /**
   * Modo de desarrollo local activo (localhost sin backend Firebase).
   * La persistencia en este modo queda confinada exclusivamente a localStorage del cliente.
   */
  isLocalDevelopmentMode: boolean;
  /**
   * Intención del usuario (UI / Navegación):
   * Indica si el usuario solicitó acceder o identificarse como admin vía parámetro de URL (`?admin=true` o `?admin=1`).
   *
   * NOTA ARQUITECTÓNICA:
   * Este valor representa exclusivamente una SEÑAL DE INTENCIÓN para que la UI despliegue
   * el diálogo de autenticación. NUNCA confiere autorización por sí mismo.
   */
  requestedAdmin: boolean;
}

/**
 * Obtiene el estado actual de acceso administrativo para la interfaz de usuario (UI).
 *
 * NOTA DE SEGURIDAD:
 * Los valores aquí expuestos (`canManageContent`, `isReadOnly`, `isAdmin`) controlan la
 * experiencia de usuario en el frontend (renderizado condicional de botones y edición).
 * La autorización real e inquebrantable reside en las reglas del servidor (`firestore.rules`),
 * que exigen un token de Firebase Auth válido con privilegios de administrador (`request.auth.token.admin == true`) para cualquier mutación.
 */
export function getAdminAccessState(options?: {
  hostname?: string;
  search?: string;
}): AdminAccessState {
  const hostname = options?.hostname ?? getHostname();
  const search = options?.search ?? getSearch();
  const localEnvironment = isLocalEnvironment(hostname);
  const authenticated = isUserAuthenticated();
  const admin = isCurrentUserAdmin();
  const adminEmail = getCurrentUserEmail();
  const firebaseReady = isFirebaseReady();
  const localDevelopmentMode = isLocalDevelopmentMode(hostname, firebaseReady);

  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const requestedAdmin = params.get('admin') === 'true' || params.get('admin') === '1';

  // Separación explícita de modos de autorización:
  // 1. En producción o con Firebase activo: SOLAMENTE un usuario con rol de administrador verificado puede gestionar contenido.
  // 2. Modo local sin backend (localDevelopmentMode): se permite gestión confinada a localStorage para desarrollo offline.
  const canManage = admin || localDevelopmentMode;

  return {
    canManageContent: canManage,
    isLocalEnvironment: localEnvironment,
    isLocalDevelopmentMode: localDevelopmentMode,
    isReadOnly: !canManage,
    isAuthenticated: authenticated,
    isAdmin: admin,
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

  // Error de autorización atómica (credenciales válidas pero cuenta sin privilegios de admin)
  if (err instanceof Error && err.message === 'AUTHORIZATION_FAILED') {
    return {
      message: 'No fue posible autorizar el acceso.',
      code: 'unauthorized',
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
      // Firebase no comunica la duración exacta del bloqueo por rate limit / anti-abuso.
      // No asumimos una duración fija en el cliente.
      return {
        message: 'Demasiados intentos fallidos. Por seguridad, el acceso ha sido bloqueado temporalmente. Espera un momento antes de volver a intentarlo.',
        code: 'rate-limited',
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
 * Inicia sesión del administrador usando la contraseña ingresada.
 * Punto de entrada público único: el correo se resuelve internamente desde las variables de entorno.
 */
export async function loginAdminWithPassword(
  password: string
): Promise<AuthResult> {
  return authenticateAdminAccount(password);
}

/**
 * Implementación interna de autenticación y verificación de autorización.
 * Resuelve el correo administrativo desde las variables de entorno; el llamador
 * nunca manipula la identidad de la cuenta. No se exporta para evitar que código
 * externo pueda sustituir el correo y ampliar la superficie de ataque.
 */
async function authenticateAdminAccount(password: string): Promise<AuthResult> {
  try {
    const email = getDefaultAdminEmail();
    await signInAdmin(email, password);

    // Verificación de defensa en profundidad:
    // signInAdmin() garantiza la autorización atómica (autenticación + claims),
    // pero verificamos el estado sincronizado en memoria como salvaguarda adicional.
    if (!isCurrentUserAdmin()) {
      if (import.meta.env.DEV) {
        console.warn(
          '[AccessControl] Acceso denegado: la cuenta autenticada carece de privilegios de administrador:',
          email
        );
      }
      await signOutAdmin();
      return {
        success: false,
        error: 'No fue posible autorizar el acceso.',
        errorCode: 'unauthorized',
      };
    }

    return { success: true };
  } catch (err) {
    if (import.meta.env.DEV) {
      console.warn('[AccessControl] Error al autenticar administrador:', err);
    }
    if (err instanceof Error && err.message.includes('VITE_ADMIN_EMAIL')) {
      return {
        success: false,
        error: err.message,
        errorCode: 'unknown-error',
      };
    }
    if (err instanceof Error && err.message === 'AUTHORIZATION_FAILED') {
      return {
        success: false,
        error: 'No fue posible autorizar el acceso.',
        errorCode: 'unauthorized',
      };
    }
    const mapped = mapAuthError(err);
    return {
      success: false,
      error: mapped.message,
      errorCode: mapped.code,
      retryAfterSeconds: mapped.retryAfterSeconds,
    };
  }
}

/**
 * Cierra la sesión activa de administrador.
 */
export async function logoutAdmin(): Promise<void> {
  await signOutAdmin();
}

/**
 * Desbloquea la sesión de administrador validando la contraseña ingresada por el usuario.
 * El correo administrativo se resuelve internamente; el llamador nunca lo manipula.
 *
 * Flujo: contraseña → loginAdminWithPassword → correo interno → Firebase Auth
 */
export async function unlockWithPin(enteredPin: string): Promise<AuthResult> {
  return loginAdminWithPassword(enteredPin);
}

/**
 * Cierra la sesión activa de administrador (alias de compatibilidad).
 */
export async function clearAdminSession(): Promise<void> {
  await logoutAdmin();
}

/**
 * Determina si el entorno o usuario actual cuenta con permisos para gestionar y modificar contenido
 * (es decir, usuario con rol de administrador verificado o entorno local sin backend).
 * Proporciona una consulta booleana directa sin necesidad de desestructurar `getAdminAccessState()`.
 */
export function canManageContent(options?: {
  hostname?: string;
  search?: string;
}): boolean {
  return getAdminAccessState(options).canManageContent;
}

/**
 * @deprecated Utiliza `canManageContent()` para reflejar con precisión que se trata de una comprobación booleana de permisos.
 */
export const requestAdminUnlock = canManageContent;

export { isCurrentUserAdmin };
export { refreshCurrentUserClaims, getCurrentUserClaims } from './firebaseConfig';
