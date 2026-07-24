/**
 * Service to fetch user profile details from Steam API via SteamID64.
 * Includes CORS proxy fallback and mock fallback if no API key or network fails.
 */

export interface SteamProfileResult {
  success: boolean;
  personaname?: string;
  avatarfull?: string;
  steamId64: string;
  error?: string;
}

// Default fallback avatar data URI (sleek gamer silhouette)
export const DEFAULT_FALLBACK_AVATAR = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 24 24" fill="none" stroke="%23a855f7" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect width="24" height="24" fill="%230f0f1b"/><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;

// Pre-configured mock profiles for popular/demo SteamID64s to make testing instant without an API key
const MOCK_STEAM_PROFILES: Record<string, { personaname: string; avatarfull: string }> = {
  '76561198000000001': {
    personaname: 'Viper_Steam',
    avatarfull: 'https://avatars.steamstatic.com/c666579294d13e3146430349bc98ab647e30dd43_full.jpg',
  },
  '76561198000000002': {
    personaname: 'Nebula_Gamer',
    avatarfull: 'https://avatars.steamstatic.com/fef49e7fa7e1997310d705b2a615858dc1cdfeb5_full.jpg',
  },
  '76561198000000003': {
    personaname: 'Ghost_Operative',
    avatarfull: 'https://avatars.steamstatic.com/d41a7d65373a3885d519b5b2a615858dc1cdfeb5_full.jpg',
  },
  '76561198000000004': {
    personaname: 'Pixel_Master',
    avatarfull: 'https://avatars.steamstatic.com/a42b10a26d24666f286812836248384918239014_full.jpg',
  },
  '76561198000000005': {
    personaname: 'Rookie_Pro',
    avatarfull: 'https://avatars.steamstatic.com/53018e6ff050868f7636e05ff6bc5d34208a0d92_full.jpg',
  },
};

/**
 * Validates whether string looks like a standard 17-digit SteamID64
 */
export function isValidSteamId64(steamId: string): boolean {
  return /^\d{17}$/.test(steamId.trim());
}

/**
 * Attempts to fetch a Steam profile using the provided API key via CORS proxy.
 * Returns the profile result on success, or null on failure.
 */
async function fetchFromSteamApi(apiKey: string, steamId: string): Promise<SteamProfileResult | null> {
  try {
    const targetUrl = `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=${apiKey}&steamids=${steamId}`;
    const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`;
    const response = await fetch(proxyUrl);
    if (!response.ok) return null;
    const data = await response.json();
    const player = data?.response?.players?.[0];
    if (!player) return null;
    const avatarUrl = player.avatarfull || player.avatarmedium || player.avatar;
    console.log(`[SteamApi] Avatar URL obtenida (API Key): ${avatarUrl}`);
    return {
      success: true,
      steamId64: steamId,
      personaname: player.personaname,
      avatarfull: avatarUrl,
    };
  } catch {
    console.warn('Steam API direct fetch failed, attempting open proxy fallback...');
    return null;
  }
}

/**
 * Attempts to fetch a Steam profile using the public DEMO key via CORS proxy.
 * Returns the profile result on success, or null on failure.
 */
async function fetchFromPublicProxy(steamId: string): Promise<SteamProfileResult | null> {
  try {
    const publicUrl = `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=DEMO&steamids=${steamId}`;
    const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(publicUrl)}`;
    const response = await fetch(proxyUrl, { signal: AbortSignal.timeout(3000) });
    if (!response.ok) return null;
    const data = await response.json();
    const player = data?.response?.players?.[0];
    if (!player?.personaname) return null;
    const avatarUrl = player.avatarfull || player.avatarmedium;
    console.log(`[SteamApi] Avatar URL obtenida (proxy público): ${avatarUrl}`);
    return {
      success: true,
      steamId64: steamId,
      personaname: player.personaname,
      avatarfull: avatarUrl,
    };
  } catch {
    console.warn('Open proxy fallback timed out or failed.');
    return null;
  }
}

/**
 * Main fetcher function for Steam Profile Info
 */
export async function fetchSteamProfile(
  steamId64: string,
  apiKey?: string
): Promise<SteamProfileResult> {
  const cleanId = steamId64.trim();

  if (!cleanId) {
    return {
      success: false,
      steamId64: cleanId,
      error: 'Ingresa un SteamID64 válido.',
    };
  }

  // 1. Check if mock profile exists for instant testing
  if (MOCK_STEAM_PROFILES[cleanId]) {
    const mockProfile = MOCK_STEAM_PROFILES[cleanId];
    console.log(`[SteamApi] Usando mock profile: ${mockProfile.personaname}, avatar: ${mockProfile.avatarfull}`);
    return {
      success: true,
      steamId64: cleanId,
      ...mockProfile,
    };
  }

  // 2. Try fetching from Steam API if API Key provided
  if (apiKey?.trim()) {
    const result = await fetchFromSteamApi(apiKey.trim(), cleanId);
    if (result) return result;
  }

  // 3. Open CORS fallback fetch attempt
  const fallbackResult = await fetchFromPublicProxy(cleanId);
  if (fallbackResult) return fallbackResult;

  // 4. Fallback response (doesn't break interface)
  console.log(`[SteamApi] Usando fallback por defecto para ${cleanId}`);
  return {
    success: false,
    steamId64: cleanId,
    personaname: `Usuario_${cleanId.slice(-4)}`,
    avatarfull: DEFAULT_FALLBACK_AVATAR,
    error: apiKey
      ? 'No se pudo obtener el perfil de Steam. Se usaron datos por defecto.'
      : 'Steam API Key no configurada o bloqueo CORS. Se usará avatar/nombre por defecto.',
  };
}