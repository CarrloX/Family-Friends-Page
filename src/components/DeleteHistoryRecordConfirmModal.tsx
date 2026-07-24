import React from 'react';
import type { VotingHistoryRecord } from '../types/voting';

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
    <div className="modal-backdrop" onClick={onCancel}>
      <div
        className="delete-confirm-modal-container"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div className="modal-title-group">
            <h2>⚠️ Eliminar Votación</h2>
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
              src={record.winningGame?.coverImage}
              alt={record.winningGame?.title}
              className="delete-user-avatar"
              onError={(e) => {
                const target = e.currentTarget;
                if (!target.dataset.failed) {
                  target.dataset.failed = 'true';
                  if (record.winningGame?.tinyCoverImage) {
                    target.src = record.winningGame.tinyCoverImage;
                  } else if (record.winningGame?.appId) {
                    target.src = `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${record.winningGame.appId}/capsule_sm_120.jpg`;
                  }
                }
              }}
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