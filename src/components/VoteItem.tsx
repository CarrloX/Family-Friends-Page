import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { GameVote, Game } from '../types/voting';
import { GameThumbnail } from './GameThumbnail';

interface VoteItemProps {
  vote: GameVote;
  game: Game | undefined;
  multiplier: number;
  maxPoints?: number;
  isAutoZero?: boolean;
}

export const VoteItem: React.FC<VoteItemProps> = React.memo(({
  vote,
  game,
  multiplier,
  maxPoints = 3,
  isAutoZero = false,
}) => {
  if (!game) return null;

  const isMaxPts = vote.points === maxPoints;
  const isMidPts = vote.points > 1 && vote.points < maxPoints;
  const isLowPts = vote.points === 1;
  const is0Pts = vote.points === 0;

  const weightedScore = (vote.points * multiplier).toFixed(2);

  let voteItemClass = 'vote-item';
  if (isMaxPts) voteItemClass += ' favorite-item';
  if (isMidPts) voteItemClass += ' medium-item';
  if (isLowPts) voteItemClass += ' low-item';
  if (is0Pts) voteItemClass += ' muted-item';
  if (isAutoZero) voteItemClass += ' auto-zero-item';
  if (game.isBundle) voteItemClass += ' is-bundle-candidate';

  const renderPointsLabel = () => {
    if (isAutoZero) {
      return (
        <AnimatePresence key="auto-zero">
          <motion.span
            className="auto-zero-badge"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ type: 'spring', stiffness: 500, damping: 25 }}
            title="Autocompletado automáticamente con 0 puntos al asignar todos los puestos superiores"
          >
            ✨ Auto 0 Pts
          </motion.span>
        </AnimatePresence>
      );
    }
    if (is0Pts) {
      return <span className="zero-pts-badge">0 Puntos</span>;
    }
    return (
      <span className="base-pts">
        {vote.points} {vote.points === 1 ? 'punto' : 'puntos'}
      </span>
    );
  };

  return (
    <motion.div
      key={vote.gameId}
      className={voteItemClass}
      whileHover={{ scale: 1.02, x: 2 }}
      whileTap={{ scale: 0.98 }}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
      layout
    >
      <div className="game-thumb-container">
        <GameThumbnail
          game={game}
          alt={game.title}
          className="game-thumb"
        />
      </div>

      <div className="vote-game-info">
        <div className="game-title-row">
          <div className="game-title-text-group">
            <span className="game-title" title={game.title}>{game.title}</span>
            {game.isBundle && (
              <span className="bundle-badge neon-pulse" title="Paquete Especial / Bundle">
                📦 BUNDLE
              </span>
            )}
          </div>
          {isMaxPts && <span className="favorite-badge">⭐ FAVORITO</span>}
        </div>

        {game.isBundle && game.bundleDescription && (
          <div className="bundle-desc-row">
            <span className="bundle-desc-snippet" title={game.bundleDescription}>
              🎁 {game.bundleDescription}
            </span>
          </div>
        )}

        <div className="vote-points-row">
          {renderPointsLabel()}

          {!is0Pts && (
            <span className="weighted-pts">
              ➜ <strong>{weightedScore}</strong> pts
            </span>
          )}

          {game.isBundle && game.price?.finalFormatted && (
            <span className="bundle-item-price-pill" title="Precio promocional del bundle">
              🏷️ {game.price.finalFormatted}
            </span>
          )}
        </div>
      </div>
    </motion.div>
  );
});
