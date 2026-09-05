import { motion, AnimatePresence } from 'framer-motion';
import { SteamVotingDashboard } from './components/SteamVotingDashboard';
import { UpdatePrompt } from './components/UpdatePrompt';
import { useRegisterSW } from 'virtual:pwa-register/react';
import './App.css';

function App() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;

      // Comprobación periódica en segundo plano cada 10 minutos
      const intervalMs = 10 * 60 * 1000;
      setInterval(() => {
        if (!navigator.onLine) return;
        registration.update().catch((err) => {
          console.debug('Error comprobando actualización periódica de SW:', err);
        });
      }, intervalMs);

      // Comprobar actualización al volver a la pestaña o reactivar la app en el móvil
      const handleVisibilityOrFocus = () => {
        if (document.visibilityState === 'visible' && navigator.onLine) {
          registration.update().catch((err) => {
            console.debug('Error comprobando actualización al enfocar:', err);
          });
        }
      };

      document.addEventListener('visibilitychange', handleVisibilityOrFocus);
      window.addEventListener('focus', handleVisibilityOrFocus);
    },
    onRegisterError(error) {
      console.error('Error registrando Service Worker:', error);
    },
  });

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

      <UpdatePrompt
        show={needRefresh}
        updateServiceWorker={updateServiceWorker}
      />
    </>
  );
}

export default App;
