<#
.SYNOPSIS
    Automated Azure App Service deployment for Azure Cost Optimizer
    
.DESCRIPTION
    This script automates the complete deployment of Azure Cost Optimizer
    to Azure App Service with optional private networking support (Private Endpoints).
    
    This is the App Service-based deployment model, an alternative to the Container App
    deployment in deploy-automated.ps1. Use this for simpler deployments or when
    containerization is not required.
    
    DEPLOYMENT MODES:
    ─────────────────
    PUBLIC MODE (Default):
      - App Service accessible from internet
      - Azure OpenAI accessible from internet (using AAD authentication)
      - Simplest deployment option
      
    PRIVATE MODE (-DeploymentMode Private):
      - App Service behind Private Endpoint (no public access)
      - Azure OpenAI behind Private Endpoint (no public access)
      - Requires existing VNet with appropriate subnets
      - All communication stays within Azure backbone
    
    WHAT THIS SCRIPT DOES:
    ──────────────────────
    1. Azure OpenAI — either CREATES a new resource + deploys the newest GPT model (GPT-5.5 first,
       graceful fallback), OR REUSES an EXISTING resource + its model deployment (e.g. a PTU /
       Provisioned deployment). Controlled by -OpenAIMode (New | Existing); asked interactively.
    2. Creates App Service Plan (Linux, Python 3.11)
    3. Creates Web App with System-Assigned Managed Identity
    4. Configures environment variables
    5. Deploys application code with pip package installation
    6. [Private Mode] Creates Private Endpoints for OpenAI and Web App
    7. [Private Mode] Configures Private DNS Zones
    8. Assigns RBAC roles (Reader, Cost Management Reader, OpenAI User)
    
    PREREQUISITES:
    ──────────────
    - Azure CLI installed and logged in (az login)
    - Azure subscription with Owner or Contributor access
    - [Private Mode] Existing VNet with subnet(s) for Private Endpoints
    - Entra (Azure AD) app registration for user authentication
    
.PARAMETER ResourceGroupName
    Name of the resource group to create/use for deployment.
    Default: rg-askazure-cloudops
    
.PARAMETER Location
    Azure region for deployment.
    Default: swedencentral
    
.PARAMETER AppServicePlanName
    Name for the App Service Plan.
    Default: asp-askazure-cloudops
    
.PARAMETER WebAppName
    Name for the Web App (must be globally unique).
    Default: app-askazure-cloudops
    
.PARAMETER OpenAIResourceName
    Name for the Azure OpenAI resource.
    Default: openai-askazure-cloudops
    
.PARAMETER OpenAIDeploymentName
    Optional alias for the model deployment. Blank (default) names the deployment after the
    ACTUAL model deployed (newest GPT first, e.g. gpt-5.5), so the app + summary show the real model.
    Default: (blank = auto)
    
.PARAMETER OpenAIApiVersion
    Azure OpenAI API version.
    Default: 2024-08-01-preview
    
.PARAMETER AppServiceSku
    App Service Plan SKU. Default for this Qatar Central variant: "P3v3" - the plan is created
    with EXACTLY this SKU (Premium v3 P3V3), as-is, with no premium fallback ladder and no P1v3
    safety floor. Qatar Central capacity for P3v3 must be whitelisted (support ticket) before
    running; if the SKU is blocked, the operator is prompted rather than silently downgraded.
    Pass -AppServiceSku Auto to restore the original best-available premium ladder
    (P4mv3 -> P4mv4 -> P3mv4 -> P3mv3 -> P3v4 -> P3v3 with a P1v3 floor).
    
.PARAMETER EntraAppClientId
    Client ID of the Entra (Azure AD) app registration for user authentication.
    REQUIRED
    
.PARAMETER EntraTenantId
    Tenant ID of the Entra (Azure AD) tenant.
    REQUIRED
    
.PARAMETER SubscriptionId
    Azure subscription ID. If not provided, uses current subscription.
    
.PARAMETER DeploymentMode
    Deployment mode: 'Public' (default) or 'Private' (VNet-integrated with Private Endpoints).
    Default: Public
    
.PARAMETER VNetName
    [PRIVATE MODE ONLY] Name of the existing VNet to use.
    Required when DeploymentMode is 'Private'.
    
.PARAMETER VNetResourceGroupName
    [PRIVATE MODE ONLY] Resource group containing the VNet.
    If not specified, assumes same as ResourceGroupName.
    
.PARAMETER PrivateEndpointSubnetName
    [PRIVATE MODE ONLY] Name of an EXISTING subnet (in your VNet) used for Private Endpoints.
    This subnet must NOT have any delegation. No default - you will be prompted if not supplied.
    
.PARAMETER AppServiceIntegrationSubnetName
    [PRIVATE MODE ONLY] Name of an EXISTING, DEDICATED subnet (in your VNet) used for Web App
    regional VNet integration. Must be different from the Private Endpoint subnet and delegated
    to Microsoft.Web/serverFarms (the script adds the delegation if missing and you have rights).
    No default - you will be prompted if not supplied.
    
.PARAMETER PrivateDnsZoneResourceGroupName
    [PRIVATE MODE ONLY] Resource group for Private DNS Zones.
    Leave empty to auto-discover existing zones.
    
.PARAMETER PrivateDnsZoneSubscriptionId
    [PRIVATE MODE ONLY] Subscription ID for Private DNS Zones.
    Defaults to current subscription if not specified.

.EXAMPLE
    # Public deployment (simplest)
    .\deploy-appservice.ps1 `
        -EntraAppClientId "your-entra-app-client-id" `
        -EntraTenantId "your-tenant-id"
        
.EXAMPLE
    # Public deployment with custom names
    .\deploy-appservice.ps1 `
        -ResourceGroupName "rg-my-cloudops" `
        -WebAppName "app-my-cloudops-agent" `
        -Location "eastus" `
        -EntraAppClientId "your-entra-app-client-id" `
        -EntraTenantId "your-tenant-id"
        
.EXAMPLE
    # Private deployment with VNet integration
    .\deploy-appservice.ps1 `
        -ResourceGroupName "rg-askazure-agent" `
        -Location "westeurope" `
        -WebAppName "app-cloudops-agent" `
        -EntraAppClientId "your-entra-app-client-id" `
        -EntraTenantId "your-tenant-id" `
        -SubscriptionId "your-subscription-id" `
        -DeploymentMode "Private" `
        -VNetResourceGroupName "rg-networking" `
        -VNetName "vnet-hub-prod" `
        -PrivateEndpointSubnetName "<existing-pe-subnet>" `
        -AppServiceIntegrationSubnetName "<existing-integration-subnet>" `
        -PrivateDnsZoneSubscriptionId "your-subscription-id" `
        -PrivateDnsZoneResourceGroupName "rg-networking"
        
.NOTES
    Author: Zahir Hussain Shah
    Website: www.zahir.cloud
    Email: zahir@zahir.cloud
    
    This script follows Azure Well-Architected Framework best practices:
    - Least-privilege RBAC (no Contributor/Owner roles)
    - Managed Identity (no API keys or secrets)
    - Private networking option for enterprise security
    - Idempotent (safe to re-run)
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $false)]
    [string]$ResourceGroupName = "rg-azure-cost-optimizer",
    
    [Parameter(Mandatory = $false)]
    [string]$Location = "qatarcentral",
    
    # Azure OpenAI is not offered in every region (e.g. Qatar Central). When the
    # app Location does not offer OpenAI, the resource is created in this region.
    [Parameter(Mandatory = $false)]
    [string]$OpenAILocation = "",
    
    [Parameter(Mandatory = $false)]
    [string]$AppServicePlanName = "asp-azure-cost-optimizer",
    
    [Parameter(Mandatory = $false)]
    [string]$WebAppName = "app-azure-cost-optimizer",
    
    [Parameter(Mandatory = $false)]
    [string]$OpenAIResourceName = "openai-azure-cost-optimizer",
    
    [Parameter(Mandatory = $false)]
    [string]$OpenAIDeploymentName = "",
    
    [Parameter(Mandatory = $false)]
    [string]$OpenAIApiVersion = "2024-08-01-preview",

    # ── Azure OpenAI source: create a NEW resource, or reuse an EXISTING one ──
    # 'New'      = the script creates a new Azure OpenAI account + model deployment.
    # 'Existing' = reuse a customer-provided Azure OpenAI resource + its existing model
    #              deployment (e.g. a PTU / Provisioned deployment in Sweden Central).
    #              No new OpenAI account or model deployment is created.
    [Parameter(Mandatory = $false)]
    [ValidateSet("New", "Existing")]
    [string]$OpenAIMode = "",

    # [Existing mode] Resource group that holds the customer's existing Azure OpenAI resource
    # (may differ from the app's resource group). Defaults to $ResourceGroupName when blank.
    [Parameter(Mandatory = $false)]
    [string]$OpenAIResourceGroup = "",

    # [Existing mode] Subscription ID that holds the customer's existing Azure OpenAI resource.
    # Required when the PTU / existing OpenAI resource lives in a DIFFERENT subscription from the
    # App Service. Defaults to $SubscriptionId (app subscription) when blank.
    [Parameter(Mandatory = $false)]
    [string]$OpenAISubscriptionId = "",

    # [Existing mode - optional] Provide the endpoint + key directly to SKIP any control-plane
    # (az cognitiveservices) lookups - useful when the deploying identity cannot read the OpenAI
    # resource but the customer supplies its endpoint/key. When blank, the script resolves them
    # from the existing resource via its name + resource group.
    [Parameter(Mandatory = $false)]
    [string]$OpenAIEndpoint = "",

    [Parameter(Mandatory = $false)]
    [string]$OpenAIKey = "",
    
    [Parameter(Mandatory = $false)]
    [ValidateSet("Auto", "P4mv3", "P4mv4", "P3mv4", "P3mv3", "P3v4", "P3v3", "P2v3", "P1v3", "P0v3", "P3v2", "P2v2", "P1v2", "S1", "S2", "S3", "B1", "B2", "B3")]
    [string]$AppServiceSku = "P3v3",
    
    [Parameter(Mandatory = $false)]
    [string]$EntraAppClientId,
    
    [Parameter(Mandatory = $false)]
    [string]$EntraTenantId,
    
    [Parameter(Mandatory = $false)]
    [string]$SubscriptionId,
    
    [Parameter(Mandatory = $false)]
    [ValidateSet("Public", "Private")]
    [string]$DeploymentMode = "Public",
    
    # Private deployment parameters
    [Parameter(Mandatory = $false)]
    [string]$VNetName,
    
    [Parameter(Mandatory = $false)]
    [string]$VNetResourceGroupName,
    
    [Parameter(Mandatory = $false)]
    [string]$PrivateEndpointSubnetName,
    
    [Parameter(Mandatory = $false)]
    [string]$AppServiceIntegrationSubnetName,
    
    [Parameter(Mandatory = $false)]
    [string]$PrivateDnsZoneResourceGroupName,
    
    [Parameter(Mandatory = $false)]
    [string]$PrivateDnsZoneSubscriptionId,

    # ── Azure SQL (Prompt Library + Chat History persistence) ──
    [Parameter(Mandatory = $false)]
    [bool]$DeploySql = $true,

    [Parameter(Mandatory = $false)]
    [string]$SqlServerName,

    [Parameter(Mandatory = $false)]
    [string]$SqlDatabaseName = "prompts",

    # Exact SKU requested: General Purpose, Provisioned, Gen5, 4 vCores.
    [Parameter(Mandatory = $false)]
    [string]$SqlServiceObjective = "GP_Gen5_4",

    [Parameter(Mandatory = $false)]
    [int]$SqlMaxSizeGb = 4,

    [Parameter(Mandatory = $false)]
    [bool]$SqlZoneRedundant = $false,

    # Zone-redundant backup storage (ZRS) per the requested configuration.
    [Parameter(Mandatory = $false)]
    [ValidateSet("Local", "Zone", "Geo", "GeoZone")]
    [string]$SqlBackupStorageRedundancy = "Zone",

    [Parameter(Mandatory = $false)]
    [string]$SqlAadAdminUpn,

    # SQL authentication (this app connects to Azure SQL with a SQL login via pyodbc).
    [Parameter(Mandatory = $false)]
    [string]$SqlAdminUser = "costoptadmin",

    [Parameter(Mandatory = $false)]
    [string]$SqlAdminPassword = "",

    # Comma-separated subscriptions the app should scan (AZURE_SUBSCRIPTION_IDS).
    # Defaults to the deployment subscription when not supplied.
    [Parameter(Mandatory = $false)]
    [string]$SubscriptionIds = "",

    # Optional Redis L2 cache (Azure Cache for Redis). DISABLED for Qatar Central: Azure Cache
    # for Redis is not available in Qatar Central, and the app degrades gracefully without it.
    [Parameter(Mandatory = $false)]
    [bool]$DeployRedis = $false,

    [Parameter(Mandatory = $false)]
    [string]$RedisUrl = "",

    # Azure Cache for Redis tier/size. Premium P1 (6 GB) by default for production
    # caching + higher Azure consumption. Override e.g. -RedisSku Standard -RedisVmSize c1.
    [Parameter(Mandatory = $false)]
    [string]$RedisSku = "Premium",

    [Parameter(Mandatory = $false)]
    [string]$RedisVmSize = "P1",

    # Public URL users browse to (used to register the Entra SPA redirect URI).
    # Defaults to the Web App's default *.azurewebsites.net hostname.
    [Parameter(Mandatory = $false)]
    [string]$AppPublicUrl = ""
)

# ============================================
# CONFIGURATION
# ============================================
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
# PowerShell 7.4+ defaults $PSNativeCommandUseErrorActionPreference to $true, which makes
# ANY native command exiting non-zero throw under ErrorActionPreference=Stop. That would
# break (a) robocopy (whose SUCCESS exit codes are 1-7) and (b) the idempotent
# `az ... -or $result -match "already exists"` checks. This script controls flow via explicit
# $LASTEXITCODE checks, so disable the auto-throw to preserve that behaviour.
$PSNativeCommandUseErrorActionPreference = $false

# Helper functions for formatted output
function Write-Step($message) {
    Write-Host ""
    Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
    Write-Host "  $message" -ForegroundColor Cyan
    Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
}

function Write-Info($message) {
    Write-Host "  ℹ️  $message" -ForegroundColor White
}

function Write-Success($message) {
    Write-Host "  ✅ $message" -ForegroundColor Green
}

function Write-Error($message) {
    Write-Host "  ❌ $message" -ForegroundColor Red
}

# Convert an Azure RBAC action pattern (with * wildcards) into a regex and test a target action.
function Test-RbacActionMatch($pattern, $target) {
    $escaped = [Regex]::Escape($pattern).Replace('\*', '.*')
    return ($target -match "^$escaped$")
}

# Check whether the current signed-in identity is allowed to perform an action at a given scope.
# Returns: "Allowed", "Denied", or "Unknown" (when the permissions API could not be queried).
function Test-AzActionAllowed($scope, $action) {
    try {
        $permsJson = az rest --method get `
            --url "https://management.azure.com$scope/providers/Microsoft.Authorization/permissions?api-version=2022-04-01" `
            -o json 2>$null
        if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($permsJson)) { return "Unknown" }
        $perms = ($permsJson | ConvertFrom-Json).value
        if (-not $perms) { return "Denied" }
        foreach ($p in $perms) {
            $allowed = $false
            foreach ($a in $p.actions)    { if (Test-RbacActionMatch $a $action) { $allowed = $true; break } }
            if ($allowed) {
                foreach ($na in $p.notActions) { if (Test-RbacActionMatch $na $action) { $allowed = $false; break } }
            }
            if ($allowed) { return "Allowed" }
        }
        return "Denied"
    } catch {
        return "Unknown"
    }
}

# ============================================
# BANNER
# ============================================
Clear-Host
Write-Host ""
Write-Host "╔══════════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║                                                                  ║" -ForegroundColor Cyan
Write-Host "║     Azure Cost Optimizer                                         ║" -ForegroundColor Cyan
Write-Host "║     Azure App Service Deployment Script                          ║" -ForegroundColor Cyan
Write-Host "║                                                                  ║" -ForegroundColor Cyan
Write-Host "╚══════════════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# ============================================
# WELCOME / OVERVIEW
# ============================================
Write-Host "  Welcome! This script deploys the Azure Cost Optimizer to" -ForegroundColor White
Write-Host "  Azure using the APP SERVICE hosting model (a managed Linux Web App)." -ForegroundColor White
Write-Host ""
Write-Host "  ── WHAT THIS SCRIPT WILL DO (high level) ─────────────────────────────" -ForegroundColor Cyan
Write-Host "    1. Validate your environment (Azure CLI, login, subscription)" -ForegroundColor Gray
Write-Host "    2. Create / reuse an Azure OpenAI resource and deploy a model" -ForegroundColor Gray
Write-Host "    3. Create an App Service Plan and a Linux Web App (Python)" -ForegroundColor Gray
Write-Host "    4. Enable a system-assigned managed identity and grant Azure RBAC" -ForegroundColor Gray
Write-Host "    5. Configure app settings and deploy the application code" -ForegroundColor Gray
Write-Host "    6. (Private mode) Wire up VNet integration + Private Endpoints + DNS" -ForegroundColor Gray
Write-Host ""
Write-Host "  ── COMPONENTS THAT WILL BE CREATED ───────────────────────────────────" -ForegroundColor Cyan
Write-Host "    • Azure OpenAI account + newest available GPT model deployment (e.g. gpt-5.5)" -ForegroundColor Gray
Write-Host "    • App Service Plan (Linux) + Web App with managed identity" -ForegroundColor Gray
Write-Host "    • Role assignments (Reader, Cost Management Reader, OpenAI User, etc.)" -ForegroundColor Gray
Write-Host "    • Microsoft Graph permissions for the Entra app registration" -ForegroundColor Gray
Write-Host "    • (Private mode only) Private Endpoints, Private DNS links, VNet integration" -ForegroundColor Gray
Write-Host ""
Write-Host "  ── INPUTS YOU WILL BE ASKED FOR ──────────────────────────────────────" -ForegroundColor Cyan
Write-Host "    • Deployment mode (Public or Private)" -ForegroundColor Gray
Write-Host "    • Resource group name and Azure region" -ForegroundColor Gray
Write-Host "    • Azure OpenAI resource + model deployment name" -ForegroundColor Gray
Write-Host "    • App Service Plan name and Web App name" -ForegroundColor Gray
Write-Host "    • Entra app registration: Client ID and Tenant ID (for user sign-in)" -ForegroundColor Gray
Write-Host "    • (Private mode) Existing VNet, subnets and Private DNS Zone details" -ForegroundColor Gray
Write-Host ""
Write-Host "  ── DEPLOYMENT OPTIONS ────────────────────────────────────────────────" -ForegroundColor Cyan
Write-Host "    🌐 Public  - Web App reachable over the internet. Simplest; no VNet needed." -ForegroundColor Gray
Write-Host "    🔒 Private - Web App + Azure OpenAI locked behind Private Endpoints; the" -ForegroundColor Gray
Write-Host "                app is reachable only from inside your VNet. Requires an" -ForegroundColor Gray
Write-Host "                existing VNet with a Private Endpoint subnet and a dedicated" -ForegroundColor Gray
Write-Host "                App Service integration subnet." -ForegroundColor Gray
Write-Host ""
Write-Host "  ── PERMISSIONS YOU WILL NEED ─────────────────────────────────────────" -ForegroundColor Cyan
Write-Host "    • Contributor on the target subscription / resource group (create resources)" -ForegroundColor Gray
Write-Host "    • User Access Administrator or Owner (to create the RBAC role assignments)" -ForegroundColor Gray
Write-Host "    • (Private mode) Network Contributor on the VNet (subnet delegation + PEs)" -ForegroundColor Gray
Write-Host "    • Privileges to grant admin consent for the Entra app's Graph permissions" -ForegroundColor Gray
Write-Host ""
Write-Host "  Tip: you can pre-supply any answer as a parameter for an unattended run." -ForegroundColor DarkGray
Write-Host ""
$startConfirm = Read-Host "  Press Enter to begin, or type 'N' to cancel"
if ($startConfirm -eq 'N' -or $startConfirm -eq 'n') {
    Write-Host ""
    Write-Info "Deployment cancelled by user."
    exit 0
}

