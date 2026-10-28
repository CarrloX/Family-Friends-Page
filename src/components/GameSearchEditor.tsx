import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { Game } from '../types/voting';
import { searchSteamStore, fetchSteamGameDetails, formatCopPrice, type SteamSearchResultItem } from '../services/steamStoreApi';
import { GameThumbnail } from './GameThumbnail';

interface GameSearchEditorProps {
  gamesMap: Record<string, Game>;
  onUpdateGame: (gameId: string, newGame: Game) => void;
  onAddGame: () => void;
  onDeleteGame: (gameId: string) => void;
  minGames: number;
  maxGames: number;
  disabled?: boolean;
}

export const GameSearchEditor = ({
  gamesMap,
  onUpdateGame,
  onAddGame,
  onDeleteGame,
  minGames,
  maxGames,
  disabled = false,
}: GameSearchEditorProps) => {
  const gameIds = Object.keys(gamesMap);
  const gameCount = gameIds.length;
  const canAdd = gameCount < maxGames && !disabled;
  const canDelete = gameCount > minGames && !disabled;

  return (
    <div className="game-search-editor-container">
      <div className="editor-header-title">
        <h3>🎮 BÚSQUEDA Y EDICIÓN DE LOS {gameCount} JUEGOS DE LA VOTACIÓN</h3>
        <p>
          Buscá cualquier juego en la Tienda de Steam para autocompletar su portada, nombre y descripción oficial.
          Podés tener entre {minGames} y {maxGames} juegos propuestos.
        </p>
      </div>

      <div className="game-slots-grid">
        {gameIds.map((gameId, idx) => (
          <SingleGameSlotEditor
            key={gameId}
            slotIndex={idx + 1}
            gameId={gameId}
            game={gamesMap[gameId]}
            onUpdateGame={onUpdateGame}
            onDeleteGame={onDeleteGame}
            canDelete={canDelete}
            minGames={minGames}
            disabled={disabled}
          />
        ))}

        {canAdd ? (
          <motion.button
            type="button"
            className="btn-add-game-slot"
            onClick={onAddGame}
            disabled={disabled}
            whileHover={disabled ? {} : { scale: 1.03, y: -3 }}
            whileTap={disabled ? {} : { scale: 0.97 }}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: 'spring', stiffness: 300, damping: 25 }}
          >
            <span className="add-game-icon">➕</span>
            <span className="add-game-text">Agregar Juego</span>
            <span className="add-game-count">{gameCount}/{maxGames}</span>
          </motion.button>
        ) : (
          <motion.div
            className="game-slot-limit-card"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: 'spring', stiffness: 300, damping: 25 }}
          >
            <span className="limit-icon">🚫</span>
            <span className="limit-text">Máximo alcanzado</span>
            <span className="limit-subtext">Ya tenés {maxGames} juegos propuestos. Eliminá uno para agregar otro.</span>
            <span className="limit-count">{gameCount}/{maxGames}</span>
          </motion.div>
        )}
      </div>
    </div>
  );
};

const MAX_IMAGE_FILE_SIZE_BYTES = 2 * 1024 * 1024; // 2 MB

/**
 * Optimiza y redimensiona la imagen para reducir significativamente
 * el tamaño del Data URL antes de almacenarlo.
 */
function compressAndResizeImage(file: File, maxWidth = 600, maxHeight = 400, quality = 0.82): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;

        if (width > maxWidth || height > maxHeight) {
          const ratio = Math.min(maxWidth / width, maxHeight / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('No se pudo inicializar el contexto 2D del Canvas.'));
          return;
        }

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, width, height);

        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => reject(new Error('No se pudo procesar la imagen seleccionada.'));
      img.src = e.target?.result as string;
    };
    reader.onerror = () => reject(new Error('Error al leer el archivo.'));
    reader.readAsDataURL(file);
  });
}

/**
 * Valida que una URL introducida manualmente sea válida y use protocolos seguros (http, https o data:image).
 */
const allowedDataImagePattern = /^data:image\/(?:jpeg|jpg|png|webp|gif);/i;

function isValidImageUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (allowedDataImagePattern.test(trimmed)) return true;
  try {
    const url = new URL(trimmed);
    return url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Hook personalizado para aislar el estado de búsqueda de Steam, la prevención de condiciones
 * de carrera (race conditions), la cancelación HTTP y el manejo del dropdown en cada slot.
 */
function useSteamSlotSearch() {
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<SteamSearchResultItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);

  const dropdownRef = useRef<HTMLDivElement>(null);
  const requestIdRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  const handleSearchTermChange = (value: string) => {
    setSearchTerm(value);
    setFocusedIndex(-1);
    if (!value.trim() || value.trim().length < 2) {
      setSearchResults([]);
      setIsSearching(false);
      setShowDropdown(false);
    } else {
      setIsSearching(true);
    }
  };

  useEffect(() => {
    const cleanTerm = searchTerm.trim();
    const requestId = ++requestIdRef.current;

    if (cleanTerm.length < 2) {
      abortControllerRef.current?.abort();
      return;
    }

    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    const timer = window.setTimeout(async () => {
      try {
        const results = await searchSteamStore(cleanTerm, controller.signal);
        if (requestId !== requestIdRef.current) return;
        setSearchResults(results);
        setShowDropdown(true);
      } catch {
        if (requestId !== requestIdRef.current) return;
        setSearchResults([]);
        setShowDropdown(false);
      } finally {
        if (requestId === requestIdRef.current) {
          setIsSearching(false);
        }
      }
    }, 300);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [searchTerm]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const resetSearch = () => {
    setSearchTerm('');
    setSearchResults([]);
    setIsSearching(false);
    setShowDropdown(false);
    setFocusedIndex(-1);
  };

  return {
    searchTerm,
    searchResults,
    isSearching,
    showDropdown,
    setShowDropdown,
    focusedIndex,
    setFocusedIndex,
    dropdownRef,
    handleSearchTermChange,
    resetSearch,
  };
}

interface SingleGameSlotEditorProps {
  slotIndex: number;
  gameId: string;
  game: Game;
  onUpdateGame: (gameId: string, newGame: Game) => void;
  onDeleteGame: (gameId: string) => void;
  canDelete: boolean;
  minGames: number;
  disabled?: boolean;
}

/* ── Sub-componente: fila superior con badge y botón eliminar/bloqueo ── */
const SlotBadgeRow = ({ slotIndex, gameId, game, canDelete, isLoadingDetails, minGames, onDeleteGame, disabled = false }: {
  slotIndex: number;
  gameId: string;
  game: Game;
  canDelete: boolean;
  isLoadingDetails: boolean;
  minGames: number;
  onDeleteGame: (gameId: string) => void;
  disabled?: boolean;
}) => {
  let deleteButtonTitle = 'Quitar este juego de la votación';
  if (disabled) {
    deleteButtonTitle = 'Modificación bloqueada durante la importación';
  } else if (isLoadingDetails) {
    deleteButtonTitle = 'Esperá a que finalice la sincronización de detalles...';
  }

  return (
    <div className="slot-badge-row">
      <div className="slot-badge">Juego #{slotIndex}</div>
      {canDelete ? (
        <motion.button
          type="button"
          className={`btn-delete-game-slot ${isLoadingDetails || disabled ? 'disabled' : ''}`}
          onClick={() => !isLoadingDetails && !disabled && onDeleteGame(gameId)}
          disabled={isLoadingDetails || disabled}
          title={deleteButtonTitle}
          aria-label={`Eliminar juego ${game.title || slotIndex}`}
          whileHover={{ scale: isLoadingDetails || disabled ? 1 : 1.05 }}
          whileTap={{ scale: isLoadingDetails || disabled ? 1 : 0.92 }}
        >
          🗑️ Eliminar Juego
        </motion.button>
      ) : (
        <motion.button
          type="button"
          className="btn-delete-game-slot disabled"
          disabled
          title={`Deben quedar al menos ${minGames} juegos. Agregá un juego antes de eliminar.`}
          aria-label={`No se puede eliminar: mínimo ${minGames} juegos requeridos`}
        >
          🔒 Mínimo {minGames}
        </motion.button>
      )}
    </div>
  );
};

/* ── Sub-componente: previsualización de la portada y metadata ── */
const SlotPreview = ({ game, isLoadingDetails }: {
  game: Game;
  isLoadingDetails: boolean;
}) => (
  <div className={`slot-current-preview ${isLoadingDetails ? 'loading-details' : ''} ${game.isBundle ? 'is-bundle-slot-preview' : ''}`}>
    <GameThumbnail
      game={game}
      alt={game.title}
      className="slot-cover-thumb"
    />
    <div className="slot-preview-meta">
      <div className="slot-game-title">
        <span className="slot-title-text">{game.title || 'Seleccionar juego'}</span>
        {game.isBundle && (
          <span className="bundle-badge neon-pulse" title="Paquete Especial / Bundle Activo">
            📦 BUNDLE / PAQUETE
          </span>
        )}
        {isLoadingDetails && <span className="slot-loading-badge"> ⏳ Obteniendo detalles...</span>}
      </div>
      {game.isBundle && game.bundleDescription && (
        <div className="slot-bundle-desc-preview" title={game.bundleDescription}>
          🎁 {game.bundleDescription}
        </div>
      )}
      <div className="slot-game-desc-snippet">
        {isLoadingDetails ? 'Sincronizando precio y descripción oficial...' : (game.description || 'Sin descripción')}
      </div>
      {game.isBundle && game.price?.finalFormatted && (
        <div className="slot-bundle-price-pill">
          Precio Asignado: <strong>{game.price.finalFormatted}</strong>
          {game.price.discountPercent && game.price.discountPercent > 0 ? (
            <span className="bundle-pill-discount"> (-{game.price.discountPercent}%)</span>
          ) : null}
        </div>
      )}
    </div>
  </div>
);

/* ── Sub-componente: buscador + dropdown de resultados de Steam ── */
const SteamSearchSection = ({
  gameId, isLoadingDetails, searchTerm, searchResults, isSearching,
  showDropdown, focusedIndex, dropdownRef, setShowDropdown,
  handleSearchTermChange, handleKeyDown, handleSelectSteamGame,
  disabled = false,
}: {
  gameId: string;
  isLoadingDetails: boolean;
  searchTerm: string;
  searchResults: SteamSearchResultItem[];
  isSearching: boolean;
  showDropdown: boolean;
  focusedIndex: number;
  dropdownRef: React.RefObject<HTMLDivElement | null>;
  setShowDropdown: (v: boolean) => void;
  handleSearchTermChange: (v: string) => void;
  handleKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  handleSelectSteamGame: (item: SteamSearchResultItem) => void;
  disabled?: boolean;
}) => {
  let searchPlaceholder = 'Escribe para buscar (ej: Helldivers, Elden, Rust)...';
  if (disabled) {
    searchPlaceholder = 'Importación en curso...';
  } else if (isLoadingDetails) {
    searchPlaceholder = 'Obteniendo detalles del juego...';
  }

  return (
    <div className="slot-search-container" ref={dropdownRef}>
      <label htmlFor={`slot-search-input-${gameId}`} className="slot-label">🔍 Buscar en Steam Store:</label>
      <div className="search-input-wrapper">
        <input
          id={`slot-search-input-${gameId}`}
          type="text"
          role="combobox"
          className="slot-search-input"
          placeholder={searchPlaceholder}
          value={searchTerm}
          onChange={(e) => !disabled && handleSearchTermChange(e.target.value)}
          onKeyDown={(e) => !disabled && handleKeyDown(e)}
          onFocus={() => !disabled && searchResults.length > 0 && setShowDropdown(true)}
          disabled={isLoadingDetails || disabled}
          aria-autocomplete="list"
          aria-expanded={showDropdown && searchResults.length > 0}
          aria-controls={`steam-results-${gameId}`}
          aria-activedescendant={
            showDropdown && focusedIndex >= 0 && searchResults[focusedIndex]
              ? `steam-option-${gameId}-${searchResults[focusedIndex].id}`
              : undefined
          }
        />
        {(isSearching || isLoadingDetails) && (
          <span
            className="search-spinner"
            title={isLoadingDetails ? 'Obteniendo detalles de Steam...' : 'Buscando en Steam...'}
          >
            ⏳
          </span>
        )}
      </div>

      {/* STEAM STORE TYPEAHEAD DROPDOWN */}
      {showDropdown && searchResults.length > 0 && !disabled && (
        <div
          id={`steam-results-${gameId}`}
          className="steam-search-dropdown"
          role="listbox"
          aria-label="Resultados de búsqueda de Steam"
        >
          {searchResults.map((item, idx) => (
            <motion.div
              key={item.id}
              id={`steam-option-${gameId}-${item.id}`}
              role="option"
              tabIndex={-1}
              className={`dropdown-item-row ${idx === focusedIndex ? 'focused' : ''}`}
              aria-selected={idx === focusedIndex}
              onClick={() => handleSelectSteamGame(item)}
              whileHover={{ scale: 1.01, backgroundColor: 'rgba(102, 192, 244, 0.15)' }}
              whileTap={{ scale: 0.98 }}
            >
              <img src={item.tiny_image} alt={item.name} className="dropdown-item-thumb" loading="lazy" />
              <div className="dropdown-item-info">
                <span className="dropdown-item-title">{item.name}</span>
                <span className="dropdown-item-meta">
                  AppID: {item.id} • {item.price_formatted}
                </span>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
};

/* ── Sub-componente: campos manuales de edición (título, descripción, portada) ── */
const ManualEditControls = ({
  gameId, game, isLoadingDetails, customCoverUrl, uploadError,
  setCustomCoverUrl, handleTitleChange, handleDescriptionChange,
  handleApplyCustomCover, handleFileUpload, disabled = false,
}: {
  gameId: string;
  game: Game;
  isLoadingDetails: boolean;
  customCoverUrl: string;
  uploadError: string | null;
  setCustomCoverUrl: (v: string) => void;
  handleTitleChange: (v: string) => void;
  handleDescriptionChange: (v: string) => void;
  handleApplyCustomCover: () => void;
  handleFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  disabled?: boolean;
}) => {
  let fileUploadTitle = 'Subir imagen local (máx 2 MB)';
  if (disabled) {
    fileUploadTitle = 'Modificación bloqueada durante la importación';
  } else if (isLoadingDetails) {
    fileUploadTitle = 'Sincronizando con Steam...';
  }

  return (
    <div className="slot-manual-controls">
      <div className="manual-field">
        <label htmlFor={`manual-title-input-${gameId}`} className="manual-label">Editar Nombre Manual:</label>
        <input
          id={`manual-title-input-${gameId}`}
          type="text"
          className="manual-input"
          value={game.title || ''}
          onChange={(e) => handleTitleChange(e.target.value)}
          disabled={isLoadingDetails || disabled}
        />
      </div>

      <div className="manual-field">
        <label htmlFor={`desc-input-${gameId}`} className="manual-label">Editar Descripción Manual:</label>
        <textarea
          id={`desc-input-${gameId}`}
          className="manual-input manual-textarea"
          rows={3}
          value={game.description || ''}
          onChange={(e) => handleDescriptionChange(e.target.value)}
          placeholder="Descripción corta del juego..."
          disabled={isLoadingDetails || disabled}
        />
      </div>

      <div className="manual-field">
        <label htmlFor={`cover-url-input-${gameId}`} className="manual-label">Portada por URL / Archivo:</label>
        <div className="manual-cover-row">
          <input
            id={`cover-url-input-${gameId}`}
            type="text"
            className="manual-input small-input"
            placeholder="Pegar URL de portada..."
            value={customCoverUrl}
            onChange={(e) => setCustomCoverUrl(e.target.value)}
            disabled={isLoadingDetails || disabled}
          />
          <motion.button
            type="button"
            className={`btn-apply-cover ${isLoadingDetails || disabled ? 'disabled' : ''}`}
            onClick={() => !isLoadingDetails && !disabled && handleApplyCustomCover()}
            disabled={isLoadingDetails || disabled}
            whileHover={{ scale: isLoadingDetails || disabled ? 1 : 1.05 }}
            whileTap={{ scale: isLoadingDetails || disabled ? 1 : 0.95 }}
          >
            Ok
          </motion.button>
          <motion.label
            htmlFor={`file-cover-input-${gameId}`}
            className={`file-cover-btn ${isLoadingDetails || disabled ? 'disabled' : ''}`}
            title={fileUploadTitle}
            whileHover={{ scale: isLoadingDetails || disabled ? 1 : 1.05 }}
            whileTap={{ scale: isLoadingDetails || disabled ? 1 : 0.95 }}
          >
            <span>📁</span>
            <input
              id={`file-cover-input-${gameId}`}
              type="file"
              accept="image/*"
              onChange={handleFileUpload}
              disabled={isLoadingDetails || disabled}
            />
          </motion.label>
        </div>
        {uploadError && <div className="slot-upload-error">⚠️ {uploadError}</div>}
      </div>
    </div>
  );
};

/* ── Sub-componente: configuración de Bundle / Paquete Especial ── */
interface BundleConfigSectionProps {
  gameId: string;
  game: Game;
  onUpdateGame: (gameId: string, newGame: Game) => void;
  isLoadingDetails: boolean;
  disabled?: boolean;
}

const BundleConfigSection = ({
  gameId,
  game,
  onUpdateGame,
  isLoadingDetails,
  disabled = false,
}: BundleConfigSectionProps) => {
  const [bundleBannerInput, setBundleBannerInput] = useState('');
  const [bundleBannerError, setBundleBannerError] = useState<string | null>(null);

  const isBundle = Boolean(game.isBundle);

  const handleToggleBundle = (enabled: boolean) => {
    if (disabled || isLoadingDetails) return;
    onUpdateGame(gameId, {
      ...game,
      isBundle: enabled,
    });
  };

  const handleDescriptionChange = (desc: string) => {
    if (disabled || isLoadingDetails) return;
    onUpdateGame(gameId, {
      ...game,
      bundleDescription: desc,
    });
  };

  const handleFinalPriceChange = (valStr: string) => {
    if (disabled || isLoadingDetails) return;
    const finalNum = valStr === '' ? 0 : Math.max(0, Number(valStr));
    const currentInitial = game.price?.initial;
    const initialNum = currentInitial && currentInitial > finalNum ? currentInitial : finalNum;
    const discountPct = (initialNum > finalNum && initialNum > 0)
      ? Math.round(((initialNum - finalNum) / initialNum) * 100)
      : 0;

    onUpdateGame(gameId, {
      ...game,
      price: {
        isFree: finalNum === 0,
        currency: 'COP',
        final: finalNum,
        initial: initialNum,
        discountPercent: discountPct,
        finalFormatted: finalNum === 0 ? 'Gratis' : formatCopPrice(finalNum),
        initialFormatted: initialNum > finalNum ? formatCopPrice(initialNum) : undefined,
      },
    });
  };

  const handleOriginalPriceChange = (valStr: string) => {
    if (disabled || isLoadingDetails) return;
    const initialNum = valStr === '' ? (game.price?.final ?? 0) : Math.max(0, Number(valStr));
    const finalNum = game.price?.final ?? 0;
    const discountPct = (initialNum > finalNum && initialNum > 0)
      ? Math.round(((initialNum - finalNum) / initialNum) * 100)
      : 0;

    onUpdateGame(gameId, {
      ...game,
      price: {
        isFree: finalNum === 0,
        currency: 'COP',
        final: finalNum,
        initial: initialNum,
        discountPercent: discountPct,
        finalFormatted: finalNum === 0 ? 'Gratis' : formatCopPrice(finalNum),
        initialFormatted: initialNum > finalNum ? formatCopPrice(initialNum) : undefined,
      },
    });
  };

  const handleBundleUrlChange = (url: string) => {
    if (disabled || isLoadingDetails) return;
    onUpdateGame(gameId, {
      ...game,
      bundleUrl: url,
    });
  };

  const handleApplyBannerUrl = () => {
    if (disabled || isLoadingDetails) return;
    const trimmed = bundleBannerInput.trim();
    if (!trimmed) return;
    if (!isValidImageUrl(trimmed)) {
      setBundleBannerError('Ingresá una URL válida con protocolo https://');
      return;
    }
    setBundleBannerError(null);
    onUpdateGame(gameId, {
      ...game,
      bundleImage: trimmed,
    });
    setBundleBannerInput('');
  };

  const handleBannerFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (disabled || isLoadingDetails) return;
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    if (!file.type.startsWith('image/')) {
      setBundleBannerError('El archivo debe ser una imagen válida (JPG, PNG, WebP).');
      return;
    }
    if (file.size > MAX_IMAGE_FILE_SIZE_BYTES) {
      const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
      setBundleBannerError(`La imagen (${sizeMb} MB) supera el límite máximo de 2 MB.`);
      return;
    }
    try {
      setBundleBannerError(null);
      const optimizedDataUrl = await compressAndResizeImage(file);
      onUpdateGame(gameId, {
        ...game,
        bundleImage: optimizedDataUrl,
      });
    } catch {
      setBundleBannerError('Error al procesar y comprimir el banner.');
    }
  };

  const handleUseBaseImage = () => {
    if (disabled || isLoadingDetails) return;
    onUpdateGame(gameId, {
      ...game,
      bundleImage: undefined,
    });
  };

  return (
    <div className="bundle-config-section">
      <div className="bundle-toggle-header">
        <label className="bundle-switch-container" htmlFor={`bundle-toggle-${gameId}`}>
          <input
            id={`bundle-toggle-${gameId}`}
            type="checkbox"
            className="bundle-checkbox-input"
            checked={isBundle}
            onChange={(e) => handleToggleBundle(e.target.checked)}
            disabled={isLoadingDetails || disabled}
          />
          <span className="bundle-slider-track"></span>
          <span className="bundle-toggle-text">
            <span className="bundle-toggle-icon">📦</span>
            ¿Es un Bundle / Paquete Especial?
          </span>
        </label>
        {isBundle && (
          <span className="bundle-badge neon-pulse">BUNDLE ACTIVO</span>
        )}
      </div>

      <AnimatePresence>
        {isBundle && (
          <motion.div
            className="bundle-details-card"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.28, ease: 'easeOut' }}
          >
            {/* Texto descriptivo del paquete */}
            <div className="manual-field">
              <label htmlFor={`bundle-desc-${gameId}`} className="manual-label">
                📝 Contenido / Descripción del Paquete:
              </label>
              <input
                id={`bundle-desc-${gameId}`}
                type="text"
                className="manual-input"
                placeholder="Ej: Incluye Juego Base + Pase de Personajes / Paquete Doble"
                value={game.bundleDescription || ''}
                onChange={(e) => handleDescriptionChange(e.target.value)}
                disabled={isLoadingDetails || disabled}
              />
            </div>

            {/* Precio Fijo o en Oferta del Bundle */}
            <div className="bundle-pricing-grid">
              <div className="manual-field">
                <label htmlFor={`bundle-price-final-${gameId}`} className="manual-label">
                  💰 Precio Final / Promocional del Bundle (COP):
                </label>
                <input
                  id={`bundle-price-final-${gameId}`}
                  type="number"
                  min="0"
                  step="1000"
                  className="manual-input"
                  placeholder="Ej: 140000 (o 0 si es Gratis)"
                  value={game.price?.final !== undefined ? game.price.final : ''}
                  onChange={(e) => handleFinalPriceChange(e.target.value)}
                  disabled={isLoadingDetails || disabled}
                />
              </div>

              <div className="manual-field">
                <label htmlFor={`bundle-price-initial-${gameId}`} className="manual-label">
                  🏷️ Precio Regular / Tachado (COP, opcional):
                </label>
                <input
                  id={`bundle-price-initial-${gameId}`}
                  type="number"
                  min="0"
                  step="1000"
                  className="manual-input"
                  placeholder="Ej: 210000"
                  value={
                    game.price?.initial && game.price.initial > (game.price.final ?? 0)
                      ? game.price.initial
                      : ''
                  }
                  onChange={(e) => handleOriginalPriceChange(e.target.value)}
                  disabled={isLoadingDetails || disabled}
                />
              </div>
            </div>

            {game.price?.finalFormatted && (
              <div className="bundle-price-summary-pill">
                <span>Precio actual fijado: <strong>{game.price.finalFormatted}</strong></span>
                {game.price.discountPercent && game.price.discountPercent > 0 ? (
                  <span className="bundle-discount-tag">-{game.price.discountPercent}% OFF</span>
                ) : null}
              </div>
            )}

            {/* Banner del paquete vs imagen base */}
            <div className="manual-field">
              <label className="manual-label">🖼️ Imagen de portada del paquete:</label>
              <div className="bundle-cover-options">
                <button
                  type="button"
                  className={`bundle-cover-option-btn ${!game.bundleImage ? 'selected' : ''}`}
                  onClick={handleUseBaseImage}
                  disabled={isLoadingDetails || disabled}
                >
                  🕹️ Usar imagen oficial del juego base
                </button>
                <span className="bundle-cover-option-divider">o</span>
                <span className="bundle-cover-custom-hint">
                  {game.bundleImage ? '✨ Banner personalizado del paquete activo' : 'Vincular banner del paquete:'}
                </span>
              </div>

              <div className="manual-cover-row bundle-custom-cover-row">
                <input
                  type="text"
                  className="manual-input small-input"
                  placeholder="Pegar URL de banner del paquete (https://)..."
                  value={bundleBannerInput}
                  onChange={(e) => setBundleBannerInput(e.target.value)}
                  disabled={isLoadingDetails || disabled}
                />
                <motion.button
                  type="button"
                  className={`btn-apply-cover ${isLoadingDetails || disabled ? 'disabled' : ''}`}
                  onClick={handleApplyBannerUrl}
                  disabled={isLoadingDetails || disabled}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                >
                  Ok
                </motion.button>
                <motion.label
                  className={`file-cover-btn ${isLoadingDetails || disabled ? 'disabled' : ''}`}
                  title="Subir banner local (máx 2 MB)"
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                >
                  <span>📁</span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleBannerFileUpload}
                    disabled={isLoadingDetails || disabled}
                  />
                </motion.label>
              </div>
              {bundleBannerError && (
                <div className="slot-upload-error">⚠️ {bundleBannerError}</div>
              )}
            </div>

            {/* Enlace directo al Bundle en Steam Store */}
            <div className="manual-field">
              <label htmlFor={`bundle-url-${gameId}`} className="manual-label">
                🔗 Enlace al Bundle en Steam Store (opcional):
              </label>
              <input
                id={`bundle-url-${gameId}`}
                type="url"
                className="manual-input"
                placeholder="https://store.steampowered.com/bundle/..."
                value={game.bundleUrl || ''}
                onChange={(e) => handleBundleUrlChange(e.target.value)}
                disabled={isLoadingDetails || disabled}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

const SingleGameSlotEditor = ({
  slotIndex,
  gameId,
  game,
  onUpdateGame,
  onDeleteGame,
  canDelete,
  minGames,
  disabled = false,
}: SingleGameSlotEditorProps) => {
  const {
    searchTerm,
    searchResults,
    isSearching,
    showDropdown,
    setShowDropdown,
    focusedIndex,
    setFocusedIndex,
    dropdownRef,
    handleSearchTermChange,
    resetSearch,
  } = useSteamSlotSearch();

  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  const [customCoverUrl, setCustomCoverUrl] = useState('');
  const [uploadError, setUploadError] = useState<string | null>(null);
  const selectionRequestRef = useRef(0);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showDropdown || searchResults.length === 0) {
      if (e.key === 'ArrowDown' && searchResults.length > 0) {
        setShowDropdown(true);
        setFocusedIndex(0);
        e.preventDefault();
      }
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setFocusedIndex((prev) => (prev < searchResults.length - 1 ? prev + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setFocusedIndex((prev) => (prev > 0 ? prev - 1 : searchResults.length - 1));
    } else if (e.key === 'Enter') {
      if (focusedIndex >= 0 && focusedIndex < searchResults.length) {
        e.preventDefault();
        void handleSelectSteamGame(searchResults[focusedIndex]);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setShowDropdown(false);
      setFocusedIndex(-1);
    }
  };

  // Handle selecting a game from Steam Search results
  const handleSelectSteamGame = async (item: SteamSearchResultItem) => {
    if (disabled) return;
    const requestId = ++selectionRequestRef.current;
    setIsLoadingDetails(true);

    const effectiveInitialPrice = (game.isBundle && game.price?.final !== undefined)
      ? game.price
      : item.price;

    const baseGame: Game = {
      ...game,
      appId: item.id,
      title: item.name,
      coverImage: item.header_image,
      tinyCoverImage: item.tiny_image,
      genre: 'Juego de Steam',
      price: effectiveInitialPrice,
      description: 'Cargando descripción oficial de Steam...',
    };

    onUpdateGame(gameId, baseGame);
    resetSearch();

    // Fetch official details (genres, description, discount/price) from Steam AppDetails API
    try {
      const details = await fetchSteamGameDetails(item.id);
      if (requestId !== selectionRequestRef.current) return;
      const effectiveDetailsPrice = (baseGame.isBundle && baseGame.price?.final !== undefined)
        ? baseGame.price
        : (details.price || item.price);
      onUpdateGame(gameId, {
        ...baseGame,
        genre: details.genres || 'Juego de Steam',
        price: effectiveDetailsPrice,
        description: details.description || `Juego oficial de la Tienda de Steam (${item.name}).`,
      });
    } catch {
      if (requestId !== selectionRequestRef.current) return;
      onUpdateGame(gameId, {
        ...baseGame,
        description: `Juego oficial de la Tienda de Steam (${item.name}).`,
      });
    } finally {
      if (requestId === selectionRequestRef.current) {
        setIsLoadingDetails(false);
      }
    }
  };

  // Handle manual title edit
  const handleTitleChange = (newTitle: string) => {
    if (disabled) return;
    onUpdateGame(gameId, { ...game, title: newTitle });
  };

  // Handle manual description edit
  const handleDescriptionChange = (newDesc: string) => {
    if (disabled) return;
    onUpdateGame(gameId, { ...game, description: newDesc });
  };

  // Handle custom cover image URL with protocol validation
  const handleApplyCustomCover = () => {
    if (disabled) return;
    const trimmedUrl = customCoverUrl.trim();
    if (!trimmedUrl) return;

    if (!isValidImageUrl(trimmedUrl)) {
      setUploadError('Ingresá una URL de imagen válida con protocolo https://');
      return;
    }

    setUploadError(null);
    onUpdateGame(gameId, { ...game, coverImage: trimmedUrl });
    setCustomCoverUrl('');
  };

  // Handle local file image upload with size limit and Canvas optimization
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (disabled) return;
    const file = e.target.files?.[0];
    if (!file) return;

    // Resetear valor para permitir volver a cargar la misma imagen si fuera necesario
    e.target.value = '';

    if (!file.type.startsWith('image/')) {
      setUploadError('El archivo debe ser una imagen válida (JPG, PNG, WebP).');
      return;
    }

    if (file.size > MAX_IMAGE_FILE_SIZE_BYTES) {
      const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
      setUploadError(`La imagen (${sizeMb} MB) supera el límite máximo permitido de 2 MB.`);
      return;
    }

    try {
      setUploadError(null);
      const optimizedDataUrl = await compressAndResizeImage(file);
      onUpdateGame(gameId, {
        ...game,
        coverImage: optimizedDataUrl,
      });
    } catch {
      setUploadError('Ocurrió un error al procesar y comprimir la imagen.');
    }
  };

  return (
    <div className="game-slot-card">
      <SlotBadgeRow
        slotIndex={slotIndex}
        gameId={gameId}
        game={game}
        canDelete={canDelete}
        isLoadingDetails={isLoadingDetails}
        minGames={minGames}
        onDeleteGame={onDeleteGame}
        disabled={disabled}
      />

      <SlotPreview game={game} isLoadingDetails={isLoadingDetails} />

      <SteamSearchSection
        gameId={gameId}
        isLoadingDetails={isLoadingDetails}
        searchTerm={searchTerm}
        searchResults={searchResults}
        isSearching={isSearching}
        showDropdown={showDropdown}
        focusedIndex={focusedIndex}
        dropdownRef={dropdownRef}
        setShowDropdown={setShowDropdown}
        handleSearchTermChange={handleSearchTermChange}
        handleKeyDown={handleKeyDown}
        handleSelectSteamGame={handleSelectSteamGame}
        disabled={disabled}
      />

      <ManualEditControls
        gameId={gameId}
        game={game}
        isLoadingDetails={isLoadingDetails}
        customCoverUrl={customCoverUrl}
        uploadError={uploadError}
        setCustomCoverUrl={setCustomCoverUrl}
        handleTitleChange={handleTitleChange}
        handleDescriptionChange={handleDescriptionChange}
        handleApplyCustomCover={handleApplyCustomCover}
        handleFileUpload={handleFileUpload}
        disabled={disabled}
      />

      <BundleConfigSection
        gameId={gameId}
        game={game}
        onUpdateGame={onUpdateGame}
        isLoadingDetails={isLoadingDetails}
        disabled={disabled}
      />
    </div>
  );
};