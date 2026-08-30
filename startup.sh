#!/bin/bash
# App Service (Linux, code) startup for Azure Cost Optimizer.
# Installs the ODBC driver (for Azure SQL via pyodbc), ensures the Python venv,
# then launches the FastAPI backend — which also serves the built React SPA
# (frontend/dist) and the Azure service icons (/icons).

# Resolve the app directory from THIS script's own location. With Oryx build enabled, App Service
# runs the app from a compressed build extracted to /tmp/<id> (NOT /home/site/wwwroot), so a
# hardcoded path breaks with "startup.sh: No such file or directory" / missing backend/.
WWWROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── ODBC Driver 18 for SQL Server (needed by pyodbc when DATABASE_PROVIDER=azuresql) ──
# Best-effort install; requires outbound access to packages.microsoft.com. In a
# fully air-gapped (no-egress) private deployment this can fail — the app then
# degrades gracefully (the pyodbc import is guarded). For air-gapped Azure SQL,
# prefer the Container Apps deployment (driver baked into the image) or set the
# app setting DATABASE_PROVIDER=sqlite.
if [ ! -d /opt/microsoft/msodbcsql18 ]; then
    echo "Installing ODBC Driver 18 for SQL Server..."
    DEB_VER=$(. /etc/os-release 2>/dev/null && echo "${VERSION_ID:-12}")
    curl -sSL https://packages.microsoft.com/keys/microsoft.asc -o /etc/apt/trusted.gpg.d/microsoft.asc 2>/dev/null || true
    curl -sSL "https://packages.microsoft.com/config/debian/${DEB_VER}/prod.list" -o /etc/apt/sources.list.d/mssql-release.list 2>/dev/null || true
    apt-get update -y 2>/dev/null || true
    ACCEPT_EULA=Y apt-get install -y msodbcsql18 unixodbc-dev 2>/dev/null \
        || echo "WARN: msodbcsql18 install failed (offline?) — Azure SQL via pyodbc may be unavailable."
fi

# ── Python venv + dependencies (persisted under /home across restarts) ──
# When the deploy script bundled a wheelhouse/, install from it with --no-index so the app
# needs NO outbound access to pypi.org. Otherwise do a normal install.
if [ ! -d "$WWWROOT/antenv" ]; then
    echo "First start: creating venv and installing packages..."
    python -m venv "$WWWROOT/antenv"
    if [ -d "$WWWROOT/wheelhouse" ]; then
        echo "Installing dependencies from the bundled wheelhouse (offline)..."
        "$WWWROOT/antenv/bin/pip" install --no-index --find-links "$WWWROOT/wheelhouse" -r "$WWWROOT/requirements.txt" -q \
            || { echo "ERROR: offline dependency install failed."; exit 1; }
    else
        "$WWWROOT/antenv/bin/pip" install --upgrade pip -q
        "$WWWROOT/antenv/bin/pip" install -r "$WWWROOT/requirements.txt" -q \
            || { echo "ERROR: dependency install failed (no route to pypi.org?)."; exit 1; }
    fi
    echo "Package installation complete."
fi

source "$WWWROOT/antenv/bin/activate"

cd "$WWWROOT/backend"
echo "Starting uvicorn from: $(pwd)"
exec python -m uvicorn main:app --host 0.0.0.0 --port 8000