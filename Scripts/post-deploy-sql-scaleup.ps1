<#
.SYNOPSIS
    Post-deployment scale-up for the Azure SQL database (DTU -> General Purpose vCore).

.DESCRIPTION
    Run this AFTER the application has been deployed when the database was provisioned on a
    lightweight DTU tier (e.g. 'Basic') to get past a regional capacity gate
    ('RegionDoesNotAllowProvisioning'). It scales the database UP to the General Purpose
    vCore SKU used by deploy-automated.ps1 (default 'GP_Gen5_4'), keeping the same
    properties (backup storage redundancy 'Local') so the database matches a normal deploy.

    The change is an ONLINE operation - the database stays available, the connection string
    is unchanged, and no app redeploy is required.

.PARAMETER SubscriptionId
    Azure subscription ID that owns the SQL server.

.PARAMETER ResourceGroupName
    Resource group that contains the Azure SQL server.

.PARAMETER SqlServerName
    Name of the Azure SQL (logical) server that hosts the database.

.PARAMETER SqlDatabaseName
    Name of the database to scale up. Default 'infraiqdb' (matches deploy-automated.ps1).

.PARAMETER TargetServiceObjective
    Target service objective (SKU). Default 'GP_Gen5_4' (General Purpose, Gen5, 4 vCore) -
    the same SKU deploy-automated.ps1 uses for a normal deployment.

.PARAMETER BackupStorageRedundancy
    Backup storage redundancy to keep on the database. Default 'Local' (matches deploy-automated.ps1).

.PARAMETER NonInteractive
    Fail instead of prompting when a required value is missing (for automation).

.EXAMPLE
    ./post-deploy-sql-scaleup.ps1

