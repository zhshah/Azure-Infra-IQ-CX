<#
.SYNOPSIS
    Provision everything the FinOps cost-export pipeline needs, idempotently.

.DESCRIPTION
    Cost data reaches SQL as follows:

        Azure Cost Management  --daily export-->  ADLS Gen2  --loader-->  Azure SQL

    The application creates and runs the exports itself, but it cannot create the
    landing storage account or grant itself permission. Without those, a fresh
    deployment starts with an empty FinOps section and no error that points at the
    cause. This script creates the missing pieces and wires the app settings.

    It is safe to re-run: the storage account name is derived deterministically from
    the resource group, so an existing deployment is detected rather than duplicated,
    and every role assignment and setting is applied with "already exists" tolerated.

.PARAMETER PrincipalId
    Object ID of the app's managed identity (the reader of the export files).

.PARAMETER SubscriptionIds
    Subscriptions whose cost should be exported. Each needs the resource provider
    registered and the identity granted rights to manage its exports.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$ResourceGroup,
    [Parameter(Mandatory)][string]$Location,
    [Parameter(Mandatory)][string]$PrincipalId,
    [Parameter(Mandatory)][string[]]$SubscriptionIds,
    [string]$StorageSubscriptionId,
    [string]$Container = 'cost-exports',
    [string]$AppName,
    [ValidateSet('webapp', 'containerapp', 'none')][string]$AppKind = 'none'
)

$ErrorActionPreference = 'Stop'
$warnings = [System.Collections.Generic.List[string]]::new()
function Say($text) { Write-Host "  $text" -ForegroundColor Gray }
function Ok($text) { Write-Host "  OK  $text" -ForegroundColor Green }
function Warn($text) { Write-Host "  WARNING: $text" -ForegroundColor Yellow; $warnings.Add($text) }

if (-not $StorageSubscriptionId) { $StorageSubscriptionId = (az account show --query id -o tsv) }
$targets = @($SubscriptionIds | Where-Object { $_ } | Select-Object -Unique)

Write-Host ""
Write-Host "FinOps cost-export pipeline" -ForegroundColor Cyan

# 1. Resource provider. Exports fail with "RP Not Registered" without this, on the
#    subscription that owns the storage account AND on each exported subscription.
foreach ($sid in (@($StorageSubscriptionId) + $targets | Select-Object -Unique)) {
    $state = az provider show --namespace Microsoft.CostManagementExports --subscription $sid --query registrationState -o tsv 2>$null
    if ($state -ne 'Registered') {
        az provider register --namespace Microsoft.CostManagementExports --subscription $sid --wait 2>&1 | Out-Null
        $state = az provider show --namespace Microsoft.CostManagementExports --subscription $sid --query registrationState -o tsv 2>$null
    }
    if ($state -eq 'Registered') { Ok "Microsoft.CostManagementExports registered on $($sid.Split('-')[0])" }
    else { Warn "Could not register Microsoft.CostManagementExports on $sid - exports will not run" }
}

