<#
.SYNOPSIS
    Automated Azure Container Apps deployment for "Azure Infra IQ"
    (AI-Powered Azure Infrastructure Management and Insights).

.DESCRIPTION
    Creates everything needed to run Azure Infra IQ on Azure Container Apps from
    scratch, medium production SKUs by default:

      - Resource group
    - Azure Container Registry (Premium) + remote image build (az acr build)
    - Container Apps Environment wired to an EXISTING Log Analytics workspace
      - Azure OpenAI (S0) + a chat model deployment (key-based)
    - Azure SQL (General Purpose, 4 vCores) logical server + database (SQL auth)  [optional]
    - Azure Cache for Redis (Standard C2)                                       [optional]
      - Container App with a SYSTEM-ASSIGNED managed identity
      - RBAC: Reader + Cost Management Reader on each scanned subscription
      - Microsoft Graph application permissions on the managed identity
      - Registers the Container App URL as a SPA redirect URI on the Entra app

    The app authenticates to Azure with its MANAGED IDENTITY (DefaultAzureCredential),
    so NO client secret is deployed. Azure OpenAI uses an API key.

    The embedded "Architecture Map" (ZureMap) engine ships INSIDE the same image and
    is served same-origin under /zuremap/ behind an auth-gated reverse proxy.
    By default it uses the Container App managed identity; optional SP credentials can
    be provided via -ZureMapClientSecret for non-MI environments.

.EXAMPLE
    # Public deployment (simplest)
    .\deploy-automated.ps1 -ResourceGroupName "rg-azure-infra-iq" -Location "westeurope" `
        -ContainerRegistryName "infraiqacr123" -SubscriptionId "<sub>"

.EXAMPLE
    # Private deployment — PE subnet auto-created, DNS zones in the deployment subscription
    .\deploy-automated.ps1 `
        -ResourceGroupName "rg-azure-infra-iq" -Location "westeurope" `
        -ContainerRegistryName "infraiqacr123" -SubscriptionId "<sub>" `
        -DeploymentMode "Private" `
        -VNetResourceGroupName "rg-networking" -VNetName "corp-vnet" `
        -SubnetName "container-apps-subnet"

.EXAMPLE
    # Enterprise — existing PE subnet + centralized (hub) private DNS subscription
    .\deploy-automated.ps1 `
        -ResourceGroupName "rg-azure-infra-iq" -Location "westeurope" `
        -ContainerRegistryName "infraiqacr123" -SubscriptionId "<sub>" `
        -DeploymentMode "Private" `
        -VNetResourceGroupName "rg-networking" -VNetName "corp-vnet" `
        -SubnetName "container-apps-subnet" `
        -PrivateEndpointSubnetName "pe-subnet" `
        -PrivateDnsZoneSubscriptionId "<hub-sub-id>" `
        -PrivateDnsZoneResourceGroupName "rg-private-dns-zones"
#>

[CmdletBinding()]
param(
    [string]$ResourceGroupName = "rg-azure-infra-iq",
    [string]$Location = "westeurope",

    # Globally-unique, lowercase, no dashes. Auto-generated if not supplied.
    [string]$ContainerRegistryName = "",

    [string]$ContainerAppName    = "azure-infra-iq",
    [string]$ContainerAppEnvName = "azure-infra-iq-env",
    [string]$ImageName           = "azure-infra-iq",
    [string]$ImageTag            = "",   # set to reuse an already-built tag and SKIP the build
    [string]$LogAnalyticsName    = "azure-infra-iq-logs",
    # Optional: customer-provided existing Log Analytics workspace credentials.
    # If omitted, deployment defaults to logs-destination=none unless
    # -CreateLogAnalyticsWorkspace $true is set.
    [string]$ExistingLogAnalyticsWorkspaceId = "",
    [string]$ExistingLogAnalyticsWorkspaceKey = "",
    [bool]$CreateLogAnalyticsWorkspace = $false,

    # Azure OpenAI
    [string]$OpenAIResourceName  = "",
    [string]$OpenAILocation      = "",   # defaults to $Location
    [string]$OpenAIDeploymentName = "",   # blank = name the deployment after the ACTUAL model deployed (newest GPT first)

    # Entra ID app registration used for USER LOGIN (SPA, no secret). REQUIRED — the
    # script PROMPTS for these if not supplied. Create the app registration first
    # (see docs/ENTRA_APP_SETUP.md): Single-page application platform, delegated User.Read.
    [string]$EntraAppClientId = "",
    [string]$EntraTenantId    = "",

    # Optional service-principal credentials for the embedded ZureMap engine.
    # If omitted, ZureMap uses the Container App managed identity by default.
    [string]$ZureMapClientId     = "",   # defaults to $EntraAppClientId
    [string]$ZureMapClientSecret = "",   # optional; only for SP login mode
    [string]$ZureMapTenantId     = "",   # defaults to $EntraTenantId

    # Target subscription for the deployment. Defaults to the active az subscription.
    [string]$SubscriptionId = "",

    # Comma-separated subscriptions the app should SCAN (AZURE_SUBSCRIPTION_IDS).
    # Default is deployment subscription only. Use -DiscoverAllSubscriptions $true
    # or -SubscriptionIds "auto" to discover and scan all enabled subscriptions.
    [string]$SubscriptionIds = "",
    [bool]$DiscoverAllSubscriptions = $false,

    # Azure SQL (Prompt Library / scan-history persistence)
    [bool]$DeploySql        = $true,
    [string]$SqlServerName  = "",
    [string]$SqlDatabaseName = "infraiqdb",
    [string]$SqlAdminUser   = "infraiqadmin",
    [string]$SqlAdminPassword = "",      # auto-generated if empty
    # vCore-based SQL objective for medium profile.
    [string]$SqlServiceObjective = "GP_Gen5_4",

    # Azure Cache for Redis (optional L2 cache)
    [bool]$DeployRedis = $true,
    [string]$RedisName = "",
    [string]$RedisSku  = "Standard",
    [string]$RedisVmSize = "c2",

    # ── Container Apps dedicated capacity selection ───────────────────────────
    # Choose how the dedicated workload profile (SKU size) for the Container App is picked:
    #   'Automatic' : try a fallback ladder D8x2 -> D8x1 -> D4x2 -> D4x1 until one succeeds
    #                 (most resilient against regional capacity constraints).
    #   'Manual'    : use exactly ONE profile you pick (1-4). If -ManualProfileChoice is
    #                 omitted in Manual mode, the script shows a 1/2/3/4 menu to choose from.
    #                 Manual is FASTER (no ladder iteration) and fully deterministic.
    [ValidateSet("Automatic","Manual")]
    [string]$CapacityMode = "Automatic",
    #   1 = D8 x 2 (8 vCPU / 32 GiB, 2 nodes)   2 = D8 x 1 (8 vCPU / 32 GiB, 1 node)
    #   3 = D4 x 2 (4 vCPU / 16 GiB, 2 nodes)   4 = D4 x 1 (4 vCPU / 16 GiB, 1 node)
    [ValidateSet("","1","2","3","4")]
    [string]$ManualProfileChoice = "",
    # [Deprecated] Backward compatible: -EnableDedicatedCapacityFallback $false is
    # treated as Manual mode (defaults to profile 4 = D4 x 1 when no choice is given).
    [bool]$EnableDedicatedCapacityFallback = $true,
    # Legacy single-profile sizing override (unused by the 1-4 menu profiles).
    [string]$Cpu    = "8.0",
    [string]$Memory = "32.0Gi",

    # ── Private / VNet-integrated deployment ──────────────────────────────────
    # 'Public'  : Container Apps environment with a public ingress (default).
    # 'Private' : environment injected into YOUR existing VNet with an INTERNAL-only
    #             load balancer (no public endpoint), Private Endpoints for the PaaS
    #             resources (OpenAI/SQL/Redis), and private DNS so the app + its
    #             dependencies resolve privately from inside the VNet / peered / on-prem.
    #             Enterprise-ready: VNet, subnets and DNS zones can each live in a
    #             DIFFERENT resource group or subscription.
    [ValidateSet("Public","Private")]
    [string]$DeploymentMode = "Public",

    # [PRIVATE] Existing VNet (prompted for anything not supplied on the command line).
    [string]$VNetName = "",
    [string]$VNetResourceGroupName = "",            # defaults to $ResourceGroupName
    # [PRIVATE] EXISTING, DEDICATED, EMPTY subnet for the Container Apps environment,
    # delegated to 'Microsoft.App/environments' (the script adds the delegation).
    # Minimum /27, /23 recommended for production.
    [string]$SubnetName = "",
    # [PRIVATE] Subnet for Private Endpoints (OpenAI/SQL/Redis). MUST differ from
    # -SubnetName. If omitted, the script auto-creates 'pe-subnet' (/27).
    [string]$PrivateEndpointSubnetName = "",
    # [PRIVATE] Address prefix used only when auto-CREATING the PE subnet (e.g.
    # 10.0.1.0/27). Prompted (with a suggestion) if the PE subnet must be created.
    [string]$PrivateEndpointSubnetPrefix = "",
    # [PRIVATE] Subscription + resource group where the private DNS zones live. Point
    # these at your hub/central DNS subscription to REUSE existing privatelink.* zones.
    # Default: the deployment subscription / the VNet's resource group.
    [string]$PrivateDnsZoneSubscriptionId = "",
    [string]$PrivateDnsZoneResourceGroupName = "",
    # [PRIVATE] Disable public network access on OpenAI/SQL/Redis after wiring their
    # Private Endpoints (ACR stays public so 'az acr build' + pulls work). $false to
    # keep public access on while still creating the Private Endpoints.
    [bool]$DisablePublicNetworkAccess = $true,

    # PowerShell modules ensured before deploying (auto-installed if missing). The
    # deployment itself uses the Azure CLI; these standard Az modules are ensured for
    # operator convenience / PowerShell follow-up. Pass -RequiredPSModules @() to skip.
    [string[]]$RequiredPSModules = @('Az.Accounts','Az.Resources','Az.Network')
)

# ── PowerShell 7.4+ : az/native commands write to stderr on benign conditions
#    ("already exists", etc.) and ACR build prints progress to stderr. Without
#    this, $ErrorActionPreference=Stop would abort on harmless stderr output.
$ErrorActionPreference = "Stop"
$ProgressPreference     = "SilentlyContinue"
if (Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue) {
    $PSNativeCommandUseErrorActionPreference = $false
}

