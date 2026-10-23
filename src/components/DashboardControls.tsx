import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { FaCog } from 'react-icons/fa';
import { FinishVotingModal } from './FinishVotingModal';
import { VotingHistoryModal } from './VotingHistoryModal';
import { DeleteUserConfirmModal } from './DeleteUserConfirmModal';
import { AdminPinModal } from './AdminPinModal';
import { ResetAuraConfirmModal } from './ResetAuraConfirmModal';
import type { Voter, VotingHistoryRecord, FreezePriceState, GameResult } from '../types/voting';
import type { AuthResult } from '../services/accessControl';

interface GearButtonProps {
  canManageContent: boolean;
  isEditMode: boolean;
  isImporting: boolean;
  onToggleEditMode: () => void;
}

export const DashboardGearButton: React.FC<GearButtonProps> = ({
  canManageContent,
  isEditMode,
  isImporting,
  onToggleEditMode,
}) => {
  if (!canManageContent) return null;

  let title = 'Activar Modo Edición (Oculto)';
  if (isImporting) {
    title = '⏳ Importación en curso...';
  } else if (isEditMode) {
    title = 'Desactivar Modo Edición';
  }

  return (
    <motion.button
      type="button"
      className={`hidden-gear-btn ${isEditMode ? 'active' : ''}`}
      onClick={onToggleEditMode}
      disabled={isImporting}
      title={title}
      aria-label="Modo Edición"
      whileHover={isImporting ? {} : { scale: 1.1, rotate: 15 }}
      whileTap={isImporting ? {} : { scale: 0.9 }}
    >
      <FaCog size={20} />
    </motion.button>
  );
};

interface TopActionNavigationProps {
  canManageContent: boolean;
  hasWinner: boolean;
  isImporting: boolean;
  onOpenFinishModal: () => void;
}

export const DashboardTopActionNavigation: React.FC<TopActionNavigationProps> = ({
  canManageContent,
  hasWinner,
  isImporting,
  onOpenFinishModal,
}) => {
  if (!canManageContent) return null;

  const isDisabled = !hasWinner || isImporting;

  let title = 'No hay un juego ganador disponible para finalizar la votación';
  if (isImporting) {
    title = '⏳ Importación en curso...';
  } else if (hasWinner) {
    title = 'Finalizar votación y asignar cuotas';
  }

  return (
    <div className="top-action-navigation">
      <motion.button
        type="button"
        className="btn-action-primary btn-finish-voting"
        onClick={() => {
          if (!isDisabled) onOpenFinishModal();
        }}
        disabled={isDisabled}
        title={title}
        whileHover={isDisabled ? {} : { scale: 1.04, y: -2 }}
        whileTap={isDisabled ? {} : { scale: 0.95 }}
      >
        🏆 Finalizar Votación
      </motion.button>
    </div>
  );
};

interface HistoryFooterButtonProps {
  isImporting: boolean;
  onOpenHistoryModal: () => void;
}

export const DashboardHistoryFooterButton: React.FC<HistoryFooterButtonProps> = ({
  isImporting,
  onOpenHistoryModal,
}) => (
  <div className="history-footer-action">
    <motion.button
      type="button"
      className="btn-history-glow"
      onClick={() => {
        if (!isImporting) onOpenHistoryModal();
      }}
      disabled={isImporting}
      title={isImporting ? '⏳ Importación en curso...' : 'Ver historial de votaciones'}
      whileHover={isImporting ? {} : { scale: 1.04, y: -2 }}
      whileTap={isImporting ? {} : { scale: 0.96 }}
    >
      📜 Ver historial
    </motion.button>
  </div>
);

interface DashboardModalsProps {
  showFinishModal: boolean;
  hasWinner: boolean;
  results: GameResult[];
  voters: Voter[];
  freezeState: FreezePriceState;
  onConfirmFinish: (updatedVoters: Voter[], historyRecord: VotingHistoryRecord) => Promise<void>;
  onCloseFinishModal: () => void;
  showHistoryModal: boolean;
  history: VotingHistoryRecord[];
  onClearHistory: () => Promise<void>;
  onDeleteHistoryRecord: (recordId: string) => Promise<void>;
  onCloseHistoryModal: () => void;
  canManageContent: boolean;
  voterToDelete: Voter | null;
  onCancelDeleteVoter: () => void;
  onConfirmDeleteVoter: () => void;
  showResetAuraConfirm: boolean;
  onConfirmResetAura: () => Promise<void>;
  onCancelResetAura: () => void;
  showPinModal: boolean;
  onPinCancel: () => void;
  onPinSubmit: (password: string) => Promise<AuthResult>;
}

export const DashboardModals: React.FC<DashboardModalsProps> = ({
  showFinishModal,
  hasWinner,
  results,
  voters,
  freezeState,
  onConfirmFinish,
  onCloseFinishModal,
  showHistoryModal,
  history,
  onClearHistory,
  onDeleteHistoryRecord,
  onCloseHistoryModal,
  canManageContent,
  voterToDelete,
  onCancelDeleteVoter,
  onConfirmDeleteVoter,
  showResetAuraConfirm,
  onConfirmResetAura,
  onCancelResetAura,
  showPinModal,
  onPinCancel,
  onPinSubmit,
}) => (
  <>
    <AnimatePresence>
      {canManageContent && showFinishModal && hasWinner && (
        <FinishVotingModal
          key="finish-modal"
          allResults={results}
          voters={voters}
          isPrecioCongelado={freezeState.isPrecioCongelado}
          precioCongelado={freezeState.precioCongelado}
          descuentoCongelado={freezeState.descuentoCongelado}
          precioCongeladoFormatted={freezeState.precioCongeladoFormatted}
          onConfirmFinish={onConfirmFinish}
          onClose={onCloseFinishModal}
        />
      )}

      {showHistoryModal && (
        <VotingHistoryModal
          key="history-modal"
          history={history}
          onClearHistory={onClearHistory}
          onDeleteRecord={onDeleteHistoryRecord}
          onClose={onCloseHistoryModal}
          canManageContent={canManageContent}
        />
      )}

      {canManageContent && voterToDelete && (
        <DeleteUserConfirmModal
          key={`delete-user-${voterToDelete.id}`}
          voter={voterToDelete}
          onCancel={onCancelDeleteVoter}
          onConfirm={onConfirmDeleteVoter}
        />
      )}

      {canManageContent && showResetAuraConfirm && (
        <ResetAuraConfirmModal
          key="reset-aura-modal"
          onConfirm={onConfirmResetAura}
          onCancel={onCancelResetAura}
        />
      )}
    </AnimatePresence>

    <AnimatePresence>
      {showPinModal && (
        <AdminPinModal
          key="admin-pin-modal"
          onCancel={onPinCancel}
          onAuthenticate={onPinSubmit}
        />
      )}
    </AnimatePresence>
  </>
);
