import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { Voter, Game, VotingHistoryRecord, FreezePriceState } from '../types/voting';
import {
  saveActiveVotingState,
  invalidatePendingWrites,
  loadInitialDashboardData,
  type InitialDashboardData,
  saveApiKey,
  type SyncState,
} from '../services/dataStore';

const DEBOUNCE_MS = 800;

export function serializeDashboardState(
  voters: Voter[],
  gamesMap: Record<string, Game>,
  freezeState: FreezePriceState
): string {
  const sortedGameKeys = Object.keys(gamesMap).sort((a, b) => a.localeCompare(b));
  const sortedGames: Record<string, Game> = {};

  for (const key of sortedGameKeys) {
    sortedGames[key] = gamesMap[key];
  }

  return JSON.stringify({
    voters,
    gamesMap: sortedGames,
    freezeState,
  });
}

interface UseDashboardPersistenceOptions {
  voters: Voter[];
  setVoters: Dispatch<SetStateAction<Voter[]>>;
  gamesMap: Record<string, Game>;
  setGamesMap: Dispatch<SetStateAction<Record<string, Game>>>;
  setHistory: Dispatch<SetStateAction<VotingHistoryRecord[]>>;
  steamApiKey: string;
  setSteamApiKey: Dispatch<SetStateAction<string>>;
  freezeState: FreezePriceState;
  setFreezeState: Dispatch<SetStateAction<FreezePriceState>>;
  canManageContent: boolean;
  isImporting: boolean;
  isImportingRef: RefObject<boolean>;
}