# `az acr build` streams the remote build log through colorama; on Windows that
# write crashes (UnicodeEncodeError) when the build output contains a non-ASCII
# glyph (e.g. vite's "built in ✓") and stdout is a cp1252 stream. az runs python in
# ISOLATED mode (-I), which ignores PYTHONIOENCODING/PYTHONUTF8 — so the only
# reliable fix is a UTF-8 console codepage. IMPORTANT: do NOT pipe this script's
# output (e.g. `... | Tee-Object`); piping makes stdout a cp1252 pipe and the crash
# returns. Run it directly so az inherits the UTF-8 console.
try { chcp 65001 > $null 2>&1 } catch {}
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
try { $OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

# ── Helpers ───────────────────────────────────────────────────────────────────
function Write-Step($m)    { Write-Host "`n=== $m ===" -ForegroundColor Cyan }
function Write-Info($m)    { Write-Host "  $m" -ForegroundColor Gray }
function Write-Ok($m)      { Write-Host "  $m" -ForegroundColor Green }
function Write-Warn2($m)   { Write-Host "  $m" -ForegroundColor Yellow }
function Fail($m)          { Write-Host "  ERROR: $m" -ForegroundColor Red; exit 1 }

$RepoRoot = Split-Path -Parent $PSScriptRoot   # Scripts/.. = repo root (Dockerfile lives here)
$ScriptVersion = "2026-06-11.9"

Write-Host "============================================================" -ForegroundColor Blue
Write-Host "  Azure Infra IQ — Container Apps deployment" -ForegroundColor Blue
Write-Host "  AI-Powered Azure Infrastructure Management and Insights" -ForegroundColor Blue
Write-Host "  Script version: $ScriptVersion" -ForegroundColor Blue
Write-Host "============================================================" -ForegroundColor Blue

# ── Step 0: Prerequisites & tooling bootstrap ─────────────────────────────-
# Make sure the host has everything the script needs BEFORE any resource is created:
#   * PowerShell 7+ recommended (5.1 supported)
#   * Azure CLI (az) on PATH + the 'containerapp' extension (auto-added/upgraded)
#   * Any PowerShell modules in $RequiredPSModules (auto-installed if missing)
Write-Step "Step 0: Prerequisites & module check"
$psv = $PSVersionTable.PSVersion
if ($psv.Major -lt 7) { Write-Warn2 "PowerShell $psv detected — 7+ is recommended (https://aka.ms/powershell). Continuing." }
else { Write-Ok "PowerShell $psv" }

if (-not (Get-Command az -ErrorAction SilentlyContinue)) {
    Fail "Azure CLI (az) is not installed or not on PATH. Install https://aka.ms/installazurecli then re-run."
}
$azVer = az version -o json 2>$null | ConvertFrom-Json
if ($azVer) { Write-Ok "Azure CLI $($azVer.'azure-cli')" } else { Write-Ok "Azure CLI detected" }

# Azure CLI extensions the script relies on (idempotent: add if missing, else upgrade).
foreach ($ext in @("containerapp")) {
    if (az extension show --name $ext 2>$null) {
        az extension update --name $ext --only-show-errors 2>$null | Out-Null
    } else {
        Write-Info "Installing az extension '$ext'..."
        az extension add --name $ext --only-show-errors 2>$null | Out-Null
    }
    if (az extension show --name $ext 2>$null) { Write-Ok "az extension '$ext' ready" }
    else { Write-Warn2 "Could not install az extension '$ext' — Container App steps may fail." }
}

# PowerShell modules: install only the ones that are actually missing.
function Ensure-PSModule {
    param([Parameter(Mandatory)][string]$Name)
    if (Get-Module -ListAvailable -Name $Name) { Write-Ok "PowerShell module '$Name' present"; return }
    Write-Info "Installing PowerShell module '$Name' (CurrentUser scope)..."
    try {
        if (-not (Get-PackageProvider -Name NuGet -ErrorAction SilentlyContinue)) {
            Install-PackageProvider -Name NuGet -MinimumVersion 2.8.5.201 -Scope CurrentUser -Force -ErrorAction Stop | Out-Null
        }
        $gallery = Get-PSRepository -Name PSGallery -ErrorAction SilentlyContinue
        if ($gallery -and $gallery.InstallationPolicy -ne 'Trusted') {
            Set-PSRepository -Name PSGallery -InstallationPolicy Trusted -ErrorAction SilentlyContinue
        }
        Install-Module -Name $Name -Scope CurrentUser -Force -AllowClobber -ErrorAction Stop
        Write-Ok "Installed PowerShell module '$Name'"
    } catch {
        Write-Warn2 "Could not install '$Name': $($_.Exception.Message). Install it manually if you need it."
    }
}
if ($RequiredPSModules -and $RequiredPSModules.Count -gt 0) {
    foreach ($m in $RequiredPSModules) { Ensure-PSModule -Name $m }
} else {
    Write-Info "No PowerShell modules requested (RequiredPSModules is empty)."
}

# ── Pre-flight ────────────────────────────────────────────────────
Write-Step "Pre-Flight Checks"
$acct = az account show -o json 2>$null | ConvertFrom-Json
if (-not $acct) { Fail "Not logged in. Run 'az login' first." }
if ([string]::IsNullOrWhiteSpace($SubscriptionId)) { $SubscriptionId = $acct.id }
az account set --subscription $SubscriptionId 2>$null
$acct = az account show -o json | ConvertFrom-Json
Write-Ok "Subscription: $($acct.name) ($($acct.id))"
Write-Ok "Tenant:       $($acct.tenantId)"

# If the RG already exists in another region, align deployment region to RG region.
$existingRgLocation = az group show --name $ResourceGroupName --query location -o tsv 2>$null
if (-not [string]::IsNullOrWhiteSpace($existingRgLocation) -and $existingRgLocation.ToLowerInvariant() -ne $Location.ToLowerInvariant()) {
    Write-Warn2 "Resource group '$ResourceGroupName' already exists in '$existingRgLocation'. Overriding -Location '$Location' -> '$existingRgLocation'."
    $Location = $existingRgLocation
}

# Entra ID app registration for USER SIGN-IN (REQUIRED). Create it first (SPA platform,
# delegated User.Read) — see docs/ENTRA_APP_SETUP.md — then provide its Application
# (client) ID + Directory (tenant) ID (here, or as -EntraAppClientId / -EntraTenantId).
# Users sign in with MSAL; no client secret is deployed.
while ([string]::IsNullOrWhiteSpace($EntraAppClientId)) { $EntraAppClientId = (Read-Host "  Entra App (client) ID for user sign-in").Trim() }
while ([string]::IsNullOrWhiteSpace($EntraTenantId))    { $EntraTenantId    = (Read-Host "  Entra tenant (directory) ID").Trim() }

# Subscription scanning model:
#   * -SubscriptionIds "id1,id2" -> pin to explicit list.
#   * -DiscoverAllSubscriptions $true OR -SubscriptionIds "auto" -> discover all enabled.
#   * default -> deployment subscription only.
$normalizedSubs = if ([string]::IsNullOrWhiteSpace($SubscriptionIds)) { "" } else { $SubscriptionIds.Trim() }
$discoverAll = $DiscoverAllSubscriptions -or ($normalizedSubs.ToLowerInvariant() -eq "auto")
$explicitSubs = (-not [string]::IsNullOrWhiteSpace($normalizedSubs)) -and (-not $discoverAll)
if ($explicitSubs) {
    $SubscriptionIds = $normalizedSubs
    $ScanSubscriptionsEnv = $SubscriptionIds
    Write-Ok "Subscription scope: pinned to provided list"
} elseif ($discoverAll) {
    $ScanSubscriptionsEnv = "auto"
    Write-Host "  Discovering accessible subscriptions (for RBAC grants)..." -ForegroundColor DarkGray
    $allSubs = az account list --query "[?state=='Enabled'].id" -o tsv 2>$null
    $subList = @($allSubs -split "`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    if ($subList.Count -gt 0) {
        $SubscriptionIds = ($subList -join ',')
        Write-Ok "Found $($subList.Count) enabled subscription(s) — granting identity Reader on each; app discovers them at runtime"
    } else {
        $SubscriptionIds = $SubscriptionId
        $ScanSubscriptionsEnv = $SubscriptionId
        Write-Warn2 "Could not list subscriptions; using current subscription only ($SubscriptionId)."
    }
} else {
    $SubscriptionIds = $SubscriptionId
    $ScanSubscriptionsEnv = $SubscriptionId
    Write-Ok "Subscription scope: deployment subscription only ($SubscriptionId)"
}
if ([string]::IsNullOrWhiteSpace($ZureMapClientId)) { $ZureMapClientId = $EntraAppClientId }
if ([string]::IsNullOrWhiteSpace($ZureMapTenantId)) { $ZureMapTenantId = $EntraTenantId }
$deployZureMap = $true
$useZureMapSp = -not [string]::IsNullOrWhiteSpace($ZureMapClientSecret)
$zuremapSessionKey = -join ((48..57)+(97..122) | Get-Random -Count 48 | ForEach-Object { [char]$_ })

# ── Private (VNet-integrated) networking resolution ────────────────────────-
# Resolved up-front so we FAIL FAST (before creating anything) if the VNet/subnet is
# missing. $isPrivate / $ingressMode / $InfraSubnetId / $VNetId / $PeSubnetId are
# ALWAYS defined so the environment + app + private-endpoint steps reference them safely.
$isPrivate     = ($DeploymentMode -eq "Private")
$ingressMode   = if ($isPrivate) { "internal" } else { "external" }
$InfraSubnetId = ""
$VNetId        = ""
$PeSubnetId    = ""
$VNetLocation  = ""

# Suggest the LAST /27 of the VNet (subnets are usually allocated from the start) as a
# default when the PE subnet must be auto-created. Returns "" if it cannot be computed.
function Get-SuggestedPeCidr {
    param([string]$VNetCidr, [int]$NewMask = 27)
    if ($VNetCidr -notmatch '^([0-9\.]+)/(\d+)$') { return "" }
    $vmask = [int]$Matches[2]
    if ($vmask -ge $NewMask) { return "" }
    $ipBytes = ([System.Net.IPAddress]::Parse($Matches[1])).GetAddressBytes(); [array]::Reverse($ipBytes)
    $baseU = [System.BitConverter]::ToUInt32($ipBytes, 0)
    $vnetSize  = [uint64][math]::Pow(2, 32 - $vmask)
    $blockSize = [uint64][math]::Pow(2, 32 - $NewMask)
    $lastBlock = [uint32]($baseU + $vnetSize - $blockSize)
    $b = [System.BitConverter]::GetBytes($lastBlock); [array]::Reverse($b)
    "{0}/{1}" -f ([System.Net.IPAddress]::new($b)).ToString(), $NewMask
}

if ($isPrivate) {
    Write-Step "Pre-Flight: Private networking (VNet / subnets / DNS)"
    if ([string]::IsNullOrWhiteSpace($VNetResourceGroupName))           { $VNetResourceGroupName = $ResourceGroupName }
    while ([string]::IsNullOrWhiteSpace($VNetName))                     { $VNetName = (Read-Host "  Existing VNet name").Trim() }
    while ([string]::IsNullOrWhiteSpace($SubnetName))                   { $SubnetName = (Read-Host "  Existing DEDICATED subnet for the Container Apps environment (>= /27, /23 recommended)").Trim() }
    if ([string]::IsNullOrWhiteSpace($PrivateDnsZoneResourceGroupName)) { $PrivateDnsZoneResourceGroupName = $VNetResourceGroupName }
    if ([string]::IsNullOrWhiteSpace($PrivateDnsZoneSubscriptionId))    { $PrivateDnsZoneSubscriptionId = $SubscriptionId }

    $vnet = az network vnet show --resource-group $VNetResourceGroupName --name $VNetName -o json 2>$null | ConvertFrom-Json
    if (-not $vnet) { Fail "VNet '$VNetName' not found in resource group '$VNetResourceGroupName'." }
    $VNetId = $vnet.id
    $VNetLocation = "$($vnet.location)"
    Write-Ok "VNet: $VNetName ($VNetResourceGroupName)"

    # ACA environment region must match the VNet region.
    if (-not [string]::IsNullOrWhiteSpace($VNetLocation) -and $VNetLocation.ToLowerInvariant() -ne $Location.ToLowerInvariant()) {
        Write-Warn2 "Private mode requires Container Apps environment region to match VNet region. Overriding -Location '$Location' -> '$VNetLocation'."
        $Location = $VNetLocation
    }

    # 1) Container Apps infrastructure subnet (delegated to Microsoft.App/environments).
    $subnet = az network vnet subnet show --resource-group $VNetResourceGroupName --vnet-name $VNetName --name $SubnetName -o json 2>$null | ConvertFrom-Json
    if (-not $subnet) { Fail "Subnet '$SubnetName' not found in VNet '$VNetName'. Create a dedicated, empty subnet (>= /27, /23 recommended) first." }
    $InfraSubnetId = $subnet.id
    $prefix = $subnet.addressPrefix
    if (-not $prefix -and $subnet.addressPrefixes) { $prefix = $subnet.addressPrefixes[0] }
    if ($prefix -match '/(\d+)\s*$') {
        $mask = [int]$Matches[1]
        if ($mask -gt 27) { Write-Warn2 "Subnet '$SubnetName' is /$mask — Container Apps needs at least /27 (/23 recommended for production); provisioning may fail." }
        else { Write-Ok "Subnet $prefix (/$mask) meets the /27 minimum" }
    }
    $delegated = @($subnet.delegations | ForEach-Object { $_.serviceName }) -contains "Microsoft.App/environments"
    if (-not $delegated) {
        Write-Info "Delegating subnet '$SubnetName' to 'Microsoft.App/environments'..."
        az network vnet subnet update --resource-group $VNetResourceGroupName --vnet-name $VNetName --name $SubnetName `
            --delegations "Microsoft.App/environments" --output none 2>$null
        if ($LASTEXITCODE -eq 0) { Write-Ok "Subnet delegated to Microsoft.App/environments" }
        else { Write-Warn2 "Could not delegate the subnet — delegate it to 'Microsoft.App/environments' manually before re-running." }
    } else { Write-Ok "Subnet already delegated to Microsoft.App/environments" }

    # ── Subnet cleanliness pre-flight ─────────────────────────────────────────
    # Container Apps requires the subnet to be 100 % empty. A previous failed
    # deployment can leave the subnet "claimed" (IP configs, load balancer NICs, or
    # an ACA environment still in CreateFailed state). Detect this BEFORE attempting
    # the environment create so the admin gets a clear, actionable message instead of
    # a cryptic ARM error deep inside the retry loop.
    Write-Info "Checking subnet '$SubnetName' is clean and unoccupied..."

    # 1) IP-configuration check: any allocation = subnet is not empty
    $subnetIpConfigs = @()
    if ($subnet.ipConfigurations) { $subnetIpConfigs = @($subnet.ipConfigurations) }
    $subnetHasIpConfigs = $subnetIpConfigs.Count -gt 0

    # 2) Find any Container Apps environment that references this exact subnet ID.
    #    Search the deployment RG first (fast), then fall back to subscription-wide.
    $linkedEnv   = $null
    $linkedEnvRg = $null

    $envsInRg = az containerapp env list --resource-group $ResourceGroupName --subscription $SubscriptionId --output json 2>$null
    if ($envsInRg) {
        ($envsInRg | ConvertFrom-Json) | ForEach-Object {
            $es = $_.properties.vnetConfiguration.infrastructureSubnetId
            if ($es -and $es.ToLowerInvariant() -eq $InfraSubnetId.ToLowerInvariant()) {
                $linkedEnv = $_; $linkedEnvRg = $ResourceGroupName
            }
        }
    }
    if (-not $linkedEnv) {
        # Broader subscription-level search (covers envs in other resource groups).
        # Normalize both IDs: lowercase + trim to avoid silent comparison misses
        # when the ARM API returns IDs with different casing.
        $normInfraId = $InfraSubnetId.ToLowerInvariant().Trim()
        $allEnvs = az containerapp env list --subscription $SubscriptionId --output json 2>$null
        if ($allEnvs) {
            ($allEnvs | ConvertFrom-Json) | ForEach-Object {
                $es = $_.properties.vnetConfiguration.infrastructureSubnetId
                if ($es -and $es.ToLowerInvariant().Trim() -eq $normInfraId) {
                    $linkedEnv = $_; $linkedEnvRg = ($_.id -split '/')[4]
                }
            }
        }
    }

    # 3) Evaluate what we found and decide how to proceed.
    $subnetBlocked = $false
    $sep = "  " + ("─" * 72)
    if ($linkedEnv) {
        $linkedEnvName  = $linkedEnv.name
        $linkedEnvState = $linkedEnv.properties.provisioningState

        if ($linkedEnvState -eq "Succeeded" -and
            $linkedEnvName  -eq $ContainerAppEnvName -and
            $linkedEnvRg    -eq $ResourceGroupName) {
            # Same environment, same RG, healthy → this is a re-run. No action needed.
            Write-Ok "Subnet is held by existing healthy environment '$linkedEnvName' (re-run detected — OK)"

        } elseif ($linkedEnvState -eq "Succeeded") {
            # A DIFFERENT healthy environment owns this subnet.
            $subnetBlocked = $true
            Write-Host ""
            Write-Host $sep                                                          -ForegroundColor Yellow
            Write-Host "  SUBNET IN USE  —  $SubnetName"                           -ForegroundColor Yellow
            Write-Host $sep                                                          -ForegroundColor Yellow
            Write-Host "  An active Container Apps environment already owns this subnet:" -ForegroundColor Yellow
            Write-Host "    Environment : $linkedEnvName"                           -ForegroundColor Cyan
            Write-Host "    State       : $linkedEnvState"                          -ForegroundColor Cyan
            Write-Host "    Resource group: $linkedEnvRg"                           -ForegroundColor Cyan
            Write-Host ""
            Write-Host "  You have two options:"                                    -ForegroundColor Yellow
            Write-Host "  Option A — Re-run this deployment pointing at a DIFFERENT subnet:" -ForegroundColor White
            Write-Host "    -SubnetName '<new-empty-subnet-name>'"                  -ForegroundColor Cyan
            Write-Host "  Option B — Delete the existing environment (only if you own it):" -ForegroundColor White
            Write-Host "    az containerapp env delete --name $linkedEnvName ``"   -ForegroundColor Cyan
            Write-Host "        --resource-group $linkedEnvRg --yes"               -ForegroundColor Cyan
            Write-Host $sep                                                          -ForegroundColor Yellow
            Write-Host ""

        } elseif ($linkedEnvState -in @("CreateFailed","Failed","Canceled","Error")) {
            # A FAILED environment is still holding the subnet.
            $subnetBlocked = $true
            Write-Host ""
            Write-Host $sep                                                          -ForegroundColor Red
            Write-Host "  SUBNET BLOCKED  —  $SubnetName"                          -ForegroundColor Red
            Write-Host $sep                                                          -ForegroundColor Red
            Write-Host "  A FAILED Container Apps environment is still associated with this subnet." -ForegroundColor Red
            Write-Host "  Azure will reject every new environment create until it is removed."       -ForegroundColor Red
            Write-Host ""
            Write-Host "    Environment : $linkedEnvName"                           -ForegroundColor Cyan
            Write-Host "    State       : $linkedEnvState"                          -ForegroundColor Red
            Write-Host "    Resource group: $linkedEnvRg"                           -ForegroundColor Cyan
            Write-Host ""
            Write-Host "  To fix — run BOTH commands (in order) and then re-run this script:" -ForegroundColor Yellow
            Write-Host ""
            Write-Host "    Step 1: Delete the failed environment"                  -ForegroundColor White
            Write-Host "      az containerapp env delete ``"                        -ForegroundColor Cyan
            Write-Host "          --name $linkedEnvName ``"                         -ForegroundColor Cyan
            Write-Host "          --resource-group $linkedEnvRg --yes"             -ForegroundColor Cyan
            Write-Host ""
            Write-Host "    Step 2 (optional): If the subnet delegation is stuck after deletion" -ForegroundColor White
            Write-Host "      az network vnet subnet update ``"                     -ForegroundColor Cyan
            Write-Host "          --resource-group $VNetResourceGroupName ``"       -ForegroundColor Cyan
            Write-Host "          --vnet-name $VNetName ``"                         -ForegroundColor Cyan
            Write-Host "          --name $SubnetName --remove delegations"          -ForegroundColor Cyan
            Write-Host ""
            Write-Host "    Alternative: Re-run with a brand-new empty subnet:"    -ForegroundColor White
            Write-Host "      -SubnetName '<new-empty-subnet-name>'"                -ForegroundColor Cyan
            Write-Host $sep                                                          -ForegroundColor Red
            Write-Host ""

        } else {
            # Provisioning / updating — environment is in transition
            Write-Warn2 "Environment '$linkedEnvName' in RG '$linkedEnvRg' is currently in state '$linkedEnvState' on this subnet. Proceeding with caution."
        }

    } elseif ($subnetHasIpConfigs) {
        # No ACA environment found, but the subnet has connected IP configurations
        # (e.g. NICs or load balancers left over from a deleted environment).
        $subnetBlocked = $true
        $configList = ($subnetIpConfigs | ForEach-Object {
            $parts = $_.id -split '/'
            if ($parts.Count -ge 9) { "  • $($parts[6])/$($parts[7])/$($parts[8])" } else { "  • $($_.id)" }
        }) -join "`n"
        Write-Host ""
        Write-Host $sep                                                              -ForegroundColor Red
        Write-Host "  SUBNET NOT EMPTY  —  $SubnetName"                            -ForegroundColor Red
        Write-Host $sep                                                              -ForegroundColor Red
        Write-Host "  The subnet has $($subnetIpConfigs.Count) connected resource(s) but no Container Apps environment was found." -ForegroundColor Red
        Write-Host "  Container Apps requires a 100% empty, dedicated subnet."     -ForegroundColor Red
        Write-Host ""
        Write-Host "  Connected resources:"                                         -ForegroundColor Yellow
        Write-Host $configList                                                       -ForegroundColor Cyan
        Write-Host ""
        Write-Host "  Options:"                                                      -ForegroundColor Yellow
        Write-Host "  Option A — Remove those resources from '$SubnetName' and retry." -ForegroundColor White
        Write-Host "  Option B — Re-run with a different, empty subnet:"            -ForegroundColor White
        Write-Host "    -SubnetName '<new-empty-subnet-name>'"                      -ForegroundColor Cyan
        Write-Host $sep                                                              -ForegroundColor Red
        Write-Host ""

    } else {
        Write-Ok "Subnet '$SubnetName' is clean — no connected resources or blocked environments found"
    }

    if ($subnetBlocked) {
        Fail "Subnet '$SubnetName' is not available for a new Container Apps deployment. See the instructions above."
    }
    # ── End subnet cleanliness pre-flight ─────────────────────────────────────

    # 2) Private Endpoint subnet (OpenAI/SQL/Redis PEs). MUST differ from the ACA subnet
    #    (delegated subnets can't host PEs). Use the provided one, or auto-create it.
    if ([string]::IsNullOrWhiteSpace($PrivateEndpointSubnetName)) { $PrivateEndpointSubnetName = "pe-subnet" }
    if ($PrivateEndpointSubnetName -eq $SubnetName) { Fail "-PrivateEndpointSubnetName must differ from -SubnetName (a delegated subnet cannot host Private Endpoints)." }
    $peSubnet = az network vnet subnet show --resource-group $VNetResourceGroupName --vnet-name $VNetName --name $PrivateEndpointSubnetName -o json 2>$null | ConvertFrom-Json
    if (-not $peSubnet) {
        if ([string]::IsNullOrWhiteSpace($PrivateEndpointSubnetPrefix)) {
            $sugg = Get-SuggestedPeCidr -VNetCidr (@($vnet.addressSpace.addressPrefixes)[0]) -NewMask 27
            $msg  = if ($sugg) { "  Address prefix for new PE subnet '$PrivateEndpointSubnetName' [$sugg]" } else { "  Address prefix for new PE subnet '$PrivateEndpointSubnetName' (e.g. 10.0.1.0/27)" }
            $PrivateEndpointSubnetPrefix = (Read-Host $msg).Trim()
            if ([string]::IsNullOrWhiteSpace($PrivateEndpointSubnetPrefix) -and $sugg) { $PrivateEndpointSubnetPrefix = $sugg }
        }
        if ([string]::IsNullOrWhiteSpace($PrivateEndpointSubnetPrefix)) { Fail "No address prefix for new PE subnet '$PrivateEndpointSubnetName'. Pass -PrivateEndpointSubnetPrefix '<cidr>'." }
        az network vnet subnet create --resource-group $VNetResourceGroupName --vnet-name $VNetName --name $PrivateEndpointSubnetName `
            --address-prefixes $PrivateEndpointSubnetPrefix --output none 2>$null
        if ($LASTEXITCODE -ne 0) { Fail "Could not create PE subnet '$PrivateEndpointSubnetName' ($PrivateEndpointSubnetPrefix) — does the prefix overlap an existing subnet?" }
        Write-Ok "PE subnet created: $PrivateEndpointSubnetName ($PrivateEndpointSubnetPrefix)"
        $peSubnet = az network vnet subnet show --resource-group $VNetResourceGroupName --vnet-name $VNetName --name $PrivateEndpointSubnetName -o json 2>$null | ConvertFrom-Json
    } else { Write-Ok "PE subnet: $PrivateEndpointSubnetName" }
    $PeSubnetId = $peSubnet.id
    # Private Endpoints require PE network policies disabled on the subnet.
    az network vnet subnet update --resource-group $VNetResourceGroupName --vnet-name $VNetName --name $PrivateEndpointSubnetName `
        --disable-private-endpoint-network-policies true --output none 2>$null

    Write-Ok "Private mode ready — internal ingress; PE subnet '$PrivateEndpointSubnetName'; DNS in sub '$PrivateDnsZoneSubscriptionId' RG '$PrivateDnsZoneResourceGroupName'"
}

if (-not (Test-Path (Join-Path $RepoRoot "Dockerfile"))) {
    Fail "Combined Dockerfile not found at repo root: $RepoRoot\Dockerfile"
}

# Generate unique-ish names where needed
$rand = -join ((48..57) + (97..122) | Get-Random -Count 6 | ForEach-Object { [char]$_ })
if ([string]::IsNullOrWhiteSpace($ContainerRegistryName)) { $ContainerRegistryName = "infraiqacr$rand" }
if ([string]::IsNullOrWhiteSpace($OpenAIResourceName))    { $OpenAIResourceName    = "infraiq-openai-$rand" }
if ([string]::IsNullOrWhiteSpace($SqlServerName))         { $SqlServerName         = "infraiq-sql-$rand" }
if ([string]::IsNullOrWhiteSpace($RedisName))             { $RedisName             = "infraiq-redis-$rand" }
if ([string]::IsNullOrWhiteSpace($SqlAdminPassword)) {
    $SqlAdminPassword = (-join ((65..90)+(97..122)+(48..57) | Get-Random -Count 20 | ForEach-Object {[char]$_})) + "!aA9"
}
$reuseImage = -not [string]::IsNullOrWhiteSpace($ImageTag)
$imageTag = if ($reuseImage) { $ImageTag } else { "v$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())" }

if ([string]::IsNullOrWhiteSpace($OpenAILocation))  { $OpenAILocation  = $Location }

# Final guardrail: do not continue to build/deploy if private mode region still mismatches VNet.
if ($isPrivate -and -not [string]::IsNullOrWhiteSpace($VNetLocation) -and $VNetLocation.ToLowerInvariant() -ne $Location.ToLowerInvariant()) {
    Fail "Private deployment region mismatch: VNet is in '$VNetLocation' but deployment location is '$Location'. Use -Location '$VNetLocation'."
}

Write-Info "Region:            $Location"
Write-Info "Resource group:    $ResourceGroupName"
Write-Info "Container registry:$ContainerRegistryName"
Write-Info "Container app:     $ContainerAppName"
Write-Info "OpenAI:            $OpenAIResourceName ($OpenAILocation) / $(if ($OpenAIDeploymentName) { $OpenAIDeploymentName } else { 'newest GPT available' })"
Write-Info "Deploy SQL:        $DeploySql   Deploy Redis: $DeployRedis"
$scanList = @($SubscriptionIds -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
if ($scanList.Count -gt 10) {
    $preview = ($scanList | Select-Object -First 5) -join ','
    Write-Info "Scan subscriptions: $($scanList.Count) total (first 5: $preview ...)"
} else {
    Write-Info "Scan subscriptions: $($scanList -join ',')"
}

# ── Resolve Container Apps dedicated capacity selection (EARLY, before the long
#    image build) so any interactive menu is shown up front and the rest of the
#    deployment runs unattended. The chosen profile is APPLIED later in Step 8. ──
$capacityProfiles = @(
    @{ Choice="1"; Type="D8"; Name="infraiq-d8"; MinNodes=2; MaxNodes=2; Cpu="8.0"; Memory="32.0Gi"; MaxReplicas=2; Label="D8 x 2  (8 vCPU / 32 GiB, 2 nodes)" },
    @{ Choice="2"; Type="D8"; Name="infraiq-d8"; MinNodes=1; MaxNodes=1; Cpu="8.0"; Memory="32.0Gi"; MaxReplicas=2; Label="D8 x 1  (8 vCPU / 32 GiB, 1 node)"  },
    @{ Choice="3"; Type="D4"; Name="infraiq-d4"; MinNodes=2; MaxNodes=2; Cpu="4.0"; Memory="16.0Gi"; MaxReplicas=2; Label="D4 x 2  (4 vCPU / 16 GiB, 2 nodes)" },
    @{ Choice="4"; Type="D4"; Name="infraiq-d4"; MinNodes=1; MaxNodes=1; Cpu="4.0"; Memory="16.0Gi"; MaxReplicas=1; Label="D4 x 1  (4 vCPU / 16 GiB, 1 node)"  }
)
# Backward compatibility: the old -EnableDedicatedCapacityFallback $false flag = Manual mode.
$effectiveMode = $CapacityMode
if (-not $EnableDedicatedCapacityFallback -and $CapacityMode -eq "Automatic") {
    $effectiveMode = "Manual"
    if ([string]::IsNullOrWhiteSpace($ManualProfileChoice)) { $ManualProfileChoice = "4" }
    Write-Info "Legacy -EnableDedicatedCapacityFallback `$false detected -> Manual capacity mode (profile $ManualProfileChoice)."
}
if ($effectiveMode -eq "Manual" -and [string]::IsNullOrWhiteSpace($ManualProfileChoice)) {
    Write-Host ""
    Write-Host "  Select the Container Apps dedicated capacity profile (Manual mode):" -ForegroundColor Yellow
    foreach ($p in $capacityProfiles) { Write-Host "    [$($p.Choice)] $($p.Label)" -ForegroundColor Cyan }
    Write-Host ""
    while ($ManualProfileChoice -notin @("1","2","3","4")) {
        $ManualProfileChoice = (Read-Host "  Enter choice (1-4)").Trim()
    }
}
if ($effectiveMode -eq "Manual") {
    $selProfile = $capacityProfiles | Where-Object { $_.Choice -eq $ManualProfileChoice } | Select-Object -First 1
    Write-Info "Capacity mode:     Manual -> $($selProfile.Label)"
} else {
    Write-Info "Capacity mode:     Automatic -> fallback ladder D8x2 -> D8x1 -> D4x2 -> D4x1"
}

# ── Providers + containerapp extension ─────────────────────────────────────────
Write-Step "Step 1: Registering providers and CLI extension"
foreach ($p in @("Microsoft.App","Microsoft.OperationalInsights","Microsoft.ContainerRegistry","Microsoft.CognitiveServices","Microsoft.Sql","Microsoft.Cache")) {
    az provider register --namespace $p --wait 2>$null | Out-Null
    Write-Info "Registered $p"
}
az extension add --name containerapp --upgrade --only-show-errors 2>$null | Out-Null
Write-Ok "containerapp extension ready"

# ── Resource group ─────────────────────────────────────────────────────────────
Write-Step "Step 2: Resource group"
$rgLocation = az group show --name $ResourceGroupName --query location -o tsv 2>$null
if (-not [string]::IsNullOrWhiteSpace($rgLocation)) {
    if ($rgLocation.ToLowerInvariant() -ne $Location.ToLowerInvariant()) {
        Write-Warn2 "Resource group '$ResourceGroupName' exists in '$rgLocation'. Continuing with that region."
        $Location = $rgLocation
    }
} else {
    az group create --name $ResourceGroupName --location $Location --output none
    if ($LASTEXITCODE -ne 0) { Fail "Failed to create resource group '$ResourceGroupName' in '$Location'." }
}
Write-Ok "Resource group ready: $ResourceGroupName"

# ── Azure Container Registry + image build ─────────────────────────────────────
Write-Step "Step 3: Container Registry + image build"
$acrExists = az acr show --name $ContainerRegistryName --resource-group $ResourceGroupName 2>$null
if (-not $acrExists) {
    az acr create --name $ContainerRegistryName --resource-group $ResourceGroupName --sku Premium --admin-enabled true --output none
    if ($LASTEXITCODE -ne 0) { Fail "Failed to create ACR '$ContainerRegistryName' (name may be taken)." }
}
az acr update --name $ContainerRegistryName --admin-enabled true --output none 2>$null
$acrLoginServer = az acr show --name $ContainerRegistryName --query loginServer -o tsv
Write-Ok "ACR ready: $acrLoginServer"

if ($reuseImage) {
    Write-Ok "Reusing existing image tag '$imageTag' (skipping build)"
} else {
Write-Info "Building combined image remotely (SPA build + backend + ODBC + ZureMap engine). This takes ~10-15 min..."
Push-Location $RepoRoot
az acr build --registry $ContainerRegistryName --image "${ImageName}:${imageTag}" --file "Dockerfile" .
$acrBuildExit = $LASTEXITCODE
Pop-Location
if ($acrBuildExit -ne 0) {
    # az's Windows log-streaming can crash AFTER the remote build was queued (the
    # server-side build keeps running). Distinguish that from a real build failure by
    # polling the actual run STATUS: fail fast on Failed/Canceled, wait while Running,
    # continue once it Succeeds.
    Write-Warn2 "az acr build reported exit $acrBuildExit — checking the remote build run status..."
    $ok = $false
    for ($i = 0; $i -lt 80; $i++) {
        $run = az acr task list-runs --registry $ContainerRegistryName --top 1 -o json 2>$null | ConvertFrom-Json
        $st = if ($run) { $run[0].status } else { $null }
        if ($st -eq "Succeeded") { $ok = $true; break }
        if ($st -in @("Failed","Canceled","Error","Timeout")) {
            Fail "ACR build run '$($run[0].runId)' $st. Inspect: az acr task logs --registry $ContainerRegistryName --run-id $($run[0].runId)"
        }
        Start-Sleep -Seconds 15
    }
    if ($ok) { Write-Ok "Remote ACR build Succeeded — continuing." }
    else { Fail "ACR build did not complete in time." }
}
}
$fullImage = "$acrLoginServer/${ImageName}:${imageTag}"
Write-Ok "Image built: $fullImage"

$acrUser = az acr credential show --name $ContainerRegistryName --query username -o tsv
$acrPass = az acr credential show --name $ContainerRegistryName --query "passwords[0].value" -o tsv

# ── Monitoring + Container Apps environment ─────────────────────────────────
Write-Step "Step 4: Monitoring + Container Apps environment"
$lawCustomerId = ""
$lawKey = ""
$useLogAnalytics = $false
if (-not [string]::IsNullOrWhiteSpace($ExistingLogAnalyticsWorkspaceId) -and -not [string]::IsNullOrWhiteSpace($ExistingLogAnalyticsWorkspaceKey)) {
    $lawCustomerId = $ExistingLogAnalyticsWorkspaceId
    $lawKey = $ExistingLogAnalyticsWorkspaceKey
    $useLogAnalytics = $true
    Write-Info "Using customer-provided Log Analytics workspace credentials (no workspace creation)."
} elseif ($CreateLogAnalyticsWorkspace) {
    $lawExists = az monitor log-analytics workspace show --resource-group $ResourceGroupName --workspace-name $LogAnalyticsName 2>$null
    if (-not $lawExists) {
        az monitor log-analytics workspace create --resource-group $ResourceGroupName --workspace-name $LogAnalyticsName --location $Location --output none
    }
    $lawCustomerId = az monitor log-analytics workspace show --resource-group $ResourceGroupName --workspace-name $LogAnalyticsName --query customerId -o tsv
    $lawKey        = az monitor log-analytics workspace get-shared-keys --resource-group $ResourceGroupName --workspace-name $LogAnalyticsName --query primarySharedKey -o tsv
    $useLogAnalytics = $true
    Write-Info "Created/used deployment-owned Log Analytics workspace '$LogAnalyticsName'."
} else {
    Write-Info "No Log Analytics workspace configured. Environment logs destination: none."
}

$envProvState = az containerapp env show --name $ContainerAppEnvName --resource-group $ResourceGroupName --query "properties.provisioningState" -o tsv 2>$null
if ($envProvState -and $envProvState -ne "Succeeded") {
    Write-Info "Existing environment '$ContainerAppEnvName' is in state '$envProvState' (not Succeeded). Deleting and recreating in $Location..."
    az containerapp env delete --name $ContainerAppEnvName --resource-group $ResourceGroupName --yes --output none 2>$null
    $envProvState = $null
}
if (-not $envProvState) {
    $envCreateArgs = @(
        "containerapp","env","create",
        "--name",$ContainerAppEnvName,"--resource-group",$ResourceGroupName,"--location",$Location
    )
    if ($useLogAnalytics) {
        $envCreateArgs += @("--logs-destination","log-analytics","--logs-workspace-id",$lawCustomerId,"--logs-workspace-key",$lawKey)
    } else {
        $envCreateArgs += @("--logs-destination","none")
    }
    if ($isPrivate) {
        # Inject into the customer VNet with an internal-only load balancer (no public IP).
        $envCreateArgs += @("--infrastructure-subnet-resource-id",$InfraSubnetId,"--internal-only","true")
        Write-Info "Private mode: environment -> subnet '$SubnetName' (internal-only ingress)."
    }
    $envCreated = $false
    $lastEnvError = ""
    for ($attempt = 1; $attempt -le 4; $attempt++) {
        # Before each attempt: if the environment already exists in a non-Succeeded/non-pending
        # state (e.g. CreateFailed from a previous attempt), delete it so the create can proceed.
        $existingProvState = az containerapp env show --name $ContainerAppEnvName --resource-group $ResourceGroupName --query "properties.provisioningState" -o tsv 2>$null
        if ($existingProvState -and $existingProvState -notin @("Succeeded","Waiting","InProgress","Pending")) {
            Write-Warn2 "Environment '$ContainerAppEnvName' is in '$existingProvState' state — deleting before retry (attempt $attempt/4)..."
            az containerapp env delete --name $ContainerAppEnvName --resource-group $ResourceGroupName --yes --output none 2>$null
            # Wait up to 3 minutes for deletion to complete before retrying
            $deleted = $false
            for ($dw = 1; $dw -le 12; $dw++) {
                $chk = az containerapp env show --name $ContainerAppEnvName --resource-group $ResourceGroupName 2>$null
                if (-not $chk) { $deleted = $true; break }
                Write-Info "Waiting for environment deletion... ($($dw * 15)s)"
                Start-Sleep -Seconds 15
            }
            if (-not $deleted) { Write-Warn2 "Environment deletion may still be in progress; proceeding with create anyway." }
        }

        Write-Info "Creating Container Apps environment (attempt $attempt/4)..."
        $envErr = az @envCreateArgs --output none 2>&1
        if ($LASTEXITCODE -eq 0) {
            $envCreated = $true
            break
        }

        $lastEnvError = "$envErr"

        # ── Hard-stop: subnet already owned by another environment ───────────────
        # ManagedEnvironmentSubnetInUse is a CONFIGURATION error, not a capacity error.
        # No amount of retrying or SKU switching will fix it — only deleting the
        # conflicting environment (or using a different subnet) will. Surface it
        # immediately with exact remediation commands and exit.
        if ($lastEnvError -match "ManagedEnvironmentSubnetInUse") {
            $ceName = "unknown"; $ceRg = "unknown"
            if ($lastEnvError -match "managedEnvironments/([^'`"\s]+)") { $ceName = $Matches[1] }
            if ($lastEnvError -match "/resourceGroups/([^/]+)/providers/Microsoft\.App")  { $ceRg  = $Matches[1] }
            $sep = "  " + ("─" * 70)
            Write-Host ""
            Write-Host $sep                                                                         -ForegroundColor Red
            Write-Host "  SUBNET IN USE  —  '$SubnetName' is already claimed by another environment" -ForegroundColor Red
            Write-Host $sep                                                                         -ForegroundColor Red
            Write-Host "  Conflicting environment : $ceName"                                        -ForegroundColor Cyan
            Write-Host "  Resource group          : $ceRg"                                          -ForegroundColor Cyan
            Write-Host ""
            Write-Host "  This is a configuration error — retrying or changing SKU will NOT fix it." -ForegroundColor Yellow
            Write-Host "  Run BOTH commands below, then re-run this script:"                         -ForegroundColor Yellow
            Write-Host ""
            Write-Host "  Step 1 — Delete the conflicting environment:"                              -ForegroundColor White
            Write-Host "    az containerapp env delete ``"                                           -ForegroundColor Cyan
            Write-Host "        --name $ceName ``"                                                   -ForegroundColor Cyan
            Write-Host "        --resource-group $ceRg --yes"                                       -ForegroundColor Cyan
            Write-Host ""
            Write-Host "  Step 2 — If the subnet delegation is still stuck after deletion:"          -ForegroundColor White
            Write-Host "    az network vnet subnet update ``"                                        -ForegroundColor Cyan
            Write-Host "        --resource-group $VNetResourceGroupName ``"                         -ForegroundColor Cyan
            Write-Host "        --vnet-name $VNetName ``"                                           -ForegroundColor Cyan
            Write-Host "        --name $SubnetName --remove delegations"                            -ForegroundColor Cyan
            Write-Host ""
            Write-Host "  Alternative — re-run with a brand-new empty subnet:"                      -ForegroundColor White
            Write-Host "    -SubnetName '<new-empty-subnet-name>'"                                  -ForegroundColor Cyan
            Write-Host $sep                                                                         -ForegroundColor Red
            Write-Host ""
            Fail "Subnet '$SubnetName' is already claimed by '$ceName' (RG: $ceRg). Delete that environment first, then re-run."
        }

        # ── Retryable errors: AKS capacity and transient ARM state errors ────────
        # NOTE: 'ManagedEnvironmentIn' is intentionally scoped to 'InCreateFailedState'
        # only — do NOT widen it to match 'ManagedEnvironmentSubnetInUse' again.
        $isRetryable = ($lastEnvError -match "AKSCapacityHeavyUsage|capacity|InCreateFailedState")
        if ($isRetryable -and $attempt -lt 4) {
            Write-Warn2 "Container Apps environment create failed (capacity/transient). Waiting 30 seconds before retry $($attempt + 1)/4..."
            Start-Sleep -Seconds 30
            continue
        }
        break
    }
    if (-not $envCreated) {
        Fail "Failed to create Container Apps environment after retries (region capacity/quota, or the infrastructure subnet is unusable — needs >= /27 (/23 recommended), empty, delegated to Microsoft.App/environments). Last error: $lastEnvError"
    }
    $envProvState = az containerapp env show --name $ContainerAppEnvName --resource-group $ResourceGroupName --query "properties.provisioningState" -o tsv 2>$null
    if ($envProvState -ne "Succeeded") { Fail "Container Apps environment did not provision successfully (state: $envProvState). Try a different -Location with available capacity." }
}
Write-Ok "Container Apps environment ready: $ContainerAppEnvName ($envProvState)"

# ── Azure OpenAI + model ───────────────────────────────────────────────────────
Write-Step "Step 5: Azure OpenAI (S0 PAYG account + model PAYG)"
$openaiExists = az cognitiveservices account show --name $OpenAIResourceName --resource-group $ResourceGroupName 2>$null
if (-not $openaiExists) {
    az cognitiveservices account create --name $OpenAIResourceName --resource-group $ResourceGroupName `
        --location $OpenAILocation --kind OpenAI --sku S0 --custom-domain $OpenAIResourceName --output none
    if ($LASTEXITCODE -ne 0) { Fail "Failed to create Azure OpenAI (region/quota?). Try -OpenAILocation swedencentral." }
}
$openaiEndpoint = az cognitiveservices account show --name $OpenAIResourceName --resource-group $ResourceGroupName --query "properties.endpoint" -o tsv
$openaiKey      = az cognitiveservices account keys list --name $OpenAIResourceName --resource-group $ResourceGroupName --query key1 -o tsv
Write-Ok "OpenAI ready: $openaiEndpoint"

# Deployment-name policy: by default the deployment is named after the ACTUAL model deployed (so the
# app + summary always reflect the real model, e.g. gpt-5.5). Pass -OpenAIDeploymentName to pin an alias.
$useModelAsName = [string]::IsNullOrWhiteSpace($OpenAIDeploymentName)
$depExists = $false
if ($useModelAsName) {
    # Idempotent re-runs: reuse the first existing deployment on the resource, if any.
    $existingName = az cognitiveservices account deployment list --name $OpenAIResourceName --resource-group $ResourceGroupName --query "[0].name" -o tsv 2>$null
    if ($existingName) { $OpenAIDeploymentName = $existingName; $depExists = $true }
} else {
    $shown = az cognitiveservices account deployment show --name $OpenAIResourceName --resource-group $ResourceGroupName --deployment-name $OpenAIDeploymentName 2>$null
    if ($shown) { $depExists = $true }
}
if ($depExists) {
    $existModel = az cognitiveservices account deployment show --name $OpenAIResourceName --resource-group $ResourceGroupName --deployment-name $OpenAIDeploymentName --query "properties.model.name" -o tsv 2>$null
    Write-Ok "Model deployment already exists: '$OpenAIDeploymentName' ($existModel)"
} else {
    Write-Info "Deploying newest available GPT model first (GPT-5.5 > GPT-5.x > GPT-5 > GPT-4.1 > GPT-4o); GlobalStandard > DataZoneStandard > Standard; highest TPM the quota allows, then fall back."
    # Newest GA model + version first so the AI analysis/recommendations use the strongest model the
    # quota allows. GPT-5.x are reasoning models (no temperature/top_p). gpt-4o-mini is last resort only.
    $modelPlan = @(
        @{ Model="gpt-5.5";     Version="2026-04-24"; Sku="GlobalStandard"   },
        @{ Model="gpt-5.5";     Version="2026-04-24"; Sku="DataZoneStandard" },
        @{ Model="gpt-5.4";     Version="2026-03-05"; Sku="GlobalStandard"   },
        @{ Model="gpt-5.4";     Version="2026-03-05"; Sku="DataZoneStandard" },
        @{ Model="gpt-5.2";     Version="2025-12-11"; Sku="GlobalStandard"   },
        @{ Model="gpt-5.2";     Version="2025-12-11"; Sku="DataZoneStandard" },
        @{ Model="gpt-5.1";     Version="2025-11-13"; Sku="GlobalStandard"   },
        @{ Model="gpt-5.1";     Version="2025-11-13"; Sku="DataZoneStandard" },
        @{ Model="gpt-5";       Version="2025-08-07"; Sku="GlobalStandard"   },
        @{ Model="gpt-5";       Version="2025-08-07"; Sku="DataZoneStandard" },
        @{ Model="gpt-4.1";     Version="2025-04-14"; Sku="GlobalStandard"   },
        @{ Model="gpt-4.1";     Version="2025-04-14"; Sku="DataZoneStandard" },
        @{ Model="gpt-4o";      Version="2024-11-20"; Sku="GlobalStandard"   },
        @{ Model="gpt-4o";      Version="2024-11-20"; Sku="DataZoneStandard" },
        @{ Model="gpt-4o";      Version="2024-08-06"; Sku="Standard"         },
        @{ Model="gpt-4o-mini"; Version="2024-07-18"; Sku="GlobalStandard"   }
    )
    # REAL TPM quota pre-check: deploy the highest TPM the quota allows, then fall back.
    $tpmAvail = @{}
    $usageJson = az cognitiveservices usage list -l $OpenAILocation -o json 2>$null
    if ($LASTEXITCODE -eq 0 -and $usageJson) {
        try {
            ($usageJson | ConvertFrom-Json) | ForEach-Object {
                $a = [math]::Floor([double]$_.limit - [double]$_.currentValue)
                if ($a -lt 0) { $a = 0 }
                $tpmAvail[$_.name.value] = [int]$a
            }
        } catch { }
    }
    function Get-TpmQuotaName { param($Model,$Sku) "OpenAI.$Sku." + ($Model -replace 'gpt-4\.1','gpt4.1') }
    function Get-CapacityLadder {
        param([int]$AvailableK)
        if ($AvailableK -le 0) { return @() }
        $steps = @(1000,500,300,200,150,100,50,30,20,10)
        $top = [math]::Min($AvailableK,1000)
        $ladder = @($steps | Where-Object { $_ -le $top })
        if ($ladder.Count -eq 0 -or $ladder[0] -ne $top) { $ladder = @($top) + $ladder }
        return ($ladder | Select-Object -Unique)
    }
    $defaultLadder = @(100,50,30,20,10)

    $deployed = $false
    foreach ($m in $modelPlan) {
        if ($deployed) { break }
        if ($tpmAvail.Count -gt 0) {
            $qName  = Get-TpmQuotaName -Model $m.Model -Sku $m.Sku
            $availK = if ($tpmAvail.ContainsKey($qName)) { $tpmAvail[$qName] } else { 0 }
            $ladder = Get-CapacityLadder -AvailableK $availK
            if ($ladder.Count -eq 0) { continue }
        } else {
            $ladder = $defaultLadder
        }
        $depName = if ($useModelAsName) { $m.Model } else { $OpenAIDeploymentName }
        foreach ($cap in $ladder) {
            if ($deployed) { break }
            az cognitiveservices account deployment create --name $OpenAIResourceName --resource-group $ResourceGroupName `
                --deployment-name $depName --model-name $m.Model --model-version $m.Version --model-format OpenAI `
                --sku-name $m.Sku --sku-capacity $cap --output none 2>$null
            if ($LASTEXITCODE -eq 0) {
                $deployed = $true
                if ($useModelAsName) { $OpenAIDeploymentName = $m.Model }
                Write-Ok "Model deployed: $($m.Model) ($($m.Version)) [$($m.Sku), ${cap}K TPM] as '$OpenAIDeploymentName'"
                if ($m.Model -eq "gpt-4o-mini") { Write-Warn2 "Newer GPT models were unavailable — deployed gpt-4o-mini as last-resort fallback." }
            }
        }
    }
    if (-not $deployed) { Write-Warn2 "No model deployment succeeded (quota/region). AI features limited. Request quota: https://aka.ms/oai/quotaincrease" }
}

# ── Azure SQL ──────────────────────────────────────────────────────────────────
$sqlConnectionString = ""
if ($DeploySql) {
    Write-Step "Step 6: Azure SQL ($SqlServiceObjective)"
    $sqlExists = az sql server show --name $SqlServerName --resource-group $ResourceGroupName 2>$null
    if (-not $sqlExists) {
        az sql server create --name $SqlServerName --resource-group $ResourceGroupName --location $Location `
            --admin-user $SqlAdminUser --admin-password $SqlAdminPassword --output none
        if ($LASTEXITCODE -ne 0) { Fail "Failed to create SQL server." }
        az sql server firewall-rule create --resource-group $ResourceGroupName --server $SqlServerName `
            --name "AllowAzureServices" --start-ip-address 0.0.0.0 --end-ip-address 0.0.0.0 --output none 2>$null
    } else {
        # Server already exists from a previous run. $SqlAdminPassword is regenerated every run,
        # so RESET the server's admin password to match the connection string we store in the
        # secret below — otherwise the app gets "Login failed for user" (error 18456) and snapshot
        # persistence silently breaks (forcing a full re-scan on every open).
        az sql server update --name $SqlServerName --resource-group $ResourceGroupName `
            --admin-password $SqlAdminPassword --output none 2>$null
        if ($LASTEXITCODE -ne 0) { Write-Warn2 "Could not reset SQL admin password on existing server $SqlServerName." }
        else { Write-Ok "Reset SQL admin password on existing server (keeps secret in sync)" }
        # Make sure Azure services (the Container App) can still reach the server.
        az sql server firewall-rule create --resource-group $ResourceGroupName --server $SqlServerName `
            --name "AllowAzureServices" --start-ip-address 0.0.0.0 --end-ip-address 0.0.0.0 --output none 2>$null
    }
    $dbExists = az sql db show --name $SqlDatabaseName --server $SqlServerName --resource-group $ResourceGroupName 2>$null
    if (-not $dbExists) {
        az sql db create --name $SqlDatabaseName --server $SqlServerName --resource-group $ResourceGroupName `
            --service-objective $SqlServiceObjective --backup-storage-redundancy Local --output none
        if ($LASTEXITCODE -ne 0) { Fail "Failed to create SQL database." }
    }
    $sqlConnectionString = "Driver={ODBC Driver 18 for SQL Server};Server=tcp:$SqlServerName.database.windows.net,1433;Database=$SqlDatabaseName;Uid=$SqlAdminUser;Pwd=$SqlAdminPassword;Encrypt=yes;TrustServerCertificate=no;Connection Timeout=30;"
    Write-Ok "Azure SQL ready: $SqlServerName/$SqlDatabaseName"
}

# ── Azure Cache for Redis ──────────────────────────────────────────────────────
$redisUrl = ""
if ($DeployRedis) {
    Write-Step "Step 7: Azure Cache for Redis ($RedisSku $RedisVmSize)"
    $redisExists = az redis show --name $RedisName --resource-group $ResourceGroupName 2>$null
    if (-not $redisExists) {
        Write-Info "Creating Redis (this can take 15-20 minutes)..."
        $redisErr = az redis create --name $RedisName --resource-group $ResourceGroupName --location $Location `
            --sku $RedisSku --vm-size $RedisVmSize --minimum-tls-version 1.2 --output none 2>&1
        if ($LASTEXITCODE -ne 0) {
            Write-Warn2 "Could not create Redis - the app runs fine WITHOUT it (no caching). Continuing."
            if ("$redisErr" -match "retir") { Write-Warn2 "Azure Cache for Redis is being retired; use Azure Managed Redis (az redisenterprise) or pass -DeployRedis `$false." }
            $DeployRedis = $false
        }
    }
    if ($DeployRedis) {
        $redisHost = az redis show --name $RedisName --resource-group $ResourceGroupName --query hostName -o tsv
        $redisKey  = az redis list-keys --name $RedisName --resource-group $ResourceGroupName --query primaryKey -o tsv
        $redisUrl  = "rediss://:$redisKey@${redisHost}:6380"
        Write-Ok "Redis ready: $redisHost"
    }
}

