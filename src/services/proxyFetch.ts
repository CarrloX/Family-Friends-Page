/**
 * Robust fetch utility with multiple CORS fallback proxies and local dev proxy support.
 */

// List of public CORS proxies to try in order when direct/local proxy fails
const CORS_PROXIES = [
  (target: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(target)}`,
  (target: string) => `https://api.allorigins.win/get?url=${encodeURIComponent(target)}`,
];

function resolveLocalProxyUrl(targetUrl: string): string | null {
  if (targetUrl.startsWith('https://store.steampowered.com/')) {
    return targetUrl.replace('https://store.steampowered.com', '/api/steam-store');
  }
  if (targetUrl.startsWith('https://api.steampowered.com/')) {
    return targetUrl.replace('https://api.steampowered.com', '/api/steam-web');
  }
  return null;
}

async function fetchFromLocalProxy<T>(targetUrl: string, timeoutMs: number): Promise<T | null> {
  const localUrl = resolveLocalProxyUrl(targetUrl);
  if (!localUrl) return null;

  try {
    const res = await fetch(localUrl, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
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

async function fetchFromProxyUrl<T>(proxyUrl: string, timeoutMs: number): Promise<T | null> {
  try {
    const res = await fetch(proxyUrl, { signal: AbortSignal.timeout(timeoutMs) });
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
  options: { timeoutMs?: number; localProxyPrefix?: string } = {}
): Promise<T | null> {
  const timeoutMs = options.timeoutMs || 4000;

  if (options.localProxyPrefix) {
    const localResult = await fetchFromLocalProxy<T>(targetUrl, timeoutMs);
    if (localResult !== null) return localResult;
  }

  for (const proxyFn of CORS_PROXIES) {
    const proxyResult = await fetchFromProxyUrl<T>(proxyFn(targetUrl), timeoutMs);
    if (proxyResult !== null) return proxyResult;
  }

  return null;
}

