import React, { useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import type { Voter, GameResult, Game, VotingHistoryRecord, VoterSnapshotInHistory } from '../types/voting';
import { calculateAuraStatus } from '../types/voting';
import { VoterPaymentRow } from './VoterPaymentRow';

interface FinishVotingModalProps {
  allResults: GameResult[];
  gamesMap: Record<string, Game>;
  voters: Voter[];
  onConfirmFinish: (
    updatedVoters: Voter[],
    historyRecord: VotingHistoryRecord
  ) => void;
  onClose: () => void;
}

export const FinishVotingModal: React.FC<FinishVotingModalProps> = React.memo(({
  allResults,
  gamesMap,
  voters,
  onConfirmFinish,
  onClose,
}) => {
  const winningResult = allResults[0];
  // Map of voterId -> boolean (true = SÍ pagó cuota, false = NO pagó cuota)
  const [quotaPayments, setQuotaPayments] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    voters.forEach((v) => {
      initial[v.id] = true; // default SÍ para todos
    });
    return initial;
  });

  const handleTogglePayment = useCallback((voterId: string, paid: boolean) => {
    setQuotaPayments((prev) => ({
      ...prev,
      [voterId]: paid,
    }));
  }, []);

  const handleConfirm = () => {
    const snapshots: VoterSnapshotInHistory[] = [];

    const updatedVoters = voters.map((voter) => {
      const paid = quotaPayments[voter.id] ?? true;
      const currentBalance = voter.auraQuotaBalance ?? 0;
      const status = calculateAuraStatus(currentBalance, paid, voter.auraRank);

      snapshots.push({
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
        votes: [...voter.votes],
      });

      return {
        ...voter,
        auraQuotaBalance: status.newBalance,
        auraRank: status.newRank,
        multiplier: status.newMultiplier,
      };
    });

    const now = new Date();
    const historyRecord: VotingHistoryRecord = {
      id: `voting_${Date.now()}`,
      date: now.toLocaleString('es-CO', {
        dateStyle: 'medium',
        timeStyle: 'short',
      }),
      winningGame: winningResult.game,
      gamesMap: { ...gamesMap },
      games: Object.values(gamesMap),
      votersSnapshots: snapshots,
      resultsSnapshot: allResults,
    };

    onConfirmFinish(updatedVoters, historyRecord);
  };

  return (
    <motion.div
      className="modal-backdrop bottom-sheet-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
      onClick={onClose}
    >
      <motion.div
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
            <h2>🏆 FINALIZAR VOTACIÓN Y ASIGNAR CUOTAS</h2>
            <p>Registra quiénes pagaron la cuota del juego ganador para actualizar el sistema de Aura.</p>
          </div>
          <motion.button
            type="button"
            className="modal-close-btn"
            onClick={onClose}
            whileHover={{ scale: 1.15 }}
            whileTap={{ scale: 0.9 }}
          >
            ✕
          </motion.button>
        </div>

        {/* WINNING GAME PREVIEW */}
        <div className="modal-winner-card">
          <img
            src={winningResult.game?.coverImage}
            alt={winningResult.game?.title}
            className="winner-modal-thumb"
            loading="lazy"
            onError={(e) => {
              const target = e.currentTarget;
              if (!target.dataset.failed) {
                target.dataset.failed = 'true';
                if (winningResult.game?.tinyCoverImage) {
                  target.src = winningResult.game.tinyCoverImage;
                } else if (winningResult.game?.appId) {
                  target.src = `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${winningResult.game.appId}/capsule_sm_120.jpg`;
                }
              }
            }}
          />
          <div className="winner-modal-info">
            <span className="winner-tag">1º LUGAR GANADOR</span>
            <h4>{winningResult.game?.title}</h4>
            <div className="winner-modal-meta-row">
              <span className="winner-points">{winningResult.weightedPoints} Puntos Ponderados</span>
              {winningResult.game?.price?.finalFormatted && (
                <span className="winner-modal-price">
                  🏷️ {winningResult.game.price.finalFormatted}
                  {winningResult.game.price.discountPercent ? ` (-${winningResult.game.price.discountPercent}%)` : ''}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* VOTERS PAYMENT TOGGLE LIST */}
        <div className="voters-payment-section">
          <h3>👥 ¿CADA INTEGRANTE PAGÓ SU CUOTA DEL JUEGO GANADOR?</h3>

          <div className="voters-payment-grid">
            {voters.map((voter) => {
              const paid = quotaPayments[voter.id] ?? true;
              return (
                <VoterPaymentRow
                  key={voter.id}
                  voter={voter}
                  paid={paid}
                  onTogglePayment={handleTogglePayment}
                />
              );
            })}
          </div>
        </div>

        {/* MODAL ACTIONS */}
        <div className="modal-footer-actions">
          <motion.button
            type="button"
            className="btn-modal-cancel"
            onClick={onClose}
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
          >
            Cancelar
          </motion.button>
          <motion.button
            type="button"
            className="btn-modal-confirm"
            onClick={handleConfirm}
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
          >
            ✓ Confirmar y Guardar Votación
          </motion.button>
        </div>
      </motion.div>
    </motion.div>
  );
});
