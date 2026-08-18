// Dr. Tewari voice server list via the same-origin Pages Function at
// /voice-servers. Backs the ePSA app's narration settings (which server to
// call for AI-voice synthesis), stored in Firestore at
// appConfig/voiceServers. An MSAL ID token is required.

import { getAuthHeader } from './auth.js';

export async function fetchVoiceServers() {
  const headers = await getAuthHeader();
  const res = await fetch('/voice-servers', { headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function updateVoiceServers(servers) {
  const headers = await getAuthHeader();
  const res = await fetch('/voice-servers', {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ servers }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}
