import { useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

declare global {
  interface WindowEventMap {
    beforeinstallprompt: BeforeInstallPromptEvent;
  }
}

// Store globally so it persists across HMR / re-mounts
let globalDeferredPrompt: BeforeInstallPromptEvent | null = null;

export const InstallPrompt = () => {
  const [showButton, setShowButton] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    // Check if already running in standalone mode (installed)
    if (window.matchMedia('(display-mode: standalone)').matches) {
      setIsStandalone(true);
      return;
    }

    const handler = (e: BeforeInstallPromptEvent) => {
      e.preventDefault();
      globalDeferredPrompt = e;
      setShowButton(true);
    };

    window.addEventListener('beforeinstallprompt', handler);

    // If the event already fired before mount, show button immediately
    if (globalDeferredPrompt) {
      setShowButton(true);
    }

    // Fallback: show button after 2s if browser supports PWA
    const timeout = setTimeout(() => {
      if ('serviceWorker' in navigator) {
        setShowButton(true);
      }
    }, 2000);

    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
      clearTimeout(timeout);
    };
  }, []);

  const handleInstallClick = async () => {
    if (globalDeferredPrompt) {
      await globalDeferredPrompt.prompt();
      const { outcome } = await globalDeferredPrompt.userChoice;
      if (outcome === 'accepted') {
        setShowButton(false);
        globalDeferredPrompt = null;
      }
    }
  };

  if (isStandalone || !showButton) return null;

  return (
    <button
      type="button"
      className="install-prompt-btn"
      onClick={handleInstallClick}
      title="Instalar aplicación"
    >
      <span className="install-icon">📲</span>
      <span className="install-text">Instalar App</span>
    </button>
  );
};