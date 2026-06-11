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
fi

# Authenticate the engine's az CLI non-interactively BEFORE it starts so the first
# login-status poll succeeds.
if [ -n "$ZUREMAP_CLIENT_ID" ] && [ -n "$ZUREMAP_CLIENT_SECRET" ] && [ -n "$ZUREMAP_TENANT_ID" ]; then
  echo "[start] Architecture Map auth mode: service principal"
  az login --service-principal -u "$ZUREMAP_CLIENT_ID" -p "$ZUREMAP_CLIENT_SECRET" --tenant "$ZUREMAP_TENANT_ID" --output none 2>/dev/null || true
else
  echo "[start] Architecture Map auth mode: managed identity"
  az login --identity --output none 2>/dev/null || true
fi
az config set extension.use_dynamic_install=yes_without_prompt 2>/dev/null || true
( az extension add -n resource-graph -y --only-show-errors >/dev/null 2>&1 & )

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
