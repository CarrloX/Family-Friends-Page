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
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<SteamSearchResultItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [customCoverUrl, setCustomCoverUrl] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);

  const handleSearchTermChange = (value: string) => {
    setSearchTerm(value);
    if (!value.trim() || value.trim().length < 2) {
      setSearchResults([]);
      setIsSearching(false);
    } else {
      setIsSearching(true);
    }
  };

  // Debounced Steam Store API search
  useEffect(() => {
    if (!searchTerm.trim() || searchTerm.trim().length < 2) {
      return;
    }

    const timer = setTimeout(async () => {
      const results = await searchSteamStore(searchTerm);
      setSearchResults(results);
      setIsSearching(false);
      setShowDropdown(true);
    }, 300);

    return () => clearTimeout(timer);
  }, [searchTerm]);

  // Click outside to close dropdown
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Handle selecting a game from Steam Search results
  const handleSelectSteamGame = async (item: SteamSearchResultItem) => {
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
    setSearchTerm('');
    setSearchResults([]);
    setIsSearching(false);
    setShowDropdown(false);

    // Fetch official details (genres, description, discount/price) from Steam AppDetails API
    const details = await fetchSteamGameDetails(item.id);
    onUpdateGame(gameId, {
      ...baseGame,
      genre: details.genres || 'Juego de Steam',
      price: details.price || item.price,
      description: details.description || `Juego oficial de la Tienda de Steam (${item.name}).`,
    });
  };

  // Handle manual title edit
  const handleTitleChange = (newTitle: string) => {
    onUpdateGame(gameId, { ...game, title: newTitle });
  };

  // Handle manual description edit
  const handleDescriptionChange = (newDesc: string) => {
    onUpdateGame(gameId, { ...game, description: newDesc });
  };

  // Handle custom cover image URL
  const handleApplyCustomCover = () => {
    if (customCoverUrl.trim()) {
      onUpdateGame(gameId, { ...game, coverImage: customCoverUrl.trim() });
      setCustomCoverUrl('');
    }
  };

  // Handle local file image upload
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
          onUpdateGame(gameId, {
            ...game,
            coverImage: event.target.result as string,
          });
        }
      };
      reader.readAsDataURL(file);
    }
  };

  return (
    <div className="game-slot-card">
      <div className="slot-badge-row">
        <div className="slot-badge">Juego #{slotIndex}</div>
        {canDelete ? (
          <motion.button
            type="button"
            className="btn-delete-game-slot"
            onClick={() => onDeleteGame(gameId)}
            title="Quitar este juego de la votación"
            aria-label={`Eliminar juego ${game?.title || slotIndex}`}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.92 }}
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

      <div className="slot-current-preview">
        <GameThumbnail
          game={game}
          alt={game?.title}
          className="slot-cover-thumb"
        />
        <div className="slot-preview-meta">
          <div className="slot-game-title">{game?.title || 'Seleccionar juego'}</div>
          <div className="slot-game-desc-snippet">{game?.description || 'Sin descripción'}</div>
        </div>
      </div>

      <div className="slot-search-container" ref={dropdownRef}>
        <label htmlFor="slot-search-input" className="slot-label">🔍 Buscar en Steam Store:</label>
        <div className="search-input-wrapper">
          <input
            id="slot-search-input"
            type="text"
            className="slot-search-input"
            placeholder="Escribe para buscar (ej: Helldivers, Elden, Rust)..."
            value={searchTerm}
            onChange={(e) => handleSearchTermChange(e.target.value)}
            onFocus={() => searchResults.length > 0 && setShowDropdown(true)}
          />
          {isSearching && <span className="search-spinner">⏳</span>}
        </div>

        {/* STEAM STORE TYPEAHEAD DROPDOWN */}
        {showDropdown && searchResults.length > 0 && (
          <div className="steam-search-dropdown">
            {searchResults.map((item) => (
              <motion.button
                key={item.id}
                type="button"
                className="dropdown-item-row"
                onClick={() => handleSelectSteamGame(item)}
                whileHover={{ scale: 1.01, backgroundColor: 'rgba(102, 192, 244, 0.15)' }}
                whileTap={{ scale: 0.98 }}
              >
                <img src={item.tiny_image} alt={item.name} className="dropdown-item-thumb" loading="eager" />
                <div className="dropdown-item-info">
                  <span className="dropdown-item-title">{item.name}</span>
                  <span className="dropdown-item-meta">
                    AppID: {item.id} • {item.price_formatted}
                  </span>
                </div>
              </motion.button>
            ))}
          </div>
        )}
      </div>

      {/* MANUAL FALLBACK EDITORS */}
      <div className="slot-manual-controls">
        <div className="manual-field">
          <label htmlFor="manual-title-input" className="manual-label">Editar Nombre Manual:</label>
          <input
            id="manual-title-input"
            type="text"
            className="manual-input"
            value={game?.title || ''}
            onChange={(e) => handleTitleChange(e.target.value)}
          />
        </div>

        <div className="manual-field">
          <label htmlFor="desc-input" className="manual-label">Editar Descripción Manual:</label>
          <input
            id="desc-input"
            type="text"
            className="manual-input"
            value={game?.description || ''}
            onChange={(e) => handleDescriptionChange(e.target.value)}
            placeholder="Descripción corta del juego..."
          />
        </div>

        <div className="manual-field">
          <label htmlFor="cover-url-input" className="manual-label">Portada por URL / Archivo:</label>
          <div className="manual-cover-row">
            <input
              id="cover-url-input"
              type="text"
              className="manual-input small-input"
              placeholder="Pegar URL de portada..."
              value={customCoverUrl}
              onChange={(e) => setCustomCoverUrl(e.target.value)}
            />
            <motion.button 
              type="button" 
              className="btn-apply-cover" 
              onClick={handleApplyCustomCover}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              Ok
            </motion.button>
            <motion.label 
              className="file-cover-btn" 
              title="Subir imagen local"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              <span>📁</span>
              <input type="file" accept="image/*" onChange={handleFileUpload} />
            </motion.label>
          </div>
        </div>
      </div>
    </div>
  );
};