# ============================================
# PRE-FLIGHT CHECKS
# ============================================
Write-Step "Pre-Flight Checks"

# Check Azure CLI
Write-Info "Checking Azure CLI installation..."
$azVersion = az version --output json 2>$null | ConvertFrom-Json
if (-not $azVersion) {
    Write-Error "Azure CLI is not installed or not in PATH"
    Write-Host "  Install from: https://docs.microsoft.com/cli/azure/install-azure-cli" -ForegroundColor Yellow
    exit 1
}
Write-Success "Azure CLI version: $($azVersion.'azure-cli')"

# Check login status
Write-Info "Checking Azure CLI login status..."
$account = az account show --output json 2>$null | ConvertFrom-Json
if (-not $account) {
    Write-Info "Not logged in. Running 'az login'..."
    az login | Out-Null
    $account = az account show --output json 2>$null | ConvertFrom-Json
    if (-not $account) {
        Write-Error "Failed to login to Azure"
        exit 1
    }
}
Write-Success "Logged in as: $($account.user.name)"

# Set subscription
if ([string]::IsNullOrEmpty($SubscriptionId)) {
    $SubscriptionId = $account.id
    Write-Info "Using current subscription: $SubscriptionId"
} else {
    Write-Info "Setting subscription to: $SubscriptionId"
    az account set --subscription $SubscriptionId
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Failed to set subscription: $SubscriptionId"
        exit 1
    }
}
$subscriptionName = (az account show --query "name" -o tsv)

# Confirm subscription (same behavior as deploy-automated.ps1)
Write-Host ""
Write-Host "  ╔════════════════════════════════════════════════════════════════╗" -ForegroundColor Yellow
Write-Host "  ║  SELECTED SUBSCRIPTION                                          ║" -ForegroundColor Yellow
Write-Host "  ╠════════════════════════════════════════════════════════════════╣" -ForegroundColor Yellow
Write-Host "  ║  Subscription:      $subscriptionName" -ForegroundColor White
Write-Host "  ║  Subscription ID:   $SubscriptionId" -ForegroundColor White
Write-Host "  ╚════════════════════════════════════════════════════════════════╝" -ForegroundColor Yellow
Write-Host ""
$subConfirm = Read-Host "  Is this the correct subscription? (Y/N)"
if ($subConfirm -ne 'Y' -and $subConfirm -ne 'y') {
    Write-Error "Deployment cancelled. Use -SubscriptionId parameter or run 'az account set --subscription <id>'"
    exit 1
}
Write-Success "Subscription confirmed: $subscriptionName ($SubscriptionId)"

# ============================================
# INTERACTIVE CONFIGURATION
# Prompts ONLY for values not already supplied as parameters,
# so unattended/automated runs (-DeploymentMode, -ResourceGroupName,
# -Location) continue to work non-interactively.
# ============================================
Write-Step "Deployment Configuration"

# 1) Deployment mode (Public vs Private)
if (-not $PSBoundParameters.ContainsKey('DeploymentMode')) {
    Write-Host "  Choose deployment mode:" -ForegroundColor White
    Write-Host "    [1] Public  - App Service reachable over the internet (simplest)" -ForegroundColor Gray
    Write-Host "    [2] Private - App Service + Azure OpenAI behind Private Endpoints (requires existing VNet)" -ForegroundColor Gray
    $modeChoice = Read-Host "  Enter choice (1/2) [default: 1 = Public]"
    if ($modeChoice -eq '2') { $DeploymentMode = "Private" } else { $DeploymentMode = "Public" }
}
Write-Success "Deployment mode: $DeploymentMode"

# Entra ID login app registration (the customer creates this beforehand as a
# Single-page application). The script wires its client/tenant id into the app so
# the SPA can sign users in; after deployment the customer adds the app URL as a
# redirect URI (the script attempts this automatically too).
if ([string]::IsNullOrWhiteSpace($EntraTenantId)) {
    $EntraTenantId = az account show --query tenantId -o tsv 2>$null
}
if ([string]::IsNullOrWhiteSpace($EntraAppClientId)) {
    Write-Host "  The web app is protected by Entra ID sign-in (no direct access)." -ForegroundColor White
    Write-Host "  Provide the Application (client) ID of your login app registration (SPA platform)." -ForegroundColor White
    $cidInput = Read-Host "  Entra login app (client) ID [leave blank to deploy WITHOUT sign-in]"
    if (-not [string]::IsNullOrWhiteSpace($cidInput)) { $EntraAppClientId = $cidInput.Trim() }
}
if ([string]::IsNullOrWhiteSpace($EntraAppClientId)) {
    Write-Host "  WARNING: No Entra login app provided - the app will deploy WITHOUT the sign-in gate (open access)." -ForegroundColor Yellow
}
Write-Success "Entra tenant: $EntraTenantId"

# 2) Resource group name
if (-not $PSBoundParameters.ContainsKey('ResourceGroupName')) {
    $rgInput = Read-Host "  Resource group name [default: $ResourceGroupName]"
    if (-not [string]::IsNullOrWhiteSpace($rgInput)) { $ResourceGroupName = $rgInput.Trim() }
}
Write-Success "Resource group: $ResourceGroupName"

# 3) Location / region (where the App Service + app data live)
if (-not $PSBoundParameters.ContainsKey('Location')) {
    Write-Info "Suggested regions: qatarcentral (primary), westeurope, northeurope"
    $locInput = Read-Host "  Azure region for the Web App [default: $Location]"
    if (-not [string]::IsNullOrWhiteSpace($locInput)) { $Location = $locInput.Trim() }
}
Write-Success "Location: $Location"

# 3a) Azure OpenAI SOURCE — create a NEW resource, or reuse an EXISTING one (e.g. a PTU /
# Provisioned deployment the customer already has in Sweden Central). Ask if not pre-supplied.
if ([string]::IsNullOrWhiteSpace($OpenAIMode)) {
    Write-Host ""
    Write-Host "  Azure OpenAI — how should the app get its model?" -ForegroundColor White
    Write-Host "    [1] Create a NEW Azure OpenAI resource + model deployment (default)" -ForegroundColor Gray
    Write-Host "    [2] Use an EXISTING Azure OpenAI resource (e.g. your PTU / Provisioned model in Sweden Central)" -ForegroundColor Gray
    $modeChoice = Read-Host "  Enter choice (1/2) [default: 1]"
    if ($modeChoice.Trim() -eq '2') { $OpenAIMode = "Existing" } else { $OpenAIMode = "New" }
}
Write-Success "Azure OpenAI mode: $OpenAIMode"

if ($OpenAIMode -eq "Existing") {
    # Collect the existing resource details from the customer (interactive when not passed).
    if ([string]::IsNullOrWhiteSpace($OpenAIResourceName) -or $OpenAIResourceName -eq "openai-azure-cost-optimizer") {
        $v = Read-Host "  Existing Azure OpenAI resource NAME"
        if (-not [string]::IsNullOrWhiteSpace($v)) { $OpenAIResourceName = $v.Trim() }
    }
    if ([string]::IsNullOrWhiteSpace($OpenAIResourceGroup)) {
        $v = Read-Host "  Resource group of the existing Azure OpenAI [default: $ResourceGroupName]"
        $OpenAIResourceGroup = if ([string]::IsNullOrWhiteSpace($v)) { $ResourceGroupName } else { $v.Trim() }
    }
    if ([string]::IsNullOrWhiteSpace($OpenAIDeploymentName)) {
        $v = Read-Host "  Existing MODEL DEPLOYMENT name (the PTU / Provisioned deployment to use)"
        if (-not [string]::IsNullOrWhiteSpace($v)) { $OpenAIDeploymentName = $v.Trim() }
    }
    # Endpoint + key: optional direct entry (skips control-plane reads if the identity can't read the resource).
    if ([string]::IsNullOrWhiteSpace($OpenAIEndpoint)) {
        $v = Read-Host "  Existing OpenAI ENDPOINT (blank = auto-resolve from the resource)"
        if (-not [string]::IsNullOrWhiteSpace($v)) { $OpenAIEndpoint = $v.Trim() }
    }
    if ([string]::IsNullOrWhiteSpace($OpenAIKey)) {
        $v = Read-Host "  Existing OpenAI API KEY (blank = auto-resolve from the resource)"
        if (-not [string]::IsNullOrWhiteSpace($v)) { $OpenAIKey = $v.Trim() }
    }
    if ([string]::IsNullOrWhiteSpace($OpenAIResourceName) -or [string]::IsNullOrWhiteSpace($OpenAIDeploymentName)) {
        if ([string]::IsNullOrWhiteSpace($OpenAIEndpoint) -or [string]::IsNullOrWhiteSpace($OpenAIKey)) {
            Write-Error "Existing OpenAI mode needs either (resource name + resource group + deployment name) OR (endpoint + key + deployment name)."
            exit 1
        }
    }
    Write-Success "Using existing Azure OpenAI: resource='$OpenAIResourceName' rg='$OpenAIResourceGroup' deployment='$OpenAIDeploymentName'"
}

# 3b) Azure OpenAI region — only relevant when CREATING a new resource. OpenAI is NOT offered in
# some regions (e.g. Qatar Central), so it may live in a different region than the app. Cross-
# region is fine (in Private mode the Private Endpoint is created in the app's VNet). For this
# Qatar Central variant the recommended OpenAI region is Sweden Central (alternative: West Europe).
if ($OpenAIMode -eq "New") {
    $openAiCapableRegions = @("swedencentral","westeurope","northeurope","eastus","eastus2","francecentral","uksouth","switzerlandnorth")
    if ([string]::IsNullOrWhiteSpace($OpenAILocation)) {
        if ($openAiCapableRegions -contains $Location.ToLower()) { $OpenAILocation = $Location } else { $OpenAILocation = "swedencentral" }
    }
    if (-not $PSBoundParameters.ContainsKey('OpenAILocation')) {
        $oaiLocInput = Read-Host "  Azure OpenAI region [default: $OpenAILocation]"
        if (-not [string]::IsNullOrWhiteSpace($oaiLocInput)) { $OpenAILocation = $oaiLocInput.Trim() }
    }
    Write-Success "Azure OpenAI region: $OpenAILocation"
}

# Subscription scanning model (mirrors the local server): the app DYNAMICALLY discovers
# every subscription its managed identity can read at runtime, so the picker always
# reflects exactly what the identity has access to — no hard-coded list to drift.
#   * No -SubscriptionIds  -> AZURE_SUBSCRIPTION_IDS=auto + grant identity Reader on every
#                             enabled subscription we can see.
#   * -SubscriptionIds set -> pin to that explicit list (grant + scan only those).
$explicitSubs = -not [string]::IsNullOrWhiteSpace($SubscriptionIds)
if ($explicitSubs) {
    $ScanSubscriptionsEnv = $SubscriptionIds
    Write-Success "Subscription scope: pinned to provided list"
} else {
    $ScanSubscriptionsEnv = "auto"   # backend discovers all subs the identity can read
    Write-Host "  Discovering accessible subscriptions (for RBAC grants)..." -ForegroundColor DarkGray
    $allSubs = az account list --query "[?state=='Enabled'].id" -o tsv 2>$null
    $subList = @($allSubs -split "`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    if ($subList.Count -gt 0) {
        $SubscriptionIds = ($subList -join ',')
        Write-Success "Found $($subList.Count) enabled subscription(s) — granting identity Reader on each; app discovers them at runtime"
    } else {
        $SubscriptionIds = $SubscriptionId
    }
}
# Real comma-separated list used by the RBAC grant loop below (NOT the literal "auto").
$SubscriptionIdsCsv = $SubscriptionIds

# 4) Azure OpenAI resource name (forms a GLOBALLY-UNIQUE subdomain, so always confirm)
if (-not $PSBoundParameters.ContainsKey('OpenAIResourceName')) {
    while ($true) {
        $oaiInput = Read-Host "  Azure OpenAI resource name [default: $OpenAIResourceName]"
        if (-not [string]::IsNullOrWhiteSpace($oaiInput)) { $OpenAIResourceName = $oaiInput.Trim() }

        Write-Info "Checking global subdomain availability for '$OpenAIResourceName'..."
        $checkUrl = "https://management.azure.com/subscriptions/$SubscriptionId/providers/Microsoft.CognitiveServices/checkDomainAvailability?api-version=2023-05-01"
        $checkBody = "{`"subdomainName`":`"$OpenAIResourceName`",`"type`":`"Microsoft.CognitiveServices/accounts`"}"
        $checkRaw = az rest --method post --url $checkUrl --body $checkBody --headers "Content-Type=application/json" -o json 2>$null
        $isAvailable = $null
        if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($checkRaw)) {
            try { $isAvailable = ($checkRaw | ConvertFrom-Json).isSubdomainAvailable } catch { $isAvailable = $null }
        }

        if ($isAvailable -eq $true) {
            Write-Success "Name available: $OpenAIResourceName"
            break
        } elseif ($isAvailable -eq $false) {
            Write-Error "The name '$OpenAIResourceName' is already in use as an Azure OpenAI subdomain. Please choose another."
        } else {
            Write-Info "Could not verify availability (check skipped). Proceeding with '$OpenAIResourceName'."
            break
        }
    }
}
Write-Success "Azure OpenAI resource name: $OpenAIResourceName"

# 5) Azure OpenAI model deployment (alias) name - used as AZURE_OPENAI_DEPLOYMENT by the app
if (-not $PSBoundParameters.ContainsKey('OpenAIDeploymentName')) {
    $depInput = Read-Host "  Azure OpenAI model deployment name [default: auto = newest GPT model]"
    if (-not [string]::IsNullOrWhiteSpace($depInput)) { $OpenAIDeploymentName = $depInput.Trim() }
}
Write-Success "Model deployment name: $(if ($OpenAIDeploymentName) { $OpenAIDeploymentName } else { 'auto (newest GPT model)' })"

# 6) App Service Plan name (resource-group scoped - honour customer naming conventions)
if (-not $PSBoundParameters.ContainsKey('AppServicePlanName')) {
    $planInput = Read-Host "  App Service Plan name [default: $AppServicePlanName]"
    if (-not [string]::IsNullOrWhiteSpace($planInput)) { $AppServicePlanName = $planInput.Trim() }
}
Write-Success "App Service Plan name: $AppServicePlanName"

# 7) Web App name (forms a GLOBALLY-UNIQUE *.azurewebsites.net hostname, so always confirm)
if (-not $PSBoundParameters.ContainsKey('WebAppName')) {
    while ($true) {
        $appInput = Read-Host "  Web App name [default: $WebAppName]"
        if (-not [string]::IsNullOrWhiteSpace($appInput)) { $WebAppName = $appInput.Trim() }

        Write-Info "Checking global name availability for '$WebAppName'..."
        $waUrl = "https://management.azure.com/subscriptions/$SubscriptionId/providers/Microsoft.Web/checkNameAvailability?api-version=2023-12-01"
        $waBody = "{`"name`":`"$WebAppName`",`"type`":`"Microsoft.Web/sites`"}"
        $waRaw = az rest --method post --url $waUrl --body $waBody --headers "Content-Type=application/json" -o json 2>$null
        $waAvail = $null
        if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($waRaw)) {
            try { $waAvail = ($waRaw | ConvertFrom-Json).nameAvailable } catch { $waAvail = $null }
        }

        if ($waAvail -eq $true) {
            Write-Success "Name available: $WebAppName"
            break
        } elseif ($waAvail -eq $false) {
            Write-Error "The name '$WebAppName' is already taken ('*.azurewebsites.net' must be globally unique). Please choose another."
        } else {
            Write-Info "Could not verify availability (check skipped). Proceeding with '$WebAppName'."
            break
        }
    }
}
Write-Success "Web App name: $WebAppName"

