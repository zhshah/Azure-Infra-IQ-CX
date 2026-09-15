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
#   - ZureMap authenticates its `az` CLI with a SERVICE PRINCIPAL supplied via
#     ZUREMAP_CLIENT_ID / ZUREMAP_CLIENT_SECRET / ZUREMAP_TENANT_ID (separately named
#     so they never collide with the app's managed identity).
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

# Authenticate the engine's az CLI non-interactively (service principal). Runs
# BEFORE the engine starts so its first login-status poll already succeeds.
if [ -n "$ZUREMAP_CLIENT_ID" ] && [ -n "$ZUREMAP_CLIENT_SECRET" ] && [ -n "$ZUREMAP_TENANT_ID" ]; then
  az login --service-principal -u "$ZUREMAP_CLIENT_ID" -p "$ZUREMAP_CLIENT_SECRET" --tenant "$ZUREMAP_TENANT_ID" --output none 2>/dev/null || true
  az config set extension.use_dynamic_install=yes_without_prompt 2>/dev/null || true
  ( az extension add -n resource-graph -y --only-show-errors >/dev/null 2>&1 & )
else
  # Embedded (managed-identity) mode — no ZureMap service principal. Log the engine's az CLI in
  # with the Container App's MANAGED IDENTITY so the Architecture Map can enumerate subscriptions.
  # IMPORTANT: `az login --identity` caches the subscription list AT LOGIN TIME. A login during the
  # brief window before the tenant-root Reader RBAC has propagated only sees the deployment
  # subscription — which is why "Select all" showed a single sub. Re-login a few times in the
  # background as RBAC settles so the picker ends up listing EVERY subscription the MI can read.
  az config set extension.use_dynamic_install=yes_without_prompt 2>/dev/null || true
  az login --identity --output none 2>/dev/null || true
  ( az extension add -n resource-graph -y --only-show-errors >/dev/null 2>&1 & )
  (
    _i=0
    while [ "$_i" -lt 8 ]; do
      sleep 60
      az login --identity --output none 2>/dev/null || true
      _i=$((_i+1))
    done
  ) &
fi

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
