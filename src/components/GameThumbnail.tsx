import React, { useState, useEffect, useMemo, useCallback } from 'react';
import type { Game } from '../types/voting';
import { getGameImageFallbacks, getSteamPlaceholderSvg } from '../utils/steamImages';

interface GameThumbnailProps {
  game?: Partial<Game> | null;
  alt?: string;
  className?: string;
  recordId?: string;
  loading?: 'lazy' | 'eager';
  style?: React.CSSProperties;
}

export const GameThumbnail: React.FC<GameThumbnailProps> = React.memo(({
  game,
  alt,
  className = '',
  recordId = '',
  loading = 'eager',
  style,
}) => {
  const fallbacks = useMemo(() => getGameImageFallbacks(game || undefined), [game]);
  const [currentFallbackIndex, setCurrentFallbackIndex] = useState(0);

  // Reiniciar el índice si cambia el juego o el registro de historial
  useEffect(() => {
    setCurrentFallbackIndex(0);
  }, [game?.id, game?.appId, game?.coverImage, recordId]);

  const currentSrc = useMemo(() => {
    if (currentFallbackIndex < fallbacks.length) {
      return fallbacks[currentFallbackIndex];
    }
    return getSteamPlaceholderSvg(game?.title || 'Steam Game');
  }, [fallbacks, currentFallbackIndex, game?.title]);

  const handleError = useCallback(() => {
    setCurrentFallbackIndex((prev) => {
      if (prev + 1 < fallbacks.length) {
        return prev + 1;
      }
      return prev;
    });
  }, [fallbacks.length]);

  return (
    <img
      key={`${recordId}-${game?.id || game?.appId || 'thumb'}-${currentFallbackIndex}`}
      src={currentSrc}
      alt={alt || game?.title || 'Miniatura del juego'}
      className={className}
      loading={loading}
      style={style}
      onError={handleError}
    />
  );
});
