import React, { useState } from 'react';
import type { Voter, AuraRank, Game } from '../types/voting';
import { fetchSteamProfile, isValidSteamId64 } from '../services/steamApi';

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
}

export const UserCard: React.FC<UserCardProps> = ({
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

  // Game Points Handler
  const handlePointsChange = (gameId: string, newPoints: number) => {
    if (!onUpdateVoter) return;

    const updatedVotes = voter.votes.map((v) =>
      v.gameId === gameId ? { ...v, points: newPoints as 3 | 2 | 1 | 0 } : v
    );

    onUpdateVoter({
      ...voter,
      votes: updatedVotes,
    });
  };

  return (
    <div
      className={`user-card rank-${voter.auraRank.toLowerCase()} ${isEditMode ? 'editing-mode' : ''} ${
        isDragging ? 'is-dragging' : ''
      } ${isDragOver ? 'is-drag-over' : ''}`}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
    >
      {/* Glow highlight top corner */}
      <div className="card-ambient-glow"></div>

      {/* DRAG HANDLE INDICATOR AT TOP RIGHT */}
      <div className="drag-handle-pill" title="Arrastra para reordenar esta tarjeta">
        <span className="drag-icon">⋮⋮</span>
      </div>

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
          <img src={voter.avatar} alt={voter.name} className="user-avatar" />
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
            <div className="steam-fetch-row">
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
            </div>
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
            <label className="edit-label">✦ Estado de Aura (Calculado Automáticamente):</label>
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
            <label className="edit-label">🎮 Asignación de Puntos por Juego:</label>
            <div className="game-votes-editor">
              {voter.votes.map((vote) => {
                const game = gamesMap[vote.gameId];
                return (
                  <div key={vote.gameId} className="game-vote-edit-row">
                    <span className="game-edit-name">{game?.title || vote.gameId}</span>
                    <select
                      className="points-select"
                      value={vote.points}
                      onChange={(e) => handlePointsChange(vote.gameId, Number(e.target.value))}
                    >
                      <option value={3}>⭐ 3 Pts (Favorito)</option>
                      <option value={2}>🔷 2 Pts</option>
                      <option value={1}>🔸 1 Pt</option>
                      <option value={0}>⚪ 0 Pts</option>
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
          const is3Pts = vote.points === 3;
          const is2Pts = vote.points === 2;
          const is1Pt = vote.points === 1;
          const is0Pts = vote.points === 0;

          const weightedScore = (vote.points * voter.multiplier).toFixed(2);

          let voteItemClass = 'vote-item';
          if (is3Pts) voteItemClass += ' favorite-item';
          if (is2Pts) voteItemClass += ' medium-item';
          if (is1Pt) voteItemClass += ' low-item';
          if (is0Pts) voteItemClass += ' muted-item';

          return (
            <div key={vote.gameId} className={voteItemClass}>
              <div className="game-thumb-container">
                <img
                  src={game?.coverImage}
                  alt={game?.title}
                  className="game-thumb"
                  onError={(e) => {
                    const target = e.currentTarget;
                    if (!target.dataset.failed) {
                      target.dataset.failed = 'true';
                      if (game?.tinyCoverImage) {
                        target.src = game.tinyCoverImage;
                      } else if (game?.appId) {
                        target.src = `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${game.appId}/capsule_sm_120.jpg`;
                      }
                    }
                  }}
                />
              </div>

              <div className="vote-game-info">
                <div className="game-title-row">
                  <span className="game-title">{game.title}</span>
                  {is3Pts && <span className="favorite-badge">⭐ FAVORITO</span>}
                </div>
                <div className="vote-points-row">
                  <span className="base-pts">
                    {vote.points} {vote.points === 1 ? 'punto' : 'puntos'}
                  </span>
                  {!is0Pts && (
                    <span className="weighted-pts">
                      ➜ <strong>{weightedScore}</strong> pts
                    </span>
                  )}
                  {is0Pts && <span className="zero-pts-badge">0 Puntos</span>}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
