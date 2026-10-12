import React, { useRef, useState, useCallback, useEffect } from 'react';
import type { Game, GameResult } from '../types/voting';
import { CompetitorCard } from './CompetitorCard';

interface HistoryCompetitorsCarouselProps {
  items: (GameResult | Game)[];
  recordId: string;
}

export const HistoryCompetitorsCarousel: React.FC<HistoryCompetitorsCarouselProps> = React.memo(({
  items,
  recordId,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [isOverflowing, setIsOverflowing] = useState(false);

  const isDraggingRef = useRef(false);
  const startXRef = useRef(0);
  const scrollLeftRef = useRef(0);

  const checkScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const hasOverflow = el.scrollWidth > el.clientWidth + 2;
    setIsOverflowing(hasOverflow);
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 4);
  }, []);

  // 1. Recalcular estado de desbordamiento cuando cambien los elementos
  useEffect(() => {
    if (items.length === 0) return;
    checkScroll();

    // Recálculos diferidos para sincronizar con la animación de apertura/renderizado del modal.
    // NOTA DE MANTENIBILIDAD: Los retardos (100ms y 350ms) dependen de la duración de la transición CSS del modal;
    // si se modifican los tiempos de dicha animación en los estilos, estos valores deberán revisarse.
    const t1 = setTimeout(checkScroll, 100);
    const t2 = setTimeout(checkScroll, 350);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [items, checkScroll]);

  // 2. Al cambiar de registro de votación, volver al inicio del carrusel
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollLeft = 0;
      checkScroll();
    }
  }, [recordId, checkScroll]);

  // 3. Montaje y desmontaje único de listeners de interacción (wheel, drag, resize) y ResizeObserver
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const handleResize = () => checkScroll();
    window.addEventListener('resize', handleResize);

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        checkScroll();
      });
      resizeObserver.observe(el);
    }

    const onWheelListener = (e: WheelEvent) => {
      if (el.scrollWidth > el.clientWidth) {
        if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
          const atLeft = el.scrollLeft <= 0;
          const atRight = el.scrollLeft >= el.scrollWidth - el.clientWidth - 1;
          if ((e.deltaY < 0 && !atLeft) || (e.deltaY > 0 && !atRight)) {
            e.preventDefault();
            el.scrollLeft += e.deltaY;
            checkScroll();
          }
        }
      }
    };

    let isDown = false;
    let hasDragged = false;
    let initialX = 0;

    const onMouseDownListener = (e: MouseEvent) => {
      // Solo botón primario (izquierdo)
      if (e.button !== 0) return;
      isDown = true;
      hasDragged = false;
      initialX = e.pageX;
      startXRef.current = e.pageX - el.offsetLeft;
      scrollLeftRef.current = el.scrollLeft;
    };

    const onMouseMoveListener = (e: MouseEvent) => {
      if (!isDown) return;

      const deltaX = Math.abs(e.pageX - initialX);

      // Umbral mínimo de 5px para considerar un arrastre intencional
      if (!hasDragged && deltaX > 5) {
        hasDragged = true;
        isDraggingRef.current = true;
        el.classList.add('is-dragging');
      }

      if (hasDragged) {
        e.preventDefault();
        const x = e.pageX - el.offsetLeft;
        const walk = (x - startXRef.current) * 1.4;
        el.scrollLeft = scrollLeftRef.current - walk;
        // El listener 'scroll' del elemento ya se encarga de checkScroll()
      }
    };

    const onMouseUpOrLeaveListener = () => {
      isDown = false;
      if (hasDragged) {
        el.classList.remove('is-dragging');
        // Pequeño retardo para evitar disparar eventos click inmediatos en tarjetas tras arrastrar
        setTimeout(() => {
          isDraggingRef.current = false;
        }, 50);
      } else {
        isDraggingRef.current = false;
      }
      hasDragged = false;
    };

    // Prevenir clics accidentales si el usuario arrastró
    const onClickCaptureListener = (e: MouseEvent) => {
      if (hasDragged || isDraggingRef.current) {
        e.stopPropagation();
        e.preventDefault();
      }
    };

    el.addEventListener('wheel', onWheelListener, { passive: false });
    el.addEventListener('mousedown', onMouseDownListener);
    el.addEventListener('click', onClickCaptureListener, true);
    window.addEventListener('mousemove', onMouseMoveListener);
    window.addEventListener('mouseup', onMouseUpOrLeaveListener);

    return () => {
      window.removeEventListener('resize', handleResize);
      resizeObserver?.disconnect();
      el.removeEventListener('wheel', onWheelListener);
      el.removeEventListener('mousedown', onMouseDownListener);
      el.removeEventListener('click', onClickCaptureListener, true);
      window.removeEventListener('mousemove', onMouseMoveListener);
      window.removeEventListener('mouseup', onMouseUpOrLeaveListener);
    };
  }, [checkScroll]);

  const scrollCarousel = (direction: 'left' | 'right') => {
    const el = scrollRef.current;
    if (!el) return;

    const card = el.querySelector<HTMLElement>('.competitor-card');
    const styles = window.getComputedStyle(el);
    const gap = Number.parseFloat(styles.columnGap || styles.gap) || 0;
    const scrollAmount = card ? card.offsetWidth + gap : el.clientWidth;

    el.scrollBy({
      left: direction === 'left' ? -scrollAmount : scrollAmount,
      behavior: 'smooth',
    });
  };

  if (items.length === 0) return null;

  return (
    <div className="history-competitors-section">
      <div className="history-competitors-header-bar">
        <h5>🏆 TABLA DE POSICIONES FINAL:</h5>
        {isOverflowing && (
          <nav className="competitors-carousel-nav" aria-label="Navegación de posiciones">
            <button
              type="button"
              className="competitors-nav-btn"
              onClick={() => scrollCarousel('left')}
              disabled={!canScrollLeft}
              aria-label="Ver posición anterior"
              title="Ver anteriores"
            >
              ◀
            </button>
            <span className="competitors-scroll-hint">Desliza para ver más</span>
            <button
              type="button"
              className="competitors-nav-btn"
              onClick={() => scrollCarousel('right')}
              disabled={!canScrollRight}
              aria-label="Ver siguiente posición"
              title="Ver siguientes"
            >
              ▶
            </button>
          </nav>
        )}
      </div>

      <div className="competitors-carousel-wrapper">
        {isOverflowing && canScrollLeft && (
          <div className="competitors-fade-edge fade-left" aria-hidden="true" />
        )}

        <section
          ref={scrollRef}
          className="competitors-grid"
          aria-label="Clasificación final de juegos"
          onScroll={checkScroll}
        >
          {/* Se espera que items llegue ordenado por clasificación final (el índice 0 corresponde al ganador) */}
          {items.map((item, idx) => {
            const game = 'game' in item ? item.game : item;
            const pts = 'weightedPoints' in item ? item.weightedPoints : null;
            return (
              <CompetitorCard
                key={`${recordId}-${game.id || idx}`}
                game={game}
                pts={pts}
                position={idx}
                recordId={recordId}
              />
            );
          })}
        </section>

        {isOverflowing && canScrollRight && (
          <div className="competitors-fade-edge fade-right" aria-hidden="true" />
        )}
      </div>
    </div>
  );
});
