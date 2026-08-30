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

interface SteamAppDetailsResponse {
  [appId: string]: {
    success?: boolean;
    data?: {
      name?: string;
      is_free?: boolean;
      short_description?: string;
      genres?: Array<{ id?: string; description: string }>;
      price_overview?: {
        currency: string;
        initial: number;
        final: number;
        discount_percent: number;
        initial_formatted: string;
        final_formatted: string;
      };
    };
  };
}

/**
 * Formatea un valor en centavos a formato de Moneda Colombiana (COP).
 */
export function formatCopPrice(cents: number): string {
  if (cents === 0) return 'Gratis';
  const val = cents / 100;
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(val);
}

/**
 * Busca juegos en la Steam Store API por término con precios regionales de Colombia (cc=CO).
 */
export async function searchSteamStore(query: string): Promise<SteamSearchResultItem[]> {
  const cleanTerm = query.trim();
  if (!cleanTerm || cleanTerm.length < 2) {
    return [];
  }

  // Intentar consultar Steam Store API a través del sistema de proxy con precios regionales de Colombia (cc=CO)
  try {
    const targetUrl = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(
      cleanTerm
    )}&l=spanish&cc=CO`;

    const data = await fetchWithCorsFallback<SteamStoreSearchResponse>(targetUrl, {
      timeoutMs: 4000,
      localProxyPrefix: '/api/steam-store',
    });

    if (data && Array.isArray(data.items) && data.items.length > 0) {
      const results: SteamSearchResultItem[] = data.items.map((item) => {
        const tinyImg =
          item.tiny_image || `https://cdn.akamai.steamstatic.com/steam/apps/${item.id}/capsule_sm_120.jpg`;

        // Derivar header image directamente desde patrón o CDN de Steam
        let headerImg = tinyImg.replace(/capsule_[^/]+\.jpg/i, 'header.jpg');
        if (headerImg === tinyImg) {
          headerImg = `https://cdn.akamai.steamstatic.com/steam/apps/${item.id}/header.jpg`;
        }

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
            initialFormatted: discountPercent > 0 ? initialFormatted : undefined,
            finalFormatted,
          };
        }

        return {
          id: item.id,
          name: item.name,
          tiny_image: tinyImg,
          header_image: headerImg,
          price_formatted: formattedPrice,
          price: priceInfo,
        };
      });

      console.log(`[SteamStoreApi] ${results.length} juegos encontrados para "${cleanTerm}".`);
      return results;
    }
  } catch (err) {
    console.warn('[SteamStoreApi] Error buscando juegos en Steam Store:', err);
  }

  return [];
}

/**
 * Consulta la API oficial de Steam AppDetails para obtener descripción, géneros y precio/descuentos.
 */
export async function fetchSteamGameDetails(appId: number): Promise<{
  description?: string;
  genres?: string;
  price?: SteamPriceInfo;
}> {
  try {
    const targetUrl = `https://store.steampowered.com/api/appdetails?appids=${appId}&cc=CO&l=spanish`;
    const data = await fetchWithCorsFallback<SteamAppDetailsResponse>(targetUrl, {
      timeoutMs: 3500,
      localProxyPrefix: '/api/steam-store',
    });

    const appInfo = data?.[appId.toString()]?.data;
    if (appInfo) {
      // Limpiar etiquetas HTML de short_description
      const cleanDesc = appInfo.short_description
        ? appInfo.short_description.replace(/<[^>]*>?/gm, '').trim()
        : undefined;

      const genresList = Array.isArray(appInfo.genres)
        ? appInfo.genres.map((g) => g.description).join(' / ')
        : undefined;

      let priceInfo: SteamPriceInfo | undefined = undefined;
      const isFree = Boolean(appInfo.is_free);

      if (appInfo.price_overview) {
        const po = appInfo.price_overview;
        const initial = po.initial;
        const final = po.final;
        const discountPercent = po.discount_percent || 0;
        const initialFormatted = po.initial_formatted || (initial ? formatCopPrice(initial) : undefined);
        const finalFormatted = po.final_formatted || formatCopPrice(final);

        priceInfo = {
          isFree: false,
          currency: po.currency || 'COP',
          initial,
          final,
          discountPercent,
          initialFormatted: discountPercent > 0 ? initialFormatted : undefined,
          finalFormatted,
        };
      } else if (isFree) {
        priceInfo = {
          isFree: true,
          currency: 'COP',
          final: 0,
          discountPercent: 0,
          finalFormatted: 'Gratis',
        };
      }

      console.log(`[SteamStoreApi] Detalles obtenidos para appId ${appId}:`, {
        description: cleanDesc?.slice(0, 50),
        genres: genresList,
        price: priceInfo,
      });

      return {
        description: cleanDesc,
        genres: genresList,
        price: priceInfo,
      };
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