import React, { useState, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import type { Voter, GameResult, VotingHistoryRecord, VoterSnapshotInHistory } from '../types/voting';
import { calculateAuraStatus, cloneGameSnapshot, createResultsSnapshot, cloneGameVotes } from '../types/voting';
import { VoterPaymentRow } from './VoterPaymentRow';
import { GameThumbnail } from './GameThumbnail';
import { formatHistoryDate } from '../utils/formatDate';
import { useModalFocusTrap } from '../hooks/useModalFocusTrap';

interface FinishVotingModalProps {
  allResults: GameResult[];
  voters: Voter[];
  onConfirmFinish: (
    updatedVoters: Voter[],
    historyRecord: VotingHistoryRecord
  ) => Promise<void>;
  onClose: () => void;
}

export const FinishVotingModal: React.FC<FinishVotingModalProps> = React.memo(({
  allResults,
  voters,
  onConfirmFinish,
  onClose,
}) => {
  const winningResult = allResults[0];
  const [isSaving, setIsSaving] = useState(false);
  const [hasConfirmedReview, setHasConfirmedReview] = useState(false);

  // Focus trap y accesibilidad por teclado (Tab, Shift+Tab y Escape)
  const modalRef = useModalFocusTrap<HTMLDivElement>({
    onEscape: onClose,
    disabled: isSaving,
    initialFocusDelay: 120,
  });

  // Map of voterId -> boolean (true = SÍ pagó cuota, false = NO pagó cuota)
  const [quotaPayments, setQuotaPayments] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    voters.forEach((v) => {
      initial[v.id] = true; // default SÍ para todos
    });
    return initial;
  });

  const handleTogglePayment = useCallback((voterId: string, paid: boolean) => {
    if (isSaving) return;
    setQuotaPayments((prev) => ({
      ...prev,
      [voterId]: paid,
    }));
  }, [isSaving]);

  const handleSetAllPayments = useCallback((paid: boolean) => {
    if (isSaving) return;
    setQuotaPayments(() => {
      const next: Record<string, boolean> = {};
      voters.forEach((v) => {
        next[v.id] = paid;
      });
      return next;
    });
  }, [isSaving, voters]);

  const paymentStats = useMemo(() => {
    let paidCount = 0;
    voters.forEach((v) => {
      if (quotaPayments[v.id]) {
        paidCount++;
      }
    });
    const unpaidCount = voters.length - paidCount;
    return { paidCount, unpaidCount, total: voters.length };
  }, [voters, quotaPayments]);

  const handleConfirm = async () => {
    if (isSaving || !hasConfirmedReview || !winningResult?.game) return;

    setIsSaving(true);
    try {
      // 1. Materializar snapshots inmutables de los votantes y sus votos
      const snapshots: VoterSnapshotInHistory[] = voters.map((voter) => {
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

      // 2. Materializar snapshot inmutable de los resultados competitivos
      const resultsSnapshot = createResultsSnapshot(allResults);

      // 3. Materializar snapshot del juego ganador desacoplado
      const winningGame = cloneGameSnapshot(winningResult.game);

      const now = new Date();
      const createdAt = now.toISOString();
      const historyRecord: VotingHistoryRecord = {
        id: crypto.randomUUID(),
        createdAt,
        date: formatHistoryDate(createdAt),
        winningGame,
        resultsSnapshot,
        votersSnapshots: snapshots,
      };

      // 4. Actualizar votantes para el estado activo de la aplicación
      const updatedVoters = voters.map((voter, index) => ({
        ...voter,
        auraQuotaBalance: snapshots[index].newBalance,
        auraRank: snapshots[index].newRank,
        multiplier: snapshots[index].newMultiplier,
        votes: cloneGameVotes(voter.votes),
      }));

      await onConfirmFinish(updatedVoters, historyRecord);
    } catch (error) {
      console.error('[FinishVotingModal] Error al confirmar finalización de votación:', error);
    } finally {
      setIsSaving(false);
    }
  };

  // Precondición explícita: si allResults está vacío o no hay juego ganador válido, el modal no se renderiza
  if (!winningResult?.game) {
    return null;
  }

  const winningGame = winningResult.game;

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
        {/* Handle visual superior estilo bottom sheet */}
        <div className="bottom-sheet-handle" aria-hidden="true"></div>
        <div className="modal-header">
          <div className="modal-title-group">
            <h2 id="finish-voting-title">🏆 FINALIZAR VOTACIÓN Y ASIGNAR CUOTAS</h2>
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

        {/* WINNING GAME PREVIEW */}
        <div className="modal-winner-card">
          <GameThumbnail
            game={winningGame}
            alt={winningGame.title}
            className="winner-modal-thumb"
          />
          <div className="winner-modal-info">
            <span className="winner-tag">1º LUGAR GANADOR</span>
            <h4>{winningGame.title}</h4>
            <div className="winner-modal-meta-row">
              <span className="winner-points">{winningResult.weightedPoints} Puntos Ponderados</span>
              {winningGame.price?.finalFormatted && (
                <span className="winner-modal-price">
                  🏷️ {winningGame.price.finalFormatted}
                  {winningGame.price.discountPercent ? ` (-${winningGame.price.discountPercent}%)` : ''}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* VOTERS PAYMENT TOGGLE LIST */}
        <fieldset className="voters-payment-section" aria-labelledby="voters-payment-heading">
          <legend className="sr-only">
            ¿Cada integrante pagó su cuota del juego ganador para el cálculo de Aura?
          </legend>

          <div className="voters-payment-header-row">
            <div className="voters-payment-title-group">
              <h3 id="voters-payment-heading">👥 ¿CADA INTEGRANTE PAGÓ SU CUOTA DEL JUEGO GANADOR?</h3>
              <p className="voters-payment-subtitle">
                Los pagos modifican el saldo de cuotas y el rango de Aura de cada integrante.
              </p>
            </div>

            <div className="voters-payment-controls-row">
              <div className="voters-payment-summary-chips">
                {paymentStats.unpaidCount === 0 ? (
                  <span className="summary-chip chip-all-paid">
                    ✨ Todos al día ({paymentStats.total}/{paymentStats.total})
                  </span>
                ) : (
                  <>
                    <span className="summary-chip chip-paid">
                      ✓ {paymentStats.paidCount} pagaron (+1)
                    </span>
                    <span className="summary-chip chip-unpaid">
                      ✕ {paymentStats.unpaidCount} pendiente{paymentStats.unpaidCount > 1 ? 's' : ''} (-1)
                    </span>
                  </>
                )}
              </div>

              <div className="payment-bulk-actions">
                <button
                  type="button"
                  className="btn-bulk-payment"
                  onClick={() => handleSetAllPayments(true)}
                  disabled={isSaving || paymentStats.paidCount === paymentStats.total}
                  title="Marcar que todos los integrantes pagaron la cuota"
                >
                  Todos Sí
                </button>
                <button
                  type="button"
                  className="btn-bulk-payment"
                  onClick={() => handleSetAllPayments(false)}
                  disabled={isSaving || paymentStats.unpaidCount === paymentStats.total}
                  title="Marcar que ningún integrante pagó la cuota"
                >
                  Todos No
                </button>
              </div>
            </div>
          </div>

          {paymentStats.unpaidCount > 0 && (
            <div className="payment-unpaid-warning" role="status">
              ⚠️ <strong>Atención operacional:</strong> {paymentStats.unpaidCount} integrante{paymentStats.unpaidCount > 1 ? 's' : ''} se registrará{paymentStats.unpaidCount > 1 ? 'n' : ''} como impago{paymentStats.unpaidCount > 1 ? 's' : ''} y recibirá{paymentStats.unpaidCount > 1 ? 'n' : ''} <strong>-1 cuota</strong> de penalización de Aura.
            </div>
          )}

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

        {/* OPERATIONAL VERIFICATION CHECKBOX & MODAL ACTIONS */}
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
              {isSaving
                ? 'Guardando votación y pagos…'
                : `✓ Confirmar y registrar pagos de Aura (${paymentStats.paidCount} de ${paymentStats.total})`}
            </motion.button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
});
