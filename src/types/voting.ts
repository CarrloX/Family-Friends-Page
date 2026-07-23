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
  points: 3 | 2 | 1 | 0;
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
  votersSnapshots: VoterSnapshotInHistory[];
  resultsSnapshot: GameResult[];
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

  let newRank: AuraRank = 'Socio Regular';
  let newMultiplier = 1.0;

  if (newBalance >= 3) {
    newRank = 'Socio VIP';
    newMultiplier = 1.5;
  } else if (newBalance >= 0) {
    newRank = 'Socio Regular';
    newMultiplier = 1.0;
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
