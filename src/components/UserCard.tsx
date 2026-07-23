import React from 'react';
import type { Voter, AuraRank } from '../types/voting';
import { GAMES } from '../data/votingData';

interface UserCardProps {
  voter: Voter;
}

export const UserCard: React.FC<UserCardProps> = ({ voter }) => {
  const getBadgeClass = (rank: AuraRank) => {
    switch (rank) {
      case 'VIP':
        return 'aura-badge vip';
      case 'Regular':
        return 'aura-badge regular';
      case 'Observación':
        return 'aura-badge observacion';
      default:
        return 'aura-badge';
    }
  };

  return (
    <div className={`user-card rank-${voter.auraRank.toLowerCase()}`}>
      {/* Glow highlight top corner */}
      <div className="card-ambient-glow"></div>

      {/* Header Info */}
      <div className="card-header">
        <div className="avatar-wrapper">
          <img src={voter.avatar} alt={voter.name} className="user-avatar" />
          <span className="avatar-status-ring"></span>
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
        <span className="multiplier-label">EFECTO DE AURA:</span>
        <span className="multiplier-value">{voter.multiplier}x Ponderación</span>
      </div>

      {/* Games List */}
      <div className="votes-list">
        {voter.votes.map((vote) => {
          const game = GAMES[vote.gameId];
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
                <img src={game.coverImage} alt={game.title} className="game-thumb" />
              </div>

              <div className="vote-game-info">
                <div className="game-title-row">
                  <span className="game-title">{game.title}</span>
                  {is3Pts && <span className="favorite-badge">⭐ FAVORITO</span>}
                </div>
                <div className="vote-points-row">
                  <span className="base-pts">{vote.points} {vote.points === 1 ? 'punto' : 'puntos'}</span>
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
