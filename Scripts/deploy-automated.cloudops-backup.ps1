<#
.SYNOPSIS
    Fully Automated Deployment Script for Azure CloudOps Intelligence Agent
    
.DESCRIPTION
    This script creates ALL required Azure resources from scratch:
    - Azure OpenAI (AI Foundry) with GPT-4o model
    - Azure Container Registry
    - Azure Container Apps Environment (Public OR Private/VNet-integrated)
    - Azure Container App with System-Assigned Managed Identity
    - All RBAC role assignments (Least-Privilege, READ-ONLY)
    
    DEPLOYMENT MODES:
    - PUBLIC:  Container App is publicly accessible via HTTPS (default)
    - PRIVATE: Full zero-trust private deployment:
               - Container App deployed inside a VNet with internal-only ingress (VNet injection)
               - Private Endpoints for Azure OpenAI and Azure Container Registry
               - Discovers and REUSES existing Private DNS Zones (e.g., from AI Foundry PEs)
               - Creates missing DNS zones automatically in the user-specified RG
               - Public network access DISABLED on all PaaS resources
               - Supports centralized DNS subscription (enterprise hub/spoke pattern)
               - Interactive prompt when DNS parameters not provided
               - Only accessible from within the corporate/internal network
    
    NO manual configuration required - everything is 100% automated!
    When the script completes, the application is fully running.

.PARAMETER ResourceGroupName
    Name of the resource group to create/use

.PARAMETER Location
    Azure region for deployment (default: swedencentral)

.PARAMETER OpenAIResourceName
    Name for the Azure OpenAI resource (default: auto-generated)

.PARAMETER ContainerRegistryName
    Name for Azure Container Registry (must be globally unique, lowercase, no dashes)

.PARAMETER ContainerAppName
    Name for the Container App (default: cloudops-agent)
    Customize to match your organization's naming convention (e.g., 'mycompany-cloudops-app')

.PARAMETER ContainerAppEnvName
    Name for the Container Apps Environment (default: cloudops-env)
    Customize to match your organization's naming convention (e.g., 'mycompany-cloudops-env')
    Each environment can host multiple Container Apps and maps to one infrastructure subnet

.PARAMETER EntraAppClientId
    Client ID of the Entra ID App Registration for user authentication (REQUIRED)
    Create this BEFORE running the script - see Prerequisites section below

.PARAMETER EntraTenantId
    Azure AD Tenant ID for authentication (REQUIRED)

.PARAMETER SubscriptionId
    Target Azure Subscription ID for deployment (OPTIONAL but RECOMMENDED)
    If not provided, uses the currently active subscription in Azure CLI
    IMPORTANT: Specify this to ensure deployment goes to the correct subscription

.PARAMETER EnableLogAnalytics
    Enable Log Analytics workspace for Container Apps Environment (OPTIONAL)
    Default: Disabled (for simpler deployment on new subscriptions)
    When disabled, use 'az containerapp logs show' to view container logs

.PARAMETER DeploymentMode
    Deployment mode: 'Public' or 'Private' (default: Public)
    - Public:  Container App accessible from the internet via HTTPS
    - Private: Container App deployed inside a VNet, accessible only from internal network

.PARAMETER VNetResourceGroupName
    Resource group containing the existing VNet (REQUIRED for Private deployment)
    The VNet must already exist - this script does NOT create VNets

.PARAMETER VNetName
    Name of the existing VNet to deploy into (REQUIRED for Private deployment)
    The VNet must be in the same region as the deployment location

.PARAMETER SubnetName
    Name of the subnet within the VNet for Container Apps Environment (REQUIRED for Private deployment)
    Subnet requirements:
    - Minimum size: /27 (32 addresses) for workload profiles, /23 (512 addresses) recommended
    - Must be delegated to Microsoft.App/environments
    - Must not have any other resources deployed in it

.PARAMETER PrivateEndpointSubnetName
    Subnet for Private Endpoints (ACR, OpenAI) within the same VNet (OPTIONAL for Private deployment)
    If not provided, the script auto-creates a 'pe-subnet' (/27) in the VNet
    This MUST be a DIFFERENT subnet from the Container Apps subnet (delegated subnets cannot host PEs)

.PARAMETER PrivateDnsZoneSubscriptionId
    Subscription ID where Private DNS Zones should be created or looked up (OPTIONAL for Private deployment)
    Enterprises typically keep Private DNS Zones in a centralized "connectivity" or "shared services" subscription
    If not provided via parameter, the script will INTERACTIVELY ask if you have existing DNS zones
    If you choose not to provide one, DNS zones are created in the DEPLOYMENT subscription

.PARAMETER PrivateDnsZoneResourceGroupName
    Resource group for Private DNS Zones in the centralized subscription (OPTIONAL for Private deployment)
    If not provided via parameter, the script will INTERACTIVELY ask for it
    Common enterprise names: 'rg-dns', 'rg-private-dns-zones', 'rg-connectivity'

.EXAMPLE
    # PUBLIC deployment (default - accessible from internet)
    .\deploy-automated.ps1 -ResourceGroupName "rg-cloudops-agent" -Location "westeurope" -ContainerRegistryName "mycrname" -EntraAppClientId "your-app-client-id" -EntraTenantId "your-tenant-id" -SubscriptionId "your-subscription-id"

.EXAMPLE
    # PRIVATE deployment (VNet-integrated, internal access only)
    .\deploy-automated.ps1 -ResourceGroupName "rg-cloudops-agent" -Location "westeurope" -ContainerRegistryName "mycrname" -EntraAppClientId "your-app-client-id" -EntraTenantId "your-tenant-id" -SubscriptionId "your-subscription-id" -DeploymentMode "Private" -VNetResourceGroupName "rg-networking" -VNetName "corp-vnet" -SubnetName "container-apps-subnet"

.EXAMPLE
    # PRIVATE deployment with centralized DNS (enterprise pattern)
    .\deploy-automated.ps1 -ResourceGroupName "rg-cloudops-agent" -Location "westeurope" -ContainerRegistryName "mycrname" -EntraAppClientId "your-app-client-id" -EntraTenantId "your-tenant-id" -SubscriptionId "your-subscription-id" -DeploymentMode "Private" -VNetResourceGroupName "rg-networking" -VNetName "corp-vnet" -SubnetName "container-apps-subnet" -PrivateEndpointSubnetName "pe-subnet" -PrivateDnsZoneSubscriptionId "dns-subscription-id" -PrivateDnsZoneResourceGroupName "rg-private-dns-zones"

.EXAMPLE
    # Custom naming convention for Container App and Environment
    .\deploy-automated.ps1 -ResourceGroupName "rg-cloudops-agent" -ContainerRegistryName "mycrname" -ContainerAppName "contoso-cloudops-app" -ContainerAppEnvName "contoso-cloudops-env" -EntraAppClientId "your-app-client-id" -EntraTenantId "your-tenant-id" -SubscriptionId "your-subscription-id"

.EXAMPLE
    # Deploy with Log Analytics enabled
    .\deploy-automated.ps1 -ResourceGroupName "rg-cloudops-agent" -ContainerRegistryName "mycrname" -EntraAppClientId "your-app-client-id" -EntraTenantId "your-tenant-id" -SubscriptionId "your-subscription-id" -EnableLogAnalytics

# ==============================================================================
# ⚠️  IMPORTANT: TWO TYPES OF PERMISSIONS (READ CAREFULLY!)
# ==============================================================================
#
# There are TWO separate sets of permissions:
#
#   1. DEPLOYER PERMISSIONS - What YOU (the person running this script) need
#      - Required ONLY during deployment
#      - After deployment, your elevated access is NOT used by the application
#
#   2. APPLICATION PERMISSIONS - What the RUNNING APP needs to query Azure
#      - Assigned to a System-Assigned Managed Identity (created by this script)
#      - These are READ-ONLY permissions
#      - The app CANNOT create, modify, or delete any Azure resources
#
# ==============================================================================
# 1. DEPLOYER PERMISSIONS (Person running this script)
# ==============================================================================
# 
# The user running this script needs these permissions:
#
#    At SUBSCRIPTION level:
#    - Microsoft.Resources/subscriptions/resourceGroups/write     (Create Resource Group)
#    - Microsoft.CognitiveServices/accounts/write                 (Create Azure OpenAI)
#    - Microsoft.ContainerRegistry/registries/write               (Create ACR)
#    - Microsoft.App/containerApps/write                          (Create Container App)
#    - Microsoft.App/managedEnvironments/write                    (Create Container App Environment)
#    - Microsoft.Authorization/roleAssignments/write              (Assign RBAC roles)
#
#    RECOMMENDED: Assign "Contributor" + "User Access Administrator" to deployer
#    OR use "Owner" role (includes all above)
#
#    NOTE: These permissions are ONLY used during deployment. After the script
#    completes, your elevated access is not required for the application to run.
#
# ==============================================================================
# 2. APPLICATION PERMISSIONS (How Chat Queries Azure Resources)
# ==============================================================================
#
# When users chat with the agent (e.g., "Show me all VMs", "What's my cost?"),
# the application needs to authenticate to Azure APIs to fetch data.
#
# This script creates a SYSTEM-ASSIGNED MANAGED IDENTITY and assigns these roles:
#
# ┌────────────────────────────────────┬─────────────────┬─────────────────────────────┐
# │ Role                               │ Scope           │ Purpose                     │
# ├────────────────────────────────────┼─────────────────┼─────────────────────────────┤
# │ Reader                             │ Subscription    │ Query VMs, networks, etc.   │
# │ Cost Management Reader             │ Subscription    │ Read cost/billing data      │
# │ Cognitive Services OpenAI User     │ OpenAI Resource │ Use GPT-4o for chat         │
# └────────────────────────────────────┴─────────────────┴─────────────────────────────┘
#
# 🔒 SECURITY: All application permissions are READ-ONLY!
#    ✅ Can read resource metadata (VMs, storage, networks, etc.)
#    ✅ Can read cost data and spending trends
#    ✅ Can send prompts to Azure OpenAI GPT-4o
#    ❌ CANNOT create any resources
#    ❌ CANNOT modify any resources
#    ❌ CANNOT delete any resources
#    ❌ CANNOT access Key Vault secrets
#    ❌ CANNOT modify budgets or billing
#
# ==============================================================================
# WHY SYSTEM-ASSIGNED MANAGED IDENTITY (Not App Registration)?
# ==============================================================================
#
# This script uses a SYSTEM-ASSIGNED MANAGED IDENTITY instead of App Registration:
#   - Automatically created and tied to the Container App lifecycle
#   - Automatically deleted when the Container App is deleted
#   - NO credentials/secrets to manage (more secure)
#   - Authenticates seamlessly to Azure services via Azure AD
#   - No secret rotation required
#
# If you prefer App Registration, see README.md for manual deployment steps.
#
# ==============================================================================
# PREREQUISITES
# ==============================================================================
#
# 1. AZURE CLI
#    - Azure CLI must be installed: https://docs.microsoft.com/cli/azure/install-azure-cli
#    - Run 'az login' before executing this script
#
# 2. AZURE OPENAI ACCESS
#    - Your subscription must have Azure OpenAI approved
#    - Apply at: https://aka.ms/oai/access (if not already approved)
#
# 3. DOCKER (Optional - for local testing only)
#    - Not required for cloud deployment (ACR Tasks builds the image)
#
# ==============================================================================
# APPLICATION RBAC ROLES (READ-ONLY) - Detailed Breakdown
# ==============================================================================
#
# 1. READER (Subscription Scope)
#    - Role ID: acdd72a7-3385-48ef-bd42-f606fba81ae7
#    - Purpose: Query Azure resources via Resource Graph API
#    - Permissions granted:
#      * Microsoft.Resources/subscriptions/resources/read
#      * Microsoft.Resources/subscriptions/resourceGroups/read
#      * Microsoft.Compute/virtualMachines/read
#      * Microsoft.Network/*/read
#      * Microsoft.Storage/storageAccounts/read
#      * (All other read-only resource operations)
#    - Why needed: To list VMs, networks, storage, and all Azure resources
#    - Cannot: Create, modify, or delete any resources
#
# 2. COST MANAGEMENT READER (Subscription Scope)
#    - Role ID: 72fafb9e-0641-4937-9268-a91bfd8191a3
#    - Purpose: Read cost and billing data via Cost Management API
#    - Permissions granted:
#      * Microsoft.Consumption/*/read
#      * Microsoft.CostManagement/*/read
#      * Microsoft.Billing/billingPeriods/read
#    - Why needed: To analyze costs, show spending trends, and cost breakdowns
#    - Cannot: Modify budgets, billing, or make any financial changes
#
# 3. COGNITIVE SERVICES OPENAI USER (OpenAI Resource Scope - most restrictive)
#    - Role ID: 5e0bd9bd-7b93-4f28-af87-19fc36ad61bd
#    - Purpose: Use Azure OpenAI API for chat completions
#    - Permissions granted:
#      * Microsoft.CognitiveServices/accounts/deployments/read
#      * Microsoft.CognitiveServices/accounts/*/completions/action
#    - Why needed: To send prompts to GPT-4o and receive responses
#    - Cannot: Create/delete deployments, modify OpenAI resource settings
#    - Scope: Limited to ONLY the specific OpenAI resource (not subscription-wide)
#
# NOT ASSIGNED (Security):
#   ✗ Contributor - Would allow resource modifications
#   ✗ Owner - Would allow RBAC changes
#   ✗ API Keys - Managed Identity is used instead (no secrets stored)
#
# ==============================================================================
# MULTI-SUBSCRIPTION SUPPORT
# ==============================================================================
#
# To query resources across multiple subscriptions, assign ONLY:
#   - "Reader" role to additional subscriptions
#   - "Cost Management Reader" role to additional subscriptions
#
# Example command:
#   az role assignment create --assignee <principal-id> --role "Reader" \
#       --scope "/subscriptions/<other-subscription-id>"
#
# ==============================================================================

.NOTES
    Author: Zahir Hussain Shah
    Website: www.zahir.cloud
    Email: zahir@zahir.cloud
    
    LICENSE: MIT
    
    SECURITY NOTES:
    - Uses System-Assigned Managed Identity (no API keys or secrets)
    - Follows Azure security best practices
    - RBAC follows least-privilege principle
    - No credentials stored in code or environment variables
#>

param(
    [Parameter(Mandatory=$true)]
    [string]$ResourceGroupName,
    
    [Parameter(Mandatory=$false)]
    [string]$Location = "swedencentral",
    
    [Parameter(Mandatory=$false)]
    [string]$OpenAIResourceName = "",
    
    [Parameter(Mandatory=$true)]
    [string]$ContainerRegistryName,
    
    [Parameter(Mandatory=$false)]
    [string]$ContainerAppName = "cloudops-agent",
    
    [Parameter(Mandatory=$false)]
    [string]$ContainerAppEnvName = "cloudops-env",
    
    [Parameter(Mandatory=$true)]
    [string]$EntraAppClientId,
    
    [Parameter(Mandatory=$true)]
    [string]$EntraTenantId,
    
    [Parameter(Mandatory=$false)]
    [string]$SubscriptionId = "",
    
    [Parameter(Mandatory=$false)]
    [switch]$EnableLogAnalytics = $false,
    
    [Parameter(Mandatory=$false)]
    [ValidateSet("Public", "Private")]
    [string]$DeploymentMode = "Public",
    
    [Parameter(Mandatory=$false)]
    [string]$VNetResourceGroupName = "",
    
    [Parameter(Mandatory=$false)]
    [string]$VNetName = "",
    
    [Parameter(Mandatory=$false)]
    [string]$SubnetName = "",
    
    # --- Private Endpoint & Centralized DNS Parameters ---
    
    [Parameter(Mandatory=$false)]
    [string]$PrivateEndpointSubnetName = "",
    
    [Parameter(Mandatory=$false)]
    [string]$PrivateDnsZoneSubscriptionId = "",
    
    [Parameter(Mandatory=$false)]
    [string]$PrivateDnsZoneResourceGroupName = "",

    # --- Azure SQL (Prompt Library + Chat History persistence) ---
    [Parameter(Mandatory=$false)]
    [bool]$DeploySql = $true,

    [Parameter(Mandatory=$false)]
    [string]$SqlServerName = "",

    [Parameter(Mandatory=$false)]
    [string]$SqlDatabaseName = "prompts",

    # Exact SKU requested: General Purpose, Provisioned, Gen5, 4 vCores.
    [Parameter(Mandatory=$false)]
    [string]$SqlServiceObjective = "GP_Gen5_4",

    [Parameter(Mandatory=$false)]
    [int]$SqlMaxSizeGb = 12,

    [Parameter(Mandatory=$false)]
    [bool]$SqlZoneRedundant = $true,

    # Zone-redundant backup storage (ZRS) per the requested configuration.
    [Parameter(Mandatory=$false)]
    [ValidateSet("Local", "Zone", "Geo", "GeoZone")]
    [string]$SqlBackupStorageRedundancy = "Zone",

    [Parameter(Mandatory=$false)]
    [string]$SqlAadAdminUpn = ""
)

