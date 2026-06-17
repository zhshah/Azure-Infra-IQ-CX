#Requires -Version 5.1
# ==============================================================================
#  HOW TO EXECUTE  —  Azure Infra IQ deploy / fix / diagnostic script
#  (Keep this section — it is your quick reference for running the script.)
# ==============================================================================
#
#  PREREQUISITES
#    1. PowerShell 5.1+ (Windows PowerShell) or pwsh 7+.
#    2. Azure CLI installed AND signed in:   az login        (token expires ~daily)
#       For a specific tenant:               az login --tenant <TENANT_ID>
#    3. Run as the customer's GLOBAL ADMIN / OWNER to use the -Assign*/-Fix*/-Grant*
#       switches. Read-only "collect evidence" mode only needs Reader.
#    4. If scripts are blocked:  Set-ExecutionPolicy -Scope Process RemoteSigned
#
#  REQUIRED PARAMETERS  (everything else is auto-discovered from the resource group)
#    -SubscriptionId  <guid>    Customer subscription id.
#    -ResourceGroup   <name>    RG that holds the app + its private resources.
#
#  OPTIONAL OVERRIDES  (only if auto-discovery picks the wrong resource)
#    -ContainerAppName  -ContainerAppEnvName  -AcrName  -SqlServerName
#    -SqlDatabaseName   -OpenAiAccountName    -TenantId -OutputPath
#    -RepoPath  <local clone>   Use an EXISTING local clone (skips the auto-download).
#    -RepoUrl   <git url>       Repo to auto-download (default: https://github.com/zhshah/Azure-Infra-IQ-CX).
#    -RepoBranch <name>         Branch to use (default: the repo's default branch).
#    -CloneRoot <path>          Where to download the repo (default: .\infraiq-cx-src).
#
#  DEPLOY + FIX ARE ON BY DEFAULT (run as Global Admin / Owner). With no switches the script:
#    1. DIAGNOSES everything and writes a full evidence bundle (.zip) you can send for analysis;
#    2. ASSIGNS every permission the app needs - ARM roles (Reader, Cost Management Reader,
#       Monitoring Reader, AcrPull), the Azure OpenAI data-plane role, and Microsoft Graph app
#       roles - and wires ACR pull-by-identity;
#    3. AUTO-FIXES the Azure OpenAI endpoint/deployment env that causes the "AI 404" error;
#    4. AUTO-DOWNLOADS the repo (-RepoUrl), builds the latest image and swaps it onto the app
#       (new revision; the app is NEVER deleted);
#    5. grants SQL access + links private DNS zones where applicable.
#  Every step is RECORDED and the run CONTINUES even if a step fails. Works for BOTH public-access
#  and private-endpoint apps.
#
#  SWITCHES
#    -CollectOnly         READ-ONLY: diagnose + collect the evidence .zip; change NOTHING.
#    -SkipGraph           Do everything EXCEPT the Microsoft Graph app-role grants.
#    -GraphAppRoles       Override Graph app-roles to grant (default Directory.Read.All,User.Read.All).
#    -CreateOpenAiDeployment  If the account has NO model, create a gpt-4o deployment.
#    -DeployLatest / -AssignPermissions / -FixDnsLinks / -GrantSqlAccess
#                         Back-compat - these already run by default now.
#    -WhatIf              Preview every change and do NOTHING (dry run).
#    -Confirm             Ask Y/N before each individual change.
#
#  ──────────────────────────  SAMPLE COMMANDS  ────────────────────────────────
#
#  # 0) Sign in first (do this each day — the token expires):
#  az login
#
#  # 1) DEFAULT: diagnose, then download latest code + build + swap the image (public OR private):
#  .\Update-InfraIQ-Deployment.ps1 `
#       -SubscriptionId "00000000-0000-0000-0000-000000000000" `
#       -ResourceGroup  "rg-infra-iq"
#
#  # 1b) READ-ONLY collect-evidence (no changes). Then send the .zip back:
#  .\Update-InfraIQ-Deployment.ps1 -SubscriptionId <id> -ResourceGroup <rg> -CollectOnly
#
#  # 2) PREVIEW a full fix without changing anything (dry run):
#  .\Update-InfraIQ-Deployment.ps1 -SubscriptionId <id> -ResourceGroup <rg> `
#       -DeployLatest -AssignPermissions -FixDnsLinks -GrantSqlAccess -WhatIf
#
#  # 3) Assign the managed-identity roles only (common "dashboards empty" fix):
#  .\Update-InfraIQ-Deployment.ps1 -SubscriptionId <id> -ResourceGroup <rg> `
#       -AssignPermissions
#
#  # 4) Repair private DNS links + grant SQL access (private-endpoint fix):
#  .\Update-InfraIQ-Deployment.ps1 -SubscriptionId <id> -ResourceGroup <rg> `
#       -FixDnsLinks -GrantSqlAccess
#
#  # 5) FULL one-command run: AUTO-DOWNLOAD the repo, build & deploy, AND apply every fix
#  #    (no manual git clone needed; pulls https://github.com/zhshah/Azure-Infra-IQ-CX):
#  .\Update-InfraIQ-Deployment.ps1 -SubscriptionId <id> -ResourceGroup <rg> `
#       -DeployLatest -AssignPermissions -FixDnsLinks -GrantSqlAccess
#
#  ────────────────────────  RECOMMENDED 3-STEP FLOW  ──────────────────────────
#    STEP 1  Customer runs sample (1) COLLECT-ONLY -> sends you InfraIQ-Diag-*.zip
#    STEP 2  You analyse the bundle and pinpoint the exact root cause
#    STEP 3  Customer runs the targeted fix (sample 3, 4 or 5)
#
#  ─────────────────────────  PROMPTS YOU MAY SEE  ─────────────────────────────
#    * Browser / device-code sign-in from 'az login' (first run each day).
#    * With -Confirm: PowerShell asks "[Y] Yes  [A] Yes to All ..." per change.
#    * The SQL grant requires you to be the SQL Azure AD admin. If you are not,
#      the script saves the exact T-SQL to 'sql_grant_tsql.txt' to run from a
#      host INSIDE the VNet (jumpbox / VNet-joined Cloud Shell).
#
#  OUTPUT
#    A folder + zip  "InfraIQ-Diag-<timestamp>.zip"  in the current directory
#    (or -OutputPath). SEND THAT ZIP BACK for analysis. Env-var secrets are
#    masked, but review the contents before sharing.
# ==============================================================================
<#
.SYNOPSIS
    Azure Infra IQ — intelligent deep diagnostic, fixer and evidence collector for an
    EXISTING Container App whose backing resources (SQL, OpenAI, ACR) use PRIVATE ENDPOINTS.

