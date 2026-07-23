export type AuraRank = 'VIP' | 'Regular' | 'Observación';

export const VOTING_TYPE_MARKER = true;


export interface Game {
  id: string;
  title: string;
  genre: string;
  coverImage: string;
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
  multiplier: number;
  votes: GameVote[];
}

export interface GameResult {
  game: Game;
  rawPoints: number;
  weightedPoints: number;
  firstPlaceVotes: number;
}
