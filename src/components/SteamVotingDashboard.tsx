import React, { useState, useEffect, useMemo, useCallback, useRef, useSyncExternalStore } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Header } from './Header';
import { UserCard } from './UserCard';
import { WinnerBanner } from './WinnerBanner';
import { GameSearchEditor } from './GameSearchEditor';
import { InstallPrompt } from './InstallPrompt';
import { DashboardSkeleton } from './DashboardSkeleton';
import { DashboardGearButton, DashboardTopActionNavigation, DashboardHistoryFooterButton, DashboardModals } from './DashboardControls';
import { SyncIndicator } from './SyncIndicator';
import { InitialLoadErrorView } from './InitialLoadErrorView';
import { AdminSessionBadge } from './AdminSessionBadge';
import { EditModeTopBar } from './EditModeTopBar';

import { useAdminAuth } from '../hooks/useAdminAuth';
import { useVotersDragAndDrop } from '../hooks/useVotersDragAndDrop';
import { useVoterManagement } from '../hooks/useVoterManagement';
import { useGameManagement } from '../hooks/useGameManagement';
import { useVotingHistoryActions } from '../hooks/useVotingHistoryActions';
import { useDashboardBackup } from '../hooks/useDashboardBackup';
import { useDashboardResetActions } from '../hooks/useDashboardResetActions';
import { usePriceFreeze } from '../hooks/usePriceFreeze';
import { useDashboardPersistence } from '../hooks/useDashboardPersistence';
import { useAutoUnfreezeWatcher } from '../hooks/useAutoUnfreezeWatcher';
import { reconcileVoterVotes } from '../utils/votingStateHelpers';
import { calculateResults } from '../data/votingData';
import type { Voter, Game, VotingHistoryRecord, FreezePriceState } from '../types/voting';

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
import { DEFAULT_FREEZE_STATE } from '../services/dataStore';

const MIN_VOTERS = 2;
const MAX_VOTERS = 6;
const MIN_GAMES = 2;
const MAX_GAMES = 6;

// ─── Funciones auxiliares puras ───────────────────────────
function getVoterCountBadgeText(isEditMode: boolean, isMobile: boolean, count: number): string {
  if (!isEditMode) {
    return `${count} / ${MAX_VOTERS} Integrantes`;
  }
  return isMobile ? '⚙️ Editá integrantes y juegos' : '🖐️ Arrastrá tarjetas / Editá juegos arriba';
}

