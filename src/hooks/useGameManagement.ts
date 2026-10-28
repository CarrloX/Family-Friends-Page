import { useCallback } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { Game, Voter } from '../types/voting';
import { addGameToVotingSession, removeGameFromVotingSession } from '../data/votingData';

interface UseGameManagementOptions {
  gamesMap: Record<string, Game>;
  voters: Voter[];
  setGamesMap: Dispatch<SetStateAction<Record<string, Game>>>;
  setVoters: Dispatch<SetStateAction<Voter[]>>;
  canManageContent: boolean;
  isImportingRef: { current: boolean };
  isPrecioCongelado: boolean;
  autoUnfreezePrice: (reason: string) => Promise<void>;
  minGames: number;
  maxGames: number;
}

export function useGameManagement({
  gamesMap,
  voters,
  setGamesMap,
  setVoters,
  canManageContent,
  isImportingRef,
  isPrecioCongelado,
  autoUnfreezePrice,
  minGames,
  maxGames,
}: UseGameManagementOptions) {
  const handleUpdateGame = useCallback((gameId: string, updatedGame: Game) => {
    if (!canManageContent || isImportingRef.current) return;

    setGamesMap((prev) => ({
      ...prev,
      [gameId]: updatedGame,
    }));

    if (isPrecioCongelado) {
      void autoUnfreezePrice('juego modificado');
    }
  }, [canManageContent, isImportingRef, setGamesMap, isPrecioCongelado, autoUnfreezePrice]);

  const handleAddGame = useCallback(() => {
    if (!canManageContent || isImportingRef.current) return;

    const transition = addGameToVotingSession(gamesMap, voters, maxGames);
    if (!transition.success) return;

    setGamesMap(transition.gamesMap);
    setVoters(transition.voters);
  }, [canManageContent, isImportingRef, gamesMap, voters, maxGames, setGamesMap, setVoters]);

  const handleDeleteGame = useCallback((gameId: string) => {
    if (!canManageContent || isImportingRef.current) return;

    const transition = removeGameFromVotingSession(gamesMap, voters, gameId, minGames);
    if (!transition.success) return;

    setGamesMap(transition.gamesMap);
    setVoters(transition.voters);
  }, [canManageContent, isImportingRef, gamesMap, voters, minGames, setGamesMap, setVoters]);

  return {
    handleUpdateGame,
    handleAddGame,
    handleDeleteGame,
  };
}

