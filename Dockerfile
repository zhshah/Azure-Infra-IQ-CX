# syntax=docker/dockerfile:1
# ==============================================================================
# Azure Infra IQ — SINGLE combined runtime image (Container Apps)
#
# ONE image that contains EVERYTHING, so a customer deploys the whole solution in
# one go (no sidecar, no separate ZureMap deployment):
#   - FastAPI backend (API)              -> /srv/app        (uvicorn :8000, public)
#   - Built React SPA                    -> /srv/frontend/dist (served by backend)
#   - Azure service icon library         -> /srv/Icons         (served by backend)
#   - ODBC Driver 18                     -> pyodbc / Azure SQL
#   - ZureMap "Architecture Map" engine  -> /app  (node proxy :3001, internal)
#
# The image is BASED ON the ZureMap engine image (Debian 12 + Node + Azure CLI +
# the engine app at /app) and ADDS Python + the backend on top, so the embedded
# Architecture Map ships inside the same image. A single entrypoint starts both.
#
# main.py resolves the SPA at Path(__file__).parent.parent/"frontend"/"dist" and
# icons at Path(__file__).parent.parent/"Icons" — i.e. one level above the backend
# dir — hence the backend lives at /srv/app and SPA/icons at /srv/{frontend/dist,Icons}.
#
# Build context = repository root:   docker build -t azure-infra-iq .
# ==============================================================================

# ---- Stage 1: build the React SPA --------------------------------------------
# NODE_IMAGE is overridable so the deploy script can point this at a copy of the
# Node base image pre-imported into the customer's ACR — this avoids the Docker Hub
# anonymous pull rate limit ('toomanyrequests') on shared ACR build agents.
ARG NODE_IMAGE=node:20-bookworm-slim
# ZUREMAP_IMAGE (the Stage-2 runtime base) MUST be declared here in the GLOBAL scope, i.e.
# BEFORE the first FROM, so it can be referenced in the Stage-2 `FROM ${ZUREMAP_IMAGE}` below.
# An ARG declared after a FROM is stage-scoped and resolves to BLANK in a later FROM
# ('base name should not be blank'). The deploy script overrides it with an ACR copy.
ARG ZUREMAP_IMAGE=ghcr.io/natechsa/zuremap:latest
FROM ${NODE_IMAGE} AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ---- Stage 2: combined runtime (ZureMap engine + Python backend + SPA + ODBC) -
# ZUREMAP_IMAGE is overridable so the deploy script can point this at a copy of the
# ZureMap engine image pre-imported into the customer's ACR. This avoids depending on a
# live anonymous pull from ghcr.io during the build — which can fail with 'denied' /
# 'toomanyrequests' on shared ACR build agents, or if the upstream package's visibility
# changes. The deploy script imports it into the ACR (with optional GHCR credentials) and
# passes the ACR copy here; the default keeps the original public source.
# (ZUREMAP_IMAGE is declared in the GLOBAL scope near the top of this file — required so it
# can be substituted into this FROM. Do NOT re-declare it here or it resolves to blank.)
FROM ${ZUREMAP_IMAGE}

# Python 3.11 (bookworm default) + venv (Debian PEP 668) + ODBC Driver 18.
# Node and the Azure CLI already exist in the base ZureMap image.
# NOTE: Microsoft's prod.list pins signed-by=/usr/share/keyrings/microsoft-prod.gpg,
# so the signing key MUST be dearmored to that exact path (writing it to
# trusted.gpg.d does NOT satisfy the repo's signed-by and fails with NO_PUBKEY).
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
         python3 python3-venv python3-pip \
         curl gnupg ca-certificates apt-transport-https unixodbc-dev \
    && curl -sSL https://packages.microsoft.com/keys/microsoft.asc | gpg --dearmor -o /usr/share/keyrings/microsoft-prod.gpg \
    && curl -sSL https://packages.microsoft.com/config/debian/12/prod.list -o /etc/apt/sources.list.d/mssql-release.list \
    && apt-get update \
    && ACCEPT_EULA=Y apt-get install -y --no-install-recommends msodbcsql18 \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Python deps in an isolated venv (avoids Debian's externally-managed-environment).
COPY backend/requirements.txt /srv/app/requirements.txt
RUN python3 -m venv /srv/venv \
    && /srv/venv/bin/pip install --no-cache-dir --upgrade pip \
    && /srv/venv/bin/pip install --no-cache-dir -r /srv/app/requirements.txt
ENV PATH="/srv/venv/bin:${PATH}"

# Backend at /srv/app; SPA + icons one level up (/srv) to match main.py's path logic.
COPY backend/ /srv/app/
COPY --from=web /web/dist /srv/frontend/dist
COPY Icons /srv/Icons

# Combined entrypoint (ZureMap engine :3001 + app :8000). Strip any CR so the
# shebang works regardless of the host that committed the file.
COPY container-start.sh /srv/start.sh
RUN sed -i 's/\r$//' /srv/start.sh && chmod +x /srv/start.sh

EXPOSE 8000
ENTRYPOINT []
CMD ["/srv/start.sh"]
