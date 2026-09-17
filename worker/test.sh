#!/bin/bash
# Test the REDCap proxy Worker — both local and deployed.
# Usage: bash test.sh
# Requires: wrangler dev running in another terminal for local test.

set -a
source .dev.vars
set +a

LOCAL="http://localhost:8787"
DEPLOYED="https://epsa-redcap-proxy.e-psa.workers.dev"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "1) LOCAL  — $LOCAL/records"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
curl -s "$LOCAL/records" \
  -H "Authorization: Bearer ${DASHBOARD_SECRET}" | head -c 500
echo -e "\n"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "2) DEPLOYED — $DEPLOYED/records"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
curl -s "$DEPLOYED/records" \
  -H "Authorization: Bearer ${DASHBOARD_SECRET}" | head -c 500
echo -e "\n"
