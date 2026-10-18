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
import { calculateResults, removeGameFromVotingSession, addGameToVotingSession } from '../data/votingData';
import type { Voter, Game, VotingHistoryRecord, AuraRank, FreezePriceState, SteamPriceInfo, GameResult } from '../types/voting';
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
  loadVoters,
  loadHistory,
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
  type AdminAccessState,
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
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);

  const handleCancel = () => {
    if (isResetting) return;
    setErrorMessage(null);
    onCancel();
  };

  const modalRef = useModalFocusTrap<HTMLDivElement>({
    initialFocusRef: cancelButtonRef,
    onEscape: isResetting ? undefined : handleCancel,
    disabled: isResetting,
    initialFocusDelay: 100,
  });

  const handleConfirm = async () => {
    if (isResetting) return;

    setIsResetting(true);
    setErrorMessage(null);

    try {
      await onConfirm();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al restablecer Aura';
      setErrorMessage(message);
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
          handleCancel();
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
            onClick={handleCancel}
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
            {errorMessage && (
              <div className="finish-modal-error-banner" role="alert" style={{ marginTop: '12px' }}>
                <span className="finish-modal-error-icon" aria-hidden="true">❌</span>
                <div className="finish-modal-error-content">
                  <span className="finish-modal-error-title">Error al restablecer</span>
                  <p className="finish-modal-error-text">{errorMessage}</p>
                </div>
              </div>
            )}
          </section>
        </div>

        <footer className="modal-footer-actions delete-modal-actions">
          <motion.button
            ref={cancelButtonRef}
            type="button"
            className="btn-modal-cancel"
            onClick={handleCancel}
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

function useAdminShortcut(
  requestAdminUnlockViaModal: (forceOpen?: boolean) => Promise<boolean>,
  setIsEditMode: React.Dispatch<React.SetStateAction<boolean>>
) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isKeyA = event.key === 'a' || event.key === 'A' || event.code === 'KeyA';
      const isAltShift = event.altKey && event.shiftKey;

      if (isAltShift && isKeyA) {
        event.preventDefault();
        event.stopPropagation();

        const state = getAdminAccessState();
        if (state.isAdmin) {
          setIsEditMode((prev) => !prev);
        } else {
          void requestAdminUnlockViaModal(true);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [requestAdminUnlockViaModal, setIsEditMode]);
}

function useAutoUnfreezeWatcher(
  initialLoadStatus: 'loading' | 'loaded' | 'error',
  canManageContent: boolean,
  gamesMap: Record<string, Game>,
  results: GameResult[],
  freezeState: FreezePriceState,
  totalAssignedPoints: number,
  autoUnfreezePrice: (reason: string) => Promise<void>
) {
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
    } else if (
      // 2. Si el juego ganador cambió
      freezeState.isPrecioCongelado &&
      freezeState.gameId &&
      winnerId &&
      freezeState.gameId !== winnerId
    ) {
      void Promise.resolve().then(() => {
        void autoUnfreezePrice('cambio de juego ganador');
      });
    } else if (
      // 3. Si se limpiaron todos los votos de la sesión
      freezeState.isPrecioCongelado &&
      totalAssignedPoints === 0
    ) {
      void Promise.resolve().then(() => {
        void autoUnfreezePrice('votos reiniciados');
      });
    }

    prevGamesSignatureRef.current = gameIds;
    prevWinnerIdRef.current = winnerId;
  }, [
    gamesMap,
    results,
    freezeState.isPrecioCongelado,
    freezeState.gameId,
    totalAssignedPoints,
    initialLoadStatus,
    canManageContent,
    autoUnfreezePrice,
  ]);
}

