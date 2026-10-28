import { useCallback } from 'react';
import type { ChangeEvent, Dispatch, RefObject, SetStateAction } from 'react';
import type { FreezePriceState, Game, Voter, VotingHistoryRecord } from '../types/voting';
import {
  createBackupData,
  downloadBackup,
  importBackup,
  DEFAULT_FREEZE_STATE,
  type SyncState,
} from '../services/dataStore';
import { serializeDashboardState } from './useDashboardPersistence';

interface UseDashboardBackupOptions {
  canManageContent: boolean;
  isImportingRef: RefObject<boolean>;
  setIsImporting: Dispatch<SetStateAction<boolean>>;
  importFileInputRef: RefObject<HTMLInputElement | null>;
  voters: Voter[];
  gamesMap: Record<string, Game>;
  history: VotingHistoryRecord[];
  steamApiKey: string;
  freezeState: FreezePriceState;
  setVoters: Dispatch<SetStateAction<Voter[]>>;
  setGamesMap: Dispatch<SetStateAction<Record<string, Game>>>;
  setHistory: Dispatch<SetStateAction<VotingHistoryRecord[]>>;
  setSteamApiKey: Dispatch<SetStateAction<string>>;
  setFreezeState: Dispatch<SetStateAction<FreezePriceState>>;
  setSyncState: Dispatch<SetStateAction<SyncState>>;
  setVoterToDelete: Dispatch<SetStateAction<Voter | null>>;
  setShowResetAuraConfirm: Dispatch<SetStateAction<boolean>>;
  setShowFinishModal: Dispatch<SetStateAction<boolean>>;
  cancelPendingWritesAndDebounce: () => void;
  lastPersistedDashboardSignatureRef: RefObject<string>;
  lastPersistedApiKeyRef: RefObject<string>;
}

function hasCurrentDashboardData(
  voters: Voter[],
  gamesMap: Record<string, Game>,
  history: VotingHistoryRecord[],
  steamApiKey: string,
  freezeState: FreezePriceState
): boolean {
  return (
    voters.length > 0 ||
    history.length > 0 ||
    Object.keys(gamesMap).length > 0 ||
    Boolean(steamApiKey && steamApiKey.trim().length > 0) ||
    Boolean(freezeState.isPrecioCongelado)
  );
}

function confirmBackupOverwrite(hasExistingData: boolean): boolean {
  if (!hasExistingData) return true;
  return window.confirm(
    '⚠️ Al importar un backup se sobrescribirán TODOS los datos actuales.\n\n¿Estás seguro de continuar?'
  );
}

function getErrorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

export function useDashboardBackup({
  canManageContent,
  isImportingRef,
  setIsImporting,
  importFileInputRef,
  voters,
  gamesMap,
  history,
  steamApiKey,
  freezeState,
  setVoters,
  setGamesMap,
  setHistory,
  setSteamApiKey,
  setFreezeState,
  setSyncState,
  setVoterToDelete,
  setShowResetAuraConfirm,
  setShowFinishModal,
  cancelPendingWritesAndDebounce,
  lastPersistedDashboardSignatureRef,
  lastPersistedApiKeyRef,
}: UseDashboardBackupOptions) {
  const resetImportInput = useCallback(() => {
    if (importFileInputRef.current) {
      importFileInputRef.current.value = '';
    }
  }, [importFileInputRef]);

  const handleExportBackup = useCallback(() => {
    if (!canManageContent || isImportingRef.current) return;
    const backup = createBackupData(voters, gamesMap, history, steamApiKey);
    downloadBackup(backup);
    setSyncState({ status: 'synced', message: 'Backup exportado ✅' });
  }, [canManageContent, isImportingRef, voters, gamesMap, history, steamApiKey, setSyncState]);

  const handleImportClick = useCallback(() => {
    if (!canManageContent || isImportingRef.current) return;
    importFileInputRef.current?.click();
  }, [canManageContent, isImportingRef, importFileInputRef]);

  const handleImportFileChange = useCallback(async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!canManageContent || isImportingRef.current) {
      resetImportInput();
      return;
    }

    const hasData = hasCurrentDashboardData(voters, gamesMap, history, steamApiKey, freezeState);
    if (!confirmBackupOverwrite(hasData)) {
      resetImportInput();
      return;
    }

    // Solo tras la confirmación, cancelar tareas pendientes y bloquear temporalmente la edición.
    setVoterToDelete(null);
    setShowResetAuraConfirm(false);
    setShowFinishModal(false);
    cancelPendingWritesAndDebounce();
    setIsImporting(true);
    isImportingRef.current = true;

    try {
      setSyncState({ status: 'saving', message: 'Importando y sincronizando backup...' });
      const result = await importBackup(file);

      if (result.syncState.status === 'read-only' || result.syncState.status === 'error') {
        setSyncState(result.syncState);
        return;
      }

      lastPersistedDashboardSignatureRef.current = serializeDashboardState(
        result.voters,
        result.gamesMap,
        DEFAULT_FREEZE_STATE
      );
      lastPersistedApiKeyRef.current = result.steamApiKey;
      setVoters(result.voters);
      setGamesMap(result.gamesMap);
      setHistory(result.history);
      setSteamApiKey(result.steamApiKey);
      setFreezeState(DEFAULT_FREEZE_STATE);
      setSyncState(result.syncState);
    } catch (err) {
      const errorMsg = getErrorMessage(err, 'Error desconocido al importar el backup');
      console.error('[Dashboard] Error al importar backup:', err);
      setSyncState({ status: 'error', message: `❌ ${errorMsg}` });
    } finally {
      setIsImporting(false);
      isImportingRef.current = false;
      resetImportInput();
    }
  }, [
    canManageContent,
    isImportingRef,
    resetImportInput,
    voters,
    gamesMap,
    history,
    steamApiKey,
    freezeState,
    setVoterToDelete,
    setShowResetAuraConfirm,
    setShowFinishModal,
    cancelPendingWritesAndDebounce,
    setIsImporting,
    setSyncState,
    lastPersistedDashboardSignatureRef,
    lastPersistedApiKeyRef,
    setVoters,
    setGamesMap,
    setHistory,
    setSteamApiKey,
    setFreezeState,
  ]);

  return {
    handleExportBackup,
    handleImportClick,
    handleImportFileChange,
  };
}