.DESCRIPTION
    Run this on a machine signed in as the customer's Global Admin / Owner. By DEFAULT it is an
    end-to-end FIXER: it diagnoses, assigns every permission the app needs (ARM + Azure OpenAI +
    Microsoft Graph), auto-corrects the OpenAI endpoint/deployment env (the "AI 404" fix), wires
    ACR pull-by-identity, grants SQL + links private DNS where applicable, then downloads the
    latest code, builds a new image and swaps it onto the app - recording every step and
    CONTINUING past any failure. It always produces an evidence bundle (.zip) you can send back.
    Use -CollectOnly for a read-only run that changes nothing.

    It is "self-discovering": give it the Subscription + Resource Group and it finds the
    Container App, its environment, the ACR, the SQL server/db, the OpenAI account, the VNet,
    the private endpoints and the private DNS zones automatically (override any with a param).

    Because every backing resource is private-endpoint only, the analysis focuses on what
    actually breaks a private deployment:
      * Is the Container Apps ENVIRONMENT VNet-integrated?
      * Do private endpoints exist for SQL / OpenAI / ACR and are they Approved?
      * Are the matching private DNS zones (privatelink.database.windows.net,
        privatelink.openai.azure.com, privatelink.azurecr.io, ...) LINKED to the env's VNet?
        (If not, the app cannot resolve the private FQDNs -> "all dashboards empty" + ACR
         pull failures + OpenAI 404/unreachable. This is the #1 root cause.)
      * What do the app's own CONTAINER LOGS say (pyodbc / DNS / 403 errors)?
      * What roles does the app's managed identity actually hold?

    Everything is captured to JSON + a readable SUMMARY and zipped.

.PARAMETER SubscriptionId    (required) Customer subscription id.
.PARAMETER ResourceGroup     (required) RG that holds the app + (optional) private resources.
.PARAMETER CollectOnly       Read-only: run diagnostics + collect the evidence bundle, change NOTHING.
.PARAMETER DeployLatest      Back-compat. Deploy now runs by DEFAULT (clone latest -> build -> swap image); use -CollectOnly to skip.
.PARAMETER AssignPermissions Back-compat. Role assignment now runs by DEFAULT (ARM + Azure OpenAI + Graph). Global Admin/Owner.
.PARAMETER GrantSqlAccess    Back-compat. SQL grant now runs by DEFAULT; use -CollectOnly to skip.
.PARAMETER FixDnsLinks       Back-compat. Private-DNS linking now runs by DEFAULT where applicable.
.PARAMETER SkipGraph         Do everything except the Microsoft Graph app-role grants.
.PARAMETER GraphAppRoles     Which Graph application roles to grant the app identity (default: Directory.Read.All, User.Read.All).
.PARAMETER CreateOpenAiDeployment  If the OpenAI account has no model deployment, create a gpt-4o deployment.

.EXAMPLE
    # DEFAULT: diagnose, then download the latest code + build + swap the image on the existing app
    # (works for BOTH public-access and private-endpoint deployments):
    .\Update-InfraIQ-Deployment.ps1 -SubscriptionId <id> -ResourceGroup <rg>

.EXAMPLE
    # Read-only - collect a full evidence bundle, make NO changes (send the .zip back):
    .\Update-InfraIQ-Deployment.ps1 -SubscriptionId <id> -ResourceGroup <rg> -CollectOnly

.EXAMPLE
    # Full one-command fix: deploy latest (default) + assign roles + repair DNS + SQL:
    .\Update-InfraIQ-Deployment.ps1 -SubscriptionId <id> -ResourceGroup <rg> `
        -AssignPermissions -GrantSqlAccess -FixDnsLinks
#>
[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'Medium')]
param(
    [Parameter(Mandatory = $true)] [string] $SubscriptionId,
    [Parameter(Mandatory = $true)] [string] $ResourceGroup,

    # Optional — auto-discovered from the RG when omitted
    [string] $ContainerAppName,
    [string] $ContainerAppEnvName,
    [string] $AcrName,
    [string] $SqlServerName,
    [string] $SqlDatabaseName,
    [string] $OpenAiAccountName,
    [string] $TenantId,

    # Build / deploy (the repo is auto-downloaded unless -RepoPath is given)
    [string] $RepoPath,
    [string] $RepoUrl    = 'https://github.com/zhshah/Azure-Infra-IQ-CX',
    [string] $RepoBranch,
    [string] $CloneRoot,
    [string] $ImageName = 'azure-infra-iq',
    [string] $ImageTag  = ('fix-{0}' -f (Get-Date -Format 'yyyyMMdd-HHmm')),

    # Output
    [string] $OutputPath,

    # Mutating actions
    [switch] $DeployLatest,       # back-compat: deploy now runs by DEFAULT (see -CollectOnly)
    [switch] $AssignPermissions,
    [switch] $GrantSqlAccess,
    [switch] $FixDnsLinks,
    [switch] $FixSqlFirewall,

    # Read-only: run diagnostics + evidence bundle only; do NOT build/swap a new image
    [switch] $CollectOnly,

    # Fix tuning (fixes run by DEFAULT unless -CollectOnly). Use these to narrow/extend.
    [switch] $SkipGraph,                                                   # do NOT assign Microsoft Graph app roles
    [string[]] $GraphAppRoles = @('Directory.Read.All','User.Read.All'),   # Graph app-roles to grant the app identity
    [switch] $CreateOpenAiDeployment                                       # if the account has NO model deployment, create one (gpt-4o)
)

$ErrorActionPreference = 'Continue'
$ProgressPreference     = 'SilentlyContinue'
# Force UTF-8 I/O so `az acr build` can STREAM build logs that contain Unicode (e.g. the
# vite build's check-mark U+2713) without the Windows console (cp1252) raising a
# UnicodeEncodeError. That crash otherwise makes the build command exit NON-ZERO even
# though the image built + pushed fine, which then SKIPS the image swap — the #1 cause of
# "build failed but the image is actually in ACR". (Belt-and-suspenders: the deploy step
# below ALSO verifies the pushed tag, so the swap proceeds regardless.)
$env:PYTHONIOENCODING = 'utf-8'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }
if (-not $TenantId) { $TenantId = '' }

# ── Output folder + transcript ────────────────────────────────────────────────
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
if (-not $OutputPath) { $OutputPath = Join-Path (Get-Location) ("InfraIQ-Diag-{0}" -f $stamp) }
if (-not $CloneRoot)  { $CloneRoot  = Join-Path (Get-Location) 'infraiq-cx-src' }
New-Item -ItemType Directory -Force -Path $OutputPath | Out-Null
$transcript = Join-Path $OutputPath 'console-transcript.txt'
try { Start-Transcript -Path $transcript -Force | Out-Null } catch { }

$script:Results   = New-Object System.Collections.Generic.List[object]
$script:NextSteps = New-Object System.Collections.Generic.List[string]
$script:Diag      = [ordered]@{}
$script:Diag['meta'] = [ordered]@{ generatedUtc = (Get-Date).ToUniversalTime().ToString('o'); subscriptionId = $SubscriptionId; resourceGroup = $ResourceGroup; tool = 'Update-InfraIQ-Deployment.ps1'; version = '2.4' }
$script:OpenAiResourceId = $null

# ── Helpers ───────────────────────────────────────────────────────────────────
function Add-Result {
    param([string]$Check, [ValidateSet('PASS','WARN','FAIL','INFO','FIXED')] [string]$Status, [string]$Detail)
    $script:Results.Add([pscustomobject]@{ Check = $Check; Status = $Status; Detail = $Detail })
    $color = switch ($Status) { 'PASS' {'Green'} 'FIXED' {'Green'} 'WARN' {'Yellow'} 'FAIL' {'Red'} default {'Gray'} }
    Write-Host ("  [{0,-5}] {1}" -f $Status, $Check) -ForegroundColor $color
    if ($Detail) { Write-Host ("          {0}" -f $Detail) -ForegroundColor DarkGray }
}
function Write-Head { param([string]$Text); Write-Host ''; Write-Host ("== {0} " -f $Text).PadRight(78,'=') -ForegroundColor Cyan }

function Invoke-AzJson {
    param([string[]]$AzArgs)
    try { $raw = & az @AzArgs 2>$null } catch { return $null }
    if ($LASTEXITCODE -ne 0 -or -not $raw) { return $null }
    try { return ($raw | Out-String | ConvertFrom-Json) } catch { return $null }
}
function Invoke-AzText {
    param([string[]]$AzArgs)
    try { $raw = & az @AzArgs 2>&1 } catch { return @{ ok = $false; text = "$_" } }
    return @{ ok = ($LASTEXITCODE -eq 0); text = ($raw | Out-String) }
}
function Save-Json {
    param([string]$Name, $Object)
    $script:Diag[$Name] = $Object
    try { $Object | ConvertTo-Json -Depth 12 | Set-Content -Path (Join-Path $OutputPath ("{0}.json" -f $Name)) -Encoding UTF8 } catch { }
}
function Save-Text { param([string]$Name, [string]$Text); try { $Text | Set-Content -Path (Join-Path $OutputPath ("{0}.txt" -f $Name)) -Encoding UTF8 } catch { } }
function Get-NameFromId { param([string]$Id); if (-not $Id) { return '' }; return ($Id -split '/')[-1] }
function Protect-Value {
    param([string]$Name, [string]$Value)
    if (-not $Value) { return $Value }
    if ($Name -match '(?i)pass|pwd|secret|key|connection|conn|token') {
        if ($Value.Length -le 10) { return '***masked***' }
        return ($Value.Substring(0,4) + '***masked***' + $Value.Substring($Value.Length-3))
    }
    return $Value
}
function Ensure-RoleAssignment {
    param([string]$PrincipalId, [string]$RoleName, [string]$Scope, [string]$Why)
    if (-not $PrincipalId) { Add-Result ("Role: {0}" -f $RoleName) 'WARN' 'No identity principalId; cannot assign.'; return }
    $existing = Invoke-AzJson @('role','assignment','list','--assignee',$PrincipalId,'--role',$RoleName,'--scope',$Scope,'-o','json')
    if ($existing -and @($existing).Count -gt 0) { Add-Result ("Role: {0}" -f $RoleName) 'PASS' ("Already assigned at {0}" -f $Scope); return }
    if ($PSCmdlet.ShouldProcess($Scope, "Assign '$RoleName' to app identity ($Why)")) {
        & az role assignment create --assignee-object-id $PrincipalId --assignee-principal-type ServicePrincipal --role $RoleName --scope $Scope --only-show-errors 2>$null | Out-Null
        if ($LASTEXITCODE -eq 0) { Add-Result ("Role: {0}" -f $RoleName) 'FIXED' ("Assigned at {0} ({1})" -f $Scope, $Why) }
        else { Add-Result ("Role: {0}" -f $RoleName) 'FAIL' ("Could not assign at {0} — need Owner/User Access Admin." -f $Scope); $script:NextSteps.Add("Assign $RoleName to $PrincipalId at $Scope") }
    }
}

function Ensure-GraphAppRole {
    # Grant the app's managed identity a Microsoft Graph APPLICATION role (admin-consent). Idempotent.
    param([string]$MiPrincipalId, [string]$RoleValue)
    if (-not $MiPrincipalId) { Add-Result ("Graph role: {0}" -f $RoleValue) 'WARN' 'No app identity principalId.'; return }
    $graphAppId = '00000003-0000-0000-c000-000000000000'
    $graphSp = Invoke-AzJson @('ad','sp','show','--id',$graphAppId,'-o','json')
    if (-not $graphSp) { Add-Result ("Graph role: {0}" -f $RoleValue) 'WARN' 'Could not resolve the Microsoft Graph service principal.'; return }
    $role = $graphSp.appRoles | Where-Object { $_.value -eq $RoleValue -and ($_.allowedMemberTypes -contains 'Application') } | Select-Object -First 1
    if (-not $role) { Add-Result ("Graph role: {0}" -f $RoleValue) 'WARN' 'No matching Application app-role on Microsoft Graph.'; return }
    $existing = Invoke-AzJson @('rest','--method','get','--url',("https://graph.microsoft.com/v1.0/servicePrincipals/{0}/appRoleAssignments" -f $MiPrincipalId),'-o','json')
    if ($existing -and $existing.value -and ($existing.value | Where-Object { $_.appRoleId -eq $role.id })) {
        Add-Result ("Graph role: {0}" -f $RoleValue) 'PASS' 'Already granted to the app identity.'; return
    }
    if ($PSCmdlet.ShouldProcess($RoleValue, 'Grant Microsoft Graph app-role to the app identity')) {
        $tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("graphrole-{0}.json" -f (Get-Random))
        (@{ principalId = $MiPrincipalId; resourceId = $graphSp.id; appRoleId = $role.id } | ConvertTo-Json -Compress) | Set-Content -Path $tmp -Encoding UTF8
        $res = Invoke-AzText @('rest','--method','post','--url',("https://graph.microsoft.com/v1.0/servicePrincipals/{0}/appRoleAssignments" -f $MiPrincipalId),'--headers','Content-Type=application/json','--body',("@{0}" -f $tmp))
        Remove-Item $tmp -Force -ErrorAction SilentlyContinue
        if ($res.ok) { Add-Result ("Graph role: {0}" -f $RoleValue) 'FIXED' 'Granted (admin-consented) to the app identity.' }
        else { Add-Result ("Graph role: {0}" -f $RoleValue) 'FAIL' (("Could not grant (need Global Admin / Privileged Role Admin). {0}" -f $res.text).Trim()); $script:NextSteps.Add("Grant Microsoft Graph app-role '$RoleValue' to the app identity (run as Global Admin).") }
    }
}

function Get-PreferredDeployment {
    # Pick the best chat-capable deployment name from the account's deployment objects.
    param($Deployments)
    $names = @($Deployments | ForEach-Object { $_.name })
    foreach ($pat in @('gpt-5','gpt-4o','gpt-4.1','gpt-4','gpt-35','gpt-3.5','gpt','o1','o3')) {
        $hit = $Deployments | Where-Object { ($_.name -match [regex]::Escape($pat)) -or ($_.properties.model.name -match [regex]::Escape($pat)) } | Select-Object -First 1
        if ($hit) { return $hit.name }
    }
    if ($names.Count -gt 0) { return $names[0] }
    return $null
}

function Get-RepoSource {
    # Clone (git) or download (zip) the repo to $Dest. Returns @{ ok; path; method; error }.
    param([string]$Url, [string]$Branch, [string]$Dest)
    $git = Get-Command git -ErrorAction SilentlyContinue
    if ($git) {
        try {
            if (Test-Path $Dest) { Remove-Item $Dest -Recurse -Force -ErrorAction SilentlyContinue }
            Write-Host ("  git clone {0}{1} -> {2}" -f $Url, $(if ($Branch) { " (branch $Branch)" } else { '' }), $Dest) -ForegroundColor DarkGray
            if ($Branch) { & git clone --depth 1 -b $Branch $Url $Dest 2>$null | Out-Null }
            else         { & git clone --depth 1 $Url $Dest 2>$null | Out-Null }
            if ($LASTEXITCODE -eq 0 -and (Test-Path (Join-Path $Dest 'Dockerfile'))) { return @{ ok = $true; path = $Dest; method = 'git clone' } }
            if ($LASTEXITCODE -eq 0) { return @{ ok = $false; method = 'git'; error = 'Cloned, but no root Dockerfile in the repo.' } }
        } catch { }
    }
    $branches = if ($Branch) { @($Branch) } else { @('main', 'master') }
    foreach ($b in $branches) {
        try {
            $zip  = Join-Path ([System.IO.Path]::GetTempPath()) ("infraiq-src-{0}.zip" -f (Get-Random))
            $zurl = '{0}/archive/refs/heads/{1}.zip' -f $Url.TrimEnd('/'), $b
            Write-Host ("  downloading {0}" -f $zurl) -ForegroundColor DarkGray
            Invoke-WebRequest -Uri $zurl -OutFile $zip -UseBasicParsing -ErrorAction Stop
            $tmpx  = Join-Path ([System.IO.Path]::GetTempPath()) ("infraiq-x-{0}" -f (Get-Random))
            Expand-Archive -Path $zip -DestinationPath $tmpx -Force
            $inner = Get-ChildItem $tmpx -Directory | Select-Object -First 1
            if (Test-Path $Dest) { Remove-Item $Dest -Recurse -Force -ErrorAction SilentlyContinue }
            if ($inner) { Move-Item $inner.FullName $Dest -Force }
            Remove-Item $zip -Force -ErrorAction SilentlyContinue
            Remove-Item $tmpx -Recurse -Force -ErrorAction SilentlyContinue
            if (Test-Path (Join-Path $Dest 'Dockerfile')) { return @{ ok = $true; path = $Dest; method = ("zip:{0}" -f $b) } }
        } catch { continue }
    }
    return @{ ok = $false; method = 'none'; error = 'Could not clone or download the repo (private repo needs git auth; or branch is not main/master).' }
}

$imageRef     = '{0}:{1}' -f $ImageName, $ImageTag
$fullImageRef = $null

Write-Host ''
Write-Host '################################################################################' -ForegroundColor Cyan
Write-Host '#  Azure Infra IQ - diagnose + deploy latest image (public & private aware)    #' -ForegroundColor Cyan
Write-Host '################################################################################' -ForegroundColor Cyan
Write-Host ("  Subscription : {0}" -f $SubscriptionId)
Write-Host ("  Resource grp : {0}" -f $ResourceGroup)
Write-Host ("  Evidence dir : {0}" -f $OutputPath)
$DoDeploy = -not $CollectOnly
$DoFix    = -not $CollectOnly            # master switch: assign permissions + auto-fix config by default
$doRoles  = $DoFix -or $AssignPermissions
$doSql    = $DoFix -or $GrantSqlAccess
$doDns    = $DoFix -or $FixDnsLinks
$doAiFix  = $DoFix                       # auto-correct the app's Azure OpenAI env (the AI-404 fix)
$doGraph  = $DoFix -and -not $SkipGraph
$modeBits = @()
if ($DoDeploy) { $modeBits += 'DEPLOY-LATEST (clone repo -> build -> swap image)' }
if ($DoFix)    { $modeBits += 'FIX-ALL (roles: ARM+OpenAI+Graph, AI-env, SQL, DNS, ACR-pull identity)' }
if ($CollectOnly) { $modeBits = @('COLLECT-ONLY (read-only diagnostics)') }
Write-Host ("  Mode         : {0}" -f ($modeBits -join ', ')) -ForegroundColor Yellow
if ($DoDeploy) {
    Write-Host '  Deploy       : ON by default - records all diagnostics, then downloads the latest code, builds a new image and swaps it onto the existing app (works for BOTH public and private). Use -CollectOnly for read-only.' -ForegroundColor Green
}
if ($DoFix) {
    Write-Host '  Fix          : ON by default - run as Global Admin/Owner. Assigns ARM roles (Reader, Cost Mgmt Reader, Monitoring Reader, AcrPull), the Azure OpenAI data-plane role, Microsoft Graph app roles, repairs the AI endpoint/deployment env (AI-404), wires ACR pull-by-identity, grants SQL + links private DNS where applicable. Every step is recorded and the run CONTINUES even if a step fails.' -ForegroundColor Green
}

# ──────────────────────────────────────────────────────────────────────────────
# 1. Prerequisites & sign-in
# ──────────────────────────────────────────────────────────────────────────────
Write-Head 'Prerequisites & sign-in'
$azCmd = Get-Command az -ErrorAction SilentlyContinue
if (-not $azCmd) { Add-Result 'Azure CLI present' 'FAIL' 'az not found. Install from https://aka.ms/azcli.'; try { Stop-Transcript | Out-Null } catch { }; return }
Add-Result 'Azure CLI present' 'PASS' $azCmd.Source

$acct = Invoke-AzJson @('account','show','-o','json')
if (-not $acct) {
    $hint = if ($TenantId) { "Run: az login --tenant $TenantId" } else { 'Run: az login' }
    Add-Result 'Signed in to Azure' 'FAIL' $hint
    try { Stop-Transcript | Out-Null } catch { }; return
}
Add-Result 'Signed in to Azure' 'PASS' ("{0} (tenant {1})" -f $acct.user.name, $acct.tenantId)
Save-Json 'signed_in_account' ($acct | Select-Object name, id, tenantId, @{n='user';e={$_.user.name}})
# Capture WHO is running this + whether they hold a privileged directory role (helps explain any
# permission-grant failures later). Best-effort; never blocks.
try {
    $me = Invoke-AzJson @('ad','signed-in-user','show','-o','json')
    if ($me) { Save-Json 'signed_in_user' ($me | Select-Object displayName, userPrincipalName, id) }
    $dirRoles = Invoke-AzJson @('rest','--method','get','--url','https://graph.microsoft.com/v1.0/me/memberOf/microsoft.graph.directoryRole?$select=displayName','-o','json')
    if ($dirRoles -and $dirRoles.value) {
        $roleNames = @($dirRoles.value | ForEach-Object { $_.displayName })
        Save-Json 'signed_in_directory_roles' $roleNames
        $isGa = [bool]($roleNames | Where-Object { $_ -match '(?i)Global Administrator' })
        Add-Result 'Runner privilege' $(if ($isGa) {'PASS'} else {'INFO'}) ("Directory roles: {0}" -f $(if ($roleNames.Count) { $roleNames -join ', ' } else { '(none / not readable)' }))
    }
} catch { }

& az account set --subscription $SubscriptionId 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) { Add-Result 'Select subscription' 'FAIL' "No access to $SubscriptionId (or wrong tenant)."; try { Stop-Transcript | Out-Null } catch { }; return }
Add-Result 'Select subscription' 'PASS' $SubscriptionId

if (-not (Invoke-AzJson @('extension','show','--name','containerapp','-o','json'))) {
    & az extension add --name containerapp --only-show-errors 2>$null | Out-Null
}

# ──────────────────────────────────────────────────────────────────────────────
# 2. Self-discovery of the resources in the RG
# ──────────────────────────────────────────────────────────────────────────────
Write-Head 'Auto-discovery (resources in the resource group)'
$rgResources = Invoke-AzJson @('resource','list','-g',$ResourceGroup,'-o','json')
if ($rgResources) {
    Save-Json 'rg_resources' ($rgResources | Select-Object name, type, location)
    Add-Result 'RG inventory' 'PASS' ("{0} resources in {1}" -f @($rgResources).Count, $ResourceGroup)
} else {
    Add-Result 'RG inventory' 'WARN' "Could not list resources in $ResourceGroup (check the RG name / access)."
}
function Find-First { param($items, [string]$typeLike); if (-not $items) { return $null }; return ($items | Where-Object { $_.type -like $typeLike } | Select-Object -First 1) }

if (-not $ContainerAppName)  { $c = Find-First $rgResources 'Microsoft.App/containerApps';            if ($c) { $ContainerAppName = $c.name } }
if (-not $AcrName)           { $a = Find-First $rgResources 'Microsoft.ContainerRegistry/registries'; if ($a) { $AcrName = $a.name } }
if (-not $SqlServerName)     { $s = Find-First $rgResources 'Microsoft.Sql/servers';                  if ($s) { $SqlServerName = $s.name } }
if (-not $OpenAiAccountName) { $o = Find-First $rgResources 'Microsoft.CognitiveServices/accounts';   if ($o) { $OpenAiAccountName = $o.name } }

Add-Result 'Discovered: Container App' $(if ($ContainerAppName) {'PASS'} else {'WARN'}) ($(if ($ContainerAppName) { $ContainerAppName } else { 'not found in RG' }))
Add-Result 'Discovered: ACR'           $(if ($AcrName) {'PASS'} else {'WARN'}) ($(if ($AcrName) { $AcrName } else { 'not found in RG' }))
Add-Result 'Discovered: SQL server'    $(if ($SqlServerName) {'PASS'} else {'WARN'}) ($(if ($SqlServerName) { $SqlServerName } else { 'not found in RG' }))
Add-Result 'Discovered: OpenAI'        $(if ($OpenAiAccountName) {'PASS'} else {'WARN'}) ($(if ($OpenAiAccountName) { $OpenAiAccountName } else { 'not found in RG' }))

# ──────────────────────────────────────────────────────────────────────────────
# 3. Container App deep dump (config, identity, env, revisions, logs)
# ──────────────────────────────────────────────────────────────────────────────
Write-Head 'Container App configuration, identity, revisions & logs'
$app = $null
$appPrincipalId = $null
$appEnvId = $null
$appFqdn = $null
$appEnvVars = @()
if ($ContainerAppName) { $app = Invoke-AzJson @('containerapp','show','-n',$ContainerAppName,'-g',$ResourceGroup,'-o','json') }
if (-not $app) {
    Add-Result 'Container App found' 'FAIL' 'App not found. Pass -ContainerAppName explicitly.'
} else {
    try { $appPrincipalId = $app.identity.principalId } catch { }
    try { $appEnvId = $app.properties.environmentId } catch { }
    if (-not $appEnvId) { try { $appEnvId = $app.properties.managedEnvironmentId } catch { } }
    try { $appFqdn = $app.properties.configuration.ingress.fqdn } catch { }
    try { $appEnvVars = $app.properties.template.containers[0].env } catch { $appEnvVars = @() }
    $curImg = $null; try { $curImg = $app.properties.template.containers[0].image } catch { }
    if (-not $ContainerAppEnvName -and $appEnvId) { $ContainerAppEnvName = Get-NameFromId $appEnvId }

    $appSafe = $app | ConvertTo-Json -Depth 30 | ConvertFrom-Json
    try {
        foreach ($cont in $appSafe.properties.template.containers) {
            if ($cont.env) { foreach ($e in $cont.env) { if ($e.value) { $e.value = (Protect-Value $e.name $e.value) } } }
        }
    } catch { }
    Save-Json 'containerapp_show' $appSafe

    Add-Result 'Container App found' 'PASS' ("FQDN: {0}" -f $appFqdn)
    Add-Result 'Current image' 'INFO' $curImg
    if ($appPrincipalId) { Add-Result 'System-assigned identity' 'PASS' $appPrincipalId }
    else { Add-Result 'System-assigned identity' 'WARN' "None. Enable: az containerapp identity assign -n $ContainerAppName -g $ResourceGroup --system-assigned"; $script:NextSteps.Add("Enable system-assigned identity on $ContainerAppName") }

    $revs = Invoke-AzJson @('containerapp','revision','list','-n',$ContainerAppName,'-g',$ResourceGroup,'-o','json')
    if ($revs) {
        Save-Json 'containerapp_revisions' ($revs | Select-Object name, @{n='active';e={$_.properties.active}}, @{n='running';e={$_.properties.runningState}}, @{n='replicas';e={$_.properties.replicas}}, @{n='image';e={$_.properties.template.containers[0].image}}, @{n='created';e={$_.properties.createdTime}})
        $actRev = $revs | Where-Object { $_.properties.active } | Select-Object -First 1
        if ($actRev) { Add-Result 'Active revision' 'INFO' ("{0} | running={1} | replicas={2}" -f $actRev.name, $actRev.properties.runningState, $actRev.properties.replicas) }
    }

    foreach ($lt in @('console','system')) {
        $log = Invoke-AzText @('containerapp','logs','show','-n',$ContainerAppName,'-g',$ResourceGroup,'--type',$lt,'--tail','300')
        Save-Text ("containerapp_logs_{0}" -f $lt) $log.text
        if ($log.ok) {
            $errLines = ($log.text -split "`n" | Where-Object { $_ -match '(?i)error|exception|pyodbc|getaddrinfo|timeout|refused|denied|firewall|forbidden|40615|name or service not known|could not open' })
            if ($errLines) { Add-Result ("Logs ({0})" -f $lt) 'WARN' (($errLines | Select-Object -First 2) -join ' | ') }
            else { Add-Result ("Logs ({0})" -f $lt) 'PASS' 'Captured; no obvious error keywords in last 300 lines.' }
        } else {
            Add-Result ("Logs ({0})" -f $lt) 'INFO' 'Could not pull logs (Log Analytics may be off on the env). Captured the error text.'
        }
    }
}

