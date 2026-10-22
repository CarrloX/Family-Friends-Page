import type { Voter, VotingHistoryRecord, AuraRank } from '../types/voting';

export const revertVoterFromSnapshot = (
  voter: Voter,
  snapshots: NonNullable<VotingHistoryRecord['votersSnapshots']>
): Voter => {
  const snap = snapshots.find((s) => s.voterId === voter.id);
  if (!snap) return voter;
  return {
    ...voter,
    auraQuotaBalance: snap.previousBalance,
    auraRank: snap.previousRank,
    multiplier: snap.previousMultiplier,
  };
};

export const buildRevertMap = (
  records: VotingHistoryRecord[]
): Map<string, { balance: number; rank: AuraRank; multiplier: number }> => {
  const reverts = new Map<string, { balance: number; rank: AuraRank; multiplier: number }>();
  for (const record of records) {
    if (!record.votersSnapshots) continue;
    for (const snap of record.votersSnapshots) {
      reverts.set(snap.voterId, {
        balance: snap.previousBalance,
        rank: snap.previousRank,
        multiplier: snap.previousMultiplier,
      });
    }
  }
  return reverts;
};

export const applyRevertToVoter = (
  voter: Voter,
  reverts: Map<string, { balance: number; rank: AuraRank; multiplier: number }>
): Voter => {
  const rev = reverts.get(voter.id);
  if (!rev) return voter;
  return {
    ...voter,
    auraQuotaBalance: rev.balance,
    auraRank: rev.rank,
    multiplier: rev.multiplier,
  };
};

export const computeRevertedVoters = (
  voters: Voter[],
  records: VotingHistoryRecord[]
): Voter[] => {
  const reverts = buildRevertMap(records);
  return voters.map((voter) => applyRevertToVoter(voter, reverts));
};

export const resetVoterAura = (voter: Voter): Voter => ({
  ...voter,
  auraQuotaBalance: 0,
  auraRank: 'Socio Regular',
  multiplier: 1.0,
});

export function reconcileVoterVotes(
  voters: Voter[],
  gameIds: string[]
): { changed: boolean; updatedVoters: Voter[] } {
  const validGameIds = new Set(gameIds);
  let changed = false;
  const updatedVoters = voters.map((voter) => {
    const validVotes = voter.votes.filter((v) => validGameIds.has(v.gameId));
    const existingGameIds = new Set(validVotes.map((v) => v.gameId));
    const missingGameIds = gameIds.filter((id) => !existingGameIds.has(id));

    if (validVotes.length !== voter.votes.length || missingGameIds.length > 0) {
      changed = true;
      return {
        ...voter,
        votes: [
          ...validVotes,
          ...missingGameIds.map((id) => ({ gameId: id, points: 0 })),
        ],
      };
    }
    return voter;
  });
  return { changed, updatedVoters };
}