# 8) Private networking details (prompt only when Private mode and not supplied as parameters)
if ($DeploymentMode -eq "Private") {
    Write-Host ""
    Write-Host "  Private mode requires an EXISTING VNet with a subnet for Private Endpoints." -ForegroundColor Gray
    if (-not $PSBoundParameters.ContainsKey('VNetName') -and [string]::IsNullOrWhiteSpace($VNetName)) {
        $vnetInput = Read-Host "  Existing VNet name"
        if (-not [string]::IsNullOrWhiteSpace($vnetInput)) { $VNetName = $vnetInput.Trim() }
    }
    if (-not $PSBoundParameters.ContainsKey('VNetResourceGroupName') -and [string]::IsNullOrWhiteSpace($VNetResourceGroupName)) {
        $vnetRgInput = Read-Host "  VNet resource group [default: $ResourceGroupName]"
        if (-not [string]::IsNullOrWhiteSpace($vnetRgInput)) { $VNetResourceGroupName = $vnetRgInput.Trim() }
    }
    if ([string]::IsNullOrWhiteSpace($PrivateEndpointSubnetName)) {
        while ([string]::IsNullOrWhiteSpace($PrivateEndpointSubnetName)) {
            $peSubnetInput = Read-Host "  Existing Private Endpoint subnet name (in VNet '$VNetName')"
            if (-not [string]::IsNullOrWhiteSpace($peSubnetInput)) { $PrivateEndpointSubnetName = $peSubnetInput.Trim() }
            else { Write-Error "Subnet name is required (no default - it must match a subnet that exists in your VNet)." }
        }
    }
    if ([string]::IsNullOrWhiteSpace($AppServiceIntegrationSubnetName)) {
        Write-Host "  (VNet integration lets the Web App reach the PRIVATE Azure OpenAI endpoint - needs a DEDICATED subnet," -ForegroundColor Gray
        Write-Host "   separate from the Private Endpoint subnet, delegated to Microsoft.Web/serverFarms)" -ForegroundColor Gray
        while ([string]::IsNullOrWhiteSpace($AppServiceIntegrationSubnetName)) {
            $intSubnetInput = Read-Host "  Existing App Service integration subnet name (in VNet '$VNetName')"
            if (-not [string]::IsNullOrWhiteSpace($intSubnetInput)) { $AppServiceIntegrationSubnetName = $intSubnetInput.Trim() }
            else { Write-Error "Subnet name is required (no default - it must match a subnet that exists in your VNet)." }
        }
    }

    # Private DNS Zones may already exist centrally (hub/connectivity subscription).
    # Ask where they live so we link to existing zones instead of creating duplicates.
    if (-not $PSBoundParameters.ContainsKey('PrivateDnsZoneSubscriptionId') -and -not $PSBoundParameters.ContainsKey('PrivateDnsZoneResourceGroupName')) {
        Write-Host ""
        Write-Host "  Private DNS Zones needed: privatelink.openai.azure.com, privatelink.azurewebsites.net" -ForegroundColor Gray
        Write-Host "  These are often centrally managed in a hub/connectivity subscription." -ForegroundColor Gray
        $dnsExisting = Read-Host "  Do you already have these Private DNS Zones? (Y/N) [default: N = create new]"
        if ($dnsExisting -eq 'Y' -or $dnsExisting -eq 'y') {
            $dnsSubInput = Read-Host "  DNS Zone subscription ID [default: $SubscriptionId]"
            if (-not [string]::IsNullOrWhiteSpace($dnsSubInput)) { $PrivateDnsZoneSubscriptionId = $dnsSubInput.Trim() }
            $dnsRgInput = Read-Host "  DNS Zone resource group (where the zones live)"
            if (-not [string]::IsNullOrWhiteSpace($dnsRgInput)) { $PrivateDnsZoneResourceGroupName = $dnsRgInput.Trim() }
        }
    }
}

# 9) Entra ID app registration (used for end-user sign-in to the deployed app)
$guidPattern = '^[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$'
if (-not $PSBoundParameters.ContainsKey('EntraAppClientId') -or [string]::IsNullOrWhiteSpace($EntraAppClientId)) {
    Write-Host ""
    Write-Host "  The app uses an Entra ID (Azure AD) app registration so your users can sign in." -ForegroundColor Gray
    Write-Host "  Find these in Azure Portal > Entra ID > App registrations > (your app) > Overview." -ForegroundColor Gray
    while ($true) {
        $clientInput = Read-Host "  Entra app Client ID (Application ID)"
        if (-not [string]::IsNullOrWhiteSpace($clientInput)) { $EntraAppClientId = $clientInput.Trim() }
        if ($EntraAppClientId -match $guidPattern) { break }
        Write-Error "That doesn't look like a valid GUID. Example: 11111111-2222-3333-4444-555555555555"
    }
}
if (-not $PSBoundParameters.ContainsKey('EntraTenantId') -or [string]::IsNullOrWhiteSpace($EntraTenantId)) {
    while ($true) {
        $tenantInput = Read-Host "  Entra Tenant ID (Directory ID)"
        if (-not [string]::IsNullOrWhiteSpace($tenantInput)) { $EntraTenantId = $tenantInput.Trim() }
        if ($EntraTenantId -match $guidPattern) { break }
        Write-Error "That doesn't look like a valid GUID. Example: 11111111-2222-3333-4444-555555555555"
    }
}
Write-Success "Entra app Client ID: $EntraAppClientId"
Write-Success "Entra Tenant ID:     $EntraTenantId"

# ============================================
# DEPLOYMENT MODE BANNER
# ============================================
Write-Host ""
if ($DeploymentMode -eq "Private") {
    Write-Host "  🔒 PRIVATE DEPLOYMENT MODE" -ForegroundColor Magenta
} else {
    Write-Host "  🌐 PUBLIC DEPLOYMENT MODE" -ForegroundColor Green
}
Write-Host ""

# Validate Private Mode parameters
if ($DeploymentMode -eq "Private") {
    Write-Host ""
    Write-Host "  🔒 PRIVATE MODE VALIDATION" -ForegroundColor Magenta
    Write-Host "  ─────────────────────────────────────────────────────────────" -ForegroundColor Gray
    
    if ([string]::IsNullOrEmpty($VNetName)) {
        Write-Error "VNetName is required for Private deployment mode"
        Write-Host "  Re-run and enter the VNet name when prompted, or pass -VNetName <name>" -ForegroundColor Yellow
        exit 1
    }
    
    if ([string]::IsNullOrEmpty($VNetResourceGroupName)) {
        $VNetResourceGroupName = $ResourceGroupName
        Write-Info "VNetResourceGroupName not specified - assuming same as ResourceGroupName: $VNetResourceGroupName"
    }
    
    # Validate VNet exists
    Write-Info "Validating VNet '$VNetName' in resource group '$VNetResourceGroupName'..."
    $vnetExists = az network vnet show --name $VNetName --resource-group $VNetResourceGroupName --query "name" -o tsv 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Error "VNet '$VNetName' not found in resource group '$VNetResourceGroupName'"
        Write-Host "  Verify the VNet exists and you have access to it" -ForegroundColor Yellow
        exit 1
    }
    Write-Success "VNet validated: $VNetName"
    
    # Get VNet resource ID
    $vnetResourceId = az network vnet show --name $VNetName --resource-group $VNetResourceGroupName --query "id" -o tsv
    
    # Validate Private Endpoint subnet
    Write-Info "Validating Private Endpoint subnet '$PrivateEndpointSubnetName'..."
    $peSubnetExists = az network vnet subnet show --name $PrivateEndpointSubnetName --vnet-name $VNetName --resource-group $VNetResourceGroupName --query "name" -o tsv 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Subnet '$PrivateEndpointSubnetName' not found in VNet '$VNetName'"
        Write-Host "  Create the subnet first, or specify a different subnet with -PrivateEndpointSubnetName" -ForegroundColor Yellow
        exit 1
    }
    Write-Success "Private Endpoint subnet validated: $PrivateEndpointSubnetName"
    
    # Get PE subnet resource ID
    $peSubnetResourceId = az network vnet subnet show --name $PrivateEndpointSubnetName --vnet-name $VNetName --resource-group $VNetResourceGroupName --query "id" -o tsv
    
    # Validate App Service VNet-integration subnet (separate from PE subnet; must be delegated to Microsoft.Web/serverFarms)
    Write-Info "Validating App Service integration subnet '$AppServiceIntegrationSubnetName'..."
    if ($AppServiceIntegrationSubnetName -eq $PrivateEndpointSubnetName) {
        Write-Error "The App Service integration subnet must be DIFFERENT from the Private Endpoint subnet ('$PrivateEndpointSubnetName')."
        Write-Host "  A subnet delegated to Microsoft.Web/serverFarms cannot also host Private Endpoints." -ForegroundColor Yellow
        exit 1
    }
    $intSubnetJson = az network vnet subnet show --name $AppServiceIntegrationSubnetName --vnet-name $VNetName --resource-group $VNetResourceGroupName -o json 2>$null
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($intSubnetJson)) {
        Write-Error "App Service integration subnet '$AppServiceIntegrationSubnetName' not found in VNet '$VNetName'"
        Write-Host "  Regional VNet integration needs a DEDICATED subnet (separate from the Private Endpoint subnet)," -ForegroundColor Yellow
        Write-Host "  delegated to 'Microsoft.Web/serverFarms'. Create it, then re-run or pass -AppServiceIntegrationSubnetName <name>." -ForegroundColor Yellow
        exit 1
    }
    $intSubnetObj = $intSubnetJson | ConvertFrom-Json
    $integrationSubnetResourceId = $intSubnetObj.id
    # Ensure delegation to Microsoft.Web/serverFarms
    $hasWebDelegation = $false
    if ($intSubnetObj.delegations) {
        foreach ($d in $intSubnetObj.delegations) {
            if ($d.serviceName -eq "Microsoft.Web/serverFarms") { $hasWebDelegation = $true }
        }
    }
    if (-not $hasWebDelegation) {
        Write-Info "Subnet '$AppServiceIntegrationSubnetName' is not yet delegated to Microsoft.Web/serverFarms."

        # Proactively verify the running identity can modify the subnet before attempting the change,
        # so customers without networking permissions get a clear message instead of a raw CLI error.
        $subnetWriteAction = "Microsoft.Network/virtualNetworks/subnets/write"
        $permState = Test-AzActionAllowed $integrationSubnetResourceId $subnetWriteAction
        if ($permState -eq "Denied") {
            Write-Error "You do not have permission to delegate this subnet."
            Write-Host "  Required action : $subnetWriteAction" -ForegroundColor Yellow
            Write-Host "  On scope        : $integrationSubnetResourceId" -ForegroundColor Yellow
            Write-Host "  Typical roles   : 'Network Contributor' (or a custom role granting subnet write) on the VNet '$VNetName'." -ForegroundColor Yellow
            Write-Host "  Ask your networking team to either grant that role OR pre-delegate the subnet with:" -ForegroundColor Yellow
            Write-Host "    az network vnet subnet update --name $AppServiceIntegrationSubnetName --vnet-name $VNetName --resource-group $VNetResourceGroupName --delegations Microsoft.Web/serverFarms" -ForegroundColor Gray
            exit 1
        }
        elseif ($permState -eq "Unknown") {
            Write-Host "  ⚠️  Could not pre-verify subnet permissions; attempting the delegation anyway." -ForegroundColor Yellow
        }

        Write-Info "Adding 'Microsoft.Web/serverFarms' delegation to subnet '$AppServiceIntegrationSubnetName'..."
        az network vnet subnet update --name $AppServiceIntegrationSubnetName --vnet-name $VNetName --resource-group $VNetResourceGroupName --delegations "Microsoft.Web/serverFarms" --output none 2>$null
        if ($LASTEXITCODE -ne 0) {
            Write-Error "Failed to delegate subnet '$AppServiceIntegrationSubnetName' to Microsoft.Web/serverFarms"
            Write-Host "  This usually means insufficient permission ($subnetWriteAction on VNet '$VNetName')" -ForegroundColor Yellow
            Write-Host "  or the subnet already contains conflicting resources." -ForegroundColor Yellow
            Write-Host "  Have your networking team pre-delegate it, then re-run:" -ForegroundColor Yellow
            Write-Host "    az network vnet subnet update --name $AppServiceIntegrationSubnetName --vnet-name $VNetName --resource-group $VNetResourceGroupName --delegations Microsoft.Web/serverFarms" -ForegroundColor Gray
            exit 1
        }
    }
    Write-Success "App Service integration subnet validated: $AppServiceIntegrationSubnetName"
    
    # Set DNS zone subscription and resource group
    if ([string]::IsNullOrEmpty($PrivateDnsZoneSubscriptionId)) {
        $dnsZoneSubscriptionId = $SubscriptionId
    } else {
        $dnsZoneSubscriptionId = $PrivateDnsZoneSubscriptionId
    }
    
    Write-Host ""
    Write-Host "  ✅ Private Mode Configuration Valid:" -ForegroundColor Green
    Write-Host "    VNet:                  $VNetName" -ForegroundColor White
    Write-Host "    VNet RG:               $VNetResourceGroupName" -ForegroundColor White
    Write-Host "    PE Subnet:             $PrivateEndpointSubnetName" -ForegroundColor White
    Write-Host "    Integration Subnet:    $AppServiceIntegrationSubnetName" -ForegroundColor White
    Write-Host "    DNS Zone Subscription: $dnsZoneSubscriptionId" -ForegroundColor White
    Write-Host ""
}

# ============================================
# DISCOVER EXISTING PRIVATE DNS ZONES (PRIVATE MODE)
# ============================================
$dnsZoneOpenAIFound = $false
$dnsZoneWebAppFound = $false
$dnsZoneResourceGroup = $null

if ($DeploymentMode -eq "Private") {
    Write-Step "Discovering Existing Private DNS Zones"
    
    Write-Info "Searching for existing Private DNS Zones in subscription..."
    
    # OpenAI DNS Zone
    $openaiDnsZoneName = "privatelink.openai.azure.com"
    $existingOpenAIDns = az network private-dns zone list --subscription $dnsZoneSubscriptionId --query "[?name=='$openaiDnsZoneName'].{Name:name, RG:resourceGroup}" -o json 2>$null | ConvertFrom-Json
    if ($existingOpenAIDns -and $existingOpenAIDns.Count -gt 0) {
        $dnsZoneOpenAIFound = $true
        $dnsZoneResourceGroup = $existingOpenAIDns[0].RG
        Write-Success "Found existing DNS Zone: $openaiDnsZoneName in RG: $dnsZoneResourceGroup"
    } else {
        Write-Info "DNS Zone '$openaiDnsZoneName' not found - will create"
    }
    
    # Web App DNS Zone
    $webappDnsZoneName = "privatelink.azurewebsites.net"
    $existingWebAppDns = az network private-dns zone list --subscription $dnsZoneSubscriptionId --query "[?name=='$webappDnsZoneName'].{Name:name, RG:resourceGroup}" -o json 2>$null | ConvertFrom-Json
    if ($existingWebAppDns -and $existingWebAppDns.Count -gt 0) {
        $dnsZoneWebAppFound = $true
        if (-not $dnsZoneResourceGroup) {
            $dnsZoneResourceGroup = $existingWebAppDns[0].RG
        }
        Write-Success "Found existing DNS Zone: $webappDnsZoneName in RG: $($existingWebAppDns[0].RG)"
    } else {
        Write-Info "DNS Zone '$webappDnsZoneName' not found - will create"
    }
    
    # Set default DNS zone resource group if not found
    if (-not $dnsZoneResourceGroup) {
        if ($PrivateDnsZoneResourceGroupName) {
            $dnsZoneResourceGroup = $PrivateDnsZoneResourceGroupName
        } else {
            $dnsZoneResourceGroup = $ResourceGroupName
        }
        Write-Info "Will create DNS Zones in RG: $dnsZoneResourceGroup"
    }
}

# ============================================
# AZURE SQL CONFIGURATION (Prompt Library + Chat History)
# ============================================
if ($DeploySql) {
    if ([string]::IsNullOrWhiteSpace($SqlServerName)) {
        # Deterministic, globally-unique-ish server name derived from the Web App
        # name so re-runs are idempotent (reuse the same server).
        $sqlBase = ('sql-' + $WebAppName).ToLower() -replace '[^a-z0-9-]', '-'
        if ($sqlBase.Length -gt 60) { $sqlBase = $sqlBase.Substring(0, 60) }
        $SqlServerName = $sqlBase.TrimEnd('-')
    }
    $SqlServerName = $SqlServerName.ToLower()
    Write-Info "Azure SQL logical server: $SqlServerName"
    Write-Info "Azure SQL database:       $SqlDatabaseName (SKU: $SqlServiceObjective, ${SqlMaxSizeGb}GB)"
    Write-Info "Zone redundant: $SqlZoneRedundant | Backup storage: $SqlBackupStorageRedundancy"
}

# ============================================
# REGISTER RESOURCE PROVIDERS
# ============================================
Write-Step "Step 1: Registering Azure Resource Providers"

$providers = @(
    "Microsoft.CognitiveServices",
    "Microsoft.Sql",
    "Microsoft.Web",
    "Microsoft.Network"
)

foreach ($provider in $providers) {
    Write-Info "Registering $provider..."
    az provider register --namespace $provider --output none 2>$null
}
Write-Success "Resource providers registration initiated"

# ============================================
# CREATE RESOURCE GROUP
# ============================================
Write-Step "Step 2: Creating Resource Group"

$rgExists = az group show --name $ResourceGroupName 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Info "Resource group '$ResourceGroupName' already exists"
} else {
    Write-Info "Creating resource group '$ResourceGroupName' in '$Location'..."
    az group create --name $ResourceGroupName --location $Location --output none
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Failed to create resource group"
        exit 1
    }
}
Write-Success "Resource group ready: $ResourceGroupName"

# ============================================
# CREATE / REUSE AZURE OPENAI RESOURCE
# ============================================
Write-Step "Step 3: Azure OpenAI Resource"

