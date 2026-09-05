import React from 'react';
import type { Game } from '../types/voting';
import { GameThumbnail } from './GameThumbnail';

interface CompetitorCardProps {
  game: Game;
  pts: number | null;
  idx: number;
  recordId?: string;
}

export const CompetitorCard: React.FC<CompetitorCardProps> = React.memo(({
  game,
  pts,
  idx,
  recordId,
}) => {
  let medal: string;
  if (idx === 0) medal = '🥇';
  else if (idx === 1) medal = '🥈';
  else if (idx === 2) medal = '🥉';
  else medal = `${idx + 1}º`;

  return (
    <div key={game.id} className={`competitor-card ${idx === 0 ? 'winner-competitor' : ''}`}>
      <GameThumbnail
        game={game}
        alt={game.title}
        className="competitor-thumb"
        recordId={recordId}
      />
      <div className="competitor-info">
        <span className="competitor-medal">{medal}</span>
        <span className="competitor-title">{game.title}</span>
        {pts !== null && <span className="competitor-pts">{pts} pts</span>}
      </div>
    </div>
  );
});