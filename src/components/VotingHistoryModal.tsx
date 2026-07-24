import React, { useState } from 'react';
import type { VotingHistoryRecord } from '../types/voting';
import { DeleteHistoryRecordConfirmModal } from './DeleteHistoryRecordConfirmModal';

interface VotingHistoryModalProps {
  history: VotingHistoryRecord[];
  onClearHistory: () => void;
  onDeleteRecord: (recordId: string) => void;
  onClose: () => void;
}

export const VotingHistoryModal: React.FC<VotingHistoryModalProps> = ({
  history,
  onClearHistory,
  onDeleteRecord,
  onClose,
}) => {
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(
    history.length > 0 ? history[0].id : null
  );

  const selectedRecord = history.find((h) => h.id === selectedRecordId) || history[0];
  const [recordToDelete, setRecordToDelete] = useState<VotingHistoryRecord | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  return (
    <div className="modal-backdrop">
      <div className="history-modal-container">
        <div className="modal-header">
          <div className="modal-title-group">
            <h2>📜 HISTORIAL DE VOTACIONES PASADAS</h2>
            <p>Consulta las votaciones finalizadas, el registro de cuotas pagadas y la evolución del Aura.</p>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose}>
            ✕
          </button>
        </div>

        {history.length === 0 ? (
          <div className="empty-history-box">
            <span className="empty-icon">📂</span>
            <h3>No hay votaciones registradas aún</h3>
            <p>Cuando hagas clic en <strong>&quot;Finalizar Votación 🏆&quot;</strong>, los resultados y el historial de cuotas se guardarán aquí automáticamente.</p>
          </div>
        ) : (
          <div className="history-content-layout">
            {/* LEFT SIDEBAR: LIST OF PAST VOTINGS */}
            <div className="history-sidebar">
              <span className="sidebar-heading">REGISTROS GUARDADOS ({history.length})</span>
              <div className="history-items-list">
                {history.map((rec) => {
                  const isSelected = rec.id === selectedRecordId;
                  return (
                    <div key={rec.id} className="history-list-item-wrapper">
                      <button
                        type="button"
                        className={`history-list-item ${isSelected ? 'selected' : ''}`}
                        onClick={() => setSelectedRecordId(rec.id)}
                      >
                        <img
                          src={rec.winningGame?.coverImage}
                          alt={rec.winningGame?.title}
                          className="history-item-thumb"
                          onError={(e) => {
                            const target = e.currentTarget;
                            if (!target.dataset.failed) {
                              target.dataset.failed = 'true';
                              if (rec.winningGame?.tinyCoverImage) {
                                target.src = rec.winningGame.tinyCoverImage;
                              } else if (rec.winningGame?.appId) {
                                target.src = `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${rec.winningGame.appId}/capsule_sm_120.jpg`;
                              }
                            }
                          }}
                        />
                        <div className="history-item-info">
                          <span className="history-item-winner">🏆 {rec.winningGame?.title}</span>
                          <span className="history-item-date">{rec.date}</span>
                        </div>
                      </button>
                      <button
                        type="button"
                        className="history-delete-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          setRecordToDelete(rec);
                        }}
                        title="Eliminar este registro"
                      >
                        🗑️
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* RIGHT DETAILS PANEL: DETAILED BREAKDOWN OF SELECTED RECORD */}
            {selectedRecord && (
              <div className="history-details-panel">
                <div className="history-record-header">
                  <div className="winner-details-badge">
                    <span className="trophy-tag">🏆 JUEGO GANADOR</span>
                    <h3>{selectedRecord.winningGame?.title}</h3>
                    <span className="record-date-tag">🗓️ {selectedRecord.date}</span>
                  </div>
                  <img
                    src={selectedRecord.winningGame?.coverImage}
                    alt={selectedRecord.winningGame?.title}
                    className="history-details-banner"
                    onError={(e) => {
                      const target = e.currentTarget;
                      if (!target.dataset.failed) {
                        target.dataset.failed = 'true';
                        if (selectedRecord.winningGame?.tinyCoverImage) {
                          target.src = selectedRecord.winningGame.tinyCoverImage;
                        } else if (selectedRecord.winningGame?.appId) {
                          target.src = `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${selectedRecord.winningGame.appId}/capsule_sm_120.jpg`;
                        }
                      }
                    }}
                  />
                </div>

                {/* PODIUM RESULTS */}
                <div className="history-competitors-section">
                  <h5>🏆 TABLA DE POSICIONES FINAL:</h5>
                  <div className="competitors-grid">
                    {(selectedRecord.resultsSnapshot || Object.values(selectedRecord.gamesMap || {})).map((item, idx) => {
                      // Support both GameResult[] and Game[] shapes
                      const game = 'game' in item ? item.game : item;
                      const pts = 'weightedPoints' in item ? item.weightedPoints : null;
                      let medal: string;
                      if (idx === 0) medal = '🥇';
                      else if (idx === 1) medal = '🥈';
                      else if (idx === 2) medal = '🥉';
                      else medal = `${idx + 1}º`;
                      return (
                        <div key={game.id} className={`competitor-card ${idx === 0 ? 'winner-competitor' : ''}`}>
                          <img
                            src={game.coverImage}
                            alt={game.title}
                            className="competitor-thumb"
                            onError={(e) => {
                              const target = e.currentTarget;
                              if (!target.dataset.failed) {
                                target.dataset.failed = 'true';
                                if (game?.tinyCoverImage) {
                                  target.src = game.tinyCoverImage;
                                } else if (game?.appId) {
                                  target.src = `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${game.appId}/capsule_sm_120.jpg`;
                                }
                              }
                            }}
                          />
                          <div className="competitor-info">
                            <span className="competitor-medal">{medal}</span>
                            <span className="competitor-title">{game.title}</span>
                            {pts !== null && <span className="competitor-pts">{pts} pts</span>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* VOTERS BREAKDOWN TABLE */}
                <div className="history-voters-table-container">
                  <h5>👥 DESGLOSE DE CUOTAS Y EVOLUCIÓN DE AURA:</h5>
                  <table className="history-voters-table">
                    <thead>
                      <tr>
                        <th>Integrante</th>
                        <th>¿Pagó Cuota?</th>
                        <th>Saldo de Cuotas</th>
                        <th>Nuevo Rango</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedRecord.votersSnapshots.map((snap) => (
                        <tr key={snap.voterId} className={snap.paidQuota ? 'row-yes' : 'row-no'}>
                          <td>
                            <div className="voter-cell">
                              <img src={snap.avatar} alt={snap.name} className="table-avatar" />
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
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* MODAL FOOTER */}
        <div className="modal-footer-actions">
          {history.length > 0 && (
            <button
              type="button"
              className="btn-clear-history"
              onClick={() => setShowClearConfirm(true)}
            >
              🗑️ Limpiar Historial
            </button>
          )}
          <button type="button" className="btn-modal-cancel" onClick={onClose}>
            Cerrar
          </button>
        </div>

        {/* CLEAR HISTORY CONFIRM MODAL */}
        {showClearConfirm && (
          <div className="modal-backdrop" onClick={() => setShowClearConfirm(false)}>
            <div
              className="delete-confirm-modal-container"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="modal-header">
                <div className="modal-title-group">
                  <h2>⚠️ Limpiar Historial Completo</h2>
                  <p>Esta acción no se puede deshacer fácilmente.</p>
                </div>
                <button
                  type="button"
                  className="modal-close-btn"
                  onClick={() => setShowClearConfirm(false)}
                  aria-label="Cerrar"
                >
                  ✕
                </button>
              </div>

              <div className="delete-warning-content">
                <div className="delete-warning-text">
                  <p>
                    ¿Estás seguro de que deseas eliminar <strong>todo el historial de votaciones pasadas</strong>?
                  </p>
                  <p className="delete-warning-sub">
                    Se perderán permanentemente todos los registros históricos.
                  </p>
                  <p className="delete-warning-note">
                    📊 <strong>Nota:</strong> Esta acción eliminará todas las votaciones guardadas, incluyendo registros de cuotas pagadas y evolución de Aura. Esta acción no se puede deshacer.
                  </p>
                </div>
              </div>

              <div className="modal-footer-actions delete-modal-actions">
                <button
                  type="button"
                  className="btn-modal-cancel"
                  onClick={() => setShowClearConfirm(false)}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  className="btn-modal-confirm-delete"
                  onClick={() => {
                    onClearHistory();
                    setShowClearConfirm(false);
                  }}
                >
                  Confirmar Eliminación
                </button>
              </div>
            </div>
          </div>
        )}

        {/* DELETE CONFIRM MODAL */}
        {recordToDelete && (
          <DeleteHistoryRecordConfirmModal
            record={recordToDelete}
            onCancel={() => setRecordToDelete(null)}
            onConfirm={() => {
              onDeleteRecord(recordToDelete.id);
              setRecordToDelete(null);
            }}
          />
        )}
      </div>
    </div>
  );
};
