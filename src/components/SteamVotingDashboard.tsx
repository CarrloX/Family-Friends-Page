import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
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
import { calculateResults } from '../data/votingData';
import type { Voter, Game, VotingHistoryRecord, AuraRank } from '../types/voting';
import { getMaxVotePoints } from '../types/voting';
import { FaCog } from "react-icons/fa";
import {
  saveVoters,
  saveGames,
  saveActiveVotingState,
  addHistoryRecord,
  loadVoters,
  loadGames,
  loadHistory,
  clearHistory as clearHistoryStore,
  deleteHistoryRecord,
  resetAllData,
  saveApiKey,
  loadApiKey,
  createBackupData,
  downloadBackup,
  importBackup,
  type SyncState,
} from '../services/dataStore';
import { getAdminAccessState, requestAdminUnlock, unlockWithPin } from '../services/accessControl';

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

const resetVoterAura = (voter: Voter): Voter => ({
  ...voter,
  auraQuotaBalance: 0,
  auraRank: 'Socio Regular',
  multiplier: 1.0,
});

// ─── Componente auxiliar: Modal de confirmación ───────────
const ResetAuraConfirmModal: React.FC<{
  onConfirm: () => void;
  onCancel: () => void;
}> = ({ onConfirm, onCancel }) => {
  return (
    <motion.div
      className="modal-backdrop bottom-sheet-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
      onClick={onCancel}
    >
      <motion.div
        className="delete-confirm-modal-container bottom-sheet-panel"
        initial={{ y: '100%', opacity: 0, scale: 0.95 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        exit={{ y: '100%', opacity: 0, scale: 0.95 }}
        transition={{ type: 'spring', stiffness: 320, damping: 30 }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Handle visual superior estilo bottom sheet */}
        <div className="bottom-sheet-handle" aria-hidden="true"></div>
        <div className="modal-header">
          <div className="modal-title-group">
            <h2>⚠️ Restablecer Aura</h2>
            <p>Esta acción no se puede deshacer fácilmente.</p>
          </div>
          <button
            type="button"
            className="modal-close-btn"
            onClick={onCancel}
            aria-label="Cerrar"
          >✕</button>
        </div>

        <div className="delete-warning-content">
          <div className="delete-warning-text">
            <p>¿Estás seguro de que deseas restablecer el <strong>Aura de todos los integrantes</strong>?</p>
            <p className="delete-warning-sub">
              Todos los integrantes volverán a ser <strong>Socio Regular</strong> con <strong>0 Cuotas</strong> y multiplicador <strong>1.0x</strong>.
            </p>
            <p className="delete-warning-note">
              📊 <strong>Nota:</strong> Esta acción no afectará el historial de votaciones ni los juegos guardados. Solo se modificarán los niveles de Aura.
            </p>
          </div>
        </div>

        <div className="modal-footer-actions delete-modal-actions">
          <button type="button" className="btn-modal-cancel" onClick={onCancel}>Cancelar</button>
          <button type="button" className="btn-modal-confirm-delete" onClick={onConfirm}>Confirmar Restablecimiento</button>
        </div>
      </motion.div>
    </motion.div>
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

  const [isEditMode, setIsEditMode] = useState<boolean>(false);
  const [showFinishModal, setShowFinishModal] = useState<boolean>(false);
  const [showHistoryModal, setShowHistoryModal] = useState<boolean>(false);
  const [adminAccess, setAdminAccess] = useState(() => getAdminAccessState());
  const [voterToDelete, setVoterToDelete] = useState<Voter | null>(null);
  const [showResetAuraConfirm, setShowResetAuraConfirm] = useState(false);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [showReadOnlyBanner, setShowReadOnlyBanner] = useState<boolean>(false);
  const [showPinModal, setShowPinModal] = useState<boolean>(false);

  const [syncState, setSyncState] = useState<SyncState>({ status: 'idle', message: '' });

   const votersDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
   const gamesDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
   const activeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
   const apiKeyDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
   const importFileInputRef = useRef<HTMLInputElement | null>(null);
   // Ref para resolver la Promise del modal de PIN
   const pinModalResolveRef = useRef<((value: boolean) => void) | null>(null);

  const canManageContent = adminAccess.canManageContent;
  const isReadOnlyMode = adminAccess.isReadOnly;

  useEffect(() => {
    if (!isReadOnlyMode) {
      return;
    }

    // Mostrar el banner de solo lectura con un pequeño delay y ocultarlo tras 3s
    const showTimer = window.setTimeout(() => setShowReadOnlyBanner(true), 0);
    const hideTimer = window.setTimeout(() => setShowReadOnlyBanner(false), 3000);
    return () => {
      window.clearTimeout(showTimer);
      window.clearTimeout(hideTimer);
    };
  }, [isReadOnlyMode]);

  // ─── Carga inicial de datos ───────────────────────────────
  useEffect(() => {
    const loadAllData = async () => {
      setIsLoading(true);
      try {
        const [loadedVoters, loadedGames, loadedHistory, loadedApiKey] =
          await Promise.all([
            loadVoters(),
            loadGames(),
            loadHistory(),
            Promise.resolve(loadApiKey()),
          ]);

        setVoters(loadedVoters);
        setGamesMap(loadedGames);
        setHistory(loadedHistory);
        setSteamApiKey(loadedApiKey);

        if (loadedVoters.length > 0 || Object.keys(loadedGames).length > 0) {
          setSyncState({ status: 'synced', message: 'Datos cargados' });
        }
      } catch (err) {
        console.warn('[Dashboard] Error en carga inicial:', err);
        setSyncState({ status: 'error', message: 'Error al cargar datos' });
      } finally {
        setIsLoading(false);
      }
    };

    loadAllData();
  }, []);

  useEffect(() => {
    const state = getAdminAccessState();
    if (state.isLocalEnvironment || state.requestedAdmin) {
      const timer = setTimeout(() => {
        const unlocked = requestAdminUnlock();
        setAdminAccess(getAdminAccessState());
        if (!unlocked) {
          setIsEditMode(false);
        }
      }, 0);
      return () => clearTimeout(timer);
    }
  }, []);

  useEffect(() => {
    if (!canManageContent && isEditMode) {
      Promise.resolve().then(() => {
        setIsEditMode(false);
      });
    }
  }, [canManageContent, isEditMode]);

  // ─── Sincronización con debounce ─────────────────────────
  const debouncedSaveVoters = useCallback((votersToSave: Voter[]) => {
    if (votersDebounceRef.current) {
      clearTimeout(votersDebounceRef.current);
    }
    Promise.resolve().then(() => {
      setSyncState({ status: 'saving', message: 'Guardando...' });
    });
    votersDebounceRef.current = setTimeout(async () => {
      const result = await saveVoters(votersToSave);
      setSyncState(result);
    }, DEBOUNCE_MS);
  }, []);

  const debouncedSaveGames = useCallback((gamesToSave: Record<string, Game>) => {
    if (gamesDebounceRef.current) {
      clearTimeout(gamesDebounceRef.current);
    }
    Promise.resolve().then(() => {
      setSyncState({ status: 'saving', message: 'Guardando...' });
    });
    gamesDebounceRef.current = setTimeout(async () => {
      const result = await saveGames(gamesToSave);
      setSyncState(result);
    }, DEBOUNCE_MS);
  }, []);

  const debouncedSaveActiveVoting = useCallback((votersToSave: Voter[], gamesToSave: Record<string, Game>) => {
    if (activeDebounceRef.current) {
      clearTimeout(activeDebounceRef.current);
    }
    activeDebounceRef.current = setTimeout(async () => {
      const result = await saveActiveVotingState(votersToSave, gamesToSave);
      setSyncState(result);
    }, DEBOUNCE_MS);
  }, []);

  const debouncedSaveApiKey = useCallback((apiKey: string) => {
    if (apiKeyDebounceRef.current) {
      clearTimeout(apiKeyDebounceRef.current);
    }
    apiKeyDebounceRef.current = setTimeout(() => {
      saveApiKey(apiKey);
    }, DEBOUNCE_MS);
  }, []);

  useEffect(() => {
    if (!isLoading) {
      debouncedSaveVoters(voters);
    }
  }, [voters, isLoading, debouncedSaveVoters]);

  useEffect(() => {
    if (!isLoading) {
      debouncedSaveGames(gamesMap);
    }
  }, [gamesMap, isLoading, debouncedSaveGames]);

  useEffect(() => {
    if (!isLoading && canManageContent) {
      debouncedSaveActiveVoting(voters, gamesMap);
    }
  }, [voters, gamesMap, isLoading, canManageContent, debouncedSaveActiveVoting]);

  useEffect(() => {
    if (!isLoading) {
      debouncedSaveApiKey(steamApiKey);
    }
  }, [steamApiKey, isLoading, debouncedSaveApiKey]);

  // ─── Calcular resultados ─────────────────────────────────
  const results = useMemo(() => calculateResults(voters, gamesMap), [voters, gamesMap]);

  // ─── Calcular total de puntos asignados para determinar estado de votación ───
  const totalAssignedPoints = useMemo(() => {
    return voters.reduce((acc, voter) => {
      return acc + voter.votes.reduce((sum, vote) => sum + (vote.points || 0), 0);
    }, 0);
  }, [voters]);

  // ─── Reconciliar votos de los integrantes con gamesMap (autocorregir desalineaciones/IDs huérfanos) ───
  useEffect(() => {
    const gameIds = Object.keys(gamesMap);
    if (gameIds.length === 0 || voters.length === 0) return;

    const { changed, updatedVoters } = reconcileVoterVotes(voters, gameIds);

    if (changed) {
      Promise.resolve().then(() => {
        setVoters(updatedVoters);
      });
    }
  }, [gamesMap, voters]);

  // ─── Handlers ─────────────────────────────────────────────
  const handleUpdateVoter = useCallback((updatedVoter: Voter) => {
    setVoters((prev) => prev.map((v) => (v.id === updatedVoter.id ? updatedVoter : v)));
  }, []);

  const handleUpdateGame = useCallback((gameId: string, updatedGame: Game) => {
    setGamesMap((prev) => ({
      ...prev,
      [gameId]: updatedGame,
    }));
  }, []);

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
  }, [gamesMap]);

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
  }, [gamesMap]);

  // ─── Desbloqueo de admin vía modal BottomSheet (reemplaza window.prompt) ───
  const requestAdminUnlockViaModal = useCallback((): Promise<boolean> => {
    const state = getAdminAccessState();
    // Si ya tiene acceso (local o sesión previa), no necesita PIN
    if (state.canManageContent) {
      return Promise.resolve(true);
    }
    // Si es entorno local, desbloquea sin PIN
    if (state.isLocalEnvironment) {
      setAdminAccess(getAdminAccessState());
      return Promise.resolve(true);
    }
    // En producción: abre el modal de PIN y espera la resolución
    return new Promise<boolean>((resolve) => {
      pinModalResolveRef.current = resolve;
      setShowPinModal(true);
    });
  }, []);

  // Handler cuando el usuario envía el PIN en el modal
  const handlePinSubmit = useCallback((enteredPin: string): boolean => {
    const isValid = unlockWithPin(enteredPin);
    if (isValid) {
      setAdminAccess(getAdminAccessState());
      setShowPinModal(false);
      pinModalResolveRef.current?.(true);
      pinModalResolveRef.current = null;
    }
    // Si no es válido, retorna false para que el modal muestre el error
    return isValid;
  }, []);

  // Handler cuando el usuario cancela el modal de PIN
  const handlePinCancel = useCallback(() => {
    setShowPinModal(false);
    pinModalResolveRef.current?.(false);
    pinModalResolveRef.current = null;
  }, []);

  // Atajo de teclado Shift + Alt + A para desbloqueo de admin
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.shiftKey && event.altKey && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        // Desbloqueo asíncrono vía modal BottomSheet (reemplaza window.prompt)
        requestAdminUnlockViaModal().then((unlocked) => {
          setAdminAccess(getAdminAccessState());
          if (unlocked) {
            setIsEditMode(false);
          }
        });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [requestAdminUnlockViaModal]);

  const handleToggleEditMode = useCallback(() => {
    if (!canManageContent) {
      // Desbloqueo asíncrono vía modal BottomSheet
      requestAdminUnlockViaModal().then((unlocked) => {
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
    setVoters(updatedVoters);
    setHistory((prev) => [historyRecord, ...prev]);
    setShowFinishModal(false);

    setSyncState({ status: 'saving', message: 'Guardando...' });
    const result = await addHistoryRecord(historyRecord);
    setSyncState(result);
  }, []);

  /**
   * Revierte los cambios de Aura acumulados de múltiples votaciones,
   * devolviendo a cada votante al estado MÁS ANTIGUO (balance inicial).
   */
  const revertVotersAura = useCallback(
    (records: VotingHistoryRecord[]) => {
      setVoters((prevVoters) => {
        const reverts = buildRevertMap(records);
        return prevVoters.map((voter) => applyRevertToVoter(voter, reverts));
      });
    },
    [setVoters]
  );

  const handleClearHistory = useCallback(async () => {
    if (history.length > 0) {
      revertVotersAura(history);
    }

    setHistory([]);
    setSyncState({ status: 'saving', message: 'Limpiando...' });
    const result = await clearHistoryStore();
    setSyncState(result);
  }, [history, revertVotersAura]);

  const handleDeleteHistoryRecord = useCallback(async (recordId: string) => {
    setSyncState({ status: 'saving', message: 'Eliminando registro...' });
    const recordToDelete = history.find((r) => r.id === recordId);
    const result = await deleteHistoryRecord(recordId);
    setSyncState(result);

    if (recordToDelete?.votersSnapshots) {
      const snapshots = recordToDelete.votersSnapshots;
      setVoters((prev) => prev.map((voter) => revertVoterFromSnapshot(voter, snapshots)));
    }

    setHistory((prev) => prev.filter((r) => r.id !== recordId));

    setTimeout(() => {
      setSyncState((prev) =>
        prev.status === 'synced' && prev.message === 'Registro eliminado'
          ? { status: 'idle', message: '' }
          : prev
      );
    }, 3000);
  }, [history]);

  const handleResetData = async () => {
    if (window.confirm('¿Deseas restablecer los datos originales de todos los integrantes y juegos?')) {
      setVoters([]);
      setGamesMap({});
      setSteamApiKey('');
      setHistory([]);
      setSyncState({ status: 'saving', message: 'Restableciendo...' });
      await resetAllData();
      setSyncState({ status: 'synced', message: 'Datos restablecidos' });
    }
  };

  const handleResetAllAura = async () => {
    setVoters((prev) => prev.map(resetVoterAura));
    setSyncState({ status: 'synced', message: 'Aura restablecido para todos' });
    setTimeout(() => {
      setSyncState((prev) =>
        prev.status === 'synced' && prev.message === 'Aura restablecido para todos'
          ? { status: 'idle', message: '' }
          : prev
      );
    }, 3000);
    setShowResetAuraConfirm(false);
  };

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
    setTimeout(() => {
      setSyncState((prev) =>
        prev.status === 'synced' && prev.message === 'Backup exportado ✅'
          ? { status: 'idle', message: '' }
          : prev
      );
    }, 3000);
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

  // ─── Sincronización ───────────────────────────────────────
  const renderSyncIndicator = () => {
    if (isLoading) return null;

    const { status, message } = syncState;
    let icon: string;
    let className = 'sync-indicator';

    switch (status) {
      case 'saving':
        icon = '⏳';
        className += ' sync-saving';
        break;
      case 'synced':
        icon = '✅';
        className += ' sync-synced';
        break;
      case 'error':
        icon = '❌';
        className += ' sync-error';
        break;
      case 'local':
        icon = '💾';
        className += ' sync-local';
        break;
      default:
        return null;
    }

    return (
      <div className={className} title={message}>
        <span className="sync-icon">{icon}</span>
        <span className="sync-text">{message}</span>
      </div>
    );
  };

  // ─── Loading state ────────────────────────────────────────
  // Skeleton loaders animados que imitan la estructura del dashboard
  // mientras se realiza la lectura inicial de Firestore.
  if (isLoading) {
    return <DashboardSkeleton />;
  }

  // ─── Render principal ─────────────────────────────────────
  return (
    <div className="steam-dashboard-container">
      <div className="bg-gradient-overlay"></div>
      <div className="bg-grid-lines"></div>

      {renderSyncIndicator()}

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

      {showReadOnlyBanner && isReadOnlyMode && (
        <div className="read-only-banner">
          Modo lectura activo. Usa <strong>?admin=true</strong> o <strong>Shift + Alt + A</strong> para desbloquear edición temporal.
        </div>
      )}

      {/* Botones de acción principales */}
      <div className="top-action-navigation">
        {canManageContent && (
          <motion.button
            type="button"
            className="btn-action-primary btn-finish-voting"
            onClick={() => setShowFinishModal(true)}
            whileHover={{ scale: 1.04, y: -2 }}
            whileTap={{ scale: 0.95 }}
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
        <Header isVotingInProgress={totalAssignedPoints === 0} />

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
              <span className="title-icon">🎮</span> PONDERACIÓN POR INTEGRANTE ({voters.length} USUARIOS)
            </h2>
            <span className="voter-count-badge">
              {isEditMode ? '🖐️ Arrastrá tarjetas / Editá juegos arriba' : `${voters.length} / ${voters.length} Votantes Activos`}
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
                  draggable={true}
                  onDragStart={(e) => handleDragStart(e, index)}
                  onDragOver={(e) => handleDragOver(e, index)}
                  onDrop={(e) => handleDrop(e, index)}
                  onDragEnd={handleDragEnd}
                  isDragging={draggedIndex === index}
                  isDragOver={dragOverIndex === index}
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
        {showFinishModal && results.length > 0 && (
          <FinishVotingModal
            key="finish-modal"
            allResults={results}
            gamesMap={gamesMap}
            voters={voters}
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
            onSuccess={handlePinSubmit}
          />
        )}
      </AnimatePresence>
    </div>
  );
};
