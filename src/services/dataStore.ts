import {
  doc,
  getDoc,
  setDoc,
  collection,
  addDoc,
  getDocs,
  query,
  orderBy,
  Timestamp,
  deleteDoc,
  writeBatch,
  type Firestore,
  type QuerySnapshot,
} from 'firebase/firestore';
import { getFirestoreInstance, isFirebaseReady } from './firebaseConfig';
import { canManageContent } from './accessControl';
import type { Voter, Game, VotingHistoryRecord, FreezePriceState } from '../types/voting';
import { fixSteamCoverUrl } from '../utils/steamImages';
import { formatHistoryDate } from '../utils/formatDate';

// ============================================================
// Constantes para localStorage (fallback)
// ============================================================
const LS_KEY_VOTERS = 'steam_voting_voters_v1';
const LS_KEY_GAMES = 'steam_voting_games_v1';
const LS_KEY_HISTORY = 'steam_voting_history_v1';
const LS_KEY_API_KEY = 'steam_voting_api_key_v1';
const LS_KEY_ACTIVE_VOTING = 'steam_voting_active_state_v1';

// ============================================================
// Tipos de estado de sincronización
// ============================================================
export type SyncStatus = 'idle' | 'saving' | 'synced' | 'error' | 'local' | 'read-only';

export interface SyncState {
  status: SyncStatus;
  message: string;
}

// ============================================================
// Utilidades para localStorage
// ============================================================
function readLocal<T>(key: string, defaultValue: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return defaultValue;
    return JSON.parse(raw) as T;
  } catch {
    return defaultValue;
  }
}

function writeLocal<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    if (import.meta.env.DEV) {
      console.warn('[Store] Error en almacenamiento local:', err);
    }
  }
}

function removeLocal(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // ignorar
  }
}

function canWriteToPersistence(): boolean {
  if (typeof window === 'undefined') {
    return true;
  }
  return canManageContent();
}

function buildReadOnlyState(message = 'Solo lectura activa'): SyncState {
  return { status: 'read-only', message };
}

/**
 * Determina si un error de Firestore se debe a rechazo de autorización en el servidor
 * (código `permission-denied` o mensaje de permisos insuficientes).
 */
function isPermissionDeniedError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = 'code' in err ? String((err as { code?: unknown }).code) : '';
  const message = 'message' in err ? String((err as { message?: unknown }).message) : '';
  return (
    code === 'permission-denied' ||
    code === 'firestore/permission-denied' ||
    message.includes('insufficient permissions') ||
    message.includes('Missing or insufficient permissions')
  );
}

// ============================================================
// Colecciones de Firestore
// ============================================================
const COLLECTION_GROUP = 'grupo';
const DOC_MIEMBROS = 'miembros';
const COLLECTION_HISTORY = 'votaciones_pasadas';
const COLLECTION_ACTIVE_VOTING = 'votacion_actual';
const DOC_ACTIVE_VOTING = 'estado';

// ============================================================
// Interfaz del documento en Firestore para el grupo
// ============================================================
interface GrupoDocument {
  voters: Voter[];
  gamesMap: Record<string, Game>;
  /** Array dinámico de juegos propuestos en orden */
  games?: Game[];
  lastUpdated: Timestamp;
}

export const DEFAULT_FREEZE_STATE: FreezePriceState = {
  isPrecioCongelado: false,
  precioCongelado: null,
  descuentoCongelado: null,
  precioCongeladoFormatted: null,
  precioOriginalCongelado: null,
  precioOriginalCongeladoFormatted: null,
  congeladoAt: null,
  gameId: null,
};

interface ActiveVotingDocument {
  voters: Voter[];
  gamesMap: Record<string, Game>;
  /** Array dinámico de juegos propuestos en orden */
  games?: Game[];
  isPrecioCongelado?: boolean;
  precioCongelado?: number | null;
  descuentoCongelado?: number | null;
  precioCongeladoFormatted?: string | null;
  precioOriginalCongelado?: number | null;
  precioOriginalCongeladoFormatted?: string | null;
  congeladoAt?: string | null;
  congeladoGameId?: string | null;
  lastUpdated: Timestamp;
}

/**
 * Remueve recursivamente todas las propiedades con valor `undefined` de objetos y arrays
 * antes de enviarlos a Firestore, ya que Firebase rechaza cualquier documento con `undefined`:
 * "Unsupported field value: undefined".
 */
export function removeUndefinedDeep<T>(value: T): T {
  if (value === null || value === undefined) {
    return value;
  }
  if (value instanceof Timestamp) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => removeUndefinedDeep(item)) as unknown as T;
  }
  if (typeof value === 'object') {
    const cleanObj: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (v !== undefined) {
        cleanObj[k] = removeUndefinedDeep(v);
      }
    }
    return cleanObj as T;
  }
  return value;
}

// ============================================================
// Servicio de Persistencia
// ============================================================

/**
 * Maneja errores ocurridos durante la sincronización con Firestore.
 * Si es error de permisos retorna error informativo; de lo contrario ejecuta el guardado local y retorna estado offline.
 */
function handleSyncError(
  err: unknown,
  saveFallback: () => void,
  warnContext: string
): SyncState {
  if (isPermissionDeniedError(err)) {
    if (import.meta.env.DEV) {
      console.error('[Store] Operación denegada: permisos insuficientes.');
    }
    return { status: 'error', message: 'Permiso denegado por el servidor: requiere rol de administrador' };
  }
  if (import.meta.env.DEV) {
    console.warn(`[Store] ${warnContext}:`, err);
  }
  saveFallback();
  return { status: 'local', message: 'Guardado localmente (sin conexión)' };
}

// ============================================================
// Coordinador Centralizado de Persistencia y Concurrencia
// ============================================================
let currentBarrierEpoch = 0;
let writeQueue: Promise<SyncState> = Promise.resolve({ status: 'idle', message: '' });

/**
 * Invalida cualquier escritura en curso o encolada para evitar que sobrescriba
 * operaciones críticas posteriores (como finalizar votación, reiniciar o restaurar datos).
 */
export function invalidatePendingWrites(): void {
  currentBarrierEpoch++;
}

/**
 * Ejecuta una operación de escritura asegurando:
 * 1. Orden secuencial estricto (FIFO) mediante cola de promesas.
 * 2. Invalidador de épocas (barrier epoch) para descartar escrituras obsoletas.
 * 3. Captura homogénea de excepciones no controladas.
 */
export async function executeCoordinatedWrite(
  writeFn: () => Promise<SyncState>,
  options?: { isBarrier?: boolean }
): Promise<SyncState> {
  const epoch = options?.isBarrier ? ++currentBarrierEpoch : currentBarrierEpoch;

  const task = writeQueue.then(async (): Promise<SyncState> => {
    // Si la época avanzó antes de iniciar la ejecución, descartar
    if (epoch < currentBarrierEpoch) {
      if (import.meta.env.DEV) {
        console.warn(`[Store] Escritura omitida por época obsoleta (${epoch} < ${currentBarrierEpoch}).`);
      }
      return { status: 'idle', message: 'Operación cancelada por acción posterior' };
    }

    try {
      const res = await writeFn();
      // Si la época avanzó durante la ejecución de la función, descartar el resultado
      if (epoch < currentBarrierEpoch) {
        if (import.meta.env.DEV) {
          console.warn(`[Store] Resultado de escritura descartado por época obsoleta (${epoch} < ${currentBarrierEpoch}).`);
        }
        return { status: 'idle', message: 'Operación descartada por acción posterior' };
      }
      return res;
    } catch (err) {
      if (epoch < currentBarrierEpoch) {
        return { status: 'idle', message: 'Operación obsoleta' };
      }
      if (import.meta.env.DEV) {
        console.error('[Store] Excepción no controlada en escritura coordinada:', err);
      }
      return { status: 'error', message: 'Error inesperado durante la sincronización' };
    }
  });

  // Mantener la cola funcional incluso si una promesa previa falló
  writeQueue = task.catch((): SyncState => ({ status: 'error', message: 'Error en cola de persistencia' }));
  return task;
}

