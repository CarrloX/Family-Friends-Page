/**
 * Robust fetch utility with multiple CORS fallback proxies and local dev proxy support.
 */

// List of public CORS proxies to try in order when direct/local proxy fails
const CORS_PROXIES = [
  (target: string) => `https://cors.eu.org/${target}`,
  (target: string) => `https://api.allorigins.win/get?url=${encodeURIComponent(target)}`,
  (target: string) => `https://corsproxy.org/?${encodeURIComponent(target)}`,
];

/**
 * Executes a resilient fetch for a given Steam or external API URL.
 * Automatically tries local Vite dev proxy first (if applicable), then falls back to tested CORS proxies.
 */
export async function fetchWithCorsFallback<T = unknown>(
  targetUrl: string,
  options: { timeoutMs?: number; localProxyPrefix?: string } = {}
): Promise<T | null> {
  const timeoutMs = options.timeoutMs || 4000;

  // 1. If in dev or local proxy prefix is supplied, attempt local proxy
  if (options.localProxyPrefix) {
    try {
      let localUrl = '';
      if (targetUrl.startsWith('https://store.steampowered.com/')) {
        localUrl = targetUrl.replace('https://store.steampowered.com', '/api/steam-store');
      } else if (targetUrl.startsWith('https://api.steampowered.com/')) {
        localUrl = targetUrl.replace('https://api.steampowered.com', '/api/steam-web');
      }

      if (localUrl) {
        const res = await fetch(localUrl, { signal: AbortSignal.timeout(timeoutMs) });
        if (res.ok) {
          const data = await res.json();
          if (data) return data as T;
        }
      }
    } catch {
      // Local dev proxy unavailable or failed, continue to external fallbacks
    }
  }

  // 2. Try external CORS proxies sequentially
  for (const proxyFn of CORS_PROXIES) {
    try {
      const proxyUrl = proxyFn(targetUrl);
      const res = await fetch(proxyUrl, {
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!res.ok) continue;

      // Handle AllOrigins JSON wrapper
      if (proxyUrl.includes('allorigins.win/get')) {
        const wrapper = await res.json();
        if (wrapper?.contents) {
          const parsed = typeof wrapper.contents === 'string' 
            ? JSON.parse(wrapper.contents) 
            : wrapper.contents;
          return parsed as T;
        }
      } else {
        const data = await res.json();
        if (data) return data as T;
      }
    } catch {
      // Try next proxy silently
    }
  }

  return null;
}
