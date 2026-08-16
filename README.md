# Azure Cost Optimizer

> **Preview** - Early release. Features and data accuracy are actively being improved.

A self-hosted Azure cost intelligence tool that connects directly to your subscription, pulls real cost and utilisation data, scores every resource 0-100 on actual efficiency, and surfaces savings opportunities in an interactive dashboard. No third-party SaaS, no data leaving your environment.

---

## What it does

Pulls 2 months of real billing data from Azure Cost Management and 30-day utilisation metrics from Azure Monitor for every resource. Each resource gets a 0-100 score based on actual CPU, memory, network, storage, and AI token usage.

The tool flags orphaned resources such as unattached disks, unused IPs, and deallocated VMs. It estimates monthly savings per resource with actionable right-sizing steps and surfaces Azure Advisor recommendations alongside your own scoring. You can export everything to PDF for stakeholder reporting.

The tool runs entirely on your own machine using a read-only service principal. It has no write permissions and no data leaves your environment.

---

## Step 1 - Install the required software

You need four free tools installed before you start. Download and install each one:

| Tool | Download link | Notes |
|------|--------------|-------|
| **Python 3.11 or 3.12** | [python.org/downloads](https://www.python.org/downloads/) | Download **3.12.x** (not 3.13 or 3.14). On the installer, tick **"Add Python to PATH"** before clicking Install |
| **Node.js 18+** | [nodejs.org](https://nodejs.org) | Download the LTS version |
| **Git** | [git-scm.com](https://git-scm.com) | Accept all defaults during install |
| **Azure CLI** | [aka.ms/installazurecliwindows](https://aka.ms/installazurecliwindows) | Used to create the Azure service principal |

After installing, open a new Command Prompt and verify each tool is working:

```
python --version
node --version
git --version
az --version
```

Each command should print a version number. If any of them says "not recognised", restart your PC and try again.

---

## Step 2 - Download the tool

Open Command Prompt and run:

```bat
git clone -b FinOps-16-Aug https://github.com/zhshah/Azure-Infra-IQ-CX.git
cd Azure-Infra-IQ-CX
install.bat
```

`install.bat` sets everything up automatically. It creates a Python environment, installs all packages, and builds the frontend. This takes 2-3 minutes and only needs to be run once.

> **Note:** `-b FinOps-16-Aug` checks out the current release branch. If you omit it you will get the default branch, which does not include the latest FinOps modules.

---

## Step 3 - Create an Azure service principal

The tool needs read-only access to your Azure subscription. You do this by creating a service principal, which is a service account with limited permissions.

In Command Prompt, log in to Azure:

```bat
az login
```

A browser window will open. Sign in with your Azure admin account, then come back to the terminal.

Now run the command below. Replace `YOUR_SUBSCRIPTION_ID` with your actual subscription ID. You can find this in Azure Portal under Subscriptions.

```bat
az ad sp create-for-rbac --name "cost-optimizer-sp" --role "Reader" --scopes "/subscriptions/YOUR_SUBSCRIPTION_ID"
```

The output will look like this:

```json
{
  "appId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "password": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "tenant": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
}
```

Copy and save all three values. You will need them in Step 5.

---

## Step 4 - Assign the required roles

The service principal needs two more roles to read billing and metrics data. Run each command separately, replacing `YOUR_APP_ID` with the `appId` from Step 3 and `YOUR_SUBSCRIPTION_ID` with your subscription ID.

```bat
az role assignment create --assignee YOUR_APP_ID --role "Cost Management Reader" --scope "/subscriptions/YOUR_SUBSCRIPTION_ID"
```

```bat
az role assignment create --assignee YOUR_APP_ID --role "Monitoring Reader" --scope "/subscriptions/YOUR_SUBSCRIPTION_ID"
```

Wait 2-5 minutes after running these before launching the tool. Azure needs a few minutes to apply the roles.

| Role | What it allows |
|------|---------------|
| **Reader** | List all resources in the subscription |
| **Cost Management Reader** | Read billing and cost data |
| **Monitoring Reader** | Read CPU, memory, and usage metrics |

---

## Step 5 - Start the tool

Every time you want to use the tool, run:

```bat
start.bat
```

Your browser will open automatically at `http://localhost:8000`.

On the first run you will see a setup wizard. Fill in the values from Step 3:

| Field | Where it comes from |
|-------|-------------------|
| **Tenant ID** | The `tenant` value from Step 3 |
| **Client ID** | The `appId` value from Step 3 |
| **Client Secret** | The `password` value from Step 3 |
| **Subscription ID** | Azure Portal > Subscriptions > copy the ID |

Click Launch and the tool will connect to your subscription and run the first scan.

---

## Dashboard tabs

| Tab | What it shows |
|-----|--------------|
| **Dashboard** | KPI cards, score distribution, cost trends, resource table, orphans, savings |
| **App Services** | Plans, web apps, function apps with right-size recommendations and idle detection |
| **Storage** | Storage accounts with access patterns, lifecycle policies, and last-access tracking |
| **Reservations** | Reserved Instance coverage, utilisation rates, and right-sizing recommendations |
| **AI Costs** | Cognitive Services and Azure OpenAI / AI Foundry token usage, model requests, per-deployment breakdown |
| **Resource Map** | Visual map of all resources grouped by resource group with connections between them |

---

## Scoring

Each resource receives a 0-100 optimization score calculated from real Azure Monitor metrics.

| Score | Label | Meaning |
|-------|-------|---------|
| 76-100 | **Fully Used** | Well utilised, no action needed |
| 51-75 | **Actively Used** | In use, consider reserved pricing |
| 26-50 | **Likely Waste** | Low activity, review and right-size |
| 0-25 | **Confirmed Waste** | Near-zero activity, candidate for deletion |
| N/A | **Unknown** | No metrics available (diagnostics not enabled) |

Resources with locks, backups, private endpoints, or active reservations are flagged as protected and excluded from waste recommendations regardless of score.

---

## Security

The service principal uses read-only roles only. It has no write access and cannot modify or delete any Azure resources. Credentials are stored locally on your machine and never transmitted anywhere. All API calls go directly from your machine to Azure with no intermediary servers.

---

## Troubleshooting

**Scan returns no resources**

Check that the service principal has the Reader role at subscription scope and that the tenant ID and subscription ID are correct.

**All resources show "Unknown" score**

The service principal is missing the Monitoring Reader role, or Azure Monitor diagnostics are not enabled on your resources.

**Cost data shows $0 for everything**

The service principal is missing the Cost Management Reader role. Cost data can also take 24-48 hours to appear for new subscriptions.

**Token metrics empty on AI Costs tab**

Make sure Monitoring Reader is assigned. Azure AI Foundry metrics use InputTokens and OutputTokens and become available automatically once the role is in place.

**403 errors on first scan**

Role propagation takes 2-5 minutes after creation. Wait a few minutes and click Refresh.

**install.bat fails with "Building wheel for pydantic-core" or "linker link.exe not found"**

Python 3.13 or 3.14 is installed and has no pre-built packages for some dependencies. Install Python 3.12.x from python.org and re-run `install.bat`. The script will automatically detect and use 3.12 even if a newer version is also installed.

---

## Cloud Deployment (Azure App Service)

For production deployments the repo ships a PowerShell script that provisions all required Azure resources — App Service Plan, Web App, Azure SQL, Azure OpenAI, RBAC, and optional private networking — in a single automated run.

> **Script**: `Scripts/deploy-appservice-healthsector-qatarcentral.ps1` (Qatar Central variant)  
> **Generic variant**: `Scripts/deploy-appservice.ps1`

Before running, set execution policy for the session:
```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
```

---

### Option 1 — Public deployment, new OpenAI in same region as App Service

Simplest path. OpenAI is created in the same region as the App Service. Works wherever both App Service and Azure OpenAI are offered together (e.g. `westeurope`, `swedencentral`, `eastus`).

```powershell
.\deploy-appservice.ps1 `
    -ResourceGroupName  "rg-azure-infra-iq" `
    -Location           "westeurope" `
    -WebAppName         "app-infraiq-agent" `
    -AppServicePlanName "asp-infraiq-agent" `
    -EntraAppClientId   "<your-entra-app-client-id>" `
    -EntraTenantId      "<your-tenant-id>" `
    -SubscriptionId     "<your-subscription-id>" `
    -OpenAIMode         "New"
```

`-OpenAIMode New` is the default, so the flag can be omitted. The script will attempt the newest available GPT model (GPT-5.5 → 5.4 → 5.2 → 4.1 → 4o → 4o-mini) at up to 80K TPM GlobalStandard and fall back gracefully.

---

### Option 2 — Public deployment, new OpenAI in a different region

Use this when your App Service region does not offer Azure OpenAI (e.g. Qatar Central). The App Service is deployed locally while OpenAI is created in a capable region such as Sweden Central. Cross-region access is via the public endpoint by default.

```powershell
.\deploy-appservice-healthsector-qatarcentral.ps1 `
    -ResourceGroupName  "rg-azure-infra-iq" `
    -Location           "qatarcentral" `
    -WebAppName         "app-infraiq-agent" `
    -AppServicePlanName "asp-infraiq-agent" `
    -EntraAppClientId   "<your-entra-app-client-id>" `
    -EntraTenantId      "<your-tenant-id>" `
    -SubscriptionId     "<your-subscription-id>" `
    -OpenAIMode         "New" `
    -OpenAILocation     "swedencentral"
```

The `-OpenAILocation` parameter accepts any OpenAI-capable region (`swedencentral`, `westeurope`, `northeurope`, `eastus`, `eastus2`, `francecentral`, `uksouth`, `switzerlandnorth`). If omitted the script defaults to `swedencentral` for Qatar Central deployments.

---

### Option 3 — Private enterprise deployment, new OpenAI in a different region

Full zero-trust private deployment. App Service has no public inbound endpoint (behind a Private Endpoint). Outbound traffic to OpenAI flows through VNet integration. Use this when the App Service region does not offer OpenAI and you need end-to-end private networking.

Two dedicated subnets are required in your VNet:
- **PE subnet** — hosts the inbound Private Endpoint for App Service (no delegation)
- **Integration subnet** — App Service regional VNet integration outbound (delegated to `Microsoft.Web/serverFarms`; script adds delegation automatically)

```powershell
.\deploy-appservice-healthsector-qatarcentral.ps1 `
    -ResourceGroupName  "rg-azure-infra-iq" `
    -Location           "qatarcentral" `
    -WebAppName         "app-infraiq-agent" `
    -AppServicePlanName "asp-infraiq-agent" `
    -EntraAppClientId   "<your-entra-app-client-id>" `
    -EntraTenantId      "<your-tenant-id>" `
    -SubscriptionId     "<your-subscription-id>" `
    `
    -OpenAIMode         "New" `
    -OpenAILocation     "swedencentral" `
    `
    -DeploymentMode                  "Private" `
    -VNetName                        "<vnet-name>" `
    -VNetResourceGroupName           "<vnet-rg>" `
    -PrivateEndpointSubnetName       "<pe-subnet>" `
    -AppServiceIntegrationSubnetName "<integration-subnet>" `
    -PrivateDnsZoneSubscriptionId    "<hub-subscription-id>" `
    -PrivateDnsZoneResourceGroupName "rg-private-dns-zones"
```

When `-PrivateDnsZoneSubscriptionId` and `-PrivateDnsZoneResourceGroupName` are supplied the script reuses any existing Private DNS Zones in that hub RG (enterprise hub/spoke pattern) and only creates zones that are missing. If both parameters are omitted the script prompts interactively and can fall back to creating zones in the deployment subscription.

---

### Option 4 — Private enterprise deployment, existing PTU / Provisioned OpenAI

Use this when you already have a Provisioned Throughput (PTU) or dedicated Azure OpenAI deployment in another subscription or region. The script skips all OpenAI creation steps and wires the App Service directly to the existing resource.

```powershell
.\deploy-appservice-healthsector-qatarcentral.ps1 `
    -ResourceGroupName  "rg-finops-prod-01" `
    -Location           "qatarcentral" `
    -WebAppName         "app-infraiq-agent" `
    -AppServicePlanName "asp-infraiq-agent" `
    -EntraAppClientId   "<app-client-id>" `
    -EntraTenantId      "<tenant-id>" `
    -SubscriptionId     "<subscription-id>" `
    `
    -OpenAIMode           "Existing" `
    -OpenAIResourceName   "<existing-openai-resource-name>" `
    -OpenAIResourceGroup  "<existing-openai-rg>" `
    -OpenAIDeploymentName "<existing-ptu-deployment-name>" `
    `
    -DeploymentMode                  "Private" `
    -VNetName                        "<vnet-name>" `
    -VNetResourceGroupName           "<vnet-rg>" `
    -PrivateEndpointSubnetName       "<pe-subnet>" `
    -AppServiceIntegrationSubnetName "<integration-subnet>" `
    -PrivateDnsZoneSubscriptionId    "<hub-subscription-id>" `
    -PrivateDnsZoneResourceGroupName "rg-private-dns-zones"
```

In `Existing` mode:
- No new OpenAI account or model deployment is created
- `-OpenAILocation` is not required and is never prompted
- The script resolves the endpoint and key from the existing resource via `-OpenAIResourceName` + `-OpenAIResourceGroup`, or you can supply `-OpenAIEndpoint` + `-OpenAIKey` directly to bypass control-plane lookups (useful when the deploying identity cannot read the OpenAI resource)
- RBAC (`Cognitive Services OpenAI User`) is assigned to the App Service Managed Identity on the existing OpenAI resource

---

### App Service private deployment — subnet requirements

| Subnet | Delegation | Minimum size | Purpose |
|--------|-----------|-------------|---------|
| `PrivateEndpointSubnetName` | None | /27 (32 addresses) | Inbound Private Endpoint for App Service + OpenAI PE |
| `AppServiceIntegrationSubnetName` | `Microsoft.Web/serverFarms` | /26 (64 addresses) recommended | App Service outbound VNet integration |

The script automatically adds `Microsoft.Web/serverFarms` delegation to the integration subnet if it is missing and you confirm when prompted.

---

## Contributing

Issues and PRs are welcome. Please open an issue before starting significant work.

---

## License

MIT