# 2. Landing storage account. An account already tagged for this purpose in the group
#    is reused, so re-running (or running after a rename) cannot leave two accounts
#    collecting exports. Otherwise the name is derived from the resource group so the
#    result is still deterministic.
$storageName = az storage account list --resource-group $ResourceGroup --subscription $StorageSubscriptionId `
    --query "[?tags.purpose=='finops-cost-exports'] | [0].name" -o tsv 2>$null
if ($storageName) {
    Ok "Reusing existing cost-export storage account $storageName"
} else {
    $hash = [System.Security.Cryptography.SHA256]::HashData(
        [Text.Encoding]::UTF8.GetBytes("$StorageSubscriptionId/$ResourceGroup"))
    $storageName = 'iqcost' + (([BitConverter]::ToString($hash) -replace '-', '').Substring(0, 14).ToLower())

    $existing = az storage account show --name $storageName --resource-group $ResourceGroup --subscription $StorageSubscriptionId --query name -o tsv 2>$null
    if ($existing) {
        Ok "Storage account $storageName already present"
    } else {
        Say "Creating ADLS Gen2 storage account $storageName ..."
        az storage account create --name $storageName --resource-group $ResourceGroup `
            --subscription $StorageSubscriptionId --location $Location --sku Standard_LRS `
            --kind StorageV2 --enable-hierarchical-namespace true --min-tls-version TLS1_2 `
            --allow-blob-public-access false `
            --tags SecurityControl=Ignore purpose=finops-cost-exports --output none 2>&1 | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "Could not create the cost-export storage account $storageName" }
        Ok "Storage account $storageName created"
    }
}
$storageId = az storage account show --name $storageName --resource-group $ResourceGroup --subscription $StorageSubscriptionId --query id -o tsv

# 3. Container for the export files.
$key = az storage account keys list --account-name $storageName --resource-group $ResourceGroup --subscription $StorageSubscriptionId --query "[0].value" -o tsv 2>$null
if ($key) {
    az storage container create --account-name $storageName --account-key $key --name $Container --output none 2>&1 | Out-Null
    Ok "Container '$Container' ready"
} else {
    Warn "Could not read storage keys to create container '$Container'"
}

# 4. Permissions for the app identity.
#    Reader  -> read the export files.  Contributor roles -> create and target exports.
foreach ($role in @('Storage Blob Data Reader', 'Storage Account Contributor')) {
    $out = az role assignment create --assignee-object-id $PrincipalId --assignee-principal-type ServicePrincipal `
        --role $role --scope $storageId --output none 2>&1
    if ($LASTEXITCODE -eq 0 -or $out -match 'already exists') { Ok "$role on $storageName" }
    else { Warn "Could not assign '$role' on $storageName (needs Owner/User Access Administrator)" }
}
foreach ($sid in $targets) {
    $out = az role assignment create --assignee-object-id $PrincipalId --assignee-principal-type ServicePrincipal `
        --role "Cost Management Contributor" --scope "/subscriptions/$sid" --output none 2>&1
    if ($LASTEXITCODE -eq 0 -or $out -match 'already exists') { Ok "Cost Management Contributor on $($sid.Split('-')[0])" }
    else { Warn "Could not assign 'Cost Management Contributor' on $sid - the app cannot create that subscription's export" }
}

# 5. Tell the application where the exports land.
$settings = [ordered]@{
    FINOPS_EXPORT_ACCOUNT    = $storageName
    FINOPS_EXPORT_CONTAINER  = $Container
    FINOPS_EXPORT_STORAGE_ID = $storageId
}
if ($AppKind -eq 'webapp' -and $AppName) {
    $pairs = $settings.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" }
    az webapp config appsettings set --name $AppName --resource-group $ResourceGroup `
        --subscription $StorageSubscriptionId --settings @pairs --output none 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) { Ok "App settings applied to $AppName" } else { Warn "Could not set app settings on $AppName" }
} elseif ($AppKind -eq 'containerapp' -and $AppName) {
    $pairs = $settings.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" }
    az containerapp update --name $AppName --resource-group $ResourceGroup `
        --subscription $StorageSubscriptionId --set-env-vars @pairs --output none 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) { Ok "Environment variables applied to $AppName" } else { Warn "Could not set environment variables on $AppName" }
} else {
    Say "Set these on the app yourself:"
    $settings.GetEnumerator() | ForEach-Object { Say "    $($_.Key)=$($_.Value)" }
}

Write-Host ""
if ($warnings.Count) {
    Write-Host "Cost-export pipeline provisioned with $($warnings.Count) warning(s); cost data may be incomplete until resolved." -ForegroundColor Yellow
} else {
    Write-Host "Cost-export pipeline ready. The app creates its own exports and loads them within 30 minutes." -ForegroundColor Green
}

[ordered]@{
    storageAccount = $storageName
    storageId      = $storageId
    container      = $Container
    settings       = $settings
    warnings       = $warnings
} | ConvertTo-Json -Depth 4
