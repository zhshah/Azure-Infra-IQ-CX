@echo off
echo Starting Azure Cost Optimizer...

:: Check setup has been run
if not exist "%~dp0backend\.venv" (
    echo Setup not complete. Running install.bat first...
    call "%~dp0install.bat"
)

:: Kill anything on port 8000
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":8000 "') do taskkill /F /PID %%a 2>nul

:: Read Azure credentials from backend .env for ZureMap
set "ZUREMAP_TID="
set "ZUREMAP_CID="
set "ZUREMAP_SEC="
set "ZUREMAP_SUB="
if exist "%~dp0backend\.env" (
    for /f "usebackq tokens=1,* delims==" %%a in ("%~dp0backend\.env") do (
        if "%%a"=="AZURE_TENANT_ID" set "ZUREMAP_TID=%%b"
        if "%%a"=="AZURE_CLIENT_ID" set "ZUREMAP_CID=%%b"
        if "%%a"=="AZURE_CLIENT_SECRET" set "ZUREMAP_SEC=%%b"
        if "%%a"=="AZURE_SUBSCRIPTION_ID" set "ZUREMAP_SUB=%%b"
    )
)

:: Start ZureMap container if Docker is available
where docker >nul 2>&1
if %errorlevel%==0 (
    docker ps --format "{{.Names}}" | findstr /c:"zuremap" >nul 2>&1
    if %errorlevel% neq 0 (
        echo Starting ZureMap architecture diagram container...
        docker pull ghcr.io/natechsa/zuremap:latest 2>nul
        docker rm zuremap 2>nul
        docker run -d --name zuremap -p 3001:3001 --dns 8.8.8.8 --dns 1.1.1.1 -e "AZURE_TENANT_ID=%ZUREMAP_TID%" -e "AZURE_CLIENT_ID=%ZUREMAP_CID%" -e "AZURE_CLIENT_SECRET=%ZUREMAP_SEC%" -e "AZURE_SUBSCRIPTION_ID=%ZUREMAP_SUB%" ghcr.io/natechsa/zuremap:latest 2>nul
        :: Auto-login service principal so ZureMap doesn't prompt
        if defined ZUREMAP_CID if defined ZUREMAP_SEC if defined ZUREMAP_TID (
            echo Authenticating ZureMap with service principal...
            timeout /t 3 /nobreak >nul
            docker exec zuremap az login --service-principal --username "%ZUREMAP_CID%" --password "%ZUREMAP_SEC%" --tenant "%ZUREMAP_TID%" --output none 2>nul
            docker exec zuremap az extension add --name resource-graph --yes 2>nul
            :: Patch ZureMap default currency from EUR to USD
            docker exec zuremap sh -c "cd /app/dist/zuremap/browser && sed -i 's/baseCurrency:\"EUR\"/baseCurrency:\"USD\"/g' chunk-*.js 2>/dev/null" 2>nul
        )
    ) else (
        echo ZureMap already running.
    )
) else (
    echo Docker not found - ZureMap Architecture Map will not be available.
    echo Install Docker and run: docker run -d --name zuremap -p 3001:3001 ghcr.io/natechsa/zuremap:latest
)

:: Always rebuild frontend to pick up latest changes
echo Building frontend...
cd /d "%~dp0frontend"
call npm run build

:: Start backend (serves frontend + API on port 8000)
start "Azure Cost Optimizer" cmd /k "cd /d %~dp0backend && .venv\Scripts\python.exe -m uvicorn main:app --port 8000"

:: Wait then open browser
timeout /t 3 /nobreak >nul
start http://localhost:8000

echo Azure Cost Optimizer running at http://localhost:8000
