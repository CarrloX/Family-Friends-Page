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
import type { Voter, Game, VotingHistoryRecord } from '../types/voting';

// ============================================================
// Constantes para localStorage (fallback)
// ============================================================
const LS_KEY_VOTERS = 'steam_voting_voters_v1';
const LS_KEY_GAMES = 'steam_voting_games_v1';
const LS_KEY_HISTORY = 'steam_voting_history_v1';
const LS_KEY_API_KEY = 'steam_voting_api_key_v1';

// ============================================================
// Tipos de estado de sincronización
// ============================================================
export type SyncStatus = 'idle' | 'saving' | 'synced' | 'error' | 'local';

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
    console.warn(`[DataStore] Error escribiendo en localStorage (${key}):`, err);
  }
}

function removeLocal(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // ignorar
  }
}

// ============================================================
// Colecciones de Firestore
// ============================================================
const COLLECTION_GROUP = 'grupo';
const DOC_MIEMBROS = 'miembros';
const COLLECTION_HISTORY = 'votaciones_pasadas';

// ============================================================
// Interfaz del documento en Firestore para el grupo
// ============================================================
interface GrupoDocument {
  voters: Voter[];
  gamesMap: Record<string, Game>;
  lastUpdated: Timestamp;
}

// ============================================================
// Servicio de Persistencia
// ============================================================

/**
 * Guarda la lista de votantes. Prioriza Firestore, fallback a localStorage.
 */
export async function saveVoters(voters: Voter[]): Promise<SyncState> {
  if (isFirebaseReady()) {
    try {
      const db = getFirestoreInstance()!;
      const docRef = doc(db, COLLECTION_GROUP, DOC_MIEMBROS);
      await setDoc(
        docRef,
        { voters, lastUpdated: Timestamp.now() },
        { merge: true }
      );
      console.log('[DataStore] Votantes sincronizados con Firestore.');
      return { status: 'synced', message: 'Sincronizado con la nube' };
    } catch (err) {
      console.warn('[DataStore] Error sincronizando votantes, usando localStorage:', err);
      writeLocal(LS_KEY_VOTERS, voters);
      return { status: 'local', message: 'Guardado localmente (sin conexión)' };
    }
  }
  writeLocal(LS_KEY_VOTERS, voters);
  return { status: 'local', message: 'Guardado localmente' };
}

/**
 * Carga la lista de votantes. Prioriza Firestore, fallback a localStorage.
 */
export async function loadVoters(): Promise<Voter[]> {
  if (isFirebaseReady()) {
    try {
      const db = getFirestoreInstance()!;
      const docRef = doc(db, COLLECTION_GROUP, DOC_MIEMBROS);
      const snap = await getDoc(docRef);
      if (snap.exists()) {
        const data = snap.data() as GrupoDocument;
        if (Array.isArray(data.voters) && data.voters.length > 0) {
          console.log('[DataStore] Votantes cargados desde Firestore.');
          // Actualizar caché local
          writeLocal(LS_KEY_VOTERS, data.voters);
          return data.voters;
        }
      }
    } catch (err) {
      console.warn('[DataStore] Error cargando votantes de Firestore, usando localStorage:', err);
    }
  }
  return readLocal<Voter[]>(LS_KEY_VOTERS, []);
}

/**
 * Guarda el mapa de juegos. Prioriza Firestore, fallback a localStorage.
 */
export async function saveGames(gamesMap: Record<string, Game>): Promise<SyncState> {
  if (isFirebaseReady()) {
    try {
      const db = getFirestoreInstance()!;
      const docRef = doc(db, COLLECTION_GROUP, DOC_MIEMBROS);
      await setDoc(
        docRef,
        { gamesMap, lastUpdated: Timestamp.now() },
        { merge: true }
      );
      console.log('[DataStore] Juegos sincronizados con Firestore.');
      return { status: 'synced', message: 'Sincronizado con la nube' };
    } catch (err) {
      console.warn('[DataStore] Error sincronizando juegos, usando localStorage:', err);
      writeLocal(LS_KEY_GAMES, gamesMap);
      return { status: 'local', message: 'Guardado localmente (sin conexión)' };
    }
  }
  writeLocal(LS_KEY_GAMES, gamesMap);
  return { status: 'local', message: 'Guardado localmente' };
}

