import React from 'react';
import { motion } from 'framer-motion';

export interface EditModeTopBarProps {
  voterCount: number;
  maxVoters?: number;
  steamApiKey: string;
  onApiKeyChange: (key: string) => void;
  onAddVoter: () => void;
  onExportBackup: () => void;
  onImportClick: () => void;
  onImportFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  importFileInputRef: React.RefObject<HTMLInputElement | null>;
  isSaving: boolean;
  isImporting?: boolean;
  onResetAllVotes: () => void;
  onResetData: () => void;
  onOpenResetAuraConfirm: () => void;
  onCloseEditMode: () => void;
}

const EditBarBadgeSection: React.FC<{ isImporting?: boolean }> = ({ isImporting = false }) => (
  <div className="edit-bar-left">
    <span className="edit-badge">
      {isImporting ? '⏳ IMPORTACIÓN EN CURSO' : '⚙️ MODO EDICIÓN ACTIVO'}
    </span>
    <span className="edit-help-text">
      {isImporting
        ? 'Restaurando y sincronizando datos desde el backup. Modificaciones bloqueadas temporalmente.'
        : 'Buscá juegos en Steam, edita perfiles y arrastrá tarjetas. Autoguardado activo.'}
    </span>
  </div>
);

const AddVoterButton: React.FC<{
  voterCount: number;
  maxVoters?: number;
  isImporting?: boolean;
  onAddVoter: () => void;
}> = ({ voterCount, maxVoters = 6, isImporting = false, onAddVoter }) => {
  const isMaxReached = voterCount >= maxVoters;
  const isDisabled = isMaxReached || isImporting;

  let title = 'Añadir nuevo integrante';
  if (isImporting) {
    title = 'Importación de backup en curso...';
  } else if (isMaxReached) {
    title = `Máximo de ${maxVoters} integrantes alcanzado (límite Steam Families)`;
  }

  return (
    <motion.button
      type="button"
      className="btn-add-voter"
      onClick={onAddVoter}
      disabled={isDisabled}
      title={title}
      whileHover={isDisabled ? {} : { scale: 1.03 }}
      whileTap={isDisabled ? {} : { scale: 0.97 }}
    >
      ➕ Añadir Integrante ({voterCount}/{maxVoters})
    </motion.button>
  );
};

const BackupControls: React.FC<{
  isSaving: boolean;
  isImporting?: boolean;
  onExportBackup: () => void;
  onImportClick: () => void;
  onImportFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  importFileInputRef: React.RefObject<HTMLInputElement | null>;
}> = ({
  isSaving,
  isImporting = false,
  onExportBackup,
  onImportClick,
  onImportFileChange,
  importFileInputRef,
}) => {
  const isImportDisabled = isSaving || isImporting;

  return (
    <div className="backup-btn-group">
      <motion.button
        type="button"
        className="btn-backup btn-export"
        onClick={onExportBackup}
        disabled={isImporting}
        title={isImporting ? 'Importación de backup en curso...' : 'Descargar backup completo en JSON'}
        whileHover={isImporting ? {} : { scale: 1.03 }}
        whileTap={isImporting ? {} : { scale: 0.97 }}
      >
        📥 Exportar Backup
      </motion.button>
      <motion.button
        type="button"
        className="btn-backup btn-import"
        onClick={onImportClick}
        disabled={isImportDisabled}
        title={isImporting ? 'Importando backup...' : 'Restaurar datos desde un archivo JSON'}
        whileHover={isImportDisabled ? {} : { scale: 1.03 }}
        whileTap={isImportDisabled ? {} : { scale: 0.97 }}
      >
        {isImporting ? '⏳ Importando...' : '📤 Importar Backup'}
      </motion.button>
      <input
        ref={importFileInputRef}
        type="file"
        accept=".json"
        onChange={onImportFileChange}
        disabled={isImporting}
        style={{ display: 'none' }}
      />
    </div>
  );
};

