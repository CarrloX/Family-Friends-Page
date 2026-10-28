import React from 'react';
import { motion } from 'framer-motion';
import type { VotingHistoryRecord } from '../types/voting';
import { GameThumbnail } from './GameThumbnail';
import { formatHistoryDate } from '../utils/formatDate';

interface HistoryListItemProps {
  rec: VotingHistoryRecord;
  isSelected: boolean;
  isLatest: boolean;
  canManageContent: boolean;
  onSelect: (id: string) => void;
  onRequestDelete: (rec: VotingHistoryRecord) => void;
}

export const HistoryListItem = React.memo(({
  rec,
  isSelected,
  isLatest,
  canManageContent,
  onSelect,
  onRequestDelete,
}: HistoryListItemProps) => {
  const isBundle = Boolean(rec.isBundle || rec.winningGame?.isBundle);

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
        aria-pressed={isSelected}
        whileHover={{ scale: 1.01 }}
        whileTap={{ scale: 0.98 }}
      >
        <GameThumbnail
          game={rec.winningGame}
          alt=""
          className="history-item-thumb"
          recordId={rec.id}
        />
        <div className="history-item-info">
          <div className="history-item-winner-row">
            <span className="history-item-winner">
              <span aria-hidden="true">🏆</span>{' '}
              {rec.winningGame?.title ?? 'Juego no disponible'}
            </span>
            {isBundle && (
              <span className="bundle-badge-mini" title="Paquete Especial / Bundle">📦 BUNDLE</span>
            )}
          </div>
          <span className="history-item-date">{formatHistoryDate(rec)}</span>
        </div>
      </motion.button>
      {canManageContent && isLatest && (
        <motion.button
          type="button"
          className="history-delete-btn"
          onClick={() => onRequestDelete(rec)}
          aria-label={`Deshacer y eliminar la votación más reciente de ${rec.winningGame?.title ?? 'este juego'}`}
          title="Deshacer y eliminar la votación más reciente (restaura el Aura previo)"
          whileHover={{ scale: 1.15 }}
          whileTap={{ scale: 0.85 }}
        >
          <span aria-hidden="true">🗑️</span>
        </motion.button>
      )}
    </motion.div>
  );
});
