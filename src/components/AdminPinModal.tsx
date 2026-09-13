import React, { useState, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { FaLock, FaShieldAlt } from 'react-icons/fa';

interface AdminPinModalProps {
  onCancel: () => void;
  /** Retorna true o { success: true } si la contraseña es válida */
  onSuccess: (password: string) => Promise<boolean | { success: boolean; error?: string }>;
}

/**
 * AdminPinModal
 * BottomSheet animado para autenticación segura de administrador con Firebase Auth.
 * Solo solicita la contraseña; la verificación se realiza de manera segura en el servidor
 * sin comparar variables en el código cliente.
 */
export const AdminPinModal: React.FC<AdminPinModalProps> = ({ onCancel, onSuccess }) => {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Autofocus en el input de contraseña al abrir
  useEffect(() => {
    const timer = setTimeout(() => inputRef.current?.focus(), 350);
    return () => clearTimeout(timer);
  }, []);

  // Cerrar con tecla Escape si no se está enviando
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSubmitting) {
        onCancel();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onCancel, isSubmitting]);

  const handleSubmit = async (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!password.trim()) {
      setError('Ingresa la contraseña de administrador.');
      setShake(true);
      setTimeout(() => setShake(false), 500);
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const res = await onSuccess(password);
      const isSuccess = typeof res === 'boolean' ? res : res.success;
      const errorMsg =
        typeof res === 'object' && res.error
          ? res.error
          : 'Contraseña incorrecta. Intenta nuevamente.';

      if (!isSuccess) {
        setError(errorMsg);
        setShake(true);
        setTimeout(() => setShake(false), 500);
        setPassword('');
        inputRef.current?.focus();
      }
    } catch {
      setError('Error al conectar con el servidor de autenticación.');
      setShake(true);
      setTimeout(() => setShake(false), 500);
    } finally {
      setIsSubmitting(false);
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
        if (!isSubmitting) onCancel();
      }}
    >
      <motion.div
        className="admin-pin-modal-container bottom-sheet-panel"
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
            <h2>
              <FaShieldAlt style={{ marginRight: 8, verticalAlign: 'middle' }} />
              Acceso de Administrador
            </h2>
            <p>Ingresa la contraseña para habilitar edición en el servidor.</p>
          </div>
          <motion.button
            type="button"
            className="modal-close-btn"
            onClick={onCancel}
            disabled={isSubmitting}
            aria-label="Cerrar"
            whileHover={{ scale: 1.15 }}
            whileTap={{ scale: 0.9 }}
          >
            ✕
          </motion.button>
        </div>

        <form className="admin-pin-form" onSubmit={handleSubmit}>
          <div className="admin-pin-input-wrapper">
            <FaLock className="admin-pin-icon" />
            <input
              ref={inputRef}
              type="password"
              className={`admin-pin-input ${shake ? 'shake-error' : ''}`}
              placeholder="Contraseña de administrador..."
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setError(null);
              }}
              autoComplete="current-password"
              disabled={isSubmitting}
            />
          </div>

          {error && (
            <motion.div
              className="admin-pin-error"
              initial={{ opacity: 0, y: -5 }}
              animate={{ opacity: 1, y: 0 }}
            >
              {error}
            </motion.div>
          )}

          <div className="modal-footer-actions">
            <motion.button
              type="button"
              className="btn-modal-cancel"
              onClick={onCancel}
              disabled={isSubmitting}
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
            >
              Cancelar
            </motion.button>
            <motion.button
              type="submit"
              className="btn-modal-confirm"
              disabled={isSubmitting}
              whileHover={{ scale: isSubmitting ? 1 : 1.03 }}
              whileTap={{ scale: isSubmitting ? 1 : 0.97 }}
            >
              {isSubmitting ? '⏳ Verificando...' : '🔓 Desbloquear'}
            </motion.button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
};