import React, { useState, useMemo, useCallback, useSyncExternalStore } from 'react';
import { motion, AnimatePresence, useDragControls } from 'framer-motion';
import { FaSteam } from 'react-icons/fa';
import type { VotingHistoryRecord, PurchasePlatform } from '../types/voting';
import { DeleteHistoryRecordConfirmModal } from './DeleteHistoryRecordConfirmModal';
import { HistoryListItem } from './HistoryListItem';
import { HistoryCompetitorsCarousel } from './HistoryCompetitorsCarousel';
import { VoterSnapshotRow } from './VoterSnapshotRow';
import { GameThumbnail } from './GameThumbnail';
import { EnebaIcon } from './FinishVotingModal';
import { formatHistoryDate } from '../utils/formatDate';
import { formatCopPrice, parseCopInputToCents } from '../services/steamStoreApi';

const ITEMS_PER_PAGE = 6;

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

const PlatformPill: React.FC<{ platform?: PurchasePlatform }> = ({ platform }) => {
  const isEneba = platform === 'eneba';
  const label = isEneba ? 'Eneba' : 'Steam';
  return (
    <span
      className={`record-platform-pill ${isEneba ? 'eneba' : 'steam'}`}
      title={`Juego adquirido a través de ${label}`}
    >
      {isEneba ? <EnebaIcon className="platform-icon" /> : <FaSteam className="platform-icon" />}
      <span>{label}</span>
    </span>
  );
};

function resolveHistoryPriceBadgeData(record: VotingHistoryRecord): {
  type: 'paid' | 'frozen' | 'normal' | 'none';
  text: string;
  badgeClass: string;
  title: string;
  icon: string;
} {
  if (record.precioPagado !== undefined && record.precioPagado !== null) {
    const text = record.precioPagado === 0 ? 'Gratis' : formatCopPrice(record.precioPagado);
    return {
      type: 'paid',
      text,
      badgeClass: 'record-price-tag paid-price-tag',
      title: 'Precio de compra registrado para este juego',
      icon: '🏷️',
    };
  }

  if (record.precioPagadoFormatted) {
    return {
      type: 'paid',
      text: record.precioPagadoFormatted,
      badgeClass: 'record-price-tag paid-price-tag',
      title: 'Precio de compra registrado para este juego',
      icon: '🏷️',
    };
  }

  if (record.isPrecioCongelado) {
    const base = record.precioCongeladoFormatted ?? record.winningGame?.price?.finalFormatted ?? 'Precio Congelado';
    const discount = record.descuentoCongelado ? ` (-${record.descuentoCongelado}%)` : '';
    return {
      type: 'frozen',
      text: `${base}${discount}`,
      badgeClass: 'record-frozen-price-tag',
      title: 'Precio congelado preservado permanentemente al momento del cierre',
      icon: '🔒',
    };
  }

  const finalFormatted = record.winningGame?.price?.finalFormatted;
  if (finalFormatted) {
    const discount = record.winningGame?.price?.discountPercent ? ` (-${record.winningGame.price.discountPercent}%)` : '';
    return {
      type: 'normal',
      text: `${finalFormatted}${discount}`,
      badgeClass: 'record-price-tag',
      title: 'Precio de referencia de Steam',
      icon: '🏷️',
    };
  }

  return { type: 'none', text: '', badgeClass: '', title: '', icon: '' };
}

const HistoryWinnerPriceBadge: React.FC<HistoryWinnerPriceBadgeProps> = ({ record }) => {
  const priceData = resolveHistoryPriceBadgeData(record);

  return (
    <div className="history-price-badge-group">
      <PlatformPill platform={record.purchasePlatform} />
      {priceData.type !== 'none' && (
        <span className={priceData.badgeClass} title={priceData.title}>
          {priceData.icon} {priceData.text}
        </span>
      )}
    </div>
  );
};

interface HistoryRecordPurchaseEditorProps {
  record: VotingHistoryRecord;
  onSave: (updates: {
    purchasePlatform: PurchasePlatform;
    precioPagado: number | null;
    precioPagadoFormatted: string | null;
  }) => Promise<void>;
  onCancel: () => void;
}

