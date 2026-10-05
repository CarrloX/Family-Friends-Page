import React, { useState, useCallback } from 'react';
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

/**
 * Componente interno que gestiona el estado de fallback de la imagen.
 * Se remonta automáticamente cuando cambia la identidad del juego
 * gracias al key que le asigna GameThumbnail, lo que reinicia
 * currentFallbackIndex a 0 sin necesidad de effects ni setState en render.
 */
const GameThumbnailImage: React.FC<Omit<GameThumbnailProps, 'recordId'>> = ({
  game,
  alt,
  className = '',
  loading = 'lazy',
  style,
}) => {
  const fallbacks = getGameImageFallbacks(game ?? undefined);
  const [currentFallbackIndex, setCurrentFallbackIndex] = useState(0);

  const currentSrc = currentFallbackIndex < fallbacks.length
    ? fallbacks[currentFallbackIndex]
    : getSteamPlaceholderSvg(game?.title || 'Steam Game');

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
      src={currentSrc}
      alt={alt ?? game?.title ?? 'Miniatura del juego'}
      className={className}
      loading={loading}
      style={style}
      onError={handleError}
    />
  );
};

/**
 * Componente público que calcula la identidad del juego y fuerza
 * un remount del componente interno cuando esta cambia.
 */
export const GameThumbnail: React.FC<GameThumbnailProps> = React.memo((props) => {
  const { game, recordId = '', ...imageProps } = props;
  const fallbacks = getGameImageFallbacks(game ?? undefined);
  const identity = JSON.stringify([fallbacks, recordId]);

  return <GameThumbnailImage key={identity} game={game} {...imageProps} />;
});