# ── Container App ──────────────────────────────────────────────────────────────
Write-Step "Step 8: Container App"

# Secrets (sensitive values referenced by env vars via secretref).
$secrets = @("openai-key=$openaiKey")
if ($DeploySql)   { $secrets += "sql-conn=$sqlConnectionString" }
if ($redisUrl)    { $secrets += "redis-url=$redisUrl" }
if ($deployZureMap) {
    $secrets += "zuremap-session-key=$zuremapSessionKey"
    if ($useZureMapSp) { $secrets += "zuremap-secret=$ZureMapClientSecret" }
}

# Environment contract (the app's real env — see backend/services/*).
# Auth to Azure = the app's SYSTEM-ASSIGNED MANAGED IDENTITY via DefaultAzureCredential,
# so we deliberately do NOT set AZURE_CLIENT_ID/SECRET.
$envVars = @(
    "AI_PROVIDER=azure_openai",
    "AZURE_OPENAI_ENDPOINT=$openaiEndpoint",
    "AZURE_OPENAI_KEY=secretref:openai-key",
    "AZURE_OPENAI_DEPLOYMENT=$OpenAIDeploymentName",
    "AZURE_TENANT_ID=$EntraTenantId",
    "AZURE_SUBSCRIPTION_ID=$SubscriptionId",
    "AZURE_SUBSCRIPTION_IDS=$ScanSubscriptionsEnv",
    "ENTRA_CLIENT_ID=$EntraAppClientId",
    "ENTRA_TENANT_ID=$EntraTenantId",
    "AUTH_REQUIRED=true",
    "AUTO_REFRESH_INTERVAL_HOURS=6",
    "SETTINGS_DIR=/srv/config"
)
if ($DeploySql) { $envVars += @("DATABASE_PROVIDER=azuresql", "AZURE_SQL_CONNECTION_STRING=secretref:sql-conn") }
if ($redisUrl)  { $envVars += "REDIS_URL=secretref:redis-url" }
# Embedded Architecture Map (ZureMap). ZUREMAP_* are deliberately NOT named AZURE_*
# so they never override the app's managed identity (DefaultAzureCredential).
if ($deployZureMap) {
    $envVars += @("ZUREMAP_EMBED=proxy", "ZUREMAP_SESSION_KEY=secretref:zuremap-session-key")
    if ($useZureMapSp) {
        $envVars += @(
            "ZUREMAP_USE_MANAGED_IDENTITY=false",
            "ZUREMAP_CLIENT_ID=$ZureMapClientId",
            "ZUREMAP_TENANT_ID=$ZureMapTenantId",
            "ZUREMAP_CLIENT_SECRET=secretref:zuremap-secret"
        )
    } else {
        $envVars += @("ZUREMAP_USE_MANAGED_IDENTITY=true")
    }
}