/**
 * Carga el mapa de juegos. Prioriza Firestore, fallback a localStorage.
 */
export async function loadGames(): Promise<Record<string, Game>> {
  if (isFirebaseReady()) {
    try {
      const db = getFirestoreInstance()!;
      const docRef = doc(db, COLLECTION_GROUP, DOC_MIEMBROS);
      const snap = await getDoc(docRef);
      if (snap.exists()) {
        const data = snap.data() as GrupoDocument;
        if (data.gamesMap && typeof data.gamesMap === 'object') {
          console.log('[DataStore] Juegos cargados desde Firestore.');
          writeLocal(LS_KEY_GAMES, data.gamesMap);
          return data.gamesMap;
        }
      }
    } catch (err) {
      console.warn('[DataStore] Error cargando juegos de Firestore, usando localStorage:', err);
    }
  }
  return readLocal<Record<string, Game>>(LS_KEY_GAMES, {});
}

/**
 * Agrega un registro al historial de votaciones. Firestore usa addDoc, localStorage usa array.
 */
export async function addHistoryRecord(record: VotingHistoryRecord): Promise<SyncState> {
  if (isFirebaseReady()) {
    try {
      const db = getFirestoreInstance()!;
      const colRef = collection(db, COLLECTION_HISTORY);
      await addDoc(colRef, {
        ...record,
        date: record.date,
        savedAt: Timestamp.now(),
      });
      console.log('[DataStore] Historial sincronizado con Firestore.');
      return { status: 'synced', message: 'Sincronizado con la nube' };
    } catch (err) {
      console.warn('[DataStore] Error sincronizando historial, usando localStorage:', err);
      const history = readLocal<VotingHistoryRecord[]>(LS_KEY_HISTORY, []);
      history.unshift(record);
      writeLocal(LS_KEY_HISTORY, history);
      return { status: 'local', message: 'Guardado localmente (sin conexión)' };
    }
  }
  const history = readLocal<VotingHistoryRecord[]>(LS_KEY_HISTORY, []);
  history.unshift(record);
  writeLocal(LS_KEY_HISTORY, history);
  return { status: 'local', message: 'Guardado localmente' };
}

/**
 * Carga todo el historial de votaciones. Prioriza Firestore, fallback a localStorage.
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
          records.push(data);
        });
        console.log('[DataStore] Historial cargado desde Firestore.');
        writeLocal(LS_KEY_HISTORY, records);
        return records;
      }
    } catch (err) {
      console.warn('[DataStore] Error cargando historial de Firestore, usando localStorage:', err);
    }
  }
  return readLocal<VotingHistoryRecord[]>(LS_KEY_HISTORY, []);
}

/**
 * Elimina un registro específico del historial por su ID.
 */
export async function deleteHistoryRecord(recordId: string): Promise<SyncState> {
  if (isFirebaseReady()) {
    try {
      const db = getFirestoreInstance()!;
      const colRef = collection(db, COLLECTION_HISTORY);
      const snap = await getDocs(colRef);
      const docToDelete = snap.docs.find((d) => d.data().id === recordId);
      if (docToDelete) {
        await deleteDoc(docToDelete.ref);
        console.log(`[DataStore] Registro ${recordId} eliminado de Firestore.`);
      }
    } catch (err) {
      console.warn('[DataStore] Error eliminando registro de Firestore:', err);
    }
  }

  // Actualizar localStorage
  const history = readLocal<VotingHistoryRecord[]>(LS_KEY_HISTORY, []);
  const updated = history.filter((r) => r.id !== recordId);
  writeLocal(LS_KEY_HISTORY, updated);
  return { status: 'synced', message: 'Registro eliminado' };
}

/**
 * Limpia el historial de votaciones en Firestore y localStorage.
 */
