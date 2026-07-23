import React, { useState, useEffect, useMemo } from 'react';
import { Header } from './Header';
import { UserCard } from './UserCard';
import { WinnerBanner } from './WinnerBanner';
import { GameSearchEditor } from './GameSearchEditor';
import { FinishVotingModal } from './FinishVotingModal';
import { VotingHistoryModal } from './VotingHistoryModal';
import { VOTERS, GAMES, calculateResults } from '../data/votingData';
import type { Voter, Game, VotingHistoryRecord } from '../types/voting';

const LOCAL_STORAGE_KEY_VOTERS = 'steam_voting_voters_v1';
const LOCAL_STORAGE_KEY_API_KEY = 'steam_voting_api_key_v1';
const LOCAL_STORAGE_KEY_GAMES = 'steam_voting_games_v1';
const LOCAL_STORAGE_KEY_HISTORY = 'steam_voting_history_v1';

export const SteamVotingDashboard: React.FC = () => {
  // Load initial voters from localStorage cache if present
  const [voters, setVoters] = useState<Voter[]>(() => {
    try {
      const savedVoters = localStorage.getItem(LOCAL_STORAGE_KEY_VOTERS);
      const savedHistory = localStorage.getItem(LOCAL_STORAGE_KEY_HISTORY);
      const historyIsEmpty =
        !savedHistory ||
        (() => {
          try {
            const h = JSON.parse(savedHistory);
            return !Array.isArray(h) || h.length === 0;
          } catch {
            return true;
          }
        })();

      if (savedVoters) {
        const parsed = JSON.parse(savedVoters);
        if (Array.isArray(parsed) && parsed.length > 0) {
          // If there are no voting records yet, reset Aura to neutral baseline
          if (historyIsEmpty) {
            return parsed.map((v) => ({
              ...v,
              auraRank: 'Socio Regular',
              auraQuotaBalance: 0,
              multiplier: 1.0,
            }));
          }
          return parsed;
        }
      }
    } catch (err) {
      console.warn('No se pudo cargar el caché de localStorage:', err);
    }
    return VOTERS;
  });

  // Load initial games dictionary from localStorage cache if present
  const [gamesMap, setGamesMap] = useState<Record<string, Game>>(() => {
    try {
      const saved = localStorage.getItem(LOCAL_STORAGE_KEY_GAMES);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) {
          // Clean stale USD prices from old cache
          Object.keys(parsed).forEach((key) => {
            if (parsed[key]?.genre && /^\$\d+(\.\d{2})?$/.test(parsed[key].genre.trim())) {
              parsed[key].genre = 'Actualizar en Modo Edición';
            }
          });
          return parsed;
        }
      }
    } catch (err) {
      console.warn('No se pudo cargar juegos de localStorage:', err);
    }
    return GAMES;
  });

  // Load initial voting history from localStorage cache if present
  const [history, setHistory] = useState<VotingHistoryRecord[]>(() => {
    try {
      const saved = localStorage.getItem(LOCAL_STORAGE_KEY_HISTORY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (err) {
      console.warn('No se pudo cargar historial de localStorage:', err);
    }
    return [];
  });

  const [isEditMode, setIsEditMode] = useState<boolean>(false);
  const [showFinishModal, setShowFinishModal] = useState<boolean>(false);
  const [showHistoryModal, setShowHistoryModal] = useState<boolean>(false);

  // Load initial API key from localStorage cache if present
  const [steamApiKey, setSteamApiKey] = useState<string>(() => {
    try {
      return localStorage.getItem(LOCAL_STORAGE_KEY_API_KEY) || '';
    } catch {
      return '';
    }
  });

  // Drag & Drop State
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  // Automatically save voters state to localStorage on every change
  useEffect(() => {
    try {
      localStorage.setItem(LOCAL_STORAGE_KEY_VOTERS, JSON.stringify(voters));
    } catch (err) {
      console.warn('Error guardando caché de votantes:', err);
    }
  }, [voters]);

  // Automatically save games map to localStorage on every change
  useEffect(() => {
    try {
      localStorage.setItem(LOCAL_STORAGE_KEY_GAMES, JSON.stringify(gamesMap));
    } catch (err) {
      console.warn('Error guardando caché de juegos:', err);
    }
  }, [gamesMap]);

  // Automatically save voting history to localStorage on every change
  useEffect(() => {
    try {
      localStorage.setItem(LOCAL_STORAGE_KEY_HISTORY, JSON.stringify(history));
    } catch (err) {
      console.warn('Error guardando historial:', err);
    }
  }, [history]);

  // Automatically save API key to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(LOCAL_STORAGE_KEY_API_KEY, steamApiKey);
    } catch (err) {
      console.warn('Error guardando API key:', err);
    }
  }, [steamApiKey]);

  // Calculate live results based on dynamic voters and games state
  const results = useMemo(() => calculateResults(voters, gamesMap), [voters, gamesMap]);

  const handleUpdateVoter = (updatedVoter: Voter) => {
    setVoters((prev) => prev.map((v) => (v.id === updatedVoter.id ? updatedVoter : v)));
  };

  const handleUpdateGame = (gameId: string, updatedGame: Game) => {
    setGamesMap((prev) => ({
      ...prev,
      [gameId]: updatedGame,
    }));
  };

  const handleConfirmFinishVoting = (
    updatedVoters: Voter[],
    historyRecord: VotingHistoryRecord
  ) => {
    setVoters(updatedVoters);
    setHistory((prev) => [historyRecord, ...prev]);
    setShowFinishModal(false);
  };

  const handleClearHistory = () => {
    setHistory([]);
    try {
      localStorage.removeItem(LOCAL_STORAGE_KEY_HISTORY);
    } catch (err) {
      console.warn('Error al borrar historial:', err);
    }
  };

  const handleResetData = () => {
    if (window.confirm('¿Deseas restablecer los datos originales de todos los integrantes y juegos?')) {
      setVoters(VOTERS);
      setGamesMap(GAMES);
      setSteamApiKey('');
      try {
        localStorage.removeItem(LOCAL_STORAGE_KEY_VOTERS);
        localStorage.removeItem(LOCAL_STORAGE_KEY_GAMES);
        localStorage.removeItem(LOCAL_STORAGE_KEY_API_KEY);
      } catch (err) {
        console.warn('Error al limpiar localStorage:', err);
      }
    }
  };

  // Drag and Drop Handlers
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

  const handleDragEnd = () => {
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  return (
    <div className="steam-dashboard-container">
      {/* Background Steam Particles & Gradients */}
      <div className="bg-gradient-overlay"></div>
      <div className="bg-grid-lines"></div>

      {/* DISCRETE HIDDEN EDIT MODE TOGGLE BUTTON (TOP-RIGHT CORNER) */}
      <button
        type="button"
        className={`hidden-gear-btn ${isEditMode ? 'active' : ''}`}
        onClick={() => setIsEditMode(!isEditMode)}
        title={isEditMode ? 'Desactivar Modo Edición' : 'Activar Modo Edición (Oculto)'}
        aria-label="Modo Edición"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="3"></circle>
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
        </svg>
      </button>

      {/* ACTION BAR: FINISH VOTING & HISTORY BUTTONS */}
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

      {/* TOP EDIT MODE CONTROL BAR */}
      {isEditMode && (
        <div className="edit-mode-top-bar">
          <div className="edit-bar-left">
            <span className="edit-badge">⚙️ MODO EDICIÓN ACTIVO</span>
            <span className="edit-help-text">
              Buscá juegos en Steam, edita perfiles y arrastrá tarjetas. Autoguardado activo.
            </span>
          </div>

          <div className="edit-bar-controls">
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

            <button type="button" className="btn-reset-data" onClick={handleResetData}>
              Restablecer
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

      <div className="dashboard-content">
        <Header />

        {/* DYNAMIC STEAM GAME SEARCH & EDITOR (ONLY IN EDIT MODE) */}
        {isEditMode && (
          <GameSearchEditor gamesMap={gamesMap} onUpdateGame={handleUpdateGame} />
        )}

        {/* 5 User Cards Grid */}
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
              />
            ))}
          </div>
        </section>

        {/* Winner Banner & Final Leaderboard */}
        <WinnerBanner results={results} />

        {/* Footer */}
        <footer className="steam-footer">
          <p>© 2026 Steam Co-Op Game Voting • Diseñado con paleta oficial de Steam & Acentos Neón</p>
        </footer>
      </div>

      {/* FINISH VOTING MODAL */}
      {showFinishModal && results.length > 0 && (
        <FinishVotingModal
          allResults={results}
          gamesMap={gamesMap}
          voters={voters}
          onConfirmFinish={handleConfirmFinishVoting}
          onClose={() => setShowFinishModal(false)}
        />
      )}

      {/* VOTING HISTORY MODAL */}
      {showHistoryModal && (
        <VotingHistoryModal
          history={history}
          onClearHistory={handleClearHistory}
          onClose={() => setShowHistoryModal(false)}
        />
      )}
    </div>
  );
};
