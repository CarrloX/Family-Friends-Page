import React from 'react';
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
    <div className="modal-backdrop" onClick={onCancel}>
      <div
        className="delete-confirm-modal-container"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div className="modal-title-group">
            <h2>⚠️ Eliminar Integrante</h2>
            <p>Esta acción no se puede deshacer fácilmente.</p>
          </div>
          <button
            type="button"
            className="modal-close-btn"
            onClick={onCancel}
            aria-label="Cerrar"
          >
            ✕
          </button>
        </div>

        <div className="delete-warning-content">
          <div className="delete-user-preview">
            <img
              src={voter.avatar}
              alt={voter.name}
              className="delete-user-avatar"
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
          <button
            type="button"
            className="btn-modal-cancel"
            onClick={onCancel}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="btn-modal-confirm-delete"
            onClick={onConfirm}
          >
            Confirmar Eliminación
          </button>
        </div>
      </div>
    </div>
  );
};