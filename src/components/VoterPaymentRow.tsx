import React from 'react';
import { motion } from 'framer-motion';
import type { Voter } from '../types/voting';
import { calculateAuraStatus } from '../types/voting';

interface VoterPaymentRowProps {
  voter: Voter;
  paid: boolean;
  onTogglePayment: (voterId: string, paid: boolean) => void;
}

export const VoterPaymentRow: React.FC<VoterPaymentRowProps> = React.memo(({
  voter,
  paid,
  onTogglePayment,
}) => {
  const currentBal = voter.auraQuotaBalance ?? 0;
  const preview = calculateAuraStatus(currentBal, paid, voter.auraRank);
  const isRedemption = (voter.auraRank === 'Congelado' || currentBal <= -5) && paid;

  return (
    <motion.div
      key={voter.id}
      className={`voter-payment-row ${paid ? 'paid-yes' : 'paid-no'}`}
      whileHover={{ scale: 1.01 }}
      transition={{ duration: 0.2 }}
    >
      <div className="voter-pay-user">
        <img src={voter.avatar} alt={voter.name} className="pay-user-avatar" loading="eager" />
        <div className="pay-user-meta">
          <span className="pay-user-name">{voter.name}</span>
          <span className="pay-current-rank">
            Rango Actual: {voter.auraRank} ({currentBal >= 0 ? `+${currentBal}` : currentBal} Cuotas)
          </span>
        </div>
      </div>

      {/* SÍ / NO TOGGLE BUTTONS */}
      <div className="toggle-btn-group">
        <motion.button
          type="button"
          className={`toggle-choice-btn btn-yes ${paid ? 'active' : ''}`}
          onClick={() => onTogglePayment(voter.id, true)}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
        >
          ✓ SÍ (+1)
        </motion.button>
        <motion.button
          type="button"
          className={`toggle-choice-btn btn-no ${!paid ? 'active' : ''}`}
          onClick={() => onTogglePayment(voter.id, false)}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
        >
          ✕ NO (-1)
        </motion.button>
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
    </motion.div>
  );
});