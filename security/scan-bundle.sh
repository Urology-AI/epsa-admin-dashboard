#!/usr/bin/env bash
#
# Scan built browser bundles for secrets that must never ship to a client.
#
# The risk this guards against is specific and easy to trip: any env var
# prefixed VITE_ is inlined into the bundle by Vite at build time. One
# mislabelled variable — VITE_REDCAP_TOKEN instead of REDCAP_TOKEN — puts a
# live credential in a file served to every visitor, and nothing else in the
# pipeline would notice.
#
# Usage:  ./scan-bundle.sh <build-dir> [<build-dir> ...]
# Exit:   0 clean, 1 findings, 2 usage/no input.

set -uo pipefail

if [ "$#" -lt 1 ]; then
  echo "usage: $0 <build-dir> [<build-dir> ...]" >&2
  exit 2
fi

FINDINGS=0   # secret patterns matched in built output
ERRORS=0     # scan could not be performed (missing/empty build dir)

# NOTE ON FIREBASE WEB CONFIG
# A Firebase Web API key (AIza...) is NOT a secret. It identifies the project;
# it does not authorize anything. Access is controlled by Firestore/Storage
# rules, which is why the rules test suite exists. Deliberately not flagged —
# flagging it would train everyone to ignore this scanner.

# Pattern | human-readable description
PATTERNS=(
  'BEGIN [A-Z ]*PRIVATE KEY|PEM private key'
  '"type"[[:space:]]*:[[:space:]]*"service_account"|Google service account JSON'
  'private_key_id|Service account private_key_id'
  'libsql://[^"]*authToken|Turso URL with embedded auth token'
  # Require all three JWT segments. Matching a bare "eyJhbGciOi..." header
  # produces false positives: @azure/msal-browser ships a hardcoded JWE header
  # constant ({"alg":"dir","enc":"A256GCM"}) with no payload or signature.
  'eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}|JWT (possible Turso/service token)'
  'AZURE_CLIENT_SECRET|Azure client secret'
  'CLOUDFLARE_API_TOKEN|Cloudflare API token'
  'sk-[A-Za-z0-9]{20,}|Generic provider secret key'
  'ghp_[A-Za-z0-9]{20,}|GitHub personal access token'
)

# REDCap API tokens are 32 uppercase hex chars. Matched only when it looks
# like an assignment, so ordinary 32-char hashes in the bundle do not trip it.
PATTERNS+=(
  '[Rr][Ee][Dd][Cc][Aa][Pp].{0,40}[0-9A-F]{32}|REDCap API token'
)

scan_dir() {
  local dir="$1"

  if [ ! -d "$dir" ]; then
    echo "::error::build directory not found: $dir"
    echo "  (the build step must run before this scan, or the scan is vacuous)"
    ERRORS=$((ERRORS + 1))
    return
  fi

  # An empty build dir would make this scan silently pass and give false
  # assurance forever. Treat it as a failure.
  local file_count
  file_count=$(find "$dir" -type f \( -name '*.js' -o -name '*.mjs' -o -name '*.cjs' -o -name '*.html' -o -name '*.css' -o -name '*.map' -o -name '*.json' \) | wc -l | tr -d ' ')
  if [ "$file_count" -eq 0 ]; then
    echo "::error::no scannable asset files under $dir — build likely failed"
    ERRORS=$((ERRORS + 1))
    return
  fi

  echo "scanning $dir ($file_count files)"

  for entry in "${PATTERNS[@]}"; do
    local pattern="${entry%%|*}"
    local label="${entry#*|}"

    local hits
    hits=$(grep -rlEI "$pattern" "$dir" \
      --include='*.js' --include='*.mjs' --include='*.cjs' \
      --include='*.html' --include='*.css' --include='*.map' --include='*.json' \
      2>/dev/null)

    if [ -n "$hits" ]; then
      echo "::error::$label found in shipped bundle:"
      while IFS= read -r f; do
        echo "    $f"
      done <<< "$hits"
      FINDINGS=$((FINDINGS + 1))
    fi
  done
}

for d in "$@"; do
  scan_dir "$d"
done

if [ "$ERRORS" -gt 0 ]; then
  echo ""
  echo "FAIL: $ERRORS build director(y/ies) could not be scanned."
  echo "Treated as a failure: a scan that inspects nothing must never report OK."
  exit 1
fi

if [ "$FINDINGS" -gt 0 ]; then
  echo ""
  echo "FAIL: $FINDINGS secret pattern(s) present in built output."
  echo "A secret in the bundle is already public to anyone who loaded the page."
  echo "Rotate the credential first, then remove it from the build."
  exit 1
fi

echo "OK: no secret patterns in built output."
exit 0
