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

const isIos = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) &&
  !(window.navigator as Navigator & { standalone?: boolean }).standalone;

export const InstallPrompt = () => {
  const [showButton, setShowButton] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [isIosDevice, setIsIosDevice] = useState(false);
  const [showIosHint, setShowIosHint] = useState(false);

  useEffect(() => {
    // Already installed
    if (
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone
    ) {
      setIsStandalone(true);
      return;
    }

    // iOS: no beforeinstallprompt support, show manual hint instead
    if (isIos()) {
      setIsIosDevice(true);
      setShowButton(true);
      return;
    }

    // If the event already fired before this component mounted (e.g. HMR)
    if (globalDeferredPrompt) {
      setShowButton(true);
    }

    const handler = (e: BeforeInstallPromptEvent) => {
      e.preventDefault();
      globalDeferredPrompt = e;
      setShowButton(true);
    };

    window.addEventListener('beforeinstallprompt', handler);

    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
    };
  }, []);

  const handleInstallClick = async () => {
    if (isIosDevice) {
      setShowIosHint((prev) => !prev);
      return;
    }

    if (!globalDeferredPrompt) return;

    await globalDeferredPrompt.prompt();
    const { outcome } = await globalDeferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setShowButton(false);
      globalDeferredPrompt = null;
    }
  };

  if (isStandalone || !showButton) return null;

  return (
    <div className="install-prompt-wrapper">
      <button
        type="button"
        className="install-prompt-btn"
        onClick={handleInstallClick}
        title="Instalar aplicación"
      >
        <span className="install-icon">📲</span>
        <span className="install-text">Instalar App</span>
      </button>
      {showIosHint && (
        <div className="install-ios-hint">
          Tocá <strong>Compartir</strong> (☐↑) y luego <strong>"Agregar a inicio"</strong>
        </div>
      )}
    </div>
  );
};