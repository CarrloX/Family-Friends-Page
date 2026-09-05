import React from 'react';
import { motion } from 'framer-motion';
import type { VotingHistoryRecord } from '../types/voting';
import { GameThumbnail } from './GameThumbnail';

interface DeleteHistoryRecordConfirmModalProps {
  record: VotingHistoryRecord;
  onCancel: () => void;
  onConfirm: () => void;
}

export const DeleteHistoryRecordConfirmModal: React.FC<DeleteHistoryRecordConfirmModalProps> = ({
  record,
  onCancel,
  onConfirm,
}) => {
  return (
    <motion.div
      className="modal-backdrop bottom-sheet-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
      onClick={onCancel}
    >
      <motion.div
        className="delete-modal-container bottom-sheet-panel"
        initial={{ y: '100%', opacity: 0, scale: 0.95 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        exit={{ y: '100%', opacity: 0, scale: 0.95 }}
        transition={{ type: 'spring', stiffness: 320, damping: 30 }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Handle visual superior estilo bottom sheet */}
        <div className="bottom-sheet-handle" aria-hidden="true"></div>
        <div className="modal-header">
          <div className="modal-title-group">
            <h2>⚠️ Eliminar Votación del Historial</h2>
            <p>Esta acción afectará los saldos acumulados de los integrantes.</p>
          </div>
          <motion.button
            type="button"
            className="modal-close-btn"
            onClick={onCancel}
            aria-label="Cerrar"
            whileHover={{ scale: 1.15 }}
            whileTap={{ scale: 0.9 }}
          >
            ✕
          </motion.button>
        </div>

        <div className="delete-warning-content">
          <div className="delete-user-preview">
            <GameThumbnail
              game={record.winningGame}
              alt={record.winningGame?.title}
              className="delete-user-avatar"
              recordId={record.id}
            />
            <div className="delete-user-info">
              <span className="delete-user-name">🏆 {record.winningGame?.title}</span>
              <span className="delete-user-id">📅 {record.date}</span>
            </div>
          </div>

          <div className="delete-warning-text">
            <p>
              ¿Estás seguro de que deseas eliminar la votación <strong>{record.winningGame?.title}</strong> del historial?
            </p>
            <p className="delete-warning-sub">
              Esta votación se desvinculará del registro histórico.
            </p>
            <p className="delete-warning-note">
              📊 <strong>Nota:</strong> Se perderán los registros de cuotas pagadas y la evolución de Aura asociada a esta votación.
            </p>
          </div>
        </div>

        <div className="modal-footer-actions delete-modal-actions">
          <motion.button
            type="button"
            className="btn-modal-cancel"
            onClick={onCancel}
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
          >
            Cancelar
          </motion.button>
          <motion.button
            type="button"
            className="btn-modal-confirm-delete"
            onClick={onConfirm}
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
          >
            Confirmar Eliminación
          </motion.button>
        </div>
      </motion.div>
    </motion.div>
  );
};
