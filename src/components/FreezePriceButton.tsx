import React from 'react';
import { motion } from 'framer-motion';

export interface FreezePriceButtonProps {
  isFrozen: boolean;
  onToggle: () => Promise<void> | void;
  isLoading?: boolean;
  disabled?: boolean;
  className?: string;
  id?: string;
}

/**
 * Componente de botón único dinámico (Toggle) para congelar y descongelar
 * el precio del juego ganador en Modo Edición / Administración.
 */
export const FreezePriceButton = React.memo(({
  isFrozen,
  onToggle,
  isLoading = false,
  disabled = false,
  className = '',
  id,
}: FreezePriceButtonProps) => {
  const isInteractionDisabled = disabled || isLoading;

  const handleClick = async (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();

    if (isInteractionDisabled) return;

    try {
      await onToggle();
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error('[FreezePriceButton] Error al cambiar estado del precio:', error);
      }
    }
  };

  const frozenIcon = isFrozen ? '🔓' : '🔒';
  const toggleIcon = isLoading ? '⏳' : frozenIcon;
  const loadingLabel = isFrozen ? 'Descongelando…' : 'Congelando…';
  const idleLabel = isFrozen ? 'Descongelar Precio' : 'Congelar Precio';
  const toggleLabel = isLoading ? loadingLabel : idleLabel;

  return (
    <motion.button
      type="button"
      id={id}
      className={`btn-freeze-toggle ${isFrozen ? 'is-frozen' : 'is-unfrozen'} ${className}`.trim()}
      onClick={handleClick}
      disabled={isInteractionDisabled}
      aria-pressed={isFrozen}
      aria-busy={isLoading}
      title={
        isFrozen
          ? 'Volver a sincronizar el precio con Steam'
          : 'Guardar el precio actual y su descuento'
      }
      whileHover={isInteractionDisabled ? {} : { scale: 1.04, y: -2 }}
      whileTap={isInteractionDisabled ? {} : { scale: 0.96 }}
      layout
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
    >
      <span className="freeze-toggle-icon" aria-hidden="true">
        {toggleIcon}
      </span>
      <span className="freeze-toggle-label">
        {toggleLabel}
      </span>
      {isFrozen && (
        <span className="freeze-active-pill" aria-hidden="true">
          ACTIVO
        </span>
      )}
    </motion.button>
  );
});

