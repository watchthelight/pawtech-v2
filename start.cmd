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
set REMOTE_ALIAS=pawtech
set REMOTE_PATH=/home/ubuntu/pawtropolis-tech
set PM2_NAME=pawtropolis
set LOCAL_PORT=3000
set DB_LOCAL=.\data\data.db
set DB_REMOTE=%REMOTE_PATH%/data/data.db

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
REM Sync database before starting
call :sync_db

if %ARG_FRESH%==1 (
    echo.
    echo === LOCAL FRESH START ===
    echo [1/7] Checking for npm...
    where npm >nul 2>&1
    if errorlevel 1 (
        echo [ERROR] npm not found. Install Node.js from https://nodejs.org/
        exit /b 1
    )

    echo [2/7] Removing node_modules...
    if exist node_modules (
        rmdir /s /q node_modules
        if errorlevel 1 (
            echo [ERROR] Failed to remove node_modules
            exit /b 1
        )
    )

    echo [3/7] Clean installing dependencies...
    call npm ci
    if errorlevel 1 (
        echo [ERROR] npm ci failed
        exit /b 1
    )

    echo [4/7] Running tests...
    call npm run test
    if errorlevel 1 (
        echo [ERROR] Tests failed; aborting start.
        exit /b 1
    )

    echo [5/7] Building project...
    call npm run build
    if errorlevel 1 (
        echo [ERROR] Build failed
        exit /b 1
    )

    echo [6/7] Starting bot...
    call npm start
    exit /b !errorlevel!
) else (
    echo.
    echo === LOCAL DEV START ===
    echo [1/4] Checking for npm...
    where npm >nul 2>&1
    if errorlevel 1 (
        echo [ERROR] npm not found. Install Node.js from https://nodejs.org/
        exit /b 1
    )

    echo [2/4] Running tests...
    call npm run test
    if errorlevel 1 (
        echo [ERROR] Tests failed; aborting start.
        exit /b 1
    )

    echo [3/4] Building project...
    call npm run build
    if errorlevel 1 (
        echo [ERROR] Build failed
        exit /b 1
    )

    echo [4/4] Starting development server...
    call npm run dev
    exit /b !errorlevel!
)

REM ============================================================================
REM REMOTE START
REM ============================================================================
:remote_start
REM Sync database before starting remote
call :sync_db

