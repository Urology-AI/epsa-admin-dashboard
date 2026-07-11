// App feature flags via the same-origin Pages Function at /feature-flags.
// Backs the ePSA app's runtime toggles (e.g. biomarkersEnabled), stored in
// Firestore at appConfig/featureFlags. An MSAL ID token is required.

import { getAuthHeader } from './auth.js';

export async function fetchFeatureFlags() {
  const headers = await getAuthHeader();
  const res = await fetch('/feature-flags', { headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function updateFeatureFlags(updates) {
  const headers = await getAuthHeader();
  const res = await fetch('/feature-flags', {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}