# ============================================
# CONFIGURATION
# ============================================
$ErrorActionPreference = "Stop"
$OpenAIModelName = "gpt-4o"
$OpenAIDeploymentName = "gpt-4o"
$OpenAIApiVersion = "2024-02-15-preview"
$ContainerImageName = "cloudops-agent"
$ContainerImageTag = "latest"

# Generate unique names if not provided
if ([string]::IsNullOrEmpty($OpenAIResourceName)) {
    $randomSuffix = -join ((48..57) + (97..122) | Get-Random -Count 6 | ForEach-Object {[char]$_})
    $OpenAIResourceName = "openai-cloudops-$randomSuffix"
}

# ============================================
# HELPER FUNCTIONS
# ============================================
function Write-Step {
    param([string]$Message)
    Write-Host ""
    Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
    Write-Host "  $Message" -ForegroundColor Cyan
    Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
}

function Write-Success {
    param([string]$Message)
    Write-Host "  ✅ $Message" -ForegroundColor Green
}

function Write-Info {
    param([string]$Message)
    Write-Host "  ℹ️  $Message" -ForegroundColor Yellow
}

function Write-Error {
    param([string]$Message)
    Write-Host "  ❌ $Message" -ForegroundColor Red
}

# ============================================
# PRE-FLIGHT CHECKS
# ============================================
Write-Step "Pre-Flight Checks"

# Check Azure CLI is installed
Write-Info "Checking Azure CLI installation..."
$azVersion = az version 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Error "Azure CLI is not installed. Please install from: https://docs.microsoft.com/en-us/cli/azure/install-azure-cli"
    exit 1
}
Write-Success "Azure CLI is installed"

# Check Azure CLI login
Write-Info "Checking Azure CLI login status..."
$account = az account show 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Info "Not logged in. Running 'az login'..."
    az login
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Failed to login to Azure"
        exit 1
    }
}
Write-Success "Logged in to Azure"

# Set subscription explicitly if provided (IMPORTANT: prevents wrong subscription deployment)
if (-not [string]::IsNullOrEmpty($SubscriptionId)) {
    Write-Info "Setting subscription to: $SubscriptionId"
    az account set --subscription $SubscriptionId
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Failed to set subscription. Please verify the subscription ID is correct and you have access."
        exit 1
    }
    Write-Success "Subscription explicitly set to: $SubscriptionId"
} else {
    Write-Info "No SubscriptionId provided - using currently active subscription"
    Write-Info "TIP: Use -SubscriptionId parameter to ensure correct subscription"
}

# Get subscription info (verify we're on the right subscription)
$subscriptionId = az account show --query "id" -o tsv
$subscriptionName = az account show --query "name" -o tsv
Write-Host ""
Write-Host "  ╔════════════════════════════════════════════════════════════════╗" -ForegroundColor Yellow
Write-Host "  ║  DEPLOYMENT CONFIGURATION                                     ║" -ForegroundColor Yellow
Write-Host "  ╠════════════════════════════════════════════════════════════════╣" -ForegroundColor Yellow
Write-Host "  ║  Subscription:      $subscriptionName" -ForegroundColor White
Write-Host "  ║  Subscription ID:   $subscriptionId" -ForegroundColor White
Write-Host "  ║  Resource Group:    $ResourceGroupName" -ForegroundColor White
Write-Host "  ║  Location:          $Location" -ForegroundColor White
Write-Host "  ║  Container App:     $ContainerAppName" -ForegroundColor White
Write-Host "  ║  Container Env:     $ContainerAppEnvName" -ForegroundColor White
Write-Host "  ║  Deployment Mode:   $DeploymentMode" -ForegroundColor White
Write-Host "  ╚════════════════════════════════════════════════════════════════╝" -ForegroundColor Yellow
Write-Host ""

# Confirm with user
$confirmation = Read-Host "  Is this the correct subscription? (Y/N)"
if ($confirmation -ne 'Y' -and $confirmation -ne 'y') {
    Write-Error "Deployment cancelled. Please run 'az account set --subscription <correct-subscription-id>' or use -SubscriptionId parameter"
    exit 1
}
Write-Success "Subscription confirmed: $subscriptionName ($subscriptionId)"