# ──────────────────────────────────────────────────────────────────────────────
# 4. Container Apps ENVIRONMENT — VNet integration (critical for private endpoints)
# ──────────────────────────────────────────────────────────────────────────────
Write-Head 'Container Apps environment - VNet integration'
$envVnetId = $null
$envObj = $null
if ($ContainerAppEnvName) { $envObj = Invoke-AzJson @('containerapp','env','show','-n',$ContainerAppEnvName,'-g',$ResourceGroup,'-o','json') }
if (-not $envObj) {
    Add-Result 'Container Apps env' 'WARN' 'Could not load the managed environment; pass -ContainerAppEnvName.'
} else {
    Save-Json 'containerapp_env' $envObj
    $infraSubnet = $null
    try { $infraSubnet = $envObj.properties.vnetConfiguration.infrastructureSubnetId } catch { }
    if ($infraSubnet) {
        $envVnetId = ($infraSubnet -split '/subnets/')[0]
        Add-Result 'Env VNet-integrated' 'PASS' ("VNet: {0}" -f (Get-NameFromId $envVnetId))
    } else {
        # NOT VNet-integrated. This is ONLY a problem when a backing resource is PRIVATE-endpoint-only.
        # For a PUBLIC-access deployment (SQL/OpenAI publicNetworkAccess=Enabled) VNet integration is
        # NOT required, so this must not fail the run. Detect public-vs-private and decide accordingly.
        $sqlPub = $true; $aoaiPub = $true
        if ($SqlServerName)     { $q  = Invoke-AzText @('sql','server','show','-n',$SqlServerName,'-g',$ResourceGroup,'--query','publicNetworkAccess','-o','tsv');                 if ($q.text  -match '(?i)disabled') { $sqlPub  = $false } }
        if ($OpenAiAccountName) { $q2 = Invoke-AzText @('cognitiveservices','account','show','-n',$OpenAiAccountName,'-g',$ResourceGroup,'--query','properties.publicNetworkAccess','-o','tsv'); if ($q2.text -match '(?i)disabled') { $aoaiPub = $false } }
        if ($sqlPub -and $aoaiPub) {
            Add-Result 'Env VNet-integrated' 'INFO' 'Not VNet-integrated - and not required here: the backing resources allow PUBLIC network access (SQL/OpenAI publicNetworkAccess=Enabled). This is a valid PUBLIC deployment; the app reaches SQL/OpenAI/ACR over public endpoints. (A private-endpoint deployment would instead need a VNet-integrated env that links the private DNS zones.)'
        } else {
            $priv = @(); if (-not $sqlPub) { $priv += 'SQL' }; if (-not $aoaiPub) { $priv += 'OpenAI' }
            Add-Result 'Env VNet-integrated' 'FAIL' ("NOT VNet-integrated AND a backing resource is private-endpoint-only (publicNetworkAccess=Disabled): {0}. The app cannot reach it. Either recreate the env on a VNet that links the private DNS zones, or enable public network access on that resource." -f ($priv -join ', '))
            $script:NextSteps.Add(("Private resource(s) [{0}] unreachable: the Container Apps env is not VNet-integrated. Recreate the env on a VNet + link the private DNS zones, OR enable public network access on those resources." -f ($priv -join ', ')))
        }
    }
}

