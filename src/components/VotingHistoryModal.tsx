import React, { useState, useMemo, useCallback, useSyncExternalStore } from 'react';
import { motion, AnimatePresence, useDragControls } from 'framer-motion';
import type { VotingHistoryRecord } from '../types/voting';
import { DeleteHistoryRecordConfirmModal } from './DeleteHistoryRecordConfirmModal';
import { HistoryListItem } from './HistoryListItem';
import { HistoryCompetitorsCarousel } from './HistoryCompetitorsCarousel';
import { VoterSnapshotRow } from './VoterSnapshotRow';
import { GameThumbnail } from './GameThumbnail';
import { formatHistoryDate } from '../utils/formatDate';

const ITEMS_PER_PAGE = 5;

function subscribeToMobileMediaQuery(callback: () => void) {
  const mql = window.matchMedia('(max-width: 768px)');
  mql.addEventListener('change', callback);
  return () => mql.removeEventListener('change', callback);
}

function getMobileSnapshot(): boolean {
  return typeof window !== 'undefined' ? window.innerWidth <= 768 : false;
}

function getMobileServerSnapshot(): boolean {
  return false;
}

// ============================================================
// Subcomponentes de presentación para modularizar el historial
// ============================================================

interface HistoryWinnerPriceBadgeProps {
  record: VotingHistoryRecord;
}

const HistoryWinnerPriceBadge: React.FC<HistoryWinnerPriceBadgeProps> = ({ record }) => {
  if (record.isPrecioCongelado) {
    const formattedPrice =
      record.precioCongeladoFormatted ||
      record.winningGame?.price?.finalFormatted ||
      'Precio Congelado';
    const discountSuffix =
      record.descuentoCongelado && record.descuentoCongelado > 0
        ? ` (-${record.descuentoCongelado}%)`
        : '';
    return (
      <span
        className="record-frozen-price-tag"
        title="Precio congelado preservado permanentemente al momento del cierre"
      >
        🔒 {formattedPrice}
        {discountSuffix}
      </span>
    );
  }

  const price = record.winningGame?.price;
  if (!price?.finalFormatted) return null;

  return (
    <span className="record-price-tag">
      🏷️ {price.finalFormatted}
      {price.discountPercent ? ` (-${price.discountPercent}%)` : ''}
    </span>
  );
};

interface HistoryDetailsPanelProps {
  record: VotingHistoryRecord;
  isMobile: boolean;
  onBack: () => void;
}

