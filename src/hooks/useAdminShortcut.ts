import { useEffect } from 'react';
import type React from 'react';
import { getAdminAccessState } from '../services/accessControl';

export function useAdminShortcut(
  requestAdminUnlockViaModal: (forceOpen?: boolean) => Promise<boolean>,
  setIsEditMode: React.Dispatch<React.SetStateAction<boolean>>
): void {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isKeyA = event.key === 'a' || event.key === 'A' || event.code === 'KeyA';
      const isAltShift = event.altKey && event.shiftKey;

      if (isAltShift && isKeyA) {
        event.preventDefault();
        event.stopPropagation();

        const state = getAdminAccessState();
        if (state.isAdmin) {
          setIsEditMode((prev) => !prev);
        } else {
          void requestAdminUnlockViaModal(true);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [requestAdminUnlockViaModal, setIsEditMode]);
}

export default useAdminShortcut;