if ($OpenAIMode -eq "Existing") {
    # ── Reuse the customer's existing Azure OpenAI resource (e.g. PTU / Provisioned). ──
    $oaiRg  = if ([string]::IsNullOrWhiteSpace($OpenAIResourceGroup))    { $ResourceGroupName } else { $OpenAIResourceGroup }
    $oaiSub = if ([string]::IsNullOrWhiteSpace($OpenAISubscriptionId))   { $SubscriptionId    } else { $OpenAISubscriptionId }
    if (-not [string]::IsNullOrWhiteSpace($OpenAIEndpoint) -and -not [string]::IsNullOrWhiteSpace($OpenAIKey)) {
        # Endpoint + key supplied directly — no control-plane read needed.
        $openaiEndpoint = $OpenAIEndpoint.TrimEnd('/') + "/"
        $openaiKey = $OpenAIKey
        Write-Success "Using supplied existing OpenAI endpoint (no resource lookup needed)"
    } else {
        # Resolve endpoint + key from the existing resource.
        az cognitiveservices account show --name $OpenAIResourceName --resource-group $oaiRg --subscription $oaiSub 2>&1 | Out-Null
        if ($LASTEXITCODE -ne 0) {
            Write-Error "Existing Azure OpenAI resource '$OpenAIResourceName' not found in resource group '$oaiRg' (subscription: $oaiSub)."
            Write-Host "  Provide -OpenAIEndpoint and -OpenAIKey directly, or check the name / resource group / subscription." -ForegroundColor Yellow
            exit 1
        }
        $openaiEndpoint = az cognitiveservices account show --name $OpenAIResourceName --resource-group $oaiRg --subscription $oaiSub --query "properties.endpoint" -o tsv
        if ([string]::IsNullOrWhiteSpace($OpenAIKey)) {
            $openaiKey = az cognitiveservices account keys list --name $OpenAIResourceName --resource-group $oaiRg --subscription $oaiSub --query "key1" -o tsv
        } else {
            $openaiKey = $OpenAIKey
        }
        Write-Success "Resolved existing Azure OpenAI resource: $OpenAIResourceName (rg: $oaiRg, sub: $oaiSub)"
    }
    Write-Info "OpenAI Endpoint: $openaiEndpoint"
} else {
    # ── Create a NEW Azure OpenAI resource. ──
    $openaiExists = az cognitiveservices account show --name $OpenAIResourceName --resource-group $ResourceGroupName 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Info "Azure OpenAI resource '$OpenAIResourceName' already exists"
    } else {
        Write-Info "Creating Azure OpenAI resource '$OpenAIResourceName'..."
        Write-Info "This may take 2-3 minutes..."

        az cognitiveservices account create `
            --name $OpenAIResourceName `
            --resource-group $ResourceGroupName `
            --location $OpenAILocation `
            --kind OpenAI `
            --sku S0 `
            --custom-domain $OpenAIResourceName `
            --output none

        if ($LASTEXITCODE -ne 0) {
            Write-Error "Failed to create Azure OpenAI resource"
            Write-Host "  Note: Azure OpenAI requires registration. Apply here:" -ForegroundColor Yellow
            Write-Host "  https://aka.ms/oai/access" -ForegroundColor Yellow
            exit 1
        }
    }
    Write-Success "Azure OpenAI resource ready: $OpenAIResourceName"

    # Get OpenAI endpoint
    $openaiEndpoint = az cognitiveservices account show `
        --name $OpenAIResourceName `
        --resource-group $ResourceGroupName `
        --query "properties.endpoint" -o tsv

    Write-Info "OpenAI Endpoint: $openaiEndpoint"

    # Capture an API key - this app authenticates to Azure OpenAI with a key
    # (AI_PROVIDER=azure_openai), not AAD.
    $openaiKey = az cognitiveservices account keys list `
        --name $OpenAIResourceName `
        --resource-group $ResourceGroupName `
        --query "key1" -o tsv
}

# ============================================
# DEPLOY AZURE OPENAI MODEL
# ============================================
Write-Step "Step 4: Deploying Azure OpenAI Model"

# Track what model/version/SKU actually lands behind the deployment alias so the
# summary reports the REAL model (e.g. gpt-5.4), not just the name the user typed.
$deployedModel = ""
$deployedVersion = ""
$deployedSku = ""
$deployedCapacity = ""

if ($OpenAIMode -eq "Existing") {
    # ── EXISTING resource (e.g. PTU): DO NOT create a model deployment. Use the customer's
    #    existing deployment name as-is; best-effort read of its real model for the summary. ──
    $oaiRg  = if ([string]::IsNullOrWhiteSpace($OpenAIResourceGroup))  { $ResourceGroupName } else { $OpenAIResourceGroup }
    $oaiSub = if ([string]::IsNullOrWhiteSpace($OpenAISubscriptionId)) { $SubscriptionId    } else { $OpenAISubscriptionId }
    if ([string]::IsNullOrWhiteSpace($OpenAIDeploymentName)) {
        Write-Error "Existing OpenAI mode requires the model deployment name (-OpenAIDeploymentName). Aborting."
        exit 1
    }
    Write-Info "Using existing model deployment '$OpenAIDeploymentName' on '$OpenAIResourceName' (no new deployment created)."
    # Best-effort: read the real model/version/SKU (works when the identity can read the resource).
    $deployedModel   = az cognitiveservices account deployment show --name $OpenAIResourceName --resource-group $oaiRg --subscription $oaiSub --deployment-name $OpenAIDeploymentName --query "properties.model.name" -o tsv 2>$null
    $deployedVersion = az cognitiveservices account deployment show --name $OpenAIResourceName --resource-group $oaiRg --subscription $oaiSub --deployment-name $OpenAIDeploymentName --query "properties.model.version" -o tsv 2>$null
    $deployedSku     = az cognitiveservices account deployment show --name $OpenAIResourceName --resource-group $oaiRg --subscription $oaiSub --deployment-name $OpenAIDeploymentName --query "sku.name" -o tsv 2>$null
    if ($deployedSku) { Write-Success "Existing deployment SKU: $deployedSku (e.g. ProvisionedManaged = PTU)" }
} else {
    # Deployment-name policy: blank = name the deployment after the ACTUAL model deployed (newest GPT first).
    $useModelAsName = [string]::IsNullOrWhiteSpace($OpenAIDeploymentName)
if ($useModelAsName) {
    # Idempotent re-runs: reuse the first existing deployment on the resource, if any.
    $existingName = az cognitiveservices account deployment list --name $OpenAIResourceName --resource-group $ResourceGroupName --query "[0].name" -o tsv 2>$null
    if ($existingName) { $OpenAIDeploymentName = $existingName }
}

$modelExists = $false
if (-not [string]::IsNullOrWhiteSpace($OpenAIDeploymentName)) {
    az cognitiveservices account deployment show --name $OpenAIResourceName --resource-group $ResourceGroupName --deployment-name $OpenAIDeploymentName 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) { $modelExists = $true }
}

if ($modelExists) {
    Write-Info "Model deployment '$OpenAIDeploymentName' already exists"
    $deployedModel   = az cognitiveservices account deployment show --name $OpenAIResourceName --resource-group $ResourceGroupName --deployment-name $OpenAIDeploymentName --query "properties.model.name" -o tsv 2>$null
    $deployedVersion = az cognitiveservices account deployment show --name $OpenAIResourceName --resource-group $ResourceGroupName --deployment-name $OpenAIDeploymentName --query "properties.model.version" -o tsv 2>$null
    $deployedSku     = az cognitiveservices account deployment show --name $OpenAIResourceName --resource-group $ResourceGroupName --deployment-name $OpenAIDeploymentName --query "sku.name" -o tsv 2>$null
} else {
    Write-Info "Creating model deployment (newest GPT first)..."
    Write-Info "This may take 1-2 minutes..."
    Write-Info "Strategy: newest model first (GPT-5.5 > GPT-5.4 > GPT-5.x > GPT-5 > GPT-4.1 > GPT-4o) + SKU (GlobalStandard > DataZoneStandard > Standard); REAL TPM quota pre-check picks the HIGHEST capacity available, then falls back"
    Write-Info "SKU policy: pay-as-you-go consumption only (S0 account; GlobalStandard/DataZoneStandard/Standard deployments) - no dev/test/free tier"

    # ── MODEL POLICY: newest GA model first (GPT-5.5 -> 5.4 -> ... -> GPT-4o) ──────────────────────
    #   - GlobalStandard (best latency) -> DataZoneStandard -> Standard, with quota-driven fallback.
    # TEMPERATURE COMPATIBILITY (handled in the BACKEND, model-aware): GPT-5.x / o-series are
    # REASONING models that reject a custom `temperature` (only the default value is accepted). The
    # backend (ai_infra_service / assessment_service / finops_ai_service / ai_service) detects a
    # reasoning model and sends NO temperature (with token headroom + low reasoning effort), while
    # non-reasoning models (gpt-4o) still use temperature ~0.2-0.3. Every Azure OpenAI call also
    # retries with the rejected parameter stripped. So deploying the newest model here is safe and
    # will NOT reproduce the earlier
    #     400 "'temperature' does not support 0.3 with this model" error.
    $modelPlan = @(
        @{ Model = "gpt-5.5";     Version = "2026-04-24"; Sku = "GlobalStandard"   },
        @{ Model = "gpt-5.5";     Version = "2026-04-24"; Sku = "DataZoneStandard" },
        @{ Model = "gpt-5.4";     Version = "2026-03-05"; Sku = "GlobalStandard"   },
        @{ Model = "gpt-5.4";     Version = "2026-03-05"; Sku = "DataZoneStandard" },
        @{ Model = "gpt-5.2";     Version = "2025-12-11"; Sku = "GlobalStandard"   },
        @{ Model = "gpt-5.2";     Version = "2025-12-11"; Sku = "DataZoneStandard" },
        @{ Model = "gpt-5.1";     Version = "2025-11-13"; Sku = "GlobalStandard"   },
        @{ Model = "gpt-5.1";     Version = "2025-11-13"; Sku = "DataZoneStandard" },
        @{ Model = "gpt-5";       Version = "2025-08-07"; Sku = "GlobalStandard"   },
        @{ Model = "gpt-5";       Version = "2025-08-07"; Sku = "DataZoneStandard" },
        @{ Model = "gpt-4.1";     Version = "2025-04-14"; Sku = "GlobalStandard"   },
        @{ Model = "gpt-4.1";     Version = "2025-04-14"; Sku = "DataZoneStandard" },
        @{ Model = "gpt-4o";      Version = "2024-11-20"; Sku = "GlobalStandard"   },
        @{ Model = "gpt-4o";      Version = "2024-11-20"; Sku = "DataZoneStandard" },
        @{ Model = "gpt-4o";      Version = "2024-08-06"; Sku = "GlobalStandard"   },
        @{ Model = "gpt-4o";      Version = "2024-08-06"; Sku = "Standard"         },
        @{ Model = "gpt-4o-mini"; Version = "2024-07-18"; Sku = "GlobalStandard"   }
    )
    # ---- REAL TPM QUOTA PRE-CHECK (deploy the highest TPM the quota allows, then fall back) -----
    # `az cognitiveservices usage list` returns the per-model TPM limit and current usage (in
    # thousands of TPM), so we grab the HIGHEST available capacity instead of guessing. Quota names
    # look like 'OpenAI.<Sku>.<modelKey>' (note the gpt-4.1 family is spelled 'gpt4.1', no dash).
    $tpmAvail = @{}
    $usageJson = az cognitiveservices usage list -l $Location -o json 2>$null
    if ($LASTEXITCODE -eq 0 -and $usageJson) {
        try {
            ($usageJson | ConvertFrom-Json) | ForEach-Object {
                $a = [math]::Floor([double]$_.limit - [double]$_.currentValue)
                if ($a -lt 0) { $a = 0 }
                $tpmAvail[$_.name.value] = [int]$a
            }
            Write-Success "TPM quota snapshot loaded for '$Location' ($($tpmAvail.Count) entries)"
        } catch { Write-Info "Could not parse TPM quota - using a default capacity ladder." }
    } else {
        Write-Info "TPM quota API unavailable in '$Location' - using a default capacity ladder."
    }

    function Get-TpmQuotaName { param($Model, $Sku) "OpenAI.$Sku." + ($Model -replace 'gpt-4\.1', 'gpt4.1') }

    # Build a descending capacity ladder (K TPM) topped by the highest the quota allows (cap 1000K).
    function Get-CapacityLadder {
        param([int]$AvailableK)
        if ($AvailableK -le 0) { return @() }                 # no quota -> skip this combo
        $steps = @(1000, 500, 300, 200, 150, 100, 50, 30, 20, 10)
        $top = [math]::Min($AvailableK, 1000)
        $ladder = @($steps | Where-Object { $_ -le $top })
        if ($ladder.Count -eq 0 -or $ladder[0] -ne $top) { $ladder = @($top) + $ladder }
        return ($ladder | Select-Object -Unique)
    }
    $defaultLadder = @(100, 50, 30, 20, 10)   # used only when quota is unknown

    $deploymentSuccess = $false

    foreach ($plan in $modelPlan) {
        if ($deploymentSuccess) { break }

        # Pick the capacity ladder from real quota when known; otherwise the default ladder.
        if ($tpmAvail.Count -gt 0) {
            $qName = Get-TpmQuotaName -Model $plan.Model -Sku $plan.Sku
            $availK = if ($tpmAvail.ContainsKey($qName)) { $tpmAvail[$qName] } else { 0 }
            $ladder = Get-CapacityLadder -AvailableK $availK
            if ($ladder.Count -eq 0) {
                Write-Info "  $($plan.Model) $($plan.Version) | $($plan.Sku) : no TPM quota ($qName) - skipping."
                continue
            }
            Write-Info "  $($plan.Model) $($plan.Version) | $($plan.Sku) : ${availK}K TPM available - trying highest first."
        } else {
            $ladder = $defaultLadder
        }

        foreach ($capacity in $ladder) {
            if ($deploymentSuccess) { break }
            Write-Info "    -> $($plan.Sku) @ ${capacity}K TPM..."
            $depName = if ($useModelAsName) { $plan.Model } else { $OpenAIDeploymentName }
            az cognitiveservices account deployment create `
                --name $OpenAIResourceName `
                --resource-group $ResourceGroupName `
                --deployment-name $depName `
                --model-name $plan.Model `
                --model-version $plan.Version `
                --model-format "OpenAI" `
                --sku-name $plan.Sku `
                --sku-capacity $capacity `
                --output none 2>$null

            if ($LASTEXITCODE -eq 0) {
                $deploymentSuccess = $true
                if ($useModelAsName) { $OpenAIDeploymentName = $plan.Model }
                $deployedModel = $plan.Model
                $deployedSku = $plan.Sku
                $deployedVersion = $plan.Version
                $deployedCapacity = $capacity
                Write-Success "Deployed $($plan.Model) ($($plan.Version)) with ${capacity}K TPM [$($plan.Sku)]"
                if ($plan.Model -eq "gpt-4o-mini") {
                    Write-Info "Note: newer GPT models were unavailable - deployed gpt-4o-mini as a fallback"
                }
            }
        }
    }

    if (-not $deploymentSuccess) {
        Write-Error "Failed to create a model deployment. Please check:"
        Write-Host "  1. Azure OpenAI quota in your subscription (GPT-5.x may need a quota request on lower tiers)" -ForegroundColor Yellow
        Write-Host "  2. Model availability in region '$Location' (try eastus2 or swedencentral)" -ForegroundColor Yellow
        Write-Host "  3. Request a quota increase at: https://aka.ms/oai/quotaincrease" -ForegroundColor Yellow
        exit 1
    }
}
}
# Friendly label that shows the REAL model behind the deployment alias.
if ($deployedModel) {
    $modelDisplay = "$deployedModel $deployedVersion [$deployedSku" + $(if ($deployedCapacity) { ", ${deployedCapacity}K TPM" }) + "]"
} else {
    $modelDisplay = "(deployment name '$OpenAIDeploymentName')"
}
Write-Success "Model deployed: $modelDisplay  (deployment name: '$OpenAIDeploymentName')"

# ============================================
# PRIVATE ENDPOINT FOR OPENAI (PRIVATE MODE)
# ============================================
if ($DeploymentMode -eq "Private" -and $OpenAIMode -eq "Existing") {
    Write-Info "Existing OpenAI mode: skipping OpenAI Private Endpoint creation — the customer's existing"
    Write-Info "Azure OpenAI resource keeps its own networking. Ensure the app can reach it (public key access,"
    Write-Info "or an existing Private Endpoint/DNS the customer already has for that resource)."
}
if ($DeploymentMode -eq "Private" -and $OpenAIMode -ne "Existing") {
    Write-Step "Step 4b: Creating Private Endpoint for Azure OpenAI"
    
    Write-Info "Disabling public network access on Azure OpenAI..."
    az cognitiveservices account update `
        --name $OpenAIResourceName `
        --resource-group $ResourceGroupName `
        --public-network-access Disabled `
        --output none 2>$null
    
    $openaiResourceId = "/subscriptions/$SubscriptionId/resourceGroups/$ResourceGroupName/providers/Microsoft.CognitiveServices/accounts/$OpenAIResourceName"
    $openaiPeName = "${OpenAIResourceName}-pe"
    $openaiDnsZoneName = "privatelink.openai.azure.com"
    
    # Check if PE exists
    $openaiPeExists = az network private-endpoint show --name $openaiPeName --resource-group $ResourceGroupName 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Info "Private Endpoint '$openaiPeName' already exists"
    } else {
        Write-Info "Creating Private Endpoint for Azure OpenAI..."
        az network private-endpoint create `
            --name $openaiPeName `
            --resource-group $ResourceGroupName `
            --location $Location `
            --vnet-name $VNetName `
            --subnet $PrivateEndpointSubnetName `
            --private-connection-resource-id $openaiResourceId `
            --group-id "account" `
            --connection-name "${OpenAIResourceName}-connection" `
            --output none 2>$null
        
        if ($LASTEXITCODE -ne 0) {
            # Try with full subnet resource ID
            Write-Info "Retrying with full subnet resource ID..."
            az network private-endpoint create `
                --name $openaiPeName `
                --resource-group $ResourceGroupName `
                --location $Location `
                --subnet $peSubnetResourceId `
                --private-connection-resource-id $openaiResourceId `
                --group-id "account" `
                --connection-name "${OpenAIResourceName}-connection" `
                --output none
            
            if ($LASTEXITCODE -ne 0) {
                Write-Error "Failed to create Private Endpoint for Azure OpenAI"
                exit 1
            }
        }
        Write-Success "Private Endpoint created: $openaiPeName"
    }
    
    # Create/Configure DNS Zone
    if (-not $dnsZoneOpenAIFound) {
        Write-Info "Creating Private DNS Zone: $openaiDnsZoneName..."
        az network private-dns zone create `
            --name $openaiDnsZoneName `
            --resource-group $dnsZoneResourceGroup `
            --subscription $dnsZoneSubscriptionId `
            --output none 2>$null
        
        if ($LASTEXITCODE -eq 0) {
            Write-Success "Private DNS Zone created: $openaiDnsZoneName"
        }
    }
    
    # Link DNS Zone to VNet
    $openaiDnsLinkName = "link-$VNetName-openai"
    $linkExists = az network private-dns link vnet show `
        --name $openaiDnsLinkName `
        --zone-name $openaiDnsZoneName `
        --resource-group $dnsZoneResourceGroup `
        --subscription $dnsZoneSubscriptionId 2>&1
    
    if ($LASTEXITCODE -ne 0) {
        Write-Info "Linking DNS Zone to VNet..."
        az network private-dns link vnet create `
            --name $openaiDnsLinkName `
            --zone-name $openaiDnsZoneName `
            --resource-group $dnsZoneResourceGroup `
            --subscription $dnsZoneSubscriptionId `
            --virtual-network $vnetResourceId `
            --registration-enabled false `
            --output none
    }
    
    # Create DNS Zone Group
    Write-Info "Creating DNS Zone Group for automatic A record registration..."
    $openaiDnsZoneId = "/subscriptions/$dnsZoneSubscriptionId/resourceGroups/$dnsZoneResourceGroup/providers/Microsoft.Network/privateDnsZones/$openaiDnsZoneName"
    
    az network private-endpoint dns-zone-group create `
        --name "openai-dns-group" `
        --endpoint-name $openaiPeName `
        --resource-group $ResourceGroupName `
        --private-dns-zone $openaiDnsZoneId `
        --zone-name "openai" `
        --output none 2>$null
    
    Write-Success "Azure OpenAI Private Endpoint configured"
    Write-Host ""
}

