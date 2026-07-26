import React from 'react';
import type { VotingHistoryRecord } from '../types/voting';

interface HistoryListItemProps {
  rec: VotingHistoryRecord;
  isSelected: boolean;
  canManageContent: boolean;
  onSelect: (id: string) => void;
  onRequestDelete: (rec: VotingHistoryRecord) => void;
}

export const HistoryListItem: React.FC<HistoryListItemProps> = React.memo(({
  rec,
  isSelected,
  canManageContent,
  onSelect,
  onRequestDelete,
}) => {
  return (
    <div key={rec.id} className="history-list-item-wrapper">
      <button
        type="button"
        className={`history-list-item ${isSelected ? 'selected' : ''}`}
        onClick={() => onSelect(rec.id)}
      >
        <img
          src={rec.winningGame?.coverImage}
          alt={rec.winningGame?.title}
          className="history-item-thumb"
          onError={(e) => {
            const target = e.currentTarget;
            if (!target.dataset.failed) {
              target.dataset.failed = 'true';
              if (rec.winningGame?.tinyCoverImage) {
                target.src = rec.winningGame.tinyCoverImage;
              } else if (rec.winningGame?.appId) {
                target.src = `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${rec.winningGame.appId}/capsule_sm_120.jpg`;
              }
            }
          }}
        />
        <div className="history-item-info">
          <span className="history-item-winner">🏆 {rec.winningGame?.title}</span>
          <span className="history-item-date">{rec.date}</span>
        </div>
      </button>
      {canManageContent && (
        <button
          type="button"
          className="history-delete-btn"
          onClick={(e) => {
            e.stopPropagation();
            onRequestDelete(rec);
          }}
          title="Eliminar este registro"
        >
          🗑️
        </button>
      )}
    </div>
  );
});