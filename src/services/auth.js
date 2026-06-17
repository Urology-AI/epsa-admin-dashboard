// Returns { Authorization: 'Bearer <id_token>' } for use in fetch calls to Pages Functions.
// Silently refreshes the token if possible; redirects to login if not.

import { msalInstance, loginRequest } from '../config/msal.js';

export async function getAuthHeader() {
  const account = msalInstance.getActiveAccount()
    ?? msalInstance.getAllAccounts()[0]
    ?? null;

  if (!account) throw new Error('Not authenticated');

  const result = await msalInstance.acquireTokenSilent({ ...loginRequest, account });
  // ID token — aud is our client_id, verifiable server-side
  return { Authorization: `Bearer ${result.idToken}` };
}
