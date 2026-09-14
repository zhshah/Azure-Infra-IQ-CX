<#
.SYNOPSIS
    Creates the Cost Management exports that feed the FinOps warehouse.

.DESCRIPTION
    Extraction is done by Azure Cost Management Exports rather than by the web
    application. Each subscription gets a recurring daily month-to-date export for
    both ActualCost and AmortizedCost, written as partitioned CSV into the ADLS
    Gen2 landing container. The application never calls the Cost Management query
    API for bulk data; it only reads these files and loads them into Azure SQL.

    Month-to-date is used (not "yesterday") because Azure restates recent charges,
    so every daily run must reprocess the whole open billing period.

    -BackfillMonths additionally creates one-time Custom-timeframe exports for the
    preceding months and runs them once, so history arrives after recent data.

.NOTES
    Idempotent: re-running updates the existing export definitions in place.
#>
param(
    # Empty = every enabled subscription in the signed-in tenant, which is what the app
    # itself scans. Never hard-code subscription ids here: this script ships to customers.
    [string[]]$SubscriptionIds = @(),

    # Supply either the full resource id, or the account name plus its resource group.
    [string]$StorageAccountId = '',
    [string]$StorageAccountName = '',
    [string]$StorageResourceGroup = '',

    [string]$Container = 'cost-exports',
    [int]$BackfillMonths = 0,
    [switch]$RunNow
)
$ErrorActionPreference = 'Stop'

$apiVersion = '2023-08-01'
# Plain 'az' on PATH is the norm; fall back to the Windows installer's python entry point.
$azExe = (Get-Command az -ErrorAction SilentlyContinue)
if ($azExe) {
    $az = { & az @args }
} elseif (Test-Path 'C:\Program Files\Microsoft SDKs\Azure\CLI2\python.exe') {
    $az = { & 'C:\Program Files\Microsoft SDKs\Azure\CLI2\python.exe' -X utf8 -IBm azure.cli @args }
} else {
    throw 'Azure CLI not found. Install it, or run this from a shell where "az" is on PATH.'
}

# Resolve the export destination from whichever form the caller supplied.
if (-not $StorageAccountId) {
    if (-not $StorageAccountName) {
        throw 'Supply -StorageAccountId, or -StorageAccountName together with -StorageResourceGroup. This is the storage account the deployment created for cost exports (app setting FINOPS_EXPORT_ACCOUNT).'
    }
    $lookup = @('storage', 'account', 'show', '--name', $StorageAccountName, '--query', 'id', '-o', 'tsv')
    if ($StorageResourceGroup) { $lookup += @('--resource-group', $StorageResourceGroup) }
    $StorageAccountId = (& $az @lookup 2>$null)
    if (-not $StorageAccountId) { throw "Storage account '$StorageAccountName' not found." }
}
Write-Host "  export destination : $(($StorageAccountId -split '/')[-1]) / $Container"

# Must match finops_export_ingestion_service._deployment_tag(): sha256 of the storage
# account name, first 6 hex. Keeps each deployment's exports separate from any other
# Infra IQ instance scanning the same subscription.
$exportStorageName = ($StorageAccountId -split '/')[-1]
$tagBytes = [System.Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($exportStorageName))
$deploymentTag = (([BitConverter]::ToString($tagBytes) -replace '-', '').Substring(0, 6).ToLower())
Write-Host "  deployment tag     : $deploymentTag"

# Default to whatever the signed-in identity can see, mirroring the app's own discovery.
if (-not $SubscriptionIds -or $SubscriptionIds.Count -eq 0) {
    $SubscriptionIds = @(& $az account list --query "[?state=='Enabled'].id" -o tsv 2>$null) | Where-Object { $_ }
    if (-not $SubscriptionIds) { throw 'No enabled subscriptions found. Pass -SubscriptionIds explicitly.' }
    Write-Host "  subscriptions      : $($SubscriptionIds.Count) discovered"
}

