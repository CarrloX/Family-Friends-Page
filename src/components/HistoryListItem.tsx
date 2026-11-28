import React from 'react';
import { motion } from 'framer-motion';
import { FaSteam } from 'react-icons/fa';
import type { VotingHistoryRecord } from '../types/voting';
import { GameThumbnail } from './GameThumbnail';
import { formatHistoryDate } from '../utils/formatDate';
import { formatCopPrice } from '../services/steamStoreApi';
import { EnebaIcon } from './FinishVotingModal';

interface HistoryListItemProps {
  rec: VotingHistoryRecord;
  isSelected: boolean;
  isLatest: boolean;
  canManageContent: boolean;
  onSelect: (id: string) => void;
  onRequestDelete: (rec: VotingHistoryRecord) => void;
}

function resolveFormattedPrice(rec: VotingHistoryRecord): string | null {
  if (typeof rec.precioPagado === 'number') {
    return rec.precioPagado === 0 ? 'Gratis' : formatCopPrice(rec.precioPagado);
  }
  if (rec.precioPagadoFormatted) {
    return rec.precioPagadoFormatted;
  }
  if (rec.isPrecioCongelado) {
    if (typeof rec.precioCongelado === 'number') {
      return formatCopPrice(rec.precioCongelado);
    }
    if (rec.precioCongeladoFormatted) {
      return rec.precioCongeladoFormatted;
    }
  }
  const winningPrice = rec.winningGame?.price;
  if (typeof winningPrice?.final === 'number') {
    return winningPrice.final === 0 ? 'Gratis' : formatCopPrice(winningPrice.final);
  }
  if (winningPrice?.finalFormatted) {
    return winningPrice.finalFormatted;
  }
  return null;
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
  const formattedPrice = resolveFormattedPrice(rec);

  return (
    <div className="history-list-item-wrapper">
      <motion.button
        type="button"
        className={`history-list-item ${isSelected ? 'selected' : ''}`}
        onClick={() => onSelect(rec.id)}
        aria-pressed={isSelected}
        whileTap={{ scale: 0.97 }}
        transition={{ duration: 0.1 }}
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
          <div className="history-item-badges-row">
            {rec.purchasePlatform === 'eneba' ? (
              <span className="mini-store-badge eneba" title="Comprado a través de Eneba">
                <EnebaIcon className="mini-store-icon" /> Eneba
              </span>
            ) : (
              <span className="mini-store-badge steam" title="Comprado a través de Steam">
                <FaSteam className="mini-store-icon" /> Steam
              </span>
            )}
            {formattedPrice ? (
              <span className="mini-price-paid" title={`Precio: ${formattedPrice}`}>
                {formattedPrice}
              </span>
            ) : null}
          </div>
        </div>
      </motion.button>
      {canManageContent && isLatest && (
        <motion.button
          type="button"
          className="history-delete-btn"
          onClick={() => onRequestDelete(rec)}
          aria-label={`Deshacer y eliminar la votación más reciente de ${rec.winningGame?.title ?? 'este juego'}`}
          title="Deshacer y eliminar la votación más reciente (restaura el Aura previo)"
          whileTap={{ scale: 0.88 }}
          transition={{ duration: 0.1 }}
        >
          <span aria-hidden="true">🗑️</span>
        </motion.button>
      )}
    </div>
  );
});
