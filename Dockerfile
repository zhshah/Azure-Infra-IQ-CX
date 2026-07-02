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
# node:20 (cached in the ACR). The grafted ZureMap engine declares engines.node >=22, but
# that is an Angular BUILD-time constraint; the prebuilt engine's RUNTIME (Express 5 proxy)
# runs fine on Node 20 — verified: "ZureMap proxy running on :3001" on node:20-bookworm-slim.
ARG NODE_IMAGE=node:20-bookworm-slim
# ZUREMAP_IMAGE = the ZureMap "Architecture Map" engine image. The deploy script pre-imports
# it into the customer's ACR and passes the ACR copy here, so the build never needs a live
# ghcr.io pull. It is used ONLY as a cross-architecture FILE SOURCE (the `zmengine` stage
# below) — the engine is pure JavaScript (0 native *.node modules), so its /app is COPYied
# onto an amd64 runtime base and runs correctly regardless of the engine image's own arch.
# Declared in GLOBAL scope (before the first FROM) so it resolves in the FROM below.
ARG ZUREMAP_IMAGE=node:20-bookworm-slim
FROM ${NODE_IMAGE} AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ---- ZureMap engine source (cross-arch FILE SOURCE only; never executed during build) -----
# The engine ships as a Node app under /app (pure JS — verified: no native *.node modules).
# The engine image is a SINGLE-ARCH linux/arm64 image, so this FROM pulls it directly; Stage 2
# then COPYies /app out of it. `COPY --from` is architecture-agnostic (it only copies files
# and the stage is never executed), so the JS engine grafts cleanly onto the amd64 runtime and
# needs NO amd64 build of the (now-private) upstream image. (No `--platform` flag here — the
# ACR dependency scanner cannot parse it, and it is unnecessary for a single-arch source.)
FROM ${ZUREMAP_IMAGE} AS zmengine

# ---- Stage 2: combined amd64 runtime (grafted engine + Python backend + SPA + ODBC) --------
# The runtime base is the amd64 Node image (same base the SPA build used, pre-cached in the
# ACR) — NOT the engine image — so the produced image is amd64 and runs on Container Apps.
FROM ${NODE_IMAGE}

# Python 3.11 (bookworm) + venv (Debian PEP 668) + ODBC Driver 18 + Azure CLI.
# The engine (Node) shells out to `az` for topology scanning, so the Azure CLI (amd64) is
# installed fresh here — it CANNOT be copied from the engine image (az has arch-specific
# binaries). Node already exists in the base image; Python powers the FastAPI backend.
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
    && curl -sSL https://aka.ms/InstallAzureCLIDeb | bash \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Graft the pure-JS ZureMap engine (Node app at /app) from the engine image. Cross-arch file
# copy: the arm64 engine's JavaScript runs on the amd64 Node runtime installed above.
COPY --from=zmengine /app /app

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