function useVotersDragAndDrop(
  setVoters: React.Dispatch<React.SetStateAction<Voter[]>>,
  isMobile: boolean,
  disabled = false
) {
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const draggedIndexRef = useRef<number | null>(null);

  const handleDragStart = useCallback((e: React.DragEvent, index: number) => {
    if (disabled) {
      e.preventDefault();
      return;
    }
    draggedIndexRef.current = index;
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', index.toString());
  }, [disabled]);

  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    if (disabled) {
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverIndex((prev) => (prev !== index ? index : prev));
  }, [disabled]);

  const handleDrop = useCallback((e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    if (disabled) {
      draggedIndexRef.current = null;
      setDragOverIndex(null);
      setDraggedIndex(null);
      return;
    }

    const dataIndexStr = e.dataTransfer.getData('text/plain');
    const parsedDataIndex = dataIndexStr !== '' ? Number.parseInt(dataIndexStr, 10) : null;
    const sourceIndex = draggedIndexRef.current ?? (parsedDataIndex !== null && !Number.isNaN(parsedDataIndex) ? parsedDataIndex : null);

    draggedIndexRef.current = null;
    setDraggedIndex(null);
    setDragOverIndex(null);

    if (sourceIndex === null || sourceIndex === targetIndex) {
      return;
    }

    setVoters((prevVoters) => {
      if (sourceIndex < 0 || sourceIndex >= prevVoters.length || targetIndex < 0 || targetIndex >= prevVoters.length) {
        return prevVoters;
      }
      const updated = [...prevVoters];
      const [draggedItem] = updated.splice(sourceIndex, 1);
      updated.splice(targetIndex, 0, draggedItem);
      return updated;
    });
  }, [setVoters, disabled]);

  const handleDragEnd = useCallback(() => {
    draggedIndexRef.current = null;
    setDraggedIndex(null);
    setDragOverIndex(null);
  }, []);

  const getDragProps = useCallback((index: number) => {
    if (isMobile || disabled) {
      return { draggable: false, isDragging: false, isDragOver: false };
    }
    return {
      draggable: true,
      onDragStart: (e: React.DragEvent) => handleDragStart(e, index),
      onDragOver: (e: React.DragEvent) => handleDragOver(e, index),
      onDrop: (e: React.DragEvent) => handleDrop(e, index),
      onDragEnd: handleDragEnd,
      isDragging: draggedIndex === index,
      isDragOver: dragOverIndex === index,
    };
  }, [isMobile, disabled, handleDragStart, handleDragOver, handleDrop, handleDragEnd, draggedIndex, dragOverIndex]);

  return { getDragProps };
}

interface InitialLoadErrorViewProps {
  syncState: SyncState;
  errorMessage: string;
  onRetry: () => void;
}

