import { useCallback, useRef, useState } from 'react';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { FreezePriceState, Game, GameResult, SteamPriceInfo, Voter } from '../types/voting';
import {
  saveFreezePriceState,
  unfreezePriceState,
  DEFAULT_FREEZE_STATE,
  type SyncState,
} from '../services/dataStore';
import { formatCopPrice } from '../services/steamStoreApi';
import { serializeDashboardState } from './useDashboardPersistence';

interface UsePriceFreezeOptions {
  canManageContent: boolean;
  isImportingRef: RefObject<boolean>;
  voters: Voter[];
  gamesMap: Record<string, Game>;
  results: GameResult[];
  freezeState: FreezePriceState;
  setFreezeState: Dispatch<SetStateAction<FreezePriceState>>;
  setSyncState: Dispatch<SetStateAction<SyncState>>;
  lastPersistedDashboardSignatureRef: RefObject<string>;
}

function isValidPriceInfo(price?: SteamPriceInfo | null): price is SteamPriceInfo {
  if (!price) return false;
  return Boolean(
    price.isFree === true ||
    (typeof price.final === 'number' && !Number.isNaN(price.final))
  );
}

function buildFrozenPriceState(
  gameId: string,
  priceInfo: SteamPriceInfo
): FreezePriceState {
  const isFree = Boolean(priceInfo.isFree || priceInfo.final === 0);
  const finalPrice = isFree ? 0 : (priceInfo.final ?? 0);
  const discountPercent = priceInfo.discountPercent ?? 0;
  const formattedPrice = priceInfo.finalFormatted || (isFree ? 'Gratis' : formatCopPrice(finalPrice));
  const initialPrice = priceInfo.initial ?? finalPrice;
  const initialFormatted = priceInfo.initialFormatted ?? formattedPrice;

  return {
    isPrecioCongelado: true,
    precioCongelado: finalPrice,
    descuentoCongelado: discountPercent,
    precioCongeladoFormatted: formattedPrice,
    precioOriginalCongelado: initialPrice,
    precioOriginalCongeladoFormatted: initialFormatted,
    congeladoAt: new Date().toISOString(),
    gameId,
  };
}

export function usePriceFreeze({
  canManageContent,
  isImportingRef,
  voters,
  gamesMap,
  results,
  freezeState,
  setFreezeState,
  setSyncState,
  lastPersistedDashboardSignatureRef,
}: UsePriceFreezeOptions) {
  const isUnfreezingRef = useRef(false);
  const [isFreezingLoading, setIsFreezingLoading] = useState(false);

  const autoUnfreezePrice = useCallback(async (reason: string) => {
    if (
      !canManageContent ||
      !freezeState.isPrecioCongelado ||
      isImportingRef.current ||
      isUnfreezingRef.current
    ) {
      return;
    }
    isUnfreezingRef.current = true;

    if (import.meta.env.DEV) {
      console.log(`[Dashboard] Descongelamiento automático: ${reason}`);
    }

    const previousFreezeState = freezeState;
    const resetFreezeState: FreezePriceState = {
      isPrecioCongelado: false,
      precioCongelado: null,
      descuentoCongelado: null,
      precioCongeladoFormatted: null,
      precioOriginalCongelado: null,
      precioOriginalCongeladoFormatted: null,
      congeladoAt: null,
      gameId: null,
    };

    setSyncState({ status: 'saving', message: `Descongelando precio (${reason})...` });

    try {
      const syncRes = await unfreezePriceState();

      if (syncRes.status === 'synced' || syncRes.status === 'local') {
        lastPersistedDashboardSignatureRef.current = serializeDashboardState(voters, gamesMap, resetFreezeState);
        setFreezeState(resetFreezeState);
        setSyncState({
          status: syncRes.status,
          message: `Precio descongelado (${reason})`,
        });
      } else {
        // Falló la persistencia: restaurar el estado anterior.
        setFreezeState(previousFreezeState);
        setSyncState(syncRes);
        if (import.meta.env.DEV) {
          console.warn(`[Dashboard] Falló la descongelación automática de precio (${reason}):`, syncRes.message);
        }
      }
    } catch (err) {
      console.error(`[Dashboard] Excepción al descongelar precio automáticamente (${reason}):`, err);
      setFreezeState(previousFreezeState);
      setSyncState({
        status: 'error',
        message: `Error al descongelar precio (${reason})`,
      });
    } finally {
      isUnfreezingRef.current = false;
    }
  }, [
    canManageContent,
    isImportingRef,
    freezeState,
    voters,
    gamesMap,
    lastPersistedDashboardSignatureRef,
    setFreezeState,
    setSyncState,
  ]);

  const freezePrice = useCallback(async (
    currentLivePrice: SteamPriceInfo | null
  ): Promise<FreezePriceState | null> => {
    const winningResult = results[0];
    if (!winningResult?.game) {
      setSyncState({
        status: 'error',
        message: 'No hay un juego ganador seleccionado para congelar el precio',
      });
      return null;
    }

    const priceToFreeze = currentLivePrice || winningResult.game.price || null;
    if (!isValidPriceInfo(priceToFreeze)) {
      setSyncState({
        status: 'error',
        message: 'No se puede congelar el precio: no hay información de precio disponible para este juego',
      });
      return null;
    }

    const newFreezeState = buildFrozenPriceState(winningResult.game.id, priceToFreeze);
    setSyncState({ status: 'saving', message: 'Congelando precio...' });
    const syncRes = await saveFreezePriceState(newFreezeState);
    setSyncState(syncRes);

    if (syncRes.status !== 'synced' && syncRes.status !== 'local') {
      return null;
    }
    return newFreezeState;
  }, [results, setSyncState]);

  const unfreezePrice = useCallback(async (): Promise<boolean> => {
    setSyncState({ status: 'saving', message: 'Descongelando precio...' });
    const syncRes = await unfreezePriceState();
    setSyncState(syncRes);
    return syncRes.status === 'synced' || syncRes.status === 'local';
  }, [setSyncState]);

  const handleToggleFreezePrice = useCallback(async (
    currentLivePrice: SteamPriceInfo | null
  ) => {
    if (!canManageContent || isImportingRef.current) return;

    setIsFreezingLoading(true);
    const previousFreezeState = freezeState;

    try {
      if (!previousFreezeState.isPrecioCongelado) {
        const frozenState = await freezePrice(currentLivePrice);
        if (frozenState) {
          lastPersistedDashboardSignatureRef.current = serializeDashboardState(voters, gamesMap, frozenState);
          setFreezeState(frozenState);
        } else {
          setFreezeState(previousFreezeState);
        }
      } else {
        const success = await unfreezePrice();
        if (success) {
          lastPersistedDashboardSignatureRef.current = serializeDashboardState(voters, gamesMap, DEFAULT_FREEZE_STATE);
          setFreezeState(DEFAULT_FREEZE_STATE);
        } else {
          setFreezeState(previousFreezeState);
        }
      }
    } catch (err) {
      console.error('[Dashboard] Error al alternar congelamiento de precio:', err);
      setFreezeState(previousFreezeState);
      setSyncState({ status: 'error', message: 'Error al cambiar estado de precio congelado' });
    } finally {
      setIsFreezingLoading(false);
    }
  }, [
    canManageContent,
    isImportingRef,
    freezeState,
    freezePrice,
    lastPersistedDashboardSignatureRef,
    voters,
    gamesMap,
    unfreezePrice,
    setFreezeState,
    setSyncState,
  ]);

  return {
    autoUnfreezePrice,
    handleToggleFreezePrice,
    isFreezingLoading,
  };
}