/**
 * Guarda la lista de votantes. Prioriza Firestore, fallback a localStorage.
 * Coordinado a través de la cola secuencial.
 */
export async function saveVoters(voters: Voter[]): Promise<SyncState> {
  return executeCoordinatedWrite(async () => {
    if (!canWriteToPersistence()) {
      return buildReadOnlyState();
    }

    if (isFirebaseReady()) {
      try {
        const db = getFirestoreInstance()!;
        const docRef = doc(db, COLLECTION_GROUP, DOC_MIEMBROS);
        const payload = removeUndefinedDeep({ voters, lastUpdated: Timestamp.now() });
        await setDoc(docRef, payload, { merge: true });
        if (import.meta.env.DEV) {
          console.log('[Store] Datos sincronizados correctamente.');
        }
        return { status: 'synced', message: 'Sincronizado con la nube' };
      } catch (err) {
        return handleSyncError(err, () => writeLocal(LS_KEY_VOTERS, voters), 'Error de sincronización, usando almacenamiento local');
      }
    }
    writeLocal(LS_KEY_VOTERS, voters);
    return { status: 'local', message: 'Guardado localmente' };
  });
}

/**
 * Guarda el estado activo de la votación actual en Firestore y localStorage de forma atómica y coordinada.
 * Actualiza tanto la votación activa como el consolidado de grupo (miembros y catálogo) en un único writeBatch.
 */
export async function saveActiveVotingState(
  voters: Voter[],
  gamesMap: Record<string, Game>,
  freezeState?: FreezePriceState
): Promise<SyncState> {
  return executeCoordinatedWrite(async () => {
    if (!canWriteToPersistence()) {
      return buildReadOnlyState();
    }

    // Array dinámico de juegos derivado del mapa (preserva el orden)
    const games = Object.values(gamesMap);
    const freezeData = freezeState
      ? {
          isPrecioCongelado: Boolean(freezeState.isPrecioCongelado),
          precioCongelado: freezeState.precioCongelado ?? null,
          descuentoCongelado: freezeState.descuentoCongelado ?? null,
          precioCongeladoFormatted: freezeState.precioCongeladoFormatted ?? null,
          precioOriginalCongelado: freezeState.precioOriginalCongelado ?? null,
          precioOriginalCongeladoFormatted: freezeState.precioOriginalCongeladoFormatted ?? null,
          congeladoAt: freezeState.congeladoAt ?? null,
          congeladoGameId: freezeState.gameId ?? null,
        }
      : {};

    const cleanVoters = removeUndefinedDeep(voters);
    const cleanGamesMap = removeUndefinedDeep(gamesMap);
    const cleanGames = removeUndefinedDeep(games);

    const saveLocal = () => {
      writeLocal(LS_KEY_VOTERS, cleanVoters);
      writeLocal(LS_KEY_GAMES, cleanGamesMap);
      writeLocal(LS_KEY_ACTIVE_VOTING, {
        voters: cleanVoters,
        gamesMap: cleanGamesMap,
        games: cleanGames,
        ...freezeData,
      });
    };

    if (isFirebaseReady()) {
      try {
        const db = getFirestoreInstance()!;
        const batch = writeBatch(db);

        // 1. Documento de votación activa
        const activeDocRef = doc(db, COLLECTION_ACTIVE_VOTING, DOC_ACTIVE_VOTING);
        batch.set(
          activeDocRef,
          removeUndefinedDeep({
            voters: cleanVoters,
            gamesMap: cleanGamesMap,
            games: cleanGames,
            ...freezeData,
            lastUpdated: Timestamp.now(),
          }),
          { merge: true }
        );

        // 2. Documento consolidado del grupo (miembros y catálogo)
        const groupDocRef = doc(db, COLLECTION_GROUP, DOC_MIEMBROS);
        batch.set(
          groupDocRef,
          removeUndefinedDeep({
            voters: cleanVoters,
            gamesMap: cleanGamesMap,
            games: cleanGames,
            lastUpdated: Timestamp.now(),
          }),
          { merge: true }
        );

        await batch.commit();
        saveLocal();

        if (import.meta.env.DEV) {
          console.log('[Store] Estado de sesión y grupo sincronizados atómicamente.');
        }
        return { status: 'synced', message: 'Votación actual sincronizada' };
      } catch (err) {
        return handleSyncError(
          err,
          saveLocal,
          'Error de sincronización, usando almacenamiento local'
        );
      }
    }

    // Modo de desarrollo local / sin backend configurado: persistencia confinada a localStorage
    saveLocal();
    return { status: 'local', message: 'Votación actual guardada localmente' };
  });
}

/**
 * Guarda de forma inmediata y directa el estado de precio congelado en Firestore y localStorage.
 * Coordinado a través de la cola secuencial.
 */
export async function saveFreezePriceState(freezeState: FreezePriceState): Promise<SyncState> {
  return executeCoordinatedWrite(async () => {
    if (!canWriteToPersistence()) {
      return buildReadOnlyState();
    }

    const payload = removeUndefinedDeep({
      isPrecioCongelado: freezeState.isPrecioCongelado,
      precioCongelado: freezeState.precioCongelado ?? null,
      descuentoCongelado: freezeState.descuentoCongelado ?? null,
      precioCongeladoFormatted: freezeState.precioCongeladoFormatted ?? null,
      precioOriginalCongelado: freezeState.precioOriginalCongelado ?? null,
      precioOriginalCongeladoFormatted: freezeState.precioOriginalCongeladoFormatted ?? null,
      congeladoAt: freezeState.congeladoAt ?? new Date().toISOString(),
      congeladoGameId: freezeState.gameId ?? null,
      lastUpdated: Timestamp.now(),
    });

    const saveLocal = () => {
      const cached = readLocal<Record<string, unknown>>(LS_KEY_ACTIVE_VOTING, {});
      writeLocal(LS_KEY_ACTIVE_VOTING, { ...cached, ...payload });
    };

    if (isFirebaseReady()) {
      try {
        const db = getFirestoreInstance()!;
        const docRef = doc(db, COLLECTION_ACTIVE_VOTING, DOC_ACTIVE_VOTING);
        await setDoc(docRef, payload, { merge: true });
        saveLocal();
        if (import.meta.env.DEV) {
          console.log('[Store] Estado de precio congelado sincronizado en Firestore.');
        }
        return { status: 'synced', message: 'Precio congelado guardado en la nube' };
      } catch (err) {
        return handleSyncError(err, saveLocal, 'Error al guardar precio congelado, usando almacenamiento local');
      }
    }

    saveLocal();
    return { status: 'local', message: 'Precio congelado guardado localmente' };
  });
}

