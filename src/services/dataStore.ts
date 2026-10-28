import {
  doc,
  getDoc,
  setDoc,
  collection,
  getDocs,
  query,
  orderBy,
  Timestamp,
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

/**
 * Guarda un valor en localStorage.
 * Retorna true si la operación tuvo éxito o false si ocurrió un error (p.ej. cuota excedida).
 */
function writeLocal<T>(key: string, value: T): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (err) {
    if (import.meta.env.DEV) {
      console.warn(`[Store] Error en almacenamiento local para "${key}":`, err);
    }
    return false;
  }
}

/**
 * Elimina una clave de localStorage.
 * Retorna true si la operación tuvo éxito o false en caso de fallo.
 */
function removeLocal(key: string): boolean {
  try {
    localStorage.removeItem(key);
    return true;
  } catch (err) {
    if (import.meta.env.DEV) {
      console.warn(`[Store] Error eliminando clave local "${key}":`, err);
    }
    return false;
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

/**
 * Determina si un error corresponde a una falla transitoria de red o estado sin conexión.
 */
function isNetworkOrOfflineError(err: unknown): boolean {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return true;
  }
  if (!err || typeof err !== 'object') return false;
  const code = 'code' in err ? String((err as { code?: unknown }).code).toLowerCase() : '';
  const message = 'message' in err ? String((err as { message?: unknown }).message).toLowerCase() : '';

  return (
    code.includes('unavailable') ||
    code.includes('deadline-exceeded') ||
    code.includes('network') ||
    message.includes('offline') ||
    message.includes('network') ||
    message.includes('failed to fetch') ||
    message.includes('networkerror') ||
    message.includes('could not reach') ||
    message.includes('transport errored')
  );
}

/**
 * Extrae un mensaje amigable y descriptivo del error de Firestore.
 */
function extractErrorMessage(err: unknown, fallback: string): string {
  if (isPermissionDeniedError(err)) {
    return 'Permiso denegado por el servidor: requiere rol de administrador';
  }
  if (err instanceof Error && err.message) {
    return err.message;
  }
  if (err && typeof err === 'object' && 'message' in err) {
    return String((err as { message: unknown }).message);
  }
  return fallback;
}

// ============================================================
// Colecciones y límites de Firestore
// ============================================================
const FIRESTORE_BATCH_LIMIT = 400;
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

/**
 * Actualiza la lista de integrantes tanto en la clave principal de miembros (`LS_KEY_VOTERS`)
 * como dentro del objeto en caché de la votación activa (`LS_KEY_ACTIVE_VOTING`) si existe.
 * Esto asegura consistencia total en los saldos de Aura en cargas sin conexión y fallbacks locales.
 */
function updateLocalVoters(voters: Voter[]): boolean {
  const cleanVoters = removeUndefinedDeep(voters);
  const okVoters = writeLocal(LS_KEY_VOTERS, cleanVoters);
  const cachedActive = readLocal<Record<string, unknown> | null>(LS_KEY_ACTIVE_VOTING, null);
  let okActive = true;
  if (cachedActive && typeof cachedActive === 'object') {
    okActive = writeLocal(LS_KEY_ACTIVE_VOTING, {
      ...cachedActive,
      voters: cleanVoters,
    });
  }
  return okVoters && okActive;
}

// ============================================================
// Servicio de Persistencia
// ============================================================

/**
 * Maneja errores ocurridos durante la sincronización con Firestore para operaciones no destructivas (guardado/autoguardado).
 * Si es error de permisos o de servidor/límites, reporta error real.
 * Si es falla transitoria de red/offline, guarda localmente y valida si el guardado tuvo éxito.
 */
function handleSyncError(
  err: unknown,
  saveFallback: () => boolean | void,
  warnContext: string
): SyncState {
  if (isPermissionDeniedError(err)) {
    if (import.meta.env.DEV) {
      console.error('[Store] Operación denegada: permisos insuficientes.');
    }
    return { status: 'error', message: 'Permiso denegado por el servidor: requiere rol de administrador' };
  }

  // Si es un error transitorio de red o el cliente está offline, guardamos localmente
  if (isNetworkOrOfflineError(err)) {
    if (import.meta.env.DEV) {
      console.warn(`[Store] ${warnContext} (sin conexión):`, err);
    }
    const saveResult = saveFallback();
    if (saveResult === false) {
      return { status: 'error', message: 'Error al guardar localmente: almacenamiento no disponible o lleno' };
    }
    return { status: 'local', message: 'Guardado localmente (sin conexión a internet)' };
  }

  // Para errores no recuperables de Firestore (límites, invalid-argument, resource-exhausted, etc.)
  // reportamos el error real en lugar de enmascararlo como guardado offline.
  if (import.meta.env.DEV) {
    console.error(`[Store] Error no recuperable en ${warnContext}:`, err);
  }
  const detail = extractErrorMessage(err, 'Error en el servidor de base de datos');
  return { status: 'error', message: detail };
}

/**
 * Maneja errores en operaciones destructivas (eliminar historial, restablecer datos, borrar registro).
 * A diferencia del guardado normal, una operación destructiva que falló en Firestore NUNCA debe
 * considerarse exitosa localmente ni borrar la caché local sin confirmación remota, ya que eso
 * provocaría que los datos eliminados reaparezcan al reconectarse o desde otros dispositivos.
 */
function handleDestructiveSyncError(
  err: unknown,
  context: string
): SyncState {
  if (isPermissionDeniedError(err)) {
    if (import.meta.env.DEV) {
      console.error(`[Store] Operación destructiva denegada (${context}): permisos insuficientes.`);
    }
    return { status: 'error', message: 'Permiso denegado por el servidor: requiere rol de administrador' };
  }

  if (import.meta.env.DEV) {
    console.error(`[Store] ${context}:`, err);
  }

  if (isNetworkOrOfflineError(err)) {
    return {
      status: 'error',
      message: `${context}: sin conexión con el servidor. No se eliminaron los datos remotos para evitar inconsistencias.`,
    };
  }

  const detail = extractErrorMessage(err, 'Error en el servidor de base de datos');
  return {
    status: 'error',
    message: `${context}: ${detail}`,
  };
}

type BatchOperation = (batch: ReturnType<typeof writeBatch>) => void;

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

async function commitChunkWithRetry(
  db: Firestore,
  chunk: BatchOperation[],
  retriesLeft = 2,
  attempt = 1
): Promise<void> {
  try {
    const batch = writeBatch(db);
    chunk.forEach((op) => op(batch));
    await batch.commit();
  } catch (err) {
    if (retriesLeft <= 0 || isPermissionDeniedError(err)) {
      throw err;
    }
    await delay(attempt * 300);
    await commitChunkWithRetry(db, chunk, retriesLeft - 1, attempt + 1);
  }
}

/**
 * Divide un array de operaciones en chunks del tamaño de FIRESTORE_BATCH_LIMIT
 * y los confirma secuencialmente con reintentos automáticos para fallos transitorios.
 * Usar for...of sobre chunks pre-computados evita el antipatrón "await dentro de un bucle while" (SonarLint S9382).
 */
async function commitBatchedOperations(
  db: Firestore,
  operations: BatchOperation[],
  onChunkCommitted?: (startIndex: number, count: number) => void
): Promise<void> {
  const chunks: BatchOperation[][] = [];
  for (let i = 0; i < operations.length; i += FIRESTORE_BATCH_LIMIT) {
    chunks.push(operations.slice(i, i + FIRESTORE_BATCH_LIMIT));
  }

  let offset = 0;
  await chunks.reduce<Promise<void>>(
    (chain, chunk) => {
      const currentOffset = offset;
      offset += chunk.length;
      return chain.then(async () => {
        await commitChunkWithRetry(db, chunk);
        onChunkCommitted?.(currentOffset, chunk.length);
      });
    },
    Promise.resolve()
  );
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

    const cleanVoters = removeUndefinedDeep(voters);
    const saveLocal = (): boolean => updateLocalVoters(cleanVoters);

    if (isFirebaseReady()) {
      try {
        const db = getFirestoreInstance()!;
        const docRef = doc(db, COLLECTION_GROUP, DOC_MIEMBROS);
        const payload = removeUndefinedDeep({ voters: cleanVoters, lastUpdated: Timestamp.now() });
        await setDoc(docRef, payload, { merge: true });
        saveLocal();
        if (import.meta.env.DEV) {
          console.log('[Store] Datos sincronizados correctamente.');
        }
        return { status: 'synced', message: 'Sincronizado con la nube' };
      } catch (err) {
        return handleSyncError(err, saveLocal, 'Error de sincronización, usando almacenamiento local');
      }
    }
    const ok = saveLocal();
    if (!ok) {
      return { status: 'error', message: 'Error al guardar integrantes localmente: almacenamiento no disponible o lleno' };
    }
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

    const saveLocal = (): boolean => {
      const ok1 = writeLocal(LS_KEY_VOTERS, cleanVoters);
      const ok2 = writeLocal(LS_KEY_GAMES, cleanGamesMap);
      const ok3 = writeLocal(LS_KEY_ACTIVE_VOTING, {
        voters: cleanVoters,
        gamesMap: cleanGamesMap,
        games: cleanGames,
        ...freezeData,
      });
      return ok1 && ok2 && ok3;
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
    const ok = saveLocal();
    if (!ok) {
      return { status: 'error', message: 'Error al guardar votación localmente: almacenamiento no disponible o lleno' };
    }
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

    const saveLocal = (): boolean => {
      const cached = readLocal<Record<string, unknown>>(LS_KEY_ACTIVE_VOTING, {});
      return writeLocal(LS_KEY_ACTIVE_VOTING, { ...cached, ...payload });
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

    const ok = saveLocal();
    if (!ok) {
      return { status: 'error', message: 'Error al guardar precio congelado localmente: almacenamiento no disponible o lleno' };
    }
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

    const saveLocal = (): boolean => {
      const cached = readLocal<Record<string, unknown>>(LS_KEY_ACTIVE_VOTING, {});
      return writeLocal(LS_KEY_ACTIVE_VOTING, { ...cached, ...payload });
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

    const ok = saveLocal();
    if (!ok) {
      return { status: 'error', message: 'Error al descongelar precio localmente: almacenamiento no disponible o lleno' };
    }
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
  const cleanBundleImage = game.bundleImage
    ? fixSteamCoverUrl(game.bundleImage, game.appId) || game.bundleImage
    : undefined;
  const isBundle = Boolean(game.isBundle);
  const base: Game = {
    ...game,
    genre: cleanGenre,
    coverImage: cleanCover || game.coverImage,
    isBundle: isBundle ? true : undefined,
    bundleDescription: isBundle && game.bundleDescription ? game.bundleDescription.trim() : undefined,
    bundleUrl: isBundle && game.bundleUrl ? game.bundleUrl.trim() : undefined,
    bundleImage: isBundle ? cleanBundleImage : undefined,
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
  const isBundle = Boolean(winningGame?.isBundle || record.isBundle);

  const cleanRecord: VotingHistoryRecord = {
    ...record,
    createdAt,
    date: record.date || formattedDate,
    winningGame,
    isBundle: isBundle ? true : undefined,
    bundleDescription: isBundle ? (winningGame?.bundleDescription || record.bundleDescription) : undefined,
    bundleImage: isBundle ? (winningGame?.bundleImage || record.bundleImage) : undefined,
    bundleUrl: isBundle ? (winningGame?.bundleUrl || record.bundleUrl) : undefined,
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

  const db = getFirestoreInstance()!;
  const docRef = doc(db, COLLECTION_ACTIVE_VOTING, DOC_ACTIVE_VOTING);
  const snap = await getDoc(docRef);
  if (!snap.exists()) {
    removeLocal(LS_KEY_ACTIVE_VOTING);
    return null;
  }

  const parsed = parseActiveVotingData(snap.data() as ActiveVotingDocument);
  if (parsed) {
    writeLocal(LS_KEY_ACTIVE_VOTING, parsed);
  } else {
    removeLocal(LS_KEY_ACTIVE_VOTING);
  }
  return parsed;
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
 * Distingue explícitamente entre:
 * 1. Resultado remoto válido (documento existente o ausencia legítima del documento).
 * 2. Falla transitoria de conectividad / sin conexión (recurre a la caché local de respaldo).
 * 3. Error real no transitorio (permisos, consulta inválida), propagando la excepción.
 */
export async function loadActiveVotingState(): Promise<ActiveVotingStateResult | null> {
  if (!isFirebaseReady()) {
    return loadCachedActiveVoting();
  }

  try {
    return await fetchFirestoreActiveVoting();
  } catch (err) {
    if (isNetworkOrOfflineError(err)) {
      if (import.meta.env.DEV) {
        console.warn('[Store] Falla transitoria de red en loadActiveVotingState, usando caché local:', err);
      }
      return loadCachedActiveVoting();
    }
    throw err;
  }
}

async function fetchFirestoreVoters(): Promise<Voter[]> {
  if (!isFirebaseReady()) return [];

  const db = getFirestoreInstance()!;
  const docRef = doc(db, COLLECTION_GROUP, DOC_MIEMBROS);
  const snap = await getDoc(docRef);
  if (!snap.exists()) {
    writeLocal(LS_KEY_VOTERS, []);
    return [];
  }

  const data = snap.data() as GrupoDocument;
  if (Array.isArray(data.voters)) {
    if (import.meta.env.DEV) {
      console.log('[Store] Datos de participantes recuperados.');
    }
    writeLocal(LS_KEY_VOTERS, data.voters);
    return data.voters;
  }
  writeLocal(LS_KEY_VOTERS, []);
  return [];
}

/**
 * Carga la lista de votantes. Prioriza la votación activa en Firestore, luego la colección de grupo y localStorage solo en modo offline o falla de red.
 * Distingue explícitamente entre resultado remoto legítimo (incluso vacío), falla transitoria de red y error no transitorio.
 */
export async function loadVoters(): Promise<Voter[]> {
  if (!isFirebaseReady()) {
    return readLocal<Voter[]>(LS_KEY_VOTERS, []);
  }

  try {
    const activeVoting = await fetchFirestoreActiveVoting();
    if (activeVoting && Array.isArray(activeVoting.voters)) {
      return activeVoting.voters;
    }

    return await fetchFirestoreVoters();
  } catch (err) {
    if (isNetworkOrOfflineError(err)) {
      if (import.meta.env.DEV) {
        console.warn('[Store] Falla transitoria de red en loadVoters, usando fallback local:', err);
      }
      return readLocal<Voter[]>(LS_KEY_VOTERS, []);
    }
    throw err;
  }
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
    const cleanGames = sanitizeGamesMap(gamesMap);

    const saveLocal = (): boolean => {
      const ok1 = writeLocal(LS_KEY_GAMES, cleanGames);
      const cachedActive = readLocal<Record<string, unknown> | null>(LS_KEY_ACTIVE_VOTING, null);
      let ok2 = true;
      if (cachedActive && typeof cachedActive === 'object') {
        ok2 = writeLocal(LS_KEY_ACTIVE_VOTING, {
          ...cachedActive,
          gamesMap: cleanGames,
          games: Object.values(cleanGames),
        });
      }
      return ok1 && ok2;
    };

    if (isFirebaseReady()) {
      try {
        const db = getFirestoreInstance()!;
        const docRef = doc(db, COLLECTION_GROUP, DOC_MIEMBROS);
        const payload = removeUndefinedDeep({
          gamesMap: cleanGames,
          games,
          lastUpdated: Timestamp.now(),
        });
        await setDoc(docRef, payload, { merge: true });
        saveLocal();
        if (import.meta.env.DEV) {
          console.log('[Store] Catálogo sincronizado correctamente.');
        }
        return { status: 'synced', message: 'Sincronizado con la nube' };
      } catch (err) {
        return handleSyncError(err, saveLocal, 'Error sincronizando catálogo, usando almacenamiento local');
      }
    }
    const ok = saveLocal();
    if (!ok) {
      return { status: 'error', message: 'Error al guardar catálogo localmente: almacenamiento no disponible o lleno' };
    }
    return { status: 'local', message: 'Guardado localmente' };
  });
}

async function fetchFirestoreGames(): Promise<Record<string, Game>> {
  if (!isFirebaseReady()) return {};

  const db = getFirestoreInstance()!;
  const docRef = doc(db, COLLECTION_GROUP, DOC_MIEMBROS);
  const snap = await getDoc(docRef);
  if (!snap.exists()) {
    writeLocal(LS_KEY_GAMES, {});
    return {};
  }

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
  writeLocal(LS_KEY_GAMES, {});
  return {};
}

/**
 * Carga el mapa de juegos. Prioriza la votación activa en Firestore, luego la colección de grupo y localStorage solo en modo offline o falla de red.
 * Distingue explícitamente entre resultado remoto legítimo (incluso vacío), falla transitoria de red y error no transitorio.
 */
export async function loadGames(): Promise<Record<string, Game>> {
  if (!isFirebaseReady()) {
    return sanitizeGamesMap(readLocal<Record<string, Game>>(LS_KEY_GAMES, {}));
  }

  try {
    const activeVoting = await fetchFirestoreActiveVoting();
    if (activeVoting?.gamesMap) {
      return activeVoting.gamesMap;
    }

    return await fetchFirestoreGames();
  } catch (err) {
    if (isNetworkOrOfflineError(err)) {
      if (import.meta.env.DEV) {
        console.warn('[Store] Falla transitoria de red en loadGames, usando fallback local:', err);
      }
      return sanitizeGamesMap(readLocal<Record<string, Game>>(LS_KEY_GAMES, {}));
    }
    throw err;
  }
}

function appendLocalHistoryRecord(cleanRecord: VotingHistoryRecord): boolean {
  const history = readLocal<VotingHistoryRecord[]>(LS_KEY_HISTORY, []);
  history.unshift(cleanRecord);
  return writeLocal(LS_KEY_HISTORY, history);
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

  const isBundle = Boolean(record.winningGame?.isBundle || record.isBundle);
  const bundleDescription = record.winningGame?.bundleDescription || record.bundleDescription;
  const bundleImage = record.winningGame?.bundleImage || record.bundleImage;
  const bundleUrl = record.winningGame?.bundleUrl || record.bundleUrl;

  return removeUndefinedDeep({
    ...record,
    id: recordId,
    createdAt: createdAtTimestamp,
    date: record.date,
    isBundle: isBundle ? true : undefined,
    bundleDescription: isBundle ? bundleDescription : undefined,
    bundleImage: isBundle ? bundleImage : undefined,
    bundleUrl: isBundle ? bundleUrl : undefined,
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
      appendLocalHistoryRecord(cleanRecord);
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

  const ok = appendLocalHistoryRecord(cleanRecord);
  if (!ok) {
    return { status: 'error', message: 'Error al guardar registro localmente: almacenamiento no disponible o lleno' };
  }
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

    const saveLocalFallback = (): boolean => {
      const ok1 = updateLocalVoters(cleanVoters);
      const ok2 = appendLocalHistoryRecord(cleanRecord);
      const ok3 = writeLocal(LS_KEY_ACTIVE_VOTING, {
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
      return ok1 && ok2 && ok3;
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

    const ok = saveLocalFallback();
    if (!ok) {
      return { status: 'error', message: 'Error al finalizar votación localmente: almacenamiento no disponible o lleno' };
    }
    return { status: 'local', message: 'Votación guardada localmente' };
  }, { isBarrier: true });
}

function getSortedLocalHistory(): VotingHistoryRecord[] {
  const localHistory = readLocal<VotingHistoryRecord[]>(LS_KEY_HISTORY, []);
  if (localHistory.length === 0) return [];
  const sanitized = localHistory.map(sanitizeVotingHistoryRecord);
  sanitized.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return sanitized;
}

/**
 * Carga completamente el historial de votaciones. Prioriza Firestore, fallback a localStorage solo en modo offline o error de red.
 * Distingue explícitamente entre:
 * 1. Resultado remoto válido (registros encontrados o colección vacía legítima).
 * 2. Falla transitoria de conectividad / sin conexión (recurre a la caché local de respaldo).
 * 3. Error real no transitorio (permisos, consulta inválida), propagando la excepción.
 */
export async function loadHistory(): Promise<VotingHistoryRecord[]> {
  if (!isFirebaseReady()) {
    return getSortedLocalHistory();
  }

  try {
    const db = getFirestoreInstance()!;
    const colRef = collection(db, COLLECTION_HISTORY);
    const q = query(colRef, orderBy('savedAt', 'desc'));
    const snap = await getDocs(q);
    const records: VotingHistoryRecord[] = [];
    if (!snap.empty) {
      snap.forEach((d) => {
        const data = d.data() as VotingHistoryRecord & { savedAt?: Timestamp; createdAt?: Timestamp | string };
        records.push(sanitizeVotingHistoryRecord(data));
      });
      // Orden canónico estricto por fecha de creación descendente
      records.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      if (import.meta.env.DEV) {
        console.log('[Store] Registros previos recuperados.');
      }
    }
    writeLocal(LS_KEY_HISTORY, records);
    return records;
  } catch (err) {
    if (isNetworkOrOfflineError(err)) {
      if (import.meta.env.DEV) {
        console.warn('[Store] Falla transitoria de red en loadHistory, usando fallback local:', err);
      }
      return getSortedLocalHistory();
    }
    throw err;
  }
}

export interface InitialDashboardData {
  voters: Voter[];
  gamesMap: Record<string, Game>;
  history: VotingHistoryRecord[];
  apiKey: string;
  freezeState: FreezePriceState;
  hasExistingData: boolean;
}

function resolveInitialVoters(
  parsedActive: ActiveVotingStateResult | null,
  groupData: GrupoDocument | null
): Voter[] {
  if (parsedActive) {
    return parsedActive.voters;
  }

  if (Array.isArray(groupData?.voters)) {
    return groupData.voters;
  }

  return [];
}

function resolveInitialGamesMap(
  parsedActive: ActiveVotingStateResult | null,
  groupData: GrupoDocument | null
): Record<string, Game> {
  if (parsedActive) {
    return parsedActive.gamesMap;
  }

  if (groupData?.gamesMap && typeof groupData.gamesMap === 'object') {
    return sanitizeGamesMap(groupData.gamesMap);
  }

  if (Array.isArray(groupData?.games)) {
    const rebuilt: Record<string, Game> = {};
    for (const g of groupData.games) {
      rebuilt[g.id] = sanitizeGame(g);
    }
    return rebuilt;
  }

  return {};
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
  // Cuando Firestore respondió correctamente y la colección de historial está vacía,
  // el estado remoto válido es un historial vacío. NO recurrir al historial local antiguo.
  return [];
}

function cacheResolvedInitialData(
  voters: Voter[],
  gamesMap: Record<string, Game>,
  history: VotingHistoryRecord[],
  parsedActive: ActiveVotingStateResult | null
): void {
  writeLocal(LS_KEY_VOTERS, voters);
  writeLocal(LS_KEY_GAMES, gamesMap);
  writeLocal(LS_KEY_HISTORY, history);
  if (parsedActive) {
    writeLocal(LS_KEY_ACTIVE_VOTING, parsedActive);
  } else {
    removeLocal(LS_KEY_ACTIVE_VOTING);
  }
}

function loadLocalFallbackDashboardData(apiKey: string): InitialDashboardData {
  const cachedActive = loadCachedActiveVoting();
  const localVoters = readLocal<Voter[]>(LS_KEY_VOTERS, []);

  // Si cachedActive existe y tiene votantes, aseguramos que sus saldos de Aura
  // estén sincronizados con la lista principal de miembros persistida en LS_KEY_VOTERS
  let cachedVoters = cachedActive ? cachedActive.voters : localVoters;
  if (cachedActive?.voters && localVoters.length > 0) {
    const localMemberMap = new Map(localVoters.map((v) => [v.id, v]));
    cachedVoters = cachedActive.voters.map((v) => {
      const savedMember = localMemberMap.get(v.id);
      return savedMember
        ? {
            ...v,
            auraRank: savedMember.auraRank,
            auraQuotaBalance: savedMember.auraQuotaBalance,
            multiplier: savedMember.multiplier,
          }
        : v;
    });
  }

  const cachedGamesMap = cachedActive ? cachedActive.gamesMap : sanitizeGamesMap(readLocal<Record<string, Game>>(LS_KEY_GAMES, {}));
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
  voters: Voter[],
  gamesMap: Record<string, Game>,
  history: VotingHistoryRecord[]
): boolean {
  return (
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

  const hasExistingData = checkHasExistingData(resolvedVoters, resolvedGamesMap, resolvedHistory);

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

    const saveLocalFallback = (): boolean => {
      const history = readLocal<VotingHistoryRecord[]>(LS_KEY_HISTORY, []);
      const updated = history.filter((r) => r.id !== recordId);
      const okHistory = writeLocal(LS_KEY_HISTORY, updated);
      let okVoters = true;
      if (updatedVoters) {
        okVoters = updateLocalVoters(updatedVoters);
      }
      return okHistory && okVoters;
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
        return handleDestructiveSyncError(
          err,
          'Error eliminando registro en Firestore'
        );
      }
    }

    const ok = saveLocalFallback();
    if (!ok) {
      return { status: 'error', message: 'Error al eliminar registro localmente: almacenamiento no disponible o lleno' };
    }
    return { status: 'local', message: 'Registro eliminado localmente' };
  }, { isBarrier: true });
}

/**
 * Limpia el historial de votaciones y actualiza opcionalmente el estado de Aura
 * de los integrantes de forma segura por lotes en Firestore y localStorage.
 */
function applyVotersUpdateToBatch(
  batch: ReturnType<typeof writeBatch>,
  db: Firestore,
  updatedVoters?: Voter[]
): void {
  if (!updatedVoters) return;
  const cleanVoters = removeUndefinedDeep(updatedVoters);
  const now = Timestamp.now();
  const votersDocRef = doc(db, COLLECTION_GROUP, DOC_MIEMBROS);
  const activeDocRef = doc(db, COLLECTION_ACTIVE_VOTING, DOC_ACTIVE_VOTING);
  batch.set(votersDocRef, { voters: cleanVoters, lastUpdated: now }, { merge: true });
  batch.set(activeDocRef, { voters: cleanVoters, lastUpdated: now }, { merge: true });
}

function registerDocIds(
  set: Set<string>,
  docs: Array<{ id: string; data?: () => Record<string, unknown> }>
): void {
  for (const d of docs) {
    set.add(d.id);
    if (typeof d.data === 'function') {
      const data = d.data();
      if (data && typeof data.id === 'string') {
        set.add(data.id);
      }
    }
  }
}

function removeRecordsFromLocalHistory(deletedIds: Set<string>): void {
  if (deletedIds.size === 0) return;
  const current = readLocal<VotingHistoryRecord[]>(LS_KEY_HISTORY, []);
  if (current.length === 0) return;
  const updated = current.filter((r) => !deletedIds.has(r.id));
  writeLocal(LS_KEY_HISTORY, updated);
}

function saveClearHistoryLocal(updatedVoters?: Voter[]): boolean {
  const okHistory = removeLocal(LS_KEY_HISTORY);
  const okVoters = updatedVoters ? updateLocalVoters(updatedVoters) : true;
  return okHistory && okVoters;
}

function handleClearHistoryFailure(
  err: unknown,
  auraPersisted: boolean,
  updatedVoters: Voter[] | undefined,
  deletedDocIds: Set<string>,
  totalDocsCount: number
): SyncState {
  if (auraPersisted && updatedVoters) {
    updateLocalVoters(updatedVoters);
  }
  removeRecordsFromLocalHistory(deletedDocIds);

  const detail = extractErrorMessage(err, 'Error en operaciones de Firestore');

  if (auraPersisted) {
    return {
      status: 'error',
      message: `Aura restaurado en el servidor (${deletedDocIds.size} de ${totalDocsCount} registros eliminados), pero falló la depuración de los lotes restantes: ${detail}. Puedes reintentar la limpieza para completar la depuración.`,
    };
  }

  if (deletedDocIds.size > 0) {
    return {
      status: 'error',
      message: `Limpieza parcial: se eliminaron ${deletedDocIds.size} de ${totalDocsCount} registros en el servidor, pero ocurrió un error: ${detail}. Reintenta la limpieza para eliminar los registros restantes.`,
    };
  }

  return handleDestructiveSyncError(err, 'Error limpiando historial en Firestore');
}

async function executeClearHistoryInFirestore(
  db: Firestore,
  updatedVoters?: Voter[]
): Promise<SyncState> {
  let auraPersisted = false;
  const deletedDocIds = new Set<string>();
  let totalDocsCount = 0;

  try {
    const historyColRef = collection(db, COLLECTION_HISTORY);
    const historySnap = await getDocs(historyColRef);
    const historyDocs = historySnap.docs;
    totalDocsCount = historyDocs.length;

    const baseOpsCount = updatedVoters ? 2 : 0;
    const totalOps = baseOpsCount + historyDocs.length;

    // CASO 1: Para historiales de hasta 398 documentos (totalOps <= 400), lote único atómico
    if (totalOps <= FIRESTORE_BATCH_LIMIT) {
      const batch = writeBatch(db);
      applyVotersUpdateToBatch(batch, db, updatedVoters);
      historyDocs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
      registerDocIds(deletedDocIds, historyDocs);
      auraPersisted = Boolean(updatedVoters);
    } else {
      // CASO 2: Para historiales grandes (> 398 documentos con votantes):
      // Fase 1: Restaurar Aura en grupo y sesión activa junto al primer lote
      const firstBatchSliceSize = Math.max(0, FIRESTORE_BATCH_LIMIT - baseOpsCount);
      const firstBatchDocs = historyDocs.slice(0, firstBatchSliceSize);
      const remainingDocs = historyDocs.slice(firstBatchSliceSize);

      const firstBatch = writeBatch(db);
      applyVotersUpdateToBatch(firstBatch, db, updatedVoters);
      firstBatchDocs.forEach((d) => firstBatch.delete(d.ref));
      await firstBatch.commit();
      auraPersisted = Boolean(updatedVoters);
      registerDocIds(deletedDocIds, firstBatchDocs);

      // Fase 2: Eliminar documentos restantes con reintentos y tracking de confirmación
      const deleteOps: BatchOperation[] = remainingDocs.map((d) => (b) => b.delete(d.ref));
      await commitBatchedOperations(db, deleteOps, (startIndex, count) => {
        registerDocIds(deletedDocIds, remainingDocs.slice(startIndex, startIndex + count));
      });
    }

    saveClearHistoryLocal(updatedVoters);
    if (import.meta.env.DEV) {
      console.log('[Store] Historial limpiado y votantes actualizados correctamente en Firestore.');
    }
    return {
      status: 'synced',
      message: updatedVoters ? 'Historial limpiado y Aura restaurado' : 'Historial limpiado',
    };
  } catch (err) {
    return handleClearHistoryFailure(err, auraPersisted, updatedVoters, deletedDocIds, totalDocsCount);
  }
}

/**
 * Limpia el historial de votaciones y actualiza opcionalmente el estado de Aura
 * de los integrantes de forma segura por lotes en Firestore y localStorage.
 */
export async function clearHistory(updatedVoters?: Voter[]): Promise<SyncState> {
  return executeCoordinatedWrite(async () => {
    if (!canWriteToPersistence()) {
      return buildReadOnlyState();
    }

    if (isFirebaseReady()) {
      return executeClearHistoryInFirestore(getFirestoreInstance()!, updatedVoters);
    }

    if (!saveClearHistoryLocal(updatedVoters)) {
      return { status: 'error', message: 'Error al limpiar historial localmente: almacenamiento no disponible o lleno' };
    }

    return {
      status: 'local',
      message: updatedVoters ? 'Historial limpiado y Aura restaurado (modo local)' : 'Historial limpiado (modo local)',
    };
  }, { isBarrier: true });
}

/**
 * Guarda la API key de Steam (solo localStorage, por seguridad).
 */
export function saveApiKey(apiKey: string): boolean {
  if (!canWriteToPersistence()) {
    return false;
  }
  return writeLocal(LS_KEY_API_KEY, apiKey);
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

interface BackupSyncPayload {
  voters: Voter[];
  gamesMap: Record<string, Game>;
  games: Game[];
  history: VotingHistoryRecord[];
}

/**
 * Sincroniza atómicamente el contenido de un respaldo en Firestore en un único lote indivisible.
 * Si las operaciones requeridas exceden el límite atómico de Firestore (400 operaciones), rechaza la importación
 * para garantizar de forma absoluta que nunca se produzca una importación parcial o un historial mezclado ante fallos de red.
 */
async function syncBackupToFirestore(
  db: Firestore,
  payload: BackupSyncPayload
): Promise<void> {
  const groupDocRef = doc(db, COLLECTION_GROUP, DOC_MIEMBROS);
  const activeDocRef = doc(db, COLLECTION_ACTIVE_VOTING, DOC_ACTIVE_VOTING);

  const groupPayload = removeUndefinedDeep({
    voters: payload.voters,
    gamesMap: payload.gamesMap,
    games: payload.games,
    lastUpdated: Timestamp.now(),
  });

  const activePayload = removeUndefinedDeep({
    voters: payload.voters,
    gamesMap: payload.gamesMap,
    games: payload.games,
    isPrecioCongelado: false,
    precioCongelado: null,
    descuentoCongelado: null,
    precioCongeladoFormatted: null,
    precioOriginalCongelado: null,
    precioOriginalCongeladoFormatted: null,
    congeladoAt: null,
    congeladoGameId: null,
    lastUpdated: Timestamp.now(),
  });

  // Consultar historial actual para identificar documentos huérfanos a eliminar
  const colRef = collection(db, COLLECTION_HISTORY);
  const snap = await getDocs(colRef);

  // Mapear los nuevos registros del respaldo con IDs canónicos/deterministas
  const newHistoryEntries = payload.history.map((record) => {
    const recordId = resolveRecordId(record.id);
    const docPayload = buildHistoryDocPayload(record, recordId);
    const docRef = doc(db, COLLECTION_HISTORY, recordId);
    return { docRef, payload: docPayload, recordId };
  });

  const newRecordIdSet = new Set(newHistoryEntries.map((e) => e.recordId));

  // Huérfanos y legados: cualquier documento en Firestore cuyo ID no coincida con los IDs canónicos del backup
  const docsToDelete = snap.docs.filter((d) => !newRecordIdSet.has(d.id));

  const totalOps = 2 + newHistoryEntries.length + docsToDelete.length;

  if (totalOps > FIRESTORE_BATCH_LIMIT) {
    throw new Error(
      `El respaldo requiere ${totalOps} operaciones, superando el límite atómico de ${FIRESTORE_BATCH_LIMIT} operaciones de Firestore. Para garantizar que no quede un historial parcial o mezclado, divide o limpia el historial antes de importarlo.`
    );
  }

  const batch = writeBatch(db);
  batch.set(groupDocRef, groupPayload);
  batch.set(activeDocRef, activePayload);
  docsToDelete.forEach((d) => batch.delete(d.ref));
  newHistoryEntries.forEach((entry) => batch.set(entry.docRef, entry.payload));
  await batch.commit();
}

export interface ImportBackupResult {
  voters: Voter[];
  gamesMap: Record<string, Game>;
  history: VotingHistoryRecord[];
  steamApiKey: string;
  syncState: SyncState;
}

/**
 * Importa un archivo de respaldo coordinando la persistencia a través de la cola secuencial.
 * Si Firebase está activo, sincroniza de forma atómica en Firestore y actualiza localStorage solo tras el éxito remoto.
 * Retorna los datos y el estado de sincronización, o lanza error si la persistencia falla.
 */
export async function importBackup(file: File): Promise<ImportBackupResult> {
  if (!canWriteToPersistence()) {
    const currentData: ImportBackupResult = {
      voters: readLocal<Voter[]>(LS_KEY_VOTERS, []),
      gamesMap: readLocal<Record<string, Game>>(LS_KEY_GAMES, {}),
      history: readLocal<VotingHistoryRecord[]>(LS_KEY_HISTORY, []),
      steamApiKey: readLocal<string>(LS_KEY_API_KEY, ''),
      syncState: buildReadOnlyState('Solo lectura: no tienes permisos para importar un respaldo'),
    };
    return currentData;
  }

  const data = await readBackupFile(file);
  const cleanVoters = removeUndefinedDeep(data.voters);
  const cleanGamesMap = sanitizeGamesMap(data.gamesMap);
  const cleanGames = Array.isArray(data.games) && data.games.length > 0
    ? data.games.map(sanitizeGame)
    : Object.values(cleanGamesMap);
  const cleanHistory = data.history.map(sanitizeVotingHistoryRecord);
  const cleanApiKey = data.steamApiKey || '';

  const saveLocal = (): boolean => {
    const ok1 = writeLocal(LS_KEY_VOTERS, cleanVoters);
    const ok2 = writeLocal(LS_KEY_GAMES, cleanGamesMap);
    const ok3 = writeLocal(LS_KEY_HISTORY, cleanHistory);
    const ok4 = writeLocal(LS_KEY_API_KEY, cleanApiKey);
    const ok5 = writeLocal(LS_KEY_ACTIVE_VOTING, {
      voters: cleanVoters,
      gamesMap: cleanGamesMap,
      games: cleanGames,
      ...DEFAULT_FREEZE_STATE,
    });
    return ok1 && ok2 && ok3 && ok4 && ok5;
  };

  const syncState = await executeCoordinatedWrite(async () => {
    if (isFirebaseReady()) {
      try {
        const db = getFirestoreInstance()!;
        await syncBackupToFirestore(db, {
          voters: cleanVoters,
          gamesMap: cleanGamesMap,
          games: cleanGames,
          history: cleanHistory,
        });

        // Solo tras el éxito de la escritura remota actualizamos la caché local
        saveLocal();

        if (import.meta.env.DEV) {
          console.log('[Store] Respaldo sincronizado atómicamente en Firestore.');
        }

        return {
          status: 'synced',
          message: `Backup importado y sincronizado: ${cleanVoters.length} integrantes, ${cleanHistory.length} registros`,
        };
      } catch (err) {
        if (isPermissionDeniedError(err)) {
          return {
            status: 'error',
            message: 'Permiso denegado por el servidor: requiere rol de administrador para importar',
          };
        }
        if (import.meta.env.DEV) {
          console.error('[Store] Error sincronizando respaldo en Firestore:', err);
        }
        const errDetail = err instanceof Error ? err.message : 'Error en la sincronización remota';
        return {
          status: 'error',
          message: `Error al sincronizar el respaldo en Firestore: ${errDetail}`,
        };
      }
    }

    // Modo local / sin Firebase configurado
    const ok = saveLocal();
    if (!ok) {
      return {
        status: 'error',
        message: 'Error al guardar el respaldo localmente: almacenamiento no disponible o lleno',
      };
    }
    return {
      status: 'local',
      message: `Backup importado localmente: ${cleanVoters.length} integrantes, ${cleanHistory.length} registros`,
    };
  }, { isBarrier: true });

  if (syncState.status === 'error') {
    throw new Error(syncState.message);
  }

  return {
    voters: cleanVoters,
    gamesMap: cleanGamesMap,
    history: cleanHistory,
    steamApiKey: cleanApiKey,
    syncState,
  };
}

/**
 * Limpia todos los datos (reset) de forma atómica en Firestore y localStorage.
 */
function saveResetAllDataLocal(): boolean {
  const ok1 = removeLocal(LS_KEY_VOTERS);
  const ok2 = removeLocal(LS_KEY_GAMES);
  const ok3 = removeLocal(LS_KEY_HISTORY);
  const ok4 = removeLocal(LS_KEY_API_KEY);
  const ok5 = removeLocal(LS_KEY_ACTIVE_VOTING);
  return ok1 && ok2 && ok3 && ok4 && ok5;
}

function handleResetAllDataFailure(
  err: unknown,
  deletedDocIds: Set<string>,
  totalDocsCount: number
): SyncState {
  removeRecordsFromLocalHistory(deletedDocIds);

  const detail = extractErrorMessage(err, 'Error al restablecer datos en Firestore');

  if (deletedDocIds.size > 0) {
    return {
      status: 'error',
      message: `El restablecimiento quedó incompleto: se eliminaron ${deletedDocIds.size} de ${totalDocsCount} registros del historial en Firestore, pero los datos de integrantes y votación activa no se alteraron (${detail}). Reintenta el restablecimiento para completar la operación.`,
    };
  }

  return handleDestructiveSyncError(err, 'Error al restablecer datos en Firestore');
}

async function executeResetAllDataInFirestore(db: Firestore): Promise<SyncState> {
  const deletedDocIds = new Set<string>();
  let totalDocsCount = 0;

  try {
    const docRef = doc(db, COLLECTION_GROUP, DOC_MIEMBROS);
    const activeDocRef = doc(db, COLLECTION_ACTIVE_VOTING, DOC_ACTIVE_VOTING);

    const historyColRef = collection(db, COLLECTION_HISTORY);
    const historySnap = await getDocs(historyColRef);
    const historyDocs = historySnap.docs;
    totalDocsCount = historyDocs.length;

    const totalOps = 2 + historyDocs.length;

    // CASO 1: Para historiales de hasta 398 documentos (totalOps <= 400), único lote atómico
    if (totalOps <= FIRESTORE_BATCH_LIMIT) {
      const batch = writeBatch(db);
      const now = Timestamp.now();
      batch.set(docRef, { voters: [], gamesMap: {}, lastUpdated: now });
      batch.set(activeDocRef, { voters: [], gamesMap: {}, lastUpdated: now });
      historyDocs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
      registerDocIds(deletedDocIds, historyDocs);
    } else {
      // CASO 2: Para historiales grandes (> 398 documentos):
      // 1. Depuramos bloques iniciales de historial
      const finalBatchHistorySliceSize = FIRESTORE_BATCH_LIMIT - 2;
      const initialDocsCount = historyDocs.length - finalBatchHistorySliceSize;
      const initialHistoryDocs = historyDocs.slice(0, initialDocsCount);
      const finalHistoryDocs = historyDocs.slice(initialDocsCount);

      const deleteOps: BatchOperation[] = initialHistoryDocs.map((d) => (b) => b.delete(d.ref));
      await commitBatchedOperations(db, deleteOps, (startIndex, count) => {
        registerDocIds(deletedDocIds, initialHistoryDocs.slice(startIndex, startIndex + count));
      });

      // 2. Lote final atómico: últimos documentos de historial + reseteo de grupo y sesión
      const finalBatch = writeBatch(db);
      const now = Timestamp.now();
      finalBatch.set(docRef, { voters: [], gamesMap: {}, lastUpdated: now });
      finalBatch.set(activeDocRef, { voters: [], gamesMap: {}, lastUpdated: now });
      finalHistoryDocs.forEach((d) => finalBatch.delete(d.ref));
      await finalBatch.commit();
      registerDocIds(deletedDocIds, finalHistoryDocs);
    }

    saveResetAllDataLocal();
    if (import.meta.env.DEV) {
      console.log('[Store] Datos restablecidos completamente en Firestore.');
    }
    return { status: 'synced', message: 'Datos restablecidos' };
  } catch (err) {
    return handleResetAllDataFailure(err, deletedDocIds, totalDocsCount);
  }
}

/**
 * Limpia todos los datos (reset) de forma atómica en Firestore y localStorage.
 */
export async function resetAllData(): Promise<SyncState> {
  return executeCoordinatedWrite(async () => {
    if (!canWriteToPersistence()) {
      return buildReadOnlyState();
    }

    if (isFirebaseReady()) {
      return executeResetAllDataInFirestore(getFirestoreInstance()!);
    }

    if (!saveResetAllDataLocal()) {
      return { status: 'error', message: 'Error al restablecer datos localmente: almacenamiento no disponible o lleno' };
    }

    return { status: 'local', message: 'Datos restablecidos (modo local)' };
  }, { isBarrier: true });
}