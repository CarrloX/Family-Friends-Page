import { useEffect, useRef } from 'react';
import type { Game, GameResult, FreezePriceState } from '../types/voting';

export function useAutoUnfreezeWatcher(
  initialLoadStatus: 'loading' | 'loaded' | 'error',
  canManageContent: boolean,
  gamesMap: Record<string, Game>,
  results: GameResult[],
  freezeState: FreezePriceState,
  totalAssignedPoints: number,
  autoUnfreezePrice: (reason: string) => Promise<void>
) {
  const prevGamesSignatureRef = useRef<string>('');
  const prevWinnerIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (initialLoadStatus !== 'loaded' || !canManageContent) return;

    const gameIds = Object.keys(gamesMap).sort((a, b) => a.localeCompare(b)).join(',');
    const winnerId = results[0]?.game?.id || null;

    if (!prevGamesSignatureRef.current) {
      prevGamesSignatureRef.current = gameIds;
      prevWinnerIdRef.current = winnerId;
      return;
    }

    // 1. Si la lista de juegos propuestos cambió
    if (freezeState.isPrecioCongelado && prevGamesSignatureRef.current !== gameIds) {
      void Promise.resolve().then(() => {
        void autoUnfreezePrice('cambio en lista de juegos');
      });
    } else if (
      // 2. Si el juego ganador cambió
      freezeState.isPrecioCongelado &&
      freezeState.gameId &&
      winnerId &&
      freezeState.gameId !== winnerId
    ) {
      void Promise.resolve().then(() => {
        void autoUnfreezePrice('cambio de juego ganador');
      });
    } else if (
      // 3. Si se limpiaron todos los votos de la sesión
      freezeState.isPrecioCongelado &&
      totalAssignedPoints === 0
    ) {
      void Promise.resolve().then(() => {
        void autoUnfreezePrice('votos reiniciados');
      });
    }

    prevGamesSignatureRef.current = gameIds;
    prevWinnerIdRef.current = winnerId;
  }, [
    gamesMap,
    results,
    freezeState.isPrecioCongelado,
    freezeState.gameId,
    totalAssignedPoints,
    initialLoadStatus,
    canManageContent,
    autoUnfreezePrice,
  ]);
}
