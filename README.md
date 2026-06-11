<!-- markdownlint-disable MD033 MD041 -->
<div align="center">

# Azure Infra IQ

### AI-Powered Azure Infrastructure Management &amp; Insights

[![Azure](https://img.shields.io/badge/Microsoft-Azure-0078D4?logo=microsoftazure&logoColor=white)](https://azure.microsoft.com/)
[![Azure OpenAI](https://img.shields.io/badge/Azure-OpenAI-412991?logo=openai&logoColor=white)](https://learn.microsoft.com/azure/ai-services/openai/)
[![Container Apps](https://img.shields.io/badge/Azure-Container%20Apps-0078D4?logo=docker&logoColor=white)](https://learn.microsoft.com/azure/container-apps/)
[![Python](https://img.shields.io/badge/Python-3.11-3776AB?logo=python&logoColor=white)](https://www.python.org/)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

**Know your Azure estate. Score every resource. Cut waste, prove resilience, and visualize your architecture — from one AI-powered console.**

</div>

---

Azure Infra IQ is an enterprise, self-hosted platform that connects directly to your
Azure subscriptions, pulls **real cost and utilisation data**, scores every resource
on actual efficiency, assesses **business continuity & disaster recovery (BCDR)**
posture, and uses **Azure OpenAI** to turn raw telemetry into prioritized, executive-grade
recommendations — all behind **Microsoft Entra ID** sign-in with a **Managed Identity**
backend (zero secrets in the cloud).

It deploys to **Azure Container Apps** with a single PowerShell script, in either a
**public** or a fully **private / VNet-integrated** (zero-trust) topology.

## Table of Contents

- [Overview](#overview)
- [Key Features](#-key-features)
- [Architecture](#-architecture)
- [Prerequisites](#-prerequisites)
- [Quick Start — Automated Deployment](#-quick-start--automated-deployment)
- [Private / Enterprise Deployment (Zero-Trust)](#-private--enterprise-deployment-zero-trust)
- [Configuration](#-configuration)
- [Post-Deployment Permissions](#-post-deployment-permissions)
- [Security &amp; Data Privacy](#-security--data-privacy)
- [Local Development](#-local-development)
- [Project Structure](#-project-structure)
- [Troubleshooting](#-troubleshooting)
- [License](#-license)

---

## Overview

Azure Infra IQ ingests **2 months of billing data** from Azure Cost Management and
**30-day utilisation metrics** from Azure Monitor for every resource, then scores each
one **0–100** on real CPU, memory, network, storage and AI-token usage. On top of that
it layers BCDR assessment, AI analysis, dependency mapping, tag governance and an
embedded architecture-diagram engine — in a single, intuitive dashboard.

- **Read-only by design** — the platform never writes to your estate.
- **Your data stays in your tenant** — AI runs on **your** Azure OpenAI resource.
- **No secrets in the cloud** — the backend uses a **Managed Identity**.

---

## 🚀 Key Features

### Resource Efficiency Scoring
Every resource is scored **0–100** and labelled **Not Used → Rarely Used → Actively
Used → Fully Used** from real Cost Management billing and Azure Monitor metrics —
so you can see exactly where money is being wasted.

### Cost Intelligence &amp; Savings
- Current vs. previous month spend, month-over-month trends and deltas
- Cost breakdown by resource group, type and region
- Right-sizing recommendations with **estimated monthly savings** per resource
- Azure Advisor recommendations surfaced alongside the native score

### Orphaned Resource Detection
Flags resources that cost money for nothing — unattached managed disks, unused public
IPs, idle/deallocated VMs, empty resource groups and more — with per-subscription
breakdowns.

### BCDR — Business Continuity &amp; Disaster Recovery Assessment
A dedicated resilience engine that evaluates **zone redundancy, backup protection and
replication** across your estate and produces:
- Quick wins &amp; a prioritized recommendation list
- **Business Impact Analysis** and a **recovery sequence plan**
- DR testing plan, compliance checklist and an **executive summary**
- Exportable **Excel** deliverables

### AI Workload Analysis (Azure OpenAI)
Holistic, estate-wide analysis and per-resource deep dives powered by your **Azure
OpenAI** deployment (newest GPT model your quota allows), streamed live into the UI —
turning scores and signals into clear, prioritized actions.

### Architecture Map
An embedded **Architecture Map** engine renders your Azure architecture interactively,
served same-origin behind the app's auth gate — no separate deployment, no cross-origin
calls.

### Dependency Graph &amp; Blast Radius
Builds a resource dependency graph and computes **blast radius**, so you understand what
a change or outage actually affects before it happens.

### Tag Governance &amp; Sustainability
Required-tag compliance, custom tagging, and a sustainability/carbon view to drive both
governance and green-IT goals.

### Multi-Subscription &amp; Management Group Aware
Dynamically discovers and scans **every subscription** the identity can read, organized
by management-group hierarchy — nothing hard-coded to drift.

### Microsoft Entra Sign-In + Managed Identity
- Users sign in with **Entra ID** (MSAL, SPA, no client secret)
- The backend calls Azure with a **Managed Identity** (`DefaultAzureCredential`) — **zero
  stored keys** in the cloud

### Azure-Native Icons &amp; PDF Reporting
- **700+ official Azure SVG icons** for intuitive navigation and diagrams
- One-click **PDF "Azure Estate Overview Report"** (spend trends, tag sustainability,
  cloud maturity, innovation gaps, licensing, BCDR) for stakeholders

---

## 🏗 Architecture

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                                Azure Infra IQ                                  │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                                │
│   ┌──────────────┐     ┌───────────────────┐     ┌───────────────────────┐    │
│   │  React SPA   │────▶│   FastAPI backend  │────▶│   Azure OpenAI        │    │
│   │  + MSAL.js   │◀────│   Python 3.11      │◀────│   (GPT-5.x / GPT-4.1) │    │
│   │  (Entra SSO) │     │   Uvicorn          │     │   Workload analysis   │    │
│   └──────────────┘     └─────────┬─────────┘     └───────────────────────┘    │
│         │                        │                                            │
│   Entra ID sign-in        Managed Identity                                    │
│         │                        │                                            │
│   ┌──────────────┐     ┌─────────┴──────────────────────────────────────┐    │
│   │ Architecture │     │                  Azure APIs                     │    │
│   │ Map engine   │     ├───────────┬───────────┬───────────┬────────────┤    │
│   │ (embedded)   │     │ Resource  │   Cost    │  Azure    │  Microsoft │    │
│   └──────────────┘     │ Graph     │ Management│  Monitor  │  Graph     │    │
│                        ├───────────┼───────────┼───────────┼────────────┤    │
│   ┌──────────────┐     │ Advisor   │  ARM      │ Defender  │  Mgmt      │    │
│   │ Azure SQL    │     │           │           │           │  Groups    │    │
│   │ + Redis (L2) │     └───────────┴───────────┴───────────┴────────────┘    │
│   └──────────────┘                                                            │
└──────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
                         Your Azure Estate (read-only)
```

### Technology Stack

| Layer | Technology |
|-------|------------|
| **Frontend** | React 18, Vite, Tailwind CSS, MSAL.js (Entra SSO) |
| **Backend** | Python 3.11, FastAPI, Uvicorn |
| **AI** | Azure OpenAI (newest GPT model available — GPT-5.x / GPT-4.1 family) |
| **Data** | Azure SQL (persistence) + Azure Cache for Redis (optional L2 cache) |
| **Azure APIs** | Resource Graph, Cost Management, Monitor, Advisor, ARM, Microsoft Graph, Management Groups |
| **Architecture Map** | Embedded engine, served same-origin behind the auth gate |
| **Container** | Docker → Azure Container Apps |
| **Authentication** | Entra ID (MSAL) for users + Managed Identity for the backend |
| **Icons** | 700+ official Azure service SVG icons |

> The whole solution ships as **one container image** — backend API, built SPA, icon
> library and the Architecture Map engine — so a customer deploys everything in one go.

---

## 📌 Prerequisites

| Requirement | Notes |
|-------------|-------|
| **Azure subscription** | With rights to create resources (Owner or Contributor + User Access Administrator for RBAC/Graph grants) |
| **Azure CLI** | Installed &amp; logged in (`az login`) — [aka.ms/installazurecli](https://aka.ms/installazurecli) |
| **PowerShell 7+** | Recommended (5.1 supported) — the script auto-installs its modules &amp; the `containerapp` extension |
| **Entra ID app registration** | SPA, for user sign-in — see [docs/ENTRA_APP_SETUP.md](docs/ENTRA_APP_SETUP.md) |
| **Azure OpenAI access** | The script creates the resource &amp; deploys a GPT model automatically (Standard SKU — no PTU required) |
| **(Private mode)** | An existing VNet + a dedicated subnet for Container Apps — see [Private Deployment](#-private--enterprise-deployment-zero-trust) |

> **Docker is not required on your machine** — the image is built remotely by Azure
> Container Registry (`az acr build`).

---

## 🚀 Quick Start — Automated Deployment

The fastest path is the included PowerShell script, which provisions everything
end-to-end (RG, ACR + image build, Log Analytics, Container Apps environment, Azure
OpenAI + model, optional SQL/Redis, the Container App with a Managed Identity, all RBAC
&amp; Microsoft Graph permissions, and the Entra redirect URI).

### Step 1 — Clone

```bash
git clone https://github.com/zhshah/Azure-Infra-IQ-CX.git
cd Azure-Infra-IQ-CX
```

### Step 2 — Create the Entra app registration

Follow [docs/ENTRA_APP_SETUP.md](docs/ENTRA_APP_SETUP.md) and note the **Application
(client) ID** and **Directory (tenant) ID**.

### Step 3 — Run the deployment

```powershell
az login
cd Scripts

.\deploy-automated.ps1 `
    -ResourceGroupName  "rg-azure-infra-iq" `
    -Location           "westeurope" `
    -ContainerRegistryName "infraiqacr2026" `
    -ContainerAppName   "azure-infra-iq" `
    -EntraAppClientId   "<your-entra-app-client-id>" `
    -EntraTenantId      "<your-entra-tenant-id>" `
    -SubscriptionId     "<your-subscription-id>"
```

> 💡 **ACR name rule:** `-ContainerRegistryName` must be **alphanumeric, lowercase** —
> no hyphens, dots or underscores (e.g. `infraiqacr2026`).
>
> If you omit `-EntraAppClientId` / `-EntraTenantId`, the script prompts for them.

The script automatically:

1. ✅ Checks prerequisites and installs required PowerShell modules + the `containerapp` extension
2. ✅ Registers resource providers
3. ✅ Creates the Azure Container Registry and **builds + pushes the image remotely**
4. ✅ Creates the Container Apps environment (Log Analytics is optional and disabled by default)
5. ✅ Creates Azure OpenAI and deploys the **newest GPT model** your quota allows (smart TPM ladder)
6. ✅ Creates Azure SQL + Redis *(optional — `-DeploySql $false` / `-DeployRedis $false`)*
7. ✅ Creates the Container App with a **system-assigned Managed Identity**
8. ✅ Assigns RBAC (Reader + Cost Management Reader; tenant-root: Reservations &amp; Management Group Reader)
9. ✅ Grants the required **Microsoft Graph** application permissions
10. ✅ Registers the app URL as an Entra **SPA redirect URI**

**Estimated time:** ~10–15 minutes (most of it the remote image build).

Tip: The script prints a version banner at startup. If you do not see a recent version line, run `git pull` before deploying.

### Step 4 — Sign in

Open the **App URL** printed at the end and sign in with your organizational account.
(If the script could not register the redirect URI, add the app URL under your app
registration → **Authentication → Single-page application**.)

### Key Parameters

| Parameter | Required | Default | Description |
|-----------|:--------:|---------|-------------|
| `-ResourceGroupName` | ✅ | `rg-azure-infra-iq` | Resource group to create/use |
| `-ContainerRegistryName` | ➖ | auto | Globally-unique, **alphanumeric** ACR name |
| `-EntraAppClientId` | ✅ | *(prompted)* | Entra app (client) ID for user sign-in |
| `-EntraTenantId` | ✅ | *(prompted)* | Entra directory (tenant) ID |
| `-Location` | ➖ | `westeurope` | Azure region |
| `-SubscriptionId` | ➖ | current | Target subscription |
| `-SubscriptionIds` | ➖ | deployment subscription | Comma-separated subs to scan; use `auto` to discover all enabled subscriptions |
| `-DiscoverAllSubscriptions` | ➖ | `$false` | Opt-in: discover all enabled subscriptions and grant RBAC across them |
| `-DeploySql` / `-DeployRedis` | ➖ | `$true` | Toggle the optional SQL / Redis resources |
| `-DeploymentMode` | ➖ | `Public` | `Public` or `Private` (see below) |

---

## 🔒 Private / Enterprise Deployment (Zero-Trust)

For customers who require **zero public exposure**, `-DeploymentMode Private` injects
the Container Apps environment into **your** VNet with an **internal-only** load balancer,
wires **Private Endpoints** for the PaaS resources, disables their public network access,
and configures **Private DNS** — including **centralized DNS zones in a different
subscription** (the hub-spoke pattern most enterprises use).

### What gets deployed privately

| Resource | How it's made private | Public access |
|----------|------------------------|:-------------:|
| **Container App** | VNet injection + **internal-only** ingress (no PE needed) | ❌ |
| **Azure OpenAI** | Private Endpoint → `privatelink.openai.azure.com` | ❌ Disabled |
| **Azure SQL** | Private Endpoint → `privatelink.database.windows.net` | ❌ Disabled |
| **Azure Cache for Redis** | Private Endpoint → `privatelink.redis.cache.windows.net` | ❌ Disabled |
| **Private DNS zones** | Reused if they exist (any subscription), created if missing | N/A |
| **DNS → VNet links** | Auto-linked for name resolution | N/A |

> The **Container Registry** is kept public so `az acr build` and the initial image pull
> keep working (an ACR Private Endpoint requires a Premium registry — a separate hardening
> step). Use `-DisablePublicNetworkAccess $false` to wire the PEs but keep public access on.

### Prerequisites for private deployment

1. An existing **VNet** in the same region as the deployment.
2. A dedicated **subnet for Container Apps** (`-SubnetName`):
   - Minimum **/27**, **/23 recommended** for production
   - No other resources in it
   - Delegated to `Microsoft.App/environments` (the script applies this for you)
3. A **subnet for Private Endpoints** — optional; the script **auto-creates `pe-subnet` (/27)**
   if you don't pass `-PrivateEndpointSubnetName` (must differ from the Container Apps subnet).
4. **Network connectivity** from your users to the VNet (VPN Gateway, ExpressRoute or peered VNets).
5. *(Optional)* **Existing Private DNS zones** — if you already run PE-enabled resources
   (e.g. AI Foundry), the script **reuses** them. Point it at where they live with
   `-PrivateDnsZoneSubscriptionId` and `-PrivateDnsZoneResourceGroupName` (it prompts/defaults otherwise).

### Private deployment commands

**Basic** — PE subnet auto-created, DNS zones in the deployment subscription:

```powershell
.\deploy-automated.ps1 `
    -ResourceGroupName  "rg-azure-infra-iq" `
    -Location           "westeurope" `
    -ContainerRegistryName "infraiqacr2026" `
    -ContainerAppName   "azure-infra-iq" `
    -EntraAppClientId   "<your-entra-app-client-id>" `
    -EntraTenantId      "<your-entra-tenant-id>" `
    -SubscriptionId     "<your-subscription-id>" `
    -DeploymentMode     "Private" `
    -VNetResourceGroupName "rg-networking" `
    -VNetName           "corp-vnet" `
    -SubnetName         "container-apps-subnet"
```

**Enterprise** — existing PE subnet + centralized (hub) DNS subscription:

```powershell
.\deploy-automated.ps1 `
    -ResourceGroupName  "rg-azure-infra-iq" `
    -Location           "westeurope" `
    -ContainerRegistryName "infraiqacr2026" `
    -ContainerAppName   "azure-infra-iq" `
    -EntraAppClientId   "<your-entra-app-client-id>" `
    -EntraTenantId      "<your-entra-tenant-id>" `
    -SubscriptionId     "<your-subscription-id>" `
    -DeploymentMode     "Private" `
    -VNetResourceGroupName "rg-networking" `
    -VNetName           "corp-vnet" `
    -SubnetName         "container-apps-subnet" `
    -PrivateEndpointSubnetName       "pe-subnet" `
    -PrivateDnsZoneSubscriptionId    "<hub-subscription-id>" `
    -PrivateDnsZoneResourceGroupName "rg-private-dns-zones"
```

Notes:
- Log Analytics is skipped by default (`--logs-destination none`) so no workspace is created unless you opt in.
- To enable monitoring during deployment, either:
    - pass `-CreateLogAnalyticsWorkspace $true` to create/use `azure-infra-iq-logs`, or
    - pass both `-ExistingLogAnalyticsWorkspaceId` and `-ExistingLogAnalyticsWorkspaceKey` to use an existing workspace.
- Architecture Map (`/zuremap/`) is embedded by default and uses Container App managed identity.
    `-ZureMapClientSecret` is optional and only needed if you want service-principal mode.
- **Container App capacity (SKU) selection** — choose one of two modes:
    - `-CapacityMode Automatic` (default): tries a fallback ladder `D8 x 2 -> D8 x 1 -> D4 x 2 -> D4 x 1 -> Consumption`
      until one succeeds. Most resilient against regional capacity constraints — Consumption is the
      final safety net so the deployment still completes even when all dedicated SKUs are constrained.
    - `-CapacityMode Manual`: uses exactly ONE profile you choose. Faster and deterministic
      (no ladder iteration). Pass `-ManualProfileChoice <1-5>` for non-interactive runs, or omit
      it to get an interactive `1/2/3/4/5` menu:
        - `1` = Consumption (serverless, up to 4 vCPU / 8 GiB) — **lightest; best when a region is capacity-constrained**
        - `2` = D4 x 1 (4 vCPU / 16 GiB, 1 node)
        - `3` = D4 x 2 (4 vCPU / 16 GiB, 2 nodes)
        - `4` = D8 x 1 (8 vCPU / 32 GiB, 1 node)
        - `5` = D8 x 2 (8 vCPU / 32 GiB, 2 nodes)
    - Tip: if West Europe (or any region) is short on dedicated capacity, start with
      `-CapacityMode Manual -ManualProfileChoice 1` (Consumption). The environment is still created as a
      workload-profiles environment, so you can add a D-series profile and move the app later from the
      portal/CLI with no redeploy.

After a private deployment the app URL resolves **only from inside the VNet** (or peered /
on-prem networks via the private DNS). Reach it from a jumpbox/Bastion in the VNet, or over
VPN/ExpressRoute with DNS forwarding to Azure Private DNS.

---

## ⚙️ Configuration

The deployment script sets all of these automatically. They are listed for manual setup,
local development (`backend/.env` — see [.env.example](.env.example)) and troubleshooting.

| Variable | Purpose |
|----------|---------|
| `ENTRA_CLIENT_ID` / `ENTRA_TENANT_ID` | Entra app for **user sign-in** |
| `AUTH_REQUIRED` | `true` enforces the login gate |
| `AI_PROVIDER` | `azure_openai` |
| `AZURE_OPENAI_ENDPOINT` / `AZURE_OPENAI_KEY` / `AZURE_OPENAI_DEPLOYMENT` | Azure OpenAI |
| `AZURE_SUBSCRIPTION_IDS` | `auto` (all readable) or a comma-separated list to scan |
| `DATABASE_PROVIDER` / `AZURE_SQL_CONNECTION_STRING` | Optional Azure SQL persistence |
| `REDIS_URL` | Optional Redis L2 cache |

> In the cloud the backend authenticates to Azure with its **Managed Identity** — no
> `AZURE_CLIENT_SECRET` is ever deployed.

---

## 🔐 Post-Deployment Permissions

The script assigns these to the Container App's **Managed Identity** automatically (a
tenant admin may need to run any that require elevated rights — the script prints the
exact commands for anything it could not apply).

### Azure RBAC (read-only)

| Role | Scope | Why |
|------|-------|-----|
| **Reader** | Each scanned subscription + Tenant Root MG | Inventory &amp; Resource Graph |
| **Cost Management Reader** | Each subscription + Tenant Root MG | Cost &amp; billing data |
| **Reservations Reader** | Tenant Root MG | Reserved-instance inventory |
| **Management Group Reader** | Tenant Root MG | Management-group hierarchy |

### Microsoft Graph (application permissions)

`User.Read.All`, `Directory.Read.All`, `Group.Read.All`, `Device.Read.All`,
`Application.Read.All`, `AuditLog.Read.All`, `Policy.Read.All` — for the Entra ID
overview (users / groups / devices / apps / policies). These require **admin consent**.

---

## 🔒 Security &amp; Data Privacy

| Aspect | Posture |
|--------|---------|
| **Data storage** | No customer estate data is sold or sent to third parties — analysis runs in **your** tenant |
| **AI processing** | **Your** Azure OpenAI resource — data stays in your Azure |
| **Credentials** | Managed Identity in the cloud; **no hardcoded keys or secrets** |
| **Transport** | HTTPS / TLS throughout |
| **Access** | Entra ID sign-in (MFA/Conditional Access supported) + read-only RBAC |
| **Network** | Optional fully-private deployment (Private Endpoints, internal ingress, public access disabled) |

---

## 💻 Local Development

Run the full stack on your machine for development.

```bash
# 1) Backend
cd backend
python -m venv .venv
.venv\Scripts\activate           # Windows  (source .venv/bin/activate on macOS/Linux)
pip install -r requirements.txt
copy ..\.env.example .env        # then fill in .env (see .env.example)

# 2) Frontend
cd ../frontend
npm install
npm run build                    # the backend serves the built SPA

# 3) Run the API (serves the SPA + icons)
cd ../backend
python -m uvicorn main:app --port 8080
```

Open <http://localhost:8080>. With `ENTRA_CLIENT_ID` / `ENTRA_TENANT_ID` set in
`backend/.env` (and `http://localhost:8080` added as a SPA redirect URI), the Entra login
gate appears locally exactly as in the cloud; leave them blank to run open.

---

## 📁 Project Structure

```
├── Dockerfile                  # Single combined image (SPA + backend + icons + Architecture Map)
├── container-start.sh          # Entrypoint — starts the engine (:3001) + API (:8000)
├── .env.example                # Local environment template (no secrets)
├── backend/                    # FastAPI app
│   ├── main.py                 # API + SPA/icons serving + Entra auth gate
│   ├── requirements.txt        # Python dependencies
│   ├── models/  services/      # Schemas + scoring, cost, BCDR, AI, tagging, auth services
│   └── migrations/             # Azure SQL schema
├── frontend/                   # React + Vite SPA
│   ├── src/                    # Components, auth (MSAL), styles
│   └── package.json
├── Icons/                      # 700+ official Azure service SVG icons
├── Scripts/
│   ├── deploy-automated.ps1                    # One-touch deploy (Public + Private/Enterprise)
│   └── grant-graph-permissions-containerapp.ps1 # Standalone Graph permission grant
└── docs/
    └── ENTRA_APP_SETUP.md      # Entra ID app registration guide
```

---

## 🔧 Troubleshooting

| Symptom | Resolution |
|---------|------------|
| **Login loop / redirect error** | Ensure the app URL is a **SPA** redirect URI on the Entra app registration |
| **No subscriptions / data** | Assign **Reader** + **Cost Management Reader** to the Managed Identity, then wait 2–5 min |
| **Entra overview empty (users/groups/devices)** | Grant the **Microsoft Graph** application permissions + admin consent (or run `Scripts/grant-graph-permissions-containerapp.ps1`) |
| **OpenAI errors** | Confirm the Azure OpenAI resource + a GPT model deployed; check quota |
| **ACR build fails on Windows** | Run the script **directly** (don't pipe its output); it sets a UTF-8 console for `az acr build` |
| **Private app URL won't resolve** | You must be inside the VNet (jumpbox/Bastion) or on VPN/ExpressRoute with DNS forwarding to Azure Private DNS |
| **View logs** | `az containerapp logs show --name <app> --resource-group <rg> --follow` |

---

## 📄 License

Licensed under the **MIT License** — see [LICENSE](LICENSE).

<div align="center">

**Azure Infra IQ** — Know your estate. Cut waste. Prove resilience.

</div>