# ──────────────────────────────────────────────────────────────────────────────
# 5. Private endpoints + private DNS zones  (THE root-cause area)
# ──────────────────────────────────────────────────────────────────────────────
Write-Head 'Private endpoints & private DNS zone links'
$peList = Invoke-AzJson @('network','private-endpoint','list','-g',$ResourceGroup,'-o','json')
if ($peList) {
    $peSummary = foreach ($pe in $peList) {
        $target = ''; $groups = ''
        try { $target = $pe.privateLinkServiceConnections[0].privateLinkServiceId } catch { }
        try { $groups = ($pe.privateLinkServiceConnections[0].groupIds -join ',') } catch { }
        $dns = @()
        try { $dns = $pe.customDnsConfigs | ForEach-Object { '{0} -> {1}' -f $_.fqdn, ($_.ipAddresses -join ',') } } catch { }
        [pscustomobject]@{ name = $pe.name; target = (Get-NameFromId $target); groupIds = $groups; dns = ($dns -join ' ; '); subnet = (Get-NameFromId $pe.subnet.id) }
    }
    Save-Json 'private_endpoints' $peSummary
    Add-Result 'Private endpoints' 'PASS' ("{0} found in RG" -f @($peList).Count)
} else {
    Add-Result 'Private endpoints' 'WARN' 'No private endpoints found in the RG (or no access / they live in another RG).'
}

$zones = Invoke-AzJson @('network','private-dns','zone','list','-g',$ResourceGroup,'-o','json')
$zoneLinkMap = [ordered]@{}
if ($zones) {
    foreach ($z in $zones) {
        $links = Invoke-AzJson @('network','private-dns','link','vnet','list','-g',$ResourceGroup,'-z',$z.name,'-o','json')
        $linkedVnets = @()
        if ($links) { $linkedVnets = $links | ForEach-Object { [pscustomobject]@{ link = $_.name; vnetId = $_.virtualNetwork.id; vnet = (Get-NameFromId $_.virtualNetwork.id); registration = $_.registrationEnabled; state = $_.provisioningState } } }
        $zoneLinkMap[$z.name] = $linkedVnets
    }
    Save-Json 'private_dns_zones' $zoneLinkMap
    Add-Result 'Private DNS zones' 'PASS' (($zones | ForEach-Object { $_.name }) -join ', ')
} else {
    Add-Result 'Private DNS zones' 'WARN' 'No private DNS zones in this RG (they may be centralized in a hub VNet RG — verify there).'
}