$appExists = az containerapp show --name $ContainerAppName --resource-group $ResourceGroupName 2>$null

# Capacity selection was resolved early (before the image build). Build the profile
# list to apply: a single chosen profile in Manual mode, or the full ladder in Automatic.
if ($effectiveMode -eq "Manual") {
    $sel = $capacityProfiles | Where-Object { $_.Choice -eq $ManualProfileChoice } | Select-Object -First 1
    $profileLadder = @($sel)
    Write-Info "Applying Manual capacity profile: $($sel.Label)"
} else {
    $profileLadder = $capacityProfiles
    Write-Info "Applying Automatic capacity ladder: D8x2 -> D8x1 -> D4x2 -> D4x1"
}

if ($appExists) {
    az containerapp registry set --name $ContainerAppName --resource-group $ResourceGroupName `
        --server $acrLoginServer --username $acrUser --password $acrPass --output none 2>$null
    az containerapp secret set --name $ContainerAppName --resource-group $ResourceGroupName --secrets $secrets --output none
}

$profileDeployed = $null
$lastDeployError = ""
foreach ($profile in $profileLadder) {
    Write-Info "Provisioning dedicated capacity profile: $($profile.Label)"
    $wpErr = az containerapp env workload-profile set --name $ContainerAppEnvName --resource-group $ResourceGroupName `
        --workload-profile-name $profile.Name --workload-profile-type $profile.Type `
        --min-nodes $profile.MinNodes --max-nodes $profile.MaxNodes --output none 2>&1
    if ($LASTEXITCODE -ne 0) {
        $lastDeployError = "$wpErr"
        if ($effectiveMode -eq "Manual") { Write-Warn2 "Workload profile '$($profile.Label)' could not be added (capacity/quota)." }
        else { Write-Warn2 "Workload profile '$($profile.Label)' unavailable right now. Trying next fallback profile." }
        continue
    }

    if (-not $appExists) {
        $appErr = az containerapp create --name $ContainerAppName --resource-group $ResourceGroupName --environment $ContainerAppEnvName `
            --image $fullImage --target-port 8000 --ingress $ingressMode --transport auto `
            --registry-server $acrLoginServer --registry-username $acrUser --registry-password $acrPass `
            --system-assigned --workload-profile-name $profile.Name `
            --cpu $profile.Cpu --memory $profile.Memory --min-replicas 1 --max-replicas $profile.MaxReplicas `
            --secrets $secrets --env-vars $envVars --output none 2>&1
    } else {
        $appErr = az containerapp update --name $ContainerAppName --resource-group $ResourceGroupName `
            --image $fullImage --set-env-vars $envVars --workload-profile-name $profile.Name `
            --cpu $profile.Cpu --memory $profile.Memory --min-replicas 1 --max-replicas $profile.MaxReplicas --output none 2>&1
    }

    if ($LASTEXITCODE -eq 0) {
        $profileDeployed = $profile
        $Cpu = $profile.Cpu
        $Memory = $profile.Memory
        Write-Ok "Container App deployed on capacity profile: $($profile.Label)"
        break
    }

    $lastDeployError = "$appErr"
    if ($effectiveMode -eq "Manual") { Write-Warn2 "Container App deployment failed on '$($profile.Label)'." }
    else { Write-Warn2 "Container App deployment failed on '$($profile.Label)'. Trying next fallback profile." }
}
if (-not $profileDeployed) {
    if ($effectiveMode -eq "Manual") {
        Fail "Manual capacity profile '$($profileLadder[0].Label)' could not be provisioned (capacity/quota). Re-run with -CapacityMode Automatic to auto-fall back, or pick a smaller profile (e.g. -ManualProfileChoice 4). Last error: $lastDeployError"
    } else {
        Fail "Failed to create/update Container App across all dedicated fallback profiles (D8x2 -> D8x1 -> D4x2 -> D4x1). Last error: $lastDeployError"
    }
}
$fqdn = az containerapp show --name $ContainerAppName --resource-group $ResourceGroupName --query "properties.configuration.ingress.fqdn" -o tsv
$appUrl = "https://$fqdn"
Write-Ok "Container App ready: $appUrl"

