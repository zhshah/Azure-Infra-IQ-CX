<#
.SYNOPSIS
    Grant Microsoft Graph API permissions to the App Service Managed Identity
    
.DESCRIPTION
    This script grants the required Microsoft Graph API Application permissions
    to the App Service's Managed Identity for Entra ID features to work.
    
    REQUIRES: Azure AD Global Administrator or Application Administrator role
    
.PARAMETER WebAppName
    Name of the Web App (default: app-askazure-cloudops)
    
.PARAMETER ResourceGroupName
    Resource group name (default: rg-askazure-cloudops)
    
.EXAMPLE
    .\grant-graph-permissions.ps1
    
.EXAMPLE
    .\grant-graph-permissions.ps1 -WebAppName "my-webapp" -ResourceGroupName "my-rg"
#>

param(
    [string]$WebAppName = "app-azure-cost-optimizer",
    [string]$ResourceGroupName = "rg-azure-cost-optimizer"
)

Write-Host ""
Write-Host "╔══════════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║     Grant Microsoft Graph API Permissions to Managed Identity    ║" -ForegroundColor Cyan
Write-Host "║     Required for Entra ID Features                               ║" -ForegroundColor Cyan
Write-Host "╚══════════════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# Step 1: Get the Managed Identity Principal ID
Write-Host "Step 1: Getting Managed Identity from Web App..." -ForegroundColor Yellow
$principalId = az webapp show --name $WebAppName --resource-group $ResourceGroupName --query "identity.principalId" -o tsv 2>$null

if ([string]::IsNullOrEmpty($principalId)) {
    Write-Host "❌ Could not find Web App '$WebAppName' in resource group '$ResourceGroupName'" -ForegroundColor Red
    Write-Host "   Verify the names and try again." -ForegroundColor Yellow
    exit 1
}
Write-Host "✅ Managed Identity Principal ID: $principalId" -ForegroundColor Green

# Step 2: Get the Service Principal Object ID
Write-Host ""
Write-Host "Step 2: Getting Service Principal Object ID..." -ForegroundColor Yellow
$spObjectId = az ad sp show --id $principalId --query "id" -o tsv 2>$null

if ([string]::IsNullOrEmpty($spObjectId)) {
    Write-Host "❌ Could not find Service Principal for this Managed Identity" -ForegroundColor Red
    exit 1
}
Write-Host "✅ Service Principal Object ID: $spObjectId" -ForegroundColor Green

# Step 3: Get Microsoft Graph Service Principal ID in this tenant
Write-Host ""
Write-Host "Step 3: Getting Microsoft Graph Service Principal..." -ForegroundColor Yellow
$graphAppId = "00000003-0000-0000-c000-000000000000"  # Microsoft Graph App ID (constant)
$graphSpId = az ad sp show --id $graphAppId --query "id" -o tsv 2>$null

if ([string]::IsNullOrEmpty($graphSpId)) {
    Write-Host "❌ Could not find Microsoft Graph Service Principal" -ForegroundColor Red
    exit 1
}
Write-Host "✅ Microsoft Graph SP ID: $graphSpId" -ForegroundColor Green

# Step 4: Define required permissions
Write-Host ""
Write-Host "Step 4: Granting Graph API Application Permissions..." -ForegroundColor Yellow
Write-Host ""

$permissions = @(
    @{ Name = "User.Read.All"; Id = "df021288-bdef-4463-88db-98f22de89214"; Purpose = "Read all users" },
    @{ Name = "Directory.Read.All"; Id = "7ab1d382-f21e-4acd-a863-ba3e13f7da61"; Purpose = "Read directory data" },
    @{ Name = "Group.Read.All"; Id = "5b567255-7703-4780-807c-7be8301ae99b"; Purpose = "Read all groups" },
    @{ Name = "Application.Read.All"; Id = "9a5d68dd-52b0-4cc2-bd40-abcf44ac3a30"; Purpose = "Read app registrations" },
    @{ Name = "AuditLog.Read.All"; Id = "b0afded3-3588-46d8-8b3d-9842eff778da"; Purpose = "Read audit/sign-in logs" },
    @{ Name = "Policy.Read.All"; Id = "246dd0d5-5bd0-4def-940b-0421030a5b68"; Purpose = "Read Conditional Access policies" }
)

$successCount = 0
$skipCount = 0
$failCount = 0

foreach ($perm in $permissions) {
    Write-Host "  Granting: $($perm.Name) - $($perm.Purpose)" -ForegroundColor Cyan
    
    # Create the request body
    $body = @{
        principalId = $spObjectId
        resourceId = $graphSpId
        appRoleId = $perm.Id
    } | ConvertTo-Json -Compress
    
    # Grant the permission using Microsoft Graph REST API
    $result = az rest --method POST `
        --uri "https://graph.microsoft.com/v1.0/servicePrincipals/$spObjectId/appRoleAssignments" `
        --headers "Content-Type=application/json" `
        --body $body 2>&1
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "    ✅ Granted" -ForegroundColor Green
        $successCount++
    } elseif ($result -match "Permission being assigned already exists" -or $result -match "already been granted") {
        Write-Host "    ⏭️  Already granted (skipped)" -ForegroundColor DarkGray
        $skipCount++
    } else {
        Write-Host "    ❌ Failed: $result" -ForegroundColor Red
        $failCount++
    }
}

# Summary
Write-Host ""
Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  SUMMARY" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  ✅ Granted:  $successCount permissions" -ForegroundColor Green
Write-Host "  ⏭️  Skipped:  $skipCount permissions (already granted)" -ForegroundColor DarkGray
Write-Host "  ❌ Failed:   $failCount permissions" -ForegroundColor $(if ($failCount -gt 0) { "Red" } else { "Green" })
Write-Host ""

if ($failCount -gt 0) {
    Write-Host "⚠️  Some permissions failed to grant." -ForegroundColor Yellow
    Write-Host "   This usually means you need Global Administrator role." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "   ALTERNATIVE: Grant consent via Azure Portal:" -ForegroundColor Cyan
    Write-Host "   1. Go to Azure Portal → Entra ID → Enterprise Applications" -ForegroundColor White
    Write-Host "   2. Search for '$WebAppName'" -ForegroundColor White
    Write-Host "   3. Go to Permissions → Grant admin consent for <tenant>" -ForegroundColor White
    Write-Host ""
} else {
    Write-Host "✅ All permissions granted successfully!" -ForegroundColor Green
    Write-Host ""
    Write-Host "🔄 Please restart the Web App for changes to take effect:" -ForegroundColor Yellow
    Write-Host "   az webapp restart --name $WebAppName --resource-group $ResourceGroupName" -ForegroundColor DarkGray
    Write-Host ""
    Write-Host "   Then test Entra ID queries again." -ForegroundColor White
}
