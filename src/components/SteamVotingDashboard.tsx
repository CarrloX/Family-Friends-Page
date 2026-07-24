import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Header } from './Header';
import { UserCard } from './UserCard';
import { WinnerBanner } from './WinnerBanner';
import { GameSearchEditor } from './GameSearchEditor';
import { FinishVotingModal } from './FinishVotingModal';
import { VotingHistoryModal } from './VotingHistoryModal';
import { DeleteUserConfirmModal } from './DeleteUserConfirmModal';
import { calculateResults } from '../data/votingData';
import type { Voter, Game, VotingHistoryRecord, AuraRank } from '../types/voting';
import { FaCog } from "react-icons/fa";
import {
  saveVoters,
  saveGames,
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

const MIN_VOTERS = 2;
const MAX_VOTERS = 6;
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
    <div className="modal-backdrop">
      <button
        type="button"
        className="modal-backdrop-close"
        onClick={onCancel}
        aria-label="Cerrar modal"
      />
      <div className="delete-confirm-modal-container">
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
      </div>
    </div>
  );
};

// ─── Componente principal ─────────────────────────────────
export const SteamVotingDashboard: React.FC = () => {
  const [voters, setVoters] = useState<Voter[]>([]);
  const [gamesMap, setGamesMap] = useState<Record<string, Game>>({});
  const [history, setHistory] = useState<VotingHistoryRecord[]>([]);
  const [steamApiKey, setSteamApiKey] = useState<string>('');

  const [isEditMode, setIsEditMode] = useState<boolean>(false);
  const [showFinishModal, setShowFinishModal] = useState<boolean>(false);
  const [showHistoryModal, setShowHistoryModal] = useState<boolean>(false);
  const [voterToDelete, setVoterToDelete] = useState<Voter | null>(null);
  const [showResetAuraConfirm, setShowResetAuraConfirm] = useState(false);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const [syncState, setSyncState] = useState<SyncState>({ status: 'idle', message: '' });

  const votersDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gamesDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const importFileInputRef = useRef<HTMLInputElement | null>(null);

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

  // ─── Sincronización con debounce ─────────────────────────
  const debouncedSaveVoters = useCallback((votersToSave: Voter[]) => {
    if (votersDebounceRef.current) {
      clearTimeout(votersDebounceRef.current);
    }
    setSyncState({ status: 'saving', message: 'Guardando...' });
    votersDebounceRef.current = setTimeout(async () => {
      const result = await saveVoters(votersToSave);
      setSyncState(result);
    }, DEBOUNCE_MS);
  }, []);

  const debouncedSaveGames = useCallback((gamesToSave: Record<string, Game>) => {
    if (gamesDebounceRef.current) {
      clearTimeout(gamesDebounceRef.current);
    }
    setSyncState({ status: 'saving', message: 'Guardando...' });
    gamesDebounceRef.current = setTimeout(async () => {
      const result = await saveGames(gamesToSave);
      setSyncState(result);
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
    if (!isLoading) {
      saveApiKey(steamApiKey);
    }
  }, [steamApiKey, isLoading]);

  // ─── Calcular resultados ─────────────────────────────────
  const results = useMemo(() => calculateResults(voters, gamesMap), [voters, gamesMap]);

  // ─── Handlers ─────────────────────────────────────────────
  const handleUpdateVoter = (updatedVoter: Voter) => {
    setVoters((prev) => prev.map((v) => (v.id === updatedVoter.id ? updatedVoter : v)));
  };

  const handleUpdateGame = (gameId: string, updatedGame: Game) => {
    setGamesMap((prev) => ({
      ...prev,
      [gameId]: updatedGame,
    }));
  };

  const handleConfirmFinishVoting = async (
    updatedVoters: Voter[],
    historyRecord: VotingHistoryRecord
  ) => {
    setVoters(updatedVoters);
    setHistory((prev) => [historyRecord, ...prev]);
    setShowFinishModal(false);

    setSyncState({ status: 'saving', message: 'Guardando...' });
    const result = await addHistoryRecord(historyRecord);
    setSyncState(result);
  };

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

  const handleClearHistory = async () => {
    if (history.length > 0) {
      revertVotersAura(history);
    }

    setHistory([]);
    setSyncState({ status: 'saving', message: 'Limpiando...' });
    const result = await clearHistoryStore();
    setSyncState(result);
  };

  const handleDeleteHistoryRecord = async (recordId: string) => {
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
  };

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
        points: 0 as const,
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
    let icon = '';
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
  if (isLoading) {
    return (
      <div className="steam-dashboard-container">
        <div className="bg-gradient-overlay"></div>
        <div className="bg-grid-lines"></div>
        <div className="loading-container">
          <div className="loading-spinner"></div>
          <p className="loading-text">Cargando datos...</p>
        </div>
      </div>
    );
  }

  // ─── Render principal ─────────────────────────────────────
  return (
    <div className="steam-dashboard-container">
      <div className="bg-gradient-overlay"></div>
      <div className="bg-grid-lines"></div>

      {renderSyncIndicator()}

      {/* Botón de modo edición oculto */}
      <button
        type="button"
        className={`hidden-gear-btn ${isEditMode ? 'active' : ''}`}
        onClick={() => setIsEditMode(!isEditMode)}
        title={isEditMode ? 'Desactivar Modo Edición' : 'Activar Modo Edición (Oculto)'}
        aria-label="Modo Edición"
      >
        <FaCog size={20} />
      </button>

      {/* Botones de acción principales */}
      <div className="top-action-navigation">
        <button
          type="button"
          className="btn-action-primary btn-finish-voting"
          onClick={() => setShowFinishModal(true)}
        >
          🏆 Finalizar Votación
        </button>

        <button
          type="button"
          className="btn-action-secondary btn-view-history"
          onClick={() => setShowHistoryModal(true)}
        >
          📜 Historial ({history.length})
        </button>
      </div>

      {/* Barra de edición */}
      {isEditMode && (
        <div className="edit-mode-top-bar">
          <div className="edit-bar-left">
            <span className="edit-badge">⚙️ MODO EDICIÓN ACTIVO</span>
            <span className="edit-help-text">
              Buscá juegos en Steam, edita perfiles y arrastrá tarjetas. Autoguardado activo.
            </span>
          </div>

          <div className="edit-bar-controls">
            <button
              type="button"
              className="btn-add-voter"
              onClick={handleAddVoter}
              disabled={voters.length >= MAX_VOTERS}
              title={voters.length >= MAX_VOTERS ? `Máximo de ${MAX_VOTERS} integrantes alcanzado (límite Steam Families)` : 'Añadir nuevo integrante'}
            >
              ➕ Añadir Integrante ({voters.length}/{MAX_VOTERS})
            </button>

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
              <button
                type="button"
                className="btn-backup btn-export"
                onClick={handleExportBackup}
                title="Descargar backup completo en JSON"
              >
                📥 Exportar Backup
              </button>
              <button
                type="button"
                className="btn-backup btn-import"
                onClick={handleImportClick}
                title="Restaurar datos desde un archivo JSON"
              >
                📤 Importar Backup
              </button>
              <input
                ref={importFileInputRef}
                type="file"
                accept=".json"
                onChange={handleImportFileChange}
                style={{ display: 'none' }}
              />
            </div>

            <button type="button" className="btn-reset-data" onClick={handleResetData}>
              Restablecer
            </button>

            <button
              type="button"
              className="btn-reset-aura"
              onClick={() => setShowResetAuraConfirm(true)}
              title="Restablece el Aura de todos los integrantes a Socio Regular (0 Cuotas, 1.0x)"
            >
              🔄 Restablecer Aura
            </button>

            <button
              type="button"
              className="btn-save-edit"
              onClick={() => setIsEditMode(false)}
            >
              ✓ Guardar / Listo
            </button>
          </div>
        </div>
      )}

      {/* Contenido principal */}
      <div className="dashboard-content">
        <Header />

        {isEditMode && (
          <GameSearchEditor gamesMap={gamesMap} onUpdateGame={handleUpdateGame} />
        )}

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
          </div>
        </section>

        <WinnerBanner results={results} />

        <footer className="steam-footer">
          <p>© 2026 Steam Co-Op Game Voting • Diseñado con paleta oficial de Steam & Acentos Neón</p>
        </footer>
      </div>

      {/* Modales */}
      {showFinishModal && results.length > 0 && (
        <FinishVotingModal
          allResults={results}
          gamesMap={gamesMap}
          voters={voters}
          onConfirmFinish={handleConfirmFinishVoting}
          onClose={() => setShowFinishModal(false)}
        />
      )}

      {showHistoryModal && (
        <VotingHistoryModal
          history={history}
          onClearHistory={handleClearHistory}
          onDeleteRecord={handleDeleteHistoryRecord}
          onClose={() => setShowHistoryModal(false)}
        />
      )}

      {voterToDelete && (
        <DeleteUserConfirmModal
          voter={voterToDelete}
          onCancel={handleCancelDeleteVoter}
          onConfirm={handleConfirmDeleteVoter}
        />
      )}

      {showResetAuraConfirm && (
        <ResetAuraConfirmModal
          onConfirm={handleResetAllAura}
          onCancel={() => setShowResetAuraConfirm(false)}
        />
      )}
    </div>
  );
};