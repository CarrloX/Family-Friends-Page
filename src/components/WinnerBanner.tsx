import React from 'react';
import type { GameResult } from '../types/voting';

interface WinnerBannerProps {
  results: GameResult[];
}

export const WinnerBanner: React.FC<WinnerBannerProps> = ({ results }) => {
  const winner = results[0];
  const runnersUp = results.slice(1);

  return (
    <section className="winner-section">
      {/* Featured Winner Card */}
      <div className="winner-banner-glow">
        <div className="winner-banner">
          <div className="winner-trophy-tag">
            <span className="trophy-icon">🏆</span>
            <span className="trophy-text">JUEGO GANADOR DE LA VOTACIÓN</span>
          </div>

          <div className="winner-content">
            <div className="winner-image-container">
              <img src={winner.game.coverImage} alt={winner.game.title} className="winner-image" />
              <div className="winner-badge-overlay">1º LUGAR</div>
            </div>

            <div className="winner-details">
              <div className="winner-genre">{winner.game.genre}</div>
              <h2 className="winner-title">{winner.game.title}</h2>
              <p className="winner-description">{winner.game.description}</p>

              <div className="winner-stats-grid">
                <div className="stat-card primary-stat">
                  <span className="stat-label">TOTAL PUNTOS PONDERADOS</span>
                  <span className="stat-value">{winner.weightedPoints} <small>PTS</small></span>
                </div>

                <div className="stat-card">
                  <span className="stat-label">VOTOS DE FAVORITO (3 PTS)</span>
                  <span className="stat-value">{winner.firstPlaceVotes} <small>/ 5 integrantes</small></span>
                </div>

                <div className="stat-card">
                  <span className="stat-label">PUNTOS BRUTOS</span>
                  <span className="stat-value">{winner.rawPoints} <small>PTS</small></span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Podium / Runner ups */}
      <div className="podium-container">
        <h4 className="podium-heading">TABLA DE POSICIONES FINAL</h4>
        <div className="podium-grid">
          {runnersUp.map((result, idx) => {
            const rankPosition = idx + 2;
            const rankLabel = rankPosition === 2 ? '2º LUGAR 🥈' : rankPosition === 3 ? '3º LUGAR 🥉' : '4º LUGAR';

            return (
              <div key={result.game.id} className={`podium-card position-${rankPosition}`}>
                <div className="podium-rank">{rankLabel}</div>
                <img src={result.game.coverImage} alt={result.game.title} className="podium-thumb" />
                <div className="podium-info">
                  <span className="podium-title">{result.game.title}</span>
                  <span className="podium-score">
                    <strong>{result.weightedPoints}</strong> pts ponderados ({result.rawPoints} pts base)
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};
