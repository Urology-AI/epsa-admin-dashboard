/**
 * Verifies a Microsoft MSAL ID token sent as `Authorization: Bearer <token>`.
 *
 * Server-side env vars required:
 *   AZURE_CLIENT_ID  — your app's Application (client) ID
 *   AZURE_TENANT_ID  — your Azure AD tenant ID
 *
 * Returns the decoded payload on success, or null on any failure.
 */

// Module-level JWKS cache — survives across requests in a warm Worker isolate.
const jwksCache = {};

async function fetchJwks(tenantId) {
  const cached = jwksCache[tenantId];
  if (cached && cached.exp > Date.now()) return cached.keys;
  const res = await fetch(
    `https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`
  );
  if (!res.ok) throw new Error('Failed to fetch JWKS');
  const { keys } = await res.json();
  jwksCache[tenantId] = { keys, exp: Date.now() + 3_600_000 }; // cache 1 h
  return keys;
}

function b64url(s) {
  return atob(s.replace(/-/g, '+').replace(/_/g, '/'));
}

export async function verifyMsalToken(authHeader, env) {
  try {
    if (!authHeader?.startsWith('Bearer ')) return null;
    const token = authHeader.slice(7);

    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const header  = JSON.parse(b64url(parts[0]));
    const payload = JSON.parse(b64url(parts[1]));

    const tenantId = env.AZURE_TENANT_ID;
    const clientId = env.AZURE_CLIENT_ID;
    if (!tenantId || !clientId) return null;

    // Expiry
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;

    // Audience must be our app's client ID (ID token) or contain it
    if (payload.aud !== clientId) return null;

    // Issuer must belong to our tenant
    const validIssuers = [
      `https://login.microsoftonline.com/${tenantId}/v2.0`,
      `https://sts.windows.net/${tenantId}/`,
    ];
    if (!validIssuers.includes(payload.iss)) return null;

    // Verify signature
    const keys = await fetchJwks(tenantId);
    const jwk  = keys.find((k) => k.kid === header.kid && k.use === 'sig');
    if (!jwk) return null;

    const cryptoKey = await crypto.subtle.importKey(
      'jwk', jwk,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false, ['verify']
    );

    const sigBytes  = Uint8Array.from(b64url(parts[2]), (c) => c.charCodeAt(0));
    const dataBytes = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);

    const valid = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5', cryptoKey, sigBytes, dataBytes
    );
    return valid ? payload : null;
  } catch {
    return null;
  }
}

export function unauthorized() {
  return new Response(JSON.stringify({ error: 'Unauthorized' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });
}
