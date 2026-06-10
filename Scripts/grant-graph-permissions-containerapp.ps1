<#
.SYNOPSIS
    Grant Microsoft Graph API permissions to the Container App's Managed Identity.

.DESCRIPTION
    The Entra ID overview was returning 0 users / 0 groups / 0 devices / 0 app
    registrations while Enterprise Applications (service principals) showed a real
    count. That pattern means the managed identity could read /servicePrincipals
    but got HTTP 403 on /users, /groups, /devices and /applications - i.e. it was
    missing Microsoft Graph directory-read permissions.

    The original grant-graph-permissions.ps1 targeted an App Service
    (app-askazure-cloudops / rg-askazure-cloudops) - NOT the Container App that is
    actually running (cloudops-agent-prd / rg-askazure-prd-weu). So the grants
    landed on the wrong identity. This script targets the Container App's managed
    identity and also includes Device.Read.All.

    REQUIRES: Microsoft Entra Global Administrator or Privileged Role Administrator.

.PARAMETER ContainerAppName
    Name of the Container App (default: cloudops-agent-prd)

.PARAMETER ResourceGroupName
    Resource group name (default: rg-askazure-prd-weu)

.PARAMETER SubscriptionId
    Subscription that hosts the Container App (default: the test/dev sub).

.EXAMPLE
    .\grant-graph-permissions-containerapp.ps1

.EXAMPLE
    .\grant-graph-permissions-containerapp.ps1 -ContainerAppName "my-app" -ResourceGroupName "my-rg"
#>

param(
    [string]$ContainerAppName = "azure-infra-iq",
    [string]$ResourceGroupName = "rg-azure-infra-iq",
    [string]$SubscriptionId = ""
)

Write-Host ""
Write-Host "==================================================================" -ForegroundColor Cyan
Write-Host "  Grant Microsoft Graph API Permissions to Container App Identity" -ForegroundColor Cyan
Write-Host "  Required for Entra ID Features (users / groups / devices / apps)" -ForegroundColor Cyan
Write-Host "==================================================================" -ForegroundColor Cyan
Write-Host ""

# Step 0: Make sure we are on the right subscription
if (-not [string]::IsNullOrEmpty($SubscriptionId)) {
    Write-Host "Step 0: Setting subscription to $SubscriptionId ..." -ForegroundColor Yellow
    az account set --subscription $SubscriptionId 2>$null
}

# Step 1: Get the Managed Identity Principal ID from the Container App
Write-Host "Step 1: Getting Managed Identity from Container App..." -ForegroundColor Yellow
$principalId = az containerapp show --name $ContainerAppName --resource-group $ResourceGroupName --query "identity.principalId" -o tsv 2>$null

if ([string]::IsNullOrEmpty($principalId)) {
    Write-Host "[X] Could not find a system-assigned managed identity on Container App '$ContainerAppName' in '$ResourceGroupName'." -ForegroundColor Red
    Write-Host "    - Verify the names, or" -ForegroundColor Yellow
    Write-Host "    - If it uses a USER-assigned identity, grant the roles to that identity's principalId instead." -ForegroundColor Yellow
    Write-Host "      (az containerapp show ... --query identity.userAssignedIdentities)" -ForegroundColor DarkGray
    exit 1
}
Write-Host "[OK] Managed Identity Principal ID: $principalId" -ForegroundColor Green

# Step 2: Get the Service Principal Object ID for that identity
Write-Host ""
Write-Host "Step 2: Getting Service Principal Object ID..." -ForegroundColor Yellow
$spObjectId = az ad sp show --id $principalId --query "id" -o tsv 2>$null

if ([string]::IsNullOrEmpty($spObjectId)) {
    Write-Host "[X] Could not find a Service Principal for this Managed Identity." -ForegroundColor Red
    exit 1
}
Write-Host "[OK] Service Principal Object ID: $spObjectId" -ForegroundColor Green

# Step 3: Get Microsoft Graph Service Principal ID in this tenant
Write-Host ""
Write-Host "Step 3: Getting Microsoft Graph Service Principal..." -ForegroundColor Yellow
$graphAppId = "00000003-0000-0000-c000-000000000000"  # Microsoft Graph App ID (constant)
$graphSpId = az ad sp show --id $graphAppId --query "id" -o tsv 2>$null

if ([string]::IsNullOrEmpty($graphSpId)) {
    Write-Host "[X] Could not find Microsoft Graph Service Principal." -ForegroundColor Red
    exit 1
}
Write-Host "[OK] Microsoft Graph SP ID: $graphSpId" -ForegroundColor Green

