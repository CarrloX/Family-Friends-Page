import { useRef, useState } from 'react';
import { motion } from 'framer-motion';
import type { VotingHistoryRecord } from '../types/voting';
import { GameThumbnail } from './GameThumbnail';
import { useModalFocusTrap } from '../hooks/useModalFocusTrap';

interface DeleteHistoryRecordConfirmModalProps {
  record: VotingHistoryRecord;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}

export const DeleteHistoryRecordConfirmModal = ({
  record,
  onCancel,
  onConfirm,
}: DeleteHistoryRecordConfirmModalProps) => {
  const [isDeleting, setIsDeleting] = useState(false);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);

  const modalRef = useModalFocusTrap<HTMLDivElement>({
    initialFocusRef: cancelButtonRef,
    onEscape: onCancel,
    disabled: isDeleting,
    initialFocusDelay: 100,
  });

  const handleConfirm = async () => {
    if (isDeleting) return;
    setIsDeleting(true);
    try {
      await onConfirm();
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <motion.div
      className="modal-backdrop bottom-sheet-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
      onClick={() => {
        if (!isDeleting) {
          onCancel();
        }
      }}
    >
      <motion.div
        ref={modalRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-history-title"
        aria-describedby="delete-history-description"
        className="delete-modal-container bottom-sheet-panel"
        initial={{ y: '100%', opacity: 0, scale: 0.95 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        exit={{ y: '100%', opacity: 0, scale: 0.95 }}
        transition={{ type: 'spring', stiffness: 320, damping: 30 }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Handle visual superior estilo bottom sheet */}
        <div className="bottom-sheet-handle" aria-hidden="true"></div>
        <header className="modal-header">
          <div className="modal-title-group">
            <h2 id="delete-history-title">
              <span aria-hidden="true">⚠️</span>{' '}
              Eliminar Votación del Historial
            </h2>
            <p>Esta acción eliminará el registro y revertirá sus efectos sobre los integrantes.</p>
          </div>
          <motion.button
            type="button"
            className="modal-close-btn"
            onClick={() => {
              if (!isDeleting) {
                onCancel();
              }
            }}
            aria-label="Cerrar"
            disabled={isDeleting}
            whileHover={isDeleting ? {} : { scale: 1.15 }}
            whileTap={isDeleting ? {} : { scale: 0.9 }}
          >
            ✕
          </motion.button>
        </header>

        <div className="delete-warning-content">
          <div className="delete-user-preview">
            <GameThumbnail
              game={record.winningGame}
              alt=""
              className="delete-user-avatar"
              recordId={record.id}
            />
            <div className="delete-user-info">
              <span className="delete-user-name">
                <span aria-hidden="true">🏆</span> {record.winningGame.title}
              </span>
              <span className="delete-user-id">
                <span aria-hidden="true">📅</span> {record.date}
              </span>
            </div>
          </div>

          <section id="delete-history-description" className="delete-warning-text">
            <p>
              ¿Estás seguro de que deseas eliminar la votación <strong>{record.winningGame.title}</strong> del historial?
            </p>
            <p className="delete-warning-sub">
              El documento de esta votación será eliminado de la base de datos.
            </p>
            <p className="delete-warning-note">
              <span aria-hidden="true">📊</span>{' '}
              <strong>Efecto colateral:</strong> El balance de cuotas y el Aura de cada integrante se revertirán al valor que tenían <em>antes</em> de esta votación, usando el snapshot almacenado en el registro.
            </p>
          </section>
        </div>

        <footer className="modal-footer-actions delete-modal-actions">
          <motion.button
            ref={cancelButtonRef}
            type="button"
            className="btn-modal-cancel"
            onClick={() => {
              if (!isDeleting) {
                onCancel();
              }
            }}
            disabled={isDeleting}
            whileHover={isDeleting ? {} : { scale: 1.03 }}
            whileTap={isDeleting ? {} : { scale: 0.97 }}
          >
            Cancelar
          </motion.button>
          <motion.button
            type="button"
            className="btn-modal-confirm-delete"
            onClick={handleConfirm}
            disabled={isDeleting}
            whileHover={isDeleting ? {} : { scale: 1.03 }}
            whileTap={isDeleting ? {} : { scale: 0.97 }}
          >
            {isDeleting ? 'Eliminando…' : 'Eliminar votación'}
          </motion.button>
        </footer>
      </motion.div>
    </motion.div>
  );
};
