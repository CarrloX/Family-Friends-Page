import React, { useState } from 'react';
import type { Voter, GameResult, Game, VotingHistoryRecord, VoterSnapshotInHistory } from '../types/voting';
import { calculateAuraStatus } from '../types/voting';

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

export const FinishVotingModal: React.FC<FinishVotingModalProps> = ({
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

  const handleTogglePayment = (voterId: string, paid: boolean) => {
    setQuotaPayments((prev) => ({
      ...prev,
      [voterId]: paid,
    }));
  };

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
      votersSnapshots: snapshots,
      resultsSnapshot: allResults,
    };

    onConfirmFinish(updatedVoters, historyRecord);
  };

  return (
    <div className="modal-backdrop">
      <div className="finish-modal-container">
        <div className="modal-header">
          <div className="modal-title-group">
            <h2>🏆 FINALIZAR VOTACIÓN Y ASIGNAR CUOTAS</h2>
            <p>Registra quiénes pagaron la cuota del juego ganador para actualizar el sistema de Aura.</p>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose}>
            ✕
          </button>
        </div>

        {/* WINNING GAME PREVIEW */}
        <div className="modal-winner-card">
          <img
            src={winningResult.game?.coverImage}
            alt={winningResult.game?.title}
            className="winner-modal-thumb"
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
            <span className="winner-points">{winningResult.weightedPoints} Puntos Ponderados</span>
          </div>
        </div>

        {/* VOTERS PAYMENT TOGGLE LIST */}
        <div className="voters-payment-section">
          <h3>👥 ¿CADA INTEGRANTE PAGÓ SU CUOTA DEL JUEGO GANADOR?</h3>

          <div className="voters-payment-grid">
            {voters.map((voter) => {
              const paid = quotaPayments[voter.id] ?? true;
              const currentBal = voter.auraQuotaBalance ?? 0;
              const preview = calculateAuraStatus(currentBal, paid, voter.auraRank);
              const isRedemption = (voter.auraRank === 'Congelado' || currentBal <= -5) && paid;

              return (
                <div key={voter.id} className={`voter-payment-row ${paid ? 'paid-yes' : 'paid-no'}`}>
                  <div className="voter-pay-user">
                    <img src={voter.avatar} alt={voter.name} className="pay-user-avatar" />
                    <div className="pay-user-meta">
                      <span className="pay-user-name">{voter.name}</span>
                      <span className="pay-current-rank">
                        Rango Actual: {voter.auraRank} ({currentBal >= 0 ? `+${currentBal}` : currentBal} Cuotas)
                      </span>
                    </div>
                  </div>

                  {/* SÍ / NO TOGGLE BUTTONS */}
                  <div className="toggle-btn-group">
                    <button
                      type="button"
                      className={`toggle-choice-btn btn-yes ${paid ? 'active' : ''}`}
                      onClick={() => handleTogglePayment(voter.id, true)}
                    >
                      ✓ SÍ (+1)
                    </button>
                    <button
                      type="button"
                      className={`toggle-choice-btn btn-no ${!paid ? 'active' : ''}`}
                      onClick={() => handleTogglePayment(voter.id, false)}
                    >
                      ✕ NO (-1)
                    </button>
                  </div>

                  {/* PREVIEW OF NEW AURA STATUS */}
                  <div className="new-aura-preview">
                    <span className="preview-label">Nuevo Saldo:</span>
                    <span className="preview-balance">
                      {preview.newBalance >= 0 ? `+${preview.newBalance}` : preview.newBalance} Cuotas
                    </span>
                    <span className="preview-rank-tag">{preview.newRank} ({preview.newMultiplier}x)</span>
                    {isRedemption && (
                      <span className="redemption-badge">🌟 REDENCIÓN DIRECTA</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* MODAL ACTIONS */}
        <div className="modal-footer-actions">
          <button type="button" className="btn-modal-cancel" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="btn-modal-confirm" onClick={handleConfirm}>
            ✓ Confirmar y Guardar Votación
          </button>
        </div>
      </div>
    </div>
  );
};
