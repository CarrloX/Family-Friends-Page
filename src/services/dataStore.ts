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
} from 'firebase/firestore';
import { getFirestoreInstance, isFirebaseReady } from './firebaseConfig';
import { canManageContent } from './accessControl';
import type { Voter, Game, VotingHistoryRecord } from '../types/voting';
import { fixSteamCoverUrl } from '../utils/steamImages';

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

interface ActiveVotingDocument {
  voters: Voter[];
  gamesMap: Record<string, Game>;
  /** Array dinámico de juegos propuestos en orden */
  games?: Game[];
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
 * Guarda la lista de votantes. Prioriza Firestore, fallback a localStorage.
 */
export async function saveVoters(voters: Voter[]): Promise<SyncState> {
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
      if (isPermissionDeniedError(err)) {
        if (import.meta.env.DEV) {
          console.error('[Store] Operación denegada: permisos insuficientes.');
        }
        return { status: 'error', message: 'Permiso denegado por el servidor: requiere rol de administrador' };
      }
      if (import.meta.env.DEV) {
        console.warn('[Store] Error de sincronización, usando almacenamiento local:', err);
      }
      writeLocal(LS_KEY_VOTERS, voters);
      return { status: 'local', message: 'Guardado localmente (sin conexión)' };
    }
  }
  writeLocal(LS_KEY_VOTERS, voters);
  return { status: 'local', message: 'Guardado localmente' };
}

/**
 * Guarda el estado activo de la votación actual en Firestore y localStorage.
 */
export async function saveActiveVotingState(voters: Voter[], gamesMap: Record<string, Game>): Promise<SyncState> {
  if (!canWriteToPersistence()) {
    return buildReadOnlyState();
  }

  // Array dinámico de juegos derivado del mapa (preserva el orden)
  const games = Object.values(gamesMap);

  if (isFirebaseReady()) {
    try {
      const db = getFirestoreInstance()!;
      const docRef = doc(db, COLLECTION_ACTIVE_VOTING, DOC_ACTIVE_VOTING);
      const payload = removeUndefinedDeep({
        voters,
        gamesMap,
        games,
        lastUpdated: Timestamp.now(),
      });
      await setDoc(docRef, payload, { merge: true });
      writeLocal(LS_KEY_ACTIVE_VOTING, { voters, gamesMap, games });
      if (import.meta.env.DEV) {
        console.log('[Store] Estado de sesión sincronizado.');
      }
      return { status: 'synced', message: 'Votación actual sincronizada' };
    } catch (err) {
      if (isPermissionDeniedError(err)) {
        if (import.meta.env.DEV) {
          console.error('[Store] Operación denegada: permisos insuficientes.');
        }
        return { status: 'error', message: 'Permiso denegado por el servidor: requiere rol de administrador' };
      }
      if (import.meta.env.DEV) {
        console.warn('[Store] Error de sincronización, usando almacenamiento local:', err);
      }
      writeLocal(LS_KEY_ACTIVE_VOTING, { voters, gamesMap, games });
      return { status: 'local', message: 'Votación actual guardada localmente' };
    }
  }

  // Modo de desarrollo local / sin backend configurado: persistencia confinada a localStorage
  writeLocal(LS_KEY_ACTIVE_VOTING, { voters, gamesMap, games });
  return { status: 'local', message: 'Votación actual guardada localmente' };
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

export function sanitizeVotingHistoryRecord(record: VotingHistoryRecord): VotingHistoryRecord {
  if (!record) return record;
  const winningGame = sanitizeGame(record.winningGame);
  const gamesMap = sanitizeGamesMap(record.gamesMap || {});
  const games = Array.isArray(record.games)
    ? record.games.map(sanitizeGame)
    : Object.values(gamesMap);
  const resultsSnapshot = Array.isArray(record.resultsSnapshot)
    ? record.resultsSnapshot.map((r) => ({
        ...r,
        game: sanitizeGame(r.game),
      }))
    : [];

  return {
    ...record,
    winningGame,
    gamesMap,
    games,
    resultsSnapshot,
  };
}

function parseActiveVotingData(data: ActiveVotingDocument): { voters: Voter[]; gamesMap: Record<string, Game>; games: Game[] } | null {
  if (!Array.isArray(data.voters) || !data.gamesMap || typeof data.gamesMap !== 'object') {
    return null;
  }
  const cleanGamesMap = sanitizeGamesMap(data.gamesMap);
  const games = Array.isArray(data.games) && data.games.length > 0
    ? data.games.map(sanitizeGame)
    : Object.values(cleanGamesMap);
  return { voters: data.voters, gamesMap: cleanGamesMap, games };
}

async function fetchFirestoreActiveVoting(): Promise<{ voters: Voter[]; gamesMap: Record<string, Game>; games: Game[] } | null> {
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

function loadCachedActiveVoting(): { voters: Voter[]; gamesMap: Record<string, Game>; games?: Game[] } | null {
  const cached = readLocal<{ voters: Voter[]; gamesMap: Record<string, Game>; games?: Game[] } | null>(LS_KEY_ACTIVE_VOTING, null);
  if (!cached) return null;

  if (cached.gamesMap) {
    cached.gamesMap = sanitizeGamesMap(cached.gamesMap);
  }
  if (cached.games) {
    cached.games = cached.games.map(sanitizeGame);
  }
  return cached;
}

/**
 * Carga el estado activo de la votación desde Firestore o localStorage.
 */
export async function loadActiveVotingState(): Promise<{ voters: Voter[]; gamesMap: Record<string, Game>; games?: Game[] } | null> {
  const firestoreState = await fetchFirestoreActiveVoting();
  if (firestoreState) {
    return firestoreState;
  }
  return loadCachedActiveVoting();
}

/**
 * Carga la lista de votantes. Prioriza la votación activa en Firestore, fallback a la colección de grupo y localStorage.
 */
export async function loadVoters(): Promise<Voter[]> {
  const activeVoting = await loadActiveVotingState();
  if (activeVoting?.voters) {
    return activeVoting.voters;
  }

  if (isFirebaseReady()) {
    try {
      const db = getFirestoreInstance()!;
      const docRef = doc(db, COLLECTION_GROUP, DOC_MIEMBROS);
      const snap = await getDoc(docRef);
      if (snap.exists()) {
        const data = snap.data() as GrupoDocument;
        if (Array.isArray(data.voters) && data.voters.length > 0) {
          if (import.meta.env.DEV) {
            console.log('[Store] Datos de participantes recuperados.');
          }
          writeLocal(LS_KEY_VOTERS, data.voters);
          return data.voters;
        }
      }
    } catch (err) {
      if (import.meta.env.DEV) {
        console.warn('[Store] Error recuperando participantes remotos:', err);
      }
    }
  }
  return readLocal<Voter[]>(LS_KEY_VOTERS, []);
}

/**
 * Guarda el mapa de juegos. Prioriza Firestore, fallback a localStorage.
 */
export async function saveGames(gamesMap: Record<string, Game>): Promise<SyncState> {
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
      if (isPermissionDeniedError(err)) {
        if (import.meta.env.DEV) {
          console.error('[Store] Operación denegada: permisos insuficientes.');
        }
        return { status: 'error', message: 'Permiso denegado por el servidor: requiere rol de administrador' };
      }
      if (import.meta.env.DEV) {
        console.warn('[Store] Error sincronizando catálogo, usando almacenamiento local:', err);
      }
      writeLocal(LS_KEY_GAMES, gamesMap);
      return { status: 'local', message: 'Guardado localmente (sin conexión)' };
    }
  }
  writeLocal(LS_KEY_GAMES, gamesMap);
  return { status: 'local', message: 'Guardado localmente' };
}