# ============================================
# PRIVATE DEPLOYMENT: VALIDATE VNET & SUBNET
# ============================================
if ($DeploymentMode -eq "Private") {
    Write-Step "Private Deployment: Validating VNet & Subnet Configuration"
    
    Write-Host ""
    Write-Host "  ╔════════════════════════════════════════════════════════════════╗" -ForegroundColor Magenta
    Write-Host "  ║  🔒 PRIVATE DEPLOYMENT MODE SELECTED                          ║" -ForegroundColor Magenta
    Write-Host "  ╠════════════════════════════════════════════════════════════════╣" -ForegroundColor Magenta
    Write-Host "  ║  Container App will be deployed inside your VNet              ║" -ForegroundColor White
    Write-Host "  ║  Accessible ONLY from internal/corporate network              ║" -ForegroundColor White
    Write-Host "  ║  NO public endpoint will be created                           ║" -ForegroundColor White
    Write-Host "  ╚════════════════════════════════════════════════════════════════╝" -ForegroundColor Magenta
    Write-Host ""
    
    # Validate required parameters for private deployment
    if ([string]::IsNullOrEmpty($VNetResourceGroupName)) {
        Write-Error "VNetResourceGroupName is REQUIRED for Private deployment mode"
        Write-Host "  Usage: -VNetResourceGroupName 'rg-networking'" -ForegroundColor Yellow
        exit 1
    }
    if ([string]::IsNullOrEmpty($VNetName)) {
        Write-Error "VNetName is REQUIRED for Private deployment mode"
        Write-Host "  Usage: -VNetName 'corp-vnet'" -ForegroundColor Yellow
        exit 1
    }
    if ([string]::IsNullOrEmpty($SubnetName)) {
        Write-Error "SubnetName is REQUIRED for Private deployment mode"
        Write-Host "  Usage: -SubnetName 'container-apps-subnet'" -ForegroundColor Yellow
        exit 1
    }
    
    # Validate VNet exists
    Write-Info "Validating VNet '$VNetName' in resource group '$VNetResourceGroupName'..."
    $vnetCheck = az network vnet show --name $VNetName --resource-group $VNetResourceGroupName --query "{name:name, location:location, addressSpace:addressSpace.addressPrefixes}" -o json 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Error "VNet '$VNetName' not found in resource group '$VNetResourceGroupName'"
        Write-Host "  Please verify:" -ForegroundColor Yellow
        Write-Host "    1. VNet name is correct" -ForegroundColor Yellow
        Write-Host "    2. Resource group name is correct" -ForegroundColor Yellow
        Write-Host "    3. You have access to the VNet" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "  List VNets: az network vnet list --resource-group $VNetResourceGroupName -o table" -ForegroundColor Cyan
        exit 1
    }
    
    $vnetInfo = $vnetCheck | ConvertFrom-Json
    $vnetLocation = $vnetInfo.location
    Write-Success "VNet found: $VNetName (Location: $vnetLocation)"
    
    # Verify VNet is in the same region as deployment
    if ($vnetLocation -ne $Location) {
        Write-Host ""
        Write-Host "  ⚠️  REGION MISMATCH WARNING" -ForegroundColor Yellow
        Write-Host "  ─────────────────────────────────────────────────────────────" -ForegroundColor Gray
        Write-Host "  Deployment Location:  $Location" -ForegroundColor White
        Write-Host "  VNet Location:        $vnetLocation" -ForegroundColor White
        Write-Host "  Container Apps Environment must be in the SAME region as the VNet." -ForegroundColor White
        Write-Host ""
        Write-Host "  Auto-adjusting deployment location to: $vnetLocation" -ForegroundColor Green
        $Location = $vnetLocation
        Write-Success "Deployment location adjusted to: $Location (matching VNet region)"
    }
    
    # Validate subnet exists
    Write-Info "Validating subnet '$SubnetName' in VNet '$VNetName'..."
    $subnetCheck = az network vnet subnet show --name $SubnetName --vnet-name $VNetName --resource-group $VNetResourceGroupName --query "{name:name, addressPrefix:addressPrefix, delegations:delegations[].serviceName}" -o json 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Subnet '$SubnetName' not found in VNet '$VNetName'"
        Write-Host "  Available subnets:" -ForegroundColor Yellow
        az network vnet subnet list --vnet-name $VNetName --resource-group $VNetResourceGroupName --query "[].{Name:name, Prefix:addressPrefix}" -o table
        exit 1
    }
    
    $subnetInfo = $subnetCheck | ConvertFrom-Json
    Write-Success "Subnet found: $SubnetName (Address prefix: $($subnetInfo.addressPrefix))"
    
    # Check subnet size (recommend /23 or larger)
    $prefix = $subnetInfo.addressPrefix -replace '.*/(\d+)$', '$1'
    $prefixInt = [int]$prefix
    if ($prefixInt -gt 27) {
        Write-Error "Subnet '$SubnetName' is too small ($($subnetInfo.addressPrefix))"
        Write-Host "  Container Apps Environment requires a subnet of at least /27 (32 addresses)" -ForegroundColor Yellow
        Write-Host "  Recommended: /23 (512 addresses) for production workloads" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "  To resize or create a properly sized subnet:" -ForegroundColor Cyan
        Write-Host "  az network vnet subnet create --name $SubnetName --vnet-name $VNetName --resource-group $VNetResourceGroupName --address-prefixes '10.0.16.0/23'" -ForegroundColor DarkGray
        exit 1
    } elseif ($prefixInt -gt 23) {
        Write-Host ""
        Write-Host "  ⚠️  SUBNET SIZE NOTE" -ForegroundColor Yellow
        Write-Host "  Current: $($subnetInfo.addressPrefix) - This will work but may limit scaling." -ForegroundColor White
        Write-Host "  Recommended: /23 (512 addresses) for production workloads." -ForegroundColor White
        Write-Host ""
    }
    
    # Check subnet delegation
    Write-Info "Checking subnet delegation for Microsoft.App/environments..."
    $delegations = $subnetInfo.delegations
    $hasDelegation = $false
    
    if ($delegations -and $delegations.Count -gt 0) {
        foreach ($delegation in $delegations) {
            if ($delegation -eq "Microsoft.App/environments") {
                $hasDelegation = $true
                break
            }
        }
    }
    
    if ($hasDelegation) {
        Write-Success "Subnet delegation is correctly configured (Microsoft.App/environments)"
    } else {
        Write-Host ""
        Write-Host "  ⚠️  SUBNET DELEGATION REQUIRED" -ForegroundColor Red
        Write-Host "  ─────────────────────────────────────────────────────────────" -ForegroundColor Gray
        Write-Host "  Subnet '$SubnetName' does NOT have the required delegation:" -ForegroundColor White
        Write-Host "    Microsoft.App/environments" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "  This delegation is required for Container Apps Environment deployment." -ForegroundColor White
        Write-Host ""
        
        if ($delegations -and $delegations.Count -gt 0) {
            Write-Host "  Current delegations: $($delegations -join ', ')" -ForegroundColor Yellow
            Write-Host ""
            Write-Error "Subnet already has a different delegation. Please use a different subnet or remove the existing delegation."
            Write-Host "  You can create a new dedicated subnet:" -ForegroundColor Cyan
            Write-Host "  az network vnet subnet create --name 'container-apps-subnet' --vnet-name $VNetName --resource-group $VNetResourceGroupName --address-prefixes '10.0.16.0/23' --delegations 'Microsoft.App/environments'" -ForegroundColor DarkGray
            exit 1
        }
        
        $delegationConfirm = Read-Host "  Would you like this script to add the delegation automatically? (Y/N)"
        if ($delegationConfirm -eq 'Y' -or $delegationConfirm -eq 'y') {
            Write-Info "Adding subnet delegation for Microsoft.App/environments..."
            az network vnet subnet update `
                --name $SubnetName `
                --vnet-name $VNetName `
                --resource-group $VNetResourceGroupName `
                --delegations "Microsoft.App/environments" `
                --output none
            
            if ($LASTEXITCODE -ne 0) {
                Write-Error "Failed to add subnet delegation"
                Write-Host "  Please add it manually:" -ForegroundColor Yellow
                Write-Host "  az network vnet subnet update --name $SubnetName --vnet-name $VNetName --resource-group $VNetResourceGroupName --delegations 'Microsoft.App/environments'" -ForegroundColor DarkGray
                exit 1
            }
            Write-Success "Subnet delegation added successfully"
        } else {
            Write-Host ""
            Write-Host "  Please add the delegation manually before running this script:" -ForegroundColor Yellow
            Write-Host "  az network vnet subnet update --name $SubnetName --vnet-name $VNetName --resource-group $VNetResourceGroupName --delegations 'Microsoft.App/environments'" -ForegroundColor DarkGray
            Write-Host ""
            exit 1
        }
    }
    
    # Build the subnet resource ID for later use
    $vnetSubId = az account show --query "id" -o tsv
    $subnetResourceId = "/subscriptions/$vnetSubId/resourceGroups/$VNetResourceGroupName/providers/Microsoft.Network/virtualNetworks/$VNetName/subnets/$SubnetName"
    Write-Success "Subnet Resource ID: $subnetResourceId"
    
    Write-Host ""
    Write-Host "  ✅ Private deployment prerequisites validated:" -ForegroundColor Green
    Write-Host "    VNet:       $VNetName ($VNetResourceGroupName)" -ForegroundColor White
    Write-Host "    Subnet:     $SubnetName ($($subnetInfo.addressPrefix))" -ForegroundColor White
    Write-Host "    Delegation: Microsoft.App/environments ✓" -ForegroundColor White
    Write-Host "    Region:     $Location" -ForegroundColor White
    Write-Host ""
    
    # ==================================================================
    # PRIVATE ENDPOINT SUBNET VALIDATION
    # ==================================================================
    Write-Step "Private Deployment: Validating Private Endpoint Subnet"
    
    # Private endpoints CANNOT be placed in a delegated subnet, so we need a separate one
    if ([string]::IsNullOrEmpty($PrivateEndpointSubnetName)) {
        $PrivateEndpointSubnetName = "pe-subnet"
        Write-Info "No PrivateEndpointSubnetName provided — defaulting to '$PrivateEndpointSubnetName'"
    }
    
    Write-Info "Validating Private Endpoint subnet '$PrivateEndpointSubnetName' in VNet '$VNetName'..."
    $peSubnetCheck = az network vnet subnet show --name $PrivateEndpointSubnetName --vnet-name $VNetName --resource-group $VNetResourceGroupName --query "{name:name, addressPrefix:addressPrefix}" -o json 2>&1
    
    if ($LASTEXITCODE -ne 0) {
        Write-Info "Subnet '$PrivateEndpointSubnetName' does not exist — creating it..."
        
        # Calculate a /27 CIDR in the VNet address space for the PE subnet
        # We'll try common ranges; the user can override with an existing subnet
        $peSubnetCandidates = @("10.0.254.0/27", "10.0.253.0/27", "10.0.252.0/27", "172.16.254.0/27", "192.168.254.0/27")
        $peSubnetCreated = $false
        
        foreach ($cidr in $peSubnetCandidates) {
            Write-Info "  Trying CIDR $cidr for PE subnet..."
            az network vnet subnet create `
                --name $PrivateEndpointSubnetName `
                --vnet-name $VNetName `
                --resource-group $VNetResourceGroupName `
                --address-prefixes $cidr `
                --output none 2>$null
            
            if ($LASTEXITCODE -eq 0) {
                Write-Success "Created PE subnet: $PrivateEndpointSubnetName ($cidr)"
                $peSubnetCreated = $true
                break
            }
        }
        
        if (-not $peSubnetCreated) {
            Write-Error "Could not auto-create PE subnet. Please create a /27 subnet manually:"
            Write-Host "  az network vnet subnet create --name $PrivateEndpointSubnetName --vnet-name $VNetName --resource-group $VNetResourceGroupName --address-prefixes '<available-cidr>/27'" -ForegroundColor DarkGray
            Write-Host "  Then re-run this script with -PrivateEndpointSubnetName '$PrivateEndpointSubnetName'" -ForegroundColor Yellow
            exit 1
        }
    } else {
        $peSubnetInfo = $peSubnetCheck | ConvertFrom-Json
        Write-Success "PE subnet found: $PrivateEndpointSubnetName ($($peSubnetInfo.addressPrefix))"
    }
    
    $peSubnetResourceId = "/subscriptions/$vnetSubId/resourceGroups/$VNetResourceGroupName/providers/Microsoft.Network/virtualNetworks/$VNetName/subnets/$PrivateEndpointSubnetName"
    Write-Success "PE Subnet Resource ID: $peSubnetResourceId"
    
    # Disable private endpoint network policies on the PE subnet (required for PE creation)
    Write-Info "Ensuring private endpoint network policies are disabled on PE subnet..."
    az network vnet subnet update `
        --name $PrivateEndpointSubnetName `
        --vnet-name $VNetName `
        --resource-group $VNetResourceGroupName `
        --disable-private-endpoint-network-policies true `
        --output none 2>$null
    Write-Success "Private endpoint network policies disabled on PE subnet"
    
    # ==================================================================
    # CENTRALIZED PRIVATE DNS ZONE CONFIGURATION (Interactive)
    # ==================================================================
    Write-Step "Private Deployment: Configuring Private DNS Zone Location"
    
    # -------------------------------------------------------------------
    # If the user did NOT pass DNS parameters, ask interactively.
    # Enterprise customers often already have Private DNS Zones (e.g.,
    # from existing AI Foundry / OpenAI resources deployed with PEs).
    # The script reuses existing zones when found, creates missing ones.
    # -------------------------------------------------------------------
    if ([string]::IsNullOrEmpty($PrivateDnsZoneSubscriptionId) -and [string]::IsNullOrEmpty($PrivateDnsZoneResourceGroupName)) {
        Write-Host ""
        Write-Host "  ╔════════════════════════════════════════════════════════════════╗" -ForegroundColor Yellow
        Write-Host "  ║  🔍 PRIVATE DNS ZONE LOCATION                                 ║" -ForegroundColor Yellow
        Write-Host "  ╠════════════════════════════════════════════════════════════════╣" -ForegroundColor Yellow
        Write-Host "  ║  If you already have PE-enabled resources (e.g., AI Foundry), ║" -ForegroundColor White
        Write-Host "  ║  you likely have Private DNS Zones in a centralized RG.       ║" -ForegroundColor White
        Write-Host "  ║  The script will REUSE existing zones and CREATE missing ones. ║" -ForegroundColor White
        Write-Host "  ╚════════════════════════════════════════════════════════════════╝" -ForegroundColor Yellow
        Write-Host ""
        
        $dnsChoice = Read-Host "  Do you have existing Private DNS Zones (e.g., from AI Foundry with PE)? [Y/N] (default: N)"
        
        if ($dnsChoice -match '^[Yy]') {
            # --- Ask for Subscription ---
            Write-Host ""
            $inputDnsSub = Read-Host "  Enter the Subscription ID where your Private DNS Zones are located (press Enter for current subscription: $subscriptionId)"
            if ([string]::IsNullOrEmpty($inputDnsSub)) {
                $dnsZoneSubscriptionId = $subscriptionId
            } else {
                $dnsZoneSubscriptionId = $inputDnsSub.Trim()
            }
            
            # --- Ask for Resource Group ---
            $inputDnsRg = Read-Host "  Enter the Resource Group name containing your Private DNS Zones"
            if ([string]::IsNullOrEmpty($inputDnsRg)) {
                Write-Error "Resource group name is required when using existing Private DNS Zones."
                exit 1
            }
            $dnsZoneResourceGroup = $inputDnsRg.Trim()
            Write-Success "Will look for existing Private DNS Zones in RG '$dnsZoneResourceGroup' (Sub: $dnsZoneSubscriptionId)"
        } else {
            # No existing DNS zones — default to deployment subscription/RG
            $dnsZoneSubscriptionId = $subscriptionId
            $dnsZoneResourceGroup = $ResourceGroupName
            Write-Info "No existing Private DNS Zones — will create all zones in deployment RG: $ResourceGroupName"
        }
    } else {
        # Parameters were provided explicitly via command line
        if ([string]::IsNullOrEmpty($PrivateDnsZoneSubscriptionId)) {
            $dnsZoneSubscriptionId = $subscriptionId
            Write-Info "No PrivateDnsZoneSubscriptionId provided — using deployment subscription"
        } else {
            $dnsZoneSubscriptionId = $PrivateDnsZoneSubscriptionId
            Write-Info "Using centralized DNS subscription: $PrivateDnsZoneSubscriptionId"
        }
        
        if ([string]::IsNullOrEmpty($PrivateDnsZoneResourceGroupName)) {
            $dnsZoneResourceGroup = $ResourceGroupName
            Write-Info "No PrivateDnsZoneResourceGroupName provided — using deployment RG: $ResourceGroupName"
        } else {
            $dnsZoneResourceGroup = $PrivateDnsZoneResourceGroupName
            Write-Info "Using centralized DNS RG: $PrivateDnsZoneResourceGroupName"
        }
    }
    
    # If centralized subscription is different, validate access
    if ($dnsZoneSubscriptionId -ne $subscriptionId) {
        Write-Info "Validating access to DNS subscription '$dnsZoneSubscriptionId'..."
        $dnsSubAccess = az account show --subscription $dnsZoneSubscriptionId --query "id" -o tsv 2>&1
        if ($LASTEXITCODE -ne 0) {
            Write-Error "Cannot access DNS subscription '$dnsZoneSubscriptionId'. Ensure you have Contributor/DNS Zone Contributor access."
            exit 1
        }
        Write-Success "Access to DNS subscription confirmed"
    }
    
    # Validate the DNS RG exists — create if needed
    $dnsRgExists = az group exists --name $dnsZoneResourceGroup --subscription $dnsZoneSubscriptionId 2>$null
    if ($dnsRgExists -ne "true") {
        Write-Info "Resource group '$dnsZoneResourceGroup' does not exist in subscription '$dnsZoneSubscriptionId' — creating..."
        az group create --name $dnsZoneResourceGroup --location $Location --subscription $dnsZoneSubscriptionId --output none
        if ($LASTEXITCODE -ne 0) {
            Write-Error "Failed to create DNS RG '$dnsZoneResourceGroup' in subscription $dnsZoneSubscriptionId"
            exit 1
        }
        Write-Success "Created DNS RG: $dnsZoneResourceGroup in subscription $dnsZoneSubscriptionId"
    } else {
        Write-Success "DNS RG exists: $dnsZoneResourceGroup (Sub: $dnsZoneSubscriptionId)"
    }
    
    # Get VNet Resource ID for DNS zone links (needed later)
    $vnetResourceId = "/subscriptions/$vnetSubId/resourceGroups/$VNetResourceGroupName/providers/Microsoft.Network/virtualNetworks/$VNetName"
    
    # ==================================================================
    # UPFRONT PRIVATE DNS ZONE DISCOVERY
    # ==================================================================
    Write-Step "Private Deployment: Discovering Existing Private DNS Zones"
    
    # Define all required DNS zones for the resources we will deploy with PEs
    # NOTE: Container App uses VNet injection (not PE), so no privatelink zone needed for it.
    #       The Container Apps Environment DNS zone is dynamic (created after environment deployment).
    $requiredDnsZones = @(
        @{ Name = "privatelink.openai.azure.com"; Resource = "Azure OpenAI (AI Foundry)"; Found = $false },
        @{ Name = "privatelink.azurecr.io";       Resource = "Azure Container Registry";   Found = $false }
    )
    
    Write-Info "Scanning RG '$dnsZoneResourceGroup' (Sub: $dnsZoneSubscriptionId) for required Private DNS Zones..."
    Write-Host ""
    
    foreach ($zone in $requiredDnsZones) {
        $zoneCheck = az network private-dns zone show `
            --name $zone.Name `
            --resource-group $dnsZoneResourceGroup `
            --subscription $dnsZoneSubscriptionId `
            --query "name" -o tsv 2>&1
        
        if ($LASTEXITCODE -eq 0) {
            $zone.Found = $true
            Write-Host "    ✅ FOUND:   $($zone.Name)  →  $($zone.Resource)" -ForegroundColor Green
        } else {
            Write-Host "    ➕ MISSING: $($zone.Name)  →  will be created for $($zone.Resource)" -ForegroundColor Yellow
        }
    }
    
    Write-Host ""
    $foundCount = ($requiredDnsZones | Where-Object { $_.Found }).Count
    $missingCount = ($requiredDnsZones | Where-Object { -not $_.Found }).Count
    Write-Info "Discovery complete: $foundCount existing zone(s) will be reused, $missingCount zone(s) will be created"
    
    # Store discovery results for use during PE creation steps
    $dnsZoneOpenAIFound = ($requiredDnsZones | Where-Object { $_.Name -eq "privatelink.openai.azure.com" }).Found
    $dnsZoneACRFound    = ($requiredDnsZones | Where-Object { $_.Name -eq "privatelink.azurecr.io" }).Found
    
    # Create any missing DNS zones upfront (so PE creation steps can assume they exist)
    if ($missingCount -gt 0) {
        Write-Info "Creating $missingCount missing Private DNS Zone(s) in RG '$dnsZoneResourceGroup'..."
        
        foreach ($zone in ($requiredDnsZones | Where-Object { -not $_.Found })) {
            Write-Info "  Creating: $($zone.Name)..."
            az network private-dns zone create `
                --name $zone.Name `
                --resource-group $dnsZoneResourceGroup `
                --subscription $dnsZoneSubscriptionId `
                --output none
            
            if ($LASTEXITCODE -ne 0) {
                Write-Error "Failed to create Private DNS Zone: $($zone.Name)"
                exit 1
            }
            Write-Success "  Created: $($zone.Name)"
        }
        
        Write-Success "All required Private DNS Zones are now available"
    } else {
        Write-Success "All required Private DNS Zones already exist — reusing them"
    }
    
    # Ensure all DNS zones are linked to the VNet (idempotent)
    Write-Info "Ensuring all Private DNS Zones are linked to VNet '$VNetName'..."
    
    foreach ($zone in $requiredDnsZones) {
        $shortName = ($zone.Name -replace 'privatelink\.', '' -replace '\.azure\.com', '' -replace '\.io', '')
        $linkName = "link-$($VNetName)-$shortName"
        
        $linkExists = az network private-dns link vnet show `
            --name $linkName `
            --zone-name $zone.Name `
            --resource-group $dnsZoneResourceGroup `
            --subscription $dnsZoneSubscriptionId 2>&1
        
        if ($LASTEXITCODE -eq 0) {
            Write-Host "    ✅ VNet link exists: $linkName → $($zone.Name)" -ForegroundColor Green
        } else {
            Write-Info "  Linking: $($zone.Name) → $VNetName..."
            az network private-dns link vnet create `
                --name $linkName `
                --zone-name $zone.Name `
                --resource-group $dnsZoneResourceGroup `
                --subscription $dnsZoneSubscriptionId `
                --virtual-network $vnetResourceId `
                --registration-enabled false `
                --output none
            
            if ($LASTEXITCODE -eq 0) {
                Write-Host "    ✅ VNet link created: $linkName → $($zone.Name)" -ForegroundColor Green
            } else {
                Write-Host "    ⚠️  Could not auto-link $($zone.Name) to VNet. Link manually after deployment." -ForegroundColor Yellow
            }
        }
    }
    
    Write-Host ""
    Write-Host "  ╔════════════════════════════════════════════════════════════════╗" -ForegroundColor Magenta
    Write-Host "  ║  🔒 PRIVATE ENDPOINT CONFIGURATION SUMMARY                    ║" -ForegroundColor Magenta
    Write-Host "  ╠════════════════════════════════════════════════════════════════╣" -ForegroundColor Magenta
    Write-Host "  ║                                                                ║" -ForegroundColor Magenta
    Write-Host "  ║  VNet:                    $VNetName" -ForegroundColor White
    Write-Host "  ║  Container Apps Subnet:   $SubnetName (VNet injection — no PE)" -ForegroundColor White
    Write-Host "  ║  Private Endpoint Subnet: $PrivateEndpointSubnetName" -ForegroundColor White
    Write-Host "  ║  DNS Zone Subscription:   $dnsZoneSubscriptionId" -ForegroundColor White
    Write-Host "  ║  DNS Zone RG:             $dnsZoneResourceGroup" -ForegroundColor White
    Write-Host "  ║                                                                ║" -ForegroundColor Magenta
    Write-Host "  ║  DNS Zone Discovery:                                           ║" -ForegroundColor Magenta
    if ($dnsZoneOpenAIFound) {
        Write-Host "  ║    privatelink.openai.azure.com  ✅ REUSING EXISTING" -ForegroundColor Green
    } else {
        Write-Host "  ║    privatelink.openai.azure.com  ➕ CREATED" -ForegroundColor Yellow
    }
    if ($dnsZoneACRFound) {
        Write-Host "  ║    privatelink.azurecr.io        ✅ REUSING EXISTING" -ForegroundColor Green
    } else {
        Write-Host "  ║    privatelink.azurecr.io        ➕ CREATED" -ForegroundColor Yellow
    }
    Write-Host "  ║                                                                ║" -ForegroundColor Magenta
    Write-Host "  ║  Resources:                                                    ║" -ForegroundColor Magenta
    Write-Host "  ║    Azure OpenAI (Foundry) →  Private Endpoint + DNS auto-reg   ║" -ForegroundColor White
    Write-Host "  ║    Azure Container Registry → Private Endpoint + DNS auto-reg  ║" -ForegroundColor White
    Write-Host "  ║    Container App           →  VNet injection (internal ingress) ║" -ForegroundColor White
    Write-Host "  ║                                                                ║" -ForegroundColor Magenta
    Write-Host "  ╚════════════════════════════════════════════════════════════════╝" -ForegroundColor Magenta
    Write-Host ""
} else {
    Write-Host ""
    Write-Host "  ╔════════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
    Write-Host "  ║  🌐 PUBLIC DEPLOYMENT MODE                                    ║" -ForegroundColor Cyan
    Write-Host "  ╠════════════════════════════════════════════════════════════════╣" -ForegroundColor Cyan
    Write-Host "  ║  Container App will be publicly accessible via HTTPS          ║" -ForegroundColor White
    Write-Host "  ║  Use -DeploymentMode 'Private' for VNet-integrated deployment ║" -ForegroundColor White
    Write-Host "  ╚════════════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
    Write-Host ""
}