# ── Private DNS for the internal ingress ────────────────────────────────-
# An internal-only environment publishes the app on a PRIVATE IP. For the FQDN to
# resolve from inside the VNet (and peered networks / on-prem), create a private DNS
# zone named after the environment's default domain with a wildcard A record to the
# environment's static IP, linked to the VNet.
$envDefaultDomain = ""
if ($isPrivate) {
    Write-Step "Step 8b: Private DNS zone (internal ingress)"
    $envStaticIp      = az containerapp env show --name $ContainerAppEnvName --resource-group $ResourceGroupName --query "properties.staticIp" -o tsv 2>$null
    $envDefaultDomain = az containerapp env show --name $ContainerAppEnvName --resource-group $ResourceGroupName --query "properties.defaultDomain" -o tsv 2>$null
    if ([string]::IsNullOrWhiteSpace($envStaticIp) -or [string]::IsNullOrWhiteSpace($envDefaultDomain)) {
        Write-Warn2 "Could not read environment staticIp/defaultDomain — create the private DNS zone manually."
    } else {
        if (-not (az network private-dns zone show --subscription $PrivateDnsZoneSubscriptionId --resource-group $PrivateDnsZoneResourceGroupName --name $envDefaultDomain 2>$null)) {
            az network private-dns zone create --subscription $PrivateDnsZoneSubscriptionId --resource-group $PrivateDnsZoneResourceGroupName --name $envDefaultDomain --output none 2>$null
            if ($LASTEXITCODE -eq 0) { Write-Ok "Private DNS zone created: $envDefaultDomain" } else { Write-Warn2 "Could not create private DNS zone '$envDefaultDomain'." }
        } else { Write-Ok "Private DNS zone exists: $envDefaultDomain" }
        $dnsLinkName = "$ContainerAppEnvName-vnet-link"
        if (-not (az network private-dns link vnet show --subscription $PrivateDnsZoneSubscriptionId --resource-group $PrivateDnsZoneResourceGroupName --zone-name $envDefaultDomain --name $dnsLinkName 2>$null)) {
            az network private-dns link vnet create --subscription $PrivateDnsZoneSubscriptionId --resource-group $PrivateDnsZoneResourceGroupName --zone-name $envDefaultDomain `
                --name $dnsLinkName --virtual-network $VNetId --registration-enabled false --output none 2>$null
            if ($LASTEXITCODE -eq 0) { Write-Ok "Linked private DNS zone to VNet '$VNetName'" } else { Write-Warn2 "Could not link private DNS zone to the VNet." }
        } else { Write-Ok "Private DNS VNet link exists" }
        if (-not (az network private-dns record-set a show --subscription $PrivateDnsZoneSubscriptionId --resource-group $PrivateDnsZoneResourceGroupName --zone-name $envDefaultDomain --name "*" 2>$null)) {
            az network private-dns record-set a add-record --subscription $PrivateDnsZoneSubscriptionId --resource-group $PrivateDnsZoneResourceGroupName --zone-name $envDefaultDomain `
                --record-set-name "*" --ipv4-address $envStaticIp --output none 2>$null
            if ($LASTEXITCODE -eq 0) { Write-Ok "Wildcard A record *.$envDefaultDomain -> $envStaticIp" } else { Write-Warn2 "Could not create wildcard A record — add '*.$envDefaultDomain -> $envStaticIp' manually." }
        } else { Write-Ok "Wildcard A record already present for *.$envDefaultDomain" }
    }
}