/**
 * Descongela el precio y limpia los campos de oferta congelada en Firestore y localStorage.
 * Coordinado a través de la cola secuencial.
 */
export async function unfreezePriceState(): Promise<SyncState> {
  return executeCoordinatedWrite(async () => {
    if (!canWriteToPersistence()) {
      return buildReadOnlyState();
    }

    const payload = {
      isPrecioCongelado: false,
      precioCongelado: null,
      descuentoCongelado: null,
      precioCongeladoFormatted: null,
      precioOriginalCongelado: null,
      precioOriginalCongeladoFormatted: null,
      congeladoAt: null,
      congeladoGameId: null,
      lastUpdated: Timestamp.now(),
    };

    const saveLocal = () => {
      const cached = readLocal<Record<string, unknown>>(LS_KEY_ACTIVE_VOTING, {});
      writeLocal(LS_KEY_ACTIVE_VOTING, { ...cached, ...payload });
    };

    if (isFirebaseReady()) {
      try {
        const db = getFirestoreInstance()!;
        const docRef = doc(db, COLLECTION_ACTIVE_VOTING, DOC_ACTIVE_VOTING);
        await setDoc(docRef, payload, { merge: true });
        saveLocal();
        if (import.meta.env.DEV) {
          console.log('[Store] Precio descongelado en Firestore.');
        }
        return { status: 'synced', message: 'Precio descongelado en la nube' };
      } catch (err) {
        return handleSyncError(err, saveLocal, 'Error al descongelar precio, usando almacenamiento local');
      }
    }

    saveLocal();
    return { status: 'local', message: 'Precio descongelado localmente' };
  });
}

export function sanitizeGame(game: Game): Game {
  if (!game) return game;
  let cleanGenre = game.genre || '';
  if (/actualizar|modo\s*edici[oó]n/i.test(cleanGenre)) {
    cleanGenre = 'Juego de Steam';
  }
  const cleanCover = fixSteamCoverUrl(game.coverImage, game.appId);
  const base: Game = {
    ...game,
    genre: cleanGenre,
    coverImage: cleanCover || game.coverImage,
  };
  return removeUndefinedDeep(base);
}

export function sanitizeGamesMap(map: Record<string, Game>): Record<string, Game> {
  const result: Record<string, Game> = {};
  for (const [key, g] of Object.entries(map || {})) {
    if (g) result[key] = sanitizeGame(g);
  }
  return result;
}

function parseExactIsoString(val: unknown): string | null {
  if (typeof val === 'string' && !Number.isNaN(Date.parse(val))) {
    return val;
  }
  return null;
}

function parseTimestampLike(val: unknown): string | null {
  if (val && typeof (val as { toDate?: () => Date }).toDate === 'function') {
    return (val as { toDate: () => Date }).toDate().toISOString();
  }
  return null;
}

function parseIdTimestamp(id?: string): string | null {
  if (!id?.startsWith('voting_')) return null;
  const rawSuffix = id.replace('voting_', '');
  const timestampMs = Number.parseInt(rawSuffix, 10);
  if (!Number.isNaN(timestampMs) && timestampMs > 0) {
    return new Date(timestampMs).toISOString();
  }
  return null;
}

function parseIsoOrDateString(val: unknown): string | null {
  if (typeof val !== 'string') return null;
  const parsed = Date.parse(val);
  return !Number.isNaN(parsed) ? new Date(parsed).toISOString() : null;
}

export function resolveCanonicalCreatedAt(
  record: { id?: string; date?: string; createdAt?: unknown; savedAt?: unknown }
): string {
  return (
    parseExactIsoString(record.createdAt) ??
    parseTimestampLike(record.createdAt) ??
    parseTimestampLike(record.savedAt) ??
    parseIdTimestamp(record.id) ??
    parseIsoOrDateString(record.date) ??
    new Date().toISOString()
  );
}

export function sanitizeVotingHistoryRecord(
  record: VotingHistoryRecord & { createdAt?: unknown; savedAt?: unknown }
): VotingHistoryRecord {
  if (!record) return record;
  const createdAt = resolveCanonicalCreatedAt(record);
  const formattedDate = formatHistoryDate(createdAt);

  const resultsSnapshot = Array.isArray(record.resultsSnapshot)
    ? record.resultsSnapshot.map((r) => ({
        ...r,
        game: sanitizeGame(r.game),
      }))
    : [];

  const candidateGame = record.winningGame ?? resultsSnapshot[0]?.game ?? record.games?.[0];
  const winningGame = sanitizeGame(candidateGame as Game);

  const cleanRecord: VotingHistoryRecord = {
    ...record,
    createdAt,
    date: record.date || formattedDate,
    winningGame,
    resultsSnapshot,
    votersSnapshots: Array.isArray(record.votersSnapshots) ? record.votersSnapshots : [],
  };

  // resultsSnapshot es la única fuente de verdad para los juegos de la votación.
  // Prescindimos de las propiedades redundantes gamesMap y games para evitar inconsistencias.
  if (resultsSnapshot.length > 0) {
    delete (cleanRecord as Partial<VotingHistoryRecord>).gamesMap;
    delete (cleanRecord as Partial<VotingHistoryRecord>).games;
  } else if (record.gamesMap) {
    cleanRecord.gamesMap = sanitizeGamesMap(record.gamesMap);
  }

  return cleanRecord;
}

export interface ActiveVotingStateResult {
  voters: Voter[];
  gamesMap: Record<string, Game>;
  games?: Game[];
  freezeState: FreezePriceState;
}

function parseActiveVotingData(data: ActiveVotingDocument): ActiveVotingStateResult | null {
  if (!Array.isArray(data.voters) || !data.gamesMap || typeof data.gamesMap !== 'object') {
    return null;
  }
  const cleanGamesMap = sanitizeGamesMap(data.gamesMap);
  const games = Array.isArray(data.games) && data.games.length > 0
    ? data.games.map(sanitizeGame)
    : Object.values(cleanGamesMap);

  const freezeState: FreezePriceState = {
    isPrecioCongelado: Boolean(data.isPrecioCongelado),
    precioCongelado: typeof data.precioCongelado === 'number' ? data.precioCongelado : null,
    descuentoCongelado: typeof data.descuentoCongelado === 'number' ? data.descuentoCongelado : null,
    precioCongeladoFormatted: typeof data.precioCongeladoFormatted === 'string' ? data.precioCongeladoFormatted : null,
    precioOriginalCongelado: typeof data.precioOriginalCongelado === 'number' ? data.precioOriginalCongelado : null,
    precioOriginalCongeladoFormatted: typeof data.precioOriginalCongeladoFormatted === 'string' ? data.precioOriginalCongeladoFormatted : null,
    congeladoAt: typeof data.congeladoAt === 'string' ? data.congeladoAt : null,
    gameId: typeof data.congeladoGameId === 'string' ? data.congeladoGameId : null,
  };

  return { voters: data.voters, gamesMap: cleanGamesMap, games, freezeState };
}

