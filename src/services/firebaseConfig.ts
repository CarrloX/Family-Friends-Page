import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getFirestore, type Firestore } from 'firebase/firestore';

/**
 * Configuración de Firebase Firestore.
 *
 * ⚠️ IMPORTANTE: Reemplaza los valores de ejemplo con las credenciales
 * de tu proyecto de Firebase antes de usar la sincronización en la nube.
 *
 * Para obtener estas credenciales:
 * 1. Ve a https://console.firebase.google.com/
 * 2. Crea o selecciona tu proyecto
 * 3. Ve a Configuración del proyecto > General > Tus apps > Web
 * 4. Copia el objeto "firebaseConfig"
 */
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

let app: FirebaseApp | null = null;
let db: Firestore | null = null;
let isConfigured = false;

/**
 * Inicializa Firebase si las credenciales han sido configuradas.
 * Detecta automáticamente si las llaves siguen siendo las de ejemplo.
 */
export function initFirebase(): { db: Firestore | null; isConfigured: boolean } {
  if (app) return { db, isConfigured };

  const hasRealKeys =
    firebaseConfig.apiKey &&
    !firebaseConfig.apiKey.includes('XXXXXXXX') &&
    firebaseConfig.projectId &&
    !firebaseConfig.projectId.includes('tu-proyecto');

  if (!hasRealKeys) {
    console.warn(
      '[Firebase] Credenciales no configuradas. Usando localStorage como respaldo.'
    );
    return { db: null, isConfigured: false };
  }

  try {
    app = initializeApp(firebaseConfig);
    db = getFirestore(app);
    isConfigured = true;

    // Opcional: conectar con emulador local para desarrollo
    // if (process.env.NODE_ENV === 'development') {
    //   connectFirestoreEmulator(db, 'localhost', 8080);
    // }

    console.log('[Firebase] Firestore inicializado correctamente.');
  } catch (err) {
    console.error('[Firebase] Error al inicializar:', err);
    app = null;
    db = null;
    isConfigured = false;
  }

  return { db, isConfigured };
}

/**
 * Retorna la instancia actual de Firestore, o null si no está configurada.
 */
export function getFirestoreInstance(): Firestore | null {
  if (!app) {
    const result = initFirebase();
    return result.db;
  }
  return db;
}

/**
 * Verifica si Firebase está configurado y listo para usar.
 * Inicializa automáticamente si es la primera vez que se llama.
 */
export function isFirebaseReady(): boolean {
  if (!app) {
    initFirebase();
  }
  return isConfigured && db !== null;
}
