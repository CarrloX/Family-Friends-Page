const ADMIN_SESSION_KEY = 'family_friends_admin_session_v1';
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

function getSessionStorage(): Storage | null {
  if (typeof window === 'undefined' || !window.sessionStorage) {
    return null;
  }
  return window.sessionStorage;
}

export function isLocalEnvironment(hostname = getHostname()): boolean {
  return !hostname || LOCAL_HOSTNAMES.has(hostname) || hostname.endsWith('.local');
}

export function getAdminPin(): string {
  const configuredPin = import.meta.env.VITE_ADMIN_PIN?.trim();
  return configuredPin || 'FAMILY2026';
}

export function getAdminAccessState(options?: {
  hostname?: string;
  search?: string;
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
}) {
  const hostname = options?.hostname ?? getHostname();
  const search = options?.search ?? getSearch();
  const storage = options?.storage ?? getSessionStorage();
  const localEnvironment = isLocalEnvironment(hostname);
  const sessionUnlocked = storage?.getItem(ADMIN_SESSION_KEY) === 'true';
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const requestedAdmin = params.get('admin') === 'true' || params.get('admin') === '1';

  return {
    canManageContent: localEnvironment || sessionUnlocked,
    isLocalEnvironment: localEnvironment,
    isReadOnly: !localEnvironment && !sessionUnlocked,
    requestedAdmin,
  };
}

export function requestAdminUnlock(options?: {
  hostname?: string;
  search?: string;
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
}): boolean {
  const state = getAdminAccessState(options);
  const storage = options?.storage ?? getSessionStorage();

  if (state.canManageContent) {
    return true;
  }

  if (typeof window === 'undefined') {
    return false;
  }

  if (state.isLocalEnvironment) {
    storage?.setItem(ADMIN_SESSION_KEY, 'true');
    return true;
  }

  const enteredPin = window.prompt('Ingresa el PIN de administrador para habilitar edición temporal en esta sesión.');
  if (!enteredPin) {
    return false;
  }

  if (enteredPin.trim() === getAdminPin()) {
    storage?.setItem(ADMIN_SESSION_KEY, 'true');
    return true;
  }

  window.alert('PIN incorrecto. La interfaz sigue en modo lectura.');
  return false;
}

export function clearAdminSession(storage?: Pick<Storage, 'removeItem'> | null): void {
  (storage ?? getSessionStorage())?.removeItem(ADMIN_SESSION_KEY);
}