# ============================================
# CREATE AZURE SQL (Prompt Library + Chat History)
# ============================================
if ($DeploySql) {
    Write-Step "Step 4c: Creating Azure SQL Logical Server"

    if ([string]::IsNullOrWhiteSpace($SqlServerName)) { $SqlServerName = ("sql-$WebAppName").ToLower() }

    # This app connects to Azure SQL with a SQL login (pyodbc connection string),
    # so the server uses SQL authentication with a generated strong password.
    # No DB-side bootstrapping is required and this works in Private mode.
    $sqlServerExists = az sql server show --name $SqlServerName --resource-group $ResourceGroupName 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Info "SQL server '$SqlServerName' already exists - reusing"
        if ([string]::IsNullOrWhiteSpace($SqlAdminPassword)) {
            Write-Error "SQL server '$SqlServerName' exists but no -SqlAdminPassword was provided to build the connection string."
            Write-Host "  Re-run with -SqlAdminPassword '<existing-password>' (and -SqlAdminUser if not '$SqlAdminUser')." -ForegroundColor Yellow
            exit 1
        }
        # Reset the existing server's admin password to the provided value so the server ALWAYS
        # matches the connection string stored below. Without this, a mismatched password causes
        # "Login failed for user" (error 18456) and snapshot persistence silently breaks.
        az sql server update --name $SqlServerName --resource-group $ResourceGroupName --admin-password $SqlAdminPassword --output none 2>$null
        if ($LASTEXITCODE -eq 0) { Write-Success "Reset SQL admin password on existing server (keeps connection string in sync)" }
        else { Write-Warning "Could not reset SQL admin password on existing server '$SqlServerName' - ensure the provided password is correct." }
    } else {
        if ([string]::IsNullOrWhiteSpace($SqlAdminPassword)) {
            $SqlAdminPassword = (-join ((65..90) + (97..122) + (50..57) | Get-Random -Count 20 | ForEach-Object { [char]$_ })) + "!aZ7"
        }
        Write-Info "Creating SQL logical server '$SqlServerName' (SQL authentication)..."
        az sql server create `
            --name $SqlServerName `
            --resource-group $ResourceGroupName `
            --location $Location `
            --admin-user $SqlAdminUser `
            --admin-password $SqlAdminPassword `
            --output none
        if ($LASTEXITCODE -ne 0) {
            Write-Error "Failed to create Azure SQL logical server"
            exit 1
        }
        Write-Success "SQL logical server created: $SqlServerName (admin: $SqlAdminUser)"
        if ($DeploymentMode -ne "Private") {
            # Allow Azure-hosted services (the Web App) to reach SQL.
            az sql server firewall-rule create --resource-group $ResourceGroupName --server $SqlServerName --name "AllowAzureServices" --start-ip-address 0.0.0.0 --end-ip-address 0.0.0.0 --output none 2>$null
        }
    }

    # Connection string the app reads (DATABASE_PROVIDER=azuresql + AZURE_SQL_CONNECTION_STRING).
    $sqlConnectionString = "Driver={ODBC Driver 18 for SQL Server};Server=tcp:$SqlServerName.database.windows.net,1433;Database=$SqlDatabaseName;Uid=$SqlAdminUser;Pwd=$SqlAdminPassword;Encrypt=yes;TrustServerCertificate=no;Connection Timeout=30;"

    Write-Step "Step 4d: Creating Azure SQL Database ($SqlServiceObjective)"
    $sqlDbExists = az sql db show --name $SqlDatabaseName --server $SqlServerName --resource-group $ResourceGroupName 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Info "Database '$SqlDatabaseName' already exists - reusing"
    } else {
        Write-Info "Creating database '$SqlDatabaseName' (SKU $SqlServiceObjective, ${SqlMaxSizeGb}GB, backup=$SqlBackupStorageRedundancy)..."
        $dbArgs = @(
            'sql','db','create',
            '--name', $SqlDatabaseName,
            '--server', $SqlServerName,
            '--resource-group', $ResourceGroupName,
            '--service-objective', $SqlServiceObjective,
            '--max-size', ("{0}GB" -f $SqlMaxSizeGb),
            '--backup-storage-redundancy', $SqlBackupStorageRedundancy,
            '--output', 'none'
        )
        if ($SqlZoneRedundant) { $dbArgs += '--zone-redundant' }
        az @dbArgs
        if ($LASTEXITCODE -ne 0) {
            Write-Error "Failed to create Azure SQL database"
            exit 1
        }
        Write-Success "Azure SQL database created: $SqlDatabaseName"
    }

    if ($DeploymentMode -eq "Private") {
        Write-Step "Step 4e: Creating Private Endpoint for Azure SQL"

        Write-Info "Disabling public network access on the SQL server..."
        az sql server update `
            --name $SqlServerName `
            --resource-group $ResourceGroupName `
            --enable-public-network false `
            --output none 2>$null

        $sqlServerResourceId = "/subscriptions/$SubscriptionId/resourceGroups/$ResourceGroupName/providers/Microsoft.Sql/servers/$SqlServerName"
        $sqlPeName = "${SqlServerName}-pe"
        $sqlDnsZoneName = "privatelink.database.windows.net"

        $sqlPeExists = az network private-endpoint show --name $sqlPeName --resource-group $ResourceGroupName 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Info "Private Endpoint '$sqlPeName' already exists"
        } else {
            Write-Info "Creating Private Endpoint for Azure SQL..."
            az network private-endpoint create `
                --name $sqlPeName `
                --resource-group $ResourceGroupName `
                --location $Location `
                --vnet-name $VNetName `
                --subnet $PrivateEndpointSubnetName `
                --private-connection-resource-id $sqlServerResourceId `
                --group-id "sqlServer" `
                --connection-name "${SqlServerName}-connection" `
                --output none 2>$null
            if ($LASTEXITCODE -ne 0) {
                Write-Info "Retrying with full subnet resource ID..."
                az network private-endpoint create `
                    --name $sqlPeName `
                    --resource-group $ResourceGroupName `
                    --location $Location `
                    --subnet $peSubnetResourceId `
                    --private-connection-resource-id $sqlServerResourceId `
                    --group-id "sqlServer" `
                    --connection-name "${SqlServerName}-connection" `
                    --output none
                if ($LASTEXITCODE -ne 0) {
                    Write-Error "Failed to create Private Endpoint for Azure SQL"
                    exit 1
                }
            }
            Write-Success "Private Endpoint created: $sqlPeName"
        }

        # Private DNS zone for SQL
        $existingSqlDns = az network private-dns zone list --subscription $dnsZoneSubscriptionId --query "[?name=='$sqlDnsZoneName'].{Name:name, RG:resourceGroup}" -o json 2>$null | ConvertFrom-Json
        if (-not ($existingSqlDns -and $existingSqlDns.Count -gt 0)) {
            Write-Info "Creating Private DNS Zone: $sqlDnsZoneName..."
            az network private-dns zone create `
                --name $sqlDnsZoneName `
                --resource-group $dnsZoneResourceGroup `
                --subscription $dnsZoneSubscriptionId `
                --output none 2>$null
        } else {
            $dnsZoneResourceGroup = $existingSqlDns[0].RG
        }

        $sqlDnsLinkName = "link-$VNetName-sql"
        $sqlLinkExists = az network private-dns link vnet show --name $sqlDnsLinkName --zone-name $sqlDnsZoneName --resource-group $dnsZoneResourceGroup --subscription $dnsZoneSubscriptionId 2>&1
        if ($LASTEXITCODE -ne 0) {
            Write-Info "Linking SQL DNS Zone to VNet..."
            az network private-dns link vnet create `
                --name $sqlDnsLinkName `
                --zone-name $sqlDnsZoneName `
                --resource-group $dnsZoneResourceGroup `
                --subscription $dnsZoneSubscriptionId `
                --virtual-network $vnetResourceId `
                --registration-enabled false `
                --output none
        }

        Write-Info "Creating DNS Zone Group for SQL Private Endpoint..."
        $sqlDnsZoneId = "/subscriptions/$dnsZoneSubscriptionId/resourceGroups/$dnsZoneResourceGroup/providers/Microsoft.Network/privateDnsZones/$sqlDnsZoneName"
        az network private-endpoint dns-zone-group create `
            --name "sql-dns-group" `
            --endpoint-name $sqlPeName `
            --resource-group $ResourceGroupName `
            --private-dns-zone $sqlDnsZoneId `
            --zone-name "sql" `
            --output none 2>$null

        Write-Success "Azure SQL Private Endpoint configured"
    } else {
        # Public mode: allow Azure services (the Web App's outbound traffic) to reach SQL.
        Write-Info "Enabling 'Allow Azure services' firewall rule on the SQL server..."
        az sql server firewall-rule create `
            --resource-group $ResourceGroupName `
            --server $SqlServerName `
            --name "AllowAzureServices" `
            --start-ip-address 0.0.0.0 `
            --end-ip-address 0.0.0.0 `
            --output none 2>$null
    }
    Write-Host ""
}

# ============================================
# CREATE APP SERVICE PLAN
# ============================================
# ============================================
# CREATE AZURE CACHE FOR REDIS (optional L2 cache)
# ============================================
if ($DeployRedis -and [string]::IsNullOrWhiteSpace($RedisUrl)) {
    Write-Step "Step 4f: Creating Azure Cache for Redis"
    $redisName = ("$WebAppName-redis").ToLower()
    if ($redisName.Length -gt 63) { $redisName = $redisName.Substring(0,63) }
    $redisExists = az redis show --name $redisName --resource-group $ResourceGroupName 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Info "Redis '$redisName' already exists - reusing"
    } else {
        Write-Info "Creating Azure Cache for Redis '$redisName' ($RedisSku $RedisVmSize). This can take 15-20 minutes..."
        az redis create `
            --name $redisName `
            --resource-group $ResourceGroupName `
            --location $Location `
            --sku $RedisSku `
            --vm-size $RedisVmSize `
            --minimum-tls-version 1.2 `
            --output none 2>$null
        if ($LASTEXITCODE -ne 0) {
            Write-Host "  WARNING: Redis provisioning failed/unavailable in '$Location' - continuing without an L2 cache (the app degrades gracefully)." -ForegroundColor Yellow
        }
    }
    $redisHostName = az redis show --name $redisName --resource-group $ResourceGroupName --query "hostName" -o tsv 2>$null
    $redisKey      = az redis list-keys --name $redisName --resource-group $ResourceGroupName --query "primaryKey" -o tsv 2>$null
    if (-not [string]::IsNullOrWhiteSpace($redisHostName) -and -not [string]::IsNullOrWhiteSpace($redisKey)) {
        $redisUrl = "rediss://:$([uri]::EscapeDataString($redisKey))@${redisHostName}:6380/0"
        Write-Success "Redis ready: $redisHostName"

        if ($DeploymentMode -eq "Private") {
            Write-Info "Disabling public access + creating Private Endpoint for Redis..."
            az redis update --name $redisName --resource-group $ResourceGroupName --set publicNetworkAccess=Disabled --output none 2>$null
            $redisResourceId = "/subscriptions/$SubscriptionId/resourceGroups/$ResourceGroupName/providers/Microsoft.Cache/Redis/$redisName"
            $redisPeName = "${redisName}-pe"
            az network private-endpoint create `
                --name $redisPeName `
                --resource-group $ResourceGroupName `
                --location $Location `
                --vnet-name $VNetName `
                --subnet $PrivateEndpointSubnetName `
                --private-connection-resource-id $redisResourceId `
                --group-id "redisCache" `
                --connection-name "${redisName}-connection" `
                --output none 2>$null
            $redisDnsZoneName = "privatelink.redis.cache.windows.net"
            az network private-dns zone create --name $redisDnsZoneName --resource-group $dnsZoneResourceGroup --subscription $dnsZoneSubscriptionId --output none 2>$null
            $redisDnsLinkName = "link-$VNetName-redis"
            az network private-dns link vnet show --name $redisDnsLinkName --zone-name $redisDnsZoneName --resource-group $dnsZoneResourceGroup --subscription $dnsZoneSubscriptionId 2>$null | Out-Null
            if ($LASTEXITCODE -ne 0) {
                az network private-dns link vnet create --name $redisDnsLinkName --zone-name $redisDnsZoneName --resource-group $dnsZoneResourceGroup --subscription $dnsZoneSubscriptionId --virtual-network $vnetResourceId --registration-enabled false --output none 2>$null
            }
            $redisDnsZoneId = "/subscriptions/$dnsZoneSubscriptionId/resourceGroups/$dnsZoneResourceGroup/providers/Microsoft.Network/privateDnsZones/$redisDnsZoneName"
            az network private-endpoint dns-zone-group create --name "redis-dns-group" --endpoint-name $redisPeName --resource-group $ResourceGroupName --private-dns-zone $redisDnsZoneId --zone-name "redis" --output none 2>$null
            Write-Success "Redis Private Endpoint configured"
        }
    }
    Write-Host ""
} elseif (-not [string]::IsNullOrWhiteSpace($RedisUrl)) {
    $redisUrl = $RedisUrl
    Write-Info "Using provided Redis URL for the L2 cache"
}

Write-Step "Step 5: Creating App Service Plan"

$planExists = az appservice plan show --name $AppServicePlanName --resource-group $ResourceGroupName 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Info "App Service Plan '$AppServicePlanName' already exists"
} else {
    # Helper: attempt to create the plan with a given SKU.
    # Returns: 'Success' | 'Fallback' (quota/capacity/region/invalid -> try next) | 'Stop' (permissions -> abort)
    function Try-CreateAppServicePlan {
        param([string]$Sku)
        Write-Info "Creating App Service Plan '$AppServicePlanName' (SKU: $Sku, Linux) in '$Location'..."
        $createOut = az appservice plan create `
            --name $AppServicePlanName `
            --resource-group $ResourceGroupName `
            --location $Location `
            --sku $Sku `
            --is-linux `
            --output none 2>&1
        if ($LASTEXITCODE -eq 0) { return 'Success' }
        $msg = ($createOut | Out-String).Trim()
        if ($msg -match 'AuthorizationFailed|does not have authorization|Forbidden|insufficient privileges|RBAC') {
            Write-Warning "SKU '$Sku' failed due to a PERMISSIONS error (won't be fixed by another SKU):"
            Write-Host "    $msg" -ForegroundColor Red
            return 'Stop'
        }
        if ($msg -match 'Quota|quota|No available instances|capacity|SkuNotAvailable|NotAvailableForSubscription|not available in|is not available|ServiceUnavailable|InvalidSku|not supported|not a valid') {
            Write-Info "SKU '$Sku' unavailable (quota/capacity/region) - trying next preferred SKU..."
        } else {
            Write-Info "SKU '$Sku' failed: $msg - trying next preferred SKU..."
        }
        return 'Fallback'
    }

    # Helper: REAL App Service quota pre-check via Microsoft.Quota (Microsoft.Web provider).
    # Returns the allocated CORE limit for $Sku in $Region:
    #    N (>=0) = quota limit in cores;  -1 = unknown (API error -> caller should attempt anyway).
    # This reflects per-subscription backend allow-listing, so a premium SKU can report quota here
    # even when it is NOT in the public `az appservice list-locations` catalog (e.g. Pmv3/Pv4 SKUs
    # enabled for the subscription in Qatar Central). It is therefore a better signal than the catalog.
    function Get-AppServiceSkuQuota {
        param([string]$Sku, [string]$Region)
        $regionKey = ($Region -replace '\s', '').ToLower()
        $scope = "/subscriptions/$SubscriptionId/providers/Microsoft.Web/locations/$regionKey"
        $q = az quota show --resource-name $Sku --scope $scope -o json 2>$null
        if ($LASTEXITCODE -ne 0 -or -not $q) { return -1 }
        try {
            $val = ($q | ConvertFrom-Json).properties.limit.value
            if ($null -eq $val) { return -1 }
            return [int]$val
        } catch { return -1 }
    }

    # ---- ACR-MAXIMIZING SKU SELECTION -------------------------------------------------
    # Deploy the MOST EXPENSIVE App Service plan the subscription/region can support, trying the
    # operator's preferred order. A REAL quota pre-check (Microsoft.Quota, see Get-AppServiceSkuQuota)
    # picks the highest-priority SKU that actually has core quota; the create call is the final
    # authority and the ladder falls back on any quota/capacity/region error. All premium SKUs are
    # >=32 GB RAM, so the Oryx build cannot OOM (unlike the 1.75 GB S1/B-series).
    $premiumPreference = @('P4mv3', 'P4mv4', 'P3mv4', 'P3mv3', 'P3v4', 'P3v3')
    $skuMonthlyUsd = @{ 'P4mv3' = 1177; 'P4mv4' = 1301; 'P3mv4' = 650; 'P3mv3' = 588; 'P3v4' = 511; 'P3v3' = 490; 'P1v3' = 146 }
    # vCPU each SKU needs for one instance (used to compare against the quota core limit).
    $skuRequiredCores = @{ 'P4mv3' = 16; 'P4mv4' = 16; 'P3mv4' = 8; 'P3mv3' = 8; 'P3v4' = 8; 'P3v3' = 8; 'P2v3' = 4; 'P1v3' = 2; 'P0v3' = 1 }

    if ($AppServiceSku -and $AppServiceSku -ne 'Auto') {
        # Operator pinned a SKU (default P3v3 for this Qatar Central variant): deploy EXACTLY that
        # SKU as-is. No premium fallback ladder and no P1v3 floor — the plan is provisioned with the
        # requested SKU only (Qatar Central capacity for this SKU must be whitelisted beforehand);
        # if it is blocked, the operator is prompted rather than silently downgraded.
        $desiredLadder = @($AppServiceSku)
    } else {
        # Only used if someone explicitly passes -AppServiceSku Auto.
        $desiredLadder = @($premiumPreference + 'P1v3') |
            Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
            Select-Object -Unique
    }

    # ---- REAL QUOTA PRE-CHECK (start with the most expensive SKU that has quota) ----------------
    # Query Microsoft.Quota for each SKU's allocated core limit in this region (operator priority
    # order) and attempt the SKUs that HAVE quota first. SKUs whose quota is unknown (API error) are
    # attempted next; SKUs with insufficient quota are tried only as a last resort before the P1v3
    # safety floor. Same idea as the OpenAI TPM ladder: grab the highest tier with headroom, then
    # fall back. The create call remains the final authority.
    Write-Info "Checking App Service Plan quota in '$Location'..."
    $withQuota = @(); $noQuota = @(); $unknownQuota = @()
    foreach ($candidate in $desiredLadder) {
        $need = $skuRequiredCores[$candidate]; if (-not $need) { $need = 1 }
        $lim = Get-AppServiceSkuQuota -Sku $candidate -Region $Location
        if ($lim -lt 0) {
            Write-Info "  $candidate : quota not confirmed - will attempt."
            $unknownQuota += $candidate
        } elseif ($lim -ge $need) {
            Write-Success "  $candidate : quota available."
            $withQuota += $candidate
        } else {
            Write-Info "  $candidate : insufficient quota - will try only if needed."
            $noQuota += $candidate
        }
    }
    # Attempt order: confirmed-quota (operator priority) -> unknown -> insufficient -> P1v3 floor.
    $skuLadder = @($withQuota + $unknownQuota + $noQuota + 'P1v3') |
        Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
        Select-Object -Unique
    if ($withQuota.Count -eq 0) {
        Write-Warning "Quota for the preferred App Service Plan SKUs could not be confirmed via the quota API."
        Write-Warning "Please ensure that quota is available for the selected subscription in '$Location'."
    }
    Write-Info "Attempt order: $($skuLadder -join ' -> ')"

    $planCreated = $false
    foreach ($sku in $skuLadder) {
        $result = Try-CreateAppServicePlan -Sku $sku
        if ($result -eq 'Success') {
            $AppServiceSku = $sku
            $planCreated = $true
            Write-Success "App Service Plan provisioned with SKU '$sku'."
            break
        }
        elseif ($result -eq 'Stop') {
            Write-Error "App Service Plan creation aborted: non-recoverable permissions error (see above)."
            exit 1
        }
        # 'Fallback' -> try next SKU
    }

    # If the whole ladder is exhausted, let the operator decide instead of hard-failing.
    while (-not $planCreated) {
        Write-Host ""
        Write-Host "  ⚠️  No App Service capacity available in '$Location' for any tried SKU ($($skuLadder -join ', '))." -ForegroundColor Yellow
        Write-Host "  Choose how to proceed:" -ForegroundColor White
        Write-Host "    [1] Retry the SKU ladder (capacity often frees up within minutes)" -ForegroundColor Gray
        Write-Host "    [2] Enter a specific SKU to try (e.g. P2v3, P3v3, I1v2)" -ForegroundColor Gray
        Write-Host "    [3] Abort" -ForegroundColor Gray
        $capChoice = Read-Host "  Enter choice (1/2/3)"
        switch ($capChoice) {
            '1' {
                foreach ($sku in $skuLadder) {
                    if ((Try-CreateAppServicePlan -Sku $sku) -eq 'Success') { $AppServiceSku = $sku; $planCreated = $true; break }
                }
            }
            '2' {
                $customSku = Read-Host "  SKU to try"
                if (-not [string]::IsNullOrWhiteSpace($customSku)) {
                    if ((Try-CreateAppServicePlan -Sku $customSku.Trim()) -eq 'Success') { $AppServiceSku = $customSku.Trim(); $planCreated = $true }
                }
            }
            '3' {
                Write-Error "Aborted by user - App Service Plan not created."
                Write-Host "  Tips: retry later, deploy to a NEW resource group, or pick a different region" -ForegroundColor Yellow
                Write-Host "  (region change requires a fresh deployment so Private Endpoints stay in the VNet region)." -ForegroundColor Yellow
                exit 1
            }
            default {
                Write-Info "Please enter 1, 2, or 3."
            }
        }
    }
}
Write-Success "App Service Plan ready: $AppServicePlanName (SKU: $AppServiceSku)"

