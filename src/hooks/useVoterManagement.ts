import { useCallback } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { Voter, Game } from '../types/voting';

interface UseVoterManagementOptions {
  voters: Voter[];
  setVoters: Dispatch<SetStateAction<Voter[]>>;
  gamesMap: Record<string, Game>;
  canManageContent: boolean;
  isImportingRef: { current: boolean };
  voterToDelete: Voter | null;
  setVoterToDelete: Dispatch<SetStateAction<Voter | null>>;
  minVoters: number;
  maxVoters: number;
}

export function useVoterManagement({
  voters,
  setVoters,
  gamesMap,
  canManageContent,
  isImportingRef,
  voterToDelete,
  setVoterToDelete,
  minVoters,
  maxVoters,
}: UseVoterManagementOptions) {
  const handleAddVoter = useCallback(() => {
    if (!canManageContent || isImportingRef.current || voters.length >= maxVoters) return;

    const randomBytes = new Uint8Array(6);
    crypto.getRandomValues(randomBytes);
    const randomSuffix = Array.from(randomBytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    const newId = `voter_${Date.now()}_${randomSuffix}`;

    const newVoter: Voter = {
      id: newId,
      name: `Integrante ${voters.length + 1}`,
      avatar: 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/730/capsule_sm_120.jpg',
      auraRank: 'Socio Regular',
      auraQuotaBalance: 0,
      multiplier: 1.0,
      votes: Object.keys(gamesMap).map((gameId) => ({
        gameId,
        points: 0,
      })),
    };

    setVoters((prev) => [...prev, newVoter]);
  }, [canManageContent, isImportingRef, voters.length, gamesMap, maxVoters, setVoters]);

  const handleRequestDeleteVoter = useCallback((voter: Voter) => {
    if (!canManageContent || isImportingRef.current) return;
    setVoterToDelete(voter);
  }, [canManageContent, isImportingRef, setVoterToDelete]);

  const handleConfirmDeleteVoter = useCallback(() => {
    if (!canManageContent || isImportingRef.current || !voterToDelete) return;
    if (voters.length <= minVoters) {
      setVoterToDelete(null);
      return;
    }

    setVoters((prev) => prev.filter((v) => v.id !== voterToDelete.id));
    setVoterToDelete(null);
  }, [canManageContent, isImportingRef, voterToDelete, voters.length, minVoters, setVoterToDelete, setVoters]);

  const handleCancelDeleteVoter = useCallback(() => {
    setVoterToDelete(null);
  }, [setVoterToDelete]);

  return {
    handleAddVoter,
    handleRequestDeleteVoter,
    handleConfirmDeleteVoter,
    handleCancelDeleteVoter,
  };
}