function Test-ZoneLinked {
    param([string]$ZoneName, [string]$VnetId)
    if (-not $VnetId) { return $null }
    $matchZone = $zoneLinkMap.Keys | Where-Object { $_ -ieq $ZoneName }
    if (-not $matchZone) { return 'missing-zone' }
    $links = $zoneLinkMap[$matchZone]
    if ($links | Where-Object { $_.vnetId -ieq $VnetId }) { return 'linked' }
    return 'not-linked'
}
if ($envVnetId) {
    $criticalZones = @('privatelink.database.windows.net','privatelink.openai.azure.com','privatelink.azurecr.io','privatelink.blob.core.windows.net','privatelink.vaultcore.azure.net')
    foreach ($zn in $criticalZones) {
        $state = Test-ZoneLinked -ZoneName $zn -VnetId $envVnetId
        if ($state -eq 'linked') { Add-Result ("DNS zone link: {0}" -f $zn) 'PASS' 'Linked to the env VNet.' }
        elseif ($state -eq 'not-linked') {
            Add-Result ("DNS zone link: {0}" -f $zn) 'FAIL' 'Zone exists but is NOT linked to the env VNet -> the app cannot resolve this private FQDN. Likely root cause.'
            $script:NextSteps.Add("Link private DNS zone $zn to the env VNet (run with -FixDnsLinks, or: az network private-dns link vnet create -g $ResourceGroup -z $zn -n link-aca -v <vnetId> -e false)")
            if ($doDns) {
                if ($PSCmdlet.ShouldProcess($zn, "Link to env VNet $envVnetId")) {
                    & az network private-dns link vnet create -g $ResourceGroup -z $zn -n ('link-aca-{0}' -f $stamp) -v $envVnetId -e false --only-show-errors 2>$null | Out-Null
                    if ($LASTEXITCODE -eq 0) { Add-Result ("DNS zone link fix: {0}" -f $zn) 'FIXED' 'Linked to the env VNet.' }
                    else { Add-Result ("DNS zone link fix: {0}" -f $zn) 'FAIL' 'Link failed (zone may be in another RG/hub — link it there).' }
                }
            }
        }
        elseif ($state -eq 'missing-zone') { Add-Result ("DNS zone link: {0}" -f $zn) 'INFO' 'Zone not in this RG (may be centralized in a hub — verify there).' }
    }
}

# ──────────────────────────────────────────────────────────────────────────────
# 6. SQL server — networking + (optional) managed-identity grant
# ──────────────────────────────────────────────────────────────────────────────
Write-Head 'Azure SQL - networking & access'
$sqlFqdn = $null
if (-not $SqlServerName) {
    Add-Result 'SQL checks' 'INFO' 'No SQL server discovered/provided.'
} else {
    $sqlSrv = Invoke-AzJson @('sql','server','show','-n',$SqlServerName,'-g',$ResourceGroup,'-o','json')
    if (-not $sqlSrv) { Add-Result 'SQL server' 'FAIL' "Server '$SqlServerName' not found in $ResourceGroup." }
    else {
        $sqlFqdn = $sqlSrv.fullyQualifiedDomainName
        $aadAdmin = $null; try { $aadAdmin = $sqlSrv.administrators.login } catch { }
        Save-Json 'sql_server' ($sqlSrv | Select-Object name, fullyQualifiedDomainName, publicNetworkAccess, administratorLogin)
        Add-Result 'SQL server' 'PASS' ("{0} | publicNetworkAccess={1}" -f $sqlFqdn, $sqlSrv.publicNetworkAccess)
        if (-not $SqlDatabaseName) {
            $dbs = Invoke-AzJson @('sql','db','list','-s',$SqlServerName,'-g',$ResourceGroup,'-o','json')
            if ($dbs) { $cand = $dbs | Where-Object { $_.name -ne 'master' } | Select-Object -First 1; if ($cand) { $SqlDatabaseName = $cand.name; Add-Result 'SQL database (auto)' 'INFO' $SqlDatabaseName } }
        }
        if ($aadAdmin) { Add-Result 'SQL AAD admin' 'PASS' $aadAdmin } else { Add-Result 'SQL AAD admin' 'WARN' 'No Azure AD admin on the server — managed-identity auth (FROM EXTERNAL PROVIDER) needs one.'; $script:NextSteps.Add("Set a SQL AAD admin: az sql server ad-admin create -g $ResourceGroup -s $SqlServerName --display-name <admin> --object-id <objectId>") }
        if ($sqlSrv.publicNetworkAccess -eq 'Disabled') { Add-Result 'SQL public access' 'INFO' 'Disabled (private-endpoint only) — correct for private; reachability depends on the DNS-zone links above.' }
    }
}

if ($doSql) {
    if (-not $sqlFqdn -or -not $SqlDatabaseName) { Add-Result 'Grant MI SQL access' 'FAIL' 'Need a resolved SQL server + database name.' }
    elseif (-not $appPrincipalId) { Add-Result 'Grant MI SQL access' 'FAIL' 'App has no system-assigned identity.' }
    else {
        # PREREQUISITE: Azure SQL rejects EVERY Entra/AAD token ("server is not currently configured
        # to accept this token") until an Azure AD admin is set on the SERVER — being subscription
        # Owner / Global Admin is NOT enough by itself. If none is set, make the signed-in runner the
        # SQL AAD admin (a control-plane call that also works against a PRIVATE SQL server). This is
        # what then lets the grant below authenticate (public SQL) or lets the saved T-SQL be run from
        # a VNet host as that same admin (private SQL).
        if (-not $aadAdmin) {
            try {
                if (-not $me -or -not $me.id) { $me = Invoke-AzJson @('ad','signed-in-user','show','-o','json') }
                $meId = $null; $meName = $null
                if ($me) { $meId = $me.id; $meName = $(if ($me.userPrincipalName) { $me.userPrincipalName } else { $me.displayName }) }
                if ($meId -and $PSCmdlet.ShouldProcess($SqlServerName, "Set SQL AAD admin = $meName")) {
                    $setAdmin = Invoke-AzText @('sql','server','ad-admin','create','-g',$ResourceGroup,'-s',$SqlServerName,'--display-name',$meName,'--object-id',$meId)
                    if ($setAdmin.ok) {
                        $aadAdmin = $meName
                        Add-Result 'SQL AAD admin (set)' 'FIXED' "Set '$meName' as the Azure AD admin on $SqlServerName - the managed-identity grant can now authenticate (or run the saved T-SQL from inside the VNet as this same admin)."
                        Start-Sleep -Seconds 8
                    } else {
                        Add-Result 'SQL AAD admin (set)' 'WARN' ("Could not set the AAD admin automatically (need Owner / SQL Security Manager on the server): {0}" -f ($setAdmin.text -replace '\s+',' ').Trim())
                    }
                } elseif (-not $meId) {
                    Add-Result 'SQL AAD admin (set)' 'WARN' 'Could not resolve the signed-in user object id to set as the SQL AAD admin.'
                }
            } catch { Add-Result 'SQL AAD admin (set)' 'WARN' ("Could not set the AAD admin: {0}" -f $_.Exception.Message) }
        }
        $miName = $ContainerAppName
        # Resolve the MI by its OBJECT ID (SID), NOT its display name. `CREATE USER [..] FROM
        # EXTERNAL PROVIDER` resolves by display name and FAILS with "Principal '<name>' has a
        # duplicate display name" when Entra has >1 principal with the same name (common after a
        # Container App is recreated and orphan service principals linger). Building the SID from the
        # app's principalId GUID is unambiguous. TYPE=E => external (Entra) user.
        $miSid = '0x' + ((([guid]$appPrincipalId).ToByteArray() | ForEach-Object { $_.ToString('X2') }) -join '')
        $tsql = @"
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'$miName')
    CREATE USER [$miName] WITH SID = $miSid, TYPE = E;
IF IS_ROLEMEMBER('db_datareader', N'$miName') = 0 ALTER ROLE db_datareader ADD MEMBER [$miName];
IF IS_ROLEMEMBER('db_datawriter', N'$miName') = 0 ALTER ROLE db_datawriter ADD MEMBER [$miName];
IF IS_ROLEMEMBER('db_ddladmin',  N'$miName') = 0 ALTER ROLE db_ddladmin  ADD MEMBER [$miName];
"@
        Save-Text 'sql_grant_tsql' $tsql
        if ($PSCmdlet.ShouldProcess("$SqlDatabaseName on $sqlFqdn", "Create/repair DB user [$miName] + grant datareader/datawriter/ddladmin")) {
            $token = & az account get-access-token --resource 'https://database.windows.net/' --query accessToken -o tsv 2>$null
            if (-not $token) { Add-Result 'Grant MI SQL access' 'FAIL' 'Could not get a SQL token.' }
            else {
                $conn = $null
                try {
                    $conn = New-Object System.Data.SqlClient.SqlConnection
                    $conn.ConnectionString = ("Server=tcp:{0},1433;Initial Catalog={1};Encrypt=True;TrustServerCertificate=False;Connect Timeout=30" -f $sqlFqdn, $SqlDatabaseName)
                    $conn.AccessToken = $token
                    $conn.Open()
                    $cmd = $conn.CreateCommand(); $cmd.CommandText = $tsql; [void]$cmd.ExecuteNonQuery()
                    Add-Result 'Grant MI SQL access' 'FIXED' "[$miName] granted db_datareader + db_datawriter + db_ddladmin on $SqlDatabaseName."
                } catch {
                    Add-Result 'Grant MI SQL access' 'FAIL' ("Grant failed (private SQL unreachable from this PC, or you are not the SQL AAD admin): {0}" -f $_.Exception.Message)
                    $script:NextSteps.Add('Run the saved sql_grant_tsql.txt from a host INSIDE the VNet (jumpbox / VNet-joined Cloud Shell) as the SQL AAD admin — public SQL is disabled so it cannot be reached from outside.')
                } finally { if ($conn -and $conn.State -ne 'Closed') { $conn.Close() } }
            }
        }
    }
} else { Add-Result 'Grant MI SQL access' 'INFO' 'Skipped: -CollectOnly (read-only).' }

