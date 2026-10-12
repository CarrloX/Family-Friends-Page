import React, { useState, useEffect, useMemo, useCallback, useRef, useSyncExternalStore } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Header } from './Header';
import { UserCard } from './UserCard';
import { WinnerBanner } from './WinnerBanner';
import { GameSearchEditor } from './GameSearchEditor';
import { InstallPrompt } from './InstallPrompt';
import { FinishVotingModal } from './FinishVotingModal';
import { VotingHistoryModal } from './VotingHistoryModal';
import { DeleteUserConfirmModal } from './DeleteUserConfirmModal';
import { DashboardSkeleton } from './DashboardSkeleton';
import { AdminPinModal } from './AdminPinModal';
import { useModalFocusTrap } from '../hooks/useModalFocusTrap';
import { calculateResults } from '../data/votingData';
import type { Voter, Game, VotingHistoryRecord, AuraRank, FreezePriceState, SteamPriceInfo } from '../types/voting';
import { getMaxVotePoints } from '../types/voting';
import { FaCog } from "react-icons/fa";
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
  loadInitialDashboardData,
  type InitialDashboardData,
  clearHistory as clearHistoryStore,
  deleteHistoryRecord,
  resetAllData,
  saveApiKey,
  createBackupData,
  downloadBackup,
  importBackup,
  DEFAULT_FREEZE_STATE,
  type SyncState,
} from '../services/dataStore';
import {
  getAdminAccessState,
  loginAdminWithPassword,
  logoutAdmin,
  type AuthResult,
} from '../services/accessControl';
import { subscribeToAuthState } from '../services/firebaseConfig';

const MIN_VOTERS = 2;
const MAX_VOTERS = 6;
const MIN_GAMES = 2;
const MAX_GAMES = 6;
const DEBOUNCE_MS = 800;

