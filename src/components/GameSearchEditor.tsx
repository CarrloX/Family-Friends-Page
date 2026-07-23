import React, { useState, useEffect, useRef } from 'react';
import type { Game } from '../types/voting';
import { searchSteamStore, fetchSteamGameDetails, type SteamSearchResultItem } from '../services/steamStoreApi';

interface GameSearchEditorProps {
  gamesMap: Record<string, Game>;
  onUpdateGame: (gameId: string, newGame: Game) => void;
}

export const GameSearchEditor: React.FC<GameSearchEditorProps> = ({ gamesMap, onUpdateGame }) => {
  const gameIds = Object.keys(gamesMap);

  return (
    <div className="game-search-editor-container">
      <div className="editor-header-title">
        <h3>🎮 BÚSQUEDA Y EDICIÓN DE LOS 4 JUEGOS DE LA VOTACIÓN</h3>
        <p>Buscá cualquier juego en la Tienda de Steam para autocompletar su portada, nombre y descripción oficial.</p>
      </div>

      <div className="game-slots-grid">
        {gameIds.map((gameId, idx) => (
          <SingleGameSlotEditor
            key={gameId}
            slotIndex={idx + 1}
            gameId={gameId}
            game={gamesMap[gameId]}
            onUpdateGame={onUpdateGame}
          />
        ))}
      </div>
    </div>
  );
};

interface SingleGameSlotEditorProps {
  slotIndex: number;
  gameId: string;
  game: Game;
  onUpdateGame: (gameId: string, newGame: Game) => void;
}

const SingleGameSlotEditor: React.FC<SingleGameSlotEditorProps> = ({
  slotIndex,
  gameId,
  game,
  onUpdateGame,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<SteamSearchResultItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [customCoverUrl, setCustomCoverUrl] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Debounced Steam Store API search
  useEffect(() => {
    if (!searchTerm.trim() || searchTerm.trim().length < 2) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
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
      genre: item.price_formatted || 'Juego de Steam',
      description: 'Cargando descripción oficial de Steam...',
    };

    onUpdateGame(gameId, baseGame);
    setSearchTerm('');
    setShowDropdown(false);

    // Fetch official short description from Steam AppDetails API
    const details = await fetchSteamGameDetails(item.id);
    if (details.description) {
      onUpdateGame(gameId, {
        ...baseGame,
        description: details.description,
      });
    } else {
      onUpdateGame(gameId, {
        ...baseGame,
        description: `Juego oficial de la Tienda de Steam (${item.name}).`,
      });
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
      <div className="slot-badge">Juego #{slotIndex}</div>

      <div className="slot-current-preview">
        <img
          src={game?.coverImage}
          alt={game?.title}
          className="slot-cover-thumb"
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
            onChange={(e) => setSearchTerm(e.target.value)}
            onFocus={() => searchResults.length > 0 && setShowDropdown(true)}
          />
          {isSearching && <span className="search-spinner">⏳</span>}
        </div>

        {/* STEAM STORE TYPEAHEAD DROPDOWN */}
        {showDropdown && searchResults.length > 0 && (
          <div className="steam-search-dropdown">
            {searchResults.map((item) => (
              <button
                key={item.id}
                type="button"
                className="dropdown-item-row"
                onClick={() => handleSelectSteamGame(item)}
              >
                <img src={item.tiny_image} alt={item.name} className="dropdown-item-thumb" />
                <div className="dropdown-item-info">
                  <span className="dropdown-item-title">{item.name}</span>
                  <span className="dropdown-item-meta">
                    AppID: {item.id} • {item.price_formatted}
                  </span>
                </div>
              </button>
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
            <button type="button" className="btn-apply-cover" onClick={handleApplyCustomCover}>
              Ok
            </button>
            <label className="file-cover-btn" title="Subir imagen local">
              <span>📁</span>
              <input type="file" accept="image/*" onChange={handleFileUpload} />
            </label>
          </div>
        </div>
      </div>
    </div>
  );
};
