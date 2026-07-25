import React from "react";
import { FaSteam } from "react-icons/fa";

interface HeaderProps {
  onRequestAdminAccess?: () => void;
  canManageContent?: boolean;
}

export const Header: React.FC<HeaderProps> = ({ onRequestAdminAccess, canManageContent = false }) => {
  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onRequestAdminAccess?.();
    }
  };

  return (
    <header className="steam-header">
      <div className="steam-header-badge">
        <span className="live-dot"></span>
        <span className="badge-text">
          TEMPORADA 2026 • VOTACIÓN OFICIAL
        </span>
      </div>

      <button
        type="button"
        className={`steam-title${canManageContent ? '' : ' admin-access-trigger'}`}
        onClick={() => {
          if (!canManageContent) {
            onRequestAdminAccess?.();
          }
        }}
        onKeyDown={handleKeyDown}
        title={canManageContent ? undefined : 'Haz clic para desbloquear edición temporal'}
      >
        <FaSteam className="steam-icon" />
        <span>RESULTADOS DE VOTACIÓN STEAM</span>
      </button>

      <p className="steam-subtitle">
        Ponderación de aura por participante • Sistema de Voto Ponderado Co-Op
      </p>

      <div className="header-divider"></div>
    </header>
  );
};