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

  useEffect(() => {
    if (items.length === 0) return;
    checkScroll();

    // Verificaciones programadas tras la animación de apertura del modal
    const t1 = setTimeout(checkScroll, 100);
    const t2 = setTimeout(checkScroll, 350);

    const el = scrollRef.current;
    if (!el) {
      return () => {
        clearTimeout(t1);
        clearTimeout(t2);
      };
    }

    const handleResize = () => checkScroll();
    window.addEventListener('resize', handleResize);

    const resizeObserver = new ResizeObserver(() => {
      checkScroll();
    });
    resizeObserver.observe(el);

    // Permitir scroll horizontal fluido con rueda del ratón en desktop cuando haya desbordamiento
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

    el.addEventListener('wheel', onWheelListener, { passive: false });

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      window.removeEventListener('resize', handleResize);
      resizeObserver.disconnect();
      el.removeEventListener('wheel', onWheelListener);
    };
  }, [checkScroll, items, recordId]);

  // Al cambiar de registro de votación, volver al inicio del carrusel
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollLeft = 0;
      checkScroll();
    }
  }, [recordId, checkScroll]);

  const scrollCarousel = (direction: 'left' | 'right') => {
    if (!scrollRef.current) return;
    const card = scrollRef.current.querySelector<HTMLElement>('.competitor-card');
    const scrollAmount = card ? card.offsetWidth + 10 : 200;
    scrollRef.current.scrollBy({
      left: direction === 'left' ? -scrollAmount : scrollAmount,
      behavior: 'smooth',
    });
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    const el = scrollRef.current;
    if (!el) return;
    isDraggingRef.current = true;
    startXRef.current = e.pageX - el.offsetLeft;
    scrollLeftRef.current = el.scrollLeft;
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDraggingRef.current || !scrollRef.current) return;
    e.preventDefault();
    const el = scrollRef.current;
    const x = e.pageX - el.offsetLeft;
    const walk = (x - startXRef.current) * 1.4;
    el.scrollLeft = scrollLeftRef.current - walk;
    checkScroll();
  };

  const handleMouseUpOrLeave = () => {
    isDraggingRef.current = false;
  };

  if (items.length === 0) return null;

  return (
    <div className="history-competitors-section">
      <div className="history-competitors-header-bar">
        <h5>🏆 TABLA DE POSICIONES FINAL:</h5>
        {isOverflowing && (
          <div className="competitors-carousel-nav" aria-label="Navegación de posiciones">
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
          </div>
        )}
      </div>

      <div className="competitors-carousel-wrapper">
        {isOverflowing && canScrollLeft && (
          <div className="competitors-fade-edge fade-left" aria-hidden="true" />
        )}

        <div
          ref={scrollRef}
          className="competitors-grid"
          onScroll={checkScroll}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUpOrLeave}
          onMouseLeave={handleMouseUpOrLeave}
        >
          {items.map((item, idx) => {
            const game = 'game' in item ? item.game : item;
            const pts = 'weightedPoints' in item ? item.weightedPoints : null;
            return (
              <CompetitorCard
                key={`${recordId}-${game.id || idx}`}
                game={game}
                pts={pts}
                idx={idx}
                recordId={recordId}
              />
            );
          })}
        </div>

        {isOverflowing && canScrollRight && (
          <div className="competitors-fade-edge fade-right" aria-hidden="true" />
        )}
      </div>
    </div>
  );
});
