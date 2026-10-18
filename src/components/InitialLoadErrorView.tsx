import React from 'react';
import { motion } from 'framer-motion';
import { SyncIndicator } from './SyncIndicator';
import type { SyncState } from '../services/dataStore';

export interface InitialLoadErrorViewProps {
  syncState: SyncState;
  errorMessage: string;
  onRetry: () => void;
}

export const InitialLoadErrorView: React.FC<InitialLoadErrorViewProps> = ({
  syncState,
  errorMessage,
  onRetry,
}) => (
  <div className="steam-dashboard-container initial-error-container">
    <div className="bg-gradient-overlay" />
    <div className="bg-grid-lines" />

    <SyncIndicator syncState={syncState} />

    <main className="initial-error-card-wrapper" role="alert" aria-live="assertive">
      <div className="initial-load-error-card">
        <div className="initial-error-badge">
          <span className="initial-error-icon" aria-hidden="true">⚠️</span>
          <span className="initial-error-tag">Error de Conexión Remota</span>
        </div>

        <h1 className="initial-error-title">No se pudieron cargar los datos</h1>

        <p className="initial-error-desc">
          Ocurrió un error al leer la información desde el servidor. Para proteger la integridad de tus datos y evitar sobreescribir la información existente con una lista vacía, el autoguardado se encuentra <strong>suspendido</strong>.
        </p>

        {errorMessage && (
          <div className="initial-error-detail">
            <span className="initial-error-detail-label">Detalle del error:</span>
            <code>{errorMessage}</code>
          </div>
        )}

        <div className="initial-error-actions">
          <motion.button
            type="button"
            className="btn-retry-initial-load"
            onClick={onRetry}
            whileHover={{ scale: 1.04, y: -2 }}
            whileTap={{ scale: 0.96 }}
          >
            🔄 Reintentar conexión
          </motion.button>
        </div>
      </div>
    </main>
  </div>
);

export default InitialLoadErrorView;
