import React, { useState } from 'react';
import { motion } from 'framer-motion';
import type { Voter, AuraRank, Game } from '../types/voting';
import { getVotePointOptions } from '../types/voting';
import { fetchSteamProfile, isValidSteamId64 } from '../services/steamApi';
import { FaTimes } from "react-icons/fa";
import { VoteItem } from './VoteItem';

interface UserCardProps {
  voter: Voter;
  gamesMap?: Record<string, Game>;
  isEditMode?: boolean;
  apiKey?: string;
  onUpdateVoter?: (updatedVoter: Voter) => void;
  // Drag & drop props
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
  onDragEnd?: (e: React.DragEvent) => void;
  isDragging?: boolean;
  isDragOver?: boolean;
  // Delete user props
  onRequestDelete?: (voter: Voter) => void;
  canDelete?: boolean;
}

export const UserCard: React.FC<UserCardProps> = React.memo(({
  voter,
  gamesMap = {} as Record<string, Game>,
  isEditMode = false,
  apiKey = '',
  onUpdateVoter,
  draggable = true,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  isDragging = false,
  isDragOver = false,
  onRequestDelete,
  canDelete = true,
}) => {
  const [steamInput, setSteamInput] = useState(voter.steamId64 || '');
  const [isLoadingSteam, setIsLoadingSteam] = useState(false);
  const [steamStatus, setSteamStatus] = useState<{ type: 'success' | 'error' | 'info' | null; msg: string | null }>({
    type: null,
    msg: null,
  });
  const [customAvatarUrl, setCustomAvatarUrl] = useState('');

  const getBadgeClass = (rank: AuraRank) => {
    switch (rank) {
      case 'Socio VIP':
      case 'VIP':
        return 'aura-badge vip';
      case 'Socio Regular':
      case 'Regular':
        return 'aura-badge regular';
      case 'En Observación':
      case 'Observación':
        return 'aura-badge observacion';
      case 'Voto Mínimo':
        return 'aura-badge minimo';
      case 'Congelado':
        return 'aura-badge congelado';
      default:
        return 'aura-badge';
    }
  };

  // Steam API Auto-fetch handler
  const handleFetchSteam = async () => {
    if (!steamInput.trim()) {
      setSteamStatus({ type: 'error', msg: 'Ingresa un SteamID64.' });
      return;
    }

    if (!isValidSteamId64(steamInput)) {
      setSteamStatus({
        type: 'info',
        msg: 'ID de 17 dígitos no detectado. Intentando consulta...',
      });
    }

    setIsLoadingSteam(true);
    setSteamStatus({ type: null, msg: null });

    const result = await fetchSteamProfile(steamInput, apiKey);
    setIsLoadingSteam(false);

    if (result.success && onUpdateVoter) {
      onUpdateVoter({
        ...voter,
        steamId64: result.steamId64,
        name: result.personaname || voter.name,
        avatar: result.avatarfull || voter.avatar,
      });
      setSteamStatus({ type: 'success', msg: '¡Perfil cargado con éxito!' });
    } else {
      if (onUpdateVoter && result.avatarfull) {
        onUpdateVoter({
          ...voter,
          steamId64: result.steamId64,
          name: result.personaname || voter.name,
          avatar: result.avatarfull,
        });
      }
      setSteamStatus({
        type: 'error',
        msg: result.error || 'No se pudo cargar desde Steam API. Se usó avatar fallback.',
      });
    }
  };

  // Local File Avatar Upload
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && onUpdateVoter) {
      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
          onUpdateVoter({
            ...voter,
            avatar: event.target.result as string,
          });
        }
      };
      reader.readAsDataURL(file);
    }
  };

  // Avatar URL apply
  const handleApplyUrl = () => {
    if (customAvatarUrl.trim() && onUpdateVoter) {
      onUpdateVoter({
        ...voter,
        avatar: customAvatarUrl.trim(),
      });
      setCustomAvatarUrl('');
    }
  };

  // Game Points Handler (proporcional a la cantidad de juegos)
  const handlePointsChange = (gameId: string, newPoints: number) => {
    if (!onUpdateVoter) return;

    const updatedVotes = voter.votes.map((v) =>
      v.gameId === gameId ? { ...v, points: newPoints } : v
    );

    onUpdateVoter({
      ...voter,
      votes: updatedVotes,
    });
  };

  const gameCount = Object.keys(gamesMap).length;
  const pointOptions = getVotePointOptions(gameCount);
  const maxPoints = pointOptions[0] ?? 0;

  // Sanitizar puntos existentes: si un voto tiene un valor mayor al máximo actual
  // (por ejemplo, tras eliminar juegos), se muestra 0 para evitar selects fuera de rango.
  const sanitizedVotes = voter.votes.map((v) => ({
    ...v,
    points: v.points > maxPoints ? 0 : v.points,
  }));
  const displayVotes = sanitizedVotes;

  return (
    <motion.div
      layout
      layoutId={`user-card-${voter.id}`}
      className={`user-card rank-${voter.auraRank.toLowerCase()} ${isEditMode ? 'editing-mode' : ''} ${
        isDragging ? 'is-dragging' : ''
      } ${isDragOver ? 'is-drag-over' : ''}`}
      draggable={draggable}
      onDragStart={onDragStart as any}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd as any}
      initial={{ opacity: 0, y: 20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.2 } }}
      transition={{ type: 'spring', stiffness: 350, damping: 25 }}
      whileHover={!isDragging ? { y: -4, transition: { duration: 0.2 } } : undefined}
    >
      {/* Glow highlight top corner */}
      <div className="card-ambient-glow"></div>

      {/* DRAG HANDLE INDICATOR AT TOP RIGHT */}
      <div className="drag-handle-pill" title="Arrastra para reordenar esta tarjeta">
        <span className="drag-icon">⋮⋮</span>
      </div>

      {/* DELETE USER BUTTON (only visible in edit mode) */}
      {isEditMode && onRequestDelete && (
        <button
          type="button"
          className="delete-voter-btn"
          onClick={() => onRequestDelete(voter)}
          disabled={!canDelete}
          title={
            !canDelete
              ? `Debe haber al menos 2 integrantes en el grupo`
              : `Eliminar a ${voter.name} del grupo`
          }
          aria-label={`Eliminar a ${voter.name}`}
        >
          <FaTimes />
        </button>
      )}

      {/* Edit Mode Badge Header inside Card if editing */}
      {isEditMode && (
        <div className="card-edit-header">
          <span className="edit-card-tag">✏️ EDITANDO INTEGRANTE</span>
          <span className="voter-id-label">ID: {voter.id}</span>
        </div>
      )}

      {/* Header Info */}
      <div className="card-header">
        <div className="avatar-wrapper">
          <img key={voter.avatar} src={voter.avatar} alt={voter.name} className="user-avatar" loading="lazy" />
        </div>

        <div className="user-meta">
          <h3 className="user-name">{voter.name}</h3>
          <div className="aura-wrapper">
            <span className={getBadgeClass(voter.auraRank)}>
              <span className="badge-icon">✦</span> {voter.auraRank} ({voter.multiplier}x)
            </span>
          </div>
        </div>
      </div>

      <div className="multiplier-bar">
        <span className="multiplier-label">
          SALDO DE AURA ({voter.auraQuotaBalance >= 0 ? `+${voter.auraQuotaBalance}` : voter.auraQuotaBalance} Cuota{Math.abs(voter.auraQuotaBalance) === 1 ? '' : 's'}):
        </span>
        <span className="multiplier-value">{voter.multiplier}x Ponderación</span>
      </div>

      {/* EDIT MODE CONTROLS */}
      {isEditMode && (
        <div className="card-edit-panel">
          <div className="edit-field-group">
            <label htmlFor="steam-id-input" className="edit-label">🌐 SteamID64 (Auto-Perfil Steam):</label>
            <input
              id="steam-id-input"
              type="text"
              className="edit-input"
              placeholder="Ej: 76561198000000001"
              value={steamInput}
              onChange={(e) => setSteamInput(e.target.value)}
            />
            <button
              type="button"
              className="steam-fetch-btn"
              onClick={handleFetchSteam}
              disabled={isLoadingSteam}
            >
              {isLoadingSteam ? 'Cargando...' : 'Cargar Steam'}
            </button>
            {steamStatus.msg && (
              <div className={`steam-status-msg ${steamStatus.type}`}>{steamStatus.msg}</div>
            )}
          </div>

          <div className="edit-field-group">
            <label htmlFor="voter-name-input" className="edit-label">👤 Nombre de usuario:</label>
            <input
              id="voter-name-input"
              type="text"
              className="edit-input"
              value={voter.name}
              onChange={(e) => onUpdateVoter?.({ ...voter, name: e.target.value })}
            />
          </div>

          <div className="edit-field-group">
            <label htmlFor="voter-avatar-url" className="edit-label">🖼️ Cambiar Foto de Avatar:</label>
            <div className="avatar-options-grid">
              <label className="file-upload-btn">
                <span>📁 Subir desde equipo</span>
                <input type="file" accept="image/*" onChange={handleFileUpload} />
              </label>
              <div className="url-avatar-row">
                <input
                  id="voter-avatar-url"
                  type="text"
                  className="edit-input small-input"
                  placeholder="O pegar URL de imagen..."
                  value={customAvatarUrl}
                  onChange={(e) => setCustomAvatarUrl(e.target.value)}
                />
                <button type="button" className="apply-url-btn" onClick={handleApplyUrl}>
                  Ok
                </button>
              </div>
            </div>
          </div>

          <div className="edit-field-group">
            <span className="edit-label">✦ Estado de Aura (Calculado Automáticamente):</span>
            <div className="edit-aura-info-box">
              <span className={getBadgeClass(voter.auraRank)}>
                <span className="badge-icon">✦</span> {voter.auraRank} ({voter.multiplier}x)
              </span>
              <span className="aura-balance-pill">
                Saldo: <strong>{voter.auraQuotaBalance >= 0 ? `+${voter.auraQuotaBalance}` : voter.auraQuotaBalance} Cuotas</strong>
              </span>
            </div>
          </div>

          <div className="edit-field-group">
            <span className="edit-label">🎮 Asignación de Puntos por Juego:</span>
            <div className="game-votes-editor">
              {displayVotes.map((vote) => {
                const game = gamesMap[vote.gameId];
                return (
                  <div key={vote.gameId} className="game-vote-edit-row">
                    <span className="game-edit-name">{game?.title || vote.gameId}</span>
                    <select
                      className="points-select"
                      value={vote.points}
                      onChange={(e) => handlePointsChange(vote.gameId, Number(e.target.value))}
                    >
                      {pointOptions.map((pts) => {
                        let label = `🔸 ${pts} Pts`;
                        if (pts === maxPoints) {
                          label = `⭐ ${pts} Pts (Favorito)`;
                        } else if (pts === 0) {
                          label = '⚪ 0 Pts';
                        }
                        return (
                          <option key={pts} value={pts}>
                            {label}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* NORMAL VOTES DISPLAY */}
      <div className="votes-list">
        {voter.votes.map((vote) => {
          const game = gamesMap[vote.gameId];
          return (
            <VoteItem
              key={vote.gameId}
              vote={vote}
              game={game}
              multiplier={voter.multiplier}
              maxPoints={maxPoints}
            />
          );
        })}
      </div>
    </motion.div>
  );
});
