import React, { useState, useRef } from 'react';
import { motion } from 'framer-motion';
import { useModalFocusTrap } from '../hooks/useModalFocusTrap';

export interface ResetAuraConfirmModalProps {
  onConfirm: () => Promise<void> | void;
  onCancel: () => void;
}

export const ResetAuraConfirmModal: React.FC<ResetAuraConfirmModalProps> = ({
  onConfirm,
  onCancel,
}) => {
  const [isResetting, setIsResetting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);

  const handleCancel = () => {
    if (isResetting) return;
    setErrorMessage(null);
    onCancel();
  };

  const modalRef = useModalFocusTrap<HTMLDivElement>({
    initialFocusRef: cancelButtonRef,
    onEscape: isResetting ? undefined : handleCancel,
    disabled: isResetting,
    initialFocusDelay: 100,
  });

  const handleConfirm = async () => {
    if (isResetting) return;

    setIsResetting(true);
    setErrorMessage(null);

    try {
      await onConfirm();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al restablecer Aura';
      setErrorMessage(message);
    } finally {
      setIsResetting(false);
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
        if (!isResetting) {
          handleCancel();
        }
      }}
    >
      <motion.div
        ref={modalRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="reset-aura-title"
        aria-describedby="reset-aura-description"
        className="delete-confirm-modal-container bottom-sheet-panel"
        initial={{ y: '100%', opacity: 0, scale: 0.95 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        exit={{ y: '100%', opacity: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 320, damping: 30 }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Handle visual superior estilo bottom sheet */}
        <div className="bottom-sheet-handle" aria-hidden="true"></div>
        <header className="modal-header">
          <div className="modal-title-group">
            <h2 id="reset-aura-title">
              <span aria-hidden="true">⚠️</span> Restablecer Aura
            </h2>
            <p>Esta acción no se puede deshacer fácilmente.</p>
          </div>
          <motion.button
            type="button"
            className="modal-close-btn"
            onClick={handleCancel}
            aria-label="Cerrar"
            disabled={isResetting}
            whileHover={isResetting ? {} : { scale: 1.15 }}
            whileTap={isResetting ? {} : { scale: 0.9 }}
          >✕</motion.button>
        </header>

        <div className="delete-warning-content">
          <section id="reset-aura-description" className="delete-warning-text">
            <p>¿Estás seguro de que deseas restablecer el <strong>Aura de todos los integrantes</strong>?</p>
            <p className="delete-warning-sub">
              Todos los integrantes volverán a ser <strong>Socio Regular</strong> con <strong>0 Cuotas</strong> y multiplicador <strong>1.0x</strong>.
            </p>
            <p className="delete-warning-note">
              <span aria-hidden="true">📊</span> <strong>Nota:</strong> Esta acción no afectará el historial de votaciones ni los juegos guardados. Solo se modificarán los niveles de Aura.
            </p>
            {errorMessage && (
              <div className="finish-modal-error-banner" role="alert" style={{ marginTop: '12px' }}>
                <span className="finish-modal-error-icon" aria-hidden="true">❌</span>
                <div className="finish-modal-error-content">
                  <span className="finish-modal-error-title">Error al restablecer</span>
                  <p className="finish-modal-error-text">{errorMessage}</p>
                </div>
              </div>
            )}
          </section>
        </div>

        <footer className="modal-footer-actions delete-modal-actions">
          <motion.button
            ref={cancelButtonRef}
            type="button"
            className="btn-modal-cancel"
            onClick={handleCancel}
            disabled={isResetting}
            whileHover={isResetting ? {} : { scale: 1.03 }}
            whileTap={isResetting ? {} : { scale: 0.97 }}
          >Cancelar</motion.button>
          <motion.button
            type="button"
            className="btn-modal-confirm-delete"
            onClick={handleConfirm}
            disabled={isResetting}
            whileHover={isResetting ? {} : { scale: 1.03 }}
            whileTap={isResetting ? {} : { scale: 0.97 }}
          >
            {isResetting ? 'Restableciendo…' : 'Confirmar Restablecimiento'}
          </motion.button>
        </footer>
      </motion.div>
    </motion.div>
  );
};

export default ResetAuraConfirmModal;