# ──────────────────────────────────────────────────────────────────────────────
# 7. OpenAI — networking & deployments
# ──────────────────────────────────────────────────────────────────────────────
Write-Head 'Azure OpenAI'
if (-not $OpenAiAccountName) { Add-Result 'OpenAI checks' 'INFO' 'No OpenAI account discovered/provided.' }
else {
    $aoai = Invoke-AzJson @('cognitiveservices','account','show','-n',$OpenAiAccountName,'-g',$ResourceGroup,'-o','json')
    if (-not $aoai) { Add-Result 'OpenAI account' 'FAIL' "Account '$OpenAiAccountName' not found in $ResourceGroup." }
    else {
        $script:OpenAiResourceId = $aoai.id
        Save-Json 'openai_account' ($aoai | Select-Object name, id, @{n='endpoint';e={$_.properties.endpoint}}, @{n='publicNetworkAccess';e={$_.properties.publicNetworkAccess}}, @{n='state';e={$_.properties.provisioningState}})
        Add-Result 'OpenAI account' 'PASS' ("{0} | publicNetworkAccess={1}" -f $aoai.properties.endpoint, $aoai.properties.publicNetworkAccess)
        $deps = Invoke-AzJson @('cognitiveservices','account','deployment','list','-n',$OpenAiAccountName,'-g',$ResourceGroup,'-o','json')
        if ($deps -and @($deps).Count -gt 0) { Save-Json 'openai_deployments' ($deps | Select-Object name, @{n='model';e={$_.properties.model.name}}, @{n='version';e={$_.properties.model.version}}); Add-Result 'OpenAI deployments' 'PASS' ((@($deps) | ForEach-Object { $_.name }) -join ', ') }
        else {
            Add-Result 'OpenAI deployments' 'WARN' 'No model deployments — AI analysis will fail until a model is deployed.'
            if ($CreateOpenAiDeployment -and $PSCmdlet.ShouldProcess($OpenAiAccountName, 'Create gpt-4o deployment')) {
                Write-Host '  creating a gpt-4o deployment (Standard, capacity 10)...' -ForegroundColor Cyan
                $cr = Invoke-AzText @('cognitiveservices','account','deployment','create','-n',$OpenAiAccountName,'-g',$ResourceGroup,'--deployment-name','gpt-4o','--model-name','gpt-4o','--model-version','2024-08-06','--model-format','OpenAI','--sku-name','Standard','--sku-capacity','10')
                if ($cr.ok) { Add-Result 'Create OpenAI deployment' 'FIXED' 'Created deployment gpt-4o.'; $deps = Invoke-AzJson @('cognitiveservices','account','deployment','list','-n',$OpenAiAccountName,'-g',$ResourceGroup,'-o','json') }
                else { Add-Result 'Create OpenAI deployment' 'FAIL' ('Could not create (quota/region/model availability): ' + $cr.text.Trim()); $script:NextSteps.Add("Create a model deployment on $OpenAiAccountName (portal: Model deployments).") }
            } else {
                $script:NextSteps.Add("Deploy a chat model on $OpenAiAccountName (e.g. gpt-4o), or re-run with -CreateOpenAiDeployment.")
            }
        }

        # ── AI-404 deep diagnostic ────────────────────────────────────────────
        # The #1 cause of "AI analysis returns 404 / AI insights stay empty" is an ENV MISMATCH:
        # the Container App is pointed at an AZURE_OPENAI_DEPLOYMENT name (or endpoint) that does not
        # exist on the account, so every model call returns 404 DeploymentNotFound. Cross-check the
        # app's configured AOAI env vars against the account's REAL endpoint + deployed model names.
        $depNames    = @($deps | ForEach-Object { $_.name })
        $cfgDeploy   = ($appEnvVars | Where-Object { $_.name -eq 'AZURE_OPENAI_DEPLOYMENT' } | Select-Object -First 1).value
        $cfgEndpoint = ($appEnvVars | Where-Object { $_.name -eq 'AZURE_OPENAI_ENDPOINT' }   | Select-Object -First 1).value
        $cfgApiVer   = ($appEnvVars | Where-Object { $_.name -eq 'AZURE_OPENAI_API_VERSION' } | Select-Object -First 1).value
        $keyEnv      = $appEnvVars | Where-Object { $_.name -eq 'AZURE_OPENAI_KEY' -or $_.name -eq 'AZURE_OPENAI_API_KEY' } | Select-Object -First 1

        if (-not $cfgDeploy) {
            Add-Result 'AI: app AZURE_OPENAI_DEPLOYMENT' 'WARN' ('Not set on the Container App. The app uses its built-in default deployment name, which may not exist on this account -> AI 404. Set it to one of: {0}' -f ($depNames -join ', '))
            $script:NextSteps.Add("Set AZURE_OPENAI_DEPLOYMENT on $ContainerAppName to a real deployment ($($depNames -join ', '))")
        } elseif ($depNames -notcontains $cfgDeploy) {
            Add-Result 'AI: deployment name match' 'FAIL' ("AI-404 ROOT CAUSE: app is configured for AZURE_OPENAI_DEPLOYMENT='{0}' but that deployment does NOT exist on '{1}'. Existing deployments: {2}. Every AI call returns 404 (DeploymentNotFound)." -f $cfgDeploy, $OpenAiAccountName, ($depNames -join ', '))
            $script:NextSteps.Add("Fix AZURE_OPENAI_DEPLOYMENT='$cfgDeploy' on $ContainerAppName -> use one of: $($depNames -join ', ') (or create that deployment on $OpenAiAccountName)")
        } else {
            Add-Result 'AI: deployment name match' 'PASS' ("app AZURE_OPENAI_DEPLOYMENT='{0}' exists on the account." -f $cfgDeploy)
        }

        if ($cfgEndpoint) {
            $acctHost = ''; try { $acctHost = ([Uri]$aoai.properties.endpoint).Host } catch { }
            $cfgHost  = ''; try { $cfgHost  = ([Uri]$cfgEndpoint).Host } catch { }
            if ($acctHost -and $cfgHost -and ($acctHost -ne $cfgHost)) {
                Add-Result 'AI: endpoint match' 'FAIL' ("app AZURE_OPENAI_ENDPOINT host '{0}' != account endpoint host '{1}'. The app is calling a different/old OpenAI account -> 404/401." -f $cfgHost, $acctHost)
                $script:NextSteps.Add("Fix AZURE_OPENAI_ENDPOINT on $ContainerAppName to $($aoai.properties.endpoint)")
            } else {
                Add-Result 'AI: endpoint match' 'PASS' $cfgEndpoint
            }
        } else {
            Add-Result 'AI: app AZURE_OPENAI_ENDPOINT' 'WARN' ("Not set on the Container App. Set it to {0}" -f $aoai.properties.endpoint)
        }

        if (-not $keyEnv) {
            Add-Result 'AI: credential' 'INFO' 'No AZURE_OPENAI_KEY env var. OK if the app uses managed-identity (AAD) auth to OpenAI; otherwise AI calls return 401.'
        } else {
            Add-Result 'AI: credential' 'PASS' ("{0} present ({1})" -f $keyEnv.name, $(if ($keyEnv.secretRef) { 'secretref' } else { 'inline' }))
        }
        if ($cfgApiVer) { Add-Result 'AI: api-version' 'INFO' $cfgApiVer }

        # ── AI-404 AUTO-FIX: correct the app's OpenAI endpoint/deployment env in place ──────────
        $wantDeploy = $null
        if ($doAiFix -and $app -and @($depNames).Count -gt 0) {
            $envFixes = @()
            if (-not $cfgDeploy -or ($depNames -notcontains $cfgDeploy)) {
                $wantDeploy = Get-PreferredDeployment $deps
                if ($wantDeploy) { $envFixes += ("AZURE_OPENAI_DEPLOYMENT={0}" -f $wantDeploy) }
            }
            $acctHost2 = ''; try { $acctHost2 = ([Uri]$aoai.properties.endpoint).Host } catch { }
            $cfgHost2  = ''; try { if ($cfgEndpoint) { $cfgHost2 = ([Uri]$cfgEndpoint).Host } } catch { }
            if (-not $cfgEndpoint -or ($acctHost2 -and $cfgHost2 -and ($acctHost2 -ne $cfgHost2))) {
                $envFixes += ("AZURE_OPENAI_ENDPOINT={0}" -f $aoai.properties.endpoint)
            }
            if ($envFixes.Count -gt 0) {
                if ($PSCmdlet.ShouldProcess($ContainerAppName, ("Set env: {0}" -f ($envFixes -join ', ')))) {
                    & az containerapp update -n $ContainerAppName -g $ResourceGroup --set-env-vars @envFixes --only-show-errors 2>$null | Out-Null
                    if ($LASTEXITCODE -eq 0) { Add-Result 'AI-404 env auto-fix' 'FIXED' ("Updated app env -> {0}. New revision; the next AI call uses the corrected endpoint/deployment." -f ($envFixes -join ', ')) }
                    else { Add-Result 'AI-404 env auto-fix' 'FAIL' 'Could not update the Container App env vars (insufficient rights?).' }
                }
            } else {
                Add-Result 'AI-404 env auto-fix' 'PASS' 'App OpenAI endpoint + deployment already match the account; no env change needed.'
            }
        }

        # ── Reproduce the AI call so the bundle carries the EXACT model response/error ──────────
        try {
            $testEndpoint = if ($cfgEndpoint) { $cfgEndpoint } else { $aoai.properties.endpoint }
            $testDeploy   = if ($cfgDeploy -and ($depNames -contains $cfgDeploy)) { $cfgDeploy } elseif ($wantDeploy) { $wantDeploy } else { (Get-PreferredDeployment $deps) }
            $testApiVer   = if ($cfgApiVer) { $cfgApiVer } else { '2024-08-01-preview' }
            $testResult   = [ordered]@{ endpoint = $testEndpoint; deployment = $testDeploy; apiVersion = $testApiVer; auth = $null; status = $null; body = $null }
            if ($testEndpoint -and $testDeploy) {
                $uri = ('{0}openai/deployments/{1}/chat/completions?api-version={2}' -f ($testEndpoint.TrimEnd('/') + '/'), $testDeploy, $testApiVer)
                $headers = @{ 'Content-Type' = 'application/json' }
                $keyVal = $null
                if ($keyEnv -and $keyEnv.value) { $keyVal = $keyEnv.value }
                elseif ($keyEnv -and $keyEnv.secretRef) { $ks = Invoke-AzText @('containerapp','secret','show','-n',$ContainerAppName,'-g',$ResourceGroup,'--secret-name',$keyEnv.secretRef,'--query','value','-o','tsv'); if ($ks.ok) { $keyVal = $ks.text.Trim() } }
                if ($keyVal) { $headers['api-key'] = $keyVal; $testResult.auth = 'api-key' }
                else {
                    $tok = & az account get-access-token --resource 'https://cognitiveservices.azure.com' --query accessToken -o tsv 2>$null
                    if ($tok) { $headers['Authorization'] = ("Bearer {0}" -f $tok); $testResult.auth = 'aad-token(runner)' }
                }
                $payload = '{"messages":[{"role":"user","content":"ping"}]}'
                try {
                    $resp = Invoke-WebRequest -Uri $uri -Method Post -Headers $headers -Body $payload -TimeoutSec 30 -UseBasicParsing -ErrorAction Stop
                    $testResult.status = [int]$resp.StatusCode
                    $testResult.body   = (($resp.Content | Out-String).Substring(0, [Math]::Min(600, ($resp.Content | Out-String).Length)))
                    Add-Result 'AI: live model call' 'PASS' ("HTTP {0} from deployment '{1}' — the model endpoint works." -f $testResult.status, $testDeploy)
                } catch {
                    $code = ''; try { $code = [int]$_.Exception.Response.StatusCode } catch { }
                    $eBody = ''
                    try { $st = $_.Exception.Response.GetResponseStream(); if ($st) { $rd = New-Object System.IO.StreamReader($st); $eBody = $rd.ReadToEnd() } } catch { }
                    $testResult.status = $code; $testResult.body = ($eBody.Substring(0, [Math]::Min(600, $eBody.Length)))
                    if ($code -eq 404)     { Add-Result 'AI: live model call' 'FAIL' ("HTTP 404 calling deployment '{0}' — DeploymentNotFound/endpoint wrong. {1}" -f $testDeploy, ($eBody.Substring(0,[Math]::Min(180,$eBody.Length)))) }
                    elseif ($code -eq 401) { Add-Result 'AI: live model call' 'WARN' '401 Unauthorized — wrong key OR the identity lacks Cognitive Services OpenAI User (this run assigns it).' }
                    elseif ($code -eq 403) { Add-Result 'AI: live model call' 'WARN' '403 Forbidden — network/private-endpoint or RBAC blocks the call.' }
                    else                   { Add-Result 'AI: live model call' 'WARN' ("No 2xx (HTTP {0}): {1}" -f $code, $_.Exception.Message) }
                }
            } else {
                Add-Result 'AI: live model call' 'INFO' 'Skipped (no resolvable endpoint/deployment to test).'
            }
            Save-Json 'openai_test_call' $testResult
        } catch { Add-Result 'AI: live model call' 'INFO' ("Could not run the live AI test: {0}" -f $_.Exception.Message) }
    }
}