# ── Step 8c: Private Endpoints for the PaaS resources ─────────────────────────-
# Put OpenAI / SQL / Redis on the VNet via Private Endpoints in the PE subnet, each
# registered in its privatelink DNS zone. Zones are REUSED from your hub DNS
# subscription/RG when -PrivateDnsZoneSubscriptionId/-PrivateDnsZoneResourceGroupName
# point there, else created locally. ACR is left public so 'az acr build' + the image
# pull keep working (an ACR Private Endpoint needs a Premium registry — separate step).
function New-ResourcePrivateEndpoint {
    param([string]$Name,[string]$ResourceId,[string]$GroupId,[string]$ZoneName)
    if ([string]::IsNullOrWhiteSpace($ResourceId)) { Write-Warn2 "Skipping $Name — target resource not found."; return }
    if (-not (az network private-dns zone show --subscription $PrivateDnsZoneSubscriptionId --resource-group $PrivateDnsZoneResourceGroupName --name $ZoneName 2>$null)) {
        az network private-dns zone create --subscription $PrivateDnsZoneSubscriptionId --resource-group $PrivateDnsZoneResourceGroupName --name $ZoneName --output none 2>$null
        if ($LASTEXITCODE -eq 0) { Write-Ok "DNS zone created: $ZoneName" } else { Write-Warn2 "Could not create DNS zone '$ZoneName'." }
    } else { Write-Ok "DNS zone reused: $ZoneName" }
    $zoneId = az network private-dns zone show --subscription $PrivateDnsZoneSubscriptionId --resource-group $PrivateDnsZoneResourceGroupName --name $ZoneName --query id -o tsv 2>$null
    $linkName = "$ContainerAppEnvName-$GroupId-link"
    if ($zoneId -and -not (az network private-dns link vnet show --subscription $PrivateDnsZoneSubscriptionId --resource-group $PrivateDnsZoneResourceGroupName --zone-name $ZoneName --name $linkName 2>$null)) {
        az network private-dns link vnet create --subscription $PrivateDnsZoneSubscriptionId --resource-group $PrivateDnsZoneResourceGroupName --zone-name $ZoneName `
            --name $linkName --virtual-network $VNetId --registration-enabled false --output none 2>$null
    }
    if (-not (az network private-endpoint show --resource-group $ResourceGroupName --name $Name 2>$null)) {
        az network private-endpoint create --resource-group $ResourceGroupName --name $Name --location $Location `
            --subnet $PeSubnetId --private-connection-resource-id $ResourceId --group-id $GroupId --connection-name "$Name-conn" --output none 2>$null
        if ($LASTEXITCODE -ne 0) { Write-Warn2 "Could not create Private Endpoint '$Name'."; return }
        Write-Ok "Private Endpoint created: $Name ($GroupId)"
    } else { Write-Ok "Private Endpoint exists: $Name" }
    if ($zoneId) {
        az network private-endpoint dns-zone-group create --resource-group $ResourceGroupName --endpoint-name $Name `
            --name "default" --private-dns-zone $zoneId --zone-name $GroupId --output none 2>$null
        if ($LASTEXITCODE -eq 0) { Write-Ok "  DNS zone group wired for $Name" }
    }
}

if ($isPrivate) {
    Write-Step "Step 8c: Private Endpoints (OpenAI / SQL / Redis)"
    $aoaiId  = az cognitiveservices account show --name $OpenAIResourceName --resource-group $ResourceGroupName --query id -o tsv 2>$null
    $sqlId   = if ($DeploySql)   { az sql server show --name $SqlServerName --resource-group $ResourceGroupName --query id -o tsv 2>$null } else { "" }
    $redisId = if ($DeployRedis) { az redis show --name $RedisName --resource-group $ResourceGroupName --query id -o tsv 2>$null } else { "" }
    New-ResourcePrivateEndpoint -Name "$ContainerAppName-openai-pe" -ResourceId $aoaiId -GroupId "account" -ZoneName "privatelink.openai.azure.com"
    if ($sqlId)   { New-ResourcePrivateEndpoint -Name "$ContainerAppName-sql-pe"   -ResourceId $sqlId   -GroupId "sqlServer"  -ZoneName "privatelink.database.windows.net" }
    if ($redisId) { New-ResourcePrivateEndpoint -Name "$ContainerAppName-redis-pe" -ResourceId $redisId -GroupId "redisCache" -ZoneName "privatelink.redis.cache.windows.net" }
    if ($DisablePublicNetworkAccess) {
        Write-Info "Disabling data-plane public network access (the app reaches these privately over the VNet)..."
        if ($aoaiId)  { az resource update --ids $aoaiId  --set properties.publicNetworkAccess=Disabled --output none 2>$null }
        if ($sqlId)   { az resource update --ids $sqlId   --set properties.publicNetworkAccess=Disabled --output none 2>$null }
        if ($redisId) { az resource update --ids $redisId --set properties.publicNetworkAccess=Disabled --output none 2>$null }
        Write-Ok "Public network access disabled on the data-plane resources (ACR kept public for builds/pulls)."
    } else {
        Write-Info "Public network access left ENABLED (-DisablePublicNetworkAccess `$false); Private Endpoints still wired."
    }
}

