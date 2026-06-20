// Firebase initialiser with a graceful localStorage fallback.
//
// If Firebase env vars are present the app uses Firestore (per the spec —
// "保存先：Firebase Firestore"). Otherwise everything still works locally so
// the experience can be demoed without credentials. Firebase is imported
// dynamically so it never weighs down the bundle when unconfigured.

const cfg = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const hasFirebase = Boolean(cfg.apiKey && cfg.projectId);

let _db = null;
export async function db() {
  if (!hasFirebase) return null;
  if (!_db) {
    const { initializeApp } = await import('firebase/app');
    const { getFirestore } = await import('firebase/firestore');
    const app = initializeApp(cfg);
    _db = getFirestore(app);
  }
  return _db;
}
