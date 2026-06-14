<#
.SYNOPSIS
    Post-deployment scale-up for an Azure Container Apps (workload-profiles) environment.

.DESCRIPTION
    Run this AFTER the application has been deployed. It adds a dedicated D-series
    workload profile to an existing Container Apps *workload-profiles* environment,
    always trying the LARGEST SKU first and falling back to a smaller one only if the
    larger profile cannot be provisioned (typically regional / subscription quota):

        1st  ->  D8 x 2   (8 vCPU / 32 GiB per node, 2 nodes)
        2nd  ->  D8 x 1   (8 vCPU / 32 GiB, 1 node)
        3rd  ->  D4 x 2   (4 vCPU / 16 GiB per node, 2 nodes)
        last ->  D4 x 1   (4 vCPU / 16 GiB, 1 node)

    The highest profile the environment can satisfy is kept. The profile is named
    'infraiq-d8' or 'infraiq-d4' (matching deploy-automated.ps1, so a later redeploy
    re-uses it instead of creating a duplicate). Pass -WorkloadProfileBaseName to
    change the prefix.

    Optionally (-ContainerAppName) the script also moves a container app onto the new
    profile so the scale-up takes effect immediately.

.PARAMETER SubscriptionId
    Azure subscription ID that owns the environment.

.PARAMETER ResourceGroupName
    Resource group that contains the Container Apps environment.

.PARAMETER ContainerAppEnvName
    Name of the Container Apps (workload-profiles) environment to scale up.

.PARAMETER ContainerAppName
    (Optional) A container app in the environment to move onto the new profile.

.PARAMETER WorkloadProfileBaseName
    (Optional) Prefix for the created profile name. Default 'infraiq'
    (-> 'infraiq-d8' / 'infraiq-d4').

.PARAMETER NonInteractive
    Fail instead of prompting when a required value is missing (for automation).

.EXAMPLE
    ./post-deploy-activities.ps1

.EXAMPLE
    ./post-deploy-activities.ps1 -SubscriptionId <sub> -ResourceGroupName rg-infraiq-release `
        -ContainerAppEnvName azure-infra-iq-env -ContainerAppName az-infraiq-res

.NOTES
    Requires Azure CLI (az) with the 'containerapp' extension and an authenticated
    session ('az login'). Dedicated D-series nodes incur cost while provisioned.
#>
[CmdletBinding()]
param(
    [string]$SubscriptionId,
    [string]$ResourceGroupName,
    [string]$ContainerAppEnvName,
    [string]$ContainerAppName,
    [string]$WorkloadProfileBaseName = "infraiq",
    [switch]$NonInteractive
)

# Native az calls report failure via $LASTEXITCODE; do not let stderr abort the script.
$ErrorActionPreference = "Continue"
try { $PSNativeCommandUseErrorActionPreference = $false } catch { }

# ── console helpers ────────────────────────────────────────────────────────────
function Write-Step($m) { Write-Host "`n=== $m ===" -ForegroundColor Cyan }
function Write-Info($m) { Write-Host "  $m" -ForegroundColor Gray }
function Write-Ok($m)   { Write-Host "  [OK] $m" -ForegroundColor Green }
function Write-Warn2($m){ Write-Host "  [!] $m" -ForegroundColor Yellow }
function Fail($m)       { Write-Host "`n[X] $m" -ForegroundColor Red; exit 1 }

function Read-Required([string]$Label, [string]$Current) {
    if (-not [string]::IsNullOrWhiteSpace($Current)) { return $Current.Trim() }
    if ($NonInteractive) { Fail "Missing required value: $Label (pass it as a parameter when using -NonInteractive)." }
    $v = ""
    while ([string]::IsNullOrWhiteSpace($v)) { $v = (Read-Host "  Enter $Label").Trim() }
    return $v.Trim()
}

function First-Line([string]$text) {
    if ([string]::IsNullOrWhiteSpace($text)) { return "" }
    return (($text -split "`n") | Where-Object { $_.Trim() } | Select-Object -First 1).Trim()
}

Write-Host ""
Write-Host "  Azure Container Apps - Post-Deploy Scale-Up" -ForegroundColor White
Write-Host "  Adds the largest available dedicated D-series workload profile to an environment." -ForegroundColor DarkGray

