import { initializeApp, getApps } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { FIREBASE_CONFIG } from './env.js';

let app, db;

const isConfigured = Object.values(FIREBASE_CONFIG).every(Boolean);

if (isConfigured) {
  app = getApps().length ? getApps()[0] : initializeApp(FIREBASE_CONFIG);
  db  = getFirestore(app);
}

export { db, isConfigured };