const HistoryRecordPurchaseEditor: React.FC<HistoryRecordPurchaseEditorProps> = ({
  record,
  onSave,
  onCancel,
}) => {
  const [platform, setPlatform] = useState<PurchasePlatform>(
    record.purchasePlatform === 'eneba' ? 'eneba' : 'steam'
  );

  const initialPriceCop = useMemo(() => {
    if (record.precioPagado !== undefined && record.precioPagado !== null) {
      const pesos = Math.round(record.precioPagado / 100);
      return new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(pesos);
    }
    if (record.winningGame?.price?.final !== undefined && record.winningGame.price.final !== null) {
      const pesos = Math.round(record.winningGame.price.final / 100);
      return new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(pesos);
    }
    return '';
  }, [record.precioPagado, record.winningGame]);

  const [priceCop, setPriceCop] = useState<string>(initialPriceCop);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const priceCents = useMemo(() => {
    if (priceCop.trim() === '') return null;
    return parseCopInputToCents(priceCop);
  }, [priceCop]);

  const priceFormatted = useMemo(() => {
    if (priceCents === null) return null;
    if (priceCents === 0) return 'Gratis';
    return formatCopPrice(priceCents);
  }, [priceCents]);

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);
    try {
      await onSave({
        purchasePlatform: platform,
        precioPagado: priceCents,
        precioPagadoFormatted: priceFormatted,
      });
      onCancel();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al guardar cambios');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <motion.div
      className="history-purchase-inline-editor"
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.2 }}
    >
      <div className="editor-title-row">
        <span className="editor-title-icon" aria-hidden="true">✏️</span>
        <span className="editor-title-text">MODIFICAR DATOS DE COMPRA</span>
      </div>

      <div className="editor-fields-grid">
        <div className="editor-field">
          <span id="history-platform-label" className="editor-field-label">Plataforma:</span>
          <div className="platform-toggle-group mini" role="radiogroup" aria-labelledby="history-platform-label">
            <button
              type="button"
              role="radio"
              aria-checked={platform === 'steam'}
              className={`platform-toggle-btn platform-steam ${platform === 'steam' ? 'active' : ''}`}
              onClick={() => setPlatform('steam')}
              disabled={isSaving}
            >
              <FaSteam className="platform-btn-icon" />
              <span>Steam</span>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={platform === 'eneba'}
              className={`platform-toggle-btn platform-eneba ${platform === 'eneba' ? 'active' : ''}`}
              onClick={() => setPlatform('eneba')}
              disabled={isSaving}
            >
              <EnebaIcon className="platform-btn-icon" />
              <span>Eneba</span>
            </button>
          </div>
        </div>

        <div className="editor-field">
          <label htmlFor="history-edit-price" className="editor-field-label">
            Precio Pagado ($ COP):
          </label>
          <div className="paid-price-input-row mini">
            <div className="paid-price-wrapper">
              <span className="paid-prefix" aria-hidden="true">$</span>
              <input
                id="history-edit-price"
                type="text"
                inputMode="numeric"
                className="paid-price-input-element"
                placeholder="0"
                value={priceCop}
                onChange={(e) => setPriceCop(e.target.value)}
                disabled={isSaving}
              />
              <span className="paid-suffix">COP</span>
            </div>
            <button
              type="button"
              className="btn-paid-shortcut"
              onClick={() => setPriceCop('0')}
              disabled={isSaving}
              title="Marcar como juego gratis o regalo ($0)"
            >
              Gratis ($0)
            </button>
          </div>
        </div>
      </div>

      {error && <div className="editor-error-text">⚠️ {error}</div>}

      <div className="editor-actions-row">
        <button
          type="button"
          className="btn-editor-cancel"
          onClick={onCancel}
          disabled={isSaving}
        >
          Cancelar
        </button>
        <button
          type="button"
          className="btn-editor-save"
          onClick={handleSave}
          disabled={isSaving}
        >
          {isSaving ? 'Guardando…' : '💾 Guardar Cambios'}
        </button>
      </div>
    </motion.div>
  );
};

interface HistoryDetailsPanelProps {
  record: VotingHistoryRecord;
  isMobile: boolean;
  canManageContent?: boolean;
  onUpdateRecord?: (recordId: string, updates: Partial<VotingHistoryRecord>) => Promise<void>;
  onBack: () => void;
}

