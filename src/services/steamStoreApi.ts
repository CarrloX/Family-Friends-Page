import { fetchWithCorsFallback } from './proxyFetch';
import type { SteamPriceInfo } from '../types/voting';

export type { SteamPriceInfo };

export interface SteamSearchResultItem {
  id: number;
  name: string;
  tiny_image: string;
  header_image: string;
  price_formatted?: string;
  price?: SteamPriceInfo;
}

interface SteamStoreSearchResponse {
  items?: Array<{
    id: number;
    name: string;
    tiny_image?: string;
    price?: {
      currency?: string;
      initial?: number;
      final?: number;
      discount_percent?: number;
    };
  }>;
}

interface SteamPriceOverview {
  currency: string;
  initial: number;
  final: number;
  discount_percent: number;
  initial_formatted: string;
  final_formatted: string;
}

interface SteamAppDetailsResponse {
  [appId: string]: {
    success?: boolean;
    data?: {
      name?: string;
      is_free?: boolean;
      short_description?: string;
      header_image?: string;
      genres?: Array<{ id?: string; description: string }>;
      price_overview?: SteamPriceOverview;
    };
  };
}

interface SteamCommunitySearchAppItem {
  appid?: string | number;
  name?: string;
  icon?: string;
  logo?: string;
}

/**
 * Formatea un valor en centavos a formato de Moneda Colombiana (COP) con estilo Steam (COL$ X.XXX).
 */
export function formatCopPrice(cents: number): string {
  if (cents === 0) return 'Gratis';
  const val = Math.round(cents / 100);
  const formattedNumber = new Intl.NumberFormat('es-CO', {
    maximumFractionDigits: 0,
  }).format(val);
  return `COL$ ${formattedNumber}`;
}

/**
 * Parsea una entrada de texto ingresada por el usuario (ej: "84.951", "84951", "$ 84.951 COP", "0")
 * a un valor numérico entero en centavos para consistencia con la API de Steam.
 * En Colombia los precios de videojuegos no tienen centavos fraccionarios; los puntos y comas se interpretan
 * como separadores de miles ingresados por el usuario.
 */
export function parseCopInputToCents(val: string): number | null {
  const trimmed = val.trim();
  if (!trimmed) return null;

  const cleanDigits = trimmed.replace(/[^\d]/g, '');
  if (!cleanDigits) return null;

  const pesos = Number(cleanDigits);
  if (Number.isNaN(pesos) || pesos < 0) return null;

  return Math.round(pesos * 100);
}

/**
 * Busca juegos en la Steam Store API por término con precios regionales de Colombia (cc=CO).
 * Si `storesearch` no responde, utiliza el endpoint alternativo de Steam Community SearchApps.
 */
export async function searchSteamStore(query: string, signal?: AbortSignal): Promise<SteamSearchResultItem[]> {
  const cleanTerm = query.trim();
  if (!cleanTerm || cleanTerm.length < 2) {
    return [];
  }

  if (signal?.aborted) {
    return [];
  }

  // 1. Intentar consultar Steam Store API a través del sistema de proxy con precios regionales de Colombia (cc=CO)
  const targetUrl = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(
    cleanTerm
  )}&l=spanish&cc=CO`;

  const data = await fetchWithCorsFallback<SteamStoreSearchResponse>(targetUrl, {
    timeoutMs: 4500,
    localProxyPrefix: '/api/steam-store',
    signal,
  });

  if (signal?.aborted) {
    return [];
  }

  if (data && Array.isArray(data.items)) {
    const results: SteamSearchResultItem[] = data.items.map((item) => {
      const headerImg = `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${item.id}/header.jpg`;
      const tinyImg = item.tiny_image || headerImg;

      let priceInfo: SteamPriceInfo | undefined = undefined;
      let formattedPrice = 'Ver en Steam';

      if (item.price && typeof item.price.final === 'number') {
        const isFree = item.price.final === 0;
        const initial = typeof item.price.initial === 'number' ? item.price.initial : item.price.final;
        const final = item.price.final;
        const discountPercent = typeof item.price.discount_percent === 'number' ? item.price.discount_percent : 0;

        const initialFormatted = initial > 0 ? formatCopPrice(initial) : undefined;
        const finalFormatted = isFree ? 'Gratis' : formatCopPrice(final);

        formattedPrice = finalFormatted;

        priceInfo = {
          isFree,
          currency: item.price.currency || 'COP',
          initial,
          final,
          discountPercent,
          finalFormatted,
          ...(discountPercent > 0 && initialFormatted ? { initialFormatted } : {}),
        };
      }

      return {
        id: item.id,
        name: item.name,
        tiny_image: tinyImg,
        header_image: headerImg,
        price_formatted: formattedPrice,
        ...(priceInfo ? { price: priceInfo } : {}),
      };
    });

    console.log(`[SteamStoreApi] ${results.length} juegos encontrados para "${cleanTerm}".`);
    return results;
  }

  // 2. Fallback secundario: Steam Community SearchApps (útil si storesearch falla o limita peticiones)
  const communityUrl = `https://steamcommunity.com/actions/SearchApps/${encodeURIComponent(cleanTerm)}`;
  const communityData = await fetchWithCorsFallback<SteamCommunitySearchAppItem[]>(communityUrl, {
    timeoutMs: 4500,
    localProxyPrefix: '/api/steam-community',
    signal,
  });

  if (signal?.aborted) {
    return [];
  }

  if (Array.isArray(communityData)) {
    const fallbackResults: SteamSearchResultItem[] = communityData
      .map((item): SteamSearchResultItem | null => {
        const appId = Number(item.appid);
        const name = item.name?.trim();
        if (!appId || Number.isNaN(appId) || !name) return null;
        const headerImg = `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/header.jpg`;
        return {
          id: appId,
          name,
          tiny_image: item.logo || item.icon || headerImg,
          header_image: headerImg,
          price_formatted: 'Ver en Steam',
        };
      })
      .filter((item): item is SteamSearchResultItem => item !== null);

    console.log(`[SteamStoreApi] ${fallbackResults.length} juegos encontrados vía fallback para "${cleanTerm}".`);
    return fallbackResults;
  }

  console.warn(`[SteamStoreApi] No se pudo obtener respuesta de búsqueda para "${cleanTerm}".`);
  throw new Error('No se pudo conectar con el buscador de Steam.');
}

