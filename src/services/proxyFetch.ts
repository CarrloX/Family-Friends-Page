/**
 * Robust fetch utility with multiple CORS fallback proxies and local dev proxy support.
 */

// Lista de proxies CORS públicos ordenados por disponibilidad actual
const CORS_PROXIES: Array<(target: string) => string> = [
  (target: string) => `https://api.cors.lol/?url=${encodeURIComponent(target)}`,
  (target: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(target)}`,
  (target: string) => `https://api.allorigins.win/get?url=${encodeURIComponent(target)}`,
  (target: string) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(target)}`,
];

function isLocalhost(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1'
  );
}

function isProxyCapableEnvironment(): boolean {
  if (typeof window === 'undefined') return false;
  // Entorno de desarrollo local (Vite dev/preview server)
  if (import.meta.env.DEV || isLocalhost()) {
    return true;
  }
  // Despliegue en Vercel (gestionado mediante vercel.json rewrites)
  if (window.location.hostname.includes('vercel.app')) {
    return true;
  }
  return false;
}

function getCorsProxiesForCurrentOrigin(): Array<(target: string) => string> {
  if (isLocalhost()) {
    return [
      ...CORS_PROXIES,
      (target: string) => `https://proxy.corsfix.com/?${target}`,
    ];
  }
  return CORS_PROXIES;
}

function resolveLocalProxyUrl(targetUrl: string): string | null {
  if (targetUrl.startsWith('https://store.steampowered.com/')) {
    return targetUrl.replace('https://store.steampowered.com', '/api/steam-store');
  }
  if (targetUrl.startsWith('https://api.steampowered.com/')) {
    return targetUrl.replace('https://api.steampowered.com', '/api/steam-web');
  }
  if (targetUrl.startsWith('https://steamcommunity.com/')) {
    return targetUrl.replace('https://steamcommunity.com', '/api/steam-community');
  }
  return null;
}

function combineSignals(timeoutMs: number, externalSignal?: AbortSignal): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  if (!externalSignal) return timeoutSignal;
  if (typeof AbortSignal.any === 'function') {
    return AbortSignal.any([timeoutSignal, externalSignal]);
  }
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  timeoutSignal.addEventListener('abort', onAbort, { once: true });
  externalSignal.addEventListener('abort', onAbort, { once: true });
  return controller.signal;
}

async function fetchFromLocalProxy<T>(targetUrl: string, timeoutMs: number, signal?: AbortSignal): Promise<T | null> {
  if (!isProxyCapableEnvironment()) return null;
  const localUrl = resolveLocalProxyUrl(targetUrl);
  if (!localUrl) return null;

  try {
    const res = await fetch(localUrl, { signal: combineSignals(timeoutMs, signal) });
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') || '';
    if (contentType && !contentType.includes('application/json') && !contentType.includes('text/plain')) {
      return null;
    }
    const data = await res.json();
    return (data as T) ?? null;
  } catch {
    return null;
  }
}

async function parseProxyResponse<T>(res: Response, proxyUrl: string): Promise<T | null> {
  if (proxyUrl.includes('allorigins.win/get')) {
    const wrapper = await res.json();
    if (!wrapper?.contents) return null;
    const parsed = typeof wrapper.contents === 'string'
      ? JSON.parse(wrapper.contents)
      : wrapper.contents;
    return parsed as T;
  }
  const data = await res.json();
  return (data as T) ?? null;
}

async function fetchFromProxyUrl<T>(proxyUrl: string, timeoutMs: number, signal?: AbortSignal): Promise<T | null> {
  try {
    const res = await fetch(proxyUrl, { signal: combineSignals(timeoutMs, signal) });
    if (!res.ok) return null;
    return await parseProxyResponse<T>(res, proxyUrl);
  } catch {
    return null;
  }
}

/**
 * Executes a resilient fetch for a given Steam or external API URL.
 * Automatically tries local Vite dev proxy first (if applicable), then falls back to tested CORS proxies.
 */
export async function fetchWithCorsFallback<T = unknown>(
  targetUrl: string,
  options: { timeoutMs?: number; localProxyPrefix?: string; signal?: AbortSignal } = {}
): Promise<T | null> {
  const timeoutMs = options.timeoutMs || 4000;
  const signal = options.signal;

  if (signal?.aborted) {
    return null;
  }

  if (options.localProxyPrefix) {
    const localResult = await fetchFromLocalProxy<T>(targetUrl, timeoutMs, signal);
    if (localResult !== null) return localResult;
  }

  if (signal?.aborted) {
    return null;
  }

  for (const proxyFn of getCorsProxiesForCurrentOrigin()) {
    if (signal?.aborted) {
      return null;
    }
    const proxyResult = await fetchFromProxyUrl<T>(proxyFn(targetUrl), timeoutMs, signal);
    if (proxyResult !== null) return proxyResult;
  }

  return null;
}