export async function clearHistory(): Promise<SyncState> {
  if (isFirebaseReady()) {
    try {
      const db = getFirestoreInstance()!;
      const colRef = collection(db, COLLECTION_HISTORY);
      const snap = await getDocs(colRef);
      const deletePromises = snap.docs.map((d) => deleteDoc(d.ref));
      await Promise.all(deletePromises);
      console.log('[DataStore] Historial limpiado en Firestore.');
    } catch (err) {
      console.warn('[DataStore] Error limpiando historial en Firestore:', err);
    }
  }
  removeLocal(LS_KEY_HISTORY);
  return { status: 'synced', message: 'Historial limpiado' };
}

/**
 * Guarda la API key de Steam (solo localStorage, por seguridad).
 */
export function saveApiKey(apiKey: string): void {
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
  if (typeof d.steamApiKey !== 'undefined' && typeof d.steamApiKey !== 'string') return false;

  return true;
}

/**
 * Exporta todos los datos como archivo JSON descargable.
 */
export function exportBackup(): void {
  try {
    const data: BackupData = {
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      voters: readLocal<Voter[]>(LS_KEY_VOTERS, []),
      gamesMap: readLocal<Record<string, Game>>(LS_KEY_GAMES, {}),
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
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    console.log(`[DataStore] Backup exportado: ${BACKUP_FILENAME}`);
  } catch (err) {
    console.error('[DataStore] Error al exportar backup:', err);
    throw new Error('No se pudo exportar el backup.');
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
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    console.log('[DataStore] Backup descargado desde datos en memoria.');
  } catch (err) {
    console.error('[DataStore] Error al descargar backup:', err);
    throw new Error('No se pudo descargar el backup.');
  }
}

/**
 * Lee un archivo JSON y devuelve los datos parseados.
 */
export function readBackupFile(file: File): Promise<BackupData> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        const data = JSON.parse(text);

        if (!isValidBackup(data)) {
          reject(new Error('El archivo no tiene un formato de backup válido.'));
          return;
        }

        resolve(data);
      } catch {
        reject(new Error('No se pudo leer el archivo. Asegúrate de que sea un JSON válido.'));
      }
    };

    reader.onerror = () => {
      reject(new Error('Error al leer el archivo.'));
    };

    reader.readAsText(file);
  });
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
      await setDoc(docRef, {
        voters: data.voters,
        gamesMap: data.gamesMap,
        lastUpdated: Timestamp.now(),
      });

      // Reemplazar historial: limpiar y volver a insertar
      const colRef = collection(db, COLLECTION_HISTORY);
      const snap = await getDocs(colRef);
      const deletePromises = snap.docs.map((d) => deleteDoc(d.ref));
      await Promise.all(deletePromises);

      for (const record of data.history) {
        await addDoc(colRef, {
          ...record,
          savedAt: Timestamp.now(),
        });
      }

      console.log('[DataStore] Backup importado y sincronizado con Firestore.');
    } catch (err) {
      console.warn('[DataStore] Error sincronizando backup con Firestore:', err);
    }
  }

  console.log(`[DataStore] Backup importado: ${data.voters.length} votantes, ${data.history.length} registros.`);

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
  removeLocal(LS_KEY_VOTERS);
  removeLocal(LS_KEY_GAMES);
  removeLocal(LS_KEY_HISTORY);
  removeLocal(LS_KEY_API_KEY);

  if (isFirebaseReady()) {
    try {
      const db = getFirestoreInstance()!;
      // Limpiar documento de grupo
      const docRef = doc(db, COLLECTION_GROUP, DOC_MIEMBROS);
      await setDoc(docRef, { voters: [], gamesMap: {}, lastUpdated: Timestamp.now() });

      // Limpiar historial
      const colRef = collection(db, COLLECTION_HISTORY);
      const snap = await getDocs(colRef);
      const deletePromises = snap.docs.map((d) => deleteDoc(d.ref));
      await Promise.all(deletePromises);
      console.log('[DataStore] Datos reseteados en Firestore.');
    } catch (err) {
      console.warn('[DataStore] Error reseteando datos en Firestore:', err);
    }
  }
}