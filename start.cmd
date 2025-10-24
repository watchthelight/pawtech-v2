@echo off
setlocal enabledelayedexpansion

REM ============================================================================
REM Pawtropolis Tech - Unified Start/Stop Script
REM ============================================================================
REM Usage:
REM   start.cmd --local              Start bot locally (npm run dev)
REM   start.cmd --local --fresh      Clean install + rebuild + start
REM   start.cmd --remote             Restart bot on remote server (PM2)
REM   start.cmd --remote --fresh     Full deploy: build + SCP + restart
REM   start.cmd --stop               Stop all local and remote processes
REM ============================================================================

REM === CONFIGURATION (Edit these for your environment) ===
set REMOTE_USER=ubuntu
set REMOTE_HOST=3.209.223.216
set REMOTE_PATH=/opt/pawtropolis-tech
set PM2_NAME=pawtropolis-tech
set LOCAL_PORT=3000

REM === Parse command line arguments ===
set ARG_LOCAL=0
set ARG_REMOTE=0
set ARG_FRESH=0
set ARG_STOP=0

:parse_args
if "%~1"=="" goto check_args
if /i "%~1"=="--local" (
    set ARG_LOCAL=1
    shift
    goto parse_args
)
if /i "%~1"=="--remote" (
    set ARG_REMOTE=1
    shift
    goto parse_args
)
if /i "%~1"=="--fresh" (
    set ARG_FRESH=1
    shift
    goto parse_args
)
if /i "%~1"=="--stop" (
    set ARG_STOP=1
    shift
    goto parse_args
)
echo [ERROR] Unknown argument: %~1
goto usage

:check_args
REM === Validate argument combinations ===
if %ARG_LOCAL%==1 if %ARG_REMOTE%==1 (
    echo [ERROR] Cannot use --local and --remote together
    goto usage
)

if %ARG_FRESH%==1 if %ARG_LOCAL%==0 if %ARG_REMOTE%==0 (
    echo [ERROR] --fresh requires either --local or --remote
    goto usage
)

if %ARG_LOCAL%==0 if %ARG_REMOTE%==0 if %ARG_STOP%==0 (
    echo [ERROR] No operation specified
    goto usage
)

REM === STOP OPERATION ===
if %ARG_STOP%==1 goto stop_all

REM === LOCAL OPERATIONS ===
if %ARG_LOCAL%==1 goto local_start

REM === REMOTE OPERATIONS ===
if %ARG_REMOTE%==1 goto remote_start

REM Should never reach here
goto usage

REM ============================================================================
REM LOCAL START
REM ============================================================================
:local_start
if %ARG_FRESH%==1 (
    echo.
    echo === LOCAL FRESH START ===
    echo [1/5] Checking for npm...
    where npm >nul 2>&1
    if errorlevel 1 (
        echo [ERROR] npm not found. Install Node.js from https://nodejs.org/
        exit /b 1
    )

    echo [2/5] Removing node_modules...
    if exist node_modules (
        rmdir /s /q node_modules
        if errorlevel 1 (
            echo [ERROR] Failed to remove node_modules
            exit /b 1
        )
    )

    echo [3/5] Clean installing dependencies...
    call npm ci
    if errorlevel 1 (
        echo [ERROR] npm ci failed
        exit /b 1
    )

    echo [4/5] Building project...
    call npm run build
    if errorlevel 1 (
        echo [ERROR] Build failed
        exit /b 1
    )

    echo [5/5] Starting bot...
    call npm start
    exit /b !errorlevel!
) else (
    echo.
    echo === LOCAL DEV START ===
    echo [1/2] Checking for npm...
    where npm >nul 2>&1
    if errorlevel 1 (
        echo [ERROR] npm not found. Install Node.js from https://nodejs.org/
        exit /b 1
    )

    echo [2/2] Starting development server...
    call npm run dev
    exit /b !errorlevel!
)