# ── prerequisites ────────────────────────────────────────────────────────────
if (-not (Get-Command az -ErrorAction SilentlyContinue)) {
    Fail "Azure CLI ('az') not found. Install it from https://aka.ms/azcli and run 'az login' first."
}
$signedIn = az account show --query user.name -o tsv 2>$null
if ([string]::IsNullOrWhiteSpace($signedIn)) {
    Fail "Not signed in to Azure CLI. Run 'az login' first."
}

# ── gather inputs ──────────────────────────────────────────────────────────────
Write-Step "Inputs"
$SubscriptionId      = Read-Required "Subscription ID"                $SubscriptionId
$ResourceGroupName   = Read-Required "Resource group name"            $ResourceGroupName
$ContainerAppEnvName = Read-Required "Container Apps environment name" $ContainerAppEnvName
if (-not $NonInteractive -and [string]::IsNullOrWhiteSpace($ContainerAppName)) {
    $ContainerAppName = (Read-Host "  (Optional) Container app to move onto the new profile [Enter to skip]").Trim()
}

# ── select subscription ────────────────────────────────────────────────────────
Write-Step "Selecting subscription"
az account set --subscription $SubscriptionId 2>$null
if ($LASTEXITCODE -ne 0) { Fail "Could not select subscription '$SubscriptionId'. Check the ID and your access." }
Write-Ok "Subscription: $SubscriptionId"
az extension add --name containerapp --upgrade --only-show-errors 2>$null | Out-Null

# ── validate environment ───────────────────────────────────────────────────────
Write-Step "Validating environment '$ContainerAppEnvName'"
$envJson = az containerapp env show --name $ContainerAppEnvName --resource-group $ResourceGroupName -o json 2>$null
if ([string]::IsNullOrWhiteSpace($envJson)) {
    Fail "Container Apps environment '$ContainerAppEnvName' was not found in resource group '$ResourceGroupName'."
}
$envObj = $null
try { $envObj = $envJson | ConvertFrom-Json } catch { }
$envLocation = if ($envObj) { $envObj.location } else { "" }
$wpEnabled   = ($envObj -and $null -ne $envObj.properties.workloadProfiles)
if (-not $wpEnabled) {
    Fail "Environment '$ContainerAppEnvName' is a Consumption-only environment (no workload-profiles support). Dedicated D-series profiles require a workload-profiles environment."
}
Write-Ok "Environment '$ContainerAppEnvName' ($envLocation) is a workload-profiles environment."

# ── scale-up ladder (largest first) ─────────────────────────────────────────────
$ladder = @(
    [pscustomobject]@{ Label = "D8 x 2"; Type = "D8"; Nodes = 2; Cpu = "8.0"; Memory = "32.0Gi" },
    [pscustomobject]@{ Label = "D8 x 1"; Type = "D8"; Nodes = 1; Cpu = "8.0"; Memory = "32.0Gi" },
    [pscustomobject]@{ Label = "D4 x 2"; Type = "D4"; Nodes = 2; Cpu = "4.0"; Memory = "16.0Gi" },
    [pscustomobject]@{ Label = "D4 x 1"; Type = "D4"; Nodes = 1; Cpu = "4.0"; Memory = "16.0Gi" }
)

Write-Step "Creating the largest available dedicated workload profile"
Write-Info  "Trying largest-first:  D8 x 2  ->  D8 x 1  ->  D4 x 2  ->  D4 x 1"
Write-Warn2 "Dedicated D-series nodes incur cost while provisioned. The highest SKU that the region/quota allows is kept."

