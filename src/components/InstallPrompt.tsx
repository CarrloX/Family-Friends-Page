import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface PromptResult {
  outcome: 'accepted' | 'dismissed';
  platform?: string;
}

interface BeforeInstallPromptEvent extends Event {
  readonly platforms?: string[];
  readonly userChoice?: Promise<PromptResult>;
  prompt: () => Promise<PromptResult | void>;
}

declare global {
  interface WindowEventMap {
    beforeinstallprompt: BeforeInstallPromptEvent;
    appinstalled: Event;
  }
}

// Conserva el evento entre montajes del componente mientras el módulo siga activo.
let globalDeferredPrompt: BeforeInstallPromptEvent | null = null;

const isIosDeviceBrowser = (): boolean => {
  if (typeof window === 'undefined') return false;

  const { navigator } = window;

  const isAppleMobile =
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  return (
    isAppleMobile &&
    !(navigator as Navigator & { standalone?: boolean }).standalone
  );
};

export const InstallPrompt = () => {
  const [isStandalone] = useState(() => {
    if (typeof window === 'undefined') return false;
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true
    );
  });
  const [isIosDevice] = useState(() => isIosDeviceBrowser());
  const [showButton, setShowButton] = useState(() => {
    if (typeof window === 'undefined') return false;
    return isIosDeviceBrowser() || !!globalDeferredPrompt;
  });
  const [showIosHint, setShowIosHint] = useState(false);
  const [isPrompting, setIsPrompting] = useState(false);

  useEffect(() => {
    if (isStandalone) return;

    const handler = (e: BeforeInstallPromptEvent) => {
      e.preventDefault();
      globalDeferredPrompt = e;
      setShowButton(true);
    };

    const handleAppInstalled = () => {
      globalDeferredPrompt = null;
      setShowButton(false);
      setShowIosHint(false);
      setIsPrompting(false);
    };

    window.addEventListener('beforeinstallprompt', handler);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, [isStandalone]);

  const handleInstallClick = async () => {
    if (isIosDevice) {
      setShowIosHint((prev) => !prev);
      return;
    }

    if (isPrompting) return;

    const deferredPrompt = globalDeferredPrompt;
    if (!deferredPrompt) return;

    setIsPrompting(true);

    // El evento beforeinstallprompt es de un solo uso; limpiar inmediatamente
    globalDeferredPrompt = null;
    setShowButton(false);

    try {
      const promptResult = await deferredPrompt.prompt();
      const choice = promptResult ?? (await deferredPrompt.userChoice);

      if (choice?.outcome === 'accepted') {
        setShowIosHint(false);
      }
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error('[InstallPrompt] Error al iniciar la instalación:', error);
      }
    } finally {
      setIsPrompting(false);
    }
  };

  if (isStandalone || !showButton) return null;

  return (
    <div className="install-prompt-wrapper">
      <motion.button
        type="button"
        className="install-prompt-btn"
        onClick={handleInstallClick}
        disabled={isPrompting}
        aria-busy={isPrompting}
        aria-expanded={isIosDevice ? showIosHint : undefined}
        aria-controls={showIosHint ? 'install-ios-hint' : undefined}
        title="Instalar aplicación"
        whileHover={isPrompting ? undefined : { scale: 1.05 }}
        whileTap={isPrompting ? undefined : { scale: 0.95 }}
      >
        <span className="install-icon">📲</span>
        <span className="install-text">Instalar App</span>
      </motion.button>
      <AnimatePresence>
        {showIosHint && (
          <motion.div
            id="install-ios-hint"
            className="install-ios-hint"
            role="status"
            aria-live="polite"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
          >
            Toca <strong>Compartir</strong> y luego{' '}
            <strong>«Agregar a pantalla de inicio»</strong>.
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};