// Cache en memoria para evitar peticiones redundantes y bloqueos de tasa (429)
const appDetailsCache = new Map<number, AppDetailsResult>();

function parseSteamPriceInfo(
  priceOverview?: SteamPriceOverview,
  isFree?: boolean
): SteamPriceInfo | undefined {
  if (priceOverview) {
    const initial = priceOverview.initial;
    const final = priceOverview.final;
    const discountPercent = priceOverview.discount_percent || 0;
    const initialFormatted = priceOverview.initial_formatted || (initial ? formatCopPrice(initial) : undefined);
    const finalFormatted = priceOverview.final_formatted || formatCopPrice(final);

    return {
      isFree: false,
      currency: priceOverview.currency || 'COP',
      initial,
      final,
      discountPercent,
      finalFormatted,
      ...(discountPercent > 0 && initialFormatted ? { initialFormatted } : {}),
    };
  }

  if (isFree) {
    return {
      isFree: true,
      currency: 'COP',
      final: 0,
      discountPercent: 0,
      finalFormatted: 'Gratis',
    };
  }

  return undefined;
}

export type AppDetailsResult = {
  description?: string;
  genres?: string;
  price?: SteamPriceInfo;
  headerImage?: string;
};

function parseAppInfoDetails(
  appInfo: NonNullable<SteamAppDetailsResponse[string]['data']>
): AppDetailsResult {
  const rawDesc = appInfo.short_description
    ? appInfo.short_description.replace(/<[^>]*>?/gm, '').trim()
    : '';
  const cleanDesc = rawDesc.length > 0 ? rawDesc : undefined;

  const genresArray = Array.isArray(appInfo.genres)
    ? appInfo.genres.map((g) => g.description?.trim()).filter((g): g is string => Boolean(g))
    : [];
  const genresList = genresArray.length > 0 ? genresArray.join(' / ') : undefined;

  const priceInfo = parseSteamPriceInfo(appInfo.price_overview, appInfo.is_free);
  const headerImage = appInfo.header_image?.trim() || undefined;

  return {
    ...(cleanDesc ? { description: cleanDesc } : {}),
    ...(genresList ? { genres: genresList } : {}),
    ...(priceInfo ? { price: priceInfo } : {}),
    ...(headerImage ? { headerImage } : {}),
  };
}

/**
 * Consulta la API oficial de Steam AppDetails para obtener descripción, géneros y precio/descuentos.
 */
export async function fetchSteamGameDetails(appId: number): Promise<AppDetailsResult> {
  const cached = appDetailsCache.get(appId);
  if (cached) {
    return cached;
  }

  try {
    const targetUrl = `https://store.steampowered.com/api/appdetails?appids=${appId}&cc=CO&l=spanish`;
    const data = await fetchWithCorsFallback<SteamAppDetailsResponse>(targetUrl, {
      timeoutMs: 6500,
      localProxyPrefix: '/api/steam-store',
    });

    const appInfo = data?.[appId.toString()]?.data;
    if (appInfo) {
      const result = parseAppInfoDetails(appInfo);
      appDetailsCache.set(appId, result);
      return result;
    }
  } catch (err) {
    console.warn(`[SteamStoreApi] Error obteniendo AppDetails para appId ${appId}:`, err);
  }
  return {};
}

/**
 * Obtiene exclusivamente la información de precio y descuento en tiempo real directamente de Steam.
 */
export async function fetchSteamGamePrice(appId: number): Promise<SteamPriceInfo | null> {
  const details = await fetchSteamGameDetails(appId);
  return details.price || null;
}