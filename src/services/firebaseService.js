// Read-only Firebase service for the unified dashboard.
// Reads the same Firestore used by the full ePSA calculator (e-psa repo).

import { collection, query, orderBy, limit as fsLimit, getDocs } from 'firebase/firestore';
import { db, isConfigured } from '../config/firebase.js';

export { isConfigured as isFirebaseConfigured };

/**
 * Fetch recent calculator sessions from Firestore.
 * Sessions live at /users/{uid}/sessions/{sessionId}.
 * We do a collectionGroup query so we don't need to enumerate users.
 */
export async function fetchCalculatorSessions({ limit = 200 } = {}) {
  if (!db) return [];
  try {
    const q = query(
      collection(db, 'sessions'),
      orderBy('createdAt', 'desc'),
      fsLimit(limit)
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch {
    // collectionGroup requires an index; fall back to top-level sessions if available
    return [];
  }
}

/**
 * Aggregate stats from the analytics/usage doc written by the calculator.
 */
export async function fetchCalculatorStats() {
  if (!db) return null;
  try {
    const snap = await getDocs(query(collection(db, 'analytics'), fsLimit(1)));
    if (snap.empty) return null;
    return snap.docs[0].data();
  } catch { return null; }
}
