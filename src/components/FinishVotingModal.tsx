import React, { useState, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import type {
  Voter,
  Game,
  GameResult,
  SteamPriceInfo,
  VotingHistoryRecord,
  VoterSnapshotInHistory,
} from '../types/voting';
import {
  calculateAuraStatus,
  cloneGameSnapshot,
  createResultsSnapshot,
  cloneGameVotes,
} from '../types/voting';
import { VoterPaymentRow } from './VoterPaymentRow';
import { GameThumbnail } from './GameThumbnail';
import { formatHistoryDate } from '../utils/formatDate';
import { formatCopPrice } from '../services/steamStoreApi';
import { useModalFocusTrap } from '../hooks/useModalFocusTrap';

// ============================================================
// Funciones puras auxiliares para reducir complejidad cognitiva
// ============================================================

function resolveEffectivePrice(
  isPrecioCongelado: boolean,
  precioCongelado: number | null | undefined,
  descuentoCongelado: number | null | undefined,
  precioCongeladoFormatted: string | null | undefined,
  fallbackPrice?: SteamPriceInfo
): SteamPriceInfo | undefined {
  if (!isPrecioCongelado) {
    return fallbackPrice;
  }
  const final = precioCongelado ?? 0;
  const discount = descuentoCongelado ?? 0;
  const isFree = final === 0;
  const formatted = precioCongeladoFormatted || (isFree ? 'Gratis' : formatCopPrice(final));
  return {
    isFree,
    currency: 'COP',
    final,
    discountPercent: discount,
    finalFormatted: formatted,
  };
}

function calculateIndividualQuota(
  effectivePrice: SteamPriceInfo | undefined,
  votersCount: number
): { amount: number; formatted: string } | null {
  if (!effectivePrice || effectivePrice.isFree || !effectivePrice.final || votersCount === 0) {
    return null;
  }
  const quota = Math.ceil(effectivePrice.final / votersCount);
  return {
    amount: quota,
    formatted: formatCopPrice(quota),
  };
}

function buildInitialQuotaPayments(voters: Voter[]): Record<string, boolean> {
  const initial: Record<string, boolean> = {};
  for (const v of voters) {
    initial[v.id] = true;
  }
  return initial;
}

function computePaymentStats(
  voters: Voter[],
  quotaPayments: Record<string, boolean>
): { paidCount: number; unpaidCount: number; total: number } {
  let paidCount = 0;
  for (const v of voters) {
    if (quotaPayments[v.id]) {
      paidCount++;
    }
  }
  return {
    paidCount,
    unpaidCount: voters.length - paidCount,
    total: voters.length,
  };
}

function buildVoterSnapshots(
  voters: Voter[],
  quotaPayments: Record<string, boolean>
): VoterSnapshotInHistory[] {
  return voters.map((voter) => {
    const paid = quotaPayments[voter.id] ?? true;
    const currentBalance = voter.auraQuotaBalance ?? 0;
    const status = calculateAuraStatus(currentBalance, paid, voter.auraRank);

    return {
      voterId: voter.id,
      name: voter.name,
      avatar: voter.avatar,
      paidQuota: paid,
      previousBalance: currentBalance,
      newBalance: status.newBalance,
      previousRank: voter.auraRank,
      newRank: status.newRank,
      previousMultiplier: voter.multiplier,
      newMultiplier: status.newMultiplier,
      votes: cloneGameVotes(voter.votes),
    };
  });
}

interface FreezeDataPayload {
  isPrecioCongelado: boolean;
  precioCongelado: number | null;
  descuentoCongelado: number | null;
  precioCongeladoFormatted: string | null;
}

function buildFinishedSessionData(
  winningGame: Game,
  allResults: GameResult[],
  voters: Voter[],
  snapshots: VoterSnapshotInHistory[],
  freezeData: FreezeDataPayload
): { historyRecord: VotingHistoryRecord; updatedVoters: Voter[] } {
  const now = new Date();
  const createdAt = now.toISOString();

  const historyRecord: VotingHistoryRecord = {
    id: crypto.randomUUID(),
    createdAt,
    date: formatHistoryDate(createdAt),
    winningGame,
    resultsSnapshot: createResultsSnapshot(allResults),
    votersSnapshots: snapshots,
    isPrecioCongelado: freezeData.isPrecioCongelado,
    precioCongelado: freezeData.isPrecioCongelado ? freezeData.precioCongelado : null,
    descuentoCongelado: freezeData.isPrecioCongelado ? freezeData.descuentoCongelado : null,
    precioCongeladoFormatted: freezeData.isPrecioCongelado ? freezeData.precioCongeladoFormatted : null,
  };

  const snapshotsByVoterId = new Map(snapshots.map((s) => [s.voterId, s]));

  const updatedVoters = voters.map((voter) => {
    const snapshot = snapshotsByVoterId.get(voter.id);
    return {
      ...voter,
      auraQuotaBalance: snapshot ? snapshot.newBalance : (voter.auraQuotaBalance ?? 0),
      auraRank: snapshot ? snapshot.newRank : voter.auraRank,
      multiplier: snapshot ? snapshot.newMultiplier : voter.multiplier,
      votes: cloneGameVotes(voter.votes),
    };
  });

  return { historyRecord, updatedVoters };
}

// ============================================================
// Subcomponentes de presentación para modularizar el modal
// ============================================================

interface WinningGamePreviewProps {
  winningGame: Game;
  weightedPoints: number;
  isPrecioCongelado: boolean;
  effectivePrice?: SteamPriceInfo;
  individualQuota: { amount: number; formatted: string } | null;
  votersCount: number;
}

const WinningGamePreview = ({
  winningGame,
  weightedPoints,
  isPrecioCongelado,
  effectivePrice,
  individualQuota,
  votersCount,
}: WinningGamePreviewProps) => (
  <div className="modal-winner-card">
    <GameThumbnail
      game={winningGame}
      alt=""
      className="winner-modal-thumb"
    />
    <div className="winner-modal-info">
      <span className="winner-tag">1º LUGAR GANADOR</span>
      <h4>{winningGame.title}</h4>
      <div className="winner-modal-meta-row">
        <span className="winner-points">{weightedPoints} Puntos Ponderados</span>
        {isPrecioCongelado && effectivePrice ? (
          <span className="winner-modal-price frozen" title="Valor congelado previamente en administración">
            <span aria-hidden="true">🔒 </span>{effectivePrice.finalFormatted}
            {effectivePrice.discountPercent && effectivePrice.discountPercent > 0
              ? ` (-${effectivePrice.discountPercent}%)`
              : ''}
            <span className="frozen-tag-pill">Precio Congelado</span>
          </span>
        ) : (
          effectivePrice?.finalFormatted && (
            <span className="winner-modal-price">
              <span aria-hidden="true">🏷️ </span>{effectivePrice.finalFormatted}
              {effectivePrice.discountPercent ? ` (-${effectivePrice.discountPercent}%)` : ''}
            </span>
          )
        )}
        {individualQuota && (
          <span className="winner-modal-quota-split">
            <span aria-hidden="true">💵 </span>Cuota: <strong>{individualQuota.formatted}</strong> / integrante ({votersCount} miembros)
          </span>
        )}
      </div>
    </div>
  </div>
);

interface PaymentControlsHeaderProps {
  paymentStats: { paidCount: number; unpaidCount: number; total: number };
  isSaving: boolean;
  onSetAllPayments: (paid: boolean) => void;
}

const PaymentControlsHeader = ({
  paymentStats,
  isSaving,
  onSetAllPayments,
}: PaymentControlsHeaderProps) => {
  const isAllPaid = paymentStats.unpaidCount === 0;
  const pluralSuffix = paymentStats.unpaidCount > 1 ? 's' : '';

  return (
    <div className="voters-payment-header-row">
      <div className="voters-payment-title-group">
        <h3><span aria-hidden="true">👥 </span>¿CADA INTEGRANTE PAGÓ SU CUOTA DEL JUEGO GANADOR?</h3>
        <p className="voters-payment-subtitle">
          Los pagos modifican el saldo de cuotas y el rango de Aura de cada integrante.
        </p>
      </div>

      <div className="voters-payment-controls-row">
        <div className="voters-payment-summary-chips">
          {isAllPaid ? (
            <span className="summary-chip chip-all-paid">
              <span aria-hidden="true">✨ </span>Todos al día ({paymentStats.total}/{paymentStats.total})
            </span>
          ) : (
            <>
              <span className="summary-chip chip-paid">
                ✓ {paymentStats.paidCount} pagaron (+1)
              </span>
              <span className="summary-chip chip-unpaid">
                ✕ {paymentStats.unpaidCount} pendiente{pluralSuffix} (-1)
              </span>
            </>
          )}
        </div>

        <div className="payment-bulk-actions">
          <button
            type="button"
            className="btn-bulk-payment"
            onClick={() => onSetAllPayments(true)}
            disabled={isSaving || paymentStats.paidCount === paymentStats.total}
            title="Marcar que todos los integrantes pagaron la cuota"
          >
            Todos Sí
          </button>
          <button
            type="button"
            className="btn-bulk-payment"
            onClick={() => onSetAllPayments(false)}
            disabled={isSaving || paymentStats.unpaidCount === paymentStats.total}
            title="Marcar que ningún integrante pagó la cuota"
          >
            Todos No
          </button>
        </div>
      </div>
    </div>
  );
};

const UnpaidWarning = ({ unpaidCount }: { unpaidCount: number }) => {
  if (unpaidCount === 0) return null;
  const pluralSuffix = unpaidCount > 1 ? 's' : '';
  const verbPlural = unpaidCount > 1 ? 'n' : '';

  return (
    <div role="status" aria-live="polite" className="payment-unpaid-warning">
      <span aria-hidden="true">⚠️ </span><strong>Atención operacional:</strong> {unpaidCount} integrante{pluralSuffix} se registrará{verbPlural} como impago{pluralSuffix} y recibirá{verbPlural} <strong>-1 cuota</strong> de penalización de Aura.
    </div>
  );
};

// ============================================================
// Componente Principal
// ============================================================

interface FinishVotingModalProps {
  /**
   * Resultados consolidados de todos los juegos evaluados en la votación.
   *
   * @contract PRECONDICIÓN DEL COMPONENTE:
   * La lista debe suministrarse previamente ordenada en orden DESCENDENTE por clasificación
   * competitiva (puntuación ponderada y criterios de desempate provistos por `calculateResults`).
   * Por contrato, el primer elemento (`allResults[0]`) es considerado inequívocamente el 1.er lugar / juego ganador.
   */
  allResults: GameResult[];
  voters: Voter[];
  isPrecioCongelado?: boolean;
  precioCongelado?: number | null;
  descuentoCongelado?: number | null;
  precioCongeladoFormatted?: string | null;
  onConfirmFinish: (
    updatedVoters: Voter[],
    historyRecord: VotingHistoryRecord
  ) => Promise<void>;
  onClose: () => void;
}

export const FinishVotingModal = React.memo(({
  allResults,
  voters,
  isPrecioCongelado = false,
  precioCongelado = null,
  descuentoCongelado = null,
  precioCongeladoFormatted = null,
  onConfirmFinish,
  onClose,
}: FinishVotingModalProps) => {
  // Precondición de contrato: allResults viene ordenado descendentemente desde calculateResults.
  // El elemento [0] es el 1.er lugar ganador.
  const winningResult = allResults[0];

  // Verificación defensiva en entorno de desarrollo para alertar si algún llamador viola el contrato
  if (import.meta.env.DEV && allResults.length > 1) {
    if (allResults[0].weightedPoints < allResults[1].weightedPoints) {
      console.warn(
        '[FinishVotingModal] Infracción de contrato: allResults no está ordenado descendentemente. allResults[0] tiene menor puntuación que allResults[1].'
      );
    }
  }
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [hasConfirmedReview, setHasConfirmedReview] = useState(false);

  const modalRef = useModalFocusTrap<HTMLDivElement>({
    onEscape: onClose,
    disabled: isSaving,
    initialFocusDelay: 120,
  });

  const [quotaPayments, setQuotaPayments] = useState<Record<string, boolean>>(() =>
    buildInitialQuotaPayments(voters)
  );

  const handleTogglePayment = useCallback((voterId: string, paid: boolean) => {
    if (isSaving) return;
    setSaveError(null);
    setQuotaPayments((prev) => ({
      ...prev,
      [voterId]: paid,
    }));
  }, [isSaving]);

  const handleSetAllPayments = useCallback((paid: boolean) => {
    if (isSaving) return;
    setSaveError(null);
    setQuotaPayments(() => {
      const next: Record<string, boolean> = {};
      for (const v of voters) {
        next[v.id] = paid;
      }
      return next;
    });
  }, [isSaving, voters]);

  const paymentStats = useMemo(
    () => computePaymentStats(voters, quotaPayments),
    [voters, quotaPayments]
  );

  const fallbackPrice = winningResult?.game?.price;
  const effectivePrice = resolveEffectivePrice(
    isPrecioCongelado,
    precioCongelado,
    descuentoCongelado,
    precioCongeladoFormatted,
    fallbackPrice
  );

  const individualQuota = calculateIndividualQuota(effectivePrice, voters.length);

  const winningGame = cloneGameSnapshot(winningResult.game);
  if (effectivePrice) {
    winningGame.price = { ...effectivePrice };
  }

  const handleConfirm = async () => {
    if (isSaving || !hasConfirmedReview || !winningResult?.game) return;

    setIsSaving(true);
    setSaveError(null);
    try {
      const snapshots = buildVoterSnapshots(voters, quotaPayments);
      const { historyRecord, updatedVoters } = buildFinishedSessionData(
        winningGame,
        allResults,
        voters,
        snapshots,
        { isPrecioCongelado, precioCongelado, descuentoCongelado, precioCongeladoFormatted }
      );

      await onConfirmFinish(updatedVoters, historyRecord);
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error('[FinishVotingModal] Error al confirmar finalización de votación:', error);
      }
      const message =
        error instanceof Error && error.message
          ? error.message
          : 'No se pudo guardar la votación. No se aplicaron los cambios en los datos.';
      setSaveError(message);
    } finally {
      setIsSaving(false);
    }
  };

  if (!winningResult?.game) {
    return null;
  }

  let confirmButtonLabel = `✓ Confirmar y registrar pagos de Aura (${paymentStats.paidCount} de ${paymentStats.total})`;
  if (isSaving) {
    confirmButtonLabel = 'Guardando votación y pagos…';
  } else if (saveError) {
    confirmButtonLabel = `🔄 Reintentar confirmación de pagos (${paymentStats.paidCount} de ${paymentStats.total})`;
  }

  return (
    <motion.div
      className="modal-backdrop bottom-sheet-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
      onClick={() => {
        if (!isSaving) {
          onClose();
        }
      }}
    >
      <motion.div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="finish-voting-title"
        aria-describedby="finish-voting-description"
        className="finish-modal-container bottom-sheet-panel"
        initial={{ y: '100%', opacity: 0, scale: 0.95 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        exit={{ y: '100%', opacity: 0, scale: 0.95 }}
        transition={{ type: 'spring', stiffness: 320, damping: 30 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bottom-sheet-handle" aria-hidden="true"></div>
        <div className="modal-header">
          <div className="modal-title-group">
            <h2 id="finish-voting-title"><span aria-hidden="true">🏆 </span>FINALIZAR VOTACIÓN Y ASIGNAR CUOTAS</h2>
            <p id="finish-voting-description">
              Registra quiénes pagaron la cuota del juego ganador para actualizar el sistema de Aura.
            </p>
          </div>
          <motion.button
            type="button"
            className="modal-close-btn"
            onClick={() => {
              if (!isSaving) {
                onClose();
              }
            }}
            disabled={isSaving}
            aria-label="Cerrar modal de finalización"
            whileHover={isSaving ? {} : { scale: 1.15 }}
            whileTap={isSaving ? {} : { scale: 0.9 }}
          >
            ✕
          </motion.button>
        </div>

        <WinningGamePreview
          winningGame={winningGame}
          weightedPoints={winningResult.weightedPoints}
          isPrecioCongelado={isPrecioCongelado}
          effectivePrice={effectivePrice}
          individualQuota={individualQuota}
          votersCount={voters.length}
        />

        <fieldset className="voters-payment-section">
          <legend className="sr-only">
            ¿Cada integrante pagó su cuota del juego ganador para el cálculo de Aura?
          </legend>

          <PaymentControlsHeader
            paymentStats={paymentStats}
            isSaving={isSaving}
            onSetAllPayments={handleSetAllPayments}
          />

          <UnpaidWarning unpaidCount={paymentStats.unpaidCount} />

          <div className="voters-payment-grid">
            {voters.map((voter) => {
              const paid = quotaPayments[voter.id] ?? true;
              return (
                <VoterPaymentRow
                  key={voter.id}
                  voter={voter}
                  paid={paid}
                  onTogglePayment={handleTogglePayment}
                  disabled={isSaving}
                />
              );
            })}
          </div>
        </fieldset>

        <div className="modal-footer-wrapper">
          <label className="payment-confirmation-checkbox-label">
            <input
              type="checkbox"
              id="confirm-aura-payments-checkbox"
              checked={hasConfirmedReview}
              onChange={(e) => setHasConfirmedReview(e.target.checked)}
              disabled={isSaving}
            />
            <span className="checkbox-text">
              He verificado el estado de pago de todos los integrantes y confirmo aplicar los cambios de Aura ({paymentStats.paidCount} pagados, {paymentStats.unpaidCount} pendientes).
            </span>
          </label>

          {saveError && (
            <output className="finish-modal-error-banner" aria-live="assertive">
              <span className="finish-modal-error-icon" aria-hidden="true">⚠️</span>
              <div className="finish-modal-error-content">
                <strong className="finish-modal-error-title">No se pudo finalizar la votación</strong>
                <p className="finish-modal-error-text">{saveError}</p>
                <span className="finish-modal-error-hint">
                  Los saldos de Aura y el historial no fueron modificados. Revisa tu conexión o permisos y vuelve a intentar.
                </span>
              </div>
            </output>
          )}

          <div className="modal-footer-actions">
            <motion.button
              type="button"
              className="btn-modal-cancel"
              onClick={() => {
                if (!isSaving) {
                  onClose();
                }
              }}
              disabled={isSaving}
              whileHover={isSaving ? {} : { scale: 1.03 }}
              whileTap={isSaving ? {} : { scale: 0.97 }}
            >
              Cancelar
            </motion.button>
            <motion.button
              type="button"
              className="btn-modal-confirm"
              onClick={handleConfirm}
              disabled={isSaving || !hasConfirmedReview}
              aria-busy={isSaving}
              title={
                !hasConfirmedReview
                  ? 'Debes marcar la casilla de verificación antes de registrar los pagos'
                  : undefined
              }
              whileHover={isSaving || !hasConfirmedReview ? {} : { scale: 1.03 }}
              whileTap={isSaving || !hasConfirmedReview ? {} : { scale: 0.97 }}
            >
              {confirmButtonLabel}
            </motion.button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
});

FinishVotingModal.displayName = 'FinishVotingModal';