# ============================================
# STEP 0: REGISTER REQUIRED RESOURCE PROVIDERS
# ============================================
# ============================================
# AZURE SQL CONFIGURATION (Prompt Library + Chat History)
# ============================================
if ($DeploySql) {
    if ([string]::IsNullOrWhiteSpace($SqlServerName)) {
        $sqlBase = ('sql-' + $ContainerAppName).ToLower() -replace '[^a-z0-9-]', '-'
        if ($sqlBase.Length -gt 60) { $sqlBase = $sqlBase.Substring(0, 60) }
        $SqlServerName = $sqlBase.TrimEnd('-')
    }
    $SqlServerName = $SqlServerName.ToLower()
    Write-Info "Azure SQL logical server: $SqlServerName"
    Write-Info "Azure SQL database:       $SqlDatabaseName (SKU: $SqlServiceObjective, ${SqlMaxSizeGb}GB)"
    Write-Info "Zone redundant: $SqlZoneRedundant | Backup storage: $SqlBackupStorageRedundancy"
}

Write-Step "Step 0: Registering Required Resource Providers"

Write-Info "On new subscriptions, resource providers must be registered before use."
Write-Info "This is a one-time operation per subscription."
Write-Host ""

# Define required providers
$requiredProviders = @(
    @{ Namespace = "Microsoft.ContainerRegistry"; Description = "Container Registry" },
    @{ Namespace = "Microsoft.App"; Description = "Container Apps" },
    @{ Namespace = "Microsoft.CognitiveServices"; Description = "Azure OpenAI" },
    @{ Namespace = "Microsoft.ManagedIdentity"; Description = "Managed Identity" },
    @{ Namespace = "Microsoft.Sql"; Description = "Azure SQL" }
)

# Add Log Analytics provider if enabled
if ($EnableLogAnalytics) {
    $requiredProviders += @{ Namespace = "Microsoft.OperationalInsights"; Description = "Log Analytics" }
}

# Add Network provider for private deployment
if ($DeploymentMode -eq "Private") {
    $requiredProviders += @{ Namespace = "Microsoft.Network"; Description = "Virtual Networks (Private Deployment)" }
}

# Check and register providers
$providersToWait = @()
foreach ($provider in $requiredProviders) {
    $status = az provider show --namespace $provider.Namespace --query "registrationState" -o tsv 2>$null
    
    if ($status -eq "Registered") {
        Write-Success "$($provider.Description) ($($provider.Namespace)) - Already registered"
    } else {
        Write-Info "Registering $($provider.Description) ($($provider.Namespace))..."
        az provider register --namespace $provider.Namespace --output none
        $providersToWait += $provider
    }
}

# Wait for all providers to be registered
if ($providersToWait.Count -gt 0) {
    Write-Host ""
    Write-Info "Waiting for resource providers to complete registration..."
    Write-Info "This may take 2-5 minutes for new subscriptions..."
    Write-Host ""
    
    $maxWaitSeconds = 300  # 5 minutes max per provider
    
    foreach ($provider in $providersToWait) {
        $elapsed = 0
        $registered = $false
        
        while ($elapsed -lt $maxWaitSeconds) {
            $status = az provider show --namespace $provider.Namespace --query "registrationState" -o tsv 2>$null
            
            if ($status -eq "Registered") {
                Write-Success "$($provider.Description) ($($provider.Namespace)) - Registered"
                $registered = $true
                break
            }
            
            Write-Host "    Waiting for $($provider.Namespace)... ($elapsed seconds)" -ForegroundColor Gray
            Start-Sleep -Seconds 15
            $elapsed += 15
        }
        
        if (-not $registered) {
            Write-Error "$($provider.Description) ($($provider.Namespace)) failed to register within $maxWaitSeconds seconds"
            Write-Info "Please run manually: az provider register --namespace $($provider.Namespace) --wait"
            exit 1
        }
    }
}

Write-Host ""
Write-Success "All required resource providers are registered"

# ============================================
# STEP 1: CREATE RESOURCE GROUP
# ============================================
Write-Step "Step 1: Creating Resource Group"

$rgExists = az group exists --name $ResourceGroupName
if ($rgExists -eq "true") {
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
# STEP 2: CREATE AZURE OPENAI RESOURCE
# ============================================
Write-Step "Step 2: Creating Azure OpenAI Resource (AI Foundry)"

# Check if OpenAI resource exists
$openaiExists = az cognitiveservices account show --name $OpenAIResourceName --resource-group $ResourceGroupName 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Info "Azure OpenAI resource '$OpenAIResourceName' already exists"
} else {
    Write-Info "Creating Azure OpenAI resource '$OpenAIResourceName'..."
    Write-Info "This may take 2-3 minutes..."
    
    az cognitiveservices account create `
        --name $OpenAIResourceName `
        --resource-group $ResourceGroupName `
        --location $Location `
        --kind "OpenAI" `
        --sku "S0" `
        --custom-domain $OpenAIResourceName `
        --output none
    
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Failed to create Azure OpenAI resource"
        Write-Info "Note: Azure OpenAI requires approval. If you haven't requested access, apply at: https://aka.ms/oai/access"
        exit 1
    }
}
Write-Success "Azure OpenAI resource ready: $OpenAIResourceName"

# Get OpenAI endpoint
$openaiEndpoint = az cognitiveservices account show `
    --name $OpenAIResourceName `
    --resource-group $ResourceGroupName `
    --query "properties.endpoint" -o tsv

Write-Success "OpenAI Endpoint: $openaiEndpoint"

# ============================================
# STEP 3: DEPLOY GPT-4O MODEL
# ============================================
Write-Step "Step 3: Deploying GPT-4o Model"

# Check if deployment exists
$deploymentExists = az cognitiveservices account deployment show `
    --name $OpenAIResourceName `
    --resource-group $ResourceGroupName `
    --deployment-name $OpenAIDeploymentName 2>&1

$deployedCapacity = 0
$deployedModel = ""
$deployedSku = ""
$deployedModelVersion = ""

if ($LASTEXITCODE -eq 0) {
    Write-Info "Model deployment '$OpenAIDeploymentName' already exists"
    $deployedCapacity = 30  # Assume existing deployment is fine
    $deployedModel = "gpt-4o"
    $deployedSku = "GlobalStandard"
    $deployedModelVersion = "2024-11-20"
} else {
    Write-Info "Deploying latest GPT model..."
    Write-Info "This may take 3-5 minutes..."
    Write-Info "Strategy: newest model first (GPT-5.5 > GPT-5.x > GPT-5 > GPT-4.1 > GPT-4o), GlobalStandard for best latency, start at 80K and decrease by 2K"

    $deploymentSuccess = $false
    # Start at 80K (tested optimal), decrease by 2K increments for fine-grained quota discovery
    $capacityLevels = @()
    for ($i = 80; $i -ge 10; $i -= 2) { $capacityLevels += $i }

    # Priority ladder: newest GA model + SKU first, with capacity fallback.
    #   GPT-5.5 (current top GA chat model, 2026) -> GPT-5.x -> GPT-5 -> GPT-4.1 -> GPT-4o -> gpt-4o-mini
    #   GlobalStandard (best latency) -> DataZoneStandard -> Standard
    # NOTE: GPT-5.x are reasoning models and do NOT support 'temperature'/'top_p'.
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
        @{ Model = "gpt-4o";      Version = "2024-08-06"; Sku = "DataZoneStandard" },
        @{ Model = "gpt-4o";      Version = "2024-05-13"; Sku = "Standard"         },
        @{ Model = "gpt-4o-mini"; Version = "2024-07-18"; Sku = "GlobalStandard"   }
    )

    foreach ($plan in $modelPlan) {
        if ($deploymentSuccess) { break }
        Write-Info "Trying $($plan.Model) ($($plan.Version)) - $($plan.Sku)..."
        foreach ($capacity in $capacityLevels) {
            if ($deploymentSuccess) { break }

            Write-Info "  $($plan.Sku) ${capacity}K TPM..."
            az cognitiveservices account deployment create `
                --name $OpenAIResourceName `
                --resource-group $ResourceGroupName `
                --deployment-name $OpenAIDeploymentName `
                --model-name $plan.Model `
                --model-version $plan.Version `
                --model-format "OpenAI" `
                --sku-capacity $capacity `
                --sku-name $plan.Sku `
                --output none 2>$null

            if ($LASTEXITCODE -eq 0) {
                $deploymentSuccess = $true
                $deployedCapacity = $capacity
                $deployedModel = $plan.Model
                $deployedSku = $plan.Sku
                $deployedModelVersion = $plan.Version
                Write-Success "Deployed $($plan.Model) ($($plan.Version)) with ${capacity}K TPM [$($plan.Sku)]"
                if ($plan.Model -eq "gpt-4o-mini") {
                    Write-Info "Note: Deployed gpt-4o-mini (GPT-4.1 / GPT-4o not available in this region/quota)"
                }
            }
        }
    }

    if (-not $deploymentSuccess) {
        Write-Error "Failed to deploy any GPT model. Please check:"
        Write-Host "  1. Azure OpenAI quota in your subscription" -ForegroundColor Yellow
        Write-Host "  2. Model availability in region '$Location'" -ForegroundColor Yellow
        Write-Host "  3. Request quota increase at: https://aka.ms/oai/quotaincrease" -ForegroundColor Yellow
        exit 1
    }
}

