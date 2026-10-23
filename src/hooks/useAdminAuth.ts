import { useState, useEffect, useCallback, useRef } from 'react';
import type React from 'react';
import {
  getAdminAccessState,
  loginAdminWithPassword,
  logoutAdmin,
  type AdminAccessState,
  type AuthResult,
} from '../services/accessControl';
import { subscribeToAuthState } from '../services/firebaseConfig';
import { useAdminShortcut } from './useAdminShortcut';

export interface UseAdminAuthOptions {
  isImportingRef: React.RefObject<boolean>;
  setIsEditMode: React.Dispatch<React.SetStateAction<boolean>>;
  onAdminReset?: () => void;
}

export interface UseAdminAuthReturn {
  adminAccess: AdminAccessState;
  canManageContent: boolean;
  showPinModal: boolean;
  requestAdminUnlockViaModal: (forceOpen?: boolean) => Promise<boolean>;
  handlePinSubmit: (password: string) => Promise<AuthResult>;
  handleLogoutAdmin: () => Promise<void>;
  handlePinCancel: () => void;
}

export function useAdminAuth({
  isImportingRef,
  setIsEditMode,
  onAdminReset,
}: UseAdminAuthOptions): UseAdminAuthReturn {
  const [adminAccess, setAdminAccess] = useState(() => getAdminAccessState());
  const canManageContent = adminAccess.canManageContent;
  const [showPinModal, setShowPinModal] = useState<boolean>(false);

  const pinModalResolveRef = useRef<((value: boolean) => void) | null>(null);
  const pendingUnlockPromiseRef = useRef<Promise<boolean> | null>(null);

  // Suscripción en tiempo real al estado de autenticación de Firebase
  useEffect(() => {
    const unsubscribe = subscribeToAuthState(() => {
      setAdminAccess(getAdminAccessState());
    });
    return unsubscribe;
  }, []);

  // La limpieza de una eventual Promise pendiente del modal PIN al desmontar
  useEffect(() => {
    return () => {
      if (pinModalResolveRef.current) {
        pinModalResolveRef.current(false);
        pinModalResolveRef.current = null;
        pendingUnlockPromiseRef.current = null;
      }
    };
  }, []);

  // Si el usuario no tiene permisos de administración, reiniciar estados asociados
  useEffect(() => {
    if (!canManageContent) {
      void Promise.resolve().then(() => {
        setIsEditMode(false);
        onAdminReset?.();
      });
    }
  }, [canManageContent, setIsEditMode, onAdminReset]);

  // Desbloqueo de admin vía modal BottomSheet (reemplaza window.prompt)
  const requestAdminUnlockViaModal = useCallback((forceOpen = false): Promise<boolean> => {
    const state = getAdminAccessState();
    if (state.isAdmin && !forceOpen) {
      return Promise.resolve(true);
    }

    if (pendingUnlockPromiseRef.current !== null) {
      return pendingUnlockPromiseRef.current;
    }

    const unlockPromise = new Promise<boolean>((resolve) => {
      pinModalResolveRef.current = resolve;
      setShowPinModal(true);
    });

    pendingUnlockPromiseRef.current = unlockPromise;
    return unlockPromise;
  }, []);

  // Si la URL contiene ?admin=true y el usuario no tiene privilegios de admin,
  // solicitar automáticamente el desbloqueo mediante el modal
  useEffect(() => {
    const state = getAdminAccessState();
    if (state.requestedAdmin && !state.isAdmin) {
      void requestAdminUnlockViaModal(true);
    }
  }, [requestAdminUnlockViaModal]);

  // Handler cuando el usuario envía la contraseña en el modal
  const handlePinSubmit = useCallback(
    async (password: string): Promise<AuthResult> => {
      const result = await loginAdminWithPassword(password);
      if (result.success) {
        setAdminAccess(getAdminAccessState());
        setShowPinModal(false);
        const resolve = pinModalResolveRef.current;
        pinModalResolveRef.current = null;
        pendingUnlockPromiseRef.current = null;
        resolve?.(true);
      }
      return result;
    },
    []
  );

  const handleLogoutAdmin = useCallback(async () => {
    if (isImportingRef.current) return;
    await logoutAdmin();
    setAdminAccess(getAdminAccessState());
    setIsEditMode(false);
    onAdminReset?.();
  }, [isImportingRef, setIsEditMode, onAdminReset]);

  const handlePinCancel = useCallback(() => {
    setShowPinModal(false);
    const resolve = pinModalResolveRef.current;
    pinModalResolveRef.current = null;
    pendingUnlockPromiseRef.current = null;
    resolve?.(false);
  }, []);

  // Atajo de teclado Shift + Alt + A (o Alt + Shift + A) para acceso de admin
  useAdminShortcut(requestAdminUnlockViaModal, setIsEditMode);

  return {
    adminAccess,
    canManageContent,
    showPinModal,
    requestAdminUnlockViaModal,
    handlePinSubmit,
    handleLogoutAdmin,
    handlePinCancel,
  };
}