# ── Managed identity + RBAC ────────────────────────────────────────────────────
Write-Step "Step 9: RBAC (Reader + Cost Management Reader)"
$principalId = az containerapp show --name $ContainerAppName --resource-group $ResourceGroupName --query "identity.principalId" -o tsv
if ([string]::IsNullOrWhiteSpace($principalId)) { Fail "Could not read managed identity principalId." }
Write-Info "Managed identity principalId: $principalId"

$permIssues = @()
foreach ($sid in ($SubscriptionIds -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ })) {
    foreach ($role in @("Reader","Cost Management Reader")) {
        $r = az role assignment create --assignee $principalId --role $role --scope "/subscriptions/$sid" --output none 2>&1
        if ($LASTEXITCODE -eq 0 -or "$r" -match "already exists|RoleAssignmentExists") { Write-Ok "$role on /subscriptions/$sid" }
        else { Write-Warn2 "Could not assign $role on $sid"; $permIssues += "az role assignment create --assignee $principalId --role `"$role`" --scope `"/subscriptions/$sid`"" }
    }
}
# If ZureMap is configured for SP mode, grant its service principal Reader too.
if ($deployZureMap -and $useZureMapSp) {
    foreach ($sid in ($SubscriptionIds -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ })) {
        $zr = az role assignment create --assignee $ZureMapClientId --role "Reader" --scope "/subscriptions/$sid" --output none 2>&1
        if ($LASTEXITCODE -eq 0 -or "$zr" -match "already exists|RoleAssignmentExists") { Write-Ok "ZureMap SP Reader on /subscriptions/$sid" }
        else { Write-Warn2 "Could not grant ZureMap SP Reader on $sid"; $permIssues += "az role assignment create --assignee $ZureMapClientId --role `"Reader`" --scope `"/subscriptions/$sid`"" }
    }
}
# Tenant-wide read roles (best-effort — require elevated rights such as Owner / User
# Access Administrator at the root management group).
#   Reader + Cost Management Reader -> read EVERY in-tenant subscription's resources & cost
#     in a SINGLE assignment (so the dynamic AZURE_SUBSCRIPTION_IDS=auto picker shows all
#     subs and cost is never $0 — even subscriptions created after this deploy).
#   Reservations Reader  -> Reserved Instance inventory & RI recommendations.
#   Management Group Reader -> management-group hierarchy + cross-subscription enumeration.
$tenantMgScope = "/providers/Microsoft.Management/managementGroups/$EntraTenantId"
foreach ($role in @("Reader","Cost Management Reader","Reservations Reader","Management Group Reader")) {
    $rr = az role assignment create --assignee $principalId --role $role --scope $tenantMgScope --output none 2>&1
    if ($LASTEXITCODE -eq 0 -or "$rr" -match "already exists|RoleAssignmentExists") { Write-Ok "$role on Tenant Root MG" }
    else { Write-Warn2 "Could not assign $role at tenant root (needs elevated rights)"; $permIssues += "az role assignment create --assignee $principalId --role `"$role`" --scope `"$tenantMgScope`"" }
}
# ── Microsoft Graph application permissions on the MI ─────────────────────────-
Write-Step "Step 10: Microsoft Graph permissions (Entra ID features)"
$graphSpId = "00000003-0000-0000-c000-000000000000"
$graphPerms = @(
    @{ Name="User.Read.All";        Id="df021288-bdef-4463-88db-98f22de89214" },
    @{ Name="Directory.Read.All";   Id="7ab1d382-f21e-4acd-a863-ba3e13f7da61" },
    @{ Name="Group.Read.All";       Id="5b567255-7703-4780-807c-7be8301ae99b" },
    @{ Name="Device.Read.All";      Id="7438b122-aefc-4978-80ed-43db9fcc7715" },
    @{ Name="Application.Read.All"; Id="9a5d68dd-52b0-4cc2-bd40-abcf44ac3a30" },
    @{ Name="AuditLog.Read.All";    Id="b0afded3-3588-46d8-8b3d-9842eff778da" },
    @{ Name="Policy.Read.All";      Id="246dd0d5-5bd0-4def-940b-0421030a5b68" }
)
$graphSpObjId = az ad sp show --id $graphSpId --query id -o tsv 2>$null
if ([string]::IsNullOrWhiteSpace($graphSpObjId)) {
    Write-Warn2 "Microsoft Graph SP not found — skipping Graph perms."
} else {
    foreach ($perm in $graphPerms) {
        $body = "{`"principalId`":`"$principalId`",`"resourceId`":`"$graphSpObjId`",`"appRoleId`":`"$($perm.Id)`"}"
        $res = az rest --method POST --uri "https://graph.microsoft.com/v1.0/servicePrincipals/$principalId/appRoleAssignments" `
            --headers "Content-Type=application/json" --body $body 2>&1
        if ($LASTEXITCODE -eq 0)                                    { Write-Ok "$($perm.Name) — assigned" }
        elseif ("$res" -match "already exists")                    { Write-Ok "$($perm.Name) — already assigned" }
        else { Write-Warn2 "$($perm.Name) — needs admin consent"; $permIssues += "az rest --method POST --uri https://graph.microsoft.com/v1.0/servicePrincipals/$principalId/appRoleAssignments --headers Content-Type=application/json --body '$body'" }
    }
}

# ── Register the app URL as a SPA redirect URI on the Entra app ────────────────
Write-Step "Step 11: Entra SPA redirect URI"
$appObjId = az ad app show --id $EntraAppClientId --query id -o tsv 2>$null
if ([string]::IsNullOrWhiteSpace($appObjId)) {
    Write-Warn2 "Entra app $EntraAppClientId not found in tenant — add redirect URI '$appUrl' manually (SPA platform)."
} else {
    $existing = az ad app show --id $EntraAppClientId --query "spa.redirectUris" -o json 2>$null | ConvertFrom-Json
    $uris = @()
    if ($existing) { $uris += $existing }
    if ($uris -notcontains $appUrl)        { $uris += $appUrl }
    if ($uris -notcontains "$appUrl/")     { $uris += "$appUrl/" }
    $spaBody = @{ spa = @{ redirectUris = $uris } } | ConvertTo-Json -Depth 5 -Compress
    az rest --method PATCH --uri "https://graph.microsoft.com/v1.0/applications/$appObjId" `
        --headers "Content-Type=application/json" --body $spaBody 2>$null
    if ($LASTEXITCODE -eq 0) { Write-Ok "Registered SPA redirect URI: $appUrl" }
    else { Write-Warn2 "Could not patch redirect URIs — add '$appUrl' manually (SPA platform)." }
}

# ── Summary ────────────────────────────────────────────────────────────────────
Write-Step "Deployment complete"
Write-Host "  App URL:        $appUrl" -ForegroundColor Green
Write-Host "  Resource group: $ResourceGroupName ($Location)" -ForegroundColor Gray
Write-Host "  Image:          $fullImage" -ForegroundColor Gray
Write-Host "  SKUs:           ACR Premium | Container App ${Cpu}/${Memory} | SQL $SqlServiceObjective | Redis $RedisSku $RedisVmSize | OpenAI S0 (PAYG)" -ForegroundColor Gray
if ($profileDeployed) { Write-Host "  ACA capacity:   $($profileDeployed.Label) [$effectiveMode mode]" -ForegroundColor Gray }
Write-Host "  OpenAI:         $OpenAIResourceName / $OpenAIDeploymentName" -ForegroundColor Gray
if ($DeploySql)  { Write-Host "  Azure SQL:      $SqlServerName/$SqlDatabaseName (admin: $SqlAdminUser)" -ForegroundColor Gray }
if ($redisUrl)   { Write-Host "  Redis:          $RedisName" -ForegroundColor Gray }
Write-Host "  Identity:       system-assigned ($principalId)" -ForegroundColor Gray
if ($isPrivate) {
    Write-Host "  Networking:     PRIVATE — internal ingress (VNet '$VNetName')" -ForegroundColor Gray
    Write-Host "  ACA subnet:     $SubnetName    PE subnet: $PrivateEndpointSubnetName" -ForegroundColor Gray
    Write-Host "  Private DNS:    sub '$PrivateDnsZoneSubscriptionId' / RG '$PrivateDnsZoneResourceGroupName'" -ForegroundColor Gray
    if ($envDefaultDomain) { Write-Host "  Ingress zone:   $envDefaultDomain (wildcard A -> env static IP)" -ForegroundColor Gray }
    Write-Host "  Private Endpoints: OpenAI$(if($DeploySql){' / SQL'})$(if($DeployRedis){' / Redis'})  (public access $(if($DisablePublicNetworkAccess){'disabled'}else{'enabled'}); ACR public for builds)" -ForegroundColor Gray
    Write-Host "  NOTE: $appUrl resolves only from INSIDE VNet '$VNetName' (or peered / on-prem via the private DNS)." -ForegroundColor DarkYellow
} else {
    Write-Host "  Networking:     PUBLIC ingress" -ForegroundColor Gray
}
Write-Host ""
if ($DeploySql)  { Write-Host "  SQL admin password: $SqlAdminPassword" -ForegroundColor Yellow }
if ($permIssues.Count -gt 0) {
    Write-Host "`n  Some permissions need an admin to run (Graph perms need admin consent):" -ForegroundColor Yellow
    $permIssues | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkYellow }
}
Write-Host "`n  Sign in at $appUrl with your organizational account." -ForegroundColor Cyan
if ($deployZureMap -and $useZureMapSp) {
    Write-Host "  Architecture Map (ZureMap) is embedded at $appUrl/zuremap/ using service-principal mode." -ForegroundColor DarkGray
} elseif ($deployZureMap) {
    Write-Host "  Architecture Map (ZureMap) is embedded at $appUrl/zuremap/ using managed identity mode." -ForegroundColor DarkGray
}