export function useDashboardPersistence({
  voters,
  setVoters,
  gamesMap,
  setGamesMap,
  setHistory,
  steamApiKey,
  setSteamApiKey,
  freezeState,
  setFreezeState,
  canManageContent,
  isImporting,
  isImportingRef,
}: UseDashboardPersistenceOptions) {
  const [initialLoadStatus, setInitialLoadStatus] = useState<'loading' | 'loaded' | 'error'>('loading');
  const [initialLoadErrorMessage, setInitialLoadErrorMessage] = useState<string>('');
  const [syncState, setSyncState] = useState<SyncState>({ status: 'idle', message: '' });

  const isMountedRef = useRef<boolean>(true);
  const saveDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const apiKeyDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPersistedDashboardSignatureRef = useRef<string>('');
  const lastPersistedApiKeyRef = useRef<string>('');

  const cancelPendingWritesAndDebounce = useCallback(() => {
    if (saveDebounceRef.current) {
      clearTimeout(saveDebounceRef.current);
    }
    if (apiKeyDebounceRef.current) {
      clearTimeout(apiKeyDebounceRef.current);
    }
    invalidatePendingWrites();
  }, []);

  const handleApplyInitialData = useCallback((data: InitialDashboardData) => {
    lastPersistedDashboardSignatureRef.current = serializeDashboardState(
      data.voters,
      data.gamesMap,
      data.freezeState
    );
    lastPersistedApiKeyRef.current = data.apiKey;
    setVoters(data.voters);
    setGamesMap(data.gamesMap);
    setHistory(data.history);
    setSteamApiKey(data.apiKey);
    setFreezeState(data.freezeState);

    setInitialLoadStatus('loaded');
    setSyncState({
      status: 'synced',
      message: data.hasExistingData ? 'Datos cargados' : 'Sesión iniciada (sin datos previos)',
    });
  }, [setVoters, setGamesMap, setHistory, setSteamApiKey, setFreezeState]);

  const handleInitialLoadError = useCallback((err: unknown) => {
    console.error('[Dashboard] Error en carga inicial:', err);
    const message = err instanceof Error ? err.message : 'Error al conectar con la base de datos remota';
    setInitialLoadStatus('error');
    setInitialLoadErrorMessage(message);
    setSyncState({ status: 'error', message: 'Error al cargar datos remotos' });
  }, []);

  useEffect(() => {
    let ignore = false;
    void loadInitialDashboardData().then(
      (data) => {
        if (ignore) return;
        handleApplyInitialData(data);
      },
      (err: unknown) => {
        if (ignore) return;
        handleInitialLoadError(err);
      }
    );
    return () => {
      ignore = true;
    };
  }, [handleApplyInitialData, handleInitialLoadError]);

  const handleRetryInitialLoad = useCallback(async () => {
    setInitialLoadStatus('loading');
    setInitialLoadErrorMessage('');
    setSyncState({ status: 'saving', message: 'Reintentando conexión...' });

    try {
      const data = await loadInitialDashboardData();
      if (!isMountedRef.current) return;
      handleApplyInitialData(data);
    } catch (err) {
      if (!isMountedRef.current) return;
      handleInitialLoadError(err);
    }
  }, [handleApplyInitialData, handleInitialLoadError]);

  const debouncedSaveDashboard = useCallback(
    (votersToSave: Voter[], gamesToSave: Record<string, Game>, currentFreezeState: FreezePriceState) => {
      if (saveDebounceRef.current) {
        clearTimeout(saveDebounceRef.current);
      }
      if (isImportingRef.current) {
        return;
      }

      const currentSignature = serializeDashboardState(votersToSave, gamesToSave, currentFreezeState);
      if (currentSignature === lastPersistedDashboardSignatureRef.current) {
        return;
      }

      void Promise.resolve().then(() => {
        if (isMountedRef.current && !isImportingRef.current) {
          setSyncState({ status: 'saving', message: 'Guardando...' });
        }
      });

      saveDebounceRef.current = setTimeout(async () => {
        try {
          if (isImportingRef.current) return;
          const result = await saveActiveVotingState(votersToSave, gamesToSave, currentFreezeState);
          if (isMountedRef.current && !isImportingRef.current) {
            if (result.status === 'synced' || result.status === 'local') {
              lastPersistedDashboardSignatureRef.current = currentSignature;
            }
            if (result.status !== 'idle') {
              setSyncState(result);
            }
          }
        } catch (err) {
          if (isMountedRef.current && !isImportingRef.current) {
            console.error('[Dashboard] Error en guardado automático:', err);
            setSyncState({ status: 'error', message: 'Error en sincronización automática' });
          }
        }
      }, DEBOUNCE_MS);
    },
    [isImportingRef]
  );

  const debouncedSaveApiKey = useCallback((apiKey: string) => {
    if (apiKeyDebounceRef.current) {
      clearTimeout(apiKeyDebounceRef.current);
    }
    if (isImportingRef.current) {
      return;
    }
    if (apiKey === lastPersistedApiKeyRef.current) {
      return;
    }

    apiKeyDebounceRef.current = setTimeout(() => {
      try {
        if (isImportingRef.current) return;
        if (isMountedRef.current) {
          saveApiKey(apiKey);
          lastPersistedApiKeyRef.current = apiKey;
        }
      } catch (err) {
        if (isMountedRef.current && !isImportingRef.current) {
          console.error('[Dashboard] Error guardando API key:', err);
          setSyncState({ status: 'error', message: 'Error al guardar la clave API' });
        }
      }
    }, DEBOUNCE_MS);
  }, [isImportingRef]);

  useEffect(() => {
    if (initialLoadStatus === 'loaded' && canManageContent && !isImporting) {
      debouncedSaveDashboard(voters, gamesMap, freezeState);
    }
  }, [voters, gamesMap, freezeState, initialLoadStatus, canManageContent, debouncedSaveDashboard, isImporting]);

  useEffect(() => {
    if (initialLoadStatus === 'loaded' && !isImporting) {
      debouncedSaveApiKey(steamApiKey);
    }
  }, [steamApiKey, initialLoadStatus, debouncedSaveApiKey, isImporting]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      cancelPendingWritesAndDebounce();
    };
  }, [cancelPendingWritesAndDebounce]);

  return {
    initialLoadStatus,
    initialLoadErrorMessage,
    syncState,
    setSyncState,
    handleRetryInitialLoad,
    saveDebounceRef,
    lastPersistedDashboardSignatureRef,
    lastPersistedApiKeyRef,
    cancelPendingWritesAndDebounce,
  };
}

export default useDashboardPersistence;