/**
 * Carga el mapa de juegos. Prioriza la votación activa en Firestore, fallback a la colección de grupo y localStorage.
 */
export async function loadGames(): Promise<Record<string, Game>> {
  const activeVoting = await loadActiveVotingState();
  if (activeVoting?.gamesMap) {
    return activeVoting.gamesMap;
  }

  if (isFirebaseReady()) {
    try {
      const db = getFirestoreInstance()!;
      const docRef = doc(db, COLLECTION_GROUP, DOC_MIEMBROS);
      const snap = await getDoc(docRef);
      if (snap.exists()) {
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
      }
    } catch (err) {
      if (import.meta.env.DEV) {
        console.warn('[Store] Error recuperando catálogo:', err);
      }
    }
  }
  return sanitizeGamesMap(readLocal<Record<string, Game>>(LS_KEY_GAMES, {}));
}

/**
 * Agrega un registro al historial de votaciones. Firestore usa addDoc, localStorage usa array.
 */
export async function addHistoryRecord(record: VotingHistoryRecord): Promise<SyncState> {
  if (!canWriteToPersistence()) {
    return buildReadOnlyState();
  }

  const cleanRecord = sanitizeVotingHistoryRecord(record);

  if (isFirebaseReady()) {
    try {
      const db = getFirestoreInstance()!;
      const colRef = collection(db, COLLECTION_HISTORY);
      const payload = removeUndefinedDeep({
        ...cleanRecord,
        date: cleanRecord.date,
        savedAt: Timestamp.now(),
      });
      await addDoc(colRef, payload);
      if (import.meta.env.DEV) {
        console.log('[Store] Registro archivado correctamente.');
      }
      return { status: 'synced', message: 'Sincronizado con la nube' };
    } catch (err) {
      if (isPermissionDeniedError(err)) {
        if (import.meta.env.DEV) {
          console.error('[Store] Operación denegada: permisos insuficientes.');
        }
        return { status: 'error', message: 'Permiso denegado por el servidor: requiere rol de administrador' };
      }
      if (import.meta.env.DEV) {
        console.warn('[Store] Error archivando registro, usando almacenamiento local:', err);
      }
      const history = readLocal<VotingHistoryRecord[]>(LS_KEY_HISTORY, []);
      history.unshift(cleanRecord);
      writeLocal(LS_KEY_HISTORY, history);
      return { status: 'local', message: 'Guardado localmente (sin conexión)' };
    }
  }
  const history = readLocal<VotingHistoryRecord[]>(LS_KEY_HISTORY, []);
  history.unshift(cleanRecord);
  writeLocal(LS_KEY_HISTORY, history);
  return { status: 'local', message: 'Guardado localmente' };
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
          const data = d.data() as VotingHistoryRecord & { savedAt?: Timestamp };
          records.push(sanitizeVotingHistoryRecord(data));
        });
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
  return localHistory.map(sanitizeVotingHistoryRecord);
}

