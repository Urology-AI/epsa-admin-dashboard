#!/usr/bin/env bash
#
# Assert that server-only credentials are never READ from browser source.
#
# Complements check-vite-env.sh. That script catches secrets exposed by a VITE_
# prefix; this one catches a secret read from browser code under any name — for
# example `process.env.REDCAP_TOKEN` in a component, which would either be
# undefined at runtime or, worse, inlined by a bundler config change later.
#
# Matching any MENTION of the variable name would be wrong: the dashboard
# legitimately prints these names in error hints ("set FIREBASE_SERVICE_ACCOUNT
# as a Cloudflare Pages environment variable"). A name in help text is not a
# credential. Only an env ACCESS is flagged.
#
# Usage:  ./check-server-secrets.sh <src-dir>
# Exit:   0 clean, 1 findings, 2 usage.

set -uo pipefail

if [ "$#" -lt 1 ]; then
  echo "usage: $0 <src-dir>" >&2
  exit 2
fi

SRC="$1"

if [ ! -d "$SRC" ]; then
  echo "::error::source directory not found: $SRC" >&2
  exit 1
fi

# Credentials that must only ever be read inside functions/ or worker/.
SECRETS=(
  FIREBASE_SERVICE_ACCOUNT
  TURSO_AUTH_TOKEN
  TURSO_URL
  REDCAP_TOKEN
  REDCAP_API_URL
  AZURE_CLIENT_SECRET
)

FINDINGS=0

for name in "${SECRETS[@]}"; do
  # Match an actual read:
  #   import.meta.env.NAME     process.env.NAME     env.NAME
  #   env["NAME"]              context.env.NAME
  pattern="(import\.meta\.env|process\.env|\benv)[[:space:]]*(\.[[:space:]]*${name}\b|\[[[:space:]]*['\"]${name}['\"])"

  hits=$(grep -rnE "$pattern" "$SRC" \
    --include='*.js' --include='*.jsx' --include='*.ts' --include='*.tsx' \
    2>/dev/null)

  if [ -n "$hits" ]; then
    echo "::error::$name is read from browser source — it must stay server-side:"
    while IFS= read -r line; do
      echo "    $line"
    done <<< "$hits"
    FINDINGS=$((FINDINGS + 1))
  fi
done

if [ "$FINDINGS" -gt 0 ]; then
  echo ""
  echo "FAIL: $FINDINGS server-only credential(s) read from $SRC."
  echo "Move the access into a Pages Function under functions/ (or the Worker)"
  echo "and have the browser call that endpoint instead."
  exit 1
fi

echo "OK: no server-only credentials are read from $SRC."
exit 0
