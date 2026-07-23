import type { Game } from '../types/voting';
import coverHelldivers from '../assets/cover_helldivers.png';

export interface SteamSearchResultItem {
  id: number;
  name: string;
  tiny_image: string;
  header_image: string;
  price_formatted?: string;
}

// Built-in popular Steam games database for instant offline fallback
export const POPULAR_FALLBACK_GAMES: Game[] = [
  {
    id: 'helldivers2',
    appId: 553850,
    title: 'Helldivers 2',
    genre: 'Tirador Co-op / Acción',
    coverImage: coverHelldivers,
    description: 'Lucha por la Libertad a través de una galaxia hostil en este intenso juego de disparos cooperativo.',
  },
  {
    id: 'hades2',
    appId: 1145350,
    title: 'Hades II',
    genre: 'Roguelike / Acción Mitológica',
    coverImage: 'https://cdn.akamai.steamstatic.com/steam/apps/1145350/header.jpg',
    description: 'Ábrete paso más allá del Inframundo usando magia negra para enfrentarte al Titán del Tiempo.',
  },
  {
    id: 'eldenring',
    appId: 1245620,
    title: 'Elden Ring',
    genre: 'RPG de Acción / Souls-like',
    coverImage: 'https://cdn.akamai.steamstatic.com/steam/apps/1245620/header.jpg',
    description: 'Levántate, Sinluz, y déjate guiar por la gracia para esgrimir el poder del Círculo de Elden.',
  },
  {
    id: 'lethalcompany',
    appId: 1942280,
    title: 'Lethal Company',
    genre: 'Terror Co-op / Sobrevivencia',
    coverImage: 'https://cdn.akamai.steamstatic.com/steam/apps/1942280/header.jpg',
    description: 'Un juego de terror cooperativo sobre la recolección de chatarra en lunas abandonadas.',
  },
  {
    id: 'steam_1086940',
    appId: 1086940,
    title: "Baldur's Gate 3",
    genre: 'RPG de Rol / Fantasía',
    coverImage: 'https://cdn.akamai.steamstatic.com/steam/apps/1086940/header.jpg',
    description: 'Reúne a tu grupo y vuelve a los Reinos Olvidados en una historia de amistad y traición.',
  },
  {
    id: 'steam_730',
    appId: 730,
    title: 'Counter-Strike 2',
    genre: 'Tirador Táctico / FPS',
    coverImage: 'https://cdn.akamai.steamstatic.com/steam/apps/730/header.jpg',
    description: 'El juego de disparos táctico en primera persona referente mundial.',
  },
  {
    id: 'steam_1091500',
    appId: 1091500,
    title: 'Cyberpunk 2077',
    genre: 'RPG / Ciencia Ficción',
    coverImage: 'https://cdn.akamai.steamstatic.com/steam/apps/1091500/header.jpg',
    description: 'Un RPG de acción en mundo abierto ambientado en la megalópolis de Night City.',
  },
  {
    id: 'steam_2357570',
    appId: 2357570,
    title: 'Overwatch 2',
    genre: 'Hero Shooter / Co-op',
    coverImage: 'https://cdn.akamai.steamstatic.com/steam/apps/2357570/header.jpg',
    description: 'Un juego de acción por equipos ambientado en un futuro optimista.',
  },
  {
    id: 'steam_252490',
    appId: 252490,
    title: 'Rust',
    genre: 'Sobrevivencia Multijugador',
    coverImage: 'https://cdn.akamai.steamstatic.com/steam/apps/252490/header.jpg',
    description: 'El único objetivo en Rust es sobrevivir. Supera luchas como el hambre, la sed y el frío.',
  },
  {
    id: 'steam_1623730',
    appId: 1623730,
    title: 'Palworld',
    genre: 'Mundo Abierto / Sobrevivencia',
    coverImage: 'https://cdn.akamai.steamstatic.com/steam/apps/1623730/header.jpg',
    description: 'Colecciona misteriosas criaturas llamadas Pals y ponlas a trabajar o a luchar.',
  },
];

/**
 * Searches Steam Store API for games matching `term`.
 */
export async function searchSteamStore(query: string): Promise<SteamSearchResultItem[]> {
  const cleanTerm = query.trim();
  if (!cleanTerm || cleanTerm.length < 2) {
    return [];
  }

  // 1. Try real Steam Store API via CORS proxy
  try {
    const targetUrl = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(
      cleanTerm
    )}&l=spanish&cc=US`;
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

            return {
              id: item.id,
              name: item.name,
              tiny_image: tinyImg,
              header_image: headerImg,
              price_formatted: item.price?.final
                ? `$${(item.price.final / 100).toFixed(2)}`
                : 'Juego de Steam',
            };
          }
        );
      }
    }
  } catch (err) {
    console.warn('Steam Store API search error or CORS timeout, using fallback games database...', err);
  }

  // 2. Fallback: Local search over popular Steam games database
  const queryLower = cleanTerm.toLowerCase();
  return POPULAR_FALLBACK_GAMES.filter(
    (g) => g.title.toLowerCase().includes(queryLower) || g.genre.toLowerCase().includes(queryLower)
  ).map((g) => ({
    id: g.appId || Math.floor(Math.random() * 100000),
    name: g.title,
    tiny_image: g.coverImage,
    header_image: g.coverImage,
    price_formatted: g.genre,
  }));
}