# ============================================
# CREATE WEB APP WITH MANAGED IDENTITY
# ============================================
Write-Step "Step 6: Creating Web App with Managed Identity"

$webAppExists = az webapp show --name $WebAppName --resource-group $ResourceGroupName 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Info "Web App '$WebAppName' already exists"
    
    # Ensure managed identity is enabled
    Write-Info "Ensuring managed identity is enabled..."
    az webapp identity assign `
        --name $WebAppName `
        --resource-group $ResourceGroupName `
        --output none 2>$null
} else {
    Write-Info "Creating Web App '$WebAppName' with Python 3.11..."
    az webapp create `
        --name $WebAppName `
        --resource-group $ResourceGroupName `
        --plan $AppServicePlanName `
        --runtime "PYTHON:3.11" `
        --output none
    
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Failed to create Web App"
        exit 1
    }
    
    # Enable managed identity
    Write-Info "Enabling System-Assigned Managed Identity..."
    az webapp identity assign `
        --name $WebAppName `
        --resource-group $ResourceGroupName `
        --output none
}

# Get principal ID
$principalId = az webapp show `
    --name $WebAppName `
    --resource-group $ResourceGroupName `
    --query "identity.principalId" -o tsv

if ([string]::IsNullOrEmpty($principalId)) {
    Write-Error "Failed to get Managed Identity Principal ID"
    exit 1
}

Write-Success "Web App ready: $WebAppName"
Write-Info "Managed Identity Principal ID: $principalId"

# ============================================
# CONFIGURE WEB APP SETTINGS
# ============================================
Write-Step "Step 7: Configuring Web App Settings"

Write-Info "Setting application configuration..."

# Build settings array (the app's real env contract — see backend/services/*).
# The app authenticates to Azure with the Web App's SYSTEM-ASSIGNED MANAGED
# IDENTITY via DefaultAzureCredential, so we deliberately do NOT set
# AZURE_CLIENT_ID / AZURE_CLIENT_SECRET (that would force a service-principal path).
$settings = @(
    "AI_PROVIDER=azure_openai",
    "AZURE_OPENAI_ENDPOINT=$openaiEndpoint",
    "AZURE_OPENAI_KEY=$openaiKey",
    "AZURE_OPENAI_DEPLOYMENT=$OpenAIDeploymentName",
    "AZURE_TENANT_ID=$EntraTenantId",
    "AZURE_SUBSCRIPTION_ID=$SubscriptionId",
    "AZURE_SUBSCRIPTION_IDS=$ScanSubscriptionsEnv",
    "ENTRA_CLIENT_ID=$EntraAppClientId",
    "ENTRA_TENANT_ID=$EntraTenantId",
    "AUTH_REQUIRED=true",
    "AUTO_REFRESH_INTERVAL_HOURS=6",
    "SETTINGS_DIR=/home/site/wwwroot/config",
    "WEBSITES_PORT=8000",
    "SCM_DO_BUILD_DURING_DEPLOYMENT=true",
    "WEBSITE_PYTHON_VERSION=3.11"
)

# Prompt Library / scan-history persistence -> Azure SQL (pyodbc, SQL auth).
if ($DeploySql) {
    $settings += @(
        "DATABASE_PROVIDER=azuresql",
        "AZURE_SQL_CONNECTION_STRING=$sqlConnectionString"
    )
}

# Optional shared L2 cache + distributed lock (Azure Cache for Redis).
if (-not [string]::IsNullOrWhiteSpace($redisUrl)) {
    $settings += @("REDIS_URL=$redisUrl")
}

$settingsString = $settings -join " "

az webapp config appsettings set `
    --name $WebAppName `
    --resource-group $ResourceGroupName `
    --settings $settings `
    --output none

if ($LASTEXITCODE -ne 0) {
    Write-Error "Failed to configure app settings"
    exit 1
}

# Configure startup command.
# When Azure SQL is deployed, use startup.sh which installs the ODBC Driver 18
# (needed by pyodbc for the managed-identity SQL connection) before launching
# the app. Otherwise launch uvicorn directly.
Write-Info "Setting startup command for FastAPI..."
# Always use startup.sh - it installs the ODBC driver (for Azure SQL) and runs
# uvicorn from the backend/ directory (which serves the API and the built SPA).
$startupFile = "bash /home/site/wwwroot/startup.sh"
az webapp config set `
    --name $WebAppName `
    --resource-group $ResourceGroupName `
    --startup-file $startupFile `
    --output none

Write-Success "Web App configuration applied"

# ============================================
# WEB APP VNET INTEGRATION (PRIVATE MODE)
# Required so the app's OUTBOUND calls reach the PRIVATE Azure OpenAI endpoint
# (OpenAI public access is disabled). Without this the app deploys but fails at
# runtime resolving *.openai.azure.com to the blocked public IP.
# ============================================
if ($DeploymentMode -eq "Private") {
    Write-Step "Step 7a: Connecting Web App to VNet (Regional Integration)"

    Write-Info "Adding regional VNet integration into subnet '$AppServiceIntegrationSubnetName'..."
    az webapp vnet-integration add `
        --name $WebAppName `
        --resource-group $ResourceGroupName `
        --vnet $vnetResourceId `
        --subnet $AppServiceIntegrationSubnetName `
        --output none 2>$null

    if ($LASTEXITCODE -ne 0) {
        Write-Error "Failed to add VNet integration for the Web App"
        Write-Host "  Verify subnet '$AppServiceIntegrationSubnetName' is delegated to Microsoft.Web/serverFarms and has free address space." -ForegroundColor Yellow
        exit 1
    }

    # Route ALL outbound traffic (incl. DNS) through the VNet so privatelink zones resolve
    Write-Info "Enabling route-all so outbound DNS uses the private DNS zones..."
    az webapp config set `
        --name $WebAppName `
        --resource-group $ResourceGroupName `
        --vnet-route-all-enabled true `
        --output none 2>$null

    Write-Success "Web App connected to VNet: $VNetName / $AppServiceIntegrationSubnetName"
    Write-Host ""
}

# ============================================
# PRIVATE ENDPOINT FOR WEB APP (PRIVATE MODE)
# ============================================
if ($DeploymentMode -eq "Private") {
    Write-Step "Step 7b: Creating Private Endpoint for Web App"
    
    $webAppResourceId = "/subscriptions/$SubscriptionId/resourceGroups/$ResourceGroupName/providers/Microsoft.Web/sites/$WebAppName"
    $webAppPeName = "${WebAppName}-pe"
    $webAppDnsZoneName = "privatelink.azurewebsites.net"
    
    # Check if PE exists
    $webAppPeExists = az network private-endpoint show --name $webAppPeName --resource-group $ResourceGroupName 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Info "Private Endpoint '$webAppPeName' already exists"
    } else {
        Write-Info "Creating Private Endpoint for Web App..."
        az network private-endpoint create `
            --name $webAppPeName `
            --resource-group $ResourceGroupName `
            --location $Location `
            --vnet-name $VNetName `
            --subnet $PrivateEndpointSubnetName `
            --private-connection-resource-id $webAppResourceId `
            --group-id "sites" `
            --connection-name "${WebAppName}-connection" `
            --output none 2>$null
        
        if ($LASTEXITCODE -ne 0) {
            # Try with full subnet resource ID
            Write-Info "Retrying with full subnet resource ID..."
            az network private-endpoint create `
                --name $webAppPeName `
                --resource-group $ResourceGroupName `
                --location $Location `
                --subnet $peSubnetResourceId `
                --private-connection-resource-id $webAppResourceId `
                --group-id "sites" `
                --connection-name "${WebAppName}-connection" `
                --output none
            
            if ($LASTEXITCODE -ne 0) {
                Write-Error "Failed to create Private Endpoint for Web App"
                exit 1
            }
        }
        Write-Success "Private Endpoint created: $webAppPeName"
    }
    
    # NOTE: Public network access is intentionally left ENABLED here so the app (zip)
    # can be pushed via the public SCM/Kudu endpoint in Step 8. It is disabled in
    # Step 8c AFTER a successful code deployment, ending in a fully private posture.
    
    # Create/Configure DNS Zone
    if (-not $dnsZoneWebAppFound) {
        Write-Info "Creating Private DNS Zone: $webAppDnsZoneName..."
        az network private-dns zone create `
            --name $webAppDnsZoneName `
            --resource-group $dnsZoneResourceGroup `
            --subscription $dnsZoneSubscriptionId `
            --output none 2>$null
        
        if ($LASTEXITCODE -eq 0) {
            Write-Success "Private DNS Zone created: $webAppDnsZoneName"
        }
    }
    
    # Link DNS Zone to VNet
    $webAppDnsLinkName = "link-$VNetName-webapp"
    $linkExists = az network private-dns link vnet show `
        --name $webAppDnsLinkName `
        --zone-name $webAppDnsZoneName `
        --resource-group $dnsZoneResourceGroup `
        --subscription $dnsZoneSubscriptionId 2>&1
    
    if ($LASTEXITCODE -ne 0) {
        Write-Info "Linking DNS Zone to VNet..."
        az network private-dns link vnet create `
            --name $webAppDnsLinkName `
            --zone-name $webAppDnsZoneName `
            --resource-group $dnsZoneResourceGroup `
            --subscription $dnsZoneSubscriptionId `
            --virtual-network $vnetResourceId `
            --registration-enabled false `
            --output none
    }
    
    # Create DNS Zone Group
    Write-Info "Creating DNS Zone Group for automatic A record registration..."
    $webAppDnsZoneId = "/subscriptions/$dnsZoneSubscriptionId/resourceGroups/$dnsZoneResourceGroup/providers/Microsoft.Network/privateDnsZones/$webAppDnsZoneName"
    
    az network private-endpoint dns-zone-group create `
        --name "webapp-dns-group" `
        --endpoint-name $webAppPeName `
        --resource-group $ResourceGroupName `
        --private-dns-zone $webAppDnsZoneId `
        --zone-name "webapp" `
        --output none 2>$null
    
    Write-Success "Web App Private Endpoint configured"
    Write-Host ""
}

# ============================================
# DEPLOY APPLICATION CODE
# ============================================
Write-Step "Step 8: Deploying Application Code"

# The application root is the REPO ROOT (the parent of this Scripts/ folder).
$repoRoot = Split-Path -Parent $PSScriptRoot
Write-Info "Application root: $repoRoot"

foreach ($req in @("backend/main.py", "backend/requirements.txt", "frontend/package.json", "startup.sh")) {
    if (-not (Test-Path (Join-Path $repoRoot $req))) {
        Write-Error "Required path not found: $req"
        Write-Host "  Run this script from the repository's Scripts/ folder." -ForegroundColor Yellow
        exit 1
    }
}
Write-Success "Application sources found"

# 1) Build the React frontend (the backend serves frontend/dist as the SPA).
Write-Info "Building frontend (npm)... this can take a few minutes"
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Error "npm not found. Install Node.js LTS to build the frontend, then re-run."
    exit 1
}
Push-Location (Join-Path $repoRoot "frontend")
& npm ci 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { & npm install 2>&1 | Out-Null }
& npm run build 2>&1 | Out-Null
$buildExit = $LASTEXITCODE
Pop-Location
if ($buildExit -ne 0 -or -not (Test-Path (Join-Path $repoRoot "frontend/dist/index.html"))) {
    Write-Error "Frontend build failed (frontend/dist not produced)."
    exit 1
}
Write-Success "Frontend built (frontend/dist)"

# 2) Stage the real app layout, EXCLUDING secrets / venv / caches / local data.
Write-Info "Creating deployment package..."
$zipPath = Join-Path $env:TEMP "costopt-deploy-$(Get-Date -Format 'yyyyMMddHHmmss').zip"
$staging = Join-Path $env:TEMP "costopt-stage-$(Get-Date -Format 'yyyyMMddHHmmss')"
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
New-Item -ItemType Directory -Path $staging -Force | Out-Null
try {
    # backend/ (drop venv, caches, local sqlite data and any .env secrets)
    robocopy (Join-Path $repoRoot "backend") (Join-Path $staging "backend") /E `
        /XD ".venv" "__pycache__" ".pytest_cache" "data" `
        /XF ".env" "*.pyc" | Out-Null
    # built SPA
    robocopy (Join-Path $repoRoot "frontend\dist") (Join-Path $staging "frontend\dist") /E | Out-Null
    # Azure service icons (served at /icons)
    if (Test-Path (Join-Path $repoRoot "Icons")) {
        robocopy (Join-Path $repoRoot "Icons") (Join-Path $staging "Icons") /E | Out-Null
    }
    # Complete requirements at wwwroot root (Oryx installs these) + startup.sh
    Copy-Item (Join-Path $repoRoot "backend\requirements.txt") (Join-Path $staging "requirements.txt") -Force
    Copy-Item (Join-Path $repoRoot "startup.sh") (Join-Path $staging "startup.sh") -Force

    Compress-Archive -Path (Join-Path $staging "*") -DestinationPath $zipPath -Force
    Write-Success "Deployment package created: $zipPath"
} catch {
    Write-Error "Failed to create deployment package: $_"
    exit 1
} finally {
    Remove-Item $staging -Recurse -Force -ErrorAction SilentlyContinue
}

# Deploy using zip deployment
Write-Info "Deploying application to Azure App Service..."
Write-Info "This may take 2-5 minutes (includes pip install)..."

az webapp deploy `
    --name $WebAppName `
    --resource-group $ResourceGroupName `
    --src-path $zipPath `
    --type zip `
    --async false `
    --output none

if ($LASTEXITCODE -ne 0) {
    # Try alternative deployment method
    Write-Info "Retrying with alternative deployment method..."
    az webapp deployment source config-zip `
        --name $WebAppName `
        --resource-group $ResourceGroupName `
        --src $zipPath `
        --output none
    
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Failed to deploy application code"
        Write-Host "  Check logs: az webapp log tail --name $WebAppName --resource-group $ResourceGroupName" -ForegroundColor Yellow
        exit 1
    }
}

# Clean up zip file
Remove-Item $zipPath -Force -ErrorAction SilentlyContinue

Write-Success "Application code deployed"

# ============================================
# LOCK DOWN PUBLIC ACCESS (PRIVATE MODE) - after code is deployed
# ============================================
if ($DeploymentMode -eq "Private") {
    Write-Step "Step 8c: Disabling Public Network Access on Web App"
    Write-Info "Code is deployed - sealing the Web App behind its Private Endpoint..."
    $webAppResourceIdLockdown = "/subscriptions/$SubscriptionId/resourceGroups/$ResourceGroupName/providers/Microsoft.Web/sites/$WebAppName"
    az webapp update `
        --name $WebAppName `
        --resource-group $ResourceGroupName `
        --set publicNetworkAccess=Disabled `
        --output none 2>$null
    if ($LASTEXITCODE -ne 0) {
        az resource update `
            --ids $webAppResourceIdLockdown `
            --set properties.publicNetworkAccess=Disabled `
            --output none 2>$null
    }
    if ($LASTEXITCODE -eq 0) {
        Write-Success "Public network access disabled - Web App is now reachable only via the Private Endpoint"
    } else {
        Write-Host "  ⚠️  Could not disable public network access automatically. Disable it manually:" -ForegroundColor Yellow
        Write-Host "     az webapp update --name $WebAppName --resource-group $ResourceGroupName --set publicNetworkAccess=Disabled" -ForegroundColor Yellow
    }
    Write-Host ""
}

