import React, { useState, useRef, useEffect } from 'react';
import { motion, useAnimationControls } from 'framer-motion';
import { FaLock, FaShieldAlt, FaUnlock, FaSpinner, FaClock } from 'react-icons/fa';

import type { AuthResult, AuthErrorCode } from '../services/accessControl';

export type { AuthResult, AuthErrorCode };

import { useModalFocusTrap } from '../hooks/useModalFocusTrap';

interface AdminPinModalProps {
  onCancel: () => void;
  /** Función que intenta autenticar la contraseña ingresada en el servidor */
  onAuthenticate: (password: string) => Promise<AuthResult>;
}

interface PinModalError {
  message: string;
  type: AuthErrorCode | 'validation';
}

/**
 * Mapea el `errorCode` de `AuthResult` al tipo interno de error del modal.
 * Función pura extraída para eliminar el ternario anidado (SonarLint S3358).
 */
function resolveErrorType(errorCode: AuthErrorCode | undefined): PinModalError['type'] {
  if (errorCode === 'unauthorized') return 'unauthorized';
  if (errorCode === 'unknown-error') return 'unknown-error';
  return 'invalid-credentials';
}

export const AdminPinModal = ({
  onCancel,
  onAuthenticate,
}: AdminPinModalProps) => {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<PinModalError | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [lockoutRemaining, setLockoutRemaining] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const modalRef = useModalFocusTrap<HTMLDivElement>({
    initialFocusRef: inputRef,
    onEscape: onCancel,
    disabled: isSubmitting,
    initialFocusDelay: 150,
  });
  // Ref síncrono para prevenir clics o envíos simultáneos en el backdrop y submit
  const isSubmittingRef = useRef(false);
  const onCancelRef = useRef(onCancel);
  const inputControls = useAnimationControls();

  // Mantener onCancelRef sincronizado con el prop más reciente
  useEffect(() => {
    onCancelRef.current = onCancel;
  }, [onCancel]);

  // Temporizador de cuenta regresiva cuando el proveedor/servicio activa bloqueo por intentos fallidos ('rate-limited')
  useEffect(() => {
    if (lockoutRemaining <= 0) return;
    const interval = setInterval(() => {
      setLockoutRemaining((prev) => {
        if (prev <= 1) {
          setError(null);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [lockoutRemaining]);

  const triggerShake = () => {
    inputControls.start({
      x: [-8, 8, -6, 6, -3, 3, 0],
      transition: { duration: 0.4, ease: 'easeInOut' },
    });
  };

  /**
   * Gestiona la respuesta de rate-limit del proveedor de autenticación.
   * Extrae la rama más profunda de handleSubmit para reducir complejidad cognitiva (SonarLint S3776).
   */
  const handleRateLimited = (retryAfterSeconds: number | undefined, errorMessage: string | undefined) => {
    if (retryAfterSeconds && retryAfterSeconds > 0) {
      setLockoutRemaining(retryAfterSeconds);
      setError({
        message: `Demasiados intentos fallidos. Por seguridad, espera ${retryAfterSeconds}s antes de reintentar.`,
        type: 'rate-limited',
      });
    } else {
      setError({
        message:
          errorMessage ??
          'Demasiados intentos fallidos. Por seguridad, el acceso ha sido bloqueado temporalmente. Espera un momento antes de volver a intentarlo.',
        type: 'rate-limited',
      });
    }
    triggerShake();
    setPassword('');
  };

  /**
   * Gestiona cualquier fallo de autenticación que no sea rate-limit.
   * Extrae la lógica de error de handleSubmit para reducir complejidad cognitiva (SonarLint S3776).
   */
  const handleAuthFailure = (errorCode: AuthErrorCode | undefined, errorMessage: string | undefined) => {
    if (errorCode === 'network-error') {
      // Ante fallo de red no se borra la contraseña para no obligar a reescribirla
      setError({
        message: 'Error de conexión con el servidor. Verifica tu red e intenta nuevamente.',
        type: 'network-error',
      });
      triggerShake();
      inputRef.current?.focus();
      return;
    }

    // Credenciales erróneas, falta de autorización (rol admin) o error no clasificado
    setError({
      message: errorMessage ?? 'Credenciales incorrectas. Intenta nuevamente.',
      type: resolveErrorType(errorCode),
    });
    triggerShake();
    setPassword('');
    inputRef.current?.focus();
  };

  const handleSubmit = async (e: React.SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (isSubmittingRef.current) return;

    if (lockoutRemaining > 0) {
      setError({
        message: `Acceso bloqueado por seguridad. Espera ${lockoutRemaining}s antes de reintentar.`,
        type: 'rate-limited',
      });
      triggerShake();
      return;
    }

    // Se valida que no esté vacío o solo de espacios, pero se envía password intacto
    // a onAuthenticate para respetar posibles espacios intencionales en la contraseña.
    if (!password.trim()) {
      setError({ message: 'Ingresa la contraseña de administrador.', type: 'validation' });
      triggerShake();
      return;
    }

    setIsSubmitting(true);
    isSubmittingRef.current = true;
    setError(null);

    try {
      const res = await onAuthenticate(password);

      if (!res.success) {
        if (res.errorCode === 'rate-limited') {
          handleRateLimited(res.retryAfterSeconds, res.error);
        } else {
          handleAuthFailure(res.errorCode, res.error);
        }
      }
    } catch {
      // Fallo de conexión inesperado: mantener contraseña y reenfocar el input
      setError({
        message: 'Error al conectar con el servidor de autenticación.',
        type: 'network-error',
      });
      triggerShake();
      inputRef.current?.focus();
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  let submitButtonContent: React.ReactNode;
  if (lockoutRemaining > 0) {
    submitButtonContent = (
      <>
        <FaClock aria-hidden="true" style={{ marginRight: 6, verticalAlign: 'middle' }} />
        <span>Espera ({lockoutRemaining}s)</span>
      </>
    );
  } else if (isSubmitting) {
    submitButtonContent = (
      <>
        <motion.span
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
          style={{ display: 'inline-flex', marginRight: 6, verticalAlign: 'middle' }}
        >
          <FaSpinner aria-hidden="true" />
        </motion.span>
        <span>Verificando…</span>
      </>
    );
  } else {
    submitButtonContent = (
      <>
        <FaUnlock aria-hidden="true" style={{ marginRight: 6, verticalAlign: 'middle' }} />
        <span>Desbloquear</span>
      </>
    );
  }

  // Semántica de accesibilidad: aria-invalid solo aplica ante valor de contraseña incorrecto
  // o vacío; un fallo de conectividad o rate-limit no invalida el dato del input.
  const isCredentialError =
    error?.type === 'invalid-credentials' || error?.type === 'validation';

  return (
    <motion.div
      className="modal-backdrop bottom-sheet-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
      onClick={() => {
        if (!isSubmittingRef.current) onCancelRef.current();
      }}
    >
      <motion.div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-modal-title"
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
            <h2 id="admin-modal-title">
              <FaShieldAlt aria-hidden="true" style={{ marginRight: 8, verticalAlign: 'middle' }} />
              Acceso de Administrador
            </h2>
            <p>Ingresa la contraseña para habilitar permisos de administrador.</p>
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
          <label htmlFor="admin-password" className="sr-only">
            Contraseña de administrador
          </label>
          <motion.div
            className="admin-pin-input-wrapper"
            animate={inputControls}
          >
            <FaLock className="admin-pin-icon" aria-hidden="true" />
            <input
              ref={inputRef}
              id="admin-password"
              type="password"
              aria-invalid={isCredentialError}
              aria-describedby={error ? 'admin-password-error' : undefined}
              className={`admin-pin-input ${isCredentialError ? 'has-error' : ''}`}
              placeholder={
                lockoutRemaining > 0
                  ? `Bloqueado por seguridad (${lockoutRemaining}s)...`
                  : 'Contraseña de administrador...'
              }
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setError(null);
              }}
              autoComplete="current-password"
              disabled={isSubmitting || lockoutRemaining > 0}
            />
          </motion.div>

          {error && (
            <motion.div
              id="admin-password-error"
              role="alert"
              className="admin-pin-error"
              initial={{ opacity: 0, y: -5 }}
              animate={{ opacity: 1, y: 0 }}
            >
              {error.message}
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
              disabled={isSubmitting || lockoutRemaining > 0}
              aria-busy={isSubmitting}
              whileHover={{ scale: isSubmitting || lockoutRemaining > 0 ? 1 : 1.03 }}
              whileTap={{ scale: isSubmitting || lockoutRemaining > 0 ? 1 : 0.97 }}
            >
              {submitButtonContent}
            </motion.button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
};