import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import type { Game } from '../types/voting';
import { searchSteamStore, fetchSteamGameDetails, type SteamSearchResultItem } from '../services/steamStoreApi';
import { GameThumbnail } from './GameThumbnail';

interface GameSearchEditorProps {
  gamesMap: Record<string, Game>;
  onUpdateGame: (gameId: string, newGame: Game) => void;
  onAddGame: () => void;
  onDeleteGame: (gameId: string) => void;
  minGames: number;
  maxGames: number;
}

export const GameSearchEditor: React.FC<GameSearchEditorProps> = ({
  gamesMap,
  onUpdateGame,
  onAddGame,
  onDeleteGame,
  minGames,
  maxGames,
}) => {
  const gameIds = Object.keys(gamesMap);
  const gameCount = gameIds.length;
  const canAdd = gameCount < maxGames;
  const canDelete = gameCount > minGames;

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
          />
        ))}

        {canAdd ? (
          <motion.button
            type="button"
            className="btn-add-game-slot"
            onClick={onAddGame}
            whileHover={{ scale: 1.03, y: -3 }}
            whileTap={{ scale: 0.97 }}
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
function isValidImageUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('data:image/')) return true;
  try {
    const url = new URL(trimmed);
    return url.protocol === 'https:' || url.protocol === 'http:';
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
}

const SingleGameSlotEditor: React.FC<SingleGameSlotEditorProps> = ({
  slotIndex,
  gameId,
  game,
  onUpdateGame,
  onDeleteGame,
  canDelete,
  minGames,
}) => {
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
    const requestId = ++selectionRequestRef.current;
    setIsLoadingDetails(true);

    const baseGame: Game = {
      ...game,
      appId: item.id,
      title: item.name,
      coverImage: item.header_image,
      tinyCoverImage: item.tiny_image,
      genre: 'Juego de Steam',
      price: item.price,
      description: 'Cargando descripción oficial de Steam...',
    };

    onUpdateGame(gameId, baseGame);
    resetSearch();

    // Fetch official details (genres, description, discount/price) from Steam AppDetails API
    try {
      const details = await fetchSteamGameDetails(item.id);
      if (requestId !== selectionRequestRef.current) return;
      onUpdateGame(gameId, {
        ...baseGame,
        genre: details.genres || 'Juego de Steam',
        price: details.price || item.price,
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
    onUpdateGame(gameId, { ...game, title: newTitle });
  };

  // Handle manual description edit
  const handleDescriptionChange = (newDesc: string) => {
    onUpdateGame(gameId, { ...game, description: newDesc });
  };

  // Handle custom cover image URL with protocol validation
  const handleApplyCustomCover = () => {
    const trimmedUrl = customCoverUrl.trim();
    if (!trimmedUrl) return;

    if (!isValidImageUrl(trimmedUrl)) {
      setUploadError('Ingresá una URL de imagen válida con protocolo http:// o https://');
      return;
    }

    setUploadError(null);
    onUpdateGame(gameId, { ...game, coverImage: trimmedUrl });
    setCustomCoverUrl('');
  };

  // Handle local file image upload with size limit and Canvas optimization
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
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
      <div className="slot-badge-row">
        <div className="slot-badge">Juego #{slotIndex}</div>
        {canDelete ? (
          <motion.button
            type="button"
            className={`btn-delete-game-slot ${isLoadingDetails ? 'disabled' : ''}`}
            onClick={() => !isLoadingDetails && onDeleteGame(gameId)}
            disabled={isLoadingDetails}
            title={isLoadingDetails ? 'Esperá a que finalice la sincronización de detalles...' : 'Quitar este juego de la votación'}
            aria-label={`Eliminar juego ${game.title || slotIndex}`}
            whileHover={{ scale: isLoadingDetails ? 1 : 1.05 }}
            whileTap={{ scale: isLoadingDetails ? 1 : 0.92 }}
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

      <div className={`slot-current-preview ${isLoadingDetails ? 'loading-details' : ''}`}>
        <GameThumbnail
          game={game}
          alt={game.title}
          className="slot-cover-thumb"
        />
        <div className="slot-preview-meta">
          <div className="slot-game-title">
            {game.title || 'Seleccionar juego'}
            {isLoadingDetails && <span className="slot-loading-badge"> ⏳ Obteniendo detalles...</span>}
          </div>
          <div className="slot-game-desc-snippet">
            {isLoadingDetails ? 'Sincronizando precio y descripción oficial...' : (game.description || 'Sin descripción')}
          </div>
        </div>
      </div>

      <div className="slot-search-container" ref={dropdownRef}>
        <label htmlFor={`slot-search-input-${gameId}`} className="slot-label">🔍 Buscar en Steam Store:</label>
        <div className="search-input-wrapper">
          <input
            id={`slot-search-input-${gameId}`}
            type="text"
            role="combobox"
            className="slot-search-input"
            placeholder={
              isLoadingDetails
                ? 'Obteniendo detalles del juego...'
                : 'Escribe para buscar (ej: Helldivers, Elden, Rust)...'
            }
            value={searchTerm}
            onChange={(e) => handleSearchTermChange(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => searchResults.length > 0 && setShowDropdown(true)}
            disabled={isLoadingDetails}
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
        {showDropdown && searchResults.length > 0 && (
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

      {/* MANUAL FALLBACK EDITORS */}
      <div className="slot-manual-controls">
        <div className="manual-field">
          <label htmlFor={`manual-title-input-${gameId}`} className="manual-label">Editar Nombre Manual:</label>
          <input
            id={`manual-title-input-${gameId}`}
            type="text"
            className="manual-input"
            value={game.title || ''}
            onChange={(e) => handleTitleChange(e.target.value)}
            disabled={isLoadingDetails}
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
            disabled={isLoadingDetails}
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
              disabled={isLoadingDetails}
            />
            <motion.button 
              type="button" 
              className={`btn-apply-cover ${isLoadingDetails ? 'disabled' : ''}`}
              onClick={() => !isLoadingDetails && handleApplyCustomCover()}
              disabled={isLoadingDetails}
              whileHover={{ scale: isLoadingDetails ? 1 : 1.05 }}
              whileTap={{ scale: isLoadingDetails ? 1 : 0.95 }}
            >
              Ok
            </motion.button>
            <motion.label 
              htmlFor={`file-cover-input-${gameId}`}
              className={`file-cover-btn ${isLoadingDetails ? 'disabled' : ''}`}
              title={isLoadingDetails ? 'Sincronizando con Steam...' : 'Subir imagen local (máx 2 MB)'}
              whileHover={{ scale: isLoadingDetails ? 1 : 1.05 }}
              whileTap={{ scale: isLoadingDetails ? 1 : 0.95 }}
            >
              <span>📁</span>
              <input
                id={`file-cover-input-${gameId}`}
                type="file"
                accept="image/*"
                onChange={handleFileUpload}
                disabled={isLoadingDetails}
              />
            </motion.label>
          </div>
          {uploadError && <div className="slot-upload-error">⚠️ {uploadError}</div>}
        </div>
      </div>
    </div>
  );
};