# ============================================
# ASSIGN RBAC ROLES
# ============================================
Write-Step "Step 9: Assigning RBAC Roles (Least-Privilege)"

Write-Host ""
Write-Host "  📋 RBAC Assignment Summary (Least-Privilege)" -ForegroundColor Yellow
Write-Host "  ─────────────────────────────────────────────────────────────" -ForegroundColor Gray

# --- Single source of truth for the closing 'Permission Reference' banner ---
# The script ALWAYS tries to assign everything below using the credentials of the
# user running it. Anything that can't be assigned (insufficient privilege) is
# collected in $permIssues and printed at the end with a ready-to-run command so an
# admin can grant it manually later.
$mgScope     = "/providers/Microsoft.Management/managementGroups/$EntraTenantId"
# In Existing OpenAI mode the resource lives in the customer's own resource group (and the app
# authenticates with the KEY, so this RBAC grant is optional). Point the scope at the real RG so
# any attempted grant targets the correct resource. Skip the scope entirely if endpoint+key were
# supplied directly without a resource name.
$openaiRgForScope  = if ($OpenAIMode -eq "Existing" -and -not [string]::IsNullOrWhiteSpace($OpenAIResourceGroup))    { $OpenAIResourceGroup    } else { $ResourceGroupName }
$openaiSubForScope = if ($OpenAIMode -eq "Existing" -and -not [string]::IsNullOrWhiteSpace($OpenAISubscriptionId))   { $OpenAISubscriptionId   } else { $SubscriptionId    }
$openaiScope = "/subscriptions/$openaiSubForScope/resourceGroups/$openaiRgForScope/providers/Microsoft.CognitiveServices/accounts/$OpenAIResourceName"
$miRbacRef = @(
    @{ Role = "Reader";                         Scope = $mgScope;     ScopeLabel = "Tenant Root MG (ALL subscriptions)"; Purpose = "Resource Graph / inventory reads across all subscriptions" },
    @{ Role = "Cost Management Reader";          Scope = $mgScope;     ScopeLabel = "Tenant Root MG (ALL subscriptions)"; Purpose = "Cost analysis, spend trends, budgets" },
    @{ Role = "Cognitive Services OpenAI User";  Scope = $openaiScope; ScopeLabel = "Azure OpenAI resource ONLY";         Purpose = "Call the deployed model for chat completions" },
    @{ Role = "Management Group Reader";         Scope = $mgScope;     ScopeLabel = "Tenant Root MG";                     Purpose = "List management groups in the hierarchy dropdown" },
    @{ Role = "Reservations Reader";            Scope = $mgScope;     ScopeLabel = "Tenant Root MG";                     Purpose = "Read Reserved Instances inventory & recommendations" }
)
$permIssues = @()   # collects { Kind, Name, Scope, Command } for anything not auto-assigned

# Define roles - Assigned at Management Group level to cover ALL subscriptions
$roles = @(
    @{
        Name = "Reader"
        Scope = "/providers/Microsoft.Management/managementGroups/$EntraTenantId"
        ScopeDescription = "Tenant Root Management Group (inherits to ALL subscriptions)"
        Justification = "Required for Resource Graph queries (list VMs, networks, storage, etc.) across ALL subscriptions"
    },
    @{
        Name = "Cost Management Reader"
        Scope = "/providers/Microsoft.Management/managementGroups/$EntraTenantId"
        ScopeDescription = "Tenant Root Management Group (inherits to ALL subscriptions)"
        Justification = "Required for cost analysis, spending trends, and budget monitoring across ALL subscriptions"
    }
)

foreach ($role in $roles) {
    Write-Host "  Role: $($role.Name)" -ForegroundColor Cyan
    Write-Host "    Scope: $($role.ScopeDescription)" -ForegroundColor White
    Write-Host "    Purpose: $($role.Justification)" -ForegroundColor Gray
    Write-Host ""
    
    Write-Info "Assigning '$($role.Name)' at $($role.ScopeDescription) scope..."
    
    $result = az role assignment create `
        --assignee $principalId `
        --role $role.Name `
        --scope $role.Scope `
        --output none 2>&1
    
    if ($LASTEXITCODE -eq 0 -or $result -match "already exists") {
        Write-Success "$($role.Name) - Assigned"
    } else {
        Write-Info "$($role.Name) - May already exist (continuing...)"
    }
}

