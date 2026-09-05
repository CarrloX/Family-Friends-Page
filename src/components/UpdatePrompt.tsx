import React, { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FaRocket, FaSyncAlt } from 'react-icons/fa';

interface UpdatePromptProps {
  show: boolean;
  updateServiceWorker: (reloadPage?: boolean) => Promise<void>;
}

export const UpdatePrompt: React.FC<UpdatePromptProps> = ({
  show,
  updateServiceWorker,
}) => {
  const [isUpdating, setIsUpdating] = useState(false);

  const handleUpdate = useCallback(async () => {
    if (isUpdating) return;
    setIsUpdating(true);

    try {
      // 1. Invocar a la función de VitePWA / Workbox sin recargar inmediatamente
      try {
        await updateServiceWorker(false);
      } catch (err) {
        console.warn('Advertencia en updateServiceWorker:', err);
      }

      // 2. Enviar señal directa a Service Workers en espera si están presentes
      if ('serviceWorker' in navigator) {
        try {
          const registrations = await navigator.serviceWorker.getRegistrations();
          for (const reg of registrations) {
            if (reg.waiting) {
              reg.waiting.postMessage({ type: 'SKIP_WAITING' });
            }
          }
        } catch (swErr) {
          console.warn('Error obteniendo registros de ServiceWorker:', swErr);
        }
      }

      // 3. Purgar activamente el almacenamiento en caché (CacheStorage) del navegador
      // para garantizar que ningún bundle JS/CSS ni index.html obsoleto sea servido
      if ('caches' in window) {
        try {
          const cacheKeys = await caches.keys();
          await Promise.all(cacheKeys.map((key) => caches.delete(key)));
        } catch (cacheErr) {
          console.warn('Error purgando CacheStorage:', cacheErr);
        }
      }

      // 4. Recarga limpia del navegador
      let reloaded = false;
      const forceReload = () => {
        if (reloaded) return;
        reloaded = true;
        window.location.reload();
      };

      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.addEventListener('controllerchange', forceReload, { once: true });
      }

      // Fallback de seguridad: si controllerchange no se dispara en 500ms, recargar de todas formas
      setTimeout(forceReload, 500);

    } catch (error) {
      console.error('Error durante la actualización:', error);
      window.location.reload();
    }
  }, [isUpdating, updateServiceWorker]);

  return (
    <AnimatePresence>
      {show && (
        <motion.aside
          role="region"
          aria-live="polite"
          aria-label="Notificación de actualización disponible"
          className="update-toast"
          initial={{ opacity: 0, y: 40, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 20, scale: 0.95 }}
          transition={{ type: 'spring', stiffness: 350, damping: 28 }}
        >
          <div className="update-toast-badge-glow" aria-hidden="true" />

          <div className="update-toast-content">
            <div className="update-toast-icon-wrapper" aria-hidden="true">
              <FaRocket className="update-toast-rocket-icon" />
            </div>
            <div className="update-toast-info">
              <span className="update-toast-title">Nueva versión disponible</span>
              <span className="update-toast-desc">
                Hay mejoras y cambios recientes listos para aplicar.
              </span>
            </div>
          </div>

          <div className="update-toast-actions">
            <button
              type="button"
              className={`update-toast-btn ${isUpdating ? 'is-loading' : ''}`}
              onClick={handleUpdate}
              disabled={isUpdating}
              aria-busy={isUpdating}
            >
              <FaSyncAlt className={`update-toast-btn-icon ${isUpdating ? 'spin' : ''}`} />
              <span>{isUpdating ? 'Actualizando...' : 'Actualizar'}</span>
            </button>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
};
