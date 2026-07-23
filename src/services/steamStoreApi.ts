


export interface SteamSearchResultItem {
  id: number;
  name: string;
  tiny_image: string;
  header_image: string;
  price_formatted?: string;
}



/**
 * Searches Steam Store API for games matching `term`.
 */
export async function searchSteamStore(query: string): Promise<SteamSearchResultItem[]> {
  const cleanTerm = query.trim();
  if (!cleanTerm || cleanTerm.length < 2) {
    return [];
  }

  // 1. Try real Steam Store API via CORS proxy with Colombia regional pricing (cc=CO)
  try {
    const targetUrl = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(
      cleanTerm
    )}&l=spanish&cc=CO`;
    const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`;

    const res = await fetch(proxyUrl, { signal: AbortSignal.timeout(4000) });
    if (res.ok) {
      const data = await res.json();
      if (data && Array.isArray(data.items) && data.items.length > 0) {
        return data.items.map(
          (item: { id: number; name: string; tiny_image?: string; price?: { final?: number } }) => {
            const tinyImg =
              item.tiny_image || `https://cdn.akamai.steamstatic.com/steam/apps/${item.id}/capsule_sm_120.jpg`;

            // Derive header image directly from Steam's CDN url or pattern
            let headerImg = tinyImg.replace(/capsule_[^/]+\.jpg/i, 'header.jpg');
            if (headerImg === tinyImg) {
              headerImg = `https://cdn.akamai.steamstatic.com/steam/apps/${item.id}/header.jpg`;
            }

            // Format price in Colombian Pesos (COP)
            let formattedPrice = 'Ver en Steam';
            if (item.price && typeof item.price.final === 'number') {
              if (item.price.final === 0) {
                formattedPrice = 'Gratis';
              } else {
                const copValue = item.price.final / 100;
                formattedPrice = new Intl.NumberFormat('es-CO', {
                  style: 'currency',
                  currency: 'COP',
                  maximumFractionDigits: 0,
                }).format(copValue) + ' COP';
              }
            }

            return {
              id: item.id,
              name: item.name,
              tiny_image: tinyImg,
              header_image: headerImg,
              price_formatted: formattedPrice,
            };
          }
        );
      }
    }
  } catch (err) {
    console.warn('Steam Store API search error or CORS timeout, using fallback games database...', err);
  }

  return [];
}

/**
 * Fetches short_description and genres for a game by appId using Steam App Details API.
 */
export async function fetchSteamGameDetails(appId: number): Promise<{ description?: string; genres?: string }> {
  try {
    const targetUrl = `https://store.steampowered.com/api/appdetails?appids=${appId}&l=spanish`;
    const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`;
    const res = await fetch(proxyUrl, { signal: AbortSignal.timeout(3500) });
    if (res.ok) {
      const data = await res.json();
      const appInfo = data?.[appId.toString()]?.data;
      if (appInfo) {
        // Strip HTML tags from short_description
        const cleanDesc = appInfo.short_description
          ? appInfo.short_description.replace(/<[^>]*>?/gm, '').trim()
          : undefined;
        const genresList = Array.isArray(appInfo.genres)
          ? appInfo.genres.map((g: { description: string }) => g.description).join(' / ')
          : undefined;

        return {
          description: cleanDesc,
          genres: genresList,
        };
      }
    }
  } catch (err) {
    console.warn(`Error fetching Steam AppDetails for appId ${appId}:`, err);
  }
  return {};
}