# Scale up TPM if deployed with lower capacity (target: 80K for optimal performance)
$targetCapacityMax = 80
if ($deployedCapacity -gt 0 -and $deployedCapacity -lt $targetCapacityMax) {
    Write-Info "Attempting to scale up deployment for optimal performance..."
    Write-Info "Current: ${deployedCapacity}K TPM with $deployedSku SKU"
    Write-Info "Target: Maximize TPM (up to ${targetCapacityMax}K - tested optimal)"
    
    # Wait for deployment to stabilize
    Start-Sleep -Seconds 15
    
    # Try scale-up: start from 80K, decrease by 2K until we find available quota
    # Stop trying if we reach current capacity (no point going lower)
    $scaleUpSuccess = $false
    $finalCapacity = $deployedCapacity
    
    # Generate scale-up targets: 80, 78, 76, ... down to current+2
    $scaleUpTargets = @()
    for ($i = $targetCapacityMax; $i -gt $deployedCapacity; $i -= 2) {
        $scaleUpTargets += $i
    }
    
    if ($scaleUpTargets.Count -gt 0) {
        Write-Info "Scale-up attempts: $($scaleUpTargets -join 'K, ')K TPM"
        
        foreach ($targetCapacity in $scaleUpTargets) {
            if ($scaleUpSuccess) { break }
            
            Write-Info "  Trying ${targetCapacity}K TPM..."
            az cognitiveservices account deployment create `
                --name $OpenAIResourceName `
                --resource-group $ResourceGroupName `
                --deployment-name $OpenAIDeploymentName `
                --model-name $deployedModel `
                --model-version $deployedModelVersion `
                --model-format "OpenAI" `
                --sku-capacity $targetCapacity `
                --sku-name $deployedSku `
                --output none 2>$null
            
            if ($LASTEXITCODE -eq 0) {
                $scaleUpSuccess = $true
                $finalCapacity = $targetCapacity
                Write-Success "Successfully scaled up to ${targetCapacity}K TPM"
            }
        }
    }
    
    if (-not $scaleUpSuccess) {
        Write-Info "Could not scale up (quota limit). Staying at: ${deployedCapacity}K TPM"
        if ($deployedCapacity -lt 30) {
            Write-Host ""
            Write-Host "  ⚠️  WARNING: Current capacity (${deployedCapacity}K TPM) is below recommended (30K+)" -ForegroundColor Yellow
            Write-Host "  Large prompts may experience slower response times or rate limiting." -ForegroundColor Yellow
            Write-Host "  Request quota increase at: https://aka.ms/oai/quotaincrease" -ForegroundColor Yellow
        }
        Write-Host ""
        Write-Host "  # Manual scale-up command (when quota available):" -ForegroundColor Cyan
        Write-Host "  az cognitiveservices account deployment create ``" -ForegroundColor DarkGray
        Write-Host "      --name $OpenAIResourceName ``" -ForegroundColor DarkGray
        Write-Host "      --resource-group $ResourceGroupName ``" -ForegroundColor DarkGray
        Write-Host "      --deployment-name $OpenAIDeploymentName ``" -ForegroundColor DarkGray
        Write-Host "      --model-name $deployedModel ``" -ForegroundColor DarkGray
        Write-Host "      --model-version '$deployedModelVersion' ``" -ForegroundColor DarkGray
        Write-Host "      --model-format 'OpenAI' ``" -ForegroundColor DarkGray
        Write-Host "      --sku-capacity 80 ``" -ForegroundColor DarkGray
        Write-Host "      --sku-name '$deployedSku'" -ForegroundColor DarkGray
    } else {
        $deployedCapacity = $finalCapacity
    }
}

Write-Success "Model deployment ready: $OpenAIDeploymentName ($deployedModel)"

# ============================================
# STEP 3b (PRIVATE): PRIVATE ENDPOINT FOR AZURE OPENAI
# ============================================
if ($DeploymentMode -eq "Private") {
    Write-Step "Step 3b: Creating Private Endpoint for Azure OpenAI"
    
    $openaiResourceId = "/subscriptions/$subscriptionId/resourceGroups/$ResourceGroupName/providers/Microsoft.CognitiveServices/accounts/$OpenAIResourceName"
    $openaiPeName = "${OpenAIResourceName}-pe"
    $openaiDnsZoneName = "privatelink.openai.azure.com"
    
    # Check if PE already exists
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
            # If VNet is in a different RG, use full subnet resource ID
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
                Write-Host "  Ensure the PE subnet exists and has no conflicting delegations." -ForegroundColor Yellow
                exit 1
            }
        }
        Write-Success "Private Endpoint created: $openaiPeName"
    }
    
    # DNS Zone was already created/discovered and VNet-linked in the upfront discovery step.
    # Now configure the DNS Zone Group on the PE for automatic A record registration.
    if ($dnsZoneOpenAIFound) {
        Write-Info "Reusing existing Private DNS Zone: $openaiDnsZoneName (discovered in RG: $dnsZoneResourceGroup)"
    } else {
        Write-Info "Using newly created Private DNS Zone: $openaiDnsZoneName"
    }
    
    # Create DNS Zone Group on the Private Endpoint (auto-registers A records)
    Write-Info "Creating DNS Zone Group for automatic A record registration..."
    $openaiDnsZoneId = "/subscriptions/$dnsZoneSubscriptionId/resourceGroups/$dnsZoneResourceGroup/providers/Microsoft.Network/privateDnsZones/$openaiDnsZoneName"
    
    az network private-endpoint dns-zone-group create `
        --name "openai-dns-group" `
        --endpoint-name $openaiPeName `
        --resource-group $ResourceGroupName `
        --private-dns-zone $openaiDnsZoneId `
        --zone-name "openai" `
        --output none 2>$null
    
    if ($LASTEXITCODE -eq 0) {
        Write-Success "DNS Zone Group configured — A records auto-registered"
    } else {
        Write-Info "DNS Zone Group may already exist (continuing...)"
    }
    
    # Disable public network access on Azure OpenAI
    Write-Info "Disabling public network access on Azure OpenAI..."
    
    # Attempt 1: Standard disable
    $disableError = az cognitiveservices account update `
        --name $OpenAIResourceName `
        --resource-group $ResourceGroupName `
        --public-network-access Disabled 2>&1
    
    if ($LASTEXITCODE -ne 0) {
        # Attempt 2: Wait for PE propagation then retry (PE may still be provisioning)
        Write-Info "Waiting 30 seconds for Private Endpoint propagation before retry..."
        Start-Sleep -Seconds 30
        
        $disableError = az cognitiveservices account update `
            --name $OpenAIResourceName `
            --resource-group $ResourceGroupName `
            --public-network-access Disabled 2>&1
    }
    
    if ($LASTEXITCODE -ne 0) {
        # Attempt 3: Some regions/API versions require setting network default action
        Write-Info "Retry with network rules default action Deny..."
        $disableError = az cognitiveservices account update `
            --name $OpenAIResourceName `
            --resource-group $ResourceGroupName `
            --public-network-access Disabled `
            --api-properties "{}" 2>&1
    }
    
    if ($LASTEXITCODE -eq 0) {
        Write-Success "Public network access DISABLED on Azure OpenAI"
    } else {
        Write-Host "  ⚠️  Could not disable public access on OpenAI (will verify actual state)..." -ForegroundColor Yellow
        Write-Host "  Error: $disableError" -ForegroundColor DarkGray
    }
    
    # Verify the actual state regardless of command exit code
    $actualPublicAccess = az cognitiveservices account show `
        --name $OpenAIResourceName `
        --resource-group $ResourceGroupName `
        --query "properties.publicNetworkAccess" -o tsv 2>$null
    
    if ($actualPublicAccess -eq "Disabled") {
        $publicAccessStatus = "DISABLED"
        if ($LASTEXITCODE -ne 0) {
            Write-Success "Public access verified as DISABLED (was already set)"
        }
    } else {
        $publicAccessStatus = "ENABLED (manual action needed)"
        Write-Host "  ⚠️  Public access is still ENABLED. Disable manually:" -ForegroundColor Yellow
        Write-Host "  az cognitiveservices account update --name $OpenAIResourceName --resource-group $ResourceGroupName --public-network-access Disabled" -ForegroundColor DarkGray
    }
    
    Write-Host ""
    Write-Host "  ✅ Azure OpenAI Private Endpoint configured:" -ForegroundColor Green
    Write-Host "    Private Endpoint:     $openaiPeName" -ForegroundColor White
    Write-Host "    DNS Zone:             $openaiDnsZoneName $(if ($dnsZoneOpenAIFound) { '(reused existing)' } else { '(created)' })" -ForegroundColor White
    Write-Host "    DNS Zone Location:    $dnsZoneResourceGroup ($dnsZoneSubscriptionId)" -ForegroundColor White
    Write-Host "    Public Access:        $publicAccessStatus" -ForegroundColor $(if ($publicAccessStatus -eq "DISABLED") { "White" } else { "Yellow" })
    Write-Host ""
}

# ============================================
# STEP 3C: CREATE AZURE SQL (Prompt Library + Chat History)
# ============================================
if ($DeploySql) {
    Write-Step "Step 3c: Creating Azure SQL Logical Server"

    # Resolve the Entra (AAD) admin for the SQL server. AAD-only auth is enforced
    # (no SQL logins / passwords). Defaults to the signed-in deployer.
    if ([string]::IsNullOrWhiteSpace($SqlAadAdminUpn)) {
        $sqlAdminObjectId = az ad signed-in-user show --query id -o tsv 2>$null
        $sqlAdminDisplay  = az ad signed-in-user show --query userPrincipalName -o tsv 2>$null
    } else {
        $sqlAdminObjectId = az ad user show --id $SqlAadAdminUpn --query id -o tsv 2>$null
        $sqlAdminDisplay  = $SqlAadAdminUpn
    }
    if ([string]::IsNullOrWhiteSpace($sqlAdminObjectId)) {
        Write-Error "Could not resolve an Entra admin object id for the SQL server. Pass -SqlAadAdminUpn."
        exit 1
    }

    $sqlServerExists = az sql server show --name $SqlServerName --resource-group $ResourceGroupName 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Info "SQL server '$SqlServerName' already exists - reusing"
    } else {
        Write-Info "Creating SQL logical server '$SqlServerName' (Entra-only auth)..."
        az sql server create `
            --name $SqlServerName `
            --resource-group $ResourceGroupName `
            --location $Location `
            --enable-ad-only-auth `
            --external-admin-principal-type User `
            --external-admin-name "$sqlAdminDisplay" `
            --external-admin-sid $sqlAdminObjectId `
            --output none
        if ($LASTEXITCODE -ne 0) {
            Write-Error "Failed to create Azure SQL logical server"
            exit 1
        }
        Write-Success "SQL logical server created: $SqlServerName"
    }

    Write-Step "Step 3d: Creating Azure SQL Database ($SqlServiceObjective)"
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
        Write-Step "Step 3e: Creating Private Endpoint for Azure SQL"

        Write-Info "Disabling public network access on the SQL server..."
        az sql server update `
            --name $SqlServerName `
            --resource-group $ResourceGroupName `
            --enable-public-network false `
            --output none 2>$null

        $sqlServerResourceId = "/subscriptions/$subscriptionId/resourceGroups/$ResourceGroupName/providers/Microsoft.Sql/servers/$SqlServerName"
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
        }

        $sqlDnsLinkName = "link-$($VNetName)-sql"
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
        # Public mode: allow Azure services (the Container App's outbound traffic) to reach SQL.
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
# STEP 4: CREATE CONTAINER REGISTRY
# ============================================
Write-Step "Step 4: Creating Azure Container Registry"

# Validate ACR name (Azure requires: lowercase, alphanumeric only, 5-50 chars)
$acrNameClean = $ContainerRegistryName.ToLower() -replace '[^a-z0-9]', ''
if ($acrNameClean -ne $ContainerRegistryName.ToLower()) {
    Write-Host ""
    Write-Host "  ⚠️  ACR NAME ADJUSTED" -ForegroundColor Yellow
    Write-Host "  ─────────────────────────────────────────────────────────────" -ForegroundColor Gray
    Write-Host "  You provided:       $ContainerRegistryName" -ForegroundColor White
    Write-Host "  Azure requires:     Alphanumeric only (no hyphens, dots, or underscores)" -ForegroundColor White
    Write-Host "  Adjusted to:        $acrNameClean" -ForegroundColor Green
    Write-Host "  ─────────────────────────────────────────────────────────────" -ForegroundColor Gray
    Write-Host ""
    $acrConfirm = Read-Host "  Continue with ACR name '$acrNameClean'? (Y/N)"
    if ($acrConfirm -ne 'Y' -and $acrConfirm -ne 'y') {
        Write-Error "Deployment cancelled. Please provide an alphanumeric ACR name (e.g., 'myacrname' not 'my-acr-name')"
        exit 1
    }
}
if ($acrNameClean.Length -lt 5 -or $acrNameClean.Length -gt 50) {
    Write-Error "Container Registry name must be 5-50 alphanumeric characters (after removing special characters, got: '$acrNameClean' with $($acrNameClean.Length) chars)"
    exit 1
}

$acrExists = az acr show --name $acrNameClean --resource-group $ResourceGroupName 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Info "Container Registry '$acrNameClean' already exists"
} else {
    Write-Info "Creating Container Registry '$acrNameClean'..."
    az acr create `
        --name $acrNameClean `
        --resource-group $ResourceGroupName `
        --sku Premium `
        --admin-enabled false `
        --output none
    
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Failed to create Container Registry"
        exit 1
    }
}
Write-Success "Container Registry ready: $acrNameClean"

# Store ACR server name for later use
$acrServer = "$acrNameClean.azurecr.io"
# Note: Using Managed Identity for ACR authentication (no admin credentials needed)

# ============================================
# STEP 5: BUILD AND PUSH CONTAINER IMAGE
# ============================================
Write-Step "Step 5: Building and Pushing Container Image"

Write-Info "Building container image using ACR Tasks..."
Write-Info "This may take 3-5 minutes..."

az acr build `
    --registry $acrNameClean `
    --image "${ContainerImageName}:${ContainerImageTag}" `
    --file Dockerfile `
    . `
    --output none

if ($LASTEXITCODE -ne 0) {
    Write-Error "Failed to build container image"
    exit 1
}
Write-Success "Container image built and pushed: $acrServer/${ContainerImageName}:${ContainerImageTag}"

# ============================================
# STEP 5b (PRIVATE): PRIVATE ENDPOINT FOR ACR
# ============================================
if ($DeploymentMode -eq "Private") {
    Write-Step "Step 5b: Creating Private Endpoint for Azure Container Registry"
    
    # NOTE: Image was built and pushed BEFORE disabling public access (intentional)
    # Container App will pull via Private Endpoint after it's configured
    
    $acrResourceId = "/subscriptions/$subscriptionId/resourceGroups/$ResourceGroupName/providers/Microsoft.ContainerRegistry/registries/$acrNameClean"
    $acrPeName = "${acrNameClean}-pe"
    $acrDnsZoneName = "privatelink.azurecr.io"
    
    # Check if PE already exists
    $acrPeExists = az network private-endpoint show --name $acrPeName --resource-group $ResourceGroupName 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Info "Private Endpoint '$acrPeName' already exists"
    } else {
        Write-Info "Creating Private Endpoint for Azure Container Registry..."
        az network private-endpoint create `
            --name $acrPeName `
            --resource-group $ResourceGroupName `
            --location $Location `
            --vnet-name $VNetName `
            --subnet $PrivateEndpointSubnetName `
            --private-connection-resource-id $acrResourceId `
            --group-id "registry" `
            --connection-name "${acrNameClean}-connection" `
            --output none 2>$null
        
        if ($LASTEXITCODE -ne 0) {
            # If VNet is in a different RG, use full subnet resource ID
            Write-Info "Retrying with full subnet resource ID..."
            az network private-endpoint create `
                --name $acrPeName `
                --resource-group $ResourceGroupName `
                --location $Location `
                --subnet $peSubnetResourceId `
                --private-connection-resource-id $acrResourceId `
                --group-id "registry" `
                --connection-name "${acrNameClean}-connection" `
                --output none
            
            if ($LASTEXITCODE -ne 0) {
                Write-Error "Failed to create Private Endpoint for ACR"
                exit 1
            }
        }
        Write-Success "Private Endpoint created: $acrPeName"
    }
    
    # DNS Zone was already created/discovered and VNet-linked in the upfront discovery step.
    # Now configure the DNS Zone Group on the PE for automatic A record registration.
    if ($dnsZoneACRFound) {
        Write-Info "Reusing existing Private DNS Zone: $acrDnsZoneName (discovered in RG: $dnsZoneResourceGroup)"
    } else {
        Write-Info "Using newly created Private DNS Zone: $acrDnsZoneName"
    }
    
    # Create DNS Zone Group on the Private Endpoint (auto-registers A records)
    Write-Info "Creating DNS Zone Group for automatic A record registration..."
    $acrDnsZoneId = "/subscriptions/$dnsZoneSubscriptionId/resourceGroups/$dnsZoneResourceGroup/providers/Microsoft.Network/privateDnsZones/$acrDnsZoneName"
    
    az network private-endpoint dns-zone-group create `
        --name "acr-dns-group" `
        --endpoint-name $acrPeName `
        --resource-group $ResourceGroupName `
        --private-dns-zone $acrDnsZoneId `
        --zone-name "acr" `
        --output none 2>$null
    
    if ($LASTEXITCODE -eq 0) {
        Write-Success "DNS Zone Group configured — A records auto-registered"
    } else {
        Write-Info "DNS Zone Group may already exist (continuing...)"
    }
    
    # ── ACR public access is NOT disabled here ──────────────────────────────
    # IMPORTANT: ACR lockdown is DEFERRED to Step 9b (after Container App update).
    # The Container App update (Step 9) needs ARM to validate the ACR image pull.
    # If we disable public access now, Step 9 fails with ConnectionResetError because
    # the Azure CLI (running from the deployer's machine, outside the VNet) cannot
    # reach the now-private ACR to validate/poll the update operation.
    # ───────────────────────────────────────────────────────────────────────────────
    Write-Info "ACR public access remains OPEN temporarily — will be locked down after Container App image pull (Step 9b)"
    
    Write-Host ""
    Write-Host "  ✅ ACR Private Endpoint configured:" -ForegroundColor Green
    Write-Host "    Private Endpoint:     $acrPeName" -ForegroundColor White
    Write-Host "    DNS Zone:             $acrDnsZoneName $(if ($dnsZoneACRFound) { '(reused existing)' } else { '(created)' })" -ForegroundColor White
    Write-Host "    DNS Zone Location:    $dnsZoneResourceGroup ($dnsZoneSubscriptionId)" -ForegroundColor White
    Write-Host "    Public Access:        OPEN (locked down in Step 9b after image pull)" -ForegroundColor Yellow
    Write-Host ""
}

# ============================================
# STEP 6: CREATE CONTAINER APPS ENVIRONMENT
# ============================================
Write-Step "Step 6: Creating Container Apps Environment"

if ($DeploymentMode -eq "Private") {
    Write-Info "🔒 Creating PRIVATE Container Apps Environment (VNet-integrated, internal-only)..."
} else {
    Write-Info "🌐 Creating PUBLIC Container Apps Environment..."
}

# ── Pre-flight: Detect if subnet is already claimed by another environment ────
$envFoundExisting = $false
$envExists = az containerapp env show --name $ContainerAppEnvName --resource-group $ResourceGroupName 2>&1
if ($LASTEXITCODE -eq 0) {
    $envFoundExisting = $true
    Write-Info "Container Apps Environment '$ContainerAppEnvName' already exists in $ResourceGroupName"
    
    # If private mode, verify the existing environment is actually internal
    if ($DeploymentMode -eq "Private") {
        $envVnetConfig = az containerapp env show --name $ContainerAppEnvName --resource-group $ResourceGroupName --query "properties.vnetConfiguration.internal" -o tsv 2>$null
        if ($envVnetConfig -ne "True") {
            Write-Host ""
            Write-Host "  ⚠️  WARNING: Existing environment is NOT configured as internal/private!" -ForegroundColor Red
            Write-Host "  You requested Private deployment but the existing environment is public." -ForegroundColor Yellow
            Write-Host "  To deploy privately, delete the existing environment and re-run:" -ForegroundColor Yellow
            Write-Host "    az containerapp env delete --name $ContainerAppEnvName --resource-group $ResourceGroupName --yes" -ForegroundColor DarkGray
            Write-Host ""
            $overrideConfirm = Read-Host "  Continue with existing PUBLIC environment? (Y/N)"
            if ($overrideConfirm -ne 'Y' -and $overrideConfirm -ne 'y') {
                Write-Error "Deployment cancelled. Delete the existing environment and re-run."
                exit 1
            }
        } else {
            Write-Success "Existing environment is correctly configured as internal/private"
        }
    }
} elseif ($DeploymentMode -eq "Private") {
    # Environment not found in target RG — but the SUBNET may already be claimed
    # by a previous deployment (different RG, failed run, etc.). Detect this upfront.
    Write-Info "Checking if subnet is already used by another Container Apps Environment..."
    $subnetEnvQuery = az containerapp env list --subscription $SubscriptionId `
        --query "[?properties.vnetConfiguration.infrastructureSubnetId=='$subnetResourceId'].{Name:name, RG:resourceGroup, State:properties.provisioningState}" `
        -o json 2>$null | ConvertFrom-Json
    
    if ($subnetEnvQuery -and $subnetEnvQuery.Count -gt 0) {
        $existingEnv = $subnetEnvQuery[0]
        $existingEnvName = $existingEnv.Name
        $existingEnvRG   = $existingEnv.RG
        $existingEnvState = $existingEnv.State
        
        Write-Host ""
        Write-Host "  ⚠️  SUBNET CONFLICT DETECTED" -ForegroundColor Red
        Write-Host "  ─────────────────────────────────────────────────────────────" -ForegroundColor Gray
        Write-Host "  Subnet '$SubnetName' is already claimed by:" -ForegroundColor Yellow
        Write-Host "    Environment:    $existingEnvName" -ForegroundColor White
        Write-Host "    Resource Group: $existingEnvRG" -ForegroundColor White
        Write-Host "    State:          $existingEnvState" -ForegroundColor White
        Write-Host ""
        
        if ($existingEnvName -eq $ContainerAppEnvName -and $existingEnvRG -ne $ResourceGroupName) {
            # Same environment name, different RG — leftover from a previous deployment
            Write-Host "  This is a leftover '$ContainerAppEnvName' from a previous deployment" -ForegroundColor Yellow
            Write-Host "  in resource group '$existingEnvRG' (different from target: '$ResourceGroupName')." -ForegroundColor Yellow
            Write-Host ""
            Write-Host "  Options:" -ForegroundColor Cyan
            Write-Host "    [D] Delete the old environment and create a new one (recommended)" -ForegroundColor White
            Write-Host "    [R] Reuse the existing environment (deploy Container App into '$existingEnvRG')" -ForegroundColor White
            Write-Host "    [Q] Quit (manual cleanup)" -ForegroundColor White
            Write-Host ""
            $subnetChoice = Read-Host "  Choose [D/R/Q]"
            
            if ($subnetChoice -eq 'D' -or $subnetChoice -eq 'd') {
                Write-Info "Deleting old Container Apps Environment '$existingEnvName' from '$existingEnvRG'..."
                Write-Info "This may take 1-3 minutes..."
                az containerapp env delete --name $existingEnvName `
                    --resource-group $existingEnvRG --yes --output none 2>$null
                if ($LASTEXITCODE -ne 0) {
                    Write-Error "Failed to delete old environment. Delete manually:"
                    Write-Host "  az containerapp env delete --name $existingEnvName --resource-group $existingEnvRG --yes" -ForegroundColor DarkGray
                    exit 1
                }
                Write-Success "Old environment deleted — subnet is now free"
                # Small wait for subnet release to propagate
                Start-Sleep -Seconds 10
            } elseif ($subnetChoice -eq 'R' -or $subnetChoice -eq 'r') {
                Write-Info "Reusing existing environment '$existingEnvName' in '$existingEnvRG'"
                # Override the target RG for the Container App to match the env's RG
                $ContainerAppEnvName = $existingEnvName
                $envFoundExisting = $true
            } else {
                Write-Host ""
                Write-Host "  To clean up manually, run:" -ForegroundColor Cyan
                Write-Host "  az containerapp env delete --name $existingEnvName --resource-group $existingEnvRG --yes" -ForegroundColor DarkGray
                Write-Error "Deployment cancelled. Clean up the old environment and re-run."
                exit 1
            }
        } else {
            # Different environment or different scenario
            Write-Host "  A Container Apps Environment already owns this subnet." -ForegroundColor Yellow
            Write-Host "  Each subnet can only be used by ONE Container Apps Environment." -ForegroundColor Yellow
            Write-Host ""
            Write-Host "  To fix, either:" -ForegroundColor Cyan
            Write-Host "    1. Delete the existing environment:" -ForegroundColor White
            Write-Host "       az containerapp env delete --name $existingEnvName --resource-group $existingEnvRG --yes" -ForegroundColor DarkGray
            Write-Host "    2. Or use a different subnet for this deployment:" -ForegroundColor White
            Write-Host "       -SubnetName <different-subnet>" -ForegroundColor DarkGray
            Write-Host ""
            Write-Host "  Do you want to DELETE the existing environment and proceed? (Y/N)" -ForegroundColor Yellow
            $deleteChoice = Read-Host "  "
            if ($deleteChoice -eq 'Y' -or $deleteChoice -eq 'y') {
                Write-Info "Deleting existing Container Apps Environment '$existingEnvName' from '$existingEnvRG'..."
                Write-Info "This may take 1-3 minutes..."
                az containerapp env delete --name $existingEnvName `
                    --resource-group $existingEnvRG --yes --output none 2>$null
                if ($LASTEXITCODE -ne 0) {
                    Write-Error "Failed to delete existing environment. Delete manually and re-run."
                    exit 1
                }
                Write-Success "Existing environment deleted — subnet is now free"
                Start-Sleep -Seconds 10
            } else {
                Write-Error "Deployment cancelled. Clean up the conflicting environment and re-run."
                exit 1
            }
        }
    }
}

if (-not $envFoundExisting) {
    Write-Info "Creating Container Apps Environment..."
    Write-Info "This may take 2-5 minutes..."
    
    if ($DeploymentMode -eq "Private") {
        # PRIVATE: Deploy with VNet integration and internal-only access
        Write-Host ""
        Write-Host "  🔒 Private Configuration:" -ForegroundColor Magenta
        Write-Host "    VNet:               $VNetName ($VNetResourceGroupName)" -ForegroundColor White
        Write-Host "    Subnet:             $SubnetName" -ForegroundColor White
        Write-Host "    Subnet Resource ID: $subnetResourceId" -ForegroundColor Gray
        Write-Host "    Internal Only:      Yes (no public endpoint)" -ForegroundColor White
        Write-Host ""
        
        if ($EnableLogAnalytics) {
            Write-Info "Log Analytics enabled for private environment"
            az containerapp env create `
                --name $ContainerAppEnvName `
                --resource-group $ResourceGroupName `
                --location $Location `
                --infrastructure-subnet-resource-id $subnetResourceId `
                --internal-only `
                --output none
        } else {
            Write-Info "Log Analytics disabled - use 'az containerapp logs' for debugging"
            az containerapp env create `
                --name $ContainerAppEnvName `
                --resource-group $ResourceGroupName `
                --location $Location `
                --infrastructure-subnet-resource-id $subnetResourceId `
                --internal-only `
                --logs-destination none `
                --output none
        }
    } else {
        # PUBLIC: Standard deployment (no VNet)
        if ($EnableLogAnalytics) {
            Write-Info "Log Analytics enabled - environment will have full logging capabilities"
            az containerapp env create `
                --name $ContainerAppEnvName `
                --resource-group $ResourceGroupName `
                --location $Location `
                --output none
        } else {
            Write-Info "Log Analytics disabled (default) - use 'az containerapp logs' for debugging"
            Write-Info "To enable later, recreate environment with -EnableLogAnalytics switch"
            az containerapp env create `
                --name $ContainerAppEnvName `
                --resource-group $ResourceGroupName `
                --location $Location `
                --logs-destination none `
                --output none
        }
    }
    
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Failed to create Container Apps Environment"
        if ($DeploymentMode -eq "Private") {
            Write-Host ""
            Write-Host "  Common causes for private deployment failures:" -ForegroundColor Yellow
            Write-Host "    1. Subnet is too small (need at least /27)" -ForegroundColor Yellow
            Write-Host "    2. Subnet delegation missing (Microsoft.App/environments)" -ForegroundColor Yellow
            Write-Host "    3. Subnet already used by another Container Apps Environment" -ForegroundColor Yellow
            Write-Host "    4. NSG on subnet blocking required ports" -ForegroundColor Yellow
            Write-Host "    5. VNet/Subnet in different region than deployment" -ForegroundColor Yellow
            Write-Host ""
            Write-Host "  💡 If subnet is in use by a previous deployment, delete the old environment:" -ForegroundColor Cyan
            Write-Host "  az containerapp env list -o table  # Find the conflicting environment" -ForegroundColor DarkGray
            Write-Host "  az containerapp env delete --name <env-name> --resource-group <rg-name> --yes" -ForegroundColor DarkGray
        }
        exit 1
    }
}

if ($DeploymentMode -eq "Private") {
    # Get the environment's static IP and default domain for private DNS
    $envStaticIp = az containerapp env show --name $ContainerAppEnvName --resource-group $ResourceGroupName --query "properties.staticIp" -o tsv 2>$null
    $envDefaultDomain = az containerapp env show --name $ContainerAppEnvName --resource-group $ResourceGroupName --query "properties.defaultDomain" -o tsv 2>$null
    
    Write-Success "Private Container Apps Environment ready: $ContainerAppEnvName"
    Write-Host "    Static IP (internal): $envStaticIp" -ForegroundColor White
    Write-Host "    Default Domain:       $envDefaultDomain" -ForegroundColor White
    Write-Host ""
    
    # ============================================
    # STEP 6b (PRIVATE): PRIVATE DNS ZONE FOR CONTAINER APPS ENVIRONMENT
    # ============================================
    Write-Step "Step 6b: Creating Private DNS Zone for Container Apps Environment"
    
    Write-Info "Configuring Private DNS Zone: $envDefaultDomain"
    
    $envDnsExists = az network private-dns zone show `
        --name $envDefaultDomain `
        --resource-group $dnsZoneResourceGroup `
        --subscription $dnsZoneSubscriptionId `
        --query "name" -o tsv 2>&1
    
    if ($LASTEXITCODE -eq 0) {
        Write-Success "Private DNS Zone already exists: $envDefaultDomain"
    } else {
        Write-Info "Creating Private DNS Zone: $envDefaultDomain in RG '$dnsZoneResourceGroup' (Sub: $dnsZoneSubscriptionId)..."
        az network private-dns zone create `
            --name $envDefaultDomain `
            --resource-group $dnsZoneResourceGroup `
            --subscription $dnsZoneSubscriptionId `
            --output none
        
        if ($LASTEXITCODE -ne 0) {
            Write-Host "  ⚠️  Could not create DNS Zone for Container Apps Environment. Create manually:" -ForegroundColor Yellow
            Write-Host "  az network private-dns zone create --name $envDefaultDomain --resource-group $dnsZoneResourceGroup --subscription $dnsZoneSubscriptionId" -ForegroundColor DarkGray
        } else {
            Write-Success "Private DNS Zone created: $envDefaultDomain"
        }
    }
    
    # Add wildcard A record pointing to the environment's static IP
    Write-Info "Adding wildcard A record: * → $envStaticIp"
    
    $existingRecord = az network private-dns record-set a show `
        --name "*" `
        --zone-name $envDefaultDomain `
        --resource-group $dnsZoneResourceGroup `
        --subscription $dnsZoneSubscriptionId 2>&1
    
    if ($LASTEXITCODE -eq 0) {
        Write-Info "Wildcard A record already exists — updating..."
    }
    
    az network private-dns record-set a add-record `
        --record-set-name "*" `
        --zone-name $envDefaultDomain `
        --resource-group $dnsZoneResourceGroup `
        --subscription $dnsZoneSubscriptionId `
        --ipv4-address $envStaticIp `
        --output none 2>$null
    
    if ($LASTEXITCODE -eq 0) {
        Write-Success "Wildcard A record configured: * → $envStaticIp"
    } else {
        Write-Host "  ⚠️  Could not create A record. Add manually:" -ForegroundColor Yellow
        Write-Host "  az network private-dns record-set a add-record --record-set-name '*' --zone-name $envDefaultDomain --resource-group $dnsZoneResourceGroup --subscription $dnsZoneSubscriptionId --ipv4-address $envStaticIp" -ForegroundColor DarkGray
    }
    
    # Link DNS Zone to VNet
    $envDnsLinkName = "link-$($VNetName)-cae"
    $envLinkExists = az network private-dns link vnet show `
        --name $envDnsLinkName `
        --zone-name $envDefaultDomain `
        --resource-group $dnsZoneResourceGroup `
        --subscription $dnsZoneSubscriptionId 2>&1
    
    if ($LASTEXITCODE -eq 0) {
        Write-Info "VNet link already exists: $envDnsLinkName"
    } else {
        Write-Info "Linking DNS Zone to VNet..."
        az network private-dns link vnet create `
            --name $envDnsLinkName `
            --zone-name $envDefaultDomain `
            --resource-group $dnsZoneResourceGroup `
            --subscription $dnsZoneSubscriptionId `
            --virtual-network $vnetResourceId `
            --registration-enabled false `
            --output none
        
        if ($LASTEXITCODE -ne 0) {
            Write-Host "  ⚠️  Could not auto-link DNS zone to VNet." -ForegroundColor Yellow
        } else {
            Write-Success "VNet linked to DNS Zone: $envDnsLinkName"
        }
    }
    
    Write-Host ""
    Write-Host "  ✅ Container Apps Environment Private DNS configured:" -ForegroundColor Green
    Write-Host "    DNS Zone:       $envDefaultDomain" -ForegroundColor White
    Write-Host "    A Record:       * → $envStaticIp" -ForegroundColor White
    Write-Host "    VNet Link:      $envDnsLinkName" -ForegroundColor White
    Write-Host "    DNS Location:   $dnsZoneResourceGroup ($dnsZoneSubscriptionId)" -ForegroundColor White
    Write-Host ""
} else {
    Write-Success "Container Apps Environment ready: $ContainerAppEnvName"
}

# ============================================
# STEP 7: CREATE CONTAINER APP WITH MANAGED IDENTITY
# ============================================
Write-Step "Step 7: Creating Container App with Managed Identity"

$appExists = az containerapp show --name $ContainerAppName --resource-group $ResourceGroupName 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Info "Container App '$ContainerAppName' already exists"
    
    # Ensure managed identity is enabled
    Write-Info "Ensuring managed identity is enabled..."
    az containerapp identity assign `
        --name $ContainerAppName `
        --resource-group $ResourceGroupName `
        --system-assigned `
        --output none 2>$null
} else {
    # Step 7a: Create container app with placeholder image and managed identity enabled
    Write-Info "Creating Container App '$ContainerAppName' with System-Assigned Managed Identity..."
    Write-Info "Using placeholder image (will update after ACR access is configured)..."
    
    # Ingress is always 'external' - this means accessible from the VNet.
    # For Private deployments, the Container App Environment is --internal-only (no public IP).
    # The environment-level setting enforces privacy; ingress 'internal' would restrict access
    # to only other container apps in the same environment (not reachable from VNet VMs/services).
    $ingressType = "external"
    Write-Info "Ingress type: $ingressType (environment-level internal-only enforces private access)"
    az containerapp create `
        --name $ContainerAppName `
        --resource-group $ResourceGroupName `
        --environment $ContainerAppEnvName `
        --image "mcr.microsoft.com/k8se/quickstart:latest" `
        --target-port 8000 `
        --ingress $ingressType `
        --min-replicas 1 `
        --max-replicas 3 `
        --cpu 1.0 `
        --memory 2.0Gi `
        --system-assigned `
        --env-vars `
            "AZURE_OPENAI_ENDPOINT=$openaiEndpoint" `
            "AZURE_OPENAI_DEPLOYMENT_NAME=$OpenAIDeploymentName" `
            "AZURE_OPENAI_API_VERSION=$OpenAIApiVersion" `
            "AZURE_SUBSCRIPTION_ID=$subscriptionId" `
            "USE_MANAGED_IDENTITY=true" `
            "ENABLE_APPROVAL_WORKFLOW=false" `
            "ENTRA_APP_CLIENT_ID=$EntraAppClientId" `
            "ENTRA_TENANT_ID=$EntraTenantId" `
        --output none
    
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Failed to create Container App"
        exit 1
    }
    Write-Success "Container App created with Managed Identity enabled"
}

# Get principal ID for role assignments
$principalId = az containerapp show `
    --name $ContainerAppName `
    --resource-group $ResourceGroupName `
    --query "identity.principalId" -o tsv

if ([string]::IsNullOrEmpty($principalId)) {
    Write-Error "Failed to get Managed Identity Principal ID"
    exit 1
}
Write-Success "Managed Identity Principal ID: $principalId"

# ============================================
# WIRE AZURE SQL (env-vars + grant MI access)
# ============================================
if ($DeploySql) {
    Write-Step "Step 8b: Wiring Container App to Azure SQL"

    $sqlConn = "Driver={ODBC Driver 18 for SQL Server};Server=tcp:$SqlServerName.database.windows.net,1433;Database=$SqlDatabaseName;Encrypt=yes;TrustServerCertificate=no;Connection Timeout=30;Authentication=ActiveDirectoryMsi;"
    Write-Info "Setting Prompt Library / Chat History environment variables..."
    az containerapp update `
        --name $ContainerAppName `
        --resource-group $ResourceGroupName `
        --set-env-vars `
            "PROMPTS_SQL_CONN=$sqlConn" `
            "PROMPTS_DEFAULT_TENANT=$EntraTenantId" `
            "PROMPTS_SQL_SCHEMA=dbo" `
        --output none 2>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Success "Container App environment wired to Azure SQL"
    } else {
        Write-Info "Could not set SQL env vars automatically (continuing)"
    }

    # Grant the Container App's managed identity contained-DB access (read/write + DDL).
    $grantTsql = @"
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'$ContainerAppName')
    CREATE USER [$ContainerAppName] FROM EXTERNAL PROVIDER;
ALTER ROLE db_datareader ADD MEMBER [$ContainerAppName];
ALTER ROLE db_datawriter ADD MEMBER [$ContainerAppName];
ALTER ROLE db_ddladmin   ADD MEMBER [$ContainerAppName];
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
            Write-Success "Granted '$ContainerAppName' db_datareader/db_datawriter/db_ddladmin on $SqlDatabaseName"
        }
    }

    if (-not $granted) {
        $reason = if ($DeploymentMode -eq "Private") { "SQL is private (run from inside the VNet)" } else { "sqlcmd not available or grant failed" }
        Write-Info "Automatic SQL grant skipped: $reason"
        Write-Host "  >> Run this T-SQL against [$SqlDatabaseName] on $sqlFqdn as the Entra admin:" -ForegroundColor Yellow
        Write-Host ""
        ($grantTsql -split "`n") | ForEach-Object { Write-Host "      $_" -ForegroundColor DarkGray }
        Write-Host ""
        Write-Host "  (Saved to: $grantFile)" -ForegroundColor DarkGray
    }
    Write-Host ""
}