# Per-subscription fallback. The Management-Group-scoped assignments above require rights at
# the tenant root MG, which many deployers lack. Assigning Reader + Cost Management Reader
# directly on each target subscription only needs Owner / User Access Administrator on that
# subscription, so the app still gets read access even if the MG-root assignment was denied.
$subList = @($SubscriptionIdsCsv -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
if ($subList.Count -gt 0) {
    Write-Host ""
    Write-Info "Ensuring Reader + Cost Management Reader on each target subscription ($($subList.Count))..."
    foreach ($sid in $subList) {
        foreach ($roleName in @("Reader", "Cost Management Reader")) {
            $subAssign = az role assignment create --assignee $principalId --role $roleName --scope "/subscriptions/$sid" --output none 2>&1
            if ($LASTEXITCODE -eq 0 -or $subAssign -match "already exists") {
                Write-Success "$roleName on $sid"
            } else {
                Write-Host "  WARNING: Could not assign $roleName on $sid (need Owner/User Access Administrator there)" -ForegroundColor Yellow
                $permIssues += @{ Kind = "RBAC"; Name = $roleName; Scope = "/subscriptions/$sid"; Command = "az role assignment create --assignee $principalId --role `"$roleName`" --scope `"/subscriptions/$sid`"" }
            }
        }
    }
}

# NOTE: No "Cognitive Services OpenAI User" role is assigned - this app calls Azure OpenAI
# with an API KEY (AI_PROVIDER=azure_openai), not the Web App's managed identity.

# Management Group Reader
Write-Host ""
Write-Host "  Role: Management Group Reader" -ForegroundColor Cyan
Write-Host "    Scope: Tenant Root Management Group" -ForegroundColor White
Write-Host "    Purpose: List management groups in subscription hierarchy dropdown" -ForegroundColor Gray
Write-Host ""

Write-Info "Assigning 'Management Group Reader' at Tenant Root scope..."
$mgResult = az role assignment create `
    --assignee $principalId `
    --role "Management Group Reader" `
    --scope "/providers/Microsoft.Management/managementGroups/$EntraTenantId" `
    --output none 2>&1

if ($LASTEXITCODE -eq 0 -or $mgResult -match "already exists") {
    Write-Success "Management Group Reader - Assigned (Tenant Root scope)"
} else {
    Write-Host "  ⚠️  Could not assign Management Group Reader (requires elevated permissions)" -ForegroundColor Yellow
    $permIssues += @{ Kind = "RBAC"; Name = "Management Group Reader"; Scope = "Tenant Root MG"; Command = "az role assignment create --assignee $principalId --role `"Management Group Reader`" --scope `"$mgScope`"" }
}

# Reservations Reader
Write-Host ""
Write-Host "  Role: Reservations Reader" -ForegroundColor Cyan
Write-Host "    Scope: Tenant Root Management Group" -ForegroundColor White
Write-Host "    Purpose: Read Reserved Instances inventory and recommendations" -ForegroundColor Gray
Write-Host ""

Write-Info "Assigning 'Reservations Reader' at Tenant Root scope..."
$riResult = az role assignment create `
    --assignee $principalId `
    --role "Reservations Reader" `
    --scope "/providers/Microsoft.Management/managementGroups/$EntraTenantId" `
    --output none 2>&1

if ($LASTEXITCODE -eq 0 -or $riResult -match "already exists") {
    Write-Success "Reservations Reader - Assigned (Tenant Root scope)"
} else {
    Write-Host "  ⚠️  Could not assign Reservations Reader (requires elevated permissions)" -ForegroundColor Yellow
    $permIssues += @{ Kind = "RBAC"; Name = "Reservations Reader"; Scope = "Tenant Root MG"; Command = "az role assignment create --assignee $principalId --role `"Reservations Reader`" --scope `"$mgScope`"" }
}

Write-Host ""
Write-Host "  ✅ RBAC configured following Least-Privilege principle" -ForegroundColor Green
Write-Host ""

# ============================================
# ASSIGN MICROSOFT GRAPH API PERMISSIONS (FOR ENTRA ID FEATURES)
# ============================================
Write-Step "Step 9b: Assigning Microsoft Graph API Permissions (Entra ID)"

# Required Microsoft Graph APPLICATION permissions for the Web App's managed identity.
# Defined once at script scope so the closing Permission Reference banner can reuse them.
$graphSpId = "00000003-0000-0000-c000-000000000000"   # well-known Microsoft Graph appId
$graphPermissions = @(
    @{ Name = "User.Read.All";        Id = "df021288-bdef-4463-88db-98f22de89214"; Purpose = "Read all user profiles and sign-in activity" },
    @{ Name = "Directory.Read.All";   Id = "7ab1d382-f21e-4acd-a863-ba3e13f7da61"; Purpose = "Read directory data (users, groups, roles)" },
    @{ Name = "Group.Read.All";       Id = "5b567255-7703-4780-807c-7be8301ae99b"; Purpose = "Read all groups and memberships" },
    @{ Name = "Application.Read.All"; Id = "9a5d68dd-52b0-4cc2-bd40-abcf44ac3a30"; Purpose = "Read all app registrations" },
    @{ Name = "AuditLog.Read.All";    Id = "b0afded3-3588-46d8-8b3d-9842eff778da"; Purpose = "Read audit logs and sign-in reports" },
    @{ Name = "Policy.Read.All";      Id = "246dd0d5-5bd0-4def-940b-0421030a5b68"; Purpose = "Read Conditional Access policies" }
)

Write-Host ""
Write-Host "  📋 Microsoft Graph API Permissions (Required for Entra ID features)" -ForegroundColor Yellow
Write-Host "  ─────────────────────────────────────────────────────────────" -ForegroundColor Gray
Write-Host "  These permissions enable the Entra ID management features:" -ForegroundColor White
Write-Host "    • User inventory and sign-in activity" -ForegroundColor Gray
Write-Host "    • Group membership queries" -ForegroundColor Gray
Write-Host "    • Application and service principal listing" -ForegroundColor Gray
Write-Host "    • Device management queries" -ForegroundColor Gray
Write-Host "    • Conditional Access policy review" -ForegroundColor Gray
Write-Host ""

# Get the Managed Identity's service principal object ID
Write-Info "Getting Web App's Managed Identity service principal..."
$spObjectId = az ad sp show --id $principalId --query "id" -o tsv 2>$null

if ([string]::IsNullOrEmpty($spObjectId)) {
    # Retry with different query
    $spObjectId = az ad sp list --filter "servicePrincipalType eq 'ManagedIdentity' and displayName eq '$WebAppName'" --query "[0].id" -o tsv 2>$null
}

if ([string]::IsNullOrEmpty($spObjectId)) {
    Write-Host "  ⚠️  Could not find Managed Identity service principal" -ForegroundColor Yellow
    Write-Host "  Entra ID features may not work. Grant permissions manually." -ForegroundColor Yellow
} else {
    Write-Info "Service Principal Object ID: $spObjectId"
    
    # (Microsoft Graph well-known appId is defined once at script scope above)
    
    # Get Microsoft Graph enterprise app ID in this tenant
    Write-Info "Getting Microsoft Graph service principal in tenant..."
    $graphEnterpriseAppId = az ad sp show --id $graphSpId --query "id" -o tsv 2>$null
    
    if ([string]::IsNullOrEmpty($graphEnterpriseAppId)) {
        Write-Host "  ⚠️  Could not find Microsoft Graph service principal" -ForegroundColor Yellow
    } else {
        Write-Info "Microsoft Graph SP ID: $graphEnterpriseAppId"
        
        # (Graph application permissions are defined once at script scope above)
        
        Write-Host ""
        Write-Host "  Assigning Graph API Application Permissions:" -ForegroundColor Cyan
        
        foreach ($perm in $graphPermissions) {
            Write-Host "    • $($perm.Name) - $($perm.Purpose)" -ForegroundColor Gray
            
            # Create the app role assignment using Microsoft Graph REST API
            $body = @{
                principalId = $spObjectId
                resourceId = $graphEnterpriseAppId
                appRoleId = $perm.Id
            } | ConvertTo-Json -Compress
            
            # Use az rest to call Graph API
            $assignResult = az rest --method POST `
                --uri "https://graph.microsoft.com/v1.0/servicePrincipals/$spObjectId/appRoleAssignments" `
                --headers "Content-Type=application/json" `
                --body $body 2>&1
            
            if ($LASTEXITCODE -eq 0) {
                Write-Success "    $($perm.Name) - Assigned"
            } elseif ($assignResult -match "Permission being assigned already exists") {
                Write-Info "    $($perm.Name) - Already assigned"
            } else {
                Write-Host "    ⚠️  $($perm.Name) - Could not assign (may require admin consent)" -ForegroundColor Yellow
                $refBody = "{`"principalId`":`"$spObjectId`",`"resourceId`":`"$graphEnterpriseAppId`",`"appRoleId`":`"$($perm.Id)`"}"
                $permIssues += @{ Kind = "Graph"; Name = $perm.Name; Scope = "Microsoft Graph (application permission)"; Command = "az rest --method POST --uri `"https://graph.microsoft.com/v1.0/servicePrincipals/$spObjectId/appRoleAssignments`" --headers `"Content-Type=application/json`" --body '$refBody'" }
            }
        }
        
        Write-Host ""
        Write-Host "  ℹ️  NOTE: Graph API permissions may require Admin Consent" -ForegroundColor Yellow
        Write-Host "  If Entra ID features don't work, an Azure AD admin needs to:" -ForegroundColor Gray
        Write-Host "    1. Go to Azure Portal → Entra ID → Enterprise Applications" -ForegroundColor Gray
        Write-Host "    2. Find '$WebAppName' (Managed Identity)" -ForegroundColor Gray
        Write-Host "    3. Go to Permissions → Grant admin consent" -ForegroundColor Gray
        Write-Host ""
    }
}

# ============================================
# (Azure SQL uses a SQL login for this app — no Entra DB-user grant needed)
# ============================================
if ($false) {
    # The app's managed identity must be a contained database user with read/write
    # and DDL rights (it creates the prompts/chats tables on first run).
    $grantTsql = @"
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'$WebAppName')
    CREATE USER [$WebAppName] FROM EXTERNAL PROVIDER;
ALTER ROLE db_datareader ADD MEMBER [$WebAppName];
ALTER ROLE db_datawriter ADD MEMBER [$WebAppName];
ALTER ROLE db_ddladmin   ADD MEMBER [$WebAppName];
"@
    $grantFile = Join-Path $PSScriptRoot "_grant_sql_access.sql"
    $grantTsql | Out-File -FilePath $grantFile -Encoding ASCII -Force

    $sqlFqdn = "$SqlServerName.database.windows.net"
    $granted = $false
    $sqlcmdAvailable = $null -ne (Get-Command sqlcmd -ErrorAction SilentlyContinue)

    if ($sqlcmdAvailable -and $DeploymentMode -ne "Private") {
        Write-Info "Applying SQL access grant via sqlcmd (Entra auth)..."
        sqlcmd -S $sqlFqdn -d $SqlDatabaseName -G -i $grantFile 2>$null
        if ($LASTEXITCODE -eq 0) {
            $granted = $true
            Write-Success "Granted '$WebAppName' db_datareader/db_datawriter/db_ddladmin on $SqlDatabaseName"
        }
    }

    if (-not $granted) {
        $reason = if ($DeploymentMode -eq "Private") { "SQL is private (run from inside the VNet)" } else { "sqlcmd not available or grant failed" }
        Write-Info "Automatic SQL grant skipped: $reason"
        Write-Host "  ➜ Run this T-SQL against [$SqlDatabaseName] on $sqlFqdn as the Entra admin:" -ForegroundColor Yellow
        Write-Host ""
        ($grantTsql -split "`n") | ForEach-Object { Write-Host "      $_" -ForegroundColor DarkGray }
        Write-Host ""
        Write-Host "  (Saved to: $grantFile)" -ForegroundColor DarkGray
        $permIssues += @{ Kind = "SQL"; Name = "Contained DB user"; Scope = "$SqlDatabaseName"; Command = "sqlcmd -S $sqlFqdn -d $SqlDatabaseName -G -i `"$grantFile`"" }
    }
    Write-Host ""
}

Write-Step "Step 11: Restarting Web App"

Write-Info "Restarting Web App to apply all configurations..."
az webapp restart --name $WebAppName --resource-group $ResourceGroupName --output none

# Wait for app to become healthy
Write-Info "Waiting for application to become healthy..."
Start-Sleep -Seconds 30

# Get application URL
$appUrl = az webapp show `
    --name $WebAppName `
    --resource-group $ResourceGroupName `
    --query "defaultHostName" -o tsv

# ── Entra login redirect URI ─────────────────────────────────────────────────────
# The SPA signs in via the customer's login app registration. Its redirect URI
# must be the app's public origin, registered under the "Single-page application"
# platform. We attempt to register it automatically (best-effort) and always print it.
if (-not [string]::IsNullOrWhiteSpace($EntraAppClientId)) {
    Write-Step "Step 12: Entra Login Redirect URI"
    $redirectOrigin = if (-not [string]::IsNullOrWhiteSpace($AppPublicUrl)) { $AppPublicUrl.TrimEnd('/') } else { "https://$appUrl" }
    Write-Info "Registering SPA redirect URI '$redirectOrigin' on app $EntraAppClientId ..."
    $appObjId = az ad app show --id $EntraAppClientId --query id -o tsv 2>$null
    if (-not [string]::IsNullOrWhiteSpace($appObjId)) {
        $existingSpa = az ad app show --id $EntraAppClientId --query "spa.redirectUris" -o json 2>$null | ConvertFrom-Json
        $uris = @()
        if ($existingSpa) { $uris += $existingSpa }
        if ($uris -notcontains $redirectOrigin) { $uris += $redirectOrigin }
        $spaBody = @{ spa = @{ redirectUris = $uris } } | ConvertTo-Json -Compress -Depth 5
        $patchFile = Join-Path $env:TEMP "spa-redirect-$([guid]::NewGuid().ToString('N')).json"
        $spaBody | Out-File -FilePath $patchFile -Encoding ascii -Force
        az rest --method PATCH --uri "https://graph.microsoft.com/v1.0/applications/$appObjId" --headers "Content-Type=application/json" --body "@$patchFile" 2>$null
        $patchExit = $LASTEXITCODE
        Remove-Item $patchFile -Force -ErrorAction SilentlyContinue
        if ($patchExit -eq 0) {
            Write-Success "Redirect URI registered on the app registration"
        } else {
            Write-Host "  WARNING: Could not update the app registration automatically (insufficient rights)." -ForegroundColor Yellow
            Write-Host "  Ask an admin to add this SPA redirect URI under Authentication:" -ForegroundColor Yellow
            Write-Host "     $redirectOrigin" -ForegroundColor Cyan
        }
    } else {
        Write-Host "  WARNING: App registration $EntraAppClientId not found / no access." -ForegroundColor Yellow
        Write-Host "  Add this SPA redirect URI under the app registration's Authentication blade:" -ForegroundColor Yellow
        Write-Host "     $redirectOrigin" -ForegroundColor Cyan
    }
    Write-Host ""
}

# ============================================
# DEPLOYMENT SUMMARY
# ============================================
Write-Host ""
if ($DeploymentMode -eq "Private") {
    Write-Host "╔══════════════════════════════════════════════════════════════════╗" -ForegroundColor Green
    Write-Host "║         🔒 PRIVATE DEPLOYMENT COMPLETE! 🎉                        ║" -ForegroundColor Green
    Write-Host "║     Application Running on Internal Network - No Public Access   ║" -ForegroundColor Green
    Write-Host "╚══════════════════════════════════════════════════════════════════╝" -ForegroundColor Green
} else {
    Write-Host "╔══════════════════════════════════════════════════════════════════╗" -ForegroundColor Green
    Write-Host "║              DEPLOYMENT COMPLETE! 🎉                              ║" -ForegroundColor Green
    Write-Host "║         Application is FULLY RUNNING - No Manual Work!           ║" -ForegroundColor Green
    Write-Host "╚══════════════════════════════════════════════════════════════════╝" -ForegroundColor Green
}
Write-Host ""
Write-Host "📋 DEPLOYMENT SUMMARY" -ForegroundColor Cyan
Write-Host "─────────────────────────────────────────────────────────────────" -ForegroundColor Gray
Write-Host "  Resource Group:        $ResourceGroupName" -ForegroundColor White
Write-Host "  Location:              $Location" -ForegroundColor White
Write-Host "  Deployment Mode:       $DeploymentMode" -ForegroundColor $(if ($DeploymentMode -eq "Private") { "Magenta" } else { "Cyan" })
Write-Host "  Azure OpenAI:          $OpenAIResourceName" -ForegroundColor White
Write-Host "  OpenAI Endpoint:       $openaiEndpoint" -ForegroundColor White
Write-Host "  Deployment Name:       $OpenAIDeploymentName" -ForegroundColor White
Write-Host "  Model (actual):        $modelDisplay" -ForegroundColor White
Write-Host "  App Service Plan:      $AppServicePlanName (SKU: $AppServiceSku)" -ForegroundColor White
Write-Host "  Web App:               $WebAppName" -ForegroundColor White
Write-Host "  Runtime:               Python 3.11" -ForegroundColor White
Write-Host "  Subscription:          $SubscriptionId" -ForegroundColor White
if ($DeploySql) {
    Write-Host "  Azure SQL Server:      $SqlServerName.database.windows.net" -ForegroundColor White
    Write-Host "  Azure SQL Database:    $SqlDatabaseName (SKU: $SqlServiceObjective, ${SqlMaxSizeGb}GB)" -ForegroundColor White
    Write-Host "  SQL Zone Redundant:    $SqlZoneRedundant  |  Backup: $SqlBackupStorageRedundancy" -ForegroundColor White
}

if ($DeploymentMode -eq "Private") {
    Write-Host "" -ForegroundColor White
    Write-Host "  🔒 PRIVATE NETWORK CONFIGURATION" -ForegroundColor Magenta
    Write-Host "  VNet:                  $VNetName ($VNetResourceGroupName)" -ForegroundColor White
    Write-Host "  PE Subnet:             $PrivateEndpointSubnetName" -ForegroundColor White
    Write-Host "  Integration Subnet:    $AppServiceIntegrationSubnetName (Web App outbound)" -ForegroundColor White
    Write-Host "  Public Access:         DISABLED on all resources" -ForegroundColor White
    Write-Host "" -ForegroundColor White
    Write-Host "  🔗 PRIVATE ENDPOINTS" -ForegroundColor Magenta
    Write-Host "  Azure OpenAI PE:       ${OpenAIResourceName}-pe" -ForegroundColor White
    Write-Host "  Web App PE:            ${WebAppName}-pe" -ForegroundColor White
    Write-Host "" -ForegroundColor White
    Write-Host "  🌐 PRIVATE DNS ZONES" -ForegroundColor Magenta
    Write-Host "  privatelink.openai.azure.com → linked to $VNetName" -ForegroundColor White
    Write-Host "  privatelink.azurewebsites.net → linked to $VNetName" -ForegroundColor White
}

Write-Host ""
if ($DeploymentMode -eq "Private") {
    Write-Host "🔒 APPLICATION URL (Internal Access Only)" -ForegroundColor Magenta
    Write-Host "─────────────────────────────────────────────────────────────────" -ForegroundColor Gray
    Write-Host "  https://$appUrl" -ForegroundColor Green
    Write-Host ""
    Write-Host "  ⚠️  This URL is ONLY accessible from within your VNet/corporate network." -ForegroundColor Yellow
    Write-Host ""
} else {
    Write-Host "🌐 APPLICATION URL (Ready to use!)" -ForegroundColor Cyan
    Write-Host "─────────────────────────────────────────────────────────────────" -ForegroundColor Gray
    Write-Host "  https://$appUrl" -ForegroundColor Green
}

Write-Host ""
Write-Host "🔐 SECURITY CONFIGURATION" -ForegroundColor Cyan
Write-Host "─────────────────────────────────────────────────────────────────" -ForegroundColor Gray
Write-Host "  Identity Type:          System-Assigned Managed Identity" -ForegroundColor White
Write-Host "  Principal ID:           $principalId" -ForegroundColor White
Write-Host "  API Keys Used:          ❌ NO (Managed Identity only)" -ForegroundColor White
Write-Host ""
Write-Host "  📜 ASSIGNED RBAC ROLES (Azure):" -ForegroundColor Yellow
Write-Host "  ┌─────────────────────────────────────┬───────────────────────────────┐" -ForegroundColor Gray
Write-Host "  │ Role                                │ Scope                         │" -ForegroundColor Gray
Write-Host "  ├─────────────────────────────────────┼───────────────────────────────┤" -ForegroundColor Gray
Write-Host "  │ Reader                              │ Tenant Root MG (All Subs)     │" -ForegroundColor White
Write-Host "  │ Cost Management Reader              │ Tenant Root MG (All Subs)     │" -ForegroundColor White
Write-Host "  │ Cognitive Services OpenAI User      │ OpenAI Resource ONLY          │" -ForegroundColor White
Write-Host "  │ Management Group Reader             │ Tenant Root MG                │" -ForegroundColor White
Write-Host "  │ Reservations Reader                 │ Tenant Root MG                │" -ForegroundColor White
Write-Host "  └─────────────────────────────────────┴───────────────────────────────┘" -ForegroundColor Gray
Write-Host ""
Write-Host "  📜 ASSIGNED GRAPH API PERMISSIONS (Entra ID):" -ForegroundColor Yellow
Write-Host "  ┌─────────────────────────────────────┬───────────────────────────────┐" -ForegroundColor Gray
Write-Host "  │ Permission                          │ Purpose                       │" -ForegroundColor Gray
Write-Host "  ├─────────────────────────────────────┼───────────────────────────────┤" -ForegroundColor Gray
Write-Host "  │ User.Read.All                       │ Read user profiles/sign-ins   │" -ForegroundColor White
Write-Host "  │ Directory.Read.All                  │ Read directory objects        │" -ForegroundColor White
Write-Host "  │ Group.Read.All                      │ Read groups & memberships     │" -ForegroundColor White
Write-Host "  │ Application.Read.All                │ Read app registrations        │" -ForegroundColor White
Write-Host "  │ AuditLog.Read.All                   │ Read sign-in reports          │" -ForegroundColor White
Write-Host "  │ Policy.Read.All                     │ Read Conditional Access       │" -ForegroundColor White
Write-Host "  └─────────────────────────────────────┴───────────────────────────────┘" -ForegroundColor Gray
Write-Host ""

# ── MANAGED IDENTITY PERMISSION REFERENCE (auto-assigned first; manual grant only if needed) ──
$spForCmd    = if ($spObjectId) { $spObjectId } else { $principalId }
$graphForCmd = if ($graphEnterpriseAppId) { $graphEnterpriseAppId } else { "<microsoft-graph-sp-object-id-in-your-tenant>" }

Write-Host "🔑 MANAGED IDENTITY - PERMISSION REFERENCE" -ForegroundColor Cyan
Write-Host "─────────────────────────────────────────────────────────────────" -ForegroundColor Gray
Write-Host "  The script ALWAYS tries to assign everything below automatically, using the" -ForegroundColor White
Write-Host "  credentials of whoever runs it. Use the commands here ONLY to grant anything" -ForegroundColor White
Write-Host "  that could not be auto-assigned (shown with a ⚠️  above)." -ForegroundColor White
Write-Host ""
Write-Host "  Managed Identity:   $WebAppName  (System-Assigned)" -ForegroundColor White
Write-Host "  Principal ID:       $principalId" -ForegroundColor White
Write-Host "  SP Object ID:       $spForCmd" -ForegroundColor White
Write-Host ""

if ($permIssues.Count -gt 0) {
    Write-Host "  ⚠️  ACTION NEEDED - these could NOT be auto-assigned with your current" -ForegroundColor Yellow
    Write-Host "      privileges. Ask an admin with the right role to run the matching command:" -ForegroundColor Yellow
    Write-Host ""
    foreach ($iss in $permIssues) {
        Write-Host "    • [$($iss.Kind)] $($iss.Name)  →  $($iss.Scope)" -ForegroundColor Yellow
        Write-Host "      $($iss.Command)" -ForegroundColor DarkGray
        Write-Host ""
    }
} else {
    Write-Host "  ✅ All managed-identity permissions were assigned automatically - nothing to do." -ForegroundColor Green
    Write-Host ""
}

Write-Host "  ── FULL REFERENCE: Azure RBAC roles (needs Owner / User Access Administrator) ──" -ForegroundColor Cyan
foreach ($r in $miRbacRef) {
    Write-Host "    • $($r.Role)  →  $($r.ScopeLabel)" -ForegroundColor White
    Write-Host "      $($r.Purpose)" -ForegroundColor DarkGray
    Write-Host "      az role assignment create --assignee $principalId --role `"$($r.Role)`" --scope `"$($r.Scope)`"" -ForegroundColor DarkGray
}
Write-Host ""
Write-Host "  ── FULL REFERENCE: Microsoft Graph application permissions ──" -ForegroundColor Cyan
Write-Host "     Needs an admin who can create appRoleAssignments on the managed identity" -ForegroundColor DarkGray
Write-Host "     (Privileged Role Administrator / Global Administrator)." -ForegroundColor DarkGray
foreach ($perm in $graphPermissions) {
    $refBody2 = "{`"principalId`":`"$spForCmd`",`"resourceId`":`"$graphForCmd`",`"appRoleId`":`"$($perm.Id)`"}"
    Write-Host "    • $($perm.Name)  →  $($perm.Purpose)" -ForegroundColor White
    Write-Host "      appRoleId: $($perm.Id)" -ForegroundColor DarkGray
    Write-Host "      az rest --method POST --uri `"https://graph.microsoft.com/v1.0/servicePrincipals/$spForCmd/appRoleAssignments`" --headers `"Content-Type=application/json`" --body '$refBody2'" -ForegroundColor DarkGray
}
Write-Host ""
Write-Host "  Tip: to fetch the Graph SP object id in your tenant for the commands above:" -ForegroundColor DarkGray
Write-Host "       az ad sp show --id $graphSpId --query id -o tsv" -ForegroundColor DarkGray
Write-Host ""

Write-Host "📝 WHAT WAS AUTOMATED" -ForegroundColor Cyan
Write-Host "─────────────────────────────────────────────────────────────────" -ForegroundColor Gray
Write-Host "  ✅ Registered required Azure resource providers" -ForegroundColor Green
Write-Host "  ✅ Created Azure OpenAI resource" -ForegroundColor Green
Write-Host "  ✅ Deployed Azure OpenAI model: $modelDisplay" -ForegroundColor Green
Write-Host "  ✅ Created App Service Plan (Linux, $AppServiceSku)" -ForegroundColor Green
Write-Host "  ✅ Created Web App with Python 3.11 runtime" -ForegroundColor Green
Write-Host "  ✅ Enabled System-Assigned Managed Identity" -ForegroundColor Green
Write-Host "  ✅ Configured all environment variables" -ForegroundColor Green
Write-Host "  ✅ Deployed application code with pip install" -ForegroundColor Green
if ($DeploymentMode -eq "Private") {
    Write-Host "  ✅ Validated VNet and subnet configuration" -ForegroundColor Green
    Write-Host "  ✅ Connected Web App to VNet (regional integration + route-all)" -ForegroundColor Green
    Write-Host "  ✅ Created Private Endpoint for Azure OpenAI" -ForegroundColor Green
    Write-Host "  ✅ Created Private Endpoint for Web App" -ForegroundColor Green
    Write-Host "  ✅ Configured Private DNS Zones and VNet links" -ForegroundColor Green
    Write-Host "  ✅ Disabled public network access on all resources" -ForegroundColor Green
}
Write-Host "  ✅ Assigned all RBAC roles (Least-Privilege)" -ForegroundColor Green
Write-Host "  ✅ Assigned Microsoft Graph API permissions (Entra ID)" -ForegroundColor Green
Write-Host ""

Write-Host "⚠️  KNOWN LIMITATIONS" -ForegroundColor Yellow
Write-Host "─────────────────────────────────────────────────────────────────" -ForegroundColor Gray
Write-Host "  ❌ Image Generation (DALL-E) - Not supported in App Service deployment" -ForegroundColor DarkGray
Write-Host "     Reason: Requires DALL-E model deployment (not included in this script)" -ForegroundColor DarkGray
Write-Host "  ⚠️  Entra ID Features - May require Admin Consent" -ForegroundColor DarkGray
Write-Host "     If Entra ID queries fail, grant admin consent in Azure Portal:" -ForegroundColor DarkGray
Write-Host "     Entra ID → Enterprise Apps → $WebAppName → Permissions → Grant consent" -ForegroundColor DarkGray
Write-Host ""

Write-Host "🔄 MULTI-SUBSCRIPTION ACCESS (Optional)" -ForegroundColor Cyan
Write-Host "─────────────────────────────────────────────────────────────────" -ForegroundColor Gray
Write-Host "  To query resources in OTHER subscriptions, assign these roles:" -ForegroundColor Yellow
Write-Host ""
Write-Host "  az role assignment create --assignee $principalId ``" -ForegroundColor DarkGray
Write-Host "      --role 'Reader' --scope '/subscriptions/<other-sub-id>'" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  az role assignment create --assignee $principalId ``" -ForegroundColor DarkGray
Write-Host "      --role 'Cost Management Reader' --scope '/subscriptions/<other-sub-id>'" -ForegroundColor DarkGray
Write-Host ""

Write-Host "📊 VIEW LOGS" -ForegroundColor Cyan
Write-Host "─────────────────────────────────────────────────────────────────" -ForegroundColor Gray
Write-Host "  az webapp log tail --name $WebAppName --resource-group $ResourceGroupName" -ForegroundColor DarkGray
Write-Host ""

Write-Host "🔧 FINAL STEP - CONFIGURE YOUR ENTRA APP REGISTRATION (REQUIRED FOR LOGIN)" -ForegroundColor Cyan
Write-Host "─────────────────────────────────────────────────────────────────" -ForegroundColor Gray
Write-Host "  The Web App signs users in using the Entra app registration you provided:" -ForegroundColor White
Write-Host "    Client ID:  $EntraAppClientId" -ForegroundColor White
Write-Host "    Tenant ID:  $EntraTenantId" -ForegroundColor White
Write-Host ""
Write-Host "  1) ADD THE SPA REDIRECT URI" -ForegroundColor Yellow
Write-Host "     Azure Portal → Microsoft Entra ID → App registrations → (your app)" -ForegroundColor Gray
Write-Host "     → Authentication → 'Add a platform' → Single-page application (SPA)" -ForegroundColor Gray
Write-Host "     → add this EXACT redirect URI (note the /login.html path):" -ForegroundColor Gray
Write-Host ""
Write-Host "        https://$appUrl/login.html" -ForegroundColor Green
Write-Host ""
Write-Host "     (If the platform already exists, just 'Add URI' under Single-page application.)" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  2) CONFIRM THE DELEGATED API PERMISSIONS (Microsoft Graph)" -ForegroundColor Yellow
Write-Host "     API permissions → Add a permission → Microsoft Graph → Delegated:" -ForegroundColor Gray
Write-Host "     ┌──────────────┬──────────────────────────────────────────────┐" -ForegroundColor Gray
Write-Host "     │ Permission   │ Why the app/login needs it                   │" -ForegroundColor Gray
Write-Host "     ├──────────────┼──────────────────────────────────────────────┤" -ForegroundColor Gray
Write-Host "     │ openid       │ Sign the user in (OIDC)                       │" -ForegroundColor White
Write-Host "     │ profile      │ Read basic profile (name, etc.)              │" -ForegroundColor White
Write-Host "     │ email        │ Read the user's email claim                  │" -ForegroundColor White
Write-Host "     │ User.Read    │ Read the signed-in user's profile            │" -ForegroundColor White
Write-Host "     └──────────────┴──────────────────────────────────────────────┘" -ForegroundColor Gray
Write-Host "     Then click 'Grant admin consent for <your org>' (requires an admin)." -ForegroundColor Gray
Write-Host ""
Write-Host "  Once the redirect URI is added and consent granted, open the app URL above" -ForegroundColor White
Write-Host "  and sign in. (No need to change Client ID / Tenant ID - they are already wired in.)" -ForegroundColor White
Write-Host ""


Write-Host "─────────────────────────────────────────────────────────────────" -ForegroundColor Gray
Write-Host "  Author: Zahir Hussain Shah" -ForegroundColor Gray
Write-Host "  Website: www.zahir.cloud | Email: zahir@zahir.cloud" -ForegroundColor Gray
Write-Host "─────────────────────────────────────────────────────────────────" -ForegroundColor Gray