// ─── Componente principal ─────────────────────────────────
export const SteamVotingDashboard: React.FC = () => {
  const [voters, setVoters] = useState<Voter[]>([]);
  const [gamesMap, setGamesMap] = useState<Record<string, Game>>({});
  const [history, setHistory] = useState<VotingHistoryRecord[]>([]);
  const [steamApiKey, setSteamApiKey] = useState<string>('');
  const [freezeState, setFreezeState] = useState<FreezePriceState>(DEFAULT_FREEZE_STATE);

  const [isEditMode, setIsEditMode] = useState<boolean>(false);
  const [isImporting, setIsImporting] = useState<boolean>(false);
  const [showFinishModal, setShowFinishModal] = useState<boolean>(false);
  const [showHistoryModal, setShowHistoryModal] = useState<boolean>(false);
  const [voterToDelete, setVoterToDelete] = useState<Voter | null>(null);
  const [showResetAuraConfirm, setShowResetAuraConfirm] = useState(false);

  const isImportingRef = useRef<boolean>(false);
  const importFileInputRef = useRef<HTMLInputElement | null>(null);

  const handleAdminReset = useCallback(() => {
    setShowFinishModal(false);
    setVoterToDelete(null);
    setShowResetAuraConfirm(false);
  }, []);

  const {
    adminAccess,
    canManageContent,
    showPinModal,
    requestAdminUnlockViaModal,
    handlePinSubmit,
    handleLogoutAdmin,
    handlePinCancel,
  } = useAdminAuth({
    isImportingRef,
    setIsEditMode,
    onAdminReset: handleAdminReset,
  });

  const isMobile = useSyncExternalStore(
    subscribeToMobileMediaQuery,
    getMobileSnapshot,
    getMobileServerSnapshot
  );

  const { getDragProps } = useVotersDragAndDrop(setVoters, isMobile, isImporting);

  const {
    handleAddVoter,
    handleRequestDeleteVoter,
    handleConfirmDeleteVoter,
    handleCancelDeleteVoter,
  } = useVoterManagement({
    voters,
    setVoters,
    gamesMap,
    canManageContent,
    isImportingRef,
    voterToDelete,
    setVoterToDelete,
    minVoters: MIN_VOTERS,
    maxVoters: MAX_VOTERS,
  });

  const {
    initialLoadStatus,
    initialLoadErrorMessage,
    syncState,
    setSyncState,
    handleRetryInitialLoad,
    saveDebounceRef,
    lastPersistedDashboardSignatureRef,
    lastPersistedApiKeyRef,
    cancelPendingWritesAndDebounce,
  } = useDashboardPersistence({
    voters,
    setVoters,
    gamesMap,
    setGamesMap,
    setHistory,
    steamApiKey,
    setSteamApiKey,
    freezeState,
    setFreezeState,
    canManageContent,
    isImporting,
    isImportingRef,
  });

  const isLoading = initialLoadStatus === 'loading';

  // Auto-ocultar el indicador de sincronización tras 5 segundos al completarse o fallar
  useEffect(() => {
    if (syncState.status !== 'idle' && syncState.status !== 'saving') {
      const timer = setTimeout(() => {
        setSyncState({ status: 'idle', message: '' });
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [syncState, setSyncState]);


  // ─── Calcular resultados ─────────────────────────────────
  const results = useMemo(() => calculateResults(voters, gamesMap), [voters, gamesMap]);
  const hasWinner = results.length > 0 && Boolean(results[0]?.game);

  // ─── Calcular total de puntos asignados para determinar estado de votación ───
  const totalAssignedPoints = useMemo(() => {
    return voters.reduce((acc, voter) => {
      return acc + voter.votes.reduce((sum, vote) => sum + (vote.points || 0), 0);
    }, 0);
  }, [voters]);

  // Texto descriptivo del badge de integrantes según modo de edición y dispositivo
  const voterCountBadgeText = useMemo(
    () => getVoterCountBadgeText(isEditMode, isMobile, voters.length),
    [isEditMode, isMobile, voters.length]
  );

  // ─── Reconciliar votos de los integrantes con gamesMap (autocorregir desalineaciones/IDs huérfanos) ───
  useEffect(() => {
    if (initialLoadStatus !== 'loaded' || isImporting) return;
    const gameIds = Object.keys(gamesMap);
    if (gameIds.length === 0 || voters.length === 0) return;

    const { changed, updatedVoters } = reconcileVoterVotes(voters, gameIds);

    if (changed) {
      void Promise.resolve().then(() => {
        if (!isImportingRef.current) {
          setVoters(updatedVoters);
        }
      });
    }
  }, [gamesMap, voters, initialLoadStatus, isImporting]);

  const {
    autoUnfreezePrice,
    handleToggleFreezePrice,
    isFreezingLoading,
  } = usePriceFreeze({
    canManageContent,
    isImportingRef,
    voters,
    gamesMap,
    results,
    freezeState,
    setFreezeState,
    setSyncState,
    lastPersistedDashboardSignatureRef,
  });

  useAutoUnfreezeWatcher(
    isImporting ? 'loading' : initialLoadStatus,
    canManageContent && !isImporting,
    gamesMap,
    results,
    freezeState,
    totalAssignedPoints,
    autoUnfreezePrice
  );

  // ─── Handlers ─────────────────────────────────────────────
  const handleUpdateVoter = useCallback((updatedVoter: Voter) => {
    if (!canManageContent || isImportingRef.current) return;
    setVoters((prev) => prev.map((v) => (v.id === updatedVoter.id ? updatedVoter : v)));
  }, [canManageContent]);

  const {
    handleUpdateGame,
    handleAddGame,
    handleDeleteGame,
  } = useGameManagement({
    gamesMap,
    voters,
    setGamesMap,
    setVoters,
    canManageContent,
    isImportingRef,
    isPrecioCongelado: freezeState.isPrecioCongelado,
    autoUnfreezePrice,
    minGames: MIN_GAMES,
    maxGames: MAX_GAMES,
  });

  const { handleResetAllVotes, handleResetData } = useDashboardResetActions({
    canManageContent,
    isImportingRef,
    cancelPendingWritesAndDebounce,
    lastPersistedDashboardSignatureRef,
    lastPersistedApiKeyRef,
    setVoters,
    setGamesMap,
    setSteamApiKey,
    setHistory,
    setFreezeState,
    setSyncState,
  });

  const handleToggleEditMode = useCallback(() => {
    if (isImportingRef.current) return;
    if (!canManageContent) {
      // Desbloqueo asíncrono vía modal BottomSheet
      void requestAdminUnlockViaModal().then((unlocked) => {
        if (unlocked) {
          setIsEditMode((prev) => !prev);
        }
      });
      return;
    }

    setIsEditMode((prev) => !prev);
  }, [canManageContent, requestAdminUnlockViaModal]);

  const {
    handleConfirmFinishVoting,
    handleClearHistory,
    handleDeleteHistoryRecord,
    handleResetAllAura,
  } = useVotingHistoryActions({
    canManageContent,
    isImportingRef,
    saveDebounceRef,
    history,
    voters,
    gamesMap,
    freezeState,
    setVoters,
    setHistory,
    setFreezeState,
    setShowFinishModal,
    setShowResetAuraConfirm,
    setSyncState,
    lastPersistedDashboardSignatureRef,
  });

  const {
    handleExportBackup,
    handleImportClick,
    handleImportFileChange,
  } = useDashboardBackup({
    canManageContent,
    isImportingRef,
    setIsImporting,
    importFileInputRef,
    voters,
    gamesMap,
    history,
    steamApiKey,
    freezeState,
    setVoters,
    setGamesMap,
    setHistory,
    setSteamApiKey,
    setFreezeState,
    setSyncState,
    setVoterToDelete,
    setShowResetAuraConfirm,
    setShowFinishModal,
    cancelPendingWritesAndDebounce,
    lastPersistedDashboardSignatureRef,
    lastPersistedApiKeyRef,
  });



  // ─── Loading state ────────────────────────────────────────
  if (initialLoadStatus === 'loading') {
    return <DashboardSkeleton />;
  }

  // ─── Error state: No se pudo cargar la información inicial ───
  if (initialLoadStatus === 'error') {
    return (
      <InitialLoadErrorView
        syncState={syncState}
        errorMessage={initialLoadErrorMessage}
        onRetry={() => void handleRetryInitialLoad()}
      />
    );
  }

  // ─── Render principal ─────────────────────────────────────
  return (
    <div className="steam-dashboard-container">
      <div className="bg-gradient-overlay"></div>
      <div className="bg-grid-lines"></div>

      <SyncIndicator syncState={syncState} />

      <InstallPrompt />

      <DashboardGearButton
        canManageContent={canManageContent}
        isEditMode={isEditMode}
        isImporting={isImporting}
        onToggleEditMode={handleToggleEditMode}
      />

      <AdminSessionBadge adminAccess={adminAccess} onLogout={handleLogoutAdmin} />

      <DashboardTopActionNavigation
        canManageContent={canManageContent}
        hasWinner={hasWinner}
        isImporting={isImporting}
        onOpenFinishModal={() => {
          if (!canManageContent || isImporting) return;
          setShowFinishModal(true);
        }}
      />

      {/* Barra de edición */}
      <AnimatePresence>
        {canManageContent && isEditMode && (
          <EditModeTopBar
            voterCount={voters.length}
            maxVoters={MAX_VOTERS}
            steamApiKey={steamApiKey}
            onApiKeyChange={setSteamApiKey}
            onAddVoter={handleAddVoter}
            onExportBackup={handleExportBackup}
            onImportClick={handleImportClick}
            onImportFileChange={handleImportFileChange}
            importFileInputRef={importFileInputRef}
            isSaving={syncState.status === 'saving'}
            isImporting={isImporting}
            onResetAllVotes={handleResetAllVotes}
            onResetData={handleResetData}
            onOpenResetAuraConfirm={() => setShowResetAuraConfirm(true)}
            onCloseEditMode={() => setIsEditMode(false)}
          />
        )}
      </AnimatePresence>

      {/* Contenido principal */}
      <div className="dashboard-content">
        <Header isVotingInProgress={isLoading ? undefined : totalAssignedPoints === 0} />

        <AnimatePresence>
          {canManageContent && isEditMode && (
            <motion.div
              key="game-search-editor-view"
              initial={{ opacity: 0, y: -15, height: 0 }}
              animate={{ opacity: 1, y: 0, height: 'auto' }}
              exit={{ opacity: 0, y: -15, height: 0 }}
              transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            >
              <GameSearchEditor
                gamesMap={gamesMap}
                onUpdateGame={handleUpdateGame}
                onAddGame={handleAddGame}
                onDeleteGame={handleDeleteGame}
                minGames={MIN_GAMES}
                maxGames={MAX_GAMES}
                disabled={isImporting}
              />
            </motion.div>
          )}
        </AnimatePresence>

        <section className="voters-section">
          <div className="section-title-wrapper">
            <h2 className="section-title">
              <span className="title-icon">🎮</span> VOTACIONES DE PARTICIPANTES
            </h2>
            <span className="voter-count-badge">
              {voterCountBadgeText}
            </span>
          </div>

          <div className="user-cards-grid">
            <AnimatePresence mode="popLayout">
              {voters.map((voter, index) => (
                <UserCard
                  key={voter.id}
                  voter={voter}
                  gamesMap={gamesMap}
                  isEditMode={isEditMode}
                  apiKey={steamApiKey}
                  onUpdateVoter={handleUpdateVoter}
                  onRequestDelete={handleRequestDeleteVoter}
                  canDelete={voters.length > MIN_VOTERS}
                  disabled={isImporting}
                  {...getDragProps(index)}
                />
              ))}
            </AnimatePresence>
          </div>
        </section>

        <WinnerBanner
          results={results}
          votersCount={voters.length}
          totalAssignedPoints={totalAssignedPoints}
          isEditMode={isEditMode}
          canManageContent={canManageContent}
          isPrecioCongelado={freezeState.isPrecioCongelado}
          precioCongelado={freezeState.precioCongelado}
          descuentoCongelado={freezeState.descuentoCongelado}
          precioCongeladoFormatted={freezeState.precioCongeladoFormatted}
          onToggleFreezePrice={handleToggleFreezePrice}
          isFreezingLoading={isFreezingLoading || isImporting}
        />

        <DashboardHistoryFooterButton
          isImporting={isImporting}
          onOpenHistoryModal={() => setShowHistoryModal(true)}
        />

        <footer className="steam-footer">
          <p>© 2026 Steam Co-Op Game Voting • Diseñado con paleta oficial de Steam & Acentos Neón</p>
        </footer>
      </div>

      <DashboardModals
        showFinishModal={showFinishModal}
        hasWinner={hasWinner}
        results={results}
        voters={voters}
        freezeState={freezeState}
        onConfirmFinish={handleConfirmFinishVoting}
        onCloseFinishModal={() => setShowFinishModal(false)}
        showHistoryModal={showHistoryModal}
        history={history}
        onClearHistory={handleClearHistory}
        onDeleteHistoryRecord={handleDeleteHistoryRecord}
        onCloseHistoryModal={() => setShowHistoryModal(false)}
        canManageContent={canManageContent}
        voterToDelete={voterToDelete}
        onCancelDeleteVoter={handleCancelDeleteVoter}
        onConfirmDeleteVoter={handleConfirmDeleteVoter}
        showResetAuraConfirm={showResetAuraConfirm}
        onConfirmResetAura={handleResetAllAura}
        onCancelResetAura={() => setShowResetAuraConfirm(false)}
        showPinModal={showPinModal}
        onPinCancel={handlePinCancel}
        onPinSubmit={handlePinSubmit}
      />
    </div>
  );
};

export default SteamVotingDashboard;
