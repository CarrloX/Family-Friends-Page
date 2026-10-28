import { useCallback } from 'react';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { FreezePriceState, Game, Voter, VotingHistoryRecord } from '../types/voting';
import {
  clearHistory as clearHistoryStore,
  deleteHistoryRecord,
  invalidatePendingWrites,
  loadHistory,
  loadVoters,
  saveActiveVotingState,
  saveFinishedVotingSession,
  type SyncState,
} from '../services/dataStore';
import {
  computeRevertedVoters,
  resetVoterAura,
  revertVoterFromSnapshot,
} from '../utils/votingStateHelpers';
import { serializeDashboardState } from './useDashboardPersistence';

interface UseVotingHistoryActionsOptions {
  canManageContent: boolean;
  isImportingRef: RefObject<boolean>;
  saveDebounceRef: RefObject<ReturnType<typeof setTimeout> | null>;
  history: VotingHistoryRecord[];
  voters: Voter[];
  gamesMap: Record<string, Game>;
  freezeState: FreezePriceState;
  setVoters: Dispatch<SetStateAction<Voter[]>>;
  setHistory: Dispatch<SetStateAction<VotingHistoryRecord[]>>;
  setFreezeState: Dispatch<SetStateAction<FreezePriceState>>;
  setShowFinishModal: Dispatch<SetStateAction<boolean>>;
  setShowResetAuraConfirm: Dispatch<SetStateAction<boolean>>;
  setSyncState: Dispatch<SetStateAction<SyncState>>;
  lastPersistedDashboardSignatureRef: RefObject<string>;
}