async function fetchFirestoreActiveVoting(): Promise<ActiveVotingStateResult | null> {
  if (!isFirebaseReady()) return null;

  try {
    const db = getFirestoreInstance()!;
    const docRef = doc(db, COLLECTION_ACTIVE_VOTING, DOC_ACTIVE_VOTING);
    const snap = await getDoc(docRef);
    if (!snap.exists()) return null;

    const parsed = parseActiveVotingData(snap.data() as ActiveVotingDocument);
    if (parsed) {
      writeLocal(LS_KEY_ACTIVE_VOTING, parsed);
    }
    return parsed;
  } catch (err) {
    if (import.meta.env.DEV) {
      console.warn('[Store] Error cargando estado de sesión remoto:', err);
    }
    return null;
  }
}

function loadCachedActiveVoting(): ActiveVotingStateResult | null {
  const cached = readLocal<ActiveVotingDocument | null>(LS_KEY_ACTIVE_VOTING, null);
  if (!cached || !Array.isArray(cached.voters) || !cached.gamesMap) return null;

  const cleanGamesMap = sanitizeGamesMap(cached.gamesMap);
  const games = cached.games ? cached.games.map(sanitizeGame) : Object.values(cleanGamesMap);

  const freezeState: FreezePriceState = {
    isPrecioCongelado: Boolean(cached.isPrecioCongelado),
    precioCongelado: typeof cached.precioCongelado === 'number' ? cached.precioCongelado : null,
    descuentoCongelado: typeof cached.descuentoCongelado === 'number' ? cached.descuentoCongelado : null,
    precioCongeladoFormatted: typeof cached.precioCongeladoFormatted === 'string' ? cached.precioCongeladoFormatted : null,
    precioOriginalCongelado: typeof cached.precioOriginalCongelado === 'number' ? cached.precioOriginalCongelado : null,
    precioOriginalCongeladoFormatted: typeof cached.precioOriginalCongeladoFormatted === 'string' ? cached.precioOriginalCongeladoFormatted : null,
    congeladoAt: typeof cached.congeladoAt === 'string' ? cached.congeladoAt : null,
    gameId: typeof cached.congeladoGameId === 'string' ? cached.congeladoGameId : null,
  };

  return { voters: cached.voters, gamesMap: cleanGamesMap, games, freezeState };
}

/**
 * Carga el estado activo de la votación desde Firestore o localStorage.
 */
export async function loadActiveVotingState(): Promise<ActiveVotingStateResult | null> {
  const firestoreState = await fetchFirestoreActiveVoting();
  if (firestoreState) {
    return firestoreState;
  }
  return loadCachedActiveVoting();
}

async function fetchFirestoreVoters(): Promise<Voter[] | null> {
  if (!isFirebaseReady()) return null;

  try {
    const db = getFirestoreInstance()!;
    const docRef = doc(db, COLLECTION_GROUP, DOC_MIEMBROS);
    const snap = await getDoc(docRef);
    if (!snap.exists()) return null;

    const data = snap.data() as GrupoDocument;
    if (Array.isArray(data.voters) && data.voters.length > 0) {
      if (import.meta.env.DEV) {
        console.log('[Store] Datos de participantes recuperados.');
      }
      writeLocal(LS_KEY_VOTERS, data.voters);
      return data.voters;
    }
  } catch (err) {
    if (import.meta.env.DEV) {
      console.warn('[Store] Error recuperando participantes remotos:', err);
    }
  }

  return null;
}

/**
 * Carga la lista de votantes. Prioriza la votación activa en Firestore, fallback a la colección de grupo y localStorage.
 */
export async function loadVoters(): Promise<Voter[]> {
  const activeVoting = await loadActiveVotingState();
  if (activeVoting?.voters) {
    return activeVoting.voters;
  }

  const firestoreVoters = await fetchFirestoreVoters();
  if (firestoreVoters) {
    return firestoreVoters;
  }

  return readLocal<Voter[]>(LS_KEY_VOTERS, []);
}

/**
 * Guarda el mapa de juegos. Prioriza Firestore, fallback a localStorage.
 * Coordinado a través de la cola secuencial.
 */
export async function saveGames(gamesMap: Record<string, Game>): Promise<SyncState> {
  return executeCoordinatedWrite(async () => {
    if (!canWriteToPersistence()) {
      return buildReadOnlyState();
    }

    // Array dinámico de juegos derivado del mapa
    const games = Object.values(gamesMap);

    if (isFirebaseReady()) {
      try {
        const db = getFirestoreInstance()!;
        const docRef = doc(db, COLLECTION_GROUP, DOC_MIEMBROS);
        const payload = removeUndefinedDeep({
          gamesMap,
          games,
          lastUpdated: Timestamp.now(),
        });
        await setDoc(docRef, payload, { merge: true });
        if (import.meta.env.DEV) {
          console.log('[Store] Catálogo sincronizado correctamente.');
        }
        return { status: 'synced', message: 'Sincronizado con la nube' };
      } catch (err) {
        return handleSyncError(err, () => writeLocal(LS_KEY_GAMES, gamesMap), 'Error sincronizando catálogo, usando almacenamiento local');
      }
    }
    writeLocal(LS_KEY_GAMES, gamesMap);
    return { status: 'local', message: 'Guardado localmente' };
  });
}

/**
 * Carga el mapa de juegos. Prioriza la votación activa en Firestore, fallback a la colección de grupo y localStorage.
 */
async function fetchFirestoreGames(): Promise<Record<string, Game> | null> {
  if (!isFirebaseReady()) return null;

  try {
    const db = getFirestoreInstance()!;
    const docRef = doc(db, COLLECTION_GROUP, DOC_MIEMBROS);
    const snap = await getDoc(docRef);
    if (!snap.exists()) return null;

    const data = snap.data() as GrupoDocument;
    if (data.gamesMap && typeof data.gamesMap === 'object') {
      if (import.meta.env.DEV) {
        console.log('[Store] Catálogo recuperado.');
      }
      const cleanMap = sanitizeGamesMap(data.gamesMap);
      writeLocal(LS_KEY_GAMES, cleanMap);
      return cleanMap;
    }
    // Fallback: si solo existe el array `games`, reconstruir el mapa
    if (Array.isArray(data.games)) {
      const rebuiltMap: Record<string, Game> = {};
      data.games.forEach((g) => { rebuiltMap[g.id] = sanitizeGame(g); });
      if (import.meta.env.DEV) {
        console.log('[Store] Estructura reconstruida desde datos existentes.');
      }
      writeLocal(LS_KEY_GAMES, rebuiltMap);
      return rebuiltMap;
    }
  } catch (err) {
    if (import.meta.env.DEV) {
      console.warn('[Store] Error recuperando catálogo:', err);
    }
  }

  return null;
}

/**
 * Carga el mapa de juegos. Prioriza la votación activa en Firestore, fallback a la colección de grupo y localStorage.
 */
export async function loadGames(): Promise<Record<string, Game>> {
  const activeVoting = await loadActiveVotingState();
  if (activeVoting?.gamesMap) {
    return activeVoting.gamesMap;
  }

  const firestoreGames = await fetchFirestoreGames();
  if (firestoreGames) {
    return firestoreGames;
  }

  return sanitizeGamesMap(readLocal<Record<string, Game>>(LS_KEY_GAMES, {}));
}

function appendLocalHistoryRecord(cleanRecord: VotingHistoryRecord): void {
  const history = readLocal<VotingHistoryRecord[]>(LS_KEY_HISTORY, []);
  history.unshift(cleanRecord);
  writeLocal(LS_KEY_HISTORY, history);
}

