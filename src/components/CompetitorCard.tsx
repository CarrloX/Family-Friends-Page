import React from 'react';
import type { Game } from '../types/voting';

interface CompetitorCardProps {
  game: Game;
  pts: number | null;
  idx: number;
}

export const CompetitorCard: React.FC<CompetitorCardProps> = React.memo(({
  game,
  pts,
  idx,
}) => {
  let medal: string;
  if (idx === 0) medal = '🥇';
  else if (idx === 1) medal = '🥈';
  else if (idx === 2) medal = '🥉';
  else medal = `${idx + 1}º`;

  return (
    <div key={game.id} className={`competitor-card ${idx === 0 ? 'winner-competitor' : ''}`}>
      <img
        src={game.coverImage}
        alt={game.title}
        className="competitor-thumb"
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
      <div className="competitor-info">
        <span className="competitor-medal">{medal}</span>
        <span className="competitor-title">{game.title}</span>
        {pts !== null && <span className="competitor-pts">{pts} pts</span>}
      </div>
    </div>
  );
});