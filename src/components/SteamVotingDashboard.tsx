import React, { useState, useEffect, useMemo, useCallback, useRef, useSyncExternalStore } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Header } from './Header';
import { UserCard } from './UserCard';
import { WinnerBanner } from './WinnerBanner';
import { GameSearchEditor } from './GameSearchEditor';
import { InstallPrompt } from './InstallPrompt';
import { DashboardSkeleton } from './DashboardSkeleton';
import { DashboardGearButton, DashboardTopActionNavigation, DashboardHistoryFooterButton, DashboardModals } from './DashboardControls';
import { SyncIndicator } from './SyncIndicator';
import { InitialLoadErrorView } from './InitialLoadErrorView';
import { AdminSessionBadge } from './AdminSessionBadge';
import { EditModeTopBar } from './EditModeTopBar';

import { useAdminAuth } from '../hooks/useAdminAuth';
import { useVotersDragAndDrop } from '../hooks/useVotersDragAndDrop';
import { useDashboardPersistence, serializeDashboardState } from '../hooks/useDashboardPersistence';
import { useAutoUnfreezeWatcher } from '../hooks/useAutoUnfreezeWatcher';
import {
  computeRevertedVoters,
  reconcileVoterVotes,
  resetVoterAura,
  revertVoterFromSnapshot,
} from '../utils/votingStateHelpers';
import { calculateResults, removeGameFromVotingSession, addGameToVotingSession } from '../data/votingData';
import type { Voter, Game, VotingHistoryRecord, FreezePriceState, SteamPriceInfo } from '../types/voting';

import { formatCopPrice } from '../services/steamStoreApi';

function subscribeToMobileMediaQuery(callback: () => void) {
  const mql = window.matchMedia('(max-width: 768px)');
  mql.addEventListener('change', callback);
  return () => mql.removeEventListener('change', callback);
}

function getMobileSnapshot(): boolean {
  return typeof window !== 'undefined' ? window.innerWidth <= 768 : false;
}

function getMobileServerSnapshot(): boolean {
  return false;
}
import {
  saveActiveVotingState,
  saveFinishedVotingSession,
  saveFreezePriceState,
  unfreezePriceState,
  invalidatePendingWrites,
  loadVoters,
  loadHistory,
  clearHistory as clearHistoryStore,
  deleteHistoryRecord,
  resetAllData,
  createBackupData,
  downloadBackup,
  importBackup,
  DEFAULT_FREEZE_STATE,
} from '../services/dataStore';

const MIN_VOTERS = 2;
const MAX_VOTERS = 6;
const MIN_GAMES = 2;
const MAX_GAMES = 6;

function isValidPriceInfo(price?: SteamPriceInfo | null): price is SteamPriceInfo {
  if (!price) return false;
  return Boolean(
    price.isFree === true ||
    (typeof price.final === 'number' && !Number.isNaN(price.final))
  );
}

function buildFrozenPriceState(
  gameId: string,
  priceInfo: SteamPriceInfo
): FreezePriceState {
  const isFree = Boolean(priceInfo.isFree || priceInfo.final === 0);
  const finalPrice = isFree ? 0 : (priceInfo.final ?? 0);
  const discountPercent = priceInfo.discountPercent ?? 0;
  const formattedPrice = priceInfo.finalFormatted || (isFree ? 'Gratis' : formatCopPrice(finalPrice));
  const initialPrice = priceInfo.initial ?? finalPrice;
  const initialFormatted = priceInfo.initialFormatted ?? formattedPrice;

  return {
    isPrecioCongelado: true,
    precioCongelado: finalPrice,
    descuentoCongelado: discountPercent,
    precioCongeladoFormatted: formattedPrice,
    precioOriginalCongelado: initialPrice,
    precioOriginalCongeladoFormatted: initialFormatted,
    congeladoAt: new Date().toISOString(),
    gameId,
  };
}