if %ARG_FRESH%==1 (
    echo.
    echo === REMOTE FRESH DEPLOY ===

    REM Manual bot deploy process (deploy.ps1 is for the website only)
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
    scp deploy.tar.gz %REMOTE_ALIAS%:%REMOTE_PATH%/
    if errorlevel 1 (
        echo [ERROR] Failed to upload tarball
        exit /b 1
    )

    echo [5/6] Extracting and installing on remote...
    ssh %REMOTE_ALIAS% "bash -lc 'cd %REMOTE_PATH% && tar -xzf deploy.tar.gz && npm ci'"
    if errorlevel 1 (
        echo [ERROR] Remote extraction/install failed
        exit /b 1
    )

    echo [6/6] Restarting PM2 process...
    ssh %REMOTE_ALIAS% "bash -lc 'pm2 restart %PM2_NAME%'"
    if errorlevel 1 (
        echo [WARN] PM2 restart failed, attempting start...
        ssh %REMOTE_ALIAS% "bash -lc 'pm2 start %REMOTE_PATH%/dist/index.js --name %PM2_NAME%'"
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
    ssh %REMOTE_ALIAS% "bash -lc 'pm2 restart %PM2_NAME%'"
    if errorlevel 1 (
        echo [ERROR] Failed to restart remote process
        echo [INFO] Check if PM2 process exists: ssh %REMOTE_ALIAS% "bash -lc 'pm2 list'"
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
    ssh %REMOTE_ALIAS% "bash -lc 'pm2 stop %PM2_NAME% && pm2 save'" >nul 2>&1
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
REM DATABASE SYNCHRONIZATION
REM ============================================================================
:sync_db
echo.
echo === SYNCING DATABASE ===
echo [sync] Reconciling database between local and remote...

REM Ensure local data directory exists
if not exist ".\data" mkdir ".\data"

REM --- Collect local stats (mtime epoch + sha256 or "missing")
for /f "usebackq delims=" %%A in (`powershell -NoProfile -Command "if (Test-Path '%DB_LOCAL%'){ $i=Get-Item '%DB_LOCAL%'; $mt=[int][double](Get-Date $i.LastWriteTimeUtc -UFormat '%%s'); $h=(Get-FileHash '%DB_LOCAL%' -Algorithm SHA256).Hash; Write-Output \"$mt $h\" } else { Write-Output 'missing missing' }"`) do set "LOCAL_STAT=%%A"
for /f "tokens=1,2" %%m in ("%LOCAL_STAT%") do ( set "L_MTIME=%%m" & set "L_HASH=%%n" )

REM --- Collect remote stats
for /f "usebackq tokens=1,2" %%m in (`ssh %REMOTE_ALIAS% "bash -c 'if [ -f %DB_REMOTE% ]; then echo $(stat -c %%Y %DB_REMOTE%) $(sha256sum %DB_REMOTE% | cut -d\" \" -f1); else echo missing missing; fi'"`) do ( set "R_MTIME=%%m" & set "R_HASH=%%n" )

echo [sync] local:  %L_MTIME% %L_HASH%
echo [sync] remote: %R_MTIME% %R_HASH%

REM --- Decide action
if "%L_MTIME%"=="missing" if "%R_MTIME%"=="missing" (
    echo [sync] No database found on either side; nothing to sync.
    goto :eof
)

if not "%L_MTIME%"=="missing" if "%R_MTIME%"=="missing" (
    echo [sync] Remote missing, pushing local copy...
    ssh %REMOTE_ALIAS% "bash -c 'mkdir -p %REMOTE_PATH%/data && cp -f %DB_REMOTE% %DB_REMOTE%.bak.$(date +%%s) 2>/dev/null || true'"
    scp "%DB_LOCAL%" %REMOTE_ALIAS%:"%DB_REMOTE%"
    echo [sync] Local database pushed to remote
    goto :eof
)

if "%L_MTIME%"=="missing" if not "%R_MTIME%"=="missing" (
    echo [sync] Local missing, pulling remote copy...
    powershell -NoProfile -Command "if (Test-Path '%DB_LOCAL%'){ Copy-Item '%DB_LOCAL%' ('%DB_LOCAL%.bak.' + [int][double]([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())) }"
    scp %REMOTE_ALIAS%:"%DB_REMOTE%" "%DB_LOCAL%"
    echo [sync] Remote database pulled to local
    goto :eof
)

REM Both exist; if hashes equal, done
if /I "%L_HASH%"=="%R_HASH%" (
    echo [sync] Databases identical; nothing to do.
    goto :eof
)

REM Choose newer mtime (compare as integers using PowerShell)
for /f %%i in ('powershell -NoProfile -Command "if ([int]'%L_MTIME%' -ge [int]'%R_MTIME%') { 'local' } else { 'remote' }"') do set NEWER=%%i

if "%NEWER%"=="local" (
    echo [sync] Local is newer, pushing to remote...
    ssh %REMOTE_ALIAS% "bash -c 'cp -f %DB_REMOTE% %DB_REMOTE%.bak.$(date +%%s) 2>/dev/null || true'"
    scp "%DB_LOCAL%" %REMOTE_ALIAS%:"%DB_REMOTE%"
    echo [sync] Local database pushed to remote
) else (
    echo [sync] Remote is newer, pulling to local...
    powershell -NoProfile -Command "Copy-Item '%DB_LOCAL%' ('%DB_LOCAL%.bak.' + [int][double]([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())) -ErrorAction SilentlyContinue"
    scp %REMOTE_ALIAS%:"%DB_REMOTE%" "%DB_LOCAL%"
    echo [sync] Remote database pulled to local
)
goto :eof

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
echo   REMOTE_ALIAS=%REMOTE_ALIAS%
echo   REMOTE_PATH=%REMOTE_PATH%
echo   PM2_NAME=%PM2_NAME%
echo.
exit /b 1