/**
 * Elimina un registro específico del historial por su ID.
 */
export async function deleteHistoryRecord(recordId: string): Promise<SyncState> {
  if (!canWriteToPersistence()) {
    return buildReadOnlyState();
  }

  if (isFirebaseReady()) {
    try {
      const db = getFirestoreInstance()!;
      const colRef = collection(db, COLLECTION_HISTORY);
      const snap = await getDocs(colRef);
      const docToDelete = snap.docs.find((d) => d.data().id === recordId);
      if (docToDelete) {
        await deleteDoc(docToDelete.ref);
        if (import.meta.env.DEV) {
          console.log('[Store] Registro eliminado del almacenamiento remoto.');
        }
      }
    } catch (err) {
      if (isPermissionDeniedError(err)) {
        if (import.meta.env.DEV) {
          console.error('[Store] Operación denegada: permisos insuficientes.');
        }
        return { status: 'error', message: 'Permiso denegado por el servidor: requiere rol de administrador' };
      }
      if (import.meta.env.DEV) {
        console.warn('[Store] Error eliminando registro remoto:', err);
      }
    }
  }

  const history = readLocal<VotingHistoryRecord[]>(LS_KEY_HISTORY, []);
  const updated = history.filter((r) => r.id !== recordId);
  writeLocal(LS_KEY_HISTORY, updated);
  return { status: 'synced', message: 'Registro eliminado' };
}

/**
 * Limpia el historial de votaciones en Firestore y localStorage.
 */
export async function clearHistory(): Promise<SyncState> {
  if (!canWriteToPersistence()) {
    return buildReadOnlyState();
  }

  if (isFirebaseReady()) {
    try {
      const db = getFirestoreInstance()!;
      const colRef = collection(db, COLLECTION_HISTORY);
      const snap = await getDocs(colRef);
      const deletePromises = snap.docs.map((d) => deleteDoc(d.ref));
      await Promise.all(deletePromises);
      if (import.meta.env.DEV) {
        console.log('[Store] Registros archivados depurados.');
      }
    } catch (err) {
      if (isPermissionDeniedError(err)) {
        if (import.meta.env.DEV) {
          console.error('[Store] Operación denegada: permisos insuficientes.');
        }
        return { status: 'error', message: 'Permiso denegado por el servidor: requiere rol de administrador' };
      }
      if (import.meta.env.DEV) {
        console.warn('[Store] Error depurando registros remotos:', err);
      }
    }
  }
  removeLocal(LS_KEY_HISTORY);
  return { status: 'synced', message: 'Historial limpiado' };
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

      for (const record of data.history) {
        await addDoc(colRef, removeUndefinedDeep({
          ...record,
          savedAt: Timestamp.now(),
        }));
      }

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
 * Limpia todos los datos (reset).
 */
export async function resetAllData(): Promise<void> {
  if (!canWriteToPersistence()) {
    return;
  }

  removeLocal(LS_KEY_VOTERS);
  removeLocal(LS_KEY_GAMES);
  removeLocal(LS_KEY_HISTORY);
  removeLocal(LS_KEY_API_KEY);
  removeLocal(LS_KEY_ACTIVE_VOTING);

  if (isFirebaseReady()) {
    try {
      const db = getFirestoreInstance()!;
      // Limpiar documento de grupo
      const docRef = doc(db, COLLECTION_GROUP, DOC_MIEMBROS);
      await setDoc(docRef, { voters: [], gamesMap: {}, lastUpdated: Timestamp.now() });

      const activeDocRef = doc(db, COLLECTION_ACTIVE_VOTING, DOC_ACTIVE_VOTING);
      await setDoc(activeDocRef, { voters: [], gamesMap: {}, lastUpdated: Timestamp.now() });

      // Limpiar historial
      const colRef = collection(db, COLLECTION_HISTORY);
      const snap = await getDocs(colRef);
      const deletePromises = snap.docs.map((d) => deleteDoc(d.ref));
      await Promise.all(deletePromises);
      if (import.meta.env.DEV) {
        console.log('[Store] Datos restablecidos.');
      }
    } catch (err) {
      if (import.meta.env.DEV) {
        console.warn('[Store] Error al restablecer datos remotos:', err);
      }
    }
  }
}