// ─── Funciones auxiliares puras ───────────────────────────
function getVoterCountBadgeText(isEditMode: boolean, isMobile: boolean, count: number): string {
  if (!isEditMode) {
    return `${count} / ${MAX_VOTERS} Integrantes`;
  }
  return isMobile ? '⚙️ Editá integrantes y juegos' : '🖐️ Arrastrá tarjetas / Editá juegos arriba';
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



// ─── Componente principal ─────────────────────────────────
export const SteamVotingDashboard: React.FC = () => {
  const [voters, setVoters] = useState<Voter[]>([]);
  const [gamesMap, setGamesMap] = useState<Record<string, Game>>({});
  const [history, setHistory] = useState<VotingHistoryRecord[]>([]);
  const [steamApiKey, setSteamApiKey] = useState<string>('');
  const [freezeState, setFreezeState] = useState<FreezePriceState>(DEFAULT_FREEZE_STATE);
  const [isFreezingLoading, setIsFreezingLoading] = useState<boolean>(false);

  const [isEditMode, setIsEditMode] = useState<boolean>(false);
  const [isImporting, setIsImporting] = useState<boolean>(false);
  const [showFinishModal, setShowFinishModal] = useState<boolean>(false);
  const [showHistoryModal, setShowHistoryModal] = useState<boolean>(false);
  const [voterToDelete, setVoterToDelete] = useState<Voter | null>(null);
  const [showResetAuraConfirm, setShowResetAuraConfirm] = useState(false);

  const isImportingRef = useRef<boolean>(false);
  const isUnfreezingRef = useRef<boolean>(false);
  const importFileInputRef = useRef<HTMLInputElement | null>(null);

  const handleAdminReset = useCallback(() => {
    setShowFinishModal(false);
    setVoterToDelete(null);
    setShowResetAuraConfirm(false);
  }, []);

  const {
    adminAccess,
    canManageContent,
    showPinModal,
    requestAdminUnlockViaModal,
    handlePinSubmit,
    handleLogoutAdmin,
    handlePinCancel,
  } = useAdminAuth({
    isImportingRef,
    setIsEditMode,
    onAdminReset: handleAdminReset,
  });

  const isMobile = useSyncExternalStore(
    subscribeToMobileMediaQuery,
    getMobileSnapshot,
    getMobileServerSnapshot
  );

  const { getDragProps } = useVotersDragAndDrop(setVoters, isMobile, isImporting);

  const resetImportInput = useCallback(() => {
    if (importFileInputRef.current) {
      importFileInputRef.current.value = '';
    }
  }, []);


  const {
    initialLoadStatus,
    initialLoadErrorMessage,
    syncState,
    setSyncState,
    handleRetryInitialLoad,
    saveDebounceRef,
    lastPersistedDashboardSignatureRef,
    lastPersistedApiKeyRef,
    cancelPendingWritesAndDebounce,
  } = useDashboardPersistence({
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
  });

  const isLoading = initialLoadStatus === 'loading';

  // Auto-ocultar el indicador de sincronización tras 5 segundos al completarse o fallar
  useEffect(() => {
    if (syncState.status !== 'idle' && syncState.status !== 'saving') {
      const timer = setTimeout(() => {
        setSyncState({ status: 'idle', message: '' });
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [syncState, setSyncState]);


  // ─── Calcular resultados ─────────────────────────────────
  const results = useMemo(() => calculateResults(voters, gamesMap), [voters, gamesMap]);
  const hasWinner = results.length > 0 && Boolean(results[0]?.game);

  // ─── Calcular total de puntos asignados para determinar estado de votación ───
  const totalAssignedPoints = useMemo(() => {
    return voters.reduce((acc, voter) => {
      return acc + voter.votes.reduce((sum, vote) => sum + (vote.points || 0), 0);
    }, 0);
  }, [voters]);

  // Texto descriptivo del badge de integrantes según modo de edición y dispositivo
  const voterCountBadgeText = useMemo(
    () => getVoterCountBadgeText(isEditMode, isMobile, voters.length),
    [isEditMode, isMobile, voters.length]
  );

  // ─── Reconciliar votos de los integrantes con gamesMap (autocorregir desalineaciones/IDs huérfanos) ───
  useEffect(() => {
    if (initialLoadStatus !== 'loaded' || isImporting) return;
    const gameIds = Object.keys(gamesMap);
    if (gameIds.length === 0 || voters.length === 0) return;

    const { changed, updatedVoters } = reconcileVoterVotes(voters, gameIds);

    if (changed) {
      void Promise.resolve().then(() => {
        if (!isImportingRef.current) {
          setVoters(updatedVoters);
        }
      });
    }
  }, [gamesMap, voters, initialLoadStatus, isImporting]);

  // ─── Descongelado automático al iniciar o modificar nuevo ciclo de votación ───
  const autoUnfreezePrice = useCallback(async (reason: string) => {
    if (
      !canManageContent ||
      !freezeState.isPrecioCongelado ||
      isImportingRef.current ||
      isUnfreezingRef.current
    ) {
      return;
    }
    isUnfreezingRef.current = true;

    if (import.meta.env.DEV) {
      console.log(`[Dashboard] Descongelamiento automático: ${reason}`);
    }

    const previousFreezeState = freezeState;
    const resetFreezeState: FreezePriceState = {
      isPrecioCongelado: false,
      precioCongelado: null,
      descuentoCongelado: null,
      precioCongeladoFormatted: null,
      precioOriginalCongelado: null,
      precioOriginalCongeladoFormatted: null,
      congeladoAt: null,
      gameId: null,
    };

    setSyncState({ status: 'saving', message: `Descongelando precio (${reason})...` });

    try {
      const syncRes = await unfreezePriceState();

      if (syncRes.status === 'synced' || syncRes.status === 'local') {
        lastPersistedDashboardSignatureRef.current = serializeDashboardState(voters, gamesMap, resetFreezeState);
        setFreezeState(resetFreezeState);
        setSyncState({
          status: syncRes.status,
          message: `Precio descongelado (${reason})`,
        });
      } else {
        // Falló la persistencia (permisos insuficientes o rechazo remoto): restaurar estado anterior
        setFreezeState(previousFreezeState);
        setSyncState(syncRes);
        if (import.meta.env.DEV) {
          console.warn(`[Dashboard] Falló la descongelación automática de precio (${reason}):`, syncRes.message);
        }
      }
    } catch (err) {
      console.error(`[Dashboard] Excepción al descongelar precio automáticamente (${reason}):`, err);
      setFreezeState(previousFreezeState);
      setSyncState({
        status: 'error',
        message: `Error al descongelar precio (${reason})`,
      });
    } finally {
      isUnfreezingRef.current = false;
    }
  }, [canManageContent, freezeState, voters, gamesMap, lastPersistedDashboardSignatureRef, setSyncState]);

  // ─── Procedimiento para congelar el precio del juego ganador ───
  const freezePrice = useCallback(async (currentLivePrice: SteamPriceInfo | null): Promise<FreezePriceState | null> => {
    const winningResult = results[0];
    if (!winningResult?.game) {
      setSyncState({
        status: 'error',
        message: 'No hay un juego ganador seleccionado para congelar el precio',
      });
      return null;
    }

    const priceToFreeze = currentLivePrice || winningResult.game.price || null;
    if (!isValidPriceInfo(priceToFreeze)) {
      setSyncState({
        status: 'error',
        message: 'No se puede congelar el precio: no hay información de precio disponible para este juego',
      });
      return null;
    }

    const newFreezeState = buildFrozenPriceState(winningResult.game.id, priceToFreeze);
    setSyncState({ status: 'saving', message: 'Congelando precio...' });
    const syncRes = await saveFreezePriceState(newFreezeState);
    setSyncState(syncRes);

    if (syncRes.status !== 'synced' && syncRes.status !== 'local') {
      return null;
    }
    return newFreezeState;
  }, [results, setSyncState]);

  // ─── Procedimiento para descongelar el precio ───
  const unfreezePrice = useCallback(async (): Promise<boolean> => {
    setSyncState({ status: 'saving', message: 'Descongelando precio...' });
    const syncRes = await unfreezePriceState();
    setSyncState(syncRes);
    return syncRes.status === 'synced' || syncRes.status === 'local';
  }, [setSyncState]);

  // ─── Toggle interactivo de congelamiento de precio (Modo Edición) ───
  const handleToggleFreezePrice = useCallback(async (currentLivePrice: SteamPriceInfo | null) => {
    if (!canManageContent || isImportingRef.current) return;

    setIsFreezingLoading(true);
    const previousFreezeState = freezeState;

    try {
      if (!previousFreezeState.isPrecioCongelado) {
        const frozenState = await freezePrice(currentLivePrice);
        if (frozenState) {
          lastPersistedDashboardSignatureRef.current = serializeDashboardState(voters, gamesMap, frozenState);
          setFreezeState(frozenState);
        } else {
          setFreezeState(previousFreezeState);
        }
      } else {
        const success = await unfreezePrice();
        if (success) {
          lastPersistedDashboardSignatureRef.current = serializeDashboardState(voters, gamesMap, DEFAULT_FREEZE_STATE);
          setFreezeState(DEFAULT_FREEZE_STATE);
        } else {
          setFreezeState(previousFreezeState);
        }
      }
    } catch (err) {
      console.error('[Dashboard] Error al alternar congelamiento de precio:', err);
      setFreezeState(previousFreezeState);
      setSyncState({ status: 'error', message: 'Error al cambiar estado de precio congelado' });
    } finally {
      setIsFreezingLoading(false);
    }
  }, [canManageContent, freezeState, freezePrice, lastPersistedDashboardSignatureRef, voters, gamesMap, unfreezePrice, setSyncState]);

  useAutoUnfreezeWatcher(
    isImporting ? 'loading' : initialLoadStatus,
    canManageContent && !isImporting,
    gamesMap,
    results,
    freezeState,
    totalAssignedPoints,
    autoUnfreezePrice
  );

  // ─── Handlers ─────────────────────────────────────────────
  const handleUpdateVoter = useCallback((updatedVoter: Voter) => {
    if (!canManageContent || isImportingRef.current) return;
    setVoters((prev) => prev.map((v) => (v.id === updatedVoter.id ? updatedVoter : v)));
  }, [canManageContent]);

  const handleUpdateGame = useCallback((gameId: string, updatedGame: Game) => {
    if (!canManageContent || isImportingRef.current) return;
    setGamesMap((prev) => ({
      ...prev,
      [gameId]: updatedGame,
    }));
    if (freezeState.isPrecioCongelado) {
      void autoUnfreezePrice('juego modificado');
    }
  }, [canManageContent, freezeState.isPrecioCongelado, autoUnfreezePrice]);

  const handleAddGame = useCallback(() => {
    if (!canManageContent || isImportingRef.current) return;

    const transition = addGameToVotingSession(gamesMap, voters, MAX_GAMES);
    if (!transition.success) return;

    setGamesMap(transition.gamesMap);
    setVoters(transition.voters);
  }, [canManageContent, gamesMap, voters]);

  const handleDeleteGame = useCallback((gameId: string) => {
    if (!canManageContent || isImportingRef.current) return;

    const transition = removeGameFromVotingSession(gamesMap, voters, gameId, MIN_GAMES);
    if (!transition.success) return;

    setGamesMap(transition.gamesMap);
    setVoters(transition.voters);
  }, [canManageContent, gamesMap, voters]);

  const handleResetAllVotes = useCallback(() => {
    if (!canManageContent || isImportingRef.current) return;
    const confirmReset = window.confirm(
      '¿Deseas reiniciar los votos de todos los integrantes para iniciar un nuevo ciclo de votación?\n\nLos puntos asignados volverán a 0 y el precio congelado se liberará automáticamente.'
    );
    if (!confirmReset) return;

    setVoters((prev) =>
      prev.map((voter) => ({
        ...voter,
        votes: voter.votes.map((v) => ({ ...v, points: 0 })),
      }))
    );
  }, [canManageContent]);

  const handleToggleEditMode = useCallback(() => {
    if (isImportingRef.current) return;
    if (!canManageContent) {
      // Desbloqueo asíncrono vía modal BottomSheet
      void requestAdminUnlockViaModal().then((unlocked) => {
        if (unlocked) {
          setIsEditMode((prev) => !prev);
        }
      });
      return;
    }

    setIsEditMode((prev) => !prev);
  }, [canManageContent, requestAdminUnlockViaModal]);

  const handleConfirmFinishVoting = useCallback(async (
    updatedVoters: Voter[],
    historyRecord: VotingHistoryRecord
  ) => {
    if (!canManageContent || isImportingRef.current) return;
    // 1. Cancelar temporizador pendiente e invalidar escrituras en vuelo en el servicio de persistencia
    if (saveDebounceRef.current) {
      clearTimeout(saveDebounceRef.current);
    }
    invalidatePendingWrites();

    setSyncState({ status: 'saving', message: 'Guardando votación...' });

    // 2. Guardado atómico unificado: historial + nuevos saldos Aura en un solo writeBatch de Firestore
    const result = await saveFinishedVotingSession(historyRecord, updatedVoters, gamesMap);
    setSyncState(result);

    // 3. Si la persistencia fue exitosa (remota o fallback local), reflejar el nuevo estado en la interfaz
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
      lastPersistedDashboardSignatureRef.current = serializeDashboardState(updatedVoters, gamesMap, resetFreeze);

      setVoters(updatedVoters);
      setHistory((prev) => [historyRecord, ...prev]);
      setFreezeState(resetFreeze);
      setShowFinishModal(false);
    } else {
      throw new Error(
        result.message || 'No se pudo guardar la votación. No se aplicaron los cambios en los datos.'
      );
    }
  }, [canManageContent, gamesMap, lastPersistedDashboardSignatureRef, saveDebounceRef, setSyncState]);

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
        lastPersistedDashboardSignatureRef.current = serializeDashboardState(updatedVoters, gamesMap, freezeState);
        setVoters(updatedVoters);
        setHistory([]);
      } else {
        throw new Error(result.message || 'No se pudo limpiar el historial.');
      }
    } catch (err) {
      // Recuperación explícita: sincronizar la interfaz con Firestore tras fallo parcial o total
      try {
        const [freshVoters, freshHistory] = await Promise.all([loadVoters(), loadHistory()]);
        if (freshVoters && freshVoters.length > 0) {
          lastPersistedDashboardSignatureRef.current = serializeDashboardState(freshVoters, gamesMap, freezeState);
          setVoters(freshVoters);
        }
        setHistory(freshHistory);
      } catch {
        // Ignorar fallo secundario de recarga para conservar el mensaje del error principal
      }
      const message = err instanceof Error ? err.message : 'Error al limpiar el historial';
      setSyncState({ status: 'error', message });
      throw err;
    }
  }, [canManageContent, saveDebounceRef, setSyncState, history, voters, lastPersistedDashboardSignatureRef, gamesMap, freezeState]);

  const handleDeleteHistoryRecord = useCallback(async (recordId: string) => {
    if (!canManageContent || isImportingRef.current) return;
    const recordToDelete = history.find((r) => r.id === recordId);
    if (!recordToDelete) {
      setSyncState({ status: 'error', message: 'Registro de votación no encontrado' });
      return;
    }

    // Regla de integridad crítica: Solo se permite eliminar o deshacer la votación más reciente (LIFO)
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
      // 1. Calcular los votantes con su estado revertido a partir de los snapshots de este registro
      const updatedVoters = recordToDelete.votersSnapshots
        ? voters.map((voter) => revertVoterFromSnapshot(voter, recordToDelete.votersSnapshots!))
        : voters;

      // 2. Persistir atómicamente la eliminación del registro y la restauración de miembros
      const result = await deleteHistoryRecord(recordId, updatedVoters);
      setSyncState(result);

      // 3. Modificar el estado local ÚNICAMENTE cuando la persistencia haya finalizado con éxito
      if (result.status === 'synced' || result.status === 'local') {
        lastPersistedDashboardSignatureRef.current = serializeDashboardState(updatedVoters, gamesMap, freezeState);
        setVoters(updatedVoters);
        setHistory((prev) => prev.filter((r) => r.id !== recordId));
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
  }, [canManageContent, history, saveDebounceRef, setSyncState, voters, lastPersistedDashboardSignatureRef, gamesMap, freezeState]);

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
      // Recuperación explícita: sincronizar el historial de la interfaz con Firestore tras fallo parcial
      try {
        const freshHistory = await loadHistory();
        setHistory(freshHistory);
      } catch {
        // Ignorar fallo secundario de recarga para conservar el mensaje del error principal
      }
      const message = err instanceof Error ? err.message : 'Error al restablecer los datos';
      setSyncState({ status: 'error', message });
    }
  }, [canManageContent, cancelPendingWritesAndDebounce, lastPersistedApiKeyRef, lastPersistedDashboardSignatureRef, setSyncState]);

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
        lastPersistedDashboardSignatureRef.current = serializeDashboardState(updatedVoters, gamesMap, freezeState);
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
  }, [canManageContent, saveDebounceRef, voters, setSyncState, gamesMap, freezeState, lastPersistedDashboardSignatureRef]);

  const handleAddVoter = () => {
    if (!canManageContent || isImportingRef.current || voters.length >= MAX_VOTERS) return;
    const randomBytes = new Uint8Array(6);
    crypto.getRandomValues(randomBytes);
    const randomSuffix = Array.from(randomBytes).map((b) => b.toString(16).padStart(2, '0')).join('');
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
  };

  const handleRequestDeleteVoter = (voter: Voter) => {
    if (!canManageContent || isImportingRef.current) return;
    setVoterToDelete(voter);
  };

  const handleConfirmDeleteVoter = () => {
    if (!canManageContent || isImportingRef.current || !voterToDelete) return;
    if (voters.length <= MIN_VOTERS) {
      setVoterToDelete(null);
      return;
    }
    setVoters((prev) => prev.filter((v) => v.id !== voterToDelete.id));
    setVoterToDelete(null);
  };

  const handleCancelDeleteVoter = () => {
    setVoterToDelete(null);
  };

  // ─── Backup: Exportar ─────────────────────────────────────
  const handleExportBackup = () => {
    if (!canManageContent || isImportingRef.current) return;
    const backup = createBackupData(voters, gamesMap, history, steamApiKey);
    downloadBackup(backup);
    setSyncState({ status: 'synced', message: 'Backup exportado ✅' });
  };

  // ─── Backup: Importar ─────────────────────────────────────
  const handleImportClick = () => {
    if (!canManageContent || isImportingRef.current) return;
    importFileInputRef.current?.click();
  };

  const handleImportFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
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

    // ÚNICAMENTE tras confirmación afirmativa del usuario:
    // Cancelar modales abiertos, temporizadores de autoguardado e iniciar estado exclusivo de importación
    setVoterToDelete(null);
    setShowResetAuraConfirm(false);
    setShowFinishModal(false);
    cancelPendingWritesAndDebounce();
    setIsImporting(true);
    isImportingRef.current = true;

    try {
      setSyncState({ status: 'saving', message: 'Importando y sincronizando backup...' });
      const result = await importBackup(file);

      // 2. Comprobar el estado devuelto por el servicio para evitar mostrar éxito si es de solo lectura o error
      if (result.syncState.status === 'read-only' || result.syncState.status === 'error') {
        setSyncState(result.syncState);
        return;
      }

      // 3. Aplicar el estado importado y reflejar fielmente el syncState retornado por el servicio
      lastPersistedDashboardSignatureRef.current = serializeDashboardState(result.voters, result.gamesMap, DEFAULT_FREEZE_STATE);
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
  };



  // ─── Loading state ────────────────────────────────────────
  if (initialLoadStatus === 'loading') {
    return <DashboardSkeleton />;
  }

  // ─── Error state: No se pudo cargar la información inicial ───
  if (initialLoadStatus === 'error') {
    return (
      <InitialLoadErrorView
        syncState={syncState}
        errorMessage={initialLoadErrorMessage}
        onRetry={() => void handleRetryInitialLoad()}
      />
    );
  }

  // ─── Render principal ─────────────────────────────────────
  return (
    <div className="steam-dashboard-container">
      <div className="bg-gradient-overlay"></div>
      <div className="bg-grid-lines"></div>

      <SyncIndicator syncState={syncState} />

      <InstallPrompt />

      <DashboardGearButton
        canManageContent={canManageContent}
        isEditMode={isEditMode}
        isImporting={isImporting}
        onToggleEditMode={handleToggleEditMode}
      />

      <AdminSessionBadge adminAccess={adminAccess} onLogout={handleLogoutAdmin} />

      <DashboardTopActionNavigation
        canManageContent={canManageContent}
        hasWinner={hasWinner}
        isImporting={isImporting}
        onOpenFinishModal={() => {
          if (!canManageContent || isImporting) return;
          setShowFinishModal(true);
        }}
      />

      {/* Barra de edición */}
      <AnimatePresence>
        {canManageContent && isEditMode && (
          <EditModeTopBar
            voterCount={voters.length}
            maxVoters={MAX_VOTERS}
            steamApiKey={steamApiKey}
            onApiKeyChange={setSteamApiKey}
            onAddVoter={handleAddVoter}
            onExportBackup={handleExportBackup}
            onImportClick={handleImportClick}
            onImportFileChange={handleImportFileChange}
            importFileInputRef={importFileInputRef}
            isSaving={syncState.status === 'saving'}
            isImporting={isImporting}
            onResetAllVotes={handleResetAllVotes}
            onResetData={handleResetData}
            onOpenResetAuraConfirm={() => setShowResetAuraConfirm(true)}
            onCloseEditMode={() => setIsEditMode(false)}
          />
        )}
      </AnimatePresence>

      {/* Contenido principal */}
      <div className="dashboard-content">
        <Header isVotingInProgress={isLoading ? undefined : totalAssignedPoints === 0} />

        <AnimatePresence>
          {canManageContent && isEditMode && (
            <motion.div
              key="game-search-editor-view"
              initial={{ opacity: 0, y: -15, height: 0 }}
              animate={{ opacity: 1, y: 0, height: 'auto' }}
              exit={{ opacity: 0, y: -15, height: 0 }}
              transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            >
              <GameSearchEditor
                gamesMap={gamesMap}
                onUpdateGame={handleUpdateGame}
                onAddGame={handleAddGame}
                onDeleteGame={handleDeleteGame}
                minGames={MIN_GAMES}
                maxGames={MAX_GAMES}
                disabled={isImporting}
              />
            </motion.div>
          )}
        </AnimatePresence>

        <section className="voters-section">
          <div className="section-title-wrapper">
            <h2 className="section-title">
              <span className="title-icon">🎮</span> VOTACIONES DE PARTICIPANTES
            </h2>
            <span className="voter-count-badge">
              {voterCountBadgeText}
            </span>
          </div>

          <div className="user-cards-grid">
            <AnimatePresence mode="popLayout">
              {voters.map((voter, index) => (
                <UserCard
                  key={voter.id}
                  voter={voter}
                  gamesMap={gamesMap}
                  isEditMode={isEditMode}
                  apiKey={steamApiKey}
                  onUpdateVoter={handleUpdateVoter}
                  onRequestDelete={handleRequestDeleteVoter}
                  canDelete={voters.length > MIN_VOTERS}
                  disabled={isImporting}
                  {...getDragProps(index)}
                />
              ))}
            </AnimatePresence>
          </div>
        </section>

        <WinnerBanner
          results={results}
          votersCount={voters.length}
          totalAssignedPoints={totalAssignedPoints}
          isEditMode={isEditMode}
          canManageContent={canManageContent}
          isPrecioCongelado={freezeState.isPrecioCongelado}
          precioCongelado={freezeState.precioCongelado}
          descuentoCongelado={freezeState.descuentoCongelado}
          precioCongeladoFormatted={freezeState.precioCongeladoFormatted}
          onToggleFreezePrice={handleToggleFreezePrice}
          isFreezingLoading={isFreezingLoading || isImporting}
        />

        <DashboardHistoryFooterButton
          isImporting={isImporting}
          onOpenHistoryModal={() => setShowHistoryModal(true)}
        />

        <footer className="steam-footer">
          <p>© 2026 Steam Co-Op Game Voting • Diseñado con paleta oficial de Steam & Acentos Neón</p>
        </footer>
      </div>

      <DashboardModals
        showFinishModal={showFinishModal}
        hasWinner={hasWinner}
        results={results}
        voters={voters}
        freezeState={freezeState}
        onConfirmFinish={handleConfirmFinishVoting}
        onCloseFinishModal={() => setShowFinishModal(false)}
        showHistoryModal={showHistoryModal}
        history={history}
        onClearHistory={handleClearHistory}
        onDeleteHistoryRecord={handleDeleteHistoryRecord}
        onCloseHistoryModal={() => setShowHistoryModal(false)}
        canManageContent={canManageContent}
        voterToDelete={voterToDelete}
        onCancelDeleteVoter={handleCancelDeleteVoter}
        onConfirmDeleteVoter={handleConfirmDeleteVoter}
        showResetAuraConfirm={showResetAuraConfirm}
        onConfirmResetAura={handleResetAllAura}
        onCancelResetAura={() => setShowResetAuraConfirm(false)}
        showPinModal={showPinModal}
        onPinCancel={handlePinCancel}
        onPinSubmit={handlePinSubmit}
      />
    </div>
  );
};

export default SteamVotingDashboard;
