import { useEffect, useRef } from 'react';

export const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Determina si un elemento es visible en pantalla y accesible para el foco.
 *
 * Utiliza `getClientRects().length > 0` en lugar de `offsetParent !== null` para evitar
 * falsos negativos en elementos con `position: fixed`, SVG o contextos de CSS modernos.
 * Excluye además elementos que contengan o hereden el atributo `aria-hidden="true"`.
 */
export function isFocusableVisible(el: HTMLElement): boolean {
  if (el.getAttribute('aria-hidden') === 'true' || el.closest('[aria-hidden="true"]')) {
    return false;
  }
  return el.getClientRects().length > 0;
}

/**
 * Controla el ciclo de tabulación para mantener el foco dentro del contenedor del modal (Focus Trap).
 */
export function trapFocus(e: KeyboardEvent, container: HTMLElement): void {
  const focusableElements = Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
  ).filter(isFocusableVisible);

  if (focusableElements.length === 0) {
    e.preventDefault();
    return;
  }

  const firstElement = focusableElements[0];
  const lastElement = focusableElements.at(-1);

  if (e.shiftKey) {
    // Shift + Tab: si estamos en el primer elemento o fuera del contenedor, ir al último
    if (document.activeElement === firstElement || !container.contains(document.activeElement)) {
      e.preventDefault();
      lastElement?.focus();
    }
  } else if (document.activeElement === lastElement || !container.contains(document.activeElement)) {
    // Tab: si estamos en el último elemento o fuera del contenedor, ir al primero
    e.preventDefault();
    firstElement?.focus();
  }
}

export interface UseModalFocusTrapOptions<T extends HTMLElement = HTMLElement> {
  /**
   * Ref al contenedor del modal. Si no se pasa, el hook creará y retornará uno internamente.
   */
  containerRef?: React.RefObject<T | null>;
  /**
   * Ref opcional al elemento que debe recibir el foco inicial al abrirse el modal.
   * Si no se especifica, se enfocará el primer elemento interactivo disponible en el contenedor.
   */
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  /**
   * Ref opcional al elemento específico al que se debe restaurar el foco al cerrar el modal.
   * Si no se especifica, se devolverá al elemento que tenía el foco activo antes de abrirse el modal.
   */
  returnFocusRef?: React.RefObject<HTMLElement | null>;
  /**
   * Callback invocado al pulsar la tecla Escape.
   */
  onEscape?: () => void;
  /**
   * Si es true, desactiva la respuesta a Escape (ej. cuando hay una operación asíncrona en curso).
   * El ciclo de tabulación se mantiene atrapado para evitar fugas de foco.
   */
  disabled?: boolean;
  /**
   * Tiempo de retardo en ms antes de fijar el foco inicial.
   * Útil para esperar a que terminen o avancen animaciones de entrada (ej. BottomSheet en framer-motion).
   * Por defecto: 100ms.
   */
  initialFocusDelay?: number;
  /**
   * Si es true, restaura el foco al elemento que estaba activo antes de abrir el modal cuando éste se desmonte.
   * Por defecto: true.
   */
  restoreFocus?: boolean;
}

/**
 * Hook reutilizable para gestionar el Focus Trap y accesibilidad por teclado en diálogos modales.
 *
 * Características:
 * - Atrapa la tecla Tab / Shift+Tab dentro del modal (evita fuga de foco al fondo).
 * - Maneja la tecla Escape respetando el estado de deshabilitación / carga.
 * - Enfoca un elemento inicial o el primer elemento interactivo disponible.
 * - Guarda y restaura el foco previo al cerrar el modal (WAI-ARIA).
 */
export function useModalFocusTrap<T extends HTMLElement = HTMLDivElement>(
  options: UseModalFocusTrapOptions<T> = {}
): React.RefObject<T | null> {
  const {
    containerRef: externalContainerRef,
    initialFocusRef,
    returnFocusRef,
    onEscape,
    disabled = false,
    initialFocusDelay = 100,
    restoreFocus = true,
  } = options;

  const internalContainerRef = useRef<T | null>(null);
  const containerRef = externalContainerRef ?? internalContainerRef;

  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const initialFocusRefSync = useRef(initialFocusRef);
  const returnFocusRefSync = useRef(returnFocusRef);
  const restoreFocusSync = useRef(restoreFocus);
  const onEscapeRef = useRef(onEscape);
  const disabledRef = useRef(disabled);

  // Mantener los refs sincronizados con cada render sin disparar efectos
  useEffect(() => {
    initialFocusRefSync.current = initialFocusRef;
    returnFocusRefSync.current = returnFocusRef;
    restoreFocusSync.current = restoreFocus;
    onEscapeRef.current = onEscape;
    disabledRef.current = disabled;
  });

  // Capturar el elemento activo al montar y restaurarlo estrictamente al desmontar el modal
  useEffect(() => {
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;

    const timer = setTimeout(() => {
      if (initialFocusRefSync.current?.current) {
        initialFocusRefSync.current.current.focus();
      } else if (containerRef.current) {
        const focusable = Array.from(
          containerRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
        ).filter(isFocusableVisible);
        focusable[0]?.focus();
      }
    }, initialFocusDelay);

    return () => {
      clearTimeout(timer);
      if (restoreFocusSync.current) {
        const targetElement = returnFocusRefSync.current?.current ?? previouslyFocusedRef.current;
        // Se ejecuta en el siguiente frame para permitir que AnimatePresence / React concluyan el desmontaje
        requestAnimationFrame(() => {
          if (targetElement && targetElement.isConnected) {
            targetElement.focus();
          }
        });
      }
    };
  }, [containerRef, initialFocusDelay]);

  // Manejo de teclado (Escape y Tab / Shift+Tab)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (!disabledRef.current && onEscapeRef.current) {
          e.preventDefault();
          onEscapeRef.current();
        }
        return;
      }

      if (e.key === 'Tab' && containerRef.current) {
        trapFocus(e, containerRef.current);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [containerRef]);

  return containerRef;
}
