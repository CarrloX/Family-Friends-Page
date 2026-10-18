import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { SyncState } from '../services/dataStore';

const SYNC_STATUS_CONFIG: Record<string, { icon: string; className: string }> = {
  saving: { icon: '⏳', className: 'sync-indicator sync-saving' },
  synced: { icon: '✅', className: 'sync-indicator sync-synced' },
  error: { icon: '❌', className: 'sync-indicator sync-error' },
  local: { icon: '💾', className: 'sync-indicator sync-local' },
};

export interface SyncIndicatorProps {
  syncState: SyncState;
}

export const SyncIndicator: React.FC<SyncIndicatorProps> = ({ syncState }) => {
  const { status, message } = syncState;
  const isVisible = status !== 'idle';
  const config = SYNC_STATUS_CONFIG[status] ?? { icon: '✅', className: 'sync-indicator' };

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          key="sync-indicator"
          className={config.className}
          title={message}
          initial={{ opacity: 0, y: 12, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.95 }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
        >
          <span className="sync-icon">{config.icon}</span>
          <span className="sync-text">{message}</span>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default SyncIndicator;
