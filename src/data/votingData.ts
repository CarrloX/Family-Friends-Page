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

