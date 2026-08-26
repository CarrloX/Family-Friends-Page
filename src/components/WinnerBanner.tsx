import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FaGamepad } from 'react-icons/fa';
import type { GameResult } from '../types/voting';
import { getMaxVotePoints } from '../types/voting';

interface WinnerBannerProps {
  results: GameResult[];
  votersCount?: number;
  totalAssignedPoints?: number;
}

export const WinnerBanner: React.FC<WinnerBannerProps> = React.memo(({
  results,
  votersCount = 0,
  totalAssignedPoints,
}) => {
  const winner = results[0];
  const runnersUp = results.slice(1);
  const maxPoints = getMaxVotePoints(results.length);
  const totalVoters = votersCount;

  // Detect whether any member has assigned points
  const hasVotes = totalAssignedPoints !== undefined
    ? totalAssignedPoints > 0
    : results.some((r) => r.rawPoints > 0 || r.weightedPoints > 0);

  // High-Definition Steam Cover (616x353 HD capsule) for 1st Place Winner
  const appId = winner?.game?.appId;
  const cdnBase = 'https://cdn.akamai.steamstatic.com/steam/apps';
  const winnerHdCover = appId
    ? `${cdnBase}/${appId}/capsule_616x353.jpg`
    : winner?.game?.coverImage;

  // Fallback chain for winner cover: HD → header → small capsule → coverImage → tinyCoverImage
  const winnerCoverFallbacks: string[] = [];
  if (appId) {
    winnerCoverFallbacks.push(
      `${cdnBase}/${appId}/header.jpg`,
      `${cdnBase}/${appId}/capsule_sm_120.jpg`
    );
  }
  if (winner?.game?.coverImage) winnerCoverFallbacks.push(winner.game.coverImage);
  if (winner?.game?.tinyCoverImage) winnerCoverFallbacks.push(winner.game.tinyCoverImage);

  return (
    <section className="winner-section">
      <AnimatePresence mode="wait">
        {!hasVotes || !winner?.game ? (
          /* ─── ESTADO 1: EN VOTACIÓN (0 PUNTOS REGISTRADOS) ─── */
          <motion.div
            key="voting-in-progress-view"
            className="voting-progress-banner-glow"
            initial={{ opacity: 0, scale: 0.97, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: -12 }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="voting-progress-banner">
              <div className="voting-progress-header-row">
                <div className="voting-live-pill">
                  <span className="live-pulse-dot"></span>
                  <span>EN VOTACIÓN • EN TIEMPO REAL</span>
                </div>
                <div className="voting-status-chip">
                  ⚖️ Ponderación de Aura Activa
                </div>
              </div>

              <div className="voting-progress-body">
                <div className="voting-radar-visual">
                  <div className="radar-ring"></div>
                  <div className="radar-ring"></div>
                  <div className="radar-ring"></div>
                  <div className="radar-center-core">
                    <FaGamepad className="radar-gamepad-icon" />
                  </div>
                </div>

                <div className="voting-progress-content">
                  <h2 className="voting-progress-title">VOTACIÓN EN CURSO</h2>
                  <p className="voting-progress-desc">
                    Ningún integrante ha asignado puntos todavía. Califica tus juegos favoritos
                    en las tarjetas para descubrir al líder provisorio en tiempo real.
                  </p>

                  <div className="voting-metrics-grid">
                    <div className="voting-metric-card">
                      <span className="metric-label">INTEGRANTES</span>
                      <span className="metric-value">{totalVoters} convocados</span>
                    </div>
                    <div className="voting-metric-card">
                      <span className="metric-label">JUEGOS EN LISTA</span>
                      <span className="metric-value">{results.length} propuestos</span>
                    </div>
                    <div className="voting-metric-card">
                      <span className="metric-label">ESTADO DE VOTOS</span>
                      <span className="metric-value highlight">0 PTS registrados</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="voting-instruction-hint">
                <span>👇</span>
                <span>Asigna puntos en las tarjetas de abajo para proyectar al ganador en vivo</span>
              </div>
            </div>
          </motion.div>
        ) : (
          /* ─── ESTADO 2: JUEGO GANADOR / LÍDER PROVISORIO CON VOTOS ─── */
          <motion.div
            key="winner-results-view"
            className="winner-view-wrapper"
            style={{ width: '100%' }}
            initial={{ opacity: 0, scale: 0.97, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: -12 }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
          >
            {/* Featured Winner Card */}
            <div className="winner-banner-glow">
              <div className="winner-banner">
                <div className="winner-trophy-tag">
                  <span className="trophy-icon">🏆</span>
                  <span className="trophy-text">JUEGO GANADOR DE LA VOTACIÓN</span>
                </div>

                <div className="winner-content">
                  <div className="winner-image-container">
                    <img
                      src={winnerHdCover}
                      alt={winner.game.title}
                      className="winner-image"
                      loading="lazy"
                      onError={(e) => {
                        const target = e.currentTarget;
                        const currentFallback = Number.parseInt(target.dataset.fallbackLevel || '0', 10);
                        if (currentFallback < winnerCoverFallbacks.length) {
                          const nextUrl = winnerCoverFallbacks[currentFallback];
                          target.dataset.fallbackLevel = String(currentFallback + 1);
                          target.src = nextUrl;
                        }
                      }}
                    />
                    <div className="winner-badge-overlay">1º LUGAR</div>
                  </div>

                  <div className="winner-details">
                    <div className="winner-genre">{winner.game.genre}</div>
                    <h2 className="winner-title">{winner.game.title}</h2>
                    <p className="winner-description">{winner.game.description}</p>

                    <div className="winner-stats-grid">
                      <motion.div
                        className="stat-card primary-stat"
                        whileHover={{ scale: 1.03 }}
                        whileTap={{ scale: 0.97 }}
                      >
                        <span className="stat-label">TOTAL PUNTOS PONDERADOS</span>
                        <span className="stat-value">{winner.weightedPoints} <small>PTS</small></span>
                      </motion.div>

                      <motion.div
                        className="stat-card"
                        whileHover={{ scale: 1.03 }}
                        whileTap={{ scale: 0.97 }}
                      >
                        <span className="stat-label">VOTOS DE FAVORITO ({maxPoints} PTS)</span>
                        <span className="stat-value">{winner.firstPlaceVotes} <small>/ {totalVoters} integrantes</small></span>
                      </motion.div>

                      <motion.div
                        className="stat-card"
                        whileHover={{ scale: 1.03 }}
                        whileTap={{ scale: 0.97 }}
                      >
                        <span className="stat-label">PUNTOS BRUTOS</span>
                        <span className="stat-value">{winner.rawPoints} <small>PTS</small></span>
                      </motion.div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Podium / Runner ups */}
            {runnersUp.length > 0 && (
              <div className="podium-container">
                <h4 className="podium-heading">TABLA DE POSICIONES FINAL</h4>
                <div className="podium-grid">
                  {runnersUp.map((result, idx) => {
                    const rankPosition = idx + 2;
                    let rankLabel: string;
                    if (rankPosition === 2) {
                      rankLabel = '2º LUGAR 🥈';
                    } else if (rankPosition === 3) {
                      rankLabel = '3º LUGAR 🥉';
                    } else {
                      rankLabel = `${rankPosition}º LUGAR`;
                    }

                    return (
                      <motion.div
                        key={result.game.id}
                        layout
                        className={`podium-card position-${rankPosition}`}
                        whileHover={{ scale: 1.02, y: -3 }}
                        whileTap={{ scale: 0.97 }}
                        transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                      >
                        <div className="podium-rank">{rankLabel}</div>
                        <img
                          src={result.game.coverImage}
                          alt={result.game.title}
                          className="podium-thumb"
                          loading="lazy"
                          onError={(e) => {
                            const target = e.currentTarget;
                            if (!target.dataset.failed) {
                              target.dataset.failed = 'true';
                              if (result.game?.tinyCoverImage) {
                                target.src = result.game.tinyCoverImage;
                              } else if (result.game?.appId) {
                                target.src = `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${result.game.appId}/capsule_sm_120.jpg`;
                              }
                            }
                          }}
                        />
                        <div className="podium-info">
                          <span className="podium-title">{result.game.title}</span>
                          <span className="podium-score">
                            <strong>{result.weightedPoints}</strong> pts ponderados ({result.rawPoints} pts base)
                          </span>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
});
