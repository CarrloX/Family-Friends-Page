import React from 'react';
import type { VoterSnapshotInHistory } from '../types/voting';

interface VoterSnapshotRowProps {
  snap: VoterSnapshotInHistory;
}

export const VoterSnapshotRow: React.FC<VoterSnapshotRowProps> = React.memo(({
  snap,
}) => {
  return (
    <tr key={snap.voterId} className={snap.paidQuota ? 'row-yes' : 'row-no'}>
      <td>
        <div className="voter-cell">
          <img src={snap.avatar} alt={snap.name} className="table-avatar" loading="eager" />
          <span className="table-name">{snap.name}</span>
        </div>
      </td>
      <td>
        {snap.paidQuota ? (
          <span className="status-badge-paid yes">🟢 SÍ (Aportó)</span>
        ) : (
          <span className="status-badge-paid no">🔴 NO (Rechazó)</span>
        )}
      </td>
      <td>
        <span className="balance-change font-mono">
          {snap.previousBalance >= 0 ? `+${snap.previousBalance}` : snap.previousBalance} ➜{' '}
          <strong>{snap.newBalance >= 0 ? `+${snap.newBalance}` : snap.newBalance} Cuotas</strong>
        </span>
      </td>
      <td>
        <span className="table-rank-tag">
          {snap.newRank} ({snap.newMultiplier}x)
        </span>
      </td>
    </tr>
  );
});