function deriveGamesMap(record: VotingHistoryRecord, gamesMap?: Record<string, Game>): Record<string, Game> {
  if (gamesMap) {
    return sanitizeGamesMap(gamesMap);
  }
  const derived: Record<string, Game> = {};
  record.resultsSnapshot?.forEach((res) => {
    if (res.game?.id) {
      derived[res.game.id] = res.game;
    }
  });
  return Object.keys(derived).length > 0 ? derived : record.gamesMap || {};
}

function resolveRecordId(id?: string): string {
  if (id) return id;
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `voting_${Date.now()}`;
}

function buildHistoryDocPayload(record: VotingHistoryRecord, recordId: string) {
  const createdDate = new Date(record.createdAt);
  const createdAtTimestamp = !Number.isNaN(createdDate.getTime())
    ? Timestamp.fromDate(createdDate)
    : Timestamp.now();

  return removeUndefinedDeep({
    ...record,
    id: recordId,
    createdAt: createdAtTimestamp,
    date: record.date,
    savedAt: Timestamp.now(),
  });
}

async function commitFinishedVotingBatch(
  db: Firestore,
  record: VotingHistoryRecord,
  voters: Voter[],
  gamesMap: Record<string, Game>,
  games: Game[]
): Promise<void> {
  const batch = writeBatch(db);
  const recordId = resolveRecordId(record.id);

  // 1. Historial: guardar documento en 'votaciones_pasadas' con ID determinista (UUID) y createdAt canónico
  const historyDocRef = doc(db, COLLECTION_HISTORY, recordId);
  batch.set(historyDocRef, buildHistoryDocPayload(record, recordId));

  // 2. Miembros: actualizar balances, rangos y multiplicadores de Aura en 'grupo/miembros'
  const groupDocRef = doc(db, COLLECTION_GROUP, DOC_MIEMBROS);
  batch.set(groupDocRef, removeUndefinedDeep({ voters, lastUpdated: Timestamp.now() }), { merge: true });

  // 3. Votación activa: reflejar los nuevos saldos, estado y limpiar precio congelado para el nuevo ciclo en 'votacion_actual/estado'
  const activeDocRef = doc(db, COLLECTION_ACTIVE_VOTING, DOC_ACTIVE_VOTING);
  batch.set(
    activeDocRef,
    removeUndefinedDeep({
      voters,
      gamesMap,
      games,
      isPrecioCongelado: false,
      precioCongelado: null,
      descuentoCongelado: null,
      precioCongeladoFormatted: null,
      precioOriginalCongelado: null,
      precioOriginalCongeladoFormatted: null,
      congeladoAt: null,
      congeladoGameId: null,
      lastUpdated: Timestamp.now(),
    }),
    { merge: true }
  );

  await batch.commit();
}

/**
 * Agrega un registro al historial de votaciones. Firestore usa setDoc con recordId, localStorage usa array.
 */
export async function addHistoryRecord(record: VotingHistoryRecord): Promise<SyncState> {
  if (!canWriteToPersistence()) {
    return buildReadOnlyState();
  }

  const cleanRecord = sanitizeVotingHistoryRecord(record);

  if (isFirebaseReady()) {
    try {
      const db = getFirestoreInstance()!;
      const recordId = resolveRecordId(cleanRecord.id);
      const historyDocRef = doc(db, COLLECTION_HISTORY, recordId);
      const payload = buildHistoryDocPayload(cleanRecord, recordId);
      await setDoc(historyDocRef, payload);
      if (import.meta.env.DEV) {
        console.log('[Store] Registro archivado correctamente.');
      }
      return { status: 'synced', message: 'Sincronizado con la nube' };
    } catch (err) {
      return handleSyncError(
        err,
        () => appendLocalHistoryRecord(cleanRecord),
        'Error archivando registro, usando almacenamiento local'
      );
    }
  }

  appendLocalHistoryRecord(cleanRecord);
  return { status: 'local', message: 'Guardado localmente' };
}

/**
 * Guarda de manera atómica el registro de historial y la actualización de miembros
 * (junto con el estado de la sesión de votación) en un único `writeBatch` de Firestore.
 * Esto asegura atomicidad: o se aplican todos los cambios (historial + nuevos saldos Aura) o ninguno.
 */
export async function saveFinishedVotingSession(
  record: VotingHistoryRecord,
  updatedVoters: Voter[],
  gamesMap?: Record<string, Game>
): Promise<SyncState> {
  return executeCoordinatedWrite(async () => {
    if (!canWriteToPersistence()) {
      return buildReadOnlyState();
    }

    const cleanRecord = sanitizeVotingHistoryRecord(record);
    const cleanVoters = removeUndefinedDeep(updatedVoters);
    const effectiveGamesMap = deriveGamesMap(cleanRecord, gamesMap);
    const games = Object.values(effectiveGamesMap);

    const saveLocalFallback = () => {
      writeLocal(LS_KEY_VOTERS, cleanVoters);
      appendLocalHistoryRecord(cleanRecord);
      writeLocal(LS_KEY_ACTIVE_VOTING, {
        voters: cleanVoters,
        gamesMap: effectiveGamesMap,
        games,
        isPrecioCongelado: false,
        precioCongelado: null,
        descuentoCongelado: null,
        precioCongeladoFormatted: null,
        precioOriginalCongelado: null,
        precioOriginalCongeladoFormatted: null,
        congeladoAt: null,
        congeladoGameId: null,
      });
    };

    if (isFirebaseReady()) {
      try {
        const db = getFirestoreInstance()!;
        await commitFinishedVotingBatch(db, cleanRecord, cleanVoters, effectiveGamesMap, games);
        saveLocalFallback();
        if (import.meta.env.DEV) {
          console.log('[Store] Votación archivada y miembros actualizados de forma atómica en Firestore.');
        }
        return { status: 'synced', message: 'Votación finalizada y sincronizada' };
      } catch (err) {
        return handleSyncError(
          err,
          saveLocalFallback,
          'Error finalizando votación atómicamente, usando almacenamiento local'
        );
      }
    }

    saveLocalFallback();
    return { status: 'local', message: 'Votación guardada localmente' };
  }, { isBarrier: true });
}

/**
 * Carga completamente el historial de votaciones. Prioriza Firestore, fallback a localStorage.
 */
export async function loadHistory(): Promise<VotingHistoryRecord[]> {
  if (isFirebaseReady()) {
    try {
      const db = getFirestoreInstance()!;
      const colRef = collection(db, COLLECTION_HISTORY);
      const q = query(colRef, orderBy('savedAt', 'desc'));
      const snap = await getDocs(q);
      if (!snap.empty) {
        const records: VotingHistoryRecord[] = [];
        snap.forEach((d) => {
          const data = d.data() as VotingHistoryRecord & { savedAt?: Timestamp; createdAt?: Timestamp | string };
          records.push(sanitizeVotingHistoryRecord(data));
        });
        // Orden canónico estricto por fecha de creación descendente
        records.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        if (import.meta.env.DEV) {
          console.log('[Store] Registros previos recuperados.');
        }
        writeLocal(LS_KEY_HISTORY, records);
        return records;
      }
    } catch (err) {
      if (import.meta.env.DEV) {
        console.warn('[Store] Error recuperando registros remotos:', err);
      }
    }
  }
  const localHistory = readLocal<VotingHistoryRecord[]>(LS_KEY_HISTORY, []);
  const sanitizedLocal = localHistory.map(sanitizeVotingHistoryRecord);
  sanitizedLocal.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return sanitizedLocal;
}

