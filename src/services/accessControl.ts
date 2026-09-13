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

export interface AdminAccessState {
  canManageContent: boolean;
  isLocalEnvironment: boolean;
  isReadOnly: boolean;
  isAuthenticated: boolean;
  adminEmail: string | null;
  requestedAdmin: boolean;
}

/**
 * Obtiene el estado actual de acceso administrativo.
 * Los permisos de escritura están estrictamente condicionados a la autenticación
 * en Firebase Auth, sin validar contraseñas ni variables en el código cliente.
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

/**
 * Mapea códigos de error de Firebase Authentication a mensajes claros en español neutro.
 */
function mapAuthError(err: unknown): string {
  if (!err || typeof err !== 'object') {
    return 'Error desconocido al autenticar.';
  }

  const code = 'code' in err ? String(err.code) : '';

  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Contraseña incorrecta. Intenta nuevamente.';
    case 'auth/invalid-email':
      return 'El formato del correo electrónico no es válido.';
    case 'auth/user-disabled':
      return 'La cuenta de administrador se encuentra deshabilitada.';
    case 'auth/too-many-requests':
      return 'Demasiados intentos fallidos. Por seguridad, espera unos minutos antes de reintentar.';
    case 'auth/network-request-failed':
      return 'Error de conexión al servidor de autenticación. Verifica tu red.';
    case 'auth/operation-not-allowed':
      return 'El método de autenticación con correo/contraseña no está habilitado en Firebase Console.';
    default:
      return 'code' in err && typeof err.code === 'string'
        ? `Error de autenticación: ${err.code}`
        : 'No se pudo verificar la sesión de administrador.';
  }
}

/**
 * Inicia sesión de administrador mediante Firebase Authentication usando únicamente la contraseña.
 * El correo de administrador configurado se maneja internamente en el servidor/entorno.
 * NO realiza comparaciones directas de variables en el cliente.
 */
export async function loginAdminWithPassword(
  password: string
): Promise<{ success: boolean; error?: string }> {
  return loginAdminWithCredentials(getDefaultAdminEmail(), password);
}

/**
 * Inicia sesión de administrador mediante Firebase Authentication.
 * NO realiza comparaciones directas de variables en el cliente.
 */
export async function loginAdminWithCredentials(
  email: string,
  password: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const targetEmail = email.trim() || getDefaultAdminEmail();
    await signInAdmin(targetEmail, password);
    return { success: true };
  } catch (err) {
    console.warn('[AccessControl] Error al autenticar administrador:', err);
    return { success: false, error: mapAuthError(err) };
  }
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
): Promise<{ success: boolean; error?: string }> {
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