$token = (& $az account get-access-token --resource https://management.azure.com --query accessToken -o tsv)
if (-not $token) { throw 'Unable to acquire an ARM access token' }
$headers = @{ Authorization = "Bearer $token"; 'Content-Type' = 'application/json' }

function Invoke-Arm {
    param([string]$Method, [string]$Uri, [object]$Body)
    $arguments = @{ Method = $Method; Uri = $Uri; Headers = $headers; TimeoutSec = 120 }
    if ($Body) { $arguments.Body = ($Body | ConvertTo-Json -Depth 20 -Compress) }
    try { return Invoke-RestMethod @arguments }
    catch { throw ($_.ErrorDetails.Message ? $_.ErrorDetails.Message : $_.Exception.Message) }
}

function New-ExportBody {
    param([string]$CostType, [string]$FolderPath, [string]$Timeframe, [datetime]$From, [datetime]$To, [bool]$Recurring)
    $definition = [ordered]@{
        type      = $CostType
        timeframe = $Timeframe
        dataSet   = [ordered]@{ granularity = 'Daily' }
    }
    if ($Timeframe -eq 'Custom') {
        $definition.timePeriod = [ordered]@{
            from = $From.ToString('yyyy-MM-ddT00:00:00Z')
            to   = $To.ToString('yyyy-MM-ddT23:59:59Z')
        }
    }
    $properties = [ordered]@{
        format                = 'Csv'
        deliveryInfo          = [ordered]@{
            destination = [ordered]@{
                resourceId     = $StorageAccountId
                container      = $Container
                rootFolderPath = $FolderPath
            }
        }
        definition            = $definition
        partitionData         = $true
        dataOverwriteBehavior = 'OverwritePreviousReport'
    }
    if ($Recurring) {
        $properties.schedule = [ordered]@{
            status           = 'Active'
            recurrence       = 'Daily'
            recurrencePeriod = [ordered]@{
                from = (Get-Date).ToUniversalTime().AddMinutes(10).ToString('yyyy-MM-ddTHH:mm:ssZ')
                to   = (Get-Date).ToUniversalTime().AddYears(3).ToString('yyyy-MM-ddTHH:mm:ssZ')
            }
        }
    }
    else {
        $properties.schedule = [ordered]@{ status = 'Inactive' }
    }
    return @{ properties = $properties }
}

$results = [System.Collections.Generic.List[object]]::new()
foreach ($subscriptionId in $SubscriptionIds) {
    $scope = "/subscriptions/$subscriptionId"
    $short = $subscriptionId.Split('-')[0]

    foreach ($costType in @('ActualCost', 'AmortizedCost')) {
        $name = "infraiq-$($costType.ToLower())-daily-$short-$deploymentTag"
        $folder = "$($costType.ToLower())/$subscriptionId"
        $uri = "https://management.azure.com$scope/providers/Microsoft.CostManagement/exports/$($name)?api-version=$apiVersion"
        $body = New-ExportBody -CostType $costType -FolderPath $folder -Timeframe 'MonthToDate' -Recurring $true
        $response = Invoke-Arm -Method 'PUT' -Uri $uri -Body $body
        $results.Add([ordered]@{ subscription = $short; export = $name; kind = 'recurring-mtd'; folder = $folder; status = $response.properties.schedule.status })

        if ($RunNow) {
            Invoke-Arm -Method 'POST' -Uri "https://management.azure.com$scope/providers/Microsoft.CostManagement/exports/$name/run?api-version=$apiVersion" | Out-Null
            $results[$results.Count - 1].triggered = $true
        }
    }

    for ($offset = 1; $offset -le $BackfillMonths; $offset++) {
        $monthStart = (Get-Date -Day 1).Date.AddMonths(-$offset)
        $monthEnd = $monthStart.AddMonths(1).AddDays(-1)
        $stamp = $monthStart.ToString('yyyyMM')
        foreach ($costType in @('ActualCost', 'AmortizedCost')) {
            $name = "infraiq-$($costType.ToLower())-hist-$stamp-$short-$deploymentTag"
            $folder = "$($costType.ToLower())/$subscriptionId"
            $uri = "https://management.azure.com$scope/providers/Microsoft.CostManagement/exports/$($name)?api-version=$apiVersion"
            $body = New-ExportBody -CostType $costType -FolderPath $folder -Timeframe 'Custom' -From $monthStart -To $monthEnd -Recurring $false
            Invoke-Arm -Method 'PUT' -Uri $uri -Body $body | Out-Null
            Invoke-Arm -Method 'POST' -Uri "https://management.azure.com$scope/providers/Microsoft.CostManagement/exports/$name/run?api-version=$apiVersion" | Out-Null
            $results.Add([ordered]@{ subscription = $short; export = $name; kind = 'history'; folder = $folder; month = $monthStart.ToString('yyyy-MM'); triggered = $true })
        }
    }
}

[ordered]@{
    storageAccount = $StorageAccountId.Split('/')[-1]
    container      = $Container
    apiVersion     = $apiVersion
    exports        = $results
} | ConvertTo-Json -Depth 6
