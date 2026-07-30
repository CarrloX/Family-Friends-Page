import React from 'react';
import { motion } from 'framer-motion';
import type { GameVote, Game } from '../types/voting';

interface VoteItemProps {
  vote: GameVote;
  game: Game | undefined;
  multiplier: number;
}

export const VoteItem: React.FC<VoteItemProps> = React.memo(({
  vote,
  game,
  multiplier,
}) => {
  if (!game) return null;

  const is3Pts = vote.points === 3;
  const is2Pts = vote.points === 2;
  const is1Pt = vote.points === 1;
  const is0Pts = vote.points === 0;

  const weightedScore = (vote.points * multiplier).toFixed(2);

  let voteItemClass = 'vote-item';
  if (is3Pts) voteItemClass += ' favorite-item';
  if (is2Pts) voteItemClass += ' medium-item';
  if (is1Pt) voteItemClass += ' low-item';
  if (is0Pts) voteItemClass += ' muted-item';

  return (
    <motion.div
      key={vote.gameId}
      className={voteItemClass}
      whileHover={{ scale: 1.02, x: 2 }}
      whileTap={{ scale: 0.98 }}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
    >
      <div className="game-thumb-container">
        <img
          key={game?.id || vote.gameId}
          src={game?.coverImage}
          alt={game?.title}
          className="game-thumb"
          loading="lazy"
          onError={(e) => {
            const target = e.currentTarget;
            if (!target.dataset.fallback) {
              target.dataset.fallback = '1';
              if (game?.tinyCoverImage) {
                target.src = game.tinyCoverImage;
              } else if (game?.appId) {
                target.src = `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${game.appId}/capsule_sm_120.jpg`;
              }
            } else if (target.dataset.fallback === '1' && game?.appId) {
              target.dataset.fallback = '2';
              target.src = `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${game.appId}/capsule_sm_120.jpg`;
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
    </motion.div>
  );
});