const HistoryDetailsPanel: React.FC<HistoryDetailsPanelProps> = ({
  record,
  isMobile,
  onBack,
}) => {
  const competitorItems =
    record.resultsSnapshot || Object.values(record.gamesMap || {});

  return (
    <div className="history-details-panel">
      <div className="history-record-header">
        {/* Fondo difuminado cinematográfico del juego ganador */}
        <div className="history-header-blur-bg" aria-hidden="true">
          <GameThumbnail
            game={record.winningGame}
            alt=""
            className="history-header-blur-img"
            recordId={record.id}
          />
          <div className="history-header-blur-overlay" />
        </div>

        {isMobile && (
          <button
            type="button"
            className="mobile-back-btn"
            onClick={onBack}
            aria-label="Volver a la lista"
          >
            ◀ Volver
          </button>
        )}

        <div className="history-record-header-main">
          <GameThumbnail
            game={record.winningGame}
            alt={record.winningGame?.title}
            className="history-details-banner"
            recordId={record.id}
          />
          <div className="winner-details-badge">
            <span className="trophy-tag">🏆 JUEGO GANADOR</span>
            <h3>{record.winningGame?.title}</h3>
            <div className="history-winner-tags-row">
              <span className="record-date-tag">🗓️ {formatHistoryDate(record)}</span>
              <HistoryWinnerPriceBadge record={record} />
            </div>
          </div>
        </div>
      </div>

      {/* PODIUM RESULTS CAROUSEL */}
      <HistoryCompetitorsCarousel
        items={competitorItems}
        recordId={record.id}
      />

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
            {record.votersSnapshots.map((snap) => (
              <VoterSnapshotRow key={snap.voterId} snap={snap} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

interface HistorySidebarProps {
  history: VotingHistoryRecord[];
  paginatedHistory: VotingHistoryRecord[];
  isMobile: boolean;
  selectedRecordId: string | null;
  canManageContent: boolean;
  currentPage: number;
  totalPages: number;
  onSelectRecord: (id: string) => void;
  onRequestDelete: (rec: VotingHistoryRecord) => void;
  onPageChange: (page: number) => void;
}

const HistorySidebar: React.FC<HistorySidebarProps> = ({
  history,
  paginatedHistory,
  isMobile,
  selectedRecordId,
  canManageContent,
  currentPage,
  totalPages,
  onSelectRecord,
  onRequestDelete,
  onPageChange,
}) => {
  const recordsToRender = isMobile ? history : paginatedHistory;

  return (
    <div className="history-sidebar">
      <span className="sidebar-heading">REGISTROS GUARDADOS ({history.length})</span>
      <div className="history-items-list">
        <AnimatePresence mode="popLayout">
          {recordsToRender.map((rec) => (
            <HistoryListItem
              key={rec.id}
              rec={rec}
              isSelected={rec.id === selectedRecordId}
              canManageContent={canManageContent}
              onSelect={onSelectRecord}
              onRequestDelete={onRequestDelete}
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
            onClick={() => onPageChange(currentPage - 1)}
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
            onClick={() => onPageChange(currentPage + 1)}
            aria-label="Página siguiente"
          >
            Siguiente ▶
          </button>
        </div>
      )}
    </div>
  );
};

interface HistoryModalFooterProps {
  isMobile: boolean;
  canManageContent: boolean;
  hasHistory: boolean;
  onClearHistoryClick: () => void;
  onClose: () => void;
}

const HistoryModalFooter: React.FC<HistoryModalFooterProps> = ({
  isMobile,
  canManageContent,
  hasHistory,
  onClearHistoryClick,
  onClose,
}) => {
  const showClearButton = canManageContent && hasHistory;
  const showCloseButton = !isMobile;

  if (!showClearButton && !showCloseButton) {
    return null;
  }

  return (
    <div className="modal-footer-actions">
      {showClearButton && (
        <button
          type="button"
          className="btn-clear-history"
          onClick={onClearHistoryClick}
        >
          🗑️ Limpiar Historial
        </button>
      )}
      {showCloseButton && (
        <motion.button
          type="button"
          className="btn-modal-cancel btn-history-close"
          onClick={onClose}
          whileHover={{ scale: 1.04, y: -2 }}
          whileTap={{ scale: 0.96 }}
          aria-label="Cerrar ventana de historial"
        >
          <span className="btn-close-icon" aria-hidden="true">✕</span>
          <span>Cerrar</span>
        </motion.button>
      )}
    </div>
  );
};

interface ClearHistoryConfirmModalProps {
  onCancel: () => void;
  onConfirm: () => void;
}

const ClearHistoryConfirmModal: React.FC<ClearHistoryConfirmModalProps> = ({
  onCancel,
  onConfirm,
}) => (
  <div className="modal-backdrop">
    <button
      type="button"
      className="modal-backdrop-close"
      onClick={onCancel}
      aria-label="Cerrar modal"
    />
    <div className="delete-confirm-modal-container">
      <div className="modal-header">
        <div className="modal-title-group">
          <h2>⚠️ Limpiar Historial Completo</h2>
          <p>Esta acción no se puede deshacer fácilmente.</p>
        </div>
        <button
          type="button"
          className="modal-close-btn"
          onClick={onCancel}
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
          onClick={onCancel}
        >
          Cancelar
        </button>
        <button
          type="button"
          className="btn-modal-confirm-delete"
          onClick={onConfirm}
        >
          Confirmar Eliminación
        </button>
      </div>
    </div>
  </div>
);

// ============================================================
// Componente Principal
// ============================================================

interface VotingHistoryModalProps {
  history: VotingHistoryRecord[];
  onClearHistory: () => void;
  onDeleteRecord: (recordId: string) => Promise<void>;
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
  const dragControls = useDragControls();
  const [isHandlePressed, setIsHandlePressed] = useState(false);
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(
    history.length > 0 ? history[0].id : null
  );
  const [currentPage, setCurrentPage] = useState(1);
  const isMobile = useSyncExternalStore(
    subscribeToMobileMediaQuery,
    getMobileSnapshot,
    getMobileServerSnapshot
  );
  const [mobileShowDetails, setMobileShowDetails] = useState(false);
  const [recordToDelete, setRecordToDelete] = useState<VotingHistoryRecord | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(history.length / ITEMS_PER_PAGE)),
    [history.length]
  );

  const safeCurrentPage = Math.min(currentPage, totalPages);

  const paginatedHistory = useMemo(() => {
    const start = (safeCurrentPage - 1) * ITEMS_PER_PAGE;
    return history.slice(start, start + ITEMS_PER_PAGE);
  }, [history, safeCurrentPage]);

  const handlePageChange = useCallback((page: number) => {
    setCurrentPage(page);
  }, []);

  const handleSelectRecord = useCallback((id: string) => {
    setSelectedRecordId(id);
    setMobileShowDetails(true);
  }, []);

  const handleBackToMobileList = useCallback(() => {
    setMobileShowDetails(false);
  }, []);

  const handlePointerDownDragZone = useCallback((e: React.PointerEvent) => {
    setIsHandlePressed(true);
    if (isMobile) {
      dragControls.start(e);
    }
  }, [isMobile, dragControls]);

  const handlePointerUpDragZone = useCallback(() => {
    setIsHandlePressed(false);
  }, []);

  const handleConfirmClear = useCallback(() => {
    onClearHistory();
    setShowClearConfirm(false);
  }, [onClearHistory]);

  const handleConfirmDelete = useCallback(async () => {
    if (!recordToDelete) return;
    await onDeleteRecord(recordToDelete.id);
    setRecordToDelete(null);
  }, [recordToDelete, onDeleteRecord]);

  const selectedRecord = useMemo(() => {
    if (!selectedRecordId) return history[0] || null;
    return history.find((r) => r.id === selectedRecordId) || history[0] || null;
  }, [history, selectedRecordId]);

  const showSidebar = !isMobile || !mobileShowDetails;
  const showDetails = Boolean(selectedRecord) && (!isMobile || mobileShowDetails);

  return (
    <motion.div
      className="modal-backdrop bottom-sheet-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
      onClick={onClose}
      style={{ WebkitTapHighlightColor: 'transparent', outline: 'none' }}
    >
      <motion.div
        className="history-modal-container bottom-sheet-panel"
        initial={{ y: '100%', opacity: 0, scale: 0.95 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        exit={{ y: '100%', opacity: 0, scale: 0.95 }}
        transition={{ type: 'spring', stiffness: 320, damping: 30 }}
        onClick={(e) => e.stopPropagation()}
        style={{ WebkitTapHighlightColor: 'transparent', outline: 'none' }}
        drag={isMobile ? 'y' : false}
        dragControls={dragControls}
        dragListener={false}
        dragConstraints={{ top: 0 }}
        dragElastic={{ top: 0.05, bottom: 0.6 }}
        onDragEnd={(_e, info) => {
          setIsHandlePressed(false);
          if (info.offset.y > 80 || info.velocity.y > 300) {
            onClose();
          }
        }}
      >
        {/* Handle visual superior estilo bottom sheet con animación elástica al tocar */}
        <button
          type="button"
          className="bottom-sheet-handle-zone"
          onPointerDown={handlePointerDownDragZone}
          onPointerUp={handlePointerUpDragZone}
          onPointerCancel={handlePointerUpDragZone}
          aria-label="Deslizar hacia abajo para cerrar"
        >
          <motion.div
            className="bottom-sheet-handle"
            aria-hidden="true"
            animate={{
              scaleX: isHandlePressed ? 0.68 : 1,
              scaleY: isHandlePressed ? 1.35 : 1,
              backgroundColor: isHandlePressed ? 'var(--neon-purple-bright)' : 'rgba(168, 85, 247, 0.55)',
              boxShadow: isHandlePressed ? '0 0 16px rgba(168, 85, 247, 0.95)' : '0 0 0px transparent',
            }}
            transition={{ type: 'spring', stiffness: 450, damping: 24 }}
          />
        </button>

        <div
          className="modal-header"
          onPointerDown={handlePointerDownDragZone}
          onPointerUp={handlePointerUpDragZone}
          onPointerCancel={handlePointerUpDragZone}
        >
          <div className="modal-title-group">
            <h2>📜 HISTORIAL DE VOTACIONES PASADAS</h2>
            <p>Consulta las votaciones finalizadas, el registro de cuotas pagadas y la evolución del Aura.</p>
          </div>
          {!isMobile && (
            <motion.button
              type="button"
              className="modal-close-btn history-header-close-btn"
              onClick={onClose}
              whileHover={{ scale: 1.15, rotate: 90 }}
              whileTap={{ scale: 0.9 }}
              aria-label="Cerrar historial"
            >
              ✕
            </motion.button>
          )}
        </div>

        {history.length === 0 ? (
          <div className="empty-history-box">
            <span className="empty-icon">📂</span>
            <h3>No hay votaciones registradas aún</h3>
            <p>
              Cuando hagas clic en <strong>&quot;Finalizar Votación 🏆&quot;</strong>, los resultados y el historial de cuotas se guardarán aquí automáticamente.
            </p>
          </div>
        ) : (
          <div className="history-content-layout">
            {showSidebar && (
              <HistorySidebar
                history={history}
                paginatedHistory={paginatedHistory}
                isMobile={isMobile}
                selectedRecordId={selectedRecordId}
                canManageContent={canManageContent}
                currentPage={safeCurrentPage}
                totalPages={totalPages}
                onSelectRecord={handleSelectRecord}
                onRequestDelete={setRecordToDelete}
                onPageChange={handlePageChange}
              />
            )}

            {showDetails && selectedRecord && (
              <HistoryDetailsPanel
                record={selectedRecord}
                isMobile={isMobile}
                onBack={handleBackToMobileList}
              />
            )}
          </div>
        )}

        <HistoryModalFooter
          isMobile={isMobile}
          canManageContent={canManageContent}
          hasHistory={history.length > 0}
          onClearHistoryClick={() => setShowClearConfirm(true)}
          onClose={onClose}
        />

        {showClearConfirm && (
          <ClearHistoryConfirmModal
            onCancel={() => setShowClearConfirm(false)}
            onConfirm={handleConfirmClear}
          />
        )}

        <AnimatePresence>
          {recordToDelete && (
            <DeleteHistoryRecordConfirmModal
              record={recordToDelete}
              onCancel={() => setRecordToDelete(null)}
              onConfirm={handleConfirmDelete}
            />
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  );
});