export function useVotingHistoryActions({
  canManageContent,
  isImportingRef,
  saveDebounceRef,
  history,
  voters,
  gamesMap,
  freezeState,
  setVoters,
  setHistory,
  setFreezeState,
  setShowFinishModal,
  setShowResetAuraConfirm,
  setSyncState,
  lastPersistedDashboardSignatureRef,
}: UseVotingHistoryActionsOptions) {
  const handleConfirmFinishVoting = useCallback(async (
    updatedVoters: Voter[],
    historyRecord: VotingHistoryRecord
  ) => {
    if (!canManageContent || isImportingRef.current) return;

    // Cancelar el debounce pendiente e invalidar escrituras en vuelo.
    if (saveDebounceRef.current) {
      clearTimeout(saveDebounceRef.current);
    }
    invalidatePendingWrites();

    setSyncState({ status: 'saving', message: 'Guardando votación...' });

    // Guardado atómico del historial y los saldos Aura.
    const result = await saveFinishedVotingSession(historyRecord, updatedVoters, gamesMap);
    setSyncState(result);

    if (result.status === 'synced' || result.status === 'local') {
      const resetFreeze: FreezePriceState = {
        isPrecioCongelado: false,
        precioCongelado: null,
        descuentoCongelado: null,
        precioCongeladoFormatted: null,
        precioOriginalCongelado: null,
        precioOriginalCongeladoFormatted: null,
        congeladoAt: null,
        gameId: null,
      };

      lastPersistedDashboardSignatureRef.current = serializeDashboardState(
        updatedVoters,
        gamesMap,
        resetFreeze
      );
      setVoters(updatedVoters);
      setHistory((prev) => [historyRecord, ...prev]);
      setFreezeState(resetFreeze);
      setShowFinishModal(false);
    } else {
      throw new Error(
        result.message || 'No se pudo guardar la votación. No se aplicaron los cambios en los datos.'
      );
    }
  }, [
    canManageContent,
    isImportingRef,
    saveDebounceRef,
    gamesMap,
    lastPersistedDashboardSignatureRef,
    setSyncState,
    setVoters,
    setHistory,
    setFreezeState,
    setShowFinishModal,
  ]);

  const handleClearHistory = useCallback(async () => {
    if (!canManageContent || isImportingRef.current) return;

    if (saveDebounceRef.current) {
      clearTimeout(saveDebounceRef.current);
    }
    invalidatePendingWrites();

    setSyncState({ status: 'saving', message: 'Limpiando historial y restaurando Aura...' });

    try {
      const updatedVoters = history.length > 0 ? computeRevertedVoters(voters, history) : voters;
      const result = await clearHistoryStore(updatedVoters);
      setSyncState(result);

      if (result.status === 'synced' || result.status === 'local') {
        lastPersistedDashboardSignatureRef.current = serializeDashboardState(
          updatedVoters,
          gamesMap,
          freezeState
        );
        setVoters(updatedVoters);
        setHistory([]);
      } else {
        throw new Error(result.message || 'No se pudo limpiar el historial.');
      }
    } catch (err) {
      // Intentar recuperar la interfaz desde la persistencia sin reemplazar el error original.
      try {
        const [freshVoters, freshHistory] = await Promise.all([loadVoters(), loadHistory()]);
        if (freshVoters && freshVoters.length > 0) {
          lastPersistedDashboardSignatureRef.current = serializeDashboardState(
            freshVoters,
            gamesMap,
            freezeState
          );
          setVoters(freshVoters);
        }
        setHistory(freshHistory);
      } catch {
        // Conservar el error principal si la recuperación secundaria también falla.
      }

      const message = err instanceof Error ? err.message : 'Error al limpiar el historial';
      setSyncState({ status: 'error', message });
      throw err;
    }
  }, [
    canManageContent,
    isImportingRef,
    saveDebounceRef,
    setSyncState,
    history,
    voters,
    lastPersistedDashboardSignatureRef,
    gamesMap,
    freezeState,
    setVoters,
    setHistory,
  ]);

  const handleDeleteHistoryRecord = useCallback(async (recordId: string) => {
    if (!canManageContent || isImportingRef.current) return;

    const recordToDelete = history.find((record) => record.id === recordId);
    if (!recordToDelete) {
      setSyncState({ status: 'error', message: 'Registro de votación no encontrado' });
      return;
    }

    // Solo se permite eliminar o deshacer la votación más reciente (LIFO).
    if (history.length > 0 && history[0].id !== recordId) {
      const errorMsg = 'Solo se puede eliminar la votación más reciente para garantizar la integridad y coherencia del historial y de Aura.';
      setSyncState({ status: 'error', message: errorMsg });
      throw new Error(errorMsg);
    }

    if (saveDebounceRef.current) {
      clearTimeout(saveDebounceRef.current);
    }
    invalidatePendingWrites();

    setSyncState({ status: 'saving', message: 'Eliminando registro y restaurando Aura...' });

    try {
      const updatedVoters = recordToDelete.votersSnapshots
        ? voters.map((voter) => revertVoterFromSnapshot(voter, recordToDelete.votersSnapshots!))
        : voters;

      const result = await deleteHistoryRecord(recordId, updatedVoters);
      setSyncState(result);

      if (result.status === 'synced' || result.status === 'local') {
        lastPersistedDashboardSignatureRef.current = serializeDashboardState(
          updatedVoters,
          gamesMap,
          freezeState
        );
        setVoters(updatedVoters);
        setHistory((prev) => prev.filter((record) => record.id !== recordId));
      } else {
        throw new Error(
          result.message || 'No se pudo eliminar el registro en la base de datos. No se alteró el estado local.'
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al eliminar el registro del historial';
      setSyncState({ status: 'error', message });
      throw err;
    }
  }, [
    canManageContent,
    isImportingRef,
    history,
    saveDebounceRef,
    setSyncState,
    voters,
    lastPersistedDashboardSignatureRef,
    gamesMap,
    freezeState,
    setVoters,
    setHistory,
  ]);

  const handleResetAllAura = useCallback(async () => {
    if (!canManageContent || isImportingRef.current) return;

    if (saveDebounceRef.current) {
      clearTimeout(saveDebounceRef.current);
    }
    invalidatePendingWrites();

    const previousVoters = voters;
    const updatedVoters = voters.map(resetVoterAura);

    setSyncState({ status: 'saving', message: 'Restableciendo Aura de todos los integrantes...' });

    try {
      const result = await saveActiveVotingState(updatedVoters, gamesMap, freezeState);
      setSyncState(result);

      if (result.status === 'synced' || result.status === 'local') {
        lastPersistedDashboardSignatureRef.current = serializeDashboardState(
          updatedVoters,
          gamesMap,
          freezeState
        );
        setVoters(updatedVoters);
        setShowResetAuraConfirm(false);
      } else {
        setVoters(previousVoters);
        throw new Error(result.message || 'No se pudo restablecer el Aura en la persistencia.');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al restablecer Aura';
      setSyncState({ status: 'error', message });
      setVoters(previousVoters);
      throw err;
    }
  }, [
    canManageContent,
    isImportingRef,
    saveDebounceRef,
    voters,
    setSyncState,
    gamesMap,
    freezeState,
    lastPersistedDashboardSignatureRef,
    setVoters,
    setShowResetAuraConfirm,
  ]);

  return {
    handleConfirmFinishVoting,
    handleClearHistory,
    handleDeleteHistoryRecord,
    handleResetAllAura,
  };
}

