export type AuraRank =
  | 'Socio VIP'
  | 'Socio Regular'
  | 'En Observación'
  | 'Voto Mínimo'
  | 'Congelado'
  | 'VIP'
  | 'Regular'
  | 'Observación';

export const VOTING_TYPE_MARKER = true;

export interface Game {
  id: string;
  appId?: number;
  title: string;
  genre: string;
  coverImage: string;
  tinyCoverImage?: string;
  description: string;
}

export interface GameVote {
  gameId: string;
  points: number; // 0 = sin voto; el máximo depende de la cantidad de juegos (proporcional)
}

export interface Voter {
  id: string;
  steamId64?: string;
  name: string;
  avatar: string;
  auraRank: AuraRank;
  auraQuotaBalance: number; // e.g. +3, 0, -1, -3, -5
  multiplier: number;
  votes: GameVote[];
}

export interface GameResult {
  game: Game;
  rawPoints: number;
  weightedPoints: number;
  firstPlaceVotes: number;
}

export interface VoterSnapshotInHistory {
  voterId: string;
  name: string;
  avatar: string;
  paidQuota: boolean; // true = SÍ, false = NO
  previousBalance: number;
  newBalance: number;
  previousRank: AuraRank;
  newRank: AuraRank;
  previousMultiplier: number;
  newMultiplier: number;
  votes: GameVote[];
}

export interface VotingHistoryRecord {
  id: string;
  date: string;
  winningGame: Game;
  gamesMap: Record<string, Game>;
  /** Array dinámico de juegos propuestos en orden de la votación */
  games?: Game[];
  votersSnapshots: VoterSnapshotInHistory[];
  resultsSnapshot: GameResult[];
}

/**
 * Calcula la cantidad máxima de puntos que un votante puede asignar a un juego.
 * Con N juegos propuestos, el 1.er lugar recibe (N-1) puntos, el 2.º (N-2), etc.
 * Ejemplo: 6 juegos → máx 5 puntos; 3 juegos → máx 2 puntos.
 * El 0 siempre está disponible para indicar "sin voto".
 */
export function getMaxVotePoints(gameCount: number): number {
  return Math.max(1, gameCount - 1);
}

/**
 * Genera las opciones de puntos disponibles para un votante según la cantidad de juegos.
 * Devuelve un array de mayor a menor: [N-1, N-2, ..., 2, 1, 0]
 */
export function getVotePointOptions(gameCount: number): number[] {
  const max = getMaxVotePoints(gameCount);
  const options: number[] = [];
  for (let p = max; p >= 1; p--) {
    options.push(p);
  }
  options.push(0);
  return options;
}

/**
 * Calculates new Aura Rank, Multiplier, and Quota Balance based on Quota payment and rules:
 * - +3 or more: Socio VIP (1.5x)
 * - 0 to +2: Socio Regular (1.0x)
 * - -1 to -2: En Observación (0.75x)
 * - -3 to -4: Voto Mínimo (0.25x)
 * - -5 or lower: Congelado (0.0x)
 * - Direct Redemption: If previously 'Congelado' and pays quota (SÍ), jumps to 'En Observación' (-1, 0.75x)
 */
export function calculateAuraStatus(
  currentBalance: number,
  paidQuota: boolean,
  previousRank: AuraRank
): {
  newBalance: number;
  newRank: AuraRank;
  newMultiplier: number;
} {
  let newBalance = currentBalance + (paidQuota ? 1 : -1);

  // Direct Redemption Rule
  if ((previousRank === 'Congelado' || currentBalance <= -5) && paidQuota) {
    return {
      newBalance: -1,
      newRank: 'En Observación',
      newMultiplier: 0.75,
    };
  }

  let newRank: AuraRank;
  let newMultiplier = 1.0;

  if (newBalance >= 3) {
    newRank = 'Socio VIP';
    newMultiplier = 1.5;
  } else if (newBalance >= 0) {
    newRank = 'Socio Regular';
    newMultiplier = 1;
  } else if (newBalance >= -2) {
    newRank = 'En Observación';
    newMultiplier = 0.75;
  } else if (newBalance >= -4) {
    newRank = 'Voto Mínimo';
    newMultiplier = 0.25;
  } else {
    newRank = 'Congelado';
    newMultiplier = 0.0;
  }

  return { newBalance, newRank, newMultiplier };
}
