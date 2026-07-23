import type { Game, Voter, GameResult } from '../types/voting';

export function calculateResults(
  votersList: Voter[],
  gamesMap: Record<string, Game>
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
