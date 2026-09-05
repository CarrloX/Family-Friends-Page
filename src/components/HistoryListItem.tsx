import React from 'react';
import { motion } from 'framer-motion';
import type { VotingHistoryRecord } from '../types/voting';
import { GameThumbnail } from './GameThumbnail';

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
    <motion.div
      layout
      layoutId={`history-item-${rec.id}`}
      className="history-list-item-wrapper"
      initial={{ opacity: 0, x: -15, scale: 0.97 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: -15, scale: 0.95 }}
      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
    >
      <motion.button
        type="button"
        className={`history-list-item ${isSelected ? 'selected' : ''}`}
        onClick={() => onSelect(rec.id)}
        whileHover={{ scale: 1.01 }}
        whileTap={{ scale: 0.98 }}
      >
        <GameThumbnail
          game={rec.winningGame}
          alt={rec.winningGame?.title}
          className="history-item-thumb"
          recordId={rec.id}
        />
        <div className="history-item-info">
          <span className="history-item-winner">🏆 {rec.winningGame?.title}</span>
          <span className="history-item-date">{rec.date}</span>
        </div>
      </motion.button>
      {canManageContent && (
        <motion.button
          type="button"
          className="history-delete-btn"
          onClick={(e) => {
            e.stopPropagation();
            onRequestDelete(rec);
          }}
          title="Eliminar este registro"
          whileHover={{ scale: 1.15 }}
          whileTap={{ scale: 0.85 }}
        >
          🗑️
        </motion.button>
      )}
    </motion.div>
  );
});