export interface InitialDashboardData {
  voters: Voter[];
  gamesMap: Record<string, Game>;
  history: VotingHistoryRecord[];
  apiKey: string;
  freezeState: FreezePriceState;
  hasExistingData: boolean;
}

function getSortedLocalHistory(): VotingHistoryRecord[] {
  const localHistory = readLocal<VotingHistoryRecord[]>(LS_KEY_HISTORY, []);
  if (localHistory.length === 0) return [];
  const sanitized = localHistory.map(sanitizeVotingHistoryRecord);
  sanitized.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return sanitized;
}

function resolveInitialVoters(
  parsedActive: ActiveVotingStateResult | null,
  groupData: GrupoDocument | null
): Voter[] {
  if (parsedActive?.voters && parsedActive.voters.length > 0) {
    return parsedActive.voters;
  }
  if (groupData?.voters && Array.isArray(groupData.voters) && groupData.voters.length > 0) {
    return groupData.voters;
  }
  return readLocal<Voter[]>(LS_KEY_VOTERS, []);
}

function resolveInitialGamesMap(
  parsedActive: ActiveVotingStateResult | null,
  groupData: GrupoDocument | null
): Record<string, Game> {
  if (parsedActive?.gamesMap && Object.keys(parsedActive.gamesMap).length > 0) {
    return parsedActive.gamesMap;
  }
  if (groupData?.gamesMap && typeof groupData.gamesMap === 'object' && Object.keys(groupData.gamesMap).length > 0) {
    return sanitizeGamesMap(groupData.gamesMap);
  }
  if (groupData?.games && Array.isArray(groupData.games) && groupData.games.length > 0) {
    const rebuilt: Record<string, Game> = {};
    for (const g of groupData.games) {
      rebuilt[g.id] = sanitizeGame(g);
    }
    return rebuilt;
  }
  return sanitizeGamesMap(readLocal<Record<string, Game>>(LS_KEY_GAMES, {}));
}

function parseHistorySnapshot(historySnap: QuerySnapshot): VotingHistoryRecord[] {
  const resolvedHistory: VotingHistoryRecord[] = [];
  historySnap.forEach((d) => {
    const data = d.data() as VotingHistoryRecord & { savedAt?: Timestamp; createdAt?: Timestamp | string };
    resolvedHistory.push(sanitizeVotingHistoryRecord(data));
  });
  resolvedHistory.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return resolvedHistory;
}

function resolveInitialHistory(historySnap: QuerySnapshot): VotingHistoryRecord[] {
  if (!historySnap.empty) {
    return parseHistorySnapshot(historySnap);
  }
  return getSortedLocalHistory();
}

function cacheResolvedInitialData(
  voters: Voter[],
  gamesMap: Record<string, Game>,
  history: VotingHistoryRecord[],
  parsedActive: ActiveVotingStateResult | null
): void {
  if (voters.length > 0) writeLocal(LS_KEY_VOTERS, voters);
  if (Object.keys(gamesMap).length > 0) writeLocal(LS_KEY_GAMES, gamesMap);
  if (history.length > 0) writeLocal(LS_KEY_HISTORY, history);
  if (parsedActive) writeLocal(LS_KEY_ACTIVE_VOTING, parsedActive);
}

function loadLocalFallbackDashboardData(apiKey: string): InitialDashboardData {
  const cachedActive = loadCachedActiveVoting();
  const cachedVoters = cachedActive?.voters || readLocal<Voter[]>(LS_KEY_VOTERS, []);
  const cachedGamesMap = cachedActive?.gamesMap || sanitizeGamesMap(readLocal<Record<string, Game>>(LS_KEY_GAMES, {}));
  const cachedHistory = getSortedLocalHistory();
  const cachedFreeze = cachedActive?.freezeState || DEFAULT_FREEZE_STATE;

  const hasExistingData = Boolean(
    cachedVoters.length > 0 ||
    Object.keys(cachedGamesMap).length > 0 ||
    cachedHistory.length > 0
  );

  return {
    voters: cachedVoters,
    gamesMap: cachedGamesMap,
    history: cachedHistory,
    apiKey,
    freezeState: cachedFreeze,
    hasExistingData,
  };
}

function checkHasExistingData(
  hasRemoteDoc: boolean,
  voters: Voter[],
  gamesMap: Record<string, Game>,
  history: VotingHistoryRecord[]
): boolean {
  return (
    hasRemoteDoc ||
    voters.length > 0 ||
    Object.keys(gamesMap).length > 0 ||
    history.length > 0
  );
}

/**
 * Carga de forma atómica y completa los datos iniciales de la aplicación.
 * Distingue explícitamente entre una base de datos vacía legítima y un fallo
 * de lectura en Firestore (lanzando la excepción en este último caso para evitar
 * que conjuntos vacíos por error de red activen autoguardados indeseados).
 */
export async function loadInitialDashboardData(): Promise<InitialDashboardData> {
  const apiKey = loadApiKey();

  if (!isFirebaseReady()) {
    return loadLocalFallbackDashboardData(apiKey);
  }

  const db = getFirestoreInstance()!;
  const activeDocRef = doc(db, COLLECTION_ACTIVE_VOTING, DOC_ACTIVE_VOTING);
  const groupDocRef = doc(db, COLLECTION_GROUP, DOC_MIEMBROS);
  const historyColRef = collection(db, COLLECTION_HISTORY);
  const historyQuery = query(historyColRef, orderBy('savedAt', 'desc'));

  // Si getDoc o getDocs falla, la promesa se rechaza y se propaga el error (NO se asume vacío)
  const [activeSnap, groupSnap, historySnap] = await Promise.all([
    getDoc(activeDocRef),
    getDoc(groupDocRef),
    getDocs(historyQuery),
  ]);

  const parsedActive = activeSnap.exists()
    ? parseActiveVotingData(activeSnap.data() as ActiveVotingDocument)
    : null;

  const groupData = groupSnap.exists()
    ? (groupSnap.data() as GrupoDocument)
    : null;

  const resolvedVoters = resolveInitialVoters(parsedActive, groupData);
  const resolvedGamesMap = resolveInitialGamesMap(parsedActive, groupData);
  const resolvedFreezeState = parsedActive?.freezeState || DEFAULT_FREEZE_STATE;
  const resolvedHistory = resolveInitialHistory(historySnap);

  cacheResolvedInitialData(resolvedVoters, resolvedGamesMap, resolvedHistory, parsedActive);

  const hasRemoteDoc = activeSnap.exists() || groupSnap.exists() || !historySnap.empty;
  const hasExistingData = checkHasExistingData(hasRemoteDoc, resolvedVoters, resolvedGamesMap, resolvedHistory);

  return {
    voters: resolvedVoters,
    gamesMap: resolvedGamesMap,
    history: resolvedHistory,
    apiKey,
    freezeState: resolvedFreezeState,
    hasExistingData,
  };
}

