import React, { useState, useEffect } from "react";
import { FaSteam, FaWifi } from "react-icons/fa";

export const Header: React.FC = React.memo(() => {
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  return (
    <header className="steam-header">
      <div className="header-badges-row" style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', justifyContent: 'center' }}>
        <div className="steam-header-badge">
          <span className="live-dot"></span>
          <span className="badge-text">
            TEMPORADA 2026 • VOTACIÓN OFICIAL
          </span>
        </div>

        {!isOnline && (
          <div className="offline-badge">
            <span className="offline-dot"></span>
            <FaWifi className="offline-icon" />
            <span className="badge-text">
              Sin conexión (Modo lectura offline)
            </span>
          </div>
        )}
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
