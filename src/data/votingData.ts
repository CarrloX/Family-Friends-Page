import type { Game, Voter, GameResult } from '../types/voting';
import { getMaxVotePoints } from '../types/voting';

/**
 * Calcula y consolida las puntuaciones de cada juego propuesto en la votación.
 *
 * @contract PRECONDICIÓN Y GARANTÍA DE ORDENAMIENTO:
 * Retorna siempre la lista de resultados estrictamente ordenada de forma DESCENDENTE
 * por clasificación competitiva. Por contrato del sistema, el índice `[0]` representa
 * de forma unívoca y determinista el 1.er lugar (juego ganador):
 * 1. Puntos ponderados (`weightedPoints` descendente).
 * 2. Criterio de desempate 1: Cantidad de votos como favorito/1.er lugar (`firstPlaceVotes` descendente).
 * 3. Criterio de desempate 2: Puntos brutos (`rawPoints` descendente).
 * 4. Criterio de desempate 3: Orden alfabético por título (`game.title` ascendente) para garantizar total determinismo.
 */
export function calculateResults(
  votersList: Voter[],
  gamesMap: Record<string, Game>
): GameResult[] {
  const scoreMap: Record<string, { raw: number; weighted: number; firsts: number }> = {};

  Object.keys(gamesMap).forEach((gameId) => {
    scoreMap[gameId] = { raw: 0, weighted: 0, firsts: 0 };
  });

  // El máximo de puntos es proporcional a la cantidad de juegos propuestos.
  // Con N juegos, el favorito recibe N puntos.
  const maxPoints = getMaxVotePoints(Object.keys(gamesMap).length);

  votersList.forEach((voter) => {
    voter.votes.forEach((vote) => {
      if (scoreMap[vote.gameId]) {
        scoreMap[vote.gameId].raw += vote.points;
        scoreMap[vote.gameId].weighted += vote.points * voter.multiplier;
        if (vote.points === maxPoints) {
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
    .sort((a, b) => {
      // 1. Mayor puntaje ponderado
      if (b.weightedPoints !== a.weightedPoints) {
        return b.weightedPoints - a.weightedPoints;
      }
      // 2. Desempate por mayor cantidad de votos de primer lugar
      if (b.firstPlaceVotes !== a.firstPlaceVotes) {
        return b.firstPlaceVotes - a.firstPlaceVotes;
      }
      // 3. Desempate por mayor puntaje bruto
      if (b.rawPoints !== a.rawPoints) {
        return b.rawPoints - a.rawPoints;
      }
      // 4. Desempate lexicográfico para ordenación determinista garantizada
      return a.game.title.localeCompare(b.game.title);
    });
}

/**
 * Helper selector semántico para obtener el resultado ganador de forma segura
 * a partir de una lista de resultados clasificados.
 */
export function getWinningResult(results: GameResult[]): GameResult | undefined {
  return results.length > 0 ? results[0] : undefined;
}

export interface GameRemovalResult {
  success: boolean;
  gamesMap: Record<string, Game>;
  voters: Voter[];
}

/**
 * Transición atómica de dominio para eliminar un juego de la sesión de votación.
 * Garantiza que gamesMap y los votos de los integrantes se transformen en un único
 * paso coherente, ajustando proporcionalmente las puntuaciones de los votos restantes
 * al nuevo máximo permitido.
 */
export function removeGameFromVotingSession(
  gamesMap: Record<string, Game>,
  voters: Voter[],
  gameId: string,
  minGames: number
): GameRemovalResult {
  if (!gamesMap[gameId] || Object.keys(gamesMap).length <= minGames) {
    return { success: false, gamesMap, voters };
  }

  const nextGamesMap = { ...gamesMap };
  delete nextGamesMap[gameId];

  const newGameCount = Object.keys(nextGamesMap).length;
  const newMaxPoints = getMaxVotePoints(newGameCount);

  const nextVoters = voters.map((voter) => ({
    ...voter,
    votes: voter.votes
      .filter((v) => v.gameId !== gameId)
      .map((v) => ({
        ...v,
        points: Math.min(v.points, newMaxPoints),
      })),
  }));

  return {
    success: true,
    gamesMap: nextGamesMap,
    voters: nextVoters,
  };
}

export interface GameAdditionResult {
  success: boolean;
  gamesMap: Record<string, Game>;
  voters: Voter[];
  newGameId?: string;
}

/**
 * Transición atómica de dominio para agregar un juego a la sesión de votación.
 * Garantiza que gamesMap y los registros de votos de todos los votantes se inicialicen
 * sincronizadamente en un solo paso coherente.
 */
export function addGameToVotingSession(
  gamesMap: Record<string, Game>,
  voters: Voter[],
  maxGames: number,
  newGameData?: Partial<Game>
): GameAdditionResult {
  const currentCount = Object.keys(gamesMap).length;
  if (currentCount >= maxGames) {
    return { success: false, gamesMap, voters };
  }

  const randomBytes = new Uint8Array(6);
  crypto.getRandomValues(randomBytes);
  const randomSuffix = Array.from(randomBytes).map((b) => b.toString(16).padStart(2, '0')).join('');
  const newGameId = `game_${Date.now()}_${randomSuffix}`;

  const newGame: Game = {
    id: newGameId,
    title: newGameData?.title || `Nuevo Juego ${currentCount + 1}`,
    genre: newGameData?.genre || 'Por definir',
    coverImage:
      newGameData?.coverImage ||
      'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/730/capsule_sm_120.jpg',
    description: newGameData?.description || 'Buscá un juego en Steam o editá los campos manualmente.',
    ...newGameData,
  };

  const nextGamesMap = {
    ...gamesMap,
    [newGameId]: newGame,
  };

  const nextVoters = voters.map((voter) => ({
    ...voter,
    votes: [...voter.votes, { gameId: newGameId, points: 0 }],
  }));

  return {
    success: true,
    gamesMap: nextGamesMap,
    voters: nextVoters,
    newGameId,
  };
}

