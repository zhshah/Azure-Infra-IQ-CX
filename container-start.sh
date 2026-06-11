#!/bin/sh
# ==============================================================================
# Azure Infra IQ — combined container entrypoint
#
# Starts TWO processes in one container:
#   1. The embedded ZureMap "Architecture Map" engine   -> :3001 (internal only)
#   2. The main Azure Infra IQ app (API + SPA + icons)  -> :8000 (public ingress)
#
# IDENTITY MODEL (kept deliberately separate):
#   - The APP authenticates to Azure with its MANAGED IDENTITY (DefaultAzureCredential).
#     We therefore must NOT set AZURE_CLIENT_ID/SECRET here (that would force a
#     service-principal path and override the managed identity).
#   - ZureMap uses MANAGED IDENTITY by default. If a secret is provided, it falls back
#     to SERVICE PRINCIPAL mode via ZUREMAP_CLIENT_ID / ZUREMAP_CLIENT_SECRET /
#     ZUREMAP_TENANT_ID (separately named so they never collide with the app's
#     managed identity).
# ==============================================================================
set -e

ZM_DIR=/app/dist/zuremap/browser

# Serve ZureMap under the /zuremap/ subpath: rewrite its <base href> and absolute
# API base so ALL engine traffic stays under /zuremap/* behind the app's
# auth-gated reverse proxy (no unauthenticated /api/az/* on the public ingress).
# Idempotent — safe to run on every container start.
if [ -d "$ZM_DIR" ]; then
  sed -i 's#<base href="/">#<base href="/zuremap/">#g' "$ZM_DIR/index.html" 2>/dev/null || true
  sed -i 's#"/api/az#"/zuremap/api/az#g' "$ZM_DIR"/*.js 2>/dev/null || true
  # De-brand visible engine text (CapCase 'ZureMap' is display-only) + normalise currency.
  sed -i 's/ZureMap/Architecture Map/g' "$ZM_DIR"/*.js 2>/dev/null || true
  sed -i 's/baseCurrency:"EUR"/baseCurrency:"USD"/g' "$ZM_DIR"/*.js 2>/dev/null || true
  # Inject the dark brand skin so the embedded engine matches the app's dark theme.
  # The docker-exec rebrand (_archmap_rebrand) is a NO-OP inside the combined container,
  # so we bake the skin into index.html HERE at startup, before the engine serves it.
  _BRAND_CSS=/srv/app/assets/zuremap_brand.css
  if [ -f "$_BRAND_CSS" ]; then
    python3 - "$ZM_DIR/index.html" "$_BRAND_CSS" <<'PYEOF' 2>/dev/null || true
import re, sys
idx, css_path = sys.argv[1], sys.argv[2]
try:
    html = open(idx, encoding="utf-8").read()
    css = open(css_path, encoding="utf-8").read()
except OSError:
    sys.exit(0)
html = re.sub(r'<style id="brand-skin">.*?</style>', "", html, flags=re.S)
html = html.replace("<title>Zuremap</title>", "<title>Architecture Map</title>")
if "</head>" in html:
    html = html.replace("</head>", '<style id="brand-skin">' + css + "</style></head>", 1)
open(idx, "w", encoding="utf-8").write(html)
PYEOF
  fi
fi

# Authenticate the engine's az CLI for topology scanning. The managed-identity (MSI)
# token endpoint can be briefly unavailable at container boot, so a single attempt
# often fails and leaves the engine with NO az session (map shows "Connected" but stays
# empty). We therefore RETRY in the BACKGROUND until login succeeds, then PIN the
# deployment subscription (the default sub after MSI login may be an empty one) and add
# the resource-graph extension that powers the topology queries. Backgrounded so it never
# blocks the proxy/app startup; the engine shells out to `az` per scan and picks up the
# session as soon as the loop succeeds.
az config set extension.use_dynamic_install=yes_without_prompt 2>/dev/null || true

zm_auth_loop() {
  i=0
  while [ "$i" -lt 60 ]; do
    if [ -n "$ZUREMAP_CLIENT_ID" ] && [ -n "$ZUREMAP_CLIENT_SECRET" ] && [ -n "$ZUREMAP_TENANT_ID" ]; then
      az login --service-principal -u "$ZUREMAP_CLIENT_ID" -p "$ZUREMAP_CLIENT_SECRET" --tenant "$ZUREMAP_TENANT_ID" --output none 2>/dev/null || true
    else
      az login --identity --output none 2>/dev/null || true
    fi
    if az account show >/dev/null 2>&1; then
      # Pin the deployment subscription so the Architecture Map scans the intended scope.
      if [ -n "$AZURE_SUBSCRIPTION_ID" ]; then
        az account set --subscription "$AZURE_SUBSCRIPTION_ID" 2>/dev/null || true
      fi
      az extension add -n resource-graph -y --only-show-errors >/dev/null 2>&1 || true
      echo "[start] Architecture Map: az logged in (scope: $(az account show --query name -o tsv 2>/dev/null))"
      return 0
    fi
    i=$((i + 1))
    sleep 5
  done
  echo "[start] Architecture Map: az login did NOT succeed after retries — topology stays empty until az authenticates"
  return 1
}

if [ -n "$ZUREMAP_CLIENT_ID" ] && [ -n "$ZUREMAP_CLIENT_SECRET" ] && [ -n "$ZUREMAP_TENANT_ID" ]; then
  echo "[start] Architecture Map auth mode: service principal (background login + retry)"
else
  echo "[start] Architecture Map auth mode: managed identity (background login + retry)"
fi
zm_auth_loop &

# Start the ZureMap proxy (port 3001) in the background. Mirror its output to the
# container console (so `az containerapp logs show` surfaces engine errors) AND to
# /tmp/zuremap.log. Without this the engine failed silently and the Architecture
# Map showed "refused to connect" with no diagnosable trace.
echo "[start] launching Architecture Map engine on :3001 ..."
( cd /app && node proxy/server.js 2>&1 | tee /tmp/zuremap.log & )

# Start the main app (port 8000) as the container's MAIN process (signal-forwarded).
echo "[start] launching Azure Infra IQ app on :8000 ..."
cd /srv/app
exec uvicorn main:app --host 0.0.0.0 --port 8000