// ─── Helpers para reducir anidación ────────────────────────
const revertVoterFromSnapshot = (
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

const buildRevertMap = (records: VotingHistoryRecord[]): Map<string, { balance: number; rank: AuraRank; multiplier: number }> => {
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

const applyRevertToVoter = (
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

const computeRevertedVoters = (
  voters: Voter[],
  records: VotingHistoryRecord[]
): Voter[] => {
  const reverts = buildRevertMap(records);
  return voters.map((voter) => applyRevertToVoter(voter, reverts));
};

const resetVoterAura = (voter: Voter): Voter => ({
  ...voter,
  auraQuotaBalance: 0,
  auraRank: 'Socio Regular',
  multiplier: 1.0,
});

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

// ─── Componente auxiliar: Modal de confirmación ───────────
interface ResetAuraConfirmModalProps {
  onConfirm: () => Promise<void> | void;
  onCancel: () => void;
}

const ResetAuraConfirmModal = ({
  onConfirm,
  onCancel,
}: ResetAuraConfirmModalProps) => {
  const [isResetting, setIsResetting] = useState(false);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);

  const modalRef = useModalFocusTrap<HTMLDivElement>({
    initialFocusRef: cancelButtonRef,
    onEscape: isResetting ? undefined : onCancel,
    disabled: isResetting,
    initialFocusDelay: 100,
  });

  const handleConfirm = async () => {
    if (isResetting) return;

    setIsResetting(true);

    try {
      await onConfirm();
    } finally {
      setIsResetting(false);
    }
  };

  return (
    <motion.div
      className="modal-backdrop bottom-sheet-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
      onClick={() => {
        if (!isResetting) {
          onCancel();
        }
      }}
    >
      <motion.div
        ref={modalRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="reset-aura-title"
        aria-describedby="reset-aura-description"
        className="delete-confirm-modal-container bottom-sheet-panel"
        initial={{ y: '100%', opacity: 0, scale: 0.95 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        exit={{ y: '100%', opacity: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 320, damping: 30 }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Handle visual superior estilo bottom sheet */}
        <div className="bottom-sheet-handle" aria-hidden="true"></div>
        <header className="modal-header">
          <div className="modal-title-group">
            <h2 id="reset-aura-title">
              <span aria-hidden="true">⚠️</span> Restablecer Aura
            </h2>
            <p>Esta acción no se puede deshacer fácilmente.</p>
          </div>
          <motion.button
            type="button"
            className="modal-close-btn"
            onClick={() => {
              if (!isResetting) {
                onCancel();
              }
            }}
            aria-label="Cerrar"
            disabled={isResetting}
            whileHover={isResetting ? {} : { scale: 1.15 }}
            whileTap={isResetting ? {} : { scale: 0.9 }}
          >✕</motion.button>
        </header>

        <div className="delete-warning-content">
          <section id="reset-aura-description" className="delete-warning-text">
            <p>¿Estás seguro de que deseas restablecer el <strong>Aura de todos los integrantes</strong>?</p>
            <p className="delete-warning-sub">
              Todos los integrantes volverán a ser <strong>Socio Regular</strong> con <strong>0 Cuotas</strong> y multiplicador <strong>1.0x</strong>.
            </p>
            <p className="delete-warning-note">
              <span aria-hidden="true">📊</span> <strong>Nota:</strong> Esta acción no afectará el historial de votaciones ni los juegos guardados. Solo se modificarán los niveles de Aura.
            </p>
          </section>
        </div>

        <footer className="modal-footer-actions delete-modal-actions">
          <motion.button
            ref={cancelButtonRef}
            type="button"
            className="btn-modal-cancel"
            onClick={() => {
              if (!isResetting) {
                onCancel();
              }
            }}
            disabled={isResetting}
            whileHover={isResetting ? {} : { scale: 1.03 }}
            whileTap={isResetting ? {} : { scale: 0.97 }}
          >Cancelar</motion.button>
          <motion.button
            type="button"
            className="btn-modal-confirm-delete"
            onClick={handleConfirm}
            disabled={isResetting}
            whileHover={isResetting ? {} : { scale: 1.03 }}
            whileTap={isResetting ? {} : { scale: 0.97 }}
          >
            {isResetting ? 'Restableciendo…' : 'Confirmar Restablecimiento'}
          </motion.button>
        </footer>
      </motion.div>
    </motion.div>
  );
};

const SYNC_STATUS_CONFIG: Record<string, { icon: string; className: string }> = {
  saving: { icon: '⏳', className: 'sync-indicator sync-saving' },
  synced: { icon: '✅', className: 'sync-indicator sync-synced' },
  error: { icon: '❌', className: 'sync-indicator sync-error' },
  local: { icon: '💾', className: 'sync-indicator sync-local' },
};

const SyncIndicator: React.FC<{ syncState: SyncState }> = ({ syncState }) => {
  const { status, message } = syncState;
  const isVisible = status !== 'idle';
  const config = SYNC_STATUS_CONFIG[status] ?? { icon: '✅', className: 'sync-indicator' };

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          key="sync-indicator"
          className={config.className}
          title={message}
          initial={{ opacity: 0, y: 12, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.95 }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
        >
          <span className="sync-icon">{config.icon}</span>
          <span className="sync-text">{message}</span>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

// ─── Funciones auxiliares puras ───────────────────────────
function reconcileVoterVotes(voters: Voter[], gameIds: string[]): { changed: boolean; updatedVoters: Voter[] } {
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

// ─── Componente principal ─────────────────────────────────
export const SteamVotingDashboard: React.FC = () => {
  const [voters, setVoters] = useState<Voter[]>([]);
  const [gamesMap, setGamesMap] = useState<Record<string, Game>>({});
  const [history, setHistory] = useState<VotingHistoryRecord[]>([]);
  const [steamApiKey, setSteamApiKey] = useState<string>('');
  const [freezeState, setFreezeState] = useState<FreezePriceState>(DEFAULT_FREEZE_STATE);
  const [isFreezingLoading, setIsFreezingLoading] = useState<boolean>(false);

  const [isEditMode, setIsEditMode] = useState<boolean>(false);
  const [showFinishModal, setShowFinishModal] = useState<boolean>(false);
  const [showHistoryModal, setShowHistoryModal] = useState<boolean>(false);
  const [adminAccess, setAdminAccess] = useState(() => getAdminAccessState());
  const [voterToDelete, setVoterToDelete] = useState<Voter | null>(null);
  const [showResetAuraConfirm, setShowResetAuraConfirm] = useState(false);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [initialLoadStatus, setInitialLoadStatus] = useState<'loading' | 'loaded' | 'error'>('loading');
  const [initialLoadErrorMessage, setInitialLoadErrorMessage] = useState<string>('');
  const isLoading = initialLoadStatus === 'loading';
  const [showPinModal, setShowPinModal] = useState<boolean>(false);

  const [syncState, setSyncState] = useState<SyncState>({ status: 'idle', message: '' });

  const isMobile = useSyncExternalStore(
    subscribeToMobileMediaQuery,
    getMobileSnapshot,
    getMobileServerSnapshot
  );

  // Auto-ocultar el indicador de sincronización tras 5 segundos al completarse o fallar
  useEffect(() => {
    if (syncState.status !== 'idle' && syncState.status !== 'saving') {
      const timer = setTimeout(() => {
        setSyncState({ status: 'idle', message: '' });
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [syncState]);

  // Suscripción en tiempo real al estado de autenticación de Firebase
  useEffect(() => {
    const unsubscribe = subscribeToAuthState(() => {
      setAdminAccess(getAdminAccessState());
    });
    return unsubscribe;
  }, []);

  const isMountedRef = useRef<boolean>(true);
  const saveDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const apiKeyDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipNextSaveRef = useRef<boolean>(false);
  const importFileInputRef = useRef<HTMLInputElement | null>(null);
  // Ref para resolver la Promise del modal de PIN y reutilizarla ante llamadas simultáneas
  const pinModalResolveRef = useRef<((value: boolean) => void) | null>(null);
  const pendingUnlockPromiseRef = useRef<Promise<boolean> | null>(null);

  // Limpieza al desmontar el componente: cancelar temporizadores e invalidar escrituras pendientes
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (saveDebounceRef.current) {
        clearTimeout(saveDebounceRef.current);
      }
      if (apiKeyDebounceRef.current) {
        clearTimeout(apiKeyDebounceRef.current);
      }
      invalidatePendingWrites();
      if (pinModalResolveRef.current) {
        pinModalResolveRef.current(false);
        pinModalResolveRef.current = null;
        pendingUnlockPromiseRef.current = null;
      }
    };
  }, []);

  const canManageContent = adminAccess.canManageContent;


  const handleApplyInitialData = useCallback((data: InitialDashboardData) => {
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
  }, []);

  const handleInitialLoadError = useCallback((err: unknown) => {
    console.error('[Dashboard] Error en carga inicial:', err);
    const message = err instanceof Error ? err.message : 'Error al conectar con la base de datos remota';
    setInitialLoadStatus('error');
    setInitialLoadErrorMessage(message);
    setSyncState({ status: 'error', message: 'Error al cargar datos remotos' });
  }, []);

  // ─── Carga inicial de datos con distinción explícita de error vs vacío ───
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

  useEffect(() => {
    if (!canManageContent && isEditMode) {
      void Promise.resolve().then(() => {
        setIsEditMode(false);
      });
    }
  }, [canManageContent, isEditMode]);

  // ─── Sincronización con debounce coordinado ──────────────
  const debouncedSaveDashboard = useCallback(
    (votersToSave: Voter[], gamesToSave: Record<string, Game>, currentFreezeState: FreezePriceState) => {
      if (saveDebounceRef.current) {
        clearTimeout(saveDebounceRef.current);
      }
      if (skipNextSaveRef.current) {
        skipNextSaveRef.current = false;
        return;
      }
      void Promise.resolve().then(() => {
        if (isMountedRef.current) {
          setSyncState({ status: 'saving', message: 'Guardando...' });
        }
      });
      saveDebounceRef.current = setTimeout(async () => {
        try {
          const result = await saveActiveVotingState(votersToSave, gamesToSave, currentFreezeState);
          if (isMountedRef.current && result.status !== 'idle') {
            setSyncState(result);
          }
        } catch (err) {
          if (isMountedRef.current) {
            console.error('[Dashboard] Error en guardado automático:', err);
            setSyncState({ status: 'error', message: 'Error en sincronización automática' });
          }
        }
      }, DEBOUNCE_MS);
    },
    []
  );

  const debouncedSaveApiKey = useCallback((apiKey: string) => {
    if (apiKeyDebounceRef.current) {
      clearTimeout(apiKeyDebounceRef.current);
    }
    apiKeyDebounceRef.current = setTimeout(() => {
      try {
        if (isMountedRef.current) {
          saveApiKey(apiKey);
        }
      } catch (err) {
        console.error('[Dashboard] Error guardando API key:', err);
      }
    }, DEBOUNCE_MS);
  }, []);

  useEffect(() => {
    if (initialLoadStatus === 'loaded' && canManageContent) {
      debouncedSaveDashboard(voters, gamesMap, freezeState);
    }
  }, [voters, gamesMap, freezeState, initialLoadStatus, canManageContent, debouncedSaveDashboard]);

  useEffect(() => {
    if (initialLoadStatus === 'loaded') {
      debouncedSaveApiKey(steamApiKey);
    }
  }, [steamApiKey, initialLoadStatus, debouncedSaveApiKey]);

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
  const voterCountBadgeText = useMemo(() => {
    if (!isEditMode) {
      return `${voters.length} / ${MAX_VOTERS} Integrantes`;
    }
    return isMobile ? '⚙️ Editá integrantes y juegos' : '🖐️ Arrastrá tarjetas / Editá juegos arriba';
  }, [isEditMode, isMobile, voters.length]);

  // ─── Reconciliar votos de los integrantes con gamesMap (autocorregir desalineaciones/IDs huérfanos) ───
  useEffect(() => {
    if (initialLoadStatus !== 'loaded') return;
    const gameIds = Object.keys(gamesMap);
    if (gameIds.length === 0 || voters.length === 0) return;

    const { changed, updatedVoters } = reconcileVoterVotes(voters, gameIds);

    if (changed) {
      void Promise.resolve().then(() => {
        setVoters(updatedVoters);
      });
    }
  }, [gamesMap, voters, initialLoadStatus]);

  // ─── Descongelado automático al iniciar o modificar nuevo ciclo de votación ───
  const autoUnfreezePrice = useCallback(async (reason: string) => {
    if (!canManageContent || !freezeState.isPrecioCongelado) return;

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
        skipNextSaveRef.current = true;
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
    }
  }, [canManageContent, freezeState]);

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
  }, [results]);

  // ─── Procedimiento para descongelar el precio ───
  const unfreezePrice = useCallback(async (): Promise<boolean> => {
    setSyncState({ status: 'saving', message: 'Descongelando precio...' });
    const syncRes = await unfreezePriceState();
    setSyncState(syncRes);
    return syncRes.status === 'synced' || syncRes.status === 'local';
  }, []);

  // ─── Toggle interactivo de congelamiento de precio (Modo Edición) ───
  const handleToggleFreezePrice = useCallback(async (currentLivePrice: SteamPriceInfo | null) => {
    if (!canManageContent) return;

    setIsFreezingLoading(true);
    const previousFreezeState = freezeState;

    try {
      if (!previousFreezeState.isPrecioCongelado) {
        const frozenState = await freezePrice(currentLivePrice);
        if (frozenState) {
          skipNextSaveRef.current = true;
          setFreezeState(frozenState);
        } else {
          setFreezeState(previousFreezeState);
        }
      } else {
        const success = await unfreezePrice();
        if (success) {
          skipNextSaveRef.current = true;
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
  }, [canManageContent, freezeState, freezePrice, unfreezePrice]);

  // ─── Watcher reactivo: Descongelado automático ante cambios en el ciclo de votación ───
  const prevGamesSignatureRef = useRef<string>('');
  const prevWinnerIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (initialLoadStatus !== 'loaded' || !canManageContent) return;

    const gameIds = Object.keys(gamesMap).sort((a, b) => a.localeCompare(b)).join(',');
    const winnerId = results[0]?.game?.id || null;

    if (!prevGamesSignatureRef.current) {
      prevGamesSignatureRef.current = gameIds;
      prevWinnerIdRef.current = winnerId;
      return;
    }

    // 1. Si la lista de juegos propuestos cambió
    if (freezeState.isPrecioCongelado && prevGamesSignatureRef.current !== gameIds) {
      void Promise.resolve().then(() => {
        void autoUnfreezePrice('cambio en lista de juegos');
      });
    }

    // 2. Si el juego ganador cambió
    if (
      freezeState.isPrecioCongelado &&
      freezeState.gameId &&
      winnerId &&
      freezeState.gameId !== winnerId
    ) {
      void Promise.resolve().then(() => {
        void autoUnfreezePrice('cambio de juego ganador');
      });
    }

    // 3. Si se limpiaron todos los votos de la sesión
    if (freezeState.isPrecioCongelado && totalAssignedPoints === 0) {
      void Promise.resolve().then(() => {
        void autoUnfreezePrice('votos reiniciados');
      });
    }

    prevGamesSignatureRef.current = gameIds;
    prevWinnerIdRef.current = winnerId;
  }, [gamesMap, results, freezeState.isPrecioCongelado, freezeState.gameId, totalAssignedPoints, initialLoadStatus, canManageContent, autoUnfreezePrice]);

  // ─── Handlers ─────────────────────────────────────────────
  const handleUpdateVoter = useCallback((updatedVoter: Voter) => {
    setVoters((prev) => prev.map((v) => (v.id === updatedVoter.id ? updatedVoter : v)));
  }, []);

  const handleUpdateGame = useCallback((gameId: string, updatedGame: Game) => {
    setGamesMap((prev) => ({
      ...prev,
      [gameId]: updatedGame,
    }));
    void autoUnfreezePrice('juego modificado');
  }, [autoUnfreezePrice]);

  const handleAddGame = useCallback(() => {
    const currentCount = Object.keys(gamesMap).length;
    if (currentCount >= MAX_GAMES) return;

    const randomBytes = new Uint8Array(6);
    crypto.getRandomValues(randomBytes);
    const randomSuffix = Array.from(randomBytes).map((b) => b.toString(16).padStart(2, '0')).join('');
    const newGameId = `game_${Date.now()}_${randomSuffix}`;

    const newGame: Game = {
      id: newGameId,
      title: `Nuevo Juego ${currentCount + 1}`,
      genre: 'Por definir',
      coverImage: 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/730/capsule_sm_120.jpg',
      description: 'Buscá un juego en Steam o editá los campos manualmente.',
    };

    setGamesMap((prev) => ({ ...prev, [newGameId]: newGame }));

    setVoters((prevVoters) =>
      prevVoters.map((voter) => ({
        ...voter,
        votes: [...voter.votes, { gameId: newGameId, points: 0 }],
      }))
    );
    void autoUnfreezePrice('nuevo juego agregado');
  }, [gamesMap, autoUnfreezePrice]);

  const handleDeleteGame = useCallback((gameId: string) => {
    setGamesMap((prev) => {
      const currentCount = Object.keys(prev).length;
      if (currentCount <= MIN_GAMES) return prev;

      const next = { ...prev };
      delete next[gameId];
      return next;
    });

    // Nuevo máximo de puntos después de eliminar el juego
    const newGameCount = Object.keys(gamesMap).length - 1;
    const newMaxPoints = getMaxVotePoints(newGameCount);

    // Quitar el voto del juego eliminado y ajustar (clamping) los puntos
    // de los votos restantes al nuevo máximo proporcional.
    setVoters((prevVoters) =>
      prevVoters.map((voter) => ({
        ...voter,
        votes: voter.votes
          .filter((v) => v.gameId !== gameId)
          .map((v) => ({
            ...v,
            points: Math.min(v.points, newMaxPoints),
          })),
      }))
    );
    void autoUnfreezePrice('juego eliminado');
  }, [gamesMap, autoUnfreezePrice]);

  const handleResetAllVotes = useCallback(() => {
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
    void autoUnfreezePrice('nuevo ciclo de votación / votos reiniciados');
  }, [autoUnfreezePrice]);

  // ─── Desbloqueo de admin vía modal BottomSheet (reemplaza window.prompt) ───
  const requestAdminUnlockViaModal = useCallback((forceOpen = false): Promise<boolean> => {
    const state = getAdminAccessState();
    // Si ya posee privilegios de administrador y no se fuerza abrir el modal, no necesita volver a identificarse
    if (state.isAdmin && !forceOpen) {
      return Promise.resolve(true);
    }

    // Reutilizar la promesa existente si el modal ya está abierto o hay una autenticación en curso
    if (pendingUnlockPromiseRef.current) {
      return pendingUnlockPromiseRef.current;
    }

    // Abre el modal de inicio de sesión de Firebase Auth y espera resolución
    const unlockPromise = new Promise<boolean>((resolve) => {
      pinModalResolveRef.current = resolve;
      setShowPinModal(true);
    });

    pendingUnlockPromiseRef.current = unlockPromise;
    return unlockPromise;
  }, []);

  // Si la URL contiene el parámetro ?admin=true y el usuario no tiene privilegios de admin,
  // solicitar automáticamente el desbloqueo mediante el modal
  useEffect(() => {
    const state = getAdminAccessState();
    if (state.requestedAdmin && !state.isAdmin) {
      void requestAdminUnlockViaModal(true);
    }
  }, [requestAdminUnlockViaModal]);

  // Handler cuando el usuario envía la contraseña en el modal
  const handlePinSubmit = useCallback(
    async (password: string): Promise<AuthResult> => {
      const result = await loginAdminWithPassword(password);
      if (result.success) {
        setAdminAccess(getAdminAccessState());
        setShowPinModal(false);
        const resolve = pinModalResolveRef.current;
        pinModalResolveRef.current = null;
        pendingUnlockPromiseRef.current = null;
        resolve?.(true);
      }
      return result;
    },
    []
  );

  const handleLogoutAdmin = useCallback(async () => {
    await logoutAdmin();
    setAdminAccess(getAdminAccessState());
    setIsEditMode(false);
  }, []);

  // Handler cuando el usuario cancela el modal de PIN
  const handlePinCancel = useCallback(() => {
    setShowPinModal(false);
    const resolve = pinModalResolveRef.current;
    pinModalResolveRef.current = null;
    pendingUnlockPromiseRef.current = null;
    resolve?.(false);
  }, []);

  // Atajo de teclado Shift + Alt + A (o Alt + Shift + A) para acceso de admin
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isKeyA = event.key === 'a' || event.key === 'A' || event.code === 'KeyA';
      const isAltShift = event.altKey && event.shiftKey;

      if (isAltShift && isKeyA) {
        event.preventDefault();
        event.stopPropagation();

        const state = getAdminAccessState();
        if (state.isAdmin) {
          // Si ya es administrador, alternar modo edición
          setIsEditMode((prev) => !prev);
        } else {
          // Si no es administrador, abrir inmediatamente el modal de identificación
          void requestAdminUnlockViaModal(true);
        }
      }
    };

    // Usar capture phase para asegurar recepción antes de que otros elementos intercepten
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [requestAdminUnlockViaModal]);

  const handleToggleEditMode = useCallback(() => {
    if (!canManageContent) {
      // Desbloqueo asíncrono vía modal BottomSheet
      void requestAdminUnlockViaModal().then((unlocked) => {
        setAdminAccess(getAdminAccessState());
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
      // Evitar que el setState de React dispare un re-guardado redundante por debounce
      skipNextSaveRef.current = true;

      setVoters(updatedVoters);
      setHistory((prev) => [historyRecord, ...prev]);
      setFreezeState({
        isPrecioCongelado: false,
        precioCongelado: null,
        descuentoCongelado: null,
        precioCongeladoFormatted: null,
        precioOriginalCongelado: null,
        precioOriginalCongeladoFormatted: null,
        congeladoAt: null,
        gameId: null,
      });
      setShowFinishModal(false);
    } else {
      throw new Error(
        result.message || 'No se pudo guardar la votación. No se aplicaron los cambios en los datos.'
      );
    }
  }, [gamesMap]);

  const handleClearHistory = useCallback(async () => {
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
        skipNextSaveRef.current = true;
        setVoters(updatedVoters);
        setHistory([]);
      } else {
        throw new Error(result.message || 'No se pudo limpiar el historial.');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al limpiar el historial';
      setSyncState({ status: 'error', message });
      throw err;
    }
  }, [history, voters]);

  const handleDeleteHistoryRecord = useCallback(async (recordId: string) => {
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

    // 1. Calcular los votantes con su estado revertido a partir de los snapshots de este registro
    const updatedVoters = recordToDelete.votersSnapshots
      ? voters.map((voter) => revertVoterFromSnapshot(voter, recordToDelete.votersSnapshots!))
      : voters;

    // 2. Persistir atómicamente la eliminación del registro y la restauración de miembros
    const result = await deleteHistoryRecord(recordId, updatedVoters);
    setSyncState(result);

    // 3. Modificar el estado local ÚNICAMENTE cuando la persistencia haya finalizado con éxito
    if (result.status === 'synced' || result.status === 'local') {
      skipNextSaveRef.current = true;
      setVoters(updatedVoters);
      setHistory((prev) => prev.filter((r) => r.id !== recordId));
    } else {
      throw new Error(
        result.message || 'No se pudo eliminar el registro en la base de datos. No se alteró el estado local.'
      );
    }
  }, [history, voters]);

  const handleResetData = useCallback(async () => {
    if (!window.confirm('¿Deseas restablecer los datos originales de todos los integrantes y juegos?')) {
      return;
    }

    if (saveDebounceRef.current) {
      clearTimeout(saveDebounceRef.current);
    }
    invalidatePendingWrites();

    setSyncState({ status: 'saving', message: 'Restableciendo todos los datos...' });

    try {
      const result = await resetAllData();
      setSyncState(result);

      if (result.status === 'synced' || result.status === 'local') {
        skipNextSaveRef.current = true;
        setVoters([]);
        setGamesMap({});
        setSteamApiKey('');
        setHistory([]);
        setFreezeState(DEFAULT_FREEZE_STATE);
      } else {
        throw new Error(result.message || 'No se pudieron restablecer los datos en la base de datos.');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al restablecer los datos';
      setSyncState({ status: 'error', message });
    }
  }, []);

  const handleResetAllAura = useCallback(async () => {
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
        skipNextSaveRef.current = true;
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
  }, [voters, gamesMap, freezeState]);

  // ─── Drag and Drop ────────────────────────────────────────
  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', index.toString());
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverIndex !== index) {
      setDragOverIndex(index);
    }
  };

  const handleDrop = (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === targetIndex) {
      setDraggedIndex(null);
      setDragOverIndex(null);
      return;
    }

    const updatedVoters = [...voters];
    const [draggedItem] = updatedVoters.splice(draggedIndex, 1);
    updatedVoters.splice(targetIndex, 0, draggedItem);

    setVoters(updatedVoters);
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const handleAddVoter = () => {
    if (voters.length >= MAX_VOTERS) return;
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
    setVoterToDelete(voter);
  };

  const handleConfirmDeleteVoter = () => {
    if (!voterToDelete) return;
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

  const handleDragEnd = () => {
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  // ─── Backup: Exportar ─────────────────────────────────────
  const handleExportBackup = () => {
    const backup = createBackupData(voters, gamesMap, history, steamApiKey);
    downloadBackup(backup);
    setSyncState({ status: 'synced', message: 'Backup exportado ✅' });
  };

  // ─── Backup: Importar ─────────────────────────────────────
  const handleImportClick = () => {
    importFileInputRef.current?.click();
  };

  const handleImportFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (voters.length > 0 || history.length > 0) {
      const confirmed = window.confirm(
        '⚠️ Al importar un backup se sobrescribirán TODOS los datos actuales.\n\n¿Estás seguro de continuar?'
      );
      if (!confirmed) {
        if (importFileInputRef.current) importFileInputRef.current.value = '';
        return;
      }
    }

    try {
      setSyncState({ status: 'saving', message: 'Importando backup...' });
      const result = await importBackup(file);

      setVoters(result.voters);
      setGamesMap(result.gamesMap);
      setHistory(result.history);
      setSteamApiKey(result.steamApiKey);

      setSyncState({ status: 'synced', message: `✅ Backup importado: ${result.voters.length} integrantes, ${result.history.length} registros` });
      if (importFileInputRef.current) importFileInputRef.current.value = '';
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Error desconocido';
      console.error('[Dashboard] Error al importar backup:', err);
      setSyncState({ status: 'error', message: `❌ ${errorMsg}` });
      if (importFileInputRef.current) importFileInputRef.current.value = '';
    }
  };



  // ─── Loading state ────────────────────────────────────────
  // Skeleton loaders animados que imitan la estructura del dashboard
  // mientras se realiza la lectura inicial de Firestore.
  if (initialLoadStatus === 'loading') {
    return <DashboardSkeleton />;
  }

  // ─── Error state: No se pudo cargar la información inicial ───
  // Si la lectura remota falló, no se debe asumir datos vacíos ni permitir
  // que los autoguardados sobrescriban la base de datos con arrays vacíos.
  if (initialLoadStatus === 'error') {
    return (
      <div className="steam-dashboard-container initial-error-container">
        <div className="bg-gradient-overlay" />
        <div className="bg-grid-lines" />

        <SyncIndicator syncState={syncState} />

        <main className="initial-error-card-wrapper" role="alert" aria-live="assertive">
          <div className="initial-load-error-card">
            <div className="initial-error-badge">
              <span className="initial-error-icon" aria-hidden="true">⚠️</span>
              <span className="initial-error-tag">Error de Conexión Remota</span>
            </div>

            <h1 className="initial-error-title">No se pudieron cargar los datos</h1>

            <p className="initial-error-desc">
              Ocurrió un error al leer la información desde el servidor. Para proteger la integridad de tus datos y evitar sobreescribir la información existente con una lista vacía, el autoguardado se encuentra <strong>suspendido</strong>.
            </p>

            {initialLoadErrorMessage && (
              <div className="initial-error-detail">
                <span className="initial-error-detail-label">Detalle del error:</span>
                <code>{initialLoadErrorMessage}</code>
              </div>
            )}

            <div className="initial-error-actions">
              <motion.button
                type="button"
                className="btn-retry-initial-load"
                onClick={() => void handleRetryInitialLoad()}
                whileHover={{ scale: 1.04, y: -2 }}
                whileTap={{ scale: 0.96 }}
              >
                🔄 Reintentar conexión
              </motion.button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // ─── Render principal ─────────────────────────────────────
  return (
    <div className="steam-dashboard-container">
      <div className="bg-gradient-overlay"></div>
      <div className="bg-grid-lines"></div>

      <SyncIndicator syncState={syncState} />

      <InstallPrompt />

      {canManageContent && (
        <motion.button
          type="button"
          className={`hidden-gear-btn ${isEditMode ? 'active' : ''}`}
          onClick={handleToggleEditMode}
          title={isEditMode ? 'Desactivar Modo Edición' : 'Activar Modo Edición (Oculto)'}
          aria-label="Modo Edición"
          whileHover={{ scale: 1.1, rotate: 15 }}
          whileTap={{ scale: 0.9 }}
        >
          <FaCog size={20} />
        </motion.button>
      )}

      {adminAccess.isAuthenticated && (
        <motion.div
          className="admin-session-badge"
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          style={{
            position: 'fixed',
            top: 14,
            left: 14,
            zIndex: 90,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            background: 'rgba(23, 26, 33, 0.94)',
            border: adminAccess.isAdmin
              ? '1px solid rgba(168, 85, 247, 0.5)'
              : '1px solid rgba(156, 163, 175, 0.3)',
            boxShadow: adminAccess.isAdmin
              ? '0 0 15px rgba(168, 85, 247, 0.25)'
              : 'none',
            borderRadius: 20,
            padding: '6px 12px',
            fontSize: '12px',
            color: adminAccess.isAdmin ? '#c084fc' : '#9ca3af',
            backdropFilter: 'blur(8px)',
          }}
        >
          <span>
            {adminAccess.isAdmin ? '🛡️ Admin' : '👤 Usuario'}: {adminAccess.adminEmail || 'Sesión activa'}
          </span>
          <button
            type="button"
            onClick={handleLogoutAdmin}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#f87171',
              cursor: 'pointer',
              fontSize: '11px',
              fontWeight: 600,
              padding: '2px 6px',
              borderRadius: 4,
            }}
            title="Cerrar sesión (Volver a solo lectura)"
          >
            Cerrar sesión
          </button>
        </motion.div>
      )}


      {/* Botones de acción principales */}
      <div className="top-action-navigation">
        {canManageContent && (
          <motion.button
            type="button"
            className="btn-action-primary btn-finish-voting"
            onClick={() => {
              if (hasWinner) {
                setShowFinishModal(true);
              }
            }}
            disabled={!hasWinner}
            title={hasWinner ? 'Finalizar votación y asignar cuotas' : 'No hay un juego ganador disponible para finalizar la votación'}
            whileHover={hasWinner ? { scale: 1.04, y: -2 } : {}}
            whileTap={hasWinner ? { scale: 0.95 } : {}}
          >
            🏆 Finalizar Votación
          </motion.button>
        )}
      </div>

      {/* Barra de edición */}
      <AnimatePresence>
        {canManageContent && isEditMode && (
          <motion.div
            key="edit-mode-bar"
            className="edit-mode-top-bar"
            initial={{ opacity: 0, y: -20, height: 0 }}
            animate={{ opacity: 1, y: 0, height: 'auto' }}
            exit={{ opacity: 0, y: -20, height: 0 }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="edit-bar-left">
              <span className="edit-badge">⚙️ MODO EDICIÓN ACTIVO</span>
              <span className="edit-help-text">
                Buscá juegos en Steam, edita perfiles y arrastrá tarjetas. Autoguardado activo.
              </span>
            </div>

            <div className="edit-bar-controls">
              <motion.button
                type="button"
                className="btn-add-voter"
                onClick={handleAddVoter}
                disabled={voters.length >= MAX_VOTERS}
                title={voters.length >= MAX_VOTERS ? `Máximo de ${MAX_VOTERS} integrantes alcanzado (límite Steam Families)` : 'Añadir nuevo integrante'}
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
              >
                ➕ Añadir Integrante ({voters.length}/{MAX_VOTERS})
              </motion.button>

              <div className="api-key-input-container">
                <label htmlFor="steam-api-key-input">Steam Web API Key (opcional):</label>
                <input
                  id="steam-api-key-input"
                  type="password"
                  placeholder="Clave API de Steam..."
                  value={steamApiKey}
                  onChange={(e) => setSteamApiKey(e.target.value)}
                  className="api-key-input"
                />
              </div>

              <div className="backup-btn-group">
                <motion.button
                  type="button"
                  className="btn-backup btn-export"
                  onClick={handleExportBackup}
                  title="Descargar backup completo en JSON"
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.97 }}
                >
                  📥 Exportar Backup
                </motion.button>
                <motion.button
                  type="button"
                  className="btn-backup btn-import"
                  onClick={handleImportClick}
                  title="Restaurar datos desde un archivo JSON"
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.97 }}
                >
                  📤 Importar Backup
                </motion.button>
                <input
                  ref={importFileInputRef}
                  type="file"
                  accept=".json"
                  onChange={handleImportFileChange}
                  style={{ display: 'none' }}
                />
              </div>

              <motion.button
                type="button"
                className="btn-reset-votes"
                onClick={handleResetAllVotes}
                title="Reiniciar a 0 puntos todos los votos de los integrantes para comenzar un nuevo ciclo de votación"
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
              >
                🧹 Reiniciar Votos (Nuevo Ciclo)
              </motion.button>

              <motion.button
                type="button"
                className="btn-reset-data"
                onClick={handleResetData}
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
              >
                Restablecer
              </motion.button>

              <motion.button
                type="button"
                className="btn-reset-aura"
                onClick={() => setShowResetAuraConfirm(true)}
                title="Restablece el Aura de todos los integrantes a Socio Regular (0 Cuotas, 1.0x)"
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
              >
                🔄 Restablecer Aura
              </motion.button>

              <motion.button
                type="button"
                className="btn-save-edit"
                onClick={() => setIsEditMode(false)}
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
              >
                ✓ Guardar / Listo
              </motion.button>
            </div>
          </motion.div>
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
                  draggable={!isMobile}
                  onDragStart={!isMobile ? (e) => handleDragStart(e, index) : undefined}
                  onDragOver={!isMobile ? (e) => handleDragOver(e, index) : undefined}
                  onDrop={!isMobile ? (e) => handleDrop(e, index) : undefined}
                  onDragEnd={!isMobile ? handleDragEnd : undefined}
                  isDragging={!isMobile && draggedIndex === index}
                  isDragOver={!isMobile && dragOverIndex === index}
                  onRequestDelete={handleRequestDeleteVoter}
                  canDelete={voters.length > MIN_VOTERS}
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
          isFreezingLoading={isFreezingLoading}
        />

        <div className="history-footer-action">
          <motion.button
            type="button"
            className="btn-history-glow"
            onClick={() => setShowHistoryModal(true)}
            whileHover={{ scale: 1.04, y: -2 }}
            whileTap={{ scale: 0.96 }}
          >
            📜 Ver historial
          </motion.button>
        </div>

        <footer className="steam-footer">
          <p>© 2026 Steam Co-Op Game Voting • Diseñado con paleta oficial de Steam & Acentos Neón</p>
        </footer>
      </div>

      {/* Modales */}
      <AnimatePresence>
        {showFinishModal && hasWinner && (
          <FinishVotingModal
            key="finish-modal"
            allResults={results}
            voters={voters}
            isPrecioCongelado={freezeState.isPrecioCongelado}
            precioCongelado={freezeState.precioCongelado}
            descuentoCongelado={freezeState.descuentoCongelado}
            precioCongeladoFormatted={freezeState.precioCongeladoFormatted}
            onConfirmFinish={handleConfirmFinishVoting}
            onClose={() => setShowFinishModal(false)}
          />
        )}

        {showHistoryModal && (
          <VotingHistoryModal
            key="history-modal"
            history={history}
            onClearHistory={handleClearHistory}
            onDeleteRecord={handleDeleteHistoryRecord}
            onClose={() => setShowHistoryModal(false)}
            canManageContent={canManageContent}
          />
        )}

        {voterToDelete && (
          <DeleteUserConfirmModal
            key={`delete-user-${voterToDelete.id}`}
            voter={voterToDelete}
            onCancel={handleCancelDeleteVoter}
            onConfirm={handleConfirmDeleteVoter}
          />
        )}

        {showResetAuraConfirm && (
          <ResetAuraConfirmModal
            key="reset-aura-modal"
            onConfirm={handleResetAllAura}
            onCancel={() => setShowResetAuraConfirm(false)}
          />
        )}
      </AnimatePresence>

      {/* Modal de PIN de administrador (BottomSheet animado) */}
      <AnimatePresence>
        {showPinModal && (
          <AdminPinModal
            key="admin-pin-modal"
            onCancel={handlePinCancel}
            onAuthenticate={handlePinSubmit}
          />
        )}
      </AnimatePresence>
    </div>
  );
};
