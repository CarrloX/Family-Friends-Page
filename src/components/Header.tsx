import React, { useState, useEffect } from "react";
import { FaSteam, FaWifi } from "react-icons/fa";
import { motion, AnimatePresence } from "framer-motion";

interface HeaderProps {
  isVotingInProgress?: boolean;
}

export const Header = React.memo(({ isVotingInProgress }: HeaderProps) => {
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [connectionMessage, setConnectionMessage] = useState('');

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      setConnectionMessage('Conexión de red restaurada.');
    };

    const handleOffline = () => {
      setIsOnline(false);
      setConnectionMessage('Sin conexión de red.');
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  return (
    <header className="steam-header">
      <div className="header-badges-row">
        <AnimatePresence mode="wait">
          {isVotingInProgress != null && (
            <motion.div
              key={isVotingInProgress ? 'voting' : 'results'}
              className="steam-header-badge"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.25 }}
            >
              <span className={`live-dot${isVotingInProgress ? '' : ' live-dot-complete'}`} aria-hidden="true" />
              <span className="badge-text">
                {isVotingInProgress
                  ? '⚡ EN VOTACIÓN • ESPERANDO VOTOS'
                  : '🔥 VOTOS REGISTRADOS • RESULTADOS'}
              </span>
            </motion.div>
          )}
        </AnimatePresence>

        {!isOnline && (
          <div className="offline-badge">
            <span className="offline-dot" aria-hidden="true" />
            <FaWifi className="offline-icon" aria-hidden="true" />
            <span className="badge-text">
              Sin conexión de red detectada
            </span>
          </div>
        )}

        {connectionMessage && (
          <span className="sr-only" role="status" aria-live="polite">
            {connectionMessage}
          </span>
        )}
      </div>

      <h1 className="steam-title">
        <FaSteam className="steam-icon" aria-hidden="true" />
        <span>VOTACIONES DE STEAM FAMILY</span>
      </h1>

      <p className="steam-subtitle">
       Votaciones de Participantes • Sistema de Aura
      </p>

      <div className="header-divider"></div>
    </header>
  );
});
