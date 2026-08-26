import React, { useState, useEffect } from "react";
import { FaSteam, FaWifi } from "react-icons/fa";
import { motion, AnimatePresence } from "framer-motion";

interface HeaderProps {
  isVotingInProgress?: boolean;
}

export const Header: React.FC<HeaderProps> = React.memo(({ isVotingInProgress = true }) => {
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
        <AnimatePresence mode="wait">
          {isVotingInProgress ? (
            <motion.div
              key="badge-in-progress"
              className="steam-header-badge"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.25 }}
            >
              <span className="live-dot"></span>
              <span className="badge-text">
                ⚡ EN VOTACIÓN • ESPERANDO VOTOS
              </span>
            </motion.div>
          ) : (
            <motion.div
              key="badge-voting-active"
              className="steam-header-badge"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.25 }}
            >
              <span className="live-dot" style={{ backgroundColor: '#22c55e', boxShadow: '0 0 8px #22c55e' }}></span>
              <span className="badge-text">
                🔥 VOTOS REGISTRADOS • RESULTADOS EN VIVO
              </span>
            </motion.div>
          )}
        </AnimatePresence>

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
