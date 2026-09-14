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
    [string[]]$SubscriptionIds = @(
        '14c6c34f-edd7-4e75-86d5-d4c7d4a99510',
        '4641c577-f07c-4107-b7cb-e3a729cb52d3',
        'b28cc86b-8f84-47e5-a38a-b814b44d047e'
    ),
    [string]$StorageAccountId = '/subscriptions/b28cc86b-8f84-47e5-a38a-b814b44d047e/resourceGroups/rg-infraiq-swc-demo/providers/Microsoft.Storage/storageAccounts/infraiqcostexpqb2y2t',
    [string]$Container = 'cost-exports',
    [int]$BackfillMonths = 0,
    [switch]$RunNow
)
$ErrorActionPreference = 'Stop'

$apiVersion = '2023-08-01'
$az = { & 'C:\Program Files\Microsoft SDKs\Azure\CLI2\python.exe' -X utf8 -IBm azure.cli @args }
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
        $name = "infraiq-$($costType.ToLower())-daily-$short"
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
            $name = "infraiq-$($costType.ToLower())-hist-$stamp-$short"
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
