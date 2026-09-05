import type { Game } from '../types/voting';

/**
 * Genera un SVG en base64 para usar como imagen de respaldo estilizada
 * cuando ningún CDN de Steam responde o la imagen personalizada no existe.
 */
export function getSteamPlaceholderSvg(title = 'Steam Game'): string {
  const safeTitle = title.replace(/[<>&"]/g, '');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="460" height="215" viewBox="0 0 460 215" fill="none">
    <rect width="460" height="215" fill="#1b2838"/>
    <rect x="10" y="10" width="440" height="195" rx="8" fill="#171a21" stroke="#2a475e" stroke-width="2"/>
    <circle cx="230" cy="85" r="32" fill="#2a475e" fill-opacity="0.6"/>
    <path d="M220 75h20v20h-20zM215 90h30v6h-30zM227 70h6v30h-6z" fill="#66c0f4"/>
    <circle cx="230" cy="85" r="16" fill="#1b2838"/>
    <text x="230" y="145" fill="#c7d5e0" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="14" font-weight="bold" text-anchor="middle">${safeTitle}</text>
    <text x="230" y="165" fill="#66c0f4" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="11" text-anchor="middle">Steam Family</text>
  </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/**
 * Corrige URLs de Steam rotas que contengan subcarpetas con hash antes de header.jpg.
 * Steam Search API devuelve tiny_image con un hash de asset, e.g.:
 *   .../apps/1086940/3dd81008e9c385caf68152450c22353f6a8abec9/header.jpg
 * Esa ruta siempre devuelve 404. La ruta correcta es:
 *   https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1086940/header.jpg
 */
export function fixSteamCoverUrl(url?: string, appId?: number): string {
  if (!url && appId) {
    return `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/header.jpg`;
  }
  if (!url) {
    return '';
  }

  // Detectar y corregir el patrón erróneo con hash en store_item_assets o cdn.akamai
  const brokenHashPattern = /(?:store_item_assets\/steam|steam)\/apps\/(\d+)\/[a-f0-9]{16,}\/header\.jpg/i;
  const match = url.match(brokenHashPattern);
  if (match && match[1]) {
    const extractedAppId = match[1];
    return `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${extractedAppId}/header.jpg`;
  }

  return url;
}

/**
 * Construye una lista de URLs en orden de prioridad para intentar cargar la imagen de un juego.
 */
export function getGameImageFallbacks(game?: Partial<Game>): string[] {
  const fallbacks: string[] = [];
  if (!game) {
    return [getSteamPlaceholderSvg()];
  }

  const appId = game.appId ? Number(game.appId) : undefined;
  const cleanedCover = fixSteamCoverUrl(game.coverImage, appId);

  // 1. Si la portada es personalizada (data URL, upload local o URL externa diferente de Steam Store)
  const isCustomCover =
    cleanedCover.startsWith('data:') ||
    cleanedCover.startsWith('blob:') ||
    (!cleanedCover.includes('steamstatic.com') && !cleanedCover.includes('steamcommunity.com') && cleanedCover.length > 0);

  if (isCustomCover && cleanedCover) {
    fallbacks.push(cleanedCover);
  }

  // 2. Si tiene tinyCoverImage verificada (devuelta por Steam Search API con hash exacto).
  // Esto previene errores 404 en juegos no lanzados (como Jurassic World Evolution 3) que aún no tienen header.jpg publicado.
  if (game.tinyCoverImage && !fallbacks.includes(game.tinyCoverImage)) {
    fallbacks.push(game.tinyCoverImage);
  }

  // 3. Si tiene appId de Steam, añadir las rutas oficiales en orden de confiabilidad
  if (appId && !Number.isNaN(appId) && appId > 0) {
    // Header estándar en shared.akamai (el más confiable para juegos lanzados)
    const sharedHeader = `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/header.jpg`;
    if (!fallbacks.includes(sharedHeader)) {
      fallbacks.push(sharedHeader);
    }

    // Mirror en cdn.akamai
    const cdnHeader = `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/header.jpg`;
    if (!fallbacks.includes(cdnHeader)) {
      fallbacks.push(cdnHeader);
    }

    // Cápsulas alternativas
    fallbacks.push(`https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/capsule_231x87.jpg`);
    fallbacks.push(`https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/capsule_616x353.jpg`);
    fallbacks.push(`https://cdn.akamai.steamstatic.com/steam/apps/${appId}/capsule_sm_120.jpg`);
  }

  // 3. Si cleanedCover no se agregó previamente
  if (cleanedCover && !fallbacks.includes(cleanedCover)) {
    fallbacks.push(cleanedCover);
  }

  // 4. Si tinyCoverImage no se agregó previamente
  if (game.tinyCoverImage && !fallbacks.includes(game.tinyCoverImage)) {
    fallbacks.push(game.tinyCoverImage);
  }

  // 5. Placeholder final en SVG (siempre garantizado que se renderice)
  fallbacks.push(getSteamPlaceholderSvg(game.title || 'Steam Game'));

  return fallbacks;
}
