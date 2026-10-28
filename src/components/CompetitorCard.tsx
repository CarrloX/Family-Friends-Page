import React from 'react';
import type { Game } from '../types/voting';
import { GameThumbnail } from './GameThumbnail';

interface CompetitorCardProps {
  game: Game;
  pts: number | null;
  position: number;
  recordId?: string;
}

const MEDALS = ['🥇', '🥈', '🥉'];
const getMedal = (position: number): string => MEDALS[position] ?? `${position + 1}º`;

export const CompetitorCard = React.memo(
  ({ game, pts, position, recordId }: CompetitorCardProps) => {
    const medal = getMedal(position);

    return (
      <div className={`competitor-card ${position === 0 ? 'winner-competitor' : ''}`}>
        <GameThumbnail
          game={game}
          alt=""
          className="competitor-thumb"
          recordId={recordId}
        />
        <div className="competitor-info">
          <span className="sr-only">Puesto {position + 1}</span>
          <span className="competitor-medal" aria-hidden="true">{medal}</span>
          <div className="competitor-title-wrap">
            <span className="competitor-title" title={game.title}>{game.title}</span>
            {game.isBundle && (
              <span className="bundle-badge-mini" title="Paquete Especial / Bundle">📦 BUNDLE</span>
            )}
          </div>
          {pts !== null && <span className="competitor-pts">{pts} pts</span>}
        </div>
      </div>
    );
  }
);
