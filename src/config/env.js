// All env vars for the unified dashboard.
// Copy .env.example → .env.local and fill in values.

export const TURSO_URL        = import.meta.env.VITE_TURSO_URL        || '';
export const TURSO_AUTH_TOKEN = import.meta.env.VITE_TURSO_AUTH_TOKEN || '';
// Firebase (mirrors e-psa frontend config)
export const FIREBASE_CONFIG = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY            || '',
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN        || '',
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID         || '',
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET     || '',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID|| '',
  appId:             import.meta.env.VITE_FIREBASE_APP_ID             || '',
};