const EditBarActionButtons: React.FC<{
  isImporting?: boolean;
  onResetAllVotes: () => void;
  onResetData: () => void;
  onOpenResetAuraConfirm: () => void;
  onCloseEditMode: () => void;
}> = ({
  isImporting = false,
  onResetAllVotes,
  onResetData,
  onOpenResetAuraConfirm,
  onCloseEditMode,
}) => (
  <>
    <motion.button
      type="button"
      className="btn-reset-votes"
      onClick={onResetAllVotes}
      disabled={isImporting}
      title={
        isImporting
          ? 'Importación de backup en curso...'
          : 'Reiniciar a 0 puntos todos los votos de los integrantes para comenzar un nuevo ciclo de votación'
      }
      whileHover={isImporting ? {} : { scale: 1.03 }}
      whileTap={isImporting ? {} : { scale: 0.97 }}
    >
      🧹 Reiniciar Votos (Nuevo Ciclo)
    </motion.button>

    <motion.button
      type="button"
      className="btn-reset-data"
      onClick={onResetData}
      disabled={isImporting}
      title={isImporting ? 'Importación de backup en curso...' : 'Restablecer todos los datos'}
      whileHover={isImporting ? {} : { scale: 1.03 }}
      whileTap={isImporting ? {} : { scale: 0.97 }}
    >
      Restablecer
    </motion.button>

    <motion.button
      type="button"
      className="btn-reset-aura"
      onClick={onOpenResetAuraConfirm}
      disabled={isImporting}
      title={
        isImporting
          ? 'Importación de backup en curso...'
          : 'Restablece el Aura de todos los integrantes a Socio Regular (0 Cuotas, 1.0x)'
      }
      whileHover={isImporting ? {} : { scale: 1.03 }}
      whileTap={isImporting ? {} : { scale: 0.97 }}
    >
      🔄 Restablecer Aura
    </motion.button>

    <motion.button
      type="button"
      className="btn-save-edit"
      onClick={onCloseEditMode}
      disabled={isImporting}
      title={isImporting ? 'Importación de backup en curso...' : 'Guardar y cerrar modo edición'}
      whileHover={isImporting ? {} : { scale: 1.03 }}
      whileTap={isImporting ? {} : { scale: 0.97 }}
    >
      ✓ Guardar / Listo
    </motion.button>
  </>
);

export const EditModeTopBar: React.FC<EditModeTopBarProps> = ({
  voterCount,
  maxVoters = 6,
  steamApiKey,
  onApiKeyChange,
  onAddVoter,
  onExportBackup,
  onImportClick,
  onImportFileChange,
  importFileInputRef,
  isSaving,
  isImporting = false,
  onResetAllVotes,
  onResetData,
  onOpenResetAuraConfirm,
  onCloseEditMode,
}) => (
  <motion.div
    key="edit-mode-bar"
    className="edit-mode-top-bar"
    initial={{ opacity: 0, y: -20, height: 0 }}
    animate={{ opacity: 1, y: 0, height: 'auto' }}
    exit={{ opacity: 0, y: -20, height: 0 }}
    transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
  >
    <EditBarBadgeSection isImporting={isImporting} />

    <div className="edit-bar-controls">
      <AddVoterButton
        voterCount={voterCount}
        maxVoters={maxVoters}
        isImporting={isImporting}
        onAddVoter={onAddVoter}
      />

      <div className="api-key-input-container">
        <label htmlFor="steam-api-key-input">Steam Web API Key (opcional):</label>
        <input
          id="steam-api-key-input"
          type="password"
          placeholder="Clave API de Steam..."
          value={steamApiKey}
          onChange={(e) => onApiKeyChange(e.target.value)}
          className="api-key-input"
          disabled={isImporting}
        />
      </div>

      <BackupControls
        isSaving={isSaving}
        isImporting={isImporting}
        onExportBackup={onExportBackup}
        onImportClick={onImportClick}
        onImportFileChange={onImportFileChange}
        importFileInputRef={importFileInputRef}
      />

      <EditBarActionButtons
        isImporting={isImporting}
        onResetAllVotes={onResetAllVotes}
        onResetData={onResetData}
        onOpenResetAuraConfirm={onOpenResetAuraConfirm}
        onCloseEditMode={onCloseEditMode}
      />
    </div>
  </motion.div>
);

export default EditModeTopBar;
