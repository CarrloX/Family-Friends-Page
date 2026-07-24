import React from 'react';
import type { GameResult } from '../types/voting';

interface WinnerBannerProps {
  results: GameResult[];
}

export const WinnerBanner: React.FC<WinnerBannerProps> = ({ results }) => {
  const winner = results[0];
  const runnersUp = results.slice(1);

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

  console.log(`[WinnerBanner] Portada HD del ganador: ${winnerHdCover}`);
  console.log(`[WinnerBanner] Fallbacks disponibles:`, winnerCoverFallbacks);

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
              <img
                src={winnerHdCover}
                alt={winner.game.title}
                className="winner-image"
                onError={(e) => {
                  const target = e.currentTarget;
                  const currentFallback = Number.parseInt(target.dataset.fallbackLevel || '0', 10);
                  if (currentFallback < winnerCoverFallbacks.length) {
                    const nextUrl = winnerCoverFallbacks[currentFallback];
                    console.log(`[WinnerBanner] Fallback #${currentFallback + 1} para portada HD: ${nextUrl}`);
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
            let rankLabel: string;
            if (rankPosition === 2) {
              rankLabel = '2º LUGAR 🥈';
            } else if (rankPosition === 3) {
              rankLabel = '3º LUGAR 🥉';
            } else {
              rankLabel = '4º LUGAR';
            }

            return (
              <div key={result.game.id} className={`podium-card position-${rankPosition}`}>
                <div className="podium-rank">{rankLabel}</div>
                <img
                  src={result.game.coverImage}
                  alt={result.game.title}
                  className="podium-thumb"
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
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};