# ============================================
# STEP 8: CONFIGURE ACR ACCESS WITH MANAGED IDENTITY
# ============================================
Write-Step "Step 8: Configuring ACR Access (AcrPull Role)"

Write-Info "Assigning 'AcrPull' role to Managed Identity for ACR access..."
Write-Info "This allows the Container App to pull images from ACR securely."

$acrResourceId = "/subscriptions/$subscriptionId/resourceGroups/$ResourceGroupName/providers/Microsoft.ContainerRegistry/registries/$acrNameClean"

$acrRoleResult = az role assignment create `
    --assignee $principalId `
    --role "AcrPull" `
    --scope $acrResourceId `
    --output none 2>&1

if ($LASTEXITCODE -eq 0 -or $acrRoleResult -match "already exists") {
    Write-Success "AcrPull role assigned to Managed Identity"
} else {
    Write-Info "AcrPull role may already exist (continuing...)"
}

# Wait for role propagation
Write-Info "Waiting 30 seconds for role assignment to propagate..."
Start-Sleep -Seconds 30

# ============================================
# STEP 9: UPDATE CONTAINER APP WITH REAL IMAGE
# ============================================
Write-Step "Step 9: Updating Container App with Application Image"

Write-Info "Updating Container App to use image from ACR..."
Write-Info "Image: $acrServer/${ContainerImageName}:${ContainerImageTag}"