# Step 4: Define required permissions (Application permissions / app roles)
Write-Host ""
Write-Host "Step 4: Granting Graph API Application Permissions..." -ForegroundColor Yellow
Write-Host ""

$permissions = @(
    @{ Name = "Directory.Read.All";   Id = "7ab1d382-f21e-4acd-a863-ba3e13f7da61"; Purpose = "Read directory data (users, groups, devices, apps)" },
    @{ Name = "User.Read.All";        Id = "df021288-bdef-4463-88db-98f22de89214"; Purpose = "Read all users" },
    @{ Name = "Group.Read.All";       Id = "5b567255-7703-4780-807c-7be8301ae99b"; Purpose = "Read all groups" },
    @{ Name = "Device.Read.All";      Id = "7438b122-aefc-4978-80ed-43db9fcc7715"; Purpose = "Read all devices" },
    @{ Name = "Application.Read.All"; Id = "9a5d68dd-52b0-4cc2-bd40-abcf44ac3a30"; Purpose = "Read app registrations & enterprise apps" },
    @{ Name = "AuditLog.Read.All";    Id = "b0afded3-3588-46d8-8b3d-9842eff778da"; Purpose = "Read audit / sign-in logs" },
    @{ Name = "Policy.Read.All";      Id = "246dd0d5-5bd0-4def-940b-0421030a5b68"; Purpose = "Read Conditional Access policies" }
)

$successCount = 0
$skipCount = 0
$failCount = 0

foreach ($perm in $permissions) {
    Write-Host "  Granting: $($perm.Name) - $($perm.Purpose)" -ForegroundColor Cyan

    $body = @{
        principalId = $spObjectId
        resourceId  = $graphSpId
        appRoleId   = $perm.Id
    } | ConvertTo-Json -Compress

    $result = az rest --method POST `
        --uri "https://graph.microsoft.com/v1.0/servicePrincipals/$spObjectId/appRoleAssignments" `
        --headers "Content-Type=application/json" `
        --body $body 2>&1

    if ($LASTEXITCODE -eq 0) {
        Write-Host "    [OK] Granted" -ForegroundColor Green
        $successCount++
    } elseif ($result -match "Permission being assigned already exists" -or $result -match "already been granted") {
        Write-Host "    [skip] Already granted" -ForegroundColor DarkGray
        $skipCount++
    } else {
        Write-Host "    [X] Failed: $result" -ForegroundColor Red
        $failCount++
    }
}

# Summary
Write-Host ""
Write-Host "===============================================================" -ForegroundColor Cyan
Write-Host "  SUMMARY" -ForegroundColor Cyan
Write-Host "===============================================================" -ForegroundColor Cyan
Write-Host "  Granted:  $successCount permissions" -ForegroundColor Green
Write-Host "  Skipped:  $skipCount permissions (already granted)" -ForegroundColor DarkGray
Write-Host "  Failed:   $failCount permissions" -ForegroundColor $(if ($failCount -gt 0) { "Red" } else { "Green" })
Write-Host ""

if ($failCount -gt 0) {
    Write-Host "[!] Some permissions failed to grant." -ForegroundColor Yellow
    Write-Host "    This usually means you need Global Administrator / Privileged Role Administrator." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "    ALTERNATIVE: Grant consent via Azure Portal:" -ForegroundColor Cyan
    Write-Host "    1. Azure Portal -> Microsoft Entra ID -> Enterprise Applications" -ForegroundColor White
    Write-Host "    2. Filter by 'Managed Identities' and search for '$ContainerAppName'" -ForegroundColor White
    Write-Host "    3. Permissions -> Grant admin consent for <tenant>" -ForegroundColor White
    Write-Host ""
} else {
    Write-Host "[OK] All permissions granted successfully!" -ForegroundColor Green
    Write-Host ""
    Write-Host "    Graph app-role assignments can take a few minutes to propagate." -ForegroundColor White
    Write-Host "    Restart the Container App revision to refresh the identity token:" -ForegroundColor Yellow
    Write-Host "      az containerapp revision restart --name $ContainerAppName --resource-group $ResourceGroupName --revision <active-revision>" -ForegroundColor DarkGray
    Write-Host ""
    Write-Host "    Then re-run 'Show Entra ID tenant overview' and confirm Users/Groups/Devices populate." -ForegroundColor White
}
