import React from 'react';

export const Header: React.FC = () => {
  return (
    <header className="steam-header">
      <div className="steam-header-badge">
        <span className="live-dot"></span>
        <span className="badge-text">TEMPORADA 2026 • VOTACIÓN OFICIAL</span>
      </div>

      <h1 className="steam-title">
        <svg className="steam-icon" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2a10 10 0 0 0-10 10c0 4.42 2.87 8.17 6.84 9.5l2.42-3.48A4.98 4.98 0 0 1 11 17a5 5 0 0 1 5-5c.35 0 .69.04 1.03.11l3.3-2.36A9.97 9.97 0 0 0 12 2zm-1 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"/>
        </svg>
        RESULTADOS DE VOTACIÓN STEAM
      </h1>

      <p className="steam-subtitle">
        Ponderación de aura por participante • Sistema de Voto Ponderado Co-Op
      </p>

      <div className="header-divider"></div>
    </header>
  );
};