const InitialLoadErrorView: React.FC<InitialLoadErrorViewProps> = ({
  syncState,
  errorMessage,
  onRetry,
}) => (
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

        {errorMessage && (
          <div className="initial-error-detail">
            <span className="initial-error-detail-label">Detalle del error:</span>
            <code>{errorMessage}</code>
          </div>
        )}

        <div className="initial-error-actions">
          <motion.button
            type="button"
            className="btn-retry-initial-load"
            onClick={onRetry}
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

interface AdminSessionBadgeProps {
  adminAccess: AdminAccessState;
  onLogout: () => void;
}

const AdminSessionBadge: React.FC<AdminSessionBadgeProps> = ({ adminAccess, onLogout }) => {
  if (!adminAccess.isAuthenticated) return null;

  return (
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
        onClick={onLogout}
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
  );
};

interface EditModeTopBarProps {
  voterCount: number;
  steamApiKey: string;
  onApiKeyChange: (key: string) => void;
  onAddVoter: () => void;
  onExportBackup: () => void;
  onImportClick: () => void;
  onImportFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  importFileInputRef: React.RefObject<HTMLInputElement | null>;
  isSaving: boolean;
  isImporting: boolean;
  onResetAllVotes: () => void;
  onResetData: () => void;
  onOpenResetAuraConfirm: () => void;
  onCloseEditMode: () => void;
}

const EditBarBadgeSection: React.FC<{ isImporting: boolean }> = ({ isImporting }) => (
  <div className="edit-bar-left">
    <span className="edit-badge">
      {isImporting ? '⏳ IMPORTACIÓN EN CURSO' : '⚙️ MODO EDICIÓN ACTIVO'}
    </span>
    <span className="edit-help-text">
      {isImporting
        ? 'Restaurando y sincronizando datos desde el backup. Modificaciones bloqueadas temporalmente.'
        : 'Buscá juegos en Steam, edita perfiles y arrastrá tarjetas. Autoguardado activo.'}
    </span>
  </div>
);

const AddVoterButton: React.FC<{
  voterCount: number;
  isImporting: boolean;
  onAddVoter: () => void;
}> = ({ voterCount, isImporting, onAddVoter }) => {
  const isMaxReached = voterCount >= MAX_VOTERS;
  const isDisabled = isMaxReached || isImporting;

  let title = 'Añadir nuevo integrante';
  if (isImporting) {
    title = 'Importación de backup en curso...';
  } else if (isMaxReached) {
    title = `Máximo de ${MAX_VOTERS} integrantes alcanzado (límite Steam Families)`;
  }

  return (
    <motion.button
      type="button"
      className="btn-add-voter"
      onClick={onAddVoter}
      disabled={isDisabled}
      title={title}
      whileHover={isDisabled ? {} : { scale: 1.03 }}
      whileTap={isDisabled ? {} : { scale: 0.97 }}
    >
      ➕ Añadir Integrante ({voterCount}/{MAX_VOTERS})
    </motion.button>
  );
};

const BackupControls: React.FC<{
  isSaving: boolean;
  isImporting: boolean;
  onExportBackup: () => void;
  onImportClick: () => void;
  onImportFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  importFileInputRef: React.RefObject<HTMLInputElement | null>;
}> = ({
  isSaving,
  isImporting,
  onExportBackup,
  onImportClick,
  onImportFileChange,
  importFileInputRef,
}) => {
  const isImportDisabled = isSaving || isImporting;

  return (
    <div className="backup-btn-group">
      <motion.button
        type="button"
        className="btn-backup btn-export"
        onClick={onExportBackup}
        disabled={isImporting}
        title={isImporting ? 'Importación de backup en curso...' : 'Descargar backup completo en JSON'}
        whileHover={isImporting ? {} : { scale: 1.03 }}
        whileTap={isImporting ? {} : { scale: 0.97 }}
      >
        📥 Exportar Backup
      </motion.button>
      <motion.button
        type="button"
        className="btn-backup btn-import"
        onClick={onImportClick}
        disabled={isImportDisabled}
        title={isImporting ? 'Importando backup...' : 'Restaurar datos desde un archivo JSON'}
        whileHover={isImportDisabled ? {} : { scale: 1.03 }}
        whileTap={isImportDisabled ? {} : { scale: 0.97 }}
      >
        {isImporting ? '⏳ Importando...' : '📤 Importar Backup'}
      </motion.button>
      <input
        ref={importFileInputRef}
        type="file"
        accept=".json"
        onChange={onImportFileChange}
        disabled={isImporting}
        style={{ display: 'none' }}
      />
    </div>
  );
};

const EditBarActionButtons: React.FC<{
  isImporting: boolean;
  onResetAllVotes: () => void;
  onResetData: () => void;
  onOpenResetAuraConfirm: () => void;
  onCloseEditMode: () => void;
}> = ({
  isImporting,
  onResetAllVotes,
  onResetData,
  onOpenResetAuraConfirm,
  onCloseEditMode,
}) => (
  <>
    <motion.button
      type="button"
      className="btn-reset-votes"
      onClick={onResetAllVotes}
      disabled={isImporting}
      title={
        isImporting
          ? 'Importación de backup en curso...'
          : 'Reiniciar a 0 puntos todos los votos de los integrantes para comenzar un nuevo ciclo de votación'
      }
      whileHover={isImporting ? {} : { scale: 1.03 }}
      whileTap={isImporting ? {} : { scale: 0.97 }}
    >
      🧹 Reiniciar Votos (Nuevo Ciclo)
    </motion.button>

    <motion.button
      type="button"
      className="btn-reset-data"
      onClick={onResetData}
      disabled={isImporting}
      title={isImporting ? 'Importación de backup en curso...' : 'Restablecer todos los datos'}
      whileHover={isImporting ? {} : { scale: 1.03 }}
      whileTap={isImporting ? {} : { scale: 0.97 }}
    >
      Restablecer
    </motion.button>

    <motion.button
      type="button"
      className="btn-reset-aura"
      onClick={onOpenResetAuraConfirm}
      disabled={isImporting}
      title={
        isImporting
          ? 'Importación de backup en curso...'
          : 'Restablece el Aura de todos los integrantes a Socio Regular (0 Cuotas, 1.0x)'
      }
      whileHover={isImporting ? {} : { scale: 1.03 }}
      whileTap={isImporting ? {} : { scale: 0.97 }}
    >
      🔄 Restablecer Aura
    </motion.button>

    <motion.button
      type="button"
      className="btn-save-edit"
      onClick={onCloseEditMode}
      disabled={isImporting}
      title={isImporting ? 'Importación de backup en curso...' : 'Guardar y cerrar modo edición'}
      whileHover={isImporting ? {} : { scale: 1.03 }}
      whileTap={isImporting ? {} : { scale: 0.97 }}
    >
      ✓ Guardar / Listo
    </motion.button>
  </>
);

const EditModeTopBar: React.FC<EditModeTopBarProps> = ({
  voterCount,
  steamApiKey,
  onApiKeyChange,
  onAddVoter,
  onExportBackup,
  onImportClick,
  onImportFileChange,
  importFileInputRef,
  isSaving,
  isImporting,
  onResetAllVotes,
  onResetData,
  onOpenResetAuraConfirm,
  onCloseEditMode,
}) => (
  <motion.div
    key="edit-mode-bar"
    className="edit-mode-top-bar"
    initial={{ opacity: 0, y: -20, height: 0 }}
    animate={{ opacity: 1, y: 0, height: 'auto' }}
    exit={{ opacity: 0, y: -20, height: 0 }}
    transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
  >
    <EditBarBadgeSection isImporting={isImporting} />

    <div className="edit-bar-controls">
      <AddVoterButton voterCount={voterCount} isImporting={isImporting} onAddVoter={onAddVoter} />

      <div className="api-key-input-container">
        <label htmlFor="steam-api-key-input">Steam Web API Key (opcional):</label>
        <input
          id="steam-api-key-input"
          type="password"
          placeholder="Clave API de Steam..."
          value={steamApiKey}
          onChange={(e) => onApiKeyChange(e.target.value)}
          className="api-key-input"
          disabled={isImporting}
        />
      </div>

      <BackupControls
        isSaving={isSaving}
        isImporting={isImporting}
        onExportBackup={onExportBackup}
        onImportClick={onImportClick}
        onImportFileChange={onImportFileChange}
        importFileInputRef={importFileInputRef}
      />

      <EditBarActionButtons
        isImporting={isImporting}
        onResetAllVotes={onResetAllVotes}
        onResetData={onResetData}
        onOpenResetAuraConfirm={onOpenResetAuraConfirm}
        onCloseEditMode={onCloseEditMode}
      />
    </div>
  </motion.div>
);

interface GearButtonProps {
  canManageContent: boolean;
  isEditMode: boolean;
  isImporting: boolean;
  onToggleEditMode: () => void;
}

const GearButton: React.FC<GearButtonProps> = ({
  canManageContent,
  isEditMode,
  isImporting,
  onToggleEditMode,
}) => {
  if (!canManageContent) return null;

  let title = 'Activar Modo Edición (Oculto)';
  if (isImporting) {
    title = '⏳ Importación en curso...';
  } else if (isEditMode) {
    title = 'Desactivar Modo Edición';
  }

  return (
    <motion.button
      type="button"
      className={`hidden-gear-btn ${isEditMode ? 'active' : ''}`}
      onClick={onToggleEditMode}
      disabled={isImporting}
      title={title}
      aria-label="Modo Edición"
      whileHover={isImporting ? {} : { scale: 1.1, rotate: 15 }}
      whileTap={isImporting ? {} : { scale: 0.9 }}
    >
      <FaCog size={20} />
    </motion.button>
  );
};

interface TopActionNavigationProps {
  canManageContent: boolean;
  hasWinner: boolean;
  isImporting: boolean;
  onOpenFinishModal: () => void;
}

const TopActionNavigation: React.FC<TopActionNavigationProps> = ({
  canManageContent,
  hasWinner,
  isImporting,
  onOpenFinishModal,
}) => {
  if (!canManageContent) return null;

  const isDisabled = !hasWinner || isImporting;

  let title = 'No hay un juego ganador disponible para finalizar la votación';
  if (isImporting) {
    title = '⏳ Importación en curso...';
  } else if (hasWinner) {
    title = 'Finalizar votación y asignar cuotas';
  }

  return (
    <div className="top-action-navigation">
      <motion.button
        type="button"
        className="btn-action-primary btn-finish-voting"
        onClick={() => {
          if (!isDisabled) {
            onOpenFinishModal();
          }
        }}
        disabled={isDisabled}
        title={title}
        whileHover={isDisabled ? {} : { scale: 1.04, y: -2 }}
        whileTap={isDisabled ? {} : { scale: 0.95 }}
      >
        🏆 Finalizar Votación
      </motion.button>
    </div>
  );
};

interface HistoryFooterButtonProps {
  isImporting: boolean;
  onOpenHistoryModal: () => void;
}

const HistoryFooterButton: React.FC<HistoryFooterButtonProps> = ({
  isImporting,
  onOpenHistoryModal,
}) => (
  <div className="history-footer-action">
    <motion.button
      type="button"
      className="btn-history-glow"
      onClick={() => {
        if (!isImporting) {
          onOpenHistoryModal();
        }
      }}
      disabled={isImporting}
      title={isImporting ? '⏳ Importación en curso...' : 'Ver historial de votaciones'}
      whileHover={isImporting ? {} : { scale: 1.04, y: -2 }}
      whileTap={isImporting ? {} : { scale: 0.96 }}
    >
      📜 Ver historial
    </motion.button>
  </div>
);

interface DashboardModalsProps {
  showFinishModal: boolean;
  hasWinner: boolean;
  results: GameResult[];
  voters: Voter[];
  freezeState: FreezePriceState;
  onConfirmFinish: (updatedVoters: Voter[], historyRecord: VotingHistoryRecord) => Promise<void>;
  onCloseFinishModal: () => void;
  showHistoryModal: boolean;
  history: VotingHistoryRecord[];
  onClearHistory: () => Promise<void>;
  onDeleteHistoryRecord: (recordId: string) => Promise<void>;
  onCloseHistoryModal: () => void;
  canManageContent: boolean;
  voterToDelete: Voter | null;
  onCancelDeleteVoter: () => void;
  onConfirmDeleteVoter: () => void;
  showResetAuraConfirm: boolean;
  onConfirmResetAura: () => Promise<void>;
  onCancelResetAura: () => void;
  showPinModal: boolean;
  onPinCancel: () => void;
  onPinSubmit: (password: string) => Promise<AuthResult>;
}

const DashboardModals: React.FC<DashboardModalsProps> = ({
  showFinishModal,
  hasWinner,
  results,
  voters,
  freezeState,
  onConfirmFinish,
  onCloseFinishModal,
  showHistoryModal,
  history,
  onClearHistory,
  onDeleteHistoryRecord,
  onCloseHistoryModal,
  canManageContent,
  voterToDelete,
  onCancelDeleteVoter,
  onConfirmDeleteVoter,
  showResetAuraConfirm,
  onConfirmResetAura,
  onCancelResetAura,
  showPinModal,
  onPinCancel,
  onPinSubmit,
}) => (
  <>
    <AnimatePresence>
      {canManageContent && showFinishModal && hasWinner && (
        <FinishVotingModal
          key="finish-modal"
          allResults={results}
          voters={voters}
          isPrecioCongelado={freezeState.isPrecioCongelado}
          precioCongelado={freezeState.precioCongelado}
          descuentoCongelado={freezeState.descuentoCongelado}
          precioCongeladoFormatted={freezeState.precioCongeladoFormatted}
          onConfirmFinish={onConfirmFinish}
          onClose={onCloseFinishModal}
        />
      )}

      {showHistoryModal && (
        <VotingHistoryModal
          key="history-modal"
          history={history}
          onClearHistory={onClearHistory}
          onDeleteRecord={onDeleteHistoryRecord}
          onClose={onCloseHistoryModal}
          canManageContent={canManageContent}
        />
      )}

      {canManageContent && voterToDelete && (
        <DeleteUserConfirmModal
          key={`delete-user-${voterToDelete.id}`}
          voter={voterToDelete}
          onCancel={onCancelDeleteVoter}
          onConfirm={onConfirmDeleteVoter}
        />
      )}

      {canManageContent && showResetAuraConfirm && (
        <ResetAuraConfirmModal
          key="reset-aura-modal"
          onConfirm={onConfirmResetAura}
          onCancel={onCancelResetAura}
        />
      )}
    </AnimatePresence>

    <AnimatePresence>
      {showPinModal && (
        <AdminPinModal
          key="admin-pin-modal"
          onCancel={onPinCancel}
          onAuthenticate={onPinSubmit}
        />
      )}
    </AnimatePresence>
  </>
);

function serializeDashboardState(
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
  const [adminAccess, setAdminAccess] = useState(() => getAdminAccessState());
  const [voterToDelete, setVoterToDelete] = useState<Voter | null>(null);
  const [showResetAuraConfirm, setShowResetAuraConfirm] = useState(false);
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

  const { getDragProps } = useVotersDragAndDrop(setVoters, isMobile, isImporting);

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
  const isImportingRef = useRef<boolean>(false);
  const isUnfreezingRef = useRef<boolean>(false);
  const saveDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const apiKeyDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPersistedDashboardSignatureRef = useRef<string>('');
  const lastPersistedApiKeyRef = useRef<string>('');
  const importFileInputRef = useRef<HTMLInputElement | null>(null);
  // Ref para resolver la Promise del modal de PIN y reutilizarla ante llamadas simultáneas
  const pinModalResolveRef = useRef<((value: boolean) => void) | null>(null);
  const pendingUnlockPromiseRef = useRef<Promise<boolean> | null>(null);

  const cancelPendingWritesAndDebounce = useCallback(() => {
    if (saveDebounceRef.current) {
      clearTimeout(saveDebounceRef.current);
    }
    if (apiKeyDebounceRef.current) {
      clearTimeout(apiKeyDebounceRef.current);
    }
    invalidatePendingWrites();
  }, []);

  const resetImportInput = useCallback(() => {
    if (importFileInputRef.current) {
      importFileInputRef.current.value = '';
    }
  }, []);


  // Limpieza al desmontar el componente: cancelar temporizadores e invalidar escrituras pendientes
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      cancelPendingWritesAndDebounce();
      if (pinModalResolveRef.current) {
        pinModalResolveRef.current(false);
        pinModalResolveRef.current = null;
        pendingUnlockPromiseRef.current = null;
      }
    };
  }, [cancelPendingWritesAndDebounce]);

  const canManageContent = adminAccess.canManageContent;


  const handleApplyInitialData = useCallback((data: InitialDashboardData) => {
    lastPersistedDashboardSignatureRef.current = serializeDashboardState(data.voters, data.gamesMap, data.freezeState);
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
    if (!canManageContent) {
      void Promise.resolve().then(() => {
        setIsEditMode(false);
        setShowFinishModal(false);
        setVoterToDelete(null);
        setShowResetAuraConfirm(false);
      });
    }
  }, [canManageContent]);

  // ─── Sincronización con debounce coordinado ──────────────
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
    []
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
  }, []);

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
  }, [canManageContent, freezeState, voters, gamesMap]);

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
  }, [canManageContent, freezeState, freezePrice, unfreezePrice, voters, gamesMap]);

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
    if (isImportingRef.current) return;
    await logoutAdmin();
    setAdminAccess(getAdminAccessState());
    setIsEditMode(false);
    setShowFinishModal(false);
    setVoterToDelete(null);
    setShowResetAuraConfirm(false);
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
  useAdminShortcut(requestAdminUnlockViaModal, setIsEditMode);

  const handleToggleEditMode = useCallback(() => {
    if (isImportingRef.current) return;
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
  }, [canManageContent, gamesMap]);

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
  }, [canManageContent, history, voters, gamesMap, freezeState]);

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
  }, [canManageContent, history, voters, gamesMap, freezeState]);

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
  }, [canManageContent, cancelPendingWritesAndDebounce]);

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
  }, [canManageContent, voters, gamesMap, freezeState]);

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

      <GearButton
        canManageContent={canManageContent}
        isEditMode={isEditMode}
        isImporting={isImporting}
        onToggleEditMode={handleToggleEditMode}
      />

      <AdminSessionBadge adminAccess={adminAccess} onLogout={handleLogoutAdmin} />

      <TopActionNavigation
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
            onOpenResetAuraConfirm={() => {
              if (!canManageContent || isImporting) return;
              setShowResetAuraConfirm(true);
            }}
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

        <HistoryFooterButton
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
