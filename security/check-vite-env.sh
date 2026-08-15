#!/usr/bin/env bash
#
# Refuse VITE_-prefixed environment variables that name a secret.
#
# Vite inlines every VITE_*-prefixed var into the browser bundle at build time.
# The value is then public to anyone who loads the page — no auth, no rules, no
# recovery beyond rotating the credential. Because the value never appears in
# git, a secret scanner over history will never flag it; only a check like this
# one will.
#
# Matches USE of a variable, not any mention of its name. Documenting a past
# exposure ("VITE_TURSO_AUTH_TOKEN used to be inlined here") must not fail the
# build forever, or the check becomes noise that people learn to skip.
#   in code            : import.meta.env.VITE_X, process.env.VITE_X, env.VITE_X
#   in .env / CI yaml  : VITE_X= or VITE_X:
#
# Usage:  ./check-vite-env.sh <path> [<path> ...]
#         paths may be directories or individual files
# Exit:   0 clean (or only baselined findings), 1 new findings, 2 usage.

set -uo pipefail

if [ "$#" -lt 1 ]; then
  echo "usage: $0 <path> [<path> ...]" >&2
  exit 2
fi

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASELINE="${VITE_EXPOSURE_BASELINE:-$HERE/vite-exposure-baseline.txt}"

# Substrings that mark a variable as a credential rather than public config.
SECRETISH='TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|PRIVATE_KEY|SERVICE_ACCOUNT|API_KEY|APIKEY|CLIENT_SECRET|PIN'

# Variables that match SECRETISH but are public by design.
#   VITE_FIREBASE_API_KEY — a Firebase Web API key identifies the project and
#   authorizes nothing on its own; access is governed by firestore.rules and
#   storage.rules. It MUST be in the client bundle for the SDK to work.
PUBLIC_BY_DESIGN='VITE_FIREBASE_API_KEY'

VAR="VITE_[A-Z0-9_]*(${SECRETISH})[A-Z0-9_]*"
CODE_USE="(import\.meta\.env|process\.env|\benv)[[:space:]]*\.[[:space:]]*${VAR}"
DECL="^[[:space:]]*(-[[:space:]]*)?${VAR}[[:space:]]*[:=]"

NEW=0
BASELINED=0

is_baselined() {
  [ -f "$BASELINE" ] || return 1
  grep -qE "^[[:space:]]*$1[[:space:]]*$" "$BASELINE"
}

# Emits "file:line:VARNAME" for each real use.
scan_path() {
  local path="$1"
  local -a args
  if [ -d "$path" ]; then
    args=(-rnEH --binary-files=without-match
          --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=build
          --exclude-dir=.git)
  else
    args=(-nEH --binary-files=without-match)
  fi

  {
    grep "${args[@]}" "$CODE_USE" "$path" 2>/dev/null
    grep "${args[@]}" "$DECL" "$path" 2>/dev/null
  } | while IFS= read -r line; do
    local loc rest lineno text var
    loc="${line%%:*}"
    rest="${line#*:}"
    lineno="${rest%%:*}"
    text="${line#*:*:}"
    var=$(printf '%s' "$text" | grep -oE "$VAR" | head -1)
    [ -n "$var" ] && printf '%s:%s:%s\n' "$loc" "$lineno" "$var"
  done | sort -u
}

for path in "$@"; do
  if [ ! -e "$path" ]; then
    echo "::error::path not found: $path"
    NEW=$((NEW + 1))
    continue
  fi

  while IFS= read -r hit; do
    [ -n "$hit" ] || continue
    var="${hit##*:}"
    loc="${hit%:*}"

    if [[ "$var" =~ ^($PUBLIC_BY_DESIGN)$ ]]; then
      continue
    fi

    if is_baselined "$var"; then
      echo "::warning::[baselined] $var exposed to browser bundle at $loc"
      BASELINED=$((BASELINED + 1))
      continue
    fi

    echo "::error::$var is VITE_-prefixed and ships to the browser — $loc"
    NEW=$((NEW + 1))
  done < <(scan_path "$path")
done

echo ""
if [ "$BASELINED" -gt 0 ]; then
  echo "$BASELINED known exposure(s) from $BASELINE — tracked, not fixed."
fi

if [ "$NEW" -gt 0 ]; then
  echo "FAIL: $NEW NEW credential(s) exposed to the browser bundle via VITE_."
  echo "Move each server-side (Pages Function / Cloud Function) and drop the"
  echo "VITE_ prefix. If it was ever deployed this way, ROTATE it — it has been"
  echo "public since the first build that included it."
  exit 1
fi

echo "OK: no new VITE_-prefixed secrets."
exit 0