async function findFirestoreHistoryDocRef(db: Firestore, recordId: string) {
  // 1. Intento de búsqueda directa si el doc ID de Firestore coincide con el UUID
  const directDocRef = doc(db, COLLECTION_HISTORY, recordId);
  const directSnap = await getDoc(directDocRef);
  if (directSnap.exists()) {
    return directDocRef;
  }

  // 2. Fallback de escaneo para registros legados insertados previamente con auto-ID
  const colRef = collection(db, COLLECTION_HISTORY);
  const snap = await getDocs(colRef);
  const docToDelete = snap.docs.find((d) => d.data().id === recordId || d.id === recordId);
  return docToDelete ? docToDelete.ref : null;
}

/**
 * Elimina un registro específico del historial por su ID y restaura opcionalmente
 * el estado de los votantes de forma atómica en Firestore y localStorage.
 */
export async function deleteHistoryRecord(
  recordId: string,
  updatedVoters?: Voter[]
): Promise<SyncState> {
  return executeCoordinatedWrite(async () => {
    if (!canWriteToPersistence()) {
      return buildReadOnlyState();
    }

    const saveLocalFallback = () => {
      const history = readLocal<VotingHistoryRecord[]>(LS_KEY_HISTORY, []);
      const updated = history.filter((r) => r.id !== recordId);
      writeLocal(LS_KEY_HISTORY, updated);
      if (updatedVoters) {
        writeLocal(LS_KEY_VOTERS, removeUndefinedDeep(updatedVoters));
      }
    };

    if (isFirebaseReady()) {
      try {
        const db = getFirestoreInstance()!;
        const targetDocRef = await findFirestoreHistoryDocRef(db, recordId);

        const batch = writeBatch(db);
        if (targetDocRef) {
          batch.delete(targetDocRef);
        }
        if (updatedVoters) {
          const cleanVoters = removeUndefinedDeep(updatedVoters);
          const votersDocRef = doc(db, COLLECTION_GROUP, DOC_MIEMBROS);
          batch.set(
            votersDocRef,
            { voters: cleanVoters, lastUpdated: Timestamp.now() },
            { merge: true }
          );
          const activeDocRef = doc(db, COLLECTION_ACTIVE_VOTING, DOC_ACTIVE_VOTING);
          batch.set(
            activeDocRef,
            { voters: cleanVoters, lastUpdated: Timestamp.now() },
            { merge: true }
          );
        }

        await batch.commit();
        saveLocalFallback();
        if (import.meta.env.DEV) {
          console.log('[Store] Registro eliminado y votantes actualizados de forma atómica en Firestore.');
        }
        return { status: 'synced', message: 'Registro eliminado y Aura restaurado' };
      } catch (err) {
        return handleSyncError(
          err,
          saveLocalFallback,
          'Error eliminando registro en Firestore, usando almacenamiento local'
        );
      }
    }

    saveLocalFallback();
    return { status: 'local', message: 'Registro eliminado localmente' };
  }, { isBarrier: true });
}

/**
 * Limpia el historial de votaciones y actualiza opcionalmente el estado de Aura
 * de los integrantes de forma atómica en Firestore y localStorage.
 */
export async function clearHistory(updatedVoters?: Voter[]): Promise<SyncState> {
  return executeCoordinatedWrite(async () => {
    if (!canWriteToPersistence()) {
      return buildReadOnlyState();
    }

    const saveLocalFallback = () => {
      removeLocal(LS_KEY_HISTORY);
      if (updatedVoters) {
        writeLocal(LS_KEY_VOTERS, removeUndefinedDeep(updatedVoters));
      }
    };

    if (isFirebaseReady()) {
      try {
        const db = getFirestoreInstance()!;
        const colRef = collection(db, COLLECTION_HISTORY);
        const snap = await getDocs(colRef);

        const batch = writeBatch(db);
        snap.docs.forEach((d) => {
          batch.delete(d.ref);
        });

        if (updatedVoters) {
          const cleanVoters = removeUndefinedDeep(updatedVoters);
          const votersDocRef = doc(db, COLLECTION_GROUP, DOC_MIEMBROS);
          batch.set(
            votersDocRef,
            { voters: cleanVoters, lastUpdated: Timestamp.now() },
            { merge: true }
          );
          const activeDocRef = doc(db, COLLECTION_ACTIVE_VOTING, DOC_ACTIVE_VOTING);
          batch.set(
            activeDocRef,
            { voters: cleanVoters, lastUpdated: Timestamp.now() },
            { merge: true }
          );
        }

        await batch.commit();
        saveLocalFallback();
        if (import.meta.env.DEV) {
          console.log('[Store] Historial limpiado y votantes actualizados de forma atómica en Firestore.');
        }
        return {
          status: 'synced',
          message: updatedVoters ? 'Historial limpiado y Aura restaurado' : 'Historial limpiado',
        };
      } catch (err) {
        return handleSyncError(
          err,
          saveLocalFallback,
          'Error limpiando historial en Firestore, usando almacenamiento local'
        );
      }
    }

    saveLocalFallback();
    return {
      status: 'local',
      message: updatedVoters ? 'Historial limpiado y Aura restaurado (modo local)' : 'Historial limpiado (modo local)',
    };
  }, { isBarrier: true });
}

/**
 * Guarda la API key de Steam (solo localStorage, por seguridad).
 */
export function saveApiKey(apiKey: string): void {
  if (!canWriteToPersistence()) {
    return;
  }
  writeLocal(LS_KEY_API_KEY, apiKey);
}

/**
 * Carga la API key de Steam.
 */
export function loadApiKey(): string {
  return readLocal<string>(LS_KEY_API_KEY, '');
}

// ============================================================
// Backup - Exportar e Importar
// ============================================================

const BACKUP_VERSION = 1;
const BACKUP_FILENAME = 'backup_steam_votos.json';

export interface BackupData {
  version: number;
  exportedAt: string;
  voters: Voter[];
  gamesMap: Record<string, Game>;
  /** Array dinámico de juegos propuestos en orden */
  games?: Game[];
  history: VotingHistoryRecord[];
  steamApiKey: string;
}

/**
 * Valida que un objeto tenga la estructura correcta de BackupData.
 */
function isValidBackup(data: unknown): data is BackupData {
  if (!data || typeof data !== 'object') return false;
  const d = data as Record<string, unknown>;

  // Verificar versión
  if (d.version !== BACKUP_VERSION) return false;

  // Verificar voters (array)
  if (!Array.isArray(d.voters)) return false;

  // Verificar gamesMap (objeto)
  if (!d.gamesMap || typeof d.gamesMap !== 'object') return false;

  // Verificar history (array)
  if (!Array.isArray(d.history)) return false;

  // Verificar steamApiKey (string opcional)
  if (d.steamApiKey !== undefined && typeof d.steamApiKey !== 'string') return false;

  return true;
}

/**
 * Exporta todos los datos como archivo JSON descargable.
 */