# ──────────────────────────────────────────────────────────────────────────────
# 8. Managed identity — current role assignments + (optional) assign missing roles
# ──────────────────────────────────────────────────────────────────────────────
Write-Head 'Managed identity role assignments'
if ($appPrincipalId) {
    $ra = Invoke-AzJson @('role','assignment','list','--assignee',$appPrincipalId,'--all','-o','json')
    if ($ra) { Save-Json 'identity_role_assignments' ($ra | Select-Object roleDefinitionName, scope); Add-Result 'Current role assignments' 'INFO' ((@($ra) | ForEach-Object { $_.roleDefinitionName } | Select-Object -Unique) -join ', ') }
    else { Add-Result 'Current role assignments' 'WARN' 'The app identity has NO role assignments — it cannot scan Azure (empty dashboards).' }

    if ($doRoles) {
        $subScope = "/subscriptions/$SubscriptionId"
        Ensure-RoleAssignment -PrincipalId $appPrincipalId -RoleName 'Reader' -Scope $subScope -Why 'enumerate resources (fixes empty dashboards)'
        Ensure-RoleAssignment -PrincipalId $appPrincipalId -RoleName 'Cost Management Reader' -Scope $subScope -Why 'cost dashboards'
        Ensure-RoleAssignment -PrincipalId $appPrincipalId -RoleName 'Monitoring Reader' -Scope $subScope -Why 'metrics/utilisation'
        # Azure OpenAI data-plane role (lets the app call the model via managed identity -> fixes AI 401/404-after-auth)
        if ($script:OpenAiResourceId) {
            Ensure-RoleAssignment -PrincipalId $appPrincipalId -RoleName 'Cognitive Services OpenAI User' -Scope $script:OpenAiResourceId -Why 'call Azure OpenAI via managed identity'
        }
        if ($AcrName) {
            $acrObj = Invoke-AzJson @('acr','show','-n',$AcrName,'-g',$ResourceGroup,'-o','json')
            if ($acrObj) {
                Ensure-RoleAssignment -PrincipalId $appPrincipalId -RoleName 'AcrPull' -Scope $acrObj.id -Why 'pull the image'
                # make the app pull using its system identity (a common cause of "image update failed")
                if ($PSCmdlet.ShouldProcess($ContainerAppName, "Set ACR pull-by-identity (system) for $AcrName")) {
                    & az containerapp registry set -n $ContainerAppName -g $ResourceGroup --server ("{0}.azurecr.io" -f $AcrName) --identity system --only-show-errors 2>$null | Out-Null
                    if ($LASTEXITCODE -eq 0) { Add-Result 'ACR pull-by-identity' 'FIXED' ("App set to pull from {0}.azurecr.io using its system identity." -f $AcrName) }
                    else { Add-Result 'ACR pull-by-identity' 'INFO' 'Could not set registry pull-by-identity (may already use admin creds / not required).' }
                }
            }
        }
        # Microsoft Graph application roles (admin-consent) for identity/security features
        if ($doGraph) {
            foreach ($gr in $GraphAppRoles) { Ensure-GraphAppRole -MiPrincipalId $appPrincipalId -RoleValue $gr }
        } else { Add-Result 'Graph app roles' 'INFO' 'Skipped (-SkipGraph).' }
    } else { Add-Result 'Assign roles' 'INFO' 'Skipped: -CollectOnly (read-only). A normal run assigns Reader + Cost Management Reader + Monitoring Reader + AcrPull + Cognitive Services OpenAI User + Microsoft Graph app roles by default.' }
} else {
    Add-Result 'Role assignments' 'WARN' 'No app identity to inspect/assign.'
}

# ──────────────────────────────────────────────────────────────────────────────
# 9. Live probe of the app's own diagnostics (public ingress)
# ──────────────────────────────────────────────────────────────────────────────
Write-Head 'Live probe of the app (public ingress)'
if ($appFqdn) {
    $probe = [ordered]@{}
    foreach ($path in @('/api/version','/api/ai/status','/api/health','/api/subscriptions')) {
        $url = "https://$appFqdn$path"
        try {
            $r = Invoke-WebRequest -Uri $url -TimeoutSec 15 -UseBasicParsing -ErrorAction Stop
            $body = ''; try { $body = $r.Content.Substring(0, [Math]::Min(400, $r.Content.Length)) } catch { }
            $probe[$path] = @{ status = $r.StatusCode; body = $body }
            Add-Result ("Probe {0}" -f $path) 'PASS' ("HTTP {0}" -f $r.StatusCode)
        } catch {
            $code = ''
            try { $code = [int]$_.Exception.Response.StatusCode } catch { }
            $eBody = ''
            try { $st = $_.Exception.Response.GetResponseStream(); if ($st) { $rd = New-Object System.IO.StreamReader($st); $eBody = $rd.ReadToEnd() } } catch { }
            $probe[$path] = @{ status = $code; error = $_.Exception.Message; body = ($eBody.Substring(0, [Math]::Min(800, $eBody.Length))) }
            if ($code -eq 401) { Add-Result ("Probe {0}" -f $path) 'INFO' 'HTTP 401 (auth-gated) — endpoint exists.' }
            elseif ($code -eq 404) { Add-Result ("Probe {0}" -f $path) 'WARN' 'HTTP 404 — route missing on the running image (image older than expected). Rebuild/redeploy.' }
            else { Add-Result ("Probe {0}" -f $path) 'WARN' ("No/!2xx response: {0}" -f $_.Exception.Message) }
        }
    }
    Save-Json 'app_http_probe' $probe
} else { Add-Result 'App probe' 'INFO' 'No ingress FQDN to probe.' }