REM ============================================================================
REM REMOTE START
REM ============================================================================
:remote_start
if %ARG_FRESH%==1 (
    echo.
    echo === REMOTE FRESH DEPLOY ===

    REM Check if deploy.ps1 exists and use it
    if exist deploy.ps1 (
        echo [1/1] Running deploy.ps1...
        powershell -ExecutionPolicy Bypass -File deploy.ps1
        exit /b !errorlevel!
    )

    REM Fallback: manual deploy process
    echo [1/6] Checking for required tools...
    where npm >nul 2>&1
    if errorlevel 1 (
        echo [ERROR] npm not found. Install Node.js from https://nodejs.org/
        exit /b 1
    )

    where ssh >nul 2>&1
    if errorlevel 1 (
        echo [ERROR] ssh not found. Install OpenSSH or Git for Windows
        exit /b 1
    )

    where scp >nul 2>&1
    if errorlevel 1 (
        echo [ERROR] scp not found. Install OpenSSH or Git for Windows
        exit /b 1
    )

    echo [2/6] Building project locally...
    call npm run build
    if errorlevel 1 (
        echo [ERROR] Build failed
        exit /b 1
    )

    echo [3/6] Creating deployment tarball...
    if exist deploy.tar.gz del /f deploy.tar.gz
    tar -czf deploy.tar.gz dist package.json package-lock.json
    if errorlevel 1 (
        echo [ERROR] Failed to create tarball
        exit /b 1
    )

    echo [4/6] Uploading to remote server...
    scp deploy.tar.gz %REMOTE_USER%@%REMOTE_HOST%:%REMOTE_PATH%/
    if errorlevel 1 (
        echo [ERROR] Failed to upload tarball
        exit /b 1
    )

    echo [5/6] Extracting and installing on remote...
    ssh %REMOTE_USER%@%REMOTE_HOST% "cd %REMOTE_PATH% && tar -xzf deploy.tar.gz && npm ci --omit=dev"
    if errorlevel 1 (
        echo [ERROR] Remote extraction/install failed
        exit /b 1
    )

    echo [6/6] Restarting PM2 process...
    ssh %REMOTE_USER%@%REMOTE_HOST% "pm2 restart %PM2_NAME%"
    if errorlevel 1 (
        echo [WARN] PM2 restart failed, attempting start...
        ssh %REMOTE_USER%@%REMOTE_HOST% "pm2 start %REMOTE_PATH%/dist/index.js --name %PM2_NAME%"
    )

    echo.
    echo [SUCCESS] Remote fresh deploy complete
    echo Cleaning up local tarball...
    if exist deploy.tar.gz del /f deploy.tar.gz
    exit /b 0
) else (
    echo.
    echo === REMOTE RESTART ===
    echo [1/2] Checking for ssh...
    where ssh >nul 2>&1
    if errorlevel 1 (
        echo [ERROR] ssh not found. Install OpenSSH or Git for Windows
        exit /b 1
    )

    echo [2/2] Restarting PM2 process on remote...
    ssh %REMOTE_USER%@%REMOTE_HOST% "pm2 restart %PM2_NAME%"
    if errorlevel 1 (
        echo [ERROR] Failed to restart remote process
        echo [INFO] Check if PM2 process exists: ssh %REMOTE_USER%@%REMOTE_HOST% "pm2 list"
        exit /b 1
    )

    echo.
    echo [SUCCESS] Remote bot restarted
    exit /b 0
)

REM ============================================================================
REM STOP ALL OPERATIONS
REM ============================================================================
:stop_all
echo.
echo === STOP ALL PROCESSES ===

REM Stop local PM2 process (if running)
echo [1/4] Checking for local PM2 process...
where pm2 >nul 2>&1
if not errorlevel 1 (
    echo Stopping local PM2 process: %PM2_NAME%...
    pm2 stop %PM2_NAME% >nul 2>&1
    pm2 delete %PM2_NAME% >nul 2>&1
    echo Local PM2 process stopped ^(if it was running^)
) else (
    echo PM2 not found locally, skipping local stop
)

REM Kill any process using local port
echo [2/4] Freeing port %LOCAL_PORT%...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%LOCAL_PORT%"') do (
    echo Killing process %%a on port %LOCAL_PORT%...
    taskkill /F /PID %%a >nul 2>&1
)
echo Port %LOCAL_PORT% freed ^(if it was occupied^)

REM Stop Node.js dev processes
echo [3/4] Stopping Node.js dev processes...
taskkill /F /IM node.exe >nul 2>&1
echo Node.js processes stopped ^(if any were running^)

REM Stop remote PM2 process
echo [4/4] Stopping remote PM2 process...
where ssh >nul 2>&1
if not errorlevel 1 (
    ssh %REMOTE_USER%@%REMOTE_HOST% "pm2 stop %PM2_NAME% && pm2 save" >nul 2>&1
    if errorlevel 1 (
        echo [WARN] Failed to stop remote process ^(may not be running^)
    ) else (
        echo Remote PM2 process stopped
    )
) else (
    echo SSH not found, skipping remote stop
)

echo.
echo [SUCCESS] Stop operation complete
exit /b 0

REM ============================================================================
REM USAGE INFORMATION
REM ============================================================================
:usage
echo.
echo Usage: start.cmd [OPTIONS]
echo.
echo Options:
echo   --local              Start bot locally using npm run dev
echo   --local --fresh      Clean install, rebuild, and start locally
echo   --remote             Restart bot on remote server ^(PM2^)
echo   --remote --fresh     Full deploy: build + upload + restart
echo   --stop               Stop all local and remote processes
echo.
echo Examples:
echo   start.cmd --local                  # Dev mode with hot reload
echo   start.cmd --local --fresh          # Full rebuild and start
echo   start.cmd --remote                 # Quick restart on server
echo   start.cmd --remote --fresh         # Deploy latest code to server
echo   start.cmd --stop                   # Stop everything
echo.
echo Configuration ^(edit at top of script^):
echo   REMOTE_USER=%REMOTE_USER%
echo   REMOTE_HOST=%REMOTE_HOST%
echo   REMOTE_PATH=%REMOTE_PATH%
echo   PM2_NAME=%PM2_NAME%
echo.
exit /b 1
