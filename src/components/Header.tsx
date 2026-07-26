import React from "react";
import { FaSteam } from "react-icons/fa";

export const Header: React.FC = React.memo(() => {
  return (
    <header className="steam-header">
      <div className="steam-header-badge">
        <span className="live-dot"></span>
        <span className="badge-text">
          TEMPORADA 2026 • VOTACIÓN OFICIAL
        </span>
      </div>

      <div className="steam-title">
        <FaSteam className="steam-icon" />
        <span>RESULTADOS DE VOTACIÓN STEAM</span>
      </div>

      <p className="steam-subtitle">
        Ponderación de aura por participante • Sistema de Voto Ponderado Co-Op
      </p>

      <div className="header-divider"></div>
    </header>
  );
});