export function exportBackup(): void {
  try {
    const gamesMap = readLocal<Record<string, Game>>(LS_KEY_GAMES, {});
    const data: BackupData = {
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      voters: readLocal<Voter[]>(LS_KEY_VOTERS, []),
      gamesMap,
      games: Object.values(gamesMap),
      history: readLocal<VotingHistoryRecord[]>(LS_KEY_HISTORY, []),
      steamApiKey: readLocal<string>(LS_KEY_API_KEY, ''),
    };

    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.download = BACKUP_FILENAME;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);

    if (import.meta.env.DEV) {
      console.log('[Store] Respaldo generado localmente.');
    }
  } catch (err) {
    if (import.meta.env.DEV) {
      console.error('[Store] Error al generar respaldo:', err);
    }
    throw new Error('No se pudo exportar el backup.', { cause: err });
  }
}

/**
 * Obtiene los datos de backup desde las variables de estado en memoria.
 * Útil cuando los datos en memoria son más recientes que localStorage.
 */
export function createBackupData(
  voters: Voter[],
  gamesMap: Record<string, Game>,
  history: VotingHistoryRecord[],
  steamApiKey: string
): BackupData {
  return {
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    voters,
    gamesMap,
    games: Object.values(gamesMap),
    history,
    steamApiKey,
  };
}

/**
 * Descarga un backup creado desde datos en memoria.
 */
export function downloadBackup(backup: BackupData): void {
  try {
    const json = JSON.stringify(backup, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.download = BACKUP_FILENAME;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);

    if (import.meta.env.DEV) {
      console.log('[Store] Respaldo descargado.');
    }
  } catch (err) {
    if (import.meta.env.DEV) {
      console.error('[Store] Error al descargar respaldo:', err);
    }
    throw new Error('No se pudo descargar el backup.', { cause: err });
  }
}

/**
 * Lee un archivo JSON y devuelve los datos parseados.
 */
export async function readBackupFile(file: File): Promise<BackupData> {
  try {
    const text = await file.text();
    const data = JSON.parse(text);

    if (!isValidBackup(data)) {
      throw new Error('El archivo no tiene un formato de backup válido.');
    }

    return data;
  } catch (err) {
    if (err instanceof Error) {
      throw err;
    }

    throw new Error('No se pudo leer el archivo. Asegúrate de que sea un JSON válido.', { cause: err });
  }
}

/**
 * Importa un backup en memoria y actualiza localStorage.
 * Retorna los datos restaurados para que el componente actualice sus estados.
 */
export async function importBackup(
  file: File
): Promise<{
  voters: Voter[];
  gamesMap: Record<string, Game>;
  history: VotingHistoryRecord[];
  steamApiKey: string;
}> {
  if (!canWriteToPersistence()) {
    const currentData = {
      voters: readLocal<Voter[]>(LS_KEY_VOTERS, []),
      gamesMap: readLocal<Record<string, Game>>(LS_KEY_GAMES, {}),
      history: readLocal<VotingHistoryRecord[]>(LS_KEY_HISTORY, []),
      steamApiKey: readLocal<string>(LS_KEY_API_KEY, ''),
    };
    return currentData;
  }

  const data = await readBackupFile(file);

  // Guardar en localStorage
  writeLocal(LS_KEY_VOTERS, data.voters);
  writeLocal(LS_KEY_GAMES, data.gamesMap);
  writeLocal(LS_KEY_HISTORY, data.history);
  writeLocal(LS_KEY_API_KEY, data.steamApiKey);

  // Si Firebase está configurado, sincronizar también allá
  if (isFirebaseReady()) {
    try {
      const db = getFirestoreInstance()!;
      const docRef = doc(db, COLLECTION_GROUP, DOC_MIEMBROS);
      const groupPayload = removeUndefinedDeep({
        voters: data.voters,
        gamesMap: data.gamesMap,
        games: data.games ?? Object.values(data.gamesMap),
        lastUpdated: Timestamp.now(),
      });
      await setDoc(docRef, groupPayload);

      const activeDocRef = doc(db, COLLECTION_ACTIVE_VOTING, DOC_ACTIVE_VOTING);
      const activePayload = removeUndefinedDeep({
        voters: data.voters,
        gamesMap: data.gamesMap,
        games: data.games ?? Object.values(data.gamesMap),
        lastUpdated: Timestamp.now(),
      });
      await setDoc(activeDocRef, activePayload);

      // Reemplazar historial: limpiar y volver a insertar
      const colRef = collection(db, COLLECTION_HISTORY);
      const snap = await getDocs(colRef);
      const deletePromises = snap.docs.map((d) => deleteDoc(d.ref));
      await Promise.all(deletePromises);

      const insertPromises = data.history.map((record) => {
        const clean = sanitizeVotingHistoryRecord(record);
        const createdDate = new Date(clean.createdAt);
        const createdAtTimestamp = !Number.isNaN(createdDate.getTime())
          ? Timestamp.fromDate(createdDate)
          : Timestamp.now();
        return addDoc(colRef, removeUndefinedDeep({
          ...clean,
          createdAt: createdAtTimestamp,
          savedAt: Timestamp.now(),
        }));
      });
      await Promise.all(insertPromises);

      if (import.meta.env.DEV) {
        console.log('[Store] Respaldo sincronizado.');
      }
    } catch (err) {
      if (import.meta.env.DEV) {
        console.warn('[Store] Error sincronizando respaldo:', err);
      }
    }
  }

  if (import.meta.env.DEV) {
    console.log('[Store] Respaldo importado correctamente.');
  }

  return {
    voters: data.voters,
    gamesMap: data.gamesMap,
    history: data.history,
    steamApiKey: data.steamApiKey,
  };
}

/**
 * Limpia todos los datos (reset) de forma atómica en Firestore y localStorage.
 */
export async function resetAllData(): Promise<SyncState> {
  return executeCoordinatedWrite(async () => {
    if (!canWriteToPersistence()) {
      return buildReadOnlyState();
    }

    const saveLocalFallback = () => {
      removeLocal(LS_KEY_VOTERS);
      removeLocal(LS_KEY_GAMES);
      removeLocal(LS_KEY_HISTORY);
      removeLocal(LS_KEY_API_KEY);
      removeLocal(LS_KEY_ACTIVE_VOTING);
    };

    if (isFirebaseReady()) {
      try {
        const db = getFirestoreInstance()!;
        const batch = writeBatch(db);

        // 1. Limpiar documento de grupo
        const docRef = doc(db, COLLECTION_GROUP, DOC_MIEMBROS);
        batch.set(docRef, { voters: [], gamesMap: {}, lastUpdated: Timestamp.now() });

        // 2. Limpiar sesión de votación activa
        const activeDocRef = doc(db, COLLECTION_ACTIVE_VOTING, DOC_ACTIVE_VOTING);
        batch.set(activeDocRef, { voters: [], gamesMap: {}, lastUpdated: Timestamp.now() });

        // 3. Limpiar todos los documentos de la colección de historial
        const colRef = collection(db, COLLECTION_HISTORY);
        const snap = await getDocs(colRef);
        snap.docs.forEach((d) => {
          batch.delete(d.ref);
        });

        await batch.commit();
        saveLocalFallback();
        if (import.meta.env.DEV) {
          console.log('[Store] Datos restablecidos atómicamente en Firestore.');
        }
        return { status: 'synced', message: 'Datos restablecidos' };
      } catch (err) {
        return handleSyncError(
          err,
          saveLocalFallback,
          'Error al restablecer datos en Firestore, usando almacenamiento local'
        );
      }
    }

    saveLocalFallback();
    return { status: 'local', message: 'Datos restablecidos (modo local)' };
  }, { isBarrier: true });
}