import React from 'react';
import { motion } from 'framer-motion';

export interface FreezePriceButtonProps {
  isFrozen: boolean;
  onToggle: () => Promise<void> | void;
  isLoading?: boolean;
  disabled?: boolean;
  className?: string;
}

/**
 * Componente de botón único dinámico (Toggle) para congelar y descongelar
 * el precio del juego ganador en Modo Edición / Administración.
 */
export const FreezePriceButton: React.FC<FreezePriceButtonProps> = React.memo(({
  isFrozen,
  onToggle,
  isLoading = false,
  disabled = false,
  className = '',
}) => {
  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!disabled && !isLoading) {
      void onToggle();
    }
  };

  return (
    <motion.button
      type="button"
      id="btn-freeze-price-toggle"
      className={`btn-freeze-toggle ${isFrozen ? 'is-frozen' : 'is-unfrozen'} ${className}`.trim()}
      onClick={handleClick}
      disabled={disabled || isLoading}
      aria-pressed={isFrozen}
      aria-busy={isLoading}
      title={
        isFrozen
          ? '🔓 Descongelar Precio: Desbloquea el precio para volver a sincronizar ofertas en vivo con la API de Steam.'
          : '🔒 Congelar Precio: Captura y protege permanentemente el valor y % de descuento actual contra vencimientos en Steam.'
      }
      whileHover={disabled || isLoading ? {} : { scale: 1.04, y: -2 }}
      whileTap={disabled || isLoading ? {} : { scale: 0.96 }}
      layout
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
    >
      <span className="freeze-toggle-icon" aria-hidden="true">
        {isLoading ? '⏳' : isFrozen ? '🔓' : '🔒'}
      </span>
      <span className="freeze-toggle-label">
        {isLoading
          ? (isFrozen ? 'Descongelando…' : 'Congelando…')
          : (isFrozen ? 'Descongelar Precio' : 'Congelar Precio')}
      </span>
      {isFrozen && (
        <span className="freeze-active-pill" aria-hidden="true">
          ACTIVO
        </span>
      )}
    </motion.button>
  );
});
