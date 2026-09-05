import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { VotingHistoryRecord } from '../types/voting';
import { DeleteHistoryRecordConfirmModal } from './DeleteHistoryRecordConfirmModal';
import { HistoryListItem } from './HistoryListItem';
import { CompetitorCard } from './CompetitorCard';
import { VoterSnapshotRow } from './VoterSnapshotRow';
import { GameThumbnail } from './GameThumbnail';

const ITEMS_PER_PAGE = 5;

interface VotingHistoryModalProps {
  history: VotingHistoryRecord[];
  onClearHistory: () => void;
  onDeleteRecord: (recordId: string) => void;
  onClose: () => void;
  canManageContent?: boolean;
}

export const VotingHistoryModal: React.FC<VotingHistoryModalProps> = React.memo(({
  history,
  onClearHistory,
  onDeleteRecord,
  onClose,
  canManageContent = false,
}) => {
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(
    history.length > 0 ? history[0].id : null
  );
  const [currentPage, setCurrentPage] = useState(1);
  const [isMobile, setIsMobile] = useState(false);
  const [mobileShowDetails, setMobileShowDetails] = useState(false);

  const totalPages = useMemo(() => Math.max(1, Math.ceil(history.length / ITEMS_PER_PAGE)), [history.length]);

  const paginatedHistory = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return history.slice(start, start + ITEMS_PER_PAGE);
  }, [history, currentPage]);

  const handlePageChange = useCallback((page: number) => {
    setCurrentPage(page);
  }, []);

  const handleSelectRecord = useCallback((id: string) => {
    setSelectedRecordId(id);
    setMobileShowDetails(true);
  }, []);

  // Reset current page if it exceeds total pages after history changes
  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  // Detect mobile to show full list without pagination on small screens
  useEffect(() => {
    const mql = window.matchMedia('(max-width: 768px)');
    const handler = (e: MediaQueryListEvent | MediaQueryList) => setIsMobile(e.matches);
    setIsMobile(mql.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  const selectedRecord = useMemo(() => {
    if (!selectedRecordId) return history[0] || null;
    return history.find((r) => r.id === selectedRecordId) || history[0] || null;
  }, [history, selectedRecordId]);
  
  const [recordToDelete, setRecordToDelete] = useState<VotingHistoryRecord | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

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
        className="history-modal-container bottom-sheet-panel"
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
            <h2>📜 HISTORIAL DE VOTACIONES PASADAS</h2>
            <p>Consulta las votaciones finalizadas, el registro de cuotas pagadas y la evolución del Aura.</p>
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

        {history.length === 0 ? (
          <div className="empty-history-box">
            <span className="empty-icon">📂</span>
            <h3>No hay votaciones registradas aún</h3>
            <p>Cuando hagas clic en <strong>&quot;Finalizar Votación 🏆&quot;</strong>, los resultados y el historial de cuotas se guardarán aquí automáticamente.</p>
          </div>
        ) : (
          <div className="history-content-layout">
            {/* LEFT SIDEBAR: LIST OF PAST VOTINGS */}
            {(!isMobile || !mobileShowDetails) && (
              <div className="history-sidebar">
                <span className="sidebar-heading">REGISTROS GUARDADOS ({history.length})</span>
                <div className="history-items-list">
                  <AnimatePresence mode="popLayout">
                    {(isMobile ? history : paginatedHistory).map((rec) => (
                      <HistoryListItem
                        key={rec.id}
                        rec={rec}
                        isSelected={rec.id === selectedRecordId}
                        canManageContent={canManageContent}
                        onSelect={handleSelectRecord}
                        onRequestDelete={setRecordToDelete}
                      />
                    ))}
                  </AnimatePresence>
                </div>
                {!isMobile && totalPages > 1 && (
                  <div className="history-pagination">
                    <button
                      type="button"
                      className="pagination-btn"
                      disabled={currentPage <= 1}
                      onClick={() => handlePageChange(currentPage - 1)}
                      aria-label="Página anterior"
                    >
                      ◀ Anterior
                    </button>
                    <span className="pagination-info">
                      {currentPage} / {totalPages}
                    </span>
                    <button
                      type="button"
                      className="pagination-btn"
                      disabled={currentPage >= totalPages}
                      onClick={() => handlePageChange(currentPage + 1)}
                      aria-label="Página siguiente"
                    >
                      Siguiente ▶
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* RIGHT DETAILS PANEL: DETAILED BREAKDOWN OF SELECTED RECORD */}
            {selectedRecord && (!isMobile || mobileShowDetails) && (
              <div className="history-details-panel">
                <div className="history-record-header">
                  <div className="winner-details-badge">
                    <span className="trophy-tag">🏆 JUEGO GANADOR</span>
                    <h3>{selectedRecord.winningGame?.title}</h3>
                    <span className="record-date-tag">🗓️ {selectedRecord.date}</span>
                  </div>
                  {isMobile && (
                    <button
                      type="button"
                      className="mobile-back-btn"
                      onClick={() => setMobileShowDetails(false)}
                      aria-label="Volver a la lista"
                    >
                      ◀ Volver
                    </button>
                  )}
                  {!isMobile && (
                    <GameThumbnail
                      game={selectedRecord.winningGame}
                      alt={selectedRecord.winningGame?.title}
                      className="history-details-banner"
                      recordId={selectedRecord.id}
                    />
                  )}
                </div>

                {/* PODIUM RESULTS */}
                <div className="history-competitors-section">
                  <h5>🏆 TABLA DE POSICIONES FINAL:</h5>
                  <div className="competitors-grid">
                    {(selectedRecord.resultsSnapshot || Object.values(selectedRecord.gamesMap || {})).map((item, idx) => {
                      // Support both GameResult[] and Game[] shapes
                      const game = 'game' in item ? item.game : item;
                      const pts = 'weightedPoints' in item ? item.weightedPoints : null;
                      return (
                        <CompetitorCard
                          key={`${selectedRecord.id}-${game.id || idx}`}
                          game={game}
                          pts={pts}
                          idx={idx}
                          recordId={selectedRecord.id}
                        />
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
                        <VoterSnapshotRow
                          key={snap.voterId}
                          snap={snap}
                        />
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
          {canManageContent && history.length > 0 && (
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
          <div className="modal-backdrop">
            <button
              type="button"
              className="modal-backdrop-close"
              onClick={() => setShowClearConfirm(false)}
              aria-label="Cerrar modal"
            />
            <div
              className="delete-confirm-modal-container"
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
        <AnimatePresence>
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
        </AnimatePresence>
      </motion.div>
    </motion.div>
  );
});