.EXAMPLE
    ./post-deploy-sql-scaleup.ps1 -SubscriptionId <sub> -ResourceGroupName rg-azure-infra-iq-07 `
        -SqlServerName <server> -SqlDatabaseName infraiqdb

.NOTES
    Requires Azure CLI (az) and an authenticated session ('az login'). The scale-up from a
    DTU tier to vCore General Purpose is an online operation but can take a few minutes.
#>
[CmdletBinding()]
param(
    [string]$SubscriptionId,
    [string]$ResourceGroupName,
    [string]$SqlServerName,
    [string]$SqlDatabaseName = "infraiqdb",
    [string]$TargetServiceObjective = "GP_Gen5_4",
    [string]$BackupStorageRedundancy = "Local",
    [switch]$NonInteractive
)

# Native az calls report failure via $LASTEXITCODE; do not let stderr abort the script.
$ErrorActionPreference = "Continue"
try { $PSNativeCommandUseErrorActionPreference = $false } catch { }

# -- console helpers --------------------------------------------------------------
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
Write-Host "  Azure SQL - Post-Deploy Scale-Up (DTU -> General Purpose)" -ForegroundColor White
Write-Host "  Scales the database up to the General Purpose vCore SKU used by deploy-automated.ps1." -ForegroundColor DarkGray

# -- prerequisites ----------------------------------------------------------------
if (-not (Get-Command az -ErrorAction SilentlyContinue)) {
    Fail "Azure CLI ('az') not found. Install it from https://aka.ms/azcli and run 'az login' first."
}
$signedIn = az account show --query user.name -o tsv 2>$null
if ([string]::IsNullOrWhiteSpace($signedIn)) {
    Fail "Not signed in to Azure CLI. Run 'az login' first."
}

# -- gather inputs ----------------------------------------------------------------
Write-Step "Inputs"
$SubscriptionId    = Read-Required "Subscription ID"          $SubscriptionId
$ResourceGroupName = Read-Required "Resource group name"      $ResourceGroupName
$SqlServerName     = Read-Required "Azure SQL server name"    $SqlServerName
$SqlDatabaseName   = Read-Required "Azure SQL database name"  $SqlDatabaseName

# -- select subscription ----------------------------------------------------------
Write-Step "Selecting subscription"
az account set --subscription $SubscriptionId 2>$null
if ($LASTEXITCODE -ne 0) { Fail "Could not select subscription '$SubscriptionId'. Check the ID and your access." }
Write-Ok "Subscription: $SubscriptionId"

# -- validate database + read current SKU -----------------------------------------
Write-Step "Validating database '$SqlDatabaseName' on server '$SqlServerName'"
$dbJson = az sql db show --name $SqlDatabaseName --server $SqlServerName --resource-group $ResourceGroupName -o json 2>$null
if ([string]::IsNullOrWhiteSpace($dbJson)) {
    Fail "Database '$SqlDatabaseName' on server '$SqlServerName' was not found in resource group '$ResourceGroupName'. Check the names and try again."
}
$dbObj = $null
try { $dbObj = $dbJson | ConvertFrom-Json } catch { }
$currentObjective = if ($dbObj) { $dbObj.currentServiceObjectiveName } else { "" }
$currentEdition   = if ($dbObj) { $dbObj.edition } else { "" }
$currentRedund    = if ($dbObj -and $dbObj.currentBackupStorageRedundancy) { $dbObj.currentBackupStorageRedundancy }
                    elseif ($dbObj) { $dbObj.requestedBackupStorageRedundancy } else { "" }
Write-Ok "Current SKU: $currentObjective ($currentEdition)$(if($currentRedund){"  backup-redundancy: $currentRedund"})"

# -- already at target? -----------------------------------------------------------
if ($currentObjective -eq $TargetServiceObjective) {
    Write-Ok "Database is already on '$TargetServiceObjective' - nothing to do."
    Write-Host ""
    exit 0
}

# -- scale-up plan ----------------------------------------------------------------
Write-Step "Scale-up plan"
Write-Info "Database:   $SqlServerName/$SqlDatabaseName"
Write-Info "From SKU:   $currentObjective ($currentEdition)"
Write-Info "To SKU:     $TargetServiceObjective (General Purpose)   backup-redundancy: $BackupStorageRedundancy"
Write-Info "Online operation - no downtime, the connection string is unchanged. It can take a few minutes."

# -- scale up ---------------------------------------------------------------------
Write-Step "Scaling '$SqlDatabaseName' -> $TargetServiceObjective"
$out = az sql db update --name $SqlDatabaseName --server $SqlServerName --resource-group $ResourceGroupName `
    --service-objective $TargetServiceObjective --backup-storage-redundancy $BackupStorageRedundancy -o none 2>&1
if ($LASTEXITCODE -ne 0) {
    Fail ("Failed to scale the database to '$TargetServiceObjective'. " + (First-Line ($out | Out-String)))
}
Write-Ok "Scale-up request accepted."

# -- verify -----------------------------------------------------------------------
Write-Step "Verifying new SKU"
$newObjective = ""
for ($try = 1; $try -le 12; $try++) {
    $newObjective = az sql db show --name $SqlDatabaseName --server $SqlServerName --resource-group $ResourceGroupName --query "currentServiceObjectiveName" -o tsv 2>$null
    if ($newObjective -eq $TargetServiceObjective) { break }
    Start-Sleep -Seconds 15
}
if ($newObjective -eq $TargetServiceObjective) {
    Write-Ok "Database '$SqlDatabaseName' is now on '$TargetServiceObjective' (General Purpose)."
} else {
    Write-Warn2 "Scale-up was accepted; the SKU is still transitioning (currently '$newObjective'). It will finish shortly - re-check with:"
    Write-Info  "  az sql db show --name $SqlDatabaseName --server $SqlServerName --resource-group $ResourceGroupName --query currentServiceObjectiveName -o tsv"
}

# -- summary ----------------------------------------------------------------------
Write-Step "Done"
Write-Ok "SQL scale-up complete: $SqlServerName/$SqlDatabaseName -> $TargetServiceObjective."
Write-Info "The connection string is unchanged; the app needs no redeploy."
Write-Host ""
