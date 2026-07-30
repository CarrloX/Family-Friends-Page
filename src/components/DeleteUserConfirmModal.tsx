import React from 'react';
import { motion } from 'framer-motion';
import type { Voter } from '../types/voting';

interface DeleteUserConfirmModalProps {
  voter: Voter;
  onCancel: () => void;
  onConfirm: () => void;
}

export const DeleteUserConfirmModal: React.FC<DeleteUserConfirmModalProps> = ({
  voter,
  onCancel,
  onConfirm,
}) => {
  return (
    <motion.div
      className="modal-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
    >
      <button
        type="button"
        className="modal-backdrop-close"
        onClick={onCancel}
        aria-label="Cerrar modal"
      />
      <motion.div
        className="delete-confirm-modal-container"
        initial={{ opacity: 0, scale: 0.9, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9, y: 20 }}
        transition={{ type: 'spring', stiffness: 380, damping: 26 }}
      >
        <div className="modal-header">
          <div className="modal-title-group">
            <h2>⚠️ Eliminar Integrante</h2>
            <p>Esta acción no se puede deshacer fácilmente.</p>
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
            <img
              src={voter.avatar}
              alt={voter.name}
              className="delete-user-avatar"
              loading="lazy"
            />
            <div className="delete-user-info">
              <span className="delete-user-name">{voter.name}</span>
              <span className="delete-user-id">ID: {voter.id}</span>
            </div>
          </div>

          <div className="delete-warning-text">
            <p>
              ¿Estás seguro de que deseas eliminar a <strong>{voter.name}</strong> del grupo de votación?
            </p>
            <p className="delete-warning-sub">
              Sus registros actuales se desvincularán de las votaciones futuras.
            </p>
            <p className="delete-warning-note">
              📜 <strong>Nota:</strong> Los registros históricos de votaciones pasadas donde {voter.name} participó
              se conservarán intactos con sus datos de ese momento.
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