const HistoryDetailsPanel: React.FC<HistoryDetailsPanelProps> = ({
  record,
  isMobile,
  canManageContent = false,
  onUpdateRecord,
  onBack,
}) => {
  const [isEditingPurchase, setIsEditingPurchase] = useState(false);

  const competitorItems =
    record.resultsSnapshot || Object.values(record.gamesMap || {});

  const handleSavePurchase = useCallback(
    async (updates: {
      purchasePlatform: PurchasePlatform;
      precioPagado: number | null;
      precioPagadoFormatted: string | null;
    }) => {
      if (!onUpdateRecord) return;
      await onUpdateRecord(record.id, updates);
    },
    [onUpdateRecord, record.id]
  );

  return (
    <div className="history-details-panel">
      <motion.div
        className="history-record-header"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      >
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
          <motion.button
            type="button"
            className="mobile-back-btn"
            onClick={onBack}
            aria-label="Volver a la lista"
            whileTap={{ scale: 0.92 }}
            transition={{ duration: 0.1 }}
          >
            ◀ Volver
          </motion.button>
        )}

        <div className="history-record-header-main">
          <GameThumbnail
            game={record.winningGame}
            alt={record.winningGame?.title}
            className="history-details-banner"
            recordId={record.id}
          />
          <div className="winner-details-badge">
            <div className="winner-details-header-tags">
              <span className="trophy-tag">🏆 JUEGO GANADOR</span>
              {(record.isBundle || record.winningGame?.isBundle) && (
                <span className="bundle-badge neon-pulse" title="Paquete Especial / Bundle">
                  📦 BUNDLE / PAQUETE
                </span>
              )}
            </div>
            <h3 className="history-winner-title">{record.winningGame?.title}</h3>
            {(record.bundleDescription || record.winningGame?.bundleDescription) && (
              <p className="history-bundle-desc">
                🎁 {record.bundleDescription || record.winningGame?.bundleDescription}
              </p>
            )}
            <span className="record-date-tag">🗓️ {formatHistoryDate(record)}</span>
            <div className="history-winner-tags-row">
              <HistoryWinnerPriceBadge record={record} />
            </div>

            {canManageContent && onUpdateRecord && !isEditingPurchase && (
              <div className="history-admin-purchase-actions">
                <button
                  type="button"
                  className="btn-edit-purchase-details"
                  onClick={() => setIsEditingPurchase(true)}
                  title="Modificar precio pagado o plataforma de compra"
                >
                  ✏️ {record.precioPagado !== null && record.precioPagado !== undefined ? 'Editar precio pagado / plataforma' : 'Agregar precio pagado / plataforma'}
                </button>
              </div>
            )}

            {isEditingPurchase && (
              <HistoryRecordPurchaseEditor
                key={`purchase-editor-${record.id}`}
                record={record}
                onSave={handleSavePurchase}
                onCancel={() => setIsEditingPurchase(false)}
              />
            )}
          </div>
        </div>
      </motion.div>

      {/* PODIUM RESULTS CAROUSEL */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.24, delay: 0.05, ease: [0.22, 1, 0.36, 1] }}
      >
        <HistoryCompetitorsCarousel
          items={competitorItems}
          recordId={record.id}
        />
      </motion.div>

      {/* VOTERS BREAKDOWN TABLE */}
      <motion.div
        className="history-voters-table-container"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.24, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
      >
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
      </motion.div>
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
  const latestRecordId = history[0]?.id;

  return (
    <div className="history-sidebar">
      <span className="sidebar-heading">REGISTROS GUARDADOS ({history.length})</span>
      <div className="history-items-list">
        {recordsToRender.map((rec) => (
          <HistoryListItem
            key={rec.id}
            rec={rec}
            isSelected={rec.id === selectedRecordId}
            isLatest={rec.id === latestRecordId}
            canManageContent={canManageContent}
            onSelect={onSelectRecord}
            onRequestDelete={onRequestDelete}
          />
        ))}
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

interface HistoryContentLayoutProps {
  history: VotingHistoryRecord[];
  paginatedHistory: VotingHistoryRecord[];
  isMobile: boolean;
  mobileShowDetails: boolean;
  selectedRecord: VotingHistoryRecord | null;
  selectedRecordId: string | null;
  canManageContent: boolean;
  currentPage: number;
  totalPages: number;
  onSelectRecord: (id: string) => void;
  onRequestDelete: (rec: VotingHistoryRecord) => void;
  onPageChange: (page: number) => void;
  onUpdateRecord?: (recordId: string, updates: Partial<VotingHistoryRecord>) => Promise<void>;
  onBack: () => void;
}

const HistoryContentLayout: React.FC<HistoryContentLayoutProps> = ({
  history,
  paginatedHistory,
  isMobile,
  mobileShowDetails,
  selectedRecord,
  selectedRecordId,
  canManageContent,
  currentPage,
  totalPages,
  onSelectRecord,
  onRequestDelete,
  onPageChange,
  onUpdateRecord,
  onBack,
}) => {
  if (history.length === 0) {
    return (
      <div className="empty-history-box">
        <span className="empty-icon">📂</span>
        <h3>No hay votaciones registradas aún</h3>
        <p>
          Cuando hagas clic en <strong>&quot;Finalizar Votación 🏆&quot;</strong>, los resultados y el historial de cuotas se guardarán aquí automáticamente.
        </p>
      </div>
    );
  }

  const sidebarNode = (
    <HistorySidebar
      history={history}
      paginatedHistory={paginatedHistory}
      isMobile={isMobile}
      selectedRecordId={selectedRecordId}
      canManageContent={canManageContent}
      currentPage={currentPage}
      totalPages={totalPages}
      onSelectRecord={onSelectRecord}
      onRequestDelete={onRequestDelete}
      onPageChange={onPageChange}
    />
  );

  const detailsNode = selectedRecord ? (
    <HistoryDetailsPanel
      record={selectedRecord}
      isMobile={isMobile}
      canManageContent={canManageContent}
      onUpdateRecord={onUpdateRecord}
      onBack={onBack}
    />
  ) : null;

  return (
    <div className="history-content-layout">
      {isMobile ? (
        <AnimatePresence mode="wait" initial={false}>
          {!mobileShowDetails ? (
            <motion.div
              key="mobile-history-sidebar"
              className="history-view-transition"
              initial={{ opacity: 0, x: -22 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -22 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            >
              {sidebarNode}
            </motion.div>
          ) : (
            detailsNode && (
              <motion.div
                key={`mobile-history-details-${selectedRecord?.id}`}
                className="history-view-transition"
                initial={{ opacity: 0, x: 22 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 22 }}
                transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              >
                {detailsNode}
              </motion.div>
            )
          )}
        </AnimatePresence>
      ) : (
        <>
          {sidebarNode}
          {detailsNode && (
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={`desktop-history-details-${selectedRecord?.id}`}
                className="history-view-transition"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.18, ease: 'easeOut' }}
              >
                {detailsNode}
              </motion.div>
            </AnimatePresence>
          )}
        </>
      )}
    </div>
  );
};

interface VotingHistoryModalProps {
  history: VotingHistoryRecord[];
  onClearHistory: () => Promise<void> | void;
  onDeleteRecord: (recordId: string) => Promise<void>;
  onUpdateRecord?: (recordId: string, updates: Partial<VotingHistoryRecord>) => Promise<void>;
  onClose: () => void;
  canManageContent?: boolean;
}

export const VotingHistoryModal: React.FC<VotingHistoryModalProps> = React.memo(({
  history,
  onClearHistory,
  onDeleteRecord,
  onUpdateRecord,
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

  const handleConfirmClear = useCallback(async () => {
    try {
      await onClearHistory();
      setShowClearConfirm(false);
    } catch {
      // Si la persistencia falló, el error ya fue establecido en syncState; conservamos el diálogo abierto
    }
  }, [onClearHistory]);

  const handleConfirmDelete = useCallback(async () => {
    if (!recordToDelete) return;
    try {
      await onDeleteRecord(recordToDelete.id);
      setRecordToDelete(null);
    } catch {
      // Si la persistencia falló, el error ya fue establecido en syncState; conservamos el diálogo abierto
    }
  }, [recordToDelete, onDeleteRecord]);

  const selectedRecord = useMemo(() => {
    if (!selectedRecordId) return history[0] || null;
    return history.find((r) => r.id === selectedRecordId) || history[0] || null;
  }, [history, selectedRecordId]);

  return (
    <motion.div
      className="modal-backdrop bottom-sheet-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: isMobile ? 0.22 : 0.25, ease: 'easeOut' }}
      onClick={onClose}
      style={{ WebkitTapHighlightColor: 'transparent', outline: 'none' }}
    >
      <motion.div
        className="history-modal-container bottom-sheet-panel"
        initial={isMobile ? { y: '100%', opacity: 0 } : { y: '100%', opacity: 0, scale: 0.95 }}
        animate={isMobile ? { y: 0, opacity: 1 } : { y: 0, opacity: 1, scale: 1 }}
        exit={isMobile ? { y: '100%', opacity: 0 } : { y: '100%', opacity: 0, scale: 0.95 }}
        transition={
          isMobile
            ? { type: 'spring', stiffness: 380, damping: 34, mass: 0.85 }
            : { type: 'spring', stiffness: 340, damping: 28 }
        }
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

        <HistoryContentLayout
          history={history}
          paginatedHistory={paginatedHistory}
          isMobile={isMobile}
          mobileShowDetails={mobileShowDetails}
          selectedRecord={selectedRecord}
          selectedRecordId={selectedRecordId}
          canManageContent={canManageContent}
          currentPage={safeCurrentPage}
          totalPages={totalPages}
          onSelectRecord={handleSelectRecord}
          onRequestDelete={setRecordToDelete}
          onPageChange={handlePageChange}
          onUpdateRecord={onUpdateRecord}
          onBack={handleBackToMobileList}
        />

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
