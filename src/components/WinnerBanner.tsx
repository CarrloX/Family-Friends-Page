import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FaGamepad, FaSteam } from 'react-icons/fa';
import type { GameResult, SteamPriceInfo } from '../types/voting';
import { getMaxVotePoints } from '../types/voting';
import { fetchSteamGameDetails } from '../services/steamStoreApi';
import { GameThumbnail } from './GameThumbnail';
import { getGameImageFallbacks } from '../utils/steamImages';

interface WinnerBannerProps {
  results: GameResult[];
  votersCount?: number;
  totalAssignedPoints?: number;
}

const VotingInProgressView: React.FC<{ totalVoters: number; resultsCount: number }> = ({
  totalVoters,
  resultsCount,
}) => (
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
              <span className="metric-value">{resultsCount} propuestos</span>
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
);

interface WinnerCardProps {
  winner: GameResult;
  appId?: number;
  winnerHdCover?: string;
  winnerCoverFallbacks: string[];
  displayedGenre: string;
  displayedDescription: string;
  livePrice: SteamPriceInfo | null;
  maxPoints: number;
  totalVoters: number;
}

const WinnerCard: React.FC<WinnerCardProps> = ({
  winner,
  appId,
  winnerHdCover,
  winnerCoverFallbacks,
  displayedGenre,
  displayedDescription,
  livePrice,
  maxPoints,
  totalVoters,
}) => (
  <div className="winner-banner-glow">
    <div className="winner-banner">
      <div className="winner-trophy-tag">
        <span className="trophy-icon">🏆</span>
        <span className="trophy-text">JUEGO GANADOR DE LA VOTACIÓN</span>
      </div>

      <div className="winner-content">
        {appId ? (
          <a
            href={`https://store.steampowered.com/app/${appId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="winner-image-container winner-image-link"
            title={`Abrir ${winner.game.title} en la Tienda Oficial de Steam`}
          >
            <img
              src={winnerHdCover}
              alt={winner.game.title}
              className="winner-image"
              loading="eager"
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
          </a>
        ) : (
          <div className="winner-image-container">
            <img
              src={winnerHdCover}
              alt={winner.game.title}
              className="winner-image"
              loading="eager"
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
        )}

        <div className="winner-details">
          <div className="winner-meta-header">
            {displayedGenre && <div className="winner-genre">{displayedGenre}</div>}

            {livePrice && (
              <a
                href={appId ? `https://store.steampowered.com/app/${appId}` : undefined}
                target="_blank"
                rel="noopener noreferrer"
                className={`winner-steam-price-badge ${livePrice.discountPercent && livePrice.discountPercent > 0 ? 'has-discount' : ''}`}
                title="Ver en la Tienda Oficial de Steam"
              >
                <FaSteam className="steam-price-icon" />
                {livePrice.discountPercent && livePrice.discountPercent > 0 ? (
                  <>
                    <span className="price-discount-pill">-{livePrice.discountPercent}%</span>
                    {livePrice.initialFormatted && (
                      <span className="price-old-strikethrough">{livePrice.initialFormatted}</span>
                    )}
                    <span className="price-current-value">{livePrice.finalFormatted}</span>
                  </>
                ) : (
                  <span className="price-current-value">
                    {livePrice.finalFormatted || (livePrice.isFree ? 'Gratis' : 'Ver en Steam')}
                  </span>
                )}
              </a>
            )}
          </div>
          <h2 className="winner-title">{winner.game.title}</h2>
          <p className="winner-description">{displayedDescription}</p>

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
);

const PodiumList: React.FC<{ runnersUp: GameResult[] }> = ({ runnersUp }) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [isOverflowing, setIsOverflowing] = useState(false);

  const checkScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const hasOverflow = el.scrollWidth > el.clientWidth + 2;
    setIsOverflowing(hasOverflow);
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 4);
  }, []);

  useEffect(() => {
    if (runnersUp.length === 0) return;
    checkScroll();
    const el = scrollRef.current;
    if (!el) return;

    const handleResize = () => checkScroll();
    window.addEventListener('resize', handleResize);

    const resizeObserver = new ResizeObserver(() => {
      checkScroll();
    });
    resizeObserver.observe(el);

    // Permitir scroll horizontal fluido con rueda del ratón en desktop cuando haya desbordamiento
    const onWheelListener = (e: WheelEvent) => {
      if (el.scrollWidth > el.clientWidth) {
        if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
          const atLeft = el.scrollLeft <= 0;
          const atRight = el.scrollLeft >= el.scrollWidth - el.clientWidth - 1;
          if ((e.deltaY < 0 && !atLeft) || (e.deltaY > 0 && !atRight)) {
            e.preventDefault();
            el.scrollLeft += e.deltaY;
            checkScroll();
          }
        }
      }
    };

    el.addEventListener('wheel', onWheelListener, { passive: false });

    return () => {
      window.removeEventListener('resize', handleResize);
      resizeObserver.disconnect();
      el.removeEventListener('wheel', onWheelListener);
    };
  }, [checkScroll, runnersUp]);

  const scrollPodium = (direction: 'left' | 'right') => {
    if (!scrollRef.current) return;
    const card = scrollRef.current.querySelector<HTMLElement>('.podium-card');
    const scrollAmount = card ? card.offsetWidth + 14 : 280;
    scrollRef.current.scrollBy({
      left: direction === 'left' ? -scrollAmount : scrollAmount,
      behavior: 'smooth',
    });
  };

  const getRankLabel = (rankPosition: number) => {
    if (rankPosition === 2) return '2º LUGAR 🥈';
    if (rankPosition === 3) return '3º LUGAR 🥉';
    return `${rankPosition}º LUGAR`;
  };

  if (runnersUp.length === 0) return null;

  return (
    <div className="podium-container">
      <div className="podium-header-bar">
        <h4 className="podium-heading">TABLA DE POSICIONES FINAL</h4>
        {isOverflowing && (
          <div className="podium-carousel-nav" aria-label="Navegación de posiciones">
            <button
              type="button"
              className="podium-nav-btn"
              onClick={() => scrollPodium('left')}
              disabled={!canScrollLeft}
              aria-label="Ver juego anterior"
              title="Ver anteriores"
            >
              ◀
            </button>
            <span className="podium-scroll-hint">Desliza para ver más</span>
            <button
              type="button"
              className="podium-nav-btn"
              onClick={() => scrollPodium('right')}
              disabled={!canScrollRight}
              aria-label="Ver siguiente juego"
              title="Ver siguientes"
            >
              ▶
            </button>
          </div>
        )}
      </div>

      <div className="podium-carousel-wrapper">
        {isOverflowing && canScrollLeft && (
          <div className="podium-fade-edge fade-left" aria-hidden="true" />
        )}

        <div
          ref={scrollRef}
          className="podium-grid"
          onScroll={checkScroll}
        >
          {runnersUp.map((result, idx) => {
            const rankPosition = idx + 2;
            return (
              <motion.div
                key={result.game.id}
                layout
                className={`podium-card position-${rankPosition}`}
                whileHover={{ scale: 1.02, y: -3 }}
                whileTap={{ scale: 0.97 }}
                transition={{ type: 'spring', stiffness: 400, damping: 25 }}
              >
                <div className="podium-rank">{getRankLabel(rankPosition)}</div>
                <GameThumbnail
                  game={result.game}
                  alt={result.game.title}
                  className="podium-thumb"
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

        {isOverflowing && canScrollRight && (
          <div className="podium-fade-edge fade-right" aria-hidden="true" />
        )}
      </div>
    </div>
  );
};

export const WinnerBanner: React.FC<WinnerBannerProps> = React.memo(({
  results,
  votersCount = 0,
  totalAssignedPoints,
}) => {
  const winner = results[0];
  const runnersUp = results.slice(1);
  const maxPoints = getMaxVotePoints(results.length);
  const totalVoters = votersCount;

  // High-Definition Steam Cover (616x353 HD capsule) for 1st Place Winner
  const appId = winner?.game?.appId;

  // Estado para detalles en vivo cargados asíncronamente desde la API oficial de Steam
  const [fetchedDetails, setFetchedDetails] = useState<{
    appId?: number;
    price?: SteamPriceInfo;
    genre?: string;
    description?: string;
  }>({});

  useEffect(() => {
    if (!appId) return;

    let isMounted = true;
    fetchSteamGameDetails(appId)
      .then((details) => {
        if (!isMounted) return;
        setFetchedDetails({
          appId,
          price: details.price,
          genre: details.genres,
          description: details.description,
        });
      })
      .catch((err) => {
        console.warn('[WinnerBanner] Error al consultar datos en vivo de Steam:', err);
      });

    return () => {
      isMounted = false;
    };
  }, [appId]);

  const livePrice = (fetchedDetails.appId === appId && fetchedDetails.price)
    ? fetchedDetails.price
    : (winner?.game?.price || null);

  const rawGenre = (fetchedDetails.appId === appId && fetchedDetails.genre)
    ? fetchedDetails.genre
    : (winner?.game?.genre || '');

  const displayedGenre = rawGenre && !/actualizar|modo\s*edici[oó]n/i.test(rawGenre)
    ? rawGenre
    : '';

  const displayedDescription = (fetchedDetails.appId === appId && fetchedDetails.description)
    ? fetchedDetails.description
    : (winner?.game?.description || '');

  // Detect whether any member has assigned points
  const hasVotes = totalAssignedPoints !== undefined
    ? totalAssignedPoints > 0
    : results.some((r) => r.rawPoints > 0 || r.weightedPoints > 0);

  const cdnBase = 'https://cdn.akamai.steamstatic.com/steam/apps';
  const winnerHdCover = appId
    ? `${cdnBase}/${appId}/capsule_616x353.jpg`
    : winner?.game?.coverImage;

  // Fallback chain for winner cover: robust multi-CDN fallback
  const winnerCoverFallbacks: string[] = winner?.game
    ? getGameImageFallbacks(winner.game)
    : [];

  return (
    <section className="winner-section">
      <AnimatePresence mode="wait">
        {!hasVotes || !winner?.game ? (
          <VotingInProgressView totalVoters={totalVoters} resultsCount={results.length} />
        ) : (
          <motion.div
            key="winner-results-view"
            className="winner-view-wrapper"
            style={{ width: '100%' }}
            initial={{ opacity: 0, scale: 0.97, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: -12 }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
          >
            <WinnerCard
              winner={winner}
              appId={appId}
              winnerHdCover={winnerHdCover}
              winnerCoverFallbacks={winnerCoverFallbacks}
              displayedGenre={displayedGenre}
              displayedDescription={displayedDescription}
              livePrice={livePrice}
              maxPoints={maxPoints}
              totalVoters={totalVoters}
            />
            <PodiumList runnersUp={runnersUp} />
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
});
