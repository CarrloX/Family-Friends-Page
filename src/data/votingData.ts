import type { Game, Voter, GameResult } from '../types/voting';

import avatarViper from '../assets/avatar_viper.png';
import avatarNebula from '../assets/avatar_nebula.png';
import avatarGhost from '../assets/avatar_ghost.png';
import avatarPixel from '../assets/avatar_pixel.png';
import avatarRookie from '../assets/avatar_rookie.png';
import coverHelldivers from '../assets/cover_helldivers.png';

export const GAMES: Record<string, Game> = {
  helldivers2: {
    id: 'helldivers2',
    title: 'Helldivers 2',
    genre: 'Tirador Co-op / Acción',
    coverImage: coverHelldivers,
    description: 'Lucha por la Libertad a través de una galaxia hostil en este intenso juego de disparos cooperativo.',
  },
  hades2: {
    id: 'hades2',
    title: 'Hades II',
    genre: 'Roguelike / Acción Mitológica',
    coverImage: 'https://images.unsplash.com/photo-1578632767115-351597cf2477?w=600&auto=format&fit=crop&q=80',
    description: 'Ábrete paso más allá del Inframundo usando magia negra para enfrentarte al Titán del Tiempo.',
  },
  eldenring: {
    id: 'eldenring',
    title: 'Elden Ring',
    genre: 'RPG de Acción / Souls-like',
    coverImage: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=600&auto=format&fit=crop&q=80',
    description: 'Levántate, Sinluz, y déjate guiar por la gracia para esgrimir el poder del Círculo de Elden.',
  },
  lethalcompany: {
    id: 'lethalcompany',
    title: 'Lethal Company',
    genre: 'Terror Co-op / Sobrevivencia',
    coverImage: 'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=600&auto=format&fit=crop&q=80',
    description: 'Un juego de terror cooperativo sobre la recolección de chatarra en lunas abandonadas.',
  },
};

export const VOTERS: Voter[] = [
  {
    id: 'user_1',
    steamId64: '76561198000000001',
    name: 'Alex "Viper"',
    avatar: avatarViper,
    auraRank: 'VIP',
    multiplier: 1.5,
    votes: [
      { gameId: 'helldivers2', points: 3 },
      { gameId: 'hades2', points: 2 },
      { gameId: 'eldenring', points: 1 },
      { gameId: 'lethalcompany', points: 0 },
    ],
  },
  {
    id: 'user_2',
    steamId64: '76561198000000002',
    name: 'Elena "Nebula"',
    avatar: avatarNebula,
    auraRank: 'VIP',
    multiplier: 1.5,
    votes: [
      { gameId: 'helldivers2', points: 3 },
      { gameId: 'eldenring', points: 2 },
      { gameId: 'lethalcompany', points: 1 },
      { gameId: 'hades2', points: 0 },
    ],
  },
  {
    id: 'user_3',
    steamId64: '76561198000000003',
    name: 'Carlos "Ghost"',
    avatar: avatarGhost,
    auraRank: 'Regular',
    multiplier: 1.0,
    votes: [
      { gameId: 'eldenring', points: 3 },
      { gameId: 'helldivers2', points: 2 },
      { gameId: 'hades2', points: 1 },
      { gameId: 'lethalcompany', points: 0 },
    ],
  },
  {
    id: 'user_4',
    steamId64: '76561198000000004',
    name: 'Sofía "Pixel"',
    avatar: avatarPixel,
    auraRank: 'Regular',
    multiplier: 1.0,
    votes: [
      { gameId: 'hades2', points: 3 },
      { gameId: 'helldivers2', points: 2 },
      { gameId: 'lethalcompany', points: 1 },
      { gameId: 'eldenring', points: 0 },
    ],
  },
  {
    id: 'user_5',
    steamId64: '76561198000000005',
    name: 'Mateo "Rookie"',
    avatar: avatarRookie,
    auraRank: 'Observación',
    multiplier: 0.75,
    votes: [
      { gameId: 'helldivers2', points: 3 },
      { gameId: 'hades2', points: 2 },
      { gameId: 'eldenring', points: 1 },
      { gameId: 'lethalcompany', points: 0 },
    ],
  },
];

export function calculateResults(
  votersList: Voter[] = VOTERS,
  gamesMap: Record<string, Game> = GAMES
): GameResult[] {
  const scoreMap: Record<string, { raw: number; weighted: number; firsts: number }> = {};

  Object.keys(gamesMap).forEach((gameId) => {
    scoreMap[gameId] = { raw: 0, weighted: 0, firsts: 0 };
  });

  votersList.forEach((voter) => {
    voter.votes.forEach((vote) => {
      if (scoreMap[vote.gameId]) {
        scoreMap[vote.gameId].raw += vote.points;
        scoreMap[vote.gameId].weighted += vote.points * voter.multiplier;
        if (vote.points === 3) {
          scoreMap[vote.gameId].firsts += 1;
        }
      }
    });
  });

  return Object.keys(gamesMap)
    .map((gameId) => ({
      game: gamesMap[gameId],
      rawPoints: scoreMap[gameId]?.raw || 0,
      weightedPoints: Number((scoreMap[gameId]?.weighted || 0).toFixed(2)),
      firstPlaceVotes: scoreMap[gameId]?.firsts || 0,
    }))
    .filter((res) => Boolean(res.game))
    .sort((a, b) => b.weightedPoints - a.weightedPoints);
}