$chosen  = $null
$lastErr = ""
foreach ($rung in $ladder) {
    $profileName = "{0}-{1}" -f $WorkloadProfileBaseName, $rung.Type.ToLower()   # infraiq-d8 / infraiq-d4
    $nodeWord = if ($rung.Nodes -eq 1) { "node" } else { "nodes" }
    Write-Info "Attempting $($rung.Label)  (profile '$profileName', type $($rung.Type), $($rung.Nodes) $nodeWord)..."

    $out = az containerapp env workload-profile set `
        --name $ContainerAppEnvName --resource-group $ResourceGroupName `
        --workload-profile-name $profileName --workload-profile-type $rung.Type `
        --min-nodes $rung.Nodes --max-nodes $rung.Nodes -o none 2>&1
    if ($LASTEXITCODE -eq 0) {
        $chosen = [pscustomobject]@{
            Label = $rung.Label; Type = $rung.Type; Nodes = $rung.Nodes
            Cpu = $rung.Cpu; Memory = $rung.Memory; ProfileName = $profileName
        }
        Write-Ok "Provisioned workload profile '$profileName' = $($rung.Label)."
        break
    }

    $lastErr = ($out | Out-String)
    Write-Warn2 "$($rung.Label) could not be provisioned: $(First-Line $lastErr)"
    Write-Info  "Falling back to the next smaller SKU..."
}

if (-not $chosen) {
    Fail ("Could not create any dedicated workload profile (D8 x 2 / D8 x 1 / D4 x 2 / D4 x 1). " +
          "This usually means the region/subscription has no available D-series dedicated quota. Last error: $(First-Line $lastErr)")
}

# ── verify ──────────────────────────────────────────────────────────────────────
Write-Step "Verifying workload profile '$($chosen.ProfileName)'"
$listJson = az containerapp env workload-profile list --name $ContainerAppEnvName --resource-group $ResourceGroupName -o json 2>$null
$mine = $null
if (-not [string]::IsNullOrWhiteSpace($listJson)) {
    try { $mine = ($listJson | ConvertFrom-Json) | Where-Object { $_.name -eq $chosen.ProfileName } | Select-Object -First 1 } catch { }
}
if ($mine) {
    Write-Ok ("Profile '{0}': type={1}  min={2}  max={3}  currentNodes={4}" -f `
        $chosen.ProfileName, $mine.properties.workloadProfileType, $mine.properties.minimumCount, `
        $mine.properties.maximumCount, $mine.properties.currentNodeCount)
} else {
    Write-Warn2 "Profile created, but not yet listed (node provisioning can take a few minutes)."
}

# ── optional: move an app onto the new profile ───────────────────────────────────
if (-not [string]::IsNullOrWhiteSpace($ContainerAppName)) {
    Write-Step "Moving container app '$ContainerAppName' onto '$($chosen.ProfileName)'"
    $appJson = az containerapp show --name $ContainerAppName --resource-group $ResourceGroupName -o json 2>$null
    if ([string]::IsNullOrWhiteSpace($appJson)) {
        Write-Warn2 "Container app '$ContainerAppName' not found in '$ResourceGroupName' - skipping the move (the profile was still created)."
    } else {
        $mv = az containerapp update --name $ContainerAppName --resource-group $ResourceGroupName `
            --workload-profile-name $chosen.ProfileName -o none 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Ok "App '$ContainerAppName' now runs on '$($chosen.ProfileName)' ($($chosen.Label))."
            $fqdn = az containerapp show --name $ContainerAppName --resource-group $ResourceGroupName --query "properties.configuration.ingress.fqdn" -o tsv 2>$null
            if (-not [string]::IsNullOrWhiteSpace($fqdn)) { Write-Info "App URL: https://$fqdn" }
        } else {
            Write-Warn2 "Could not move the app automatically: $(First-Line ($mv | Out-String))"
            Write-Info  "Move it manually with:"
            Write-Info  "  az containerapp update --name $ContainerAppName --resource-group $ResourceGroupName --workload-profile-name $($chosen.ProfileName)"
        }
    }
}

# ── summary ───────────────────────────────────────────────────────────────────────
Write-Step "Done"
Write-Ok ("Scale-up complete. Kept the highest available profile: {0}  (name '{1}', {2} vCPU / {3} per node)." -f `
    $chosen.Label, $chosen.ProfileName, $chosen.Cpu, $chosen.Memory)
if ([string]::IsNullOrWhiteSpace($ContainerAppName)) {
    Write-Info "Point an app at it with:"
    Write-Info "  az containerapp update --name <app> --resource-group $ResourceGroupName --workload-profile-name $($chosen.ProfileName)"
}
Write-Info "Workload profiles now in the environment:"
az containerapp env workload-profile list --name $ContainerAppEnvName --resource-group $ResourceGroupName `
    --query "[].{name:name,type:properties.workloadProfileType,min:properties.minimumCount,max:properties.maximumCount,nodes:properties.currentNodeCount}" -o table 2>$null
Write-Host ""
Write-Info "To remove this profile later (when no app is using it):"
Write-Info  "  az containerapp env workload-profile delete --name $ContainerAppEnvName --resource-group $ResourceGroupName --workload-profile-name $($chosen.ProfileName)"
Write-Host ""
