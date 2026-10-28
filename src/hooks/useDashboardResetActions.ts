import { useCallback } from 'react';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { FreezePriceState, Game, Voter, VotingHistoryRecord } from '../types/voting';
import {
  loadHistory,
  resetAllData,
  DEFAULT_FREEZE_STATE,
  type SyncState,
} from '../services/dataStore';
import { serializeDashboardState } from './useDashboardPersistence';

interface UseDashboardResetActionsOptions {
  canManageContent: boolean;
  isImportingRef: RefObject<boolean>;
  cancelPendingWritesAndDebounce: () => void;
  lastPersistedDashboardSignatureRef: RefObject<string>;
  lastPersistedApiKeyRef: RefObject<string>;
  setVoters: Dispatch<SetStateAction<Voter[]>>;
  setGamesMap: Dispatch<SetStateAction<Record<string, Game>>>;
  setSteamApiKey: Dispatch<SetStateAction<string>>;
  setHistory: Dispatch<SetStateAction<VotingHistoryRecord[]>>;
  setFreezeState: Dispatch<SetStateAction<FreezePriceState>>;
  setSyncState: Dispatch<SetStateAction<SyncState>>;
}

export function useDashboardResetActions({
  canManageContent,
  isImportingRef,
  cancelPendingWritesAndDebounce,
  lastPersistedDashboardSignatureRef,
  lastPersistedApiKeyRef,
  setVoters,
  setGamesMap,
  setSteamApiKey,
  setHistory,
  setFreezeState,
  setSyncState,
}: UseDashboardResetActionsOptions) {
  const handleResetAllVotes = useCallback(() => {
    if (!canManageContent || isImportingRef.current) return;

    const confirmReset = window.confirm(
      '¿Deseas reiniciar los votos de todos los integrantes para iniciar un nuevo ciclo de votación?\n\nLos puntos asignados volverán a 0 y el precio congelado se liberará automáticamente.'
    );
    if (!confirmReset) return;

    setVoters((prev) =>
      prev.map((voter) => ({
        ...voter,
        votes: voter.votes.map((vote) => ({ ...vote, points: 0 })),
      }))
    );
  }, [canManageContent, isImportingRef, setVoters]);

  const handleResetData = useCallback(async () => {
    if (!canManageContent || isImportingRef.current) return;
    if (!window.confirm('¿Deseas restablecer los datos originales de todos los integrantes y juegos?')) {
      return;
    }

    cancelPendingWritesAndDebounce();
    setSyncState({ status: 'saving', message: 'Restableciendo todos los datos...' });

    try {
      const result = await resetAllData();
      setSyncState(result);

      if (result.status === 'synced' || result.status === 'local') {
        lastPersistedDashboardSignatureRef.current = serializeDashboardState([], {}, DEFAULT_FREEZE_STATE);
        lastPersistedApiKeyRef.current = '';
        setVoters([]);
        setGamesMap({});
        setSteamApiKey('');
        setHistory([]);
        setFreezeState(DEFAULT_FREEZE_STATE);
      } else {
        throw new Error(result.message || 'No se pudieron restablecer los datos en la base de datos.');
      }
    } catch (err) {
      // Recuperación explícita: sincronizar el historial de la interfaz con Firestore tras fallo parcial.
      try {
        const freshHistory = await loadHistory();
        setHistory(freshHistory);
      } catch {
        // Ignorar el fallo secundario para conservar el mensaje del error principal.
      }

      const message = err instanceof Error ? err.message : 'Error al restablecer los datos';
      setSyncState({ status: 'error', message });
    }
  }, [
    canManageContent,
    isImportingRef,
    cancelPendingWritesAndDebounce,
    lastPersistedDashboardSignatureRef,
    lastPersistedApiKeyRef,
    setVoters,
    setGamesMap,
    setSteamApiKey,
    setHistory,
    setFreezeState,
    setSyncState,
  ]);

  return { handleResetAllVotes, handleResetData };
}