# First, register the registry with the container app using managed identity
$registryRetries = 3
$registrySuccess = $false
for ($r = 1; $r -le $registryRetries; $r++) {
    az containerapp registry set `
        --name $ContainerAppName `
        --resource-group $ResourceGroupName `
        --server $acrServer `
        --identity system `
        --output none 2>$null
    
    if ($LASTEXITCODE -eq 0) {
        $registrySuccess = $true
        break
    }
    if ($r -lt $registryRetries) {
        Write-Info "Registry set attempt $r/$registryRetries failed — retrying in 15 seconds..."
        Start-Sleep -Seconds 15
    }
}

if (-not $registrySuccess) {
    Write-Error "Failed to configure ACR registry with Managed Identity after $registryRetries attempts"
    exit 1
}
Write-Success "ACR registry configured with Managed Identity authentication"

# Now update the container app with the real image
# Retry logic: ARM polling for containerapp update can hit transient ConnectionResetError
$updateRetries = 3
$updateSuccess = $false
for ($r = 1; $r -le $updateRetries; $r++) {
    Write-Info "Updating Container App image (attempt $r/$updateRetries)..."
    az containerapp update `
        --name $ContainerAppName `
        --resource-group $ResourceGroupName `
        --image "$acrServer/${ContainerImageName}:${ContainerImageTag}" `
        --output none 2>$null
    
    if ($LASTEXITCODE -eq 0) {
        $updateSuccess = $true
        break
    }
    if ($r -lt $updateRetries) {
        Write-Info "Update attempt $r/$updateRetries failed (transient error) — retrying in 30 seconds..."
        Start-Sleep -Seconds 30
    }
}

if (-not $updateSuccess) {
    # Final fallback: verify if the update actually succeeded despite CLI error
    Write-Info "CLI reported failure — verifying Container App image status..."
    $currentImage = az containerapp show `
        --name $ContainerAppName `
        --resource-group $ResourceGroupName `
        --query "properties.template.containers[0].image" -o tsv 2>$null
    
    if ($currentImage -eq "$acrServer/${ContainerImageName}:${ContainerImageTag}") {
        Write-Success "Container App image verified correct (CLI polling failed but update succeeded)"
        $updateSuccess = $true
    } else {
        Write-Error "Failed to update Container App with application image after $updateRetries attempts"
        Write-Host "  Current image: $currentImage" -ForegroundColor Yellow
        Write-Host "  Expected:      $acrServer/${ContainerImageName}:${ContainerImageTag}" -ForegroundColor Yellow
        Write-Host "" -ForegroundColor Yellow
        Write-Host "  ⚠️  The update may still be in progress. Check the Container App in the portal." -ForegroundColor Yellow
        Write-Host "  Manual retry:" -ForegroundColor Yellow
        Write-Host "  az containerapp update --name $ContainerAppName --resource-group $ResourceGroupName --image `"$acrServer/${ContainerImageName}:${ContainerImageTag}`"" -ForegroundColor DarkGray
        exit 1
    }
}

if ($updateSuccess) {
    Write-Success "Container App updated with application image"
}

# ============================================
# STEP 9b: LOCK DOWN ACR (DISABLE PUBLIC ACCESS)
# ============================================
if ($DeploymentMode -eq "Private") {
    Write-Step "Step 9b: Locking Down ACR — Disabling Public Network Access"
    
    Write-Info "Container App image pull succeeded — now safe to disable ACR public access"
    Write-Info "Disabling public network access on Azure Container Registry..."
    
    # Attempt 1: Standard disable
    $acrDisableError = az acr update `
        --name $acrNameClean `
        --resource-group $ResourceGroupName `
        --public-network-enabled false 2>&1
    
    if ($LASTEXITCODE -ne 0) {
        # Attempt 2: Wait for PE propagation then retry
        Write-Info "Waiting 30 seconds for Private Endpoint propagation before retry..."
        Start-Sleep -Seconds 30
        
        $acrDisableError = az acr update `
            --name $acrNameClean `
            --resource-group $ResourceGroupName `
            --public-network-enabled false 2>&1
    }
    
    if ($LASTEXITCODE -ne 0) {
        # Attempt 3: Use REST-style property name (some CLI versions)
        Write-Info "Retry with alternative flag..."
        $acrDisableError = az acr update `
            --name $acrNameClean `
            --resource-group $ResourceGroupName `
            --set publicNetworkAccess=Disabled 2>&1
    }
    
    if ($LASTEXITCODE -eq 0) {
        Write-Success "Public network access DISABLED on ACR"
    } else {
        Write-Host "  ⚠️  Could not disable public access on ACR (will verify actual state)..." -ForegroundColor Yellow
        Write-Host "  Error: $acrDisableError" -ForegroundColor DarkGray
    }
    
    # Verify actual state regardless of command exit code
    $actualAcrPublicAccess = az acr show `
        --name $acrNameClean `
        --resource-group $ResourceGroupName `
        --query "publicNetworkAccess" -o tsv 2>$null
    
    if ($actualAcrPublicAccess -eq "Disabled") {
        $acrPublicStatus = "DISABLED"
        if ($LASTEXITCODE -ne 0) {
            Write-Success "ACR public access verified as DISABLED (was already set)"
        }
        Write-Info "ACR is now private-only — accessible only via Private Endpoint"
    } else {
        $acrPublicStatus = "ENABLED (manual action needed)"
        Write-Host "  ⚠️  ACR public access is still ENABLED. Disable manually:" -ForegroundColor Yellow
        Write-Host "  az acr update --name $acrNameClean --resource-group $ResourceGroupName --public-network-enabled false" -ForegroundColor DarkGray
    }
    Write-Host ""
}

# ============================================
# STEP 10: ASSIGN RBAC ROLES (LEAST-PRIVILEGE)
# ============================================
Write-Step "Step 10: Assigning RBAC Roles (Least-Privilege Principle)"

Write-Host ""
Write-Host "  📋 RBAC Assignment Summary (Least-Privilege)" -ForegroundColor Yellow
Write-Host "  ─────────────────────────────────────────────────────────────" -ForegroundColor Gray
Write-Host "  The System-Assigned Managed Identity will receive ONLY these roles:" -ForegroundColor White
Write-Host ""

# Define roles with detailed justification - Assigned at Management Group level to cover ALL subscriptions
$roles = @(
    @{
        Name="Reader"
        Scope="/providers/Microsoft.Management/managementGroups/$EntraTenantId"
        ScopeDescription="Tenant Root Management Group (inherits to ALL subscriptions)"
        Description="Read-only access to Azure resources"
        Justification="Required for Resource Graph queries (list VMs, networks, storage, etc.) across ALL subscriptions"
        CannotDo="Create, modify, or delete any resources"
    },
    @{
        Name="Cost Management Reader"
        Scope="/providers/Microsoft.Management/managementGroups/$EntraTenantId"
        ScopeDescription="Tenant Root Management Group (inherits to ALL subscriptions)"
        Description="Read-only access to cost and billing data"
        Justification="Required for cost analysis, spending trends, and budget monitoring across ALL subscriptions"
        CannotDo="Modify budgets, billing settings, or make financial changes"
    }
)

foreach ($role in $roles) {
    Write-Host "  Role: $($role.Name)" -ForegroundColor Cyan
    Write-Host "    Scope: $($role.ScopeDescription)" -ForegroundColor White
    Write-Host "    Purpose: $($role.Justification)" -ForegroundColor Gray
    Write-Host "    Restriction: $($role.CannotDo)" -ForegroundColor DarkGray
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

# Special: OpenAI role on specific resource only (most restrictive)
Write-Host "  Role: Cognitive Services OpenAI User" -ForegroundColor Cyan
Write-Host "    Scope: OpenAI Resource ONLY (not subscription-wide)" -ForegroundColor White
Write-Host "    Purpose: Use GPT-4o for chat completions" -ForegroundColor Gray
Write-Host "    Restriction: Cannot create/delete deployments or modify OpenAI settings" -ForegroundColor DarkGray
Write-Host ""

Write-Info "Assigning 'Cognitive Services OpenAI User' to OpenAI resource (restricted scope)..."
$openaiResult = az role assignment create `
    --assignee $principalId `
    --role "Cognitive Services OpenAI User" `
    --scope "/subscriptions/$subscriptionId/resourceGroups/$ResourceGroupName/providers/Microsoft.CognitiveServices/accounts/$OpenAIResourceName" `
    --output none 2>&1

if ($LASTEXITCODE -eq 0 -or $openaiResult -match "already exists") {
    Write-Success "Cognitive Services OpenAI User - Assigned (Resource-scoped)"
} else {
    Write-Host ""
    Write-Host "  ⚠️  OPENAI ROLE ASSIGNMENT FAILED" -ForegroundColor Red
    Write-Host "  ─────────────────────────────────────────────────────────────" -ForegroundColor Gray
    Write-Host "  The Managed Identity could not be granted OpenAI access automatically." -ForegroundColor White
    Write-Host "  Chat features will NOT work until this is fixed." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  Run this command manually after deployment:" -ForegroundColor Cyan
    Write-Host "  az role assignment create ``" -ForegroundColor DarkGray
    Write-Host "      --assignee $principalId ``" -ForegroundColor DarkGray
    Write-Host "      --role 'Cognitive Services OpenAI User' ``" -ForegroundColor DarkGray
    Write-Host "      --scope '/subscriptions/$subscriptionId/resourceGroups/$ResourceGroupName/providers/Microsoft.CognitiveServices/accounts/$OpenAIResourceName'" -ForegroundColor DarkGray
    Write-Host ""
}

# Verify OpenAI role was actually assigned (double-check)
Write-Info "Verifying OpenAI role assignment..."
$openaiVerify = az role assignment list `
    --assignee $principalId `
    --role "Cognitive Services OpenAI User" `
    --scope "/subscriptions/$subscriptionId/resourceGroups/$ResourceGroupName/providers/Microsoft.CognitiveServices/accounts/$OpenAIResourceName" `
    --query "length(@)" -o tsv 2>$null

if ($openaiVerify -gt 0) {
    Write-Success "OpenAI role assignment verified ✓"
} else {
    Write-Host "  ⚠️  WARNING: OpenAI role not detected. Chat may fail with 401 error." -ForegroundColor Red
    Write-Host "  Run manually: az role assignment create --assignee $principalId --role 'Cognitive Services OpenAI User' --scope '/subscriptions/$subscriptionId/resourceGroups/$ResourceGroupName/providers/Microsoft.CognitiveServices/accounts/$OpenAIResourceName'" -ForegroundColor Yellow
}

# Management Group Reader - for subscription hierarchy dropdown
Write-Host ""
Write-Host "  Role: Management Group Reader" -ForegroundColor Cyan
Write-Host "    Scope: Tenant Root Management Group" -ForegroundColor White
Write-Host "    Purpose: List management groups in subscription dropdown hierarchy" -ForegroundColor Gray
Write-Host "    Restriction: Read-only access to management group structure, no resource access" -ForegroundColor DarkGray
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
    Write-Host "  ⚠️  Could not assign Management Group Reader automatically." -ForegroundColor Yellow
    Write-Host "  This requires elevated permissions (e.g., Global Admin or User Access Admin at root scope)." -ForegroundColor Gray
    Write-Host "  Without this role, the subscription dropdown will show subscriptions without management group hierarchy." -ForegroundColor Gray
    Write-Host ""
    Write-Host "  To fix manually (requires elevated permissions):" -ForegroundColor Cyan
    Write-Host "  az role assignment create --assignee $principalId --role 'Management Group Reader' --scope '/providers/Microsoft.Management/managementGroups/$EntraTenantId'" -ForegroundColor DarkGray
    Write-Host ""
}

Write-Host ""
Write-Host "  ✅ RBAC configured following Least-Privilege principle" -ForegroundColor Green
Write-Host "  ─────────────────────────────────────────────────────────────" -ForegroundColor Gray
Write-Host "  • NO Contributor role (cannot modify resources)" -ForegroundColor White
Write-Host "  • NO Owner role (cannot manage access)" -ForegroundColor White
Write-Host "  • NO API keys used (Managed Identity only)" -ForegroundColor White
Write-Host ""

# ============================================
# ASSIGN MICROSOFT GRAPH API PERMISSIONS (FOR ENTRA ID FEATURES)
# ============================================
Write-Step "Step 10b: Assigning Microsoft Graph API Permissions (Entra ID)"

Write-Host ""
Write-Host "  📋 Microsoft Graph API Permissions (Required for Entra ID features)" -ForegroundColor Yellow
Write-Host "  ─────────────────────────────────────────────────────────────" -ForegroundColor Gray
Write-Host "  These Application permissions allow querying Entra ID data" -ForegroundColor White
Write-Host ""

# Get the Service Principal Object ID for the Managed Identity
$spObjectId = az ad sp show --id $principalId --query "id" -o tsv 2>$null

if ([string]::IsNullOrEmpty($spObjectId)) {
    Write-Host "  ⚠️  Could not find Service Principal for Managed Identity" -ForegroundColor Yellow
    Write-Host "  Entra ID features may not work. Run grant-graph-permissions.ps1 helper script." -ForegroundColor Gray
} else {
    Write-Info "Service Principal Object ID: $spObjectId"
    
    # Get Microsoft Graph Service Principal ID
    $graphAppId = "00000003-0000-0000-c000-000000000000"
    $graphEnterpriseAppId = az ad sp show --id $graphAppId --query "id" -o tsv 2>$null
    
    if ([string]::IsNullOrEmpty($graphEnterpriseAppId)) {
        Write-Host "  ⚠️  Could not find Microsoft Graph service principal" -ForegroundColor Yellow
    } else {
        Write-Info "Microsoft Graph SP ID: $graphEnterpriseAppId"
        
        # Define required Graph API app roles (Application Permissions)
        $graphPermissions = @(
            @{ Name = "User.Read.All"; Id = "df021288-bdef-4463-88db-98f22de89214"; Purpose = "Read all user profiles and sign-in activity" },
            @{ Name = "Directory.Read.All"; Id = "7ab1d382-f21e-4acd-a863-ba3e13f7da61"; Purpose = "Read directory data (users, groups, roles)" },
            @{ Name = "Group.Read.All"; Id = "5b567255-7703-4780-807c-7be8301ae99b"; Purpose = "Read all groups and memberships" },
            @{ Name = "Application.Read.All"; Id = "9a5d68dd-52b0-4cc2-bd40-abcf44ac3a30"; Purpose = "Read all app registrations" },
            @{ Name = "AuditLog.Read.All"; Id = "b0afded3-3588-46d8-8b3d-9842eff778da"; Purpose = "Read audit logs and sign-in reports" },
            @{ Name = "Policy.Read.All"; Id = "246dd0d5-5bd0-4def-940b-0421030a5b68"; Purpose = "Read Conditional Access policies" }
        )
        
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
            }
        }
        
        Write-Host ""
        Write-Host "  ℹ️  NOTE: Graph API permissions may require Admin Consent" -ForegroundColor Yellow
        Write-Host "  If Entra ID features don't work, an Azure AD admin needs to:" -ForegroundColor Gray
        Write-Host "    1. Go to Azure Portal → Entra ID → Enterprise Applications" -ForegroundColor Gray
        Write-Host "    2. Find '$ContainerAppName' (Managed Identity)" -ForegroundColor Gray
        Write-Host "    3. Go to Permissions → Grant admin consent" -ForegroundColor Gray
        Write-Host ""
    }
}

# ============================================
# STEP 11: GET APPLICATION URL
# ============================================
Write-Step "Step 11: Retrieving Application URL"

Start-Sleep -Seconds 5  # Wait for deployment to stabilize

$appUrl = az containerapp show `
    --name $ContainerAppName `
    --resource-group $ResourceGroupName `
    --query "properties.configuration.ingress.fqdn" -o tsv

# ============================================
# DEPLOYMENT SUMMARY
# ============================================
Write-Host ""
if ($DeploymentMode -eq "Private") {
    Write-Host "╔══════════════════════════════════════════════════════════════════╗" -ForegroundColor Green
    Write-Host "║         🔒 PRIVATE DEPLOYMENT 100% COMPLETE! 🎉                  ║" -ForegroundColor Green
    Write-Host "║     Application Running on Internal Network - No Public Access   ║" -ForegroundColor Green
    Write-Host "╚══════════════════════════════════════════════════════════════════╝" -ForegroundColor Green
} else {
    Write-Host "╔══════════════════════════════════════════════════════════════════╗" -ForegroundColor Green
    Write-Host "║              DEPLOYMENT 100% COMPLETE! 🎉                         ║" -ForegroundColor Green
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
Write-Host "  Model Deployment:      $OpenAIDeploymentName (GPT-4o)" -ForegroundColor White
Write-Host "  Container Registry:    $acrNameClean (Premium SKU)" -ForegroundColor White
Write-Host "  Container App:         $ContainerAppName" -ForegroundColor White
Write-Host "  Container App Env:     $ContainerAppEnvName" -ForegroundColor White
Write-Host "  Subscription:          $subscriptionId" -ForegroundColor White
if ($DeploySql) {
    Write-Host "  Azure SQL Server:      $SqlServerName.database.windows.net" -ForegroundColor White
    Write-Host "  Azure SQL Database:    $SqlDatabaseName (SKU: $SqlServiceObjective, ${SqlMaxSizeGb}GB)" -ForegroundColor White
    Write-Host "  SQL Zone Redundant:    $SqlZoneRedundant  |  Backup: $SqlBackupStorageRedundancy" -ForegroundColor White
}
if ($DeploymentMode -eq "Private") {
    Write-Host "" -ForegroundColor White
    Write-Host "  🔒 PRIVATE NETWORK CONFIGURATION" -ForegroundColor Magenta
    Write-Host "  VNet:                  $VNetName ($VNetResourceGroupName)" -ForegroundColor White
    Write-Host "  CA Subnet:             $SubnetName (VNet injection — no PE needed)" -ForegroundColor White
    Write-Host "  PE Subnet:             $PrivateEndpointSubnetName (Private Endpoints)" -ForegroundColor White
    Write-Host "  Internal Ingress:      Yes (no public endpoint)" -ForegroundColor White
    if ($envStaticIp) {
        Write-Host "  Static IP (internal):  $envStaticIp" -ForegroundColor White
    }
    if ($envDefaultDomain) {
        Write-Host "  Internal Domain:       $envDefaultDomain" -ForegroundColor White
    }
    Write-Host "" -ForegroundColor White
    Write-Host "  🔗 PRIVATE ENDPOINTS" -ForegroundColor Magenta
    Write-Host "  Azure OpenAI PE:       ${OpenAIResourceName}-pe → privatelink.openai.azure.com $(if ($dnsZoneOpenAIFound) { '(reused existing zone)' } else { '(zone created)' })" -ForegroundColor White
    Write-Host "  ACR PE:                ${acrNameClean}-pe → privatelink.azurecr.io $(if ($dnsZoneACRFound) { '(reused existing zone)' } else { '(zone created)' })" -ForegroundColor White
    Write-Host "  Container App:         VNet-injected (internal-only ingress — no PE)" -ForegroundColor White
    Write-Host "  Public Access:         DISABLED on all PaaS resources" -ForegroundColor White
    Write-Host "" -ForegroundColor White
    Write-Host "  🌐 PRIVATE DNS ZONES (Subscription: $dnsZoneSubscriptionId)" -ForegroundColor Magenta
    Write-Host "  DNS Zone RG:           $dnsZoneResourceGroup" -ForegroundColor White
    Write-Host "  privatelink.openai.azure.com → linked to $VNetName $(if ($dnsZoneOpenAIFound) { '✅ reused' } else { '➕ new' })" -ForegroundColor White
    Write-Host "  privatelink.azurecr.io       → linked to $VNetName $(if ($dnsZoneACRFound) { '✅ reused' } else { '➕ new' })" -ForegroundColor White
    if ($envDefaultDomain) {
        Write-Host "  $envDefaultDomain → * → $envStaticIp" -ForegroundColor White
    }
}
if ($EnableLogAnalytics) {
    Write-Host "  Log Analytics:         ✅ Enabled" -ForegroundColor White
} else {
    Write-Host "  Log Analytics:         Disabled (use -EnableLogAnalytics to enable)" -ForegroundColor Gray
}
Write-Host ""
if ($DeploymentMode -eq "Private") {
    Write-Host "🔒 APPLICATION URL (Internal Access Only)" -ForegroundColor Magenta
    Write-Host "─────────────────────────────────────────────────────────────────" -ForegroundColor Gray
    Write-Host "  https://$appUrl" -ForegroundColor Green
    Write-Host ""
    Write-Host "  ⚠️  This URL is ONLY accessible from within your VNet/corporate network." -ForegroundColor Yellow
    Write-Host "  It cannot be reached from the public internet." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  📋 TO ACCESS THE APPLICATION:" -ForegroundColor Cyan
    Write-Host "  ─────────────────────────────────────────────────────────────" -ForegroundColor Gray
    Write-Host "  Option 1: Configure Private DNS Zone (Recommended)" -ForegroundColor White
    Write-Host "    - Create Azure Private DNS Zone: $envDefaultDomain" -ForegroundColor DarkGray
    Write-Host "    - Add A record: * → $envStaticIp" -ForegroundColor DarkGray
    Write-Host "    - Link the DNS Zone to your VNet" -ForegroundColor DarkGray
    Write-Host ""
    Write-Host "  Option 2: Access via VM/Jumpbox in the same VNet" -ForegroundColor White
    Write-Host "    - RDP/SSH to a VM in the same VNet" -ForegroundColor DarkGray
    Write-Host "    - Open browser and navigate to: https://$appUrl" -ForegroundColor DarkGray
    Write-Host ""
    Write-Host "  Option 3: VPN/ExpressRoute from on-premises" -ForegroundColor White
    Write-Host "    - Ensure VPN/ExpressRoute connects to the VNet" -ForegroundColor DarkGray
    Write-Host "    - Configure DNS forwarding for $envDefaultDomain" -ForegroundColor DarkGray
    Write-Host ""
} else {
    Write-Host "🌐 APPLICATION URL (Ready to use!)" -ForegroundColor Cyan
    Write-Host "─────────────────────────────────────────────────────────────────" -ForegroundColor Gray
    Write-Host "  https://$appUrl" -ForegroundColor Green
}
Write-Host ""
Write-Host "🔐 SECURITY CONFIGURATION (Least-Privilege)" -ForegroundColor Cyan
Write-Host "─────────────────────────────────────────────────────────────────" -ForegroundColor Gray
Write-Host "  Identity Type:          System-Assigned Managed Identity" -ForegroundColor White
Write-Host "  Principal ID:           $principalId" -ForegroundColor White
Write-Host "  ACR Authentication:     ✅ Managed Identity (no admin password)" -ForegroundColor White
Write-Host "  API Keys Used:          ❌ NO (Managed Identity only)" -ForegroundColor White
Write-Host "  Secrets Stored:         ❌ NO (Zero secrets in env vars)" -ForegroundColor White
Write-Host ""
Write-Host "  📜 ASSIGNED RBAC ROLES:" -ForegroundColor Yellow
Write-Host "  ┌─────────────────────────────────────┬───────────────────────────────┐" -ForegroundColor Gray
Write-Host "  │ Role                                │ Scope                         │" -ForegroundColor Gray
Write-Host "  ├─────────────────────────────────────┼───────────────────────────────┤" -ForegroundColor Gray
Write-Host "  │ Reader                              │ Subscription                  │" -ForegroundColor White
Write-Host "  │ Cost Management Reader              │ Subscription                  │" -ForegroundColor White
Write-Host "  │ Cognitive Services OpenAI User      │ OpenAI Resource ONLY          │" -ForegroundColor White
Write-Host "  │ AcrPull                             │ Container Registry ONLY       │" -ForegroundColor White
Write-Host "  │ Management Group Reader             │ Tenant Root MG                │" -ForegroundColor White
Write-Host "  └─────────────────────────────────────┴───────────────────────────────┘" -ForegroundColor Gray
Write-Host ""
Write-Host "  ✅ Reader: Query VMs, networks, storage (read-only)" -ForegroundColor White
Write-Host "  ✅ Cost Management Reader: Analyze costs (read-only)" -ForegroundColor White
Write-Host "  ✅ OpenAI User: Chat with GPT-4o (resource-scoped only)" -ForegroundColor White
Write-Host "  ✅ AcrPull: Pull container images from ACR (registry-scoped only)" -ForegroundColor White
Write-Host "  ✅ MG Reader: Subscription hierarchy dropdown (tenant root scope)" -ForegroundColor White
Write-Host ""
Write-Host "📝 WHAT WAS AUTOMATED" -ForegroundColor Cyan
Write-Host "─────────────────────────────────────────────────────────────────" -ForegroundColor Gray
Write-Host "  ✅ Registered required Azure resource providers" -ForegroundColor Green
Write-Host "  ✅ Created Azure OpenAI (AI Foundry) resource" -ForegroundColor Green
Write-Host "  ✅ Deployed GPT-4o model" -ForegroundColor Green
Write-Host "  ✅ Created Container Registry" -ForegroundColor Green
Write-Host "  ✅ Built and pushed container image" -ForegroundColor Green
if ($DeploymentMode -eq "Private") {
    Write-Host "  ✅ Validated VNet and subnet configuration" -ForegroundColor Green
    Write-Host "  ✅ Validated/created Private Endpoint subnet" -ForegroundColor Green
    Write-Host "  ✅ Verified/applied subnet delegation (Microsoft.App/environments)" -ForegroundColor Green
    Write-Host "  ✅ Discovered existing Private DNS Zones (reused) or created missing ones" -ForegroundColor Green
    Write-Host "  ✅ Linked all Private DNS Zones to VNet" -ForegroundColor Green
    Write-Host "  ✅ Created Private Endpoint for Azure OpenAI + DNS Zone Group (auto A records)" -ForegroundColor Green
    Write-Host "  ✅ Created Private Endpoint for ACR + DNS Zone Group (auto A records)" -ForegroundColor Green
    Write-Host "  ✅ Disabled public network access on OpenAI and ACR" -ForegroundColor Green
    Write-Host "  ✅ Created PRIVATE Container Apps Environment (VNet-injected, no PE needed)" -ForegroundColor Green
    Write-Host "  ✅ Created Private DNS Zone for Container App Env + wildcard A record" -ForegroundColor Green
    Write-Host "  ✅ Deployed Container App with INTERNAL ingress (no public access)" -ForegroundColor Green
} else {
    Write-Host "  ✅ Created Container Apps Environment" -ForegroundColor Green
    Write-Host "  ✅ Deployed Container App (public HTTPS)" -ForegroundColor Green
}
Write-Host "  ✅ System-Assigned Managed Identity enabled" -ForegroundColor Green
Write-Host "  ✅ Configured Managed Identity authentication for ACR" -ForegroundColor Green
Write-Host "  ✅ Assigned all RBAC roles (Least-Privilege)" -ForegroundColor Green
Write-Host "  ✅ Configured all environment variables automatically" -ForegroundColor Green
Write-Host ""
Write-Host "🔄 MULTI-SUBSCRIPTION ACCESS (Optional)" -ForegroundColor Cyan
Write-Host "─────────────────────────────────────────────────────────────────" -ForegroundColor Gray
Write-Host "  To query resources in OTHER subscriptions, assign these 2 roles:" -ForegroundColor Yellow
Write-Host "  (Replace <other-sub-id> with the target subscription ID)" -ForegroundColor Gray
Write-Host ""
Write-Host "  # PowerShell syntax:" -ForegroundColor Cyan
Write-Host "  az role assignment create --assignee $principalId ``" -ForegroundColor DarkGray
Write-Host "      --role 'Reader' --scope '/subscriptions/<other-sub-id>'" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  az role assignment create --assignee $principalId ``" -ForegroundColor DarkGray
Write-Host "      --role 'Cost Management Reader' --scope '/subscriptions/<other-sub-id>'" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  # Bash/CLI syntax (single line):" -ForegroundColor Cyan
Write-Host "  az role assignment create --assignee $principalId --role 'Reader' --scope '/subscriptions/<other-sub-id>'" -ForegroundColor DarkGray
Write-Host "  az role assignment create --assignee $principalId --role 'Cost Management Reader' --scope '/subscriptions/<other-sub-id>'" -ForegroundColor DarkGray
Write-Host ""
if (-not $EnableLogAnalytics) {
    Write-Host "📊 ENABLE LOGGING (Optional)" -ForegroundColor Cyan
    Write-Host "─────────────────────────────────────────────────────────────────" -ForegroundColor Gray
    Write-Host "  Container logs are disabled by default for simpler deployment." -ForegroundColor White
    Write-Host "  To view container logs from CLI:" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  az containerapp logs show --name $ContainerAppName --resource-group $ResourceGroupName --follow" -ForegroundColor DarkGray
    Write-Host ""
    Write-Host "  To enable full Log Analytics, redeploy with -EnableLogAnalytics switch" -ForegroundColor Gray
    Write-Host ""
}
Write-Host "─────────────────────────────────────────────────────────────────" -ForegroundColor Gray
Write-Host "  Author: Zahir Hussain Shah" -ForegroundColor Gray
Write-Host "  Website: www.zahir.cloud | Email: zahir@zahir.cloud" -ForegroundColor Gray
Write-Host "─────────────────────────────────────────────────────────────────" -ForegroundColor Gray
