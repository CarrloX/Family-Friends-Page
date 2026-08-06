import React, { useState, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { FaLock, FaShieldAlt } from 'react-icons/fa';

interface AdminPinModalProps {
  onCancel: () => void;
  /** Retorna true si el PIN es válido, false si es incorrecto */
  onSuccess: (enteredPin: string) => boolean;
}

/**
 * AdminPinModal
 * BottomSheet animado para ingresar el PIN de administrador,
 * reemplazando el window.prompt() nativo por una ventana emergente
 * con estilo oscuro/neón y animación de despliegue desde abajo.
 */
export const AdminPinModal: React.FC<AdminPinModalProps> = ({ onCancel, onSuccess }) => {
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Autofocus en el input al abrir
  useEffect(() => {
    const timer = setTimeout(() => inputRef.current?.focus(), 350);
    return () => clearTimeout(timer);
  }, []);

  // Cerrar con tecla Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancel();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

  const handleSubmit = (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!pin.trim()) {
      setError('Ingresa el PIN de administrador.');
      setShake(true);
      setTimeout(() => setShake(false), 500);
      return;
    }
    // La validación la hace el padre via onSuccess.
    // Si retorna false, el PIN es incorrecto: mostramos error y shake.
    const isValid = onSuccess(pin);
    if (!isValid) {
      setError('PIN incorrecto. Intenta nuevamente.');
      setShake(true);
      setTimeout(() => setShake(false), 500);
      setPin('');
      inputRef.current?.focus();
    }
  };

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
            <p>Ingresa el PIN para habilitar edición temporal en esta sesión.</p>
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

        <form className="admin-pin-form" onSubmit={handleSubmit}>
          <div className="admin-pin-input-wrapper">
            <FaLock className="admin-pin-icon" />
            <input
              ref={inputRef}
              type="password"
              inputMode="numeric"
              className={`admin-pin-input ${shake ? 'shake-error' : ''}`}
              placeholder="PIN de administrador..."
              value={pin}
              onChange={(e) => {
                setPin(e.target.value);
                setError(null);
              }}
              autoComplete="off"
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
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
            >
              Cancelar
            </motion.button>
            <motion.button
              type="submit"
              className="btn-modal-confirm"
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
            >
              🔓 Desbloquear
            </motion.button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
};