# ──────────────────────────────────────────────────────────────────────────────
# 10. Container App env-var configuration
# ──────────────────────────────────────────────────────────────────────────────
Write-Head 'Container App configuration (env vars)'
if ($app) {
    function Get-EnvVal { param([string]$Name); $e = $appEnvVars | Where-Object { $_.name -eq $Name } | Select-Object -First 1; if (-not $e) { return $null }; if ($e.value) { return $e.value }; if ($e.secretRef) { return ('<secretRef:{0}>' -f $e.secretRef) }; return '' }
    $dbp = Get-EnvVal 'DATABASE_PROVIDER'; $scs = Get-EnvVal 'AZURE_SQL_CONNECTION_STRING'; $aep = Get-EnvVal 'AZURE_OPENAI_ENDPOINT'; $adp = Get-EnvVal 'AZURE_OPENAI_DEPLOYMENT'
    Save-Json 'app_env_keys' (@($appEnvVars | ForEach-Object { $_.name }))
    if ($dbp) { Add-Result 'DATABASE_PROVIDER' 'PASS' $dbp } else { Add-Result 'DATABASE_PROVIDER' 'WARN' "Not set; must be 'azuresql' for persistent data." }
    if ($scs) { Add-Result 'AZURE_SQL_CONNECTION_STRING' 'PASS' 'Set (masked in evidence).' } elseif ($dbp -eq 'azuresql') { Add-Result 'AZURE_SQL_CONNECTION_STRING' 'FAIL' 'Required for azuresql but not set.' } else { Add-Result 'AZURE_SQL_CONNECTION_STRING' 'INFO' 'Not set.' }
    if ($aep) { Add-Result 'AZURE_OPENAI_ENDPOINT' 'PASS' $aep } else { Add-Result 'AZURE_OPENAI_ENDPOINT' 'WARN' 'Not set.' }
    if ($adp) { Add-Result 'AZURE_OPENAI_DEPLOYMENT' 'PASS' $adp } else { Add-Result 'AZURE_OPENAI_DEPLOYMENT' 'WARN' 'Not set.' }
}

# ──────────────────────────────────────────────────────────────────────────────
# 11. Build + deploy latest image (opt-in)
# ──────────────────────────────────────────────────────────────────────────────
Write-Head 'Build & deploy latest image'
if ($CollectOnly) {
    Add-Result 'Deploy latest' 'INFO' 'Skipped: -CollectOnly (read-only). Re-run without -CollectOnly to clone the latest repo, build the image, and swap it onto the app.'
} elseif (-not $AcrName) {
    Add-Result 'Deploy latest' 'FAIL' 'No ACR resolved in the RG; pass -AcrName so the image can be built and pushed.'
} else {
    Add-Result 'Deploy latest' 'INFO' ('Proceeding with the update regardless of any diagnostic WARN/FAIL above (compatible with public AND private). Source repo: {0}' -f $RepoUrl)
    # Resolve the build context: an explicit -RepoPath if valid, otherwise auto-download -RepoUrl.
    $buildPath = $null
    if ($RepoPath -and (Test-Path (Join-Path $RepoPath 'Dockerfile'))) {
        $buildPath = $RepoPath
        Add-Result 'Source code' 'INFO' ("Using local -RepoPath: {0}" -f $RepoPath)
    } else {
        if ($RepoPath) { Add-Result 'Source code' 'WARN' ("-RepoPath '{0}' has no root Dockerfile; downloading {1} instead." -f $RepoPath, $RepoUrl) }
        if ($PSCmdlet.ShouldProcess($RepoUrl, "Download repo to $CloneRoot")) {
            $src = Get-RepoSource -Url $RepoUrl -Branch $RepoBranch -Dest $CloneRoot
            if ($src.ok) { $buildPath = $src.path; Add-Result 'Download source' 'FIXED' ("{0} via {1} -> {2}" -f $RepoUrl, $src.method, $src.path) }
            else { Add-Result 'Download source' 'FAIL' $src.error; $script:NextSteps.Add("Install git (or check repo access), or clone $RepoUrl manually and pass -RepoPath.") }
        }
    }
    if ($buildPath) {
        $fullImageRef = '{0}.azurecr.io/{1}' -f $AcrName, $imageRef
        if ($PSCmdlet.ShouldProcess($AcrName, "az acr build $imageRef from $buildPath")) {
            Write-Host ("  building image {0} in ACR {1} (this can take several minutes)..." -f $imageRef, $AcrName) -ForegroundColor Cyan
            # CRITICAL (Windows): do NOT pipe `az acr build` (no `| Tee-Object`, no `> file`). Piping/
            # redirecting makes az's stdout a cp1252 PIPE, so the vite build's check-mark (U+2713) hits
            # `UnicodeEncodeError: 'charmap' codec can't encode '\u2713'` and KILLS the build client at
            # ~step 7/20 — BEFORE the image is pushed (that's the "build failed AND tag not present"
            # we saw). Writing straight to the console (code page forced to UTF-8 below) lets Python use
            # its Unicode console writer so the ✓ streams fine. The whole run is already captured in
            # console-transcript.txt for the evidence bundle.
            $env:PYTHONIOENCODING = 'utf-8'
            try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }
            try { chcp 65001 2>&1 | Out-Null } catch { }
            & az acr build --registry $AcrName --image $imageRef --file (Join-Path $buildPath 'Dockerfile') $buildPath --only-show-errors
            $buildExit = $LASTEXITCODE
            # Even with the fix above, a console hiccup could still exit the CLIENT non-zero while the
            # ACR build TASK keeps building + pushing server-side. So don't trust the exit code alone —
            # POLL the registry for the pushed tag (give a server-side build time to finish) and proceed
            # with the swap as soon as the tag appears.
            $imgPushed = $false
            for ($t = 0; $t -lt 8 -and -not $imgPushed; $t++) {
                if ($t -gt 0) { Start-Sleep -Seconds 20 }
                $tagList = Invoke-AzText @('acr','repository','show-tags','-n',$AcrName,'--repository',$ImageName,'-o','tsv')
                if ($tagList.ok) { $imgPushed = (($tagList.text -split "`r?`n") | ForEach-Object { $_.Trim() }) -contains $ImageTag }
                if ($buildExit -eq 0) { break }   # success path: a single confirmation is enough
            }
            if ($buildExit -eq 0) {
                Add-Result 'Build image' 'FIXED' $fullImageRef
            } elseif ($imgPushed) {
                Add-Result 'Build image' 'FIXED' ("$fullImageRef - the 'az acr build' client exited non-zero (usually a Windows console log-encoding hiccup), but the image WAS built and pushed to ACR (verified by tag). Proceeding with the swap.")
            } else {
                Add-Result 'Build image' 'FAIL' 'az acr build failed AND the image tag is not present in ACR (check ACR access / Dockerfile / network reachability to a private ACR).'
            }
            if (($buildExit -eq 0 -or $imgPushed) -and $app -and $PSCmdlet.ShouldProcess($ContainerAppName, "Update image to $fullImageRef (new revision, no delete)")) {
                & az containerapp update -n $ContainerAppName -g $ResourceGroup --image $fullImageRef --only-show-errors | Out-Null
                if ($LASTEXITCODE -eq 0) { Add-Result 'Deploy image' 'FIXED' "App now runs $fullImageRef (ingress/env/networking unchanged)." }
                else { Add-Result 'Deploy image' 'FAIL' "Update failed - likely AcrPull missing. A normal run assigns it; or: az containerapp registry set -n $ContainerAppName -g $ResourceGroup --server $AcrName.azurecr.io --identity system" }
            }
        }
    }
}

# ──────────────────────────────────────────────────────────────────────────────
# 12. Write the evidence bundle + summary
# ──────────────────────────────────────────────────────────────────────────────
Write-Head 'SUMMARY & evidence bundle'
Save-Json 'results' $script:Results
Save-Json 'next_steps' (@($script:NextSteps))

$sb = New-Object System.Text.StringBuilder
[void]$sb.AppendLine('AZURE INFRA IQ - DIAGNOSTIC SUMMARY')
[void]$sb.AppendLine(('Generated (UTC): {0}' -f (Get-Date).ToUniversalTime().ToString('u')))
[void]$sb.AppendLine(('Subscription : {0}' -f $SubscriptionId))
[void]$sb.AppendLine(('Resource grp : {0}' -f $ResourceGroup))
[void]$sb.AppendLine(('Container App: {0}  Env: {1}' -f $ContainerAppName, $ContainerAppEnvName))
[void]$sb.AppendLine(('ACR: {0}  SQL: {1}  OpenAI: {2}' -f $AcrName, $SqlServerName, $OpenAiAccountName))
[void]$sb.AppendLine('')
[void]$sb.AppendLine('RESULTS:')
foreach ($r in $script:Results) { [void]$sb.AppendLine(('  [{0,-5}] {1} :: {2}' -f $r.Status, $r.Check, $r.Detail)) }
if ($script:NextSteps.Count -gt 0) {
    [void]$sb.AppendLine(''); [void]$sb.AppendLine('NEXT STEPS / MANUAL ACTIONS:')
    $n = 1; foreach ($s in $script:NextSteps) { [void]$sb.AppendLine(('  {0}. {1}' -f $n, $s)); $n++ }
}
Save-Text 'SUMMARY' ($sb.ToString())

Write-Host ''
$script:Results | Format-Table -AutoSize @{L='Status';E={$_.Status}}, @{L='Check';E={$_.Check}}, @{L='Detail';E={ if ($_.Detail.Length -gt 86) { $_.Detail.Substring(0,85)+'...' } else { $_.Detail } }} | Out-String | Write-Host
$counts = $script:Results | Group-Object Status | ForEach-Object { '{0}={1}' -f $_.Name, $_.Count }
Write-Host ("Totals: {0}" -f ($counts -join '  ')) -ForegroundColor Cyan
if ($script:NextSteps.Count -gt 0) {
    Write-Host ''; Write-Host 'NEXT STEPS / MANUAL ACTIONS:' -ForegroundColor Yellow
    $n = 1; foreach ($s in $script:NextSteps) { Write-Host ("  {0}. {1}" -f $n, $s) -ForegroundColor Yellow; $n++ }
}

try { Stop-Transcript | Out-Null } catch { }

$zipPath = "$OutputPath.zip"
try {
    if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
    Compress-Archive -Path (Join-Path $OutputPath '*') -DestinationPath $zipPath -Force
    Write-Host ''
    Write-Host ('EVIDENCE BUNDLE: {0}' -f $zipPath) -ForegroundColor Green
    Write-Host '  ^ Send this .zip back for deep analysis. Secrets in env vars are masked; please review before sharing.' -ForegroundColor Green
} catch {
    Write-Host ('Could not zip the evidence folder: {0}. Files are in: {1}' -f $_.Exception.Message, $OutputPath) -ForegroundColor Yellow
}
Write-Host ''
