import { motion, AnimatePresence } from 'framer-motion';
import { SteamVotingDashboard } from './components/SteamVotingDashboard';
import { useRegisterSW } from 'virtual:pwa-register/react';
import './App.css';

function App() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  return (
    <>
      <AnimatePresence mode="wait">
        <motion.div
          key="app-main-view"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -16 }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          style={{ width: '100%', minHeight: '100vh' }}
        >
          <SteamVotingDashboard />
        </motion.div>
      </AnimatePresence>

      <AnimatePresence>
        {needRefresh && (
          <motion.div
            className="update-toast"
            initial={{ opacity: 0, y: 50, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 300, damping: 25 }}
          >
            <div className="update-toast-content">
              <span className="update-toast-icon">🚀</span>
              <span className="update-toast-text">Nueva versión disponible</span>
            </div>
            <button
              type="button"
              className="update-toast-btn"
              onClick={() => {
                void updateServiceWorker(true);
                setNeedRefresh(false);
              }}
            >
              Actualizar
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

export default App;
