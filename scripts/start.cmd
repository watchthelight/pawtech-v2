@echo off
setlocal enabledelayedexpansion

REM ============================================================================
REM Pawtropolis Tech - Unified Start/Stop Script with DB Sync
REM ============================================================================
REM Usage:
REM   start.cmd --local              Start bot locally (pulls remote DB first)
REM   start.cmd --local --fresh      Clean install + rebuild + start
REM   start.cmd --remote             Restart bot on remote server (pulls remote DB first)
REM   start.cmd --remote --fresh     Full deploy: build + upload + restart
REM   start.cmd --stop               Stop all local and remote processes
REM   start.cmd --push-remote        Push local DB to remote (explicit only)
REM   start.cmd --recover-remote-db  Download all remote DB candidates to _recovery\remote\
REM
REM DB Sync Behavior:
REM   - Default: Always pulls remote DB → local (if remote exists)
REM   - Creates timestamped backups before any changes
REM   - Never pushes to remote unless --push-remote is explicitly provided
REM   - Writes manifest to data\.db-manifest.json after sync
REM
REM Recovery:
REM   - --recover-remote-db: Scans remote for all DB files/archives
REM   - Copies them to _recovery\remote\ without overwriting
REM ============================================================================

REM === CONFIGURATION (Edit these for your environment) ===
set REMOTE_ALIAS=pawtech
set REMOTE_PATH=/home/ubuntu/pawtropolis-tech
set PM2_NAME=pawtropolis
set LOCAL_PORT=3000
set DB_LOCAL=.\data\data.db
set DB_REMOTE=%REMOTE_PATH%/data/data.db
set MANIFEST_FILE=data\.db-manifest.json

REM === Parse command line arguments ===
set ARG_LOCAL=0
set ARG_REMOTE=0
set ARG_FRESH=0
set ARG_STOP=0
set ARG_PUSH_REMOTE=0
set ARG_RECOVER_DB=0
set ARG_RECOVER=0
set ARG_SKIP_SYNC=0

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
if /i "%~1"=="--push-remote" (
    set ARG_PUSH_REMOTE=1
    shift
    goto parse_args
)
if /i "%~1"=="--recover-remote-db" (
    set ARG_RECOVER_DB=1
    shift
    goto parse_args
)
if /i "%~1"=="--recover" (
    set ARG_RECOVER=1
    shift
    goto parse_args
)
if /i "%~1"=="--skip-sync" (
    set ARG_SKIP_SYNC=1
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

REM === INTERACTIVE RECOVERY ===
if %ARG_RECOVER%==1 goto interactive_recovery

if %ARG_RECOVER_DB%==1 goto recover_remote_db

if %ARG_PUSH_REMOTE%==1 goto push_db_to_remote

REM === STOP OPERATION ===
if %ARG_STOP%==1 goto stop_all

if %ARG_LOCAL%==0 if %ARG_REMOTE%==0 if %ARG_STOP%==0 if %ARG_PUSH_REMOTE%==0 (
    echo [ERROR] No operation specified
    goto usage
)

REM === LOCAL OPERATIONS ===
if %ARG_LOCAL%==1 goto local_start

REM === REMOTE OPERATIONS ===
if %ARG_REMOTE%==1 goto remote_start

REM Should never reach here
goto usage

REM ============================================================================
REM DB SYNC (REMOTE-PREFERRED)
REM ============================================================================
:sync_db_remote_preferred
echo.
echo === DB SYNC (REMOTE-PREFERRED) ===
echo [sync] Pulling remote database to local (default behavior)...

REM Ensure local data directory exists
if not exist ".\data" mkdir ".\data"
if not exist ".\data\backups" mkdir ".\data\backups"

REM Ensure remote data/backups directory exists
ssh %REMOTE_ALIAS% "bash -c 'mkdir -p %REMOTE_PATH%/data/backups'"

REM --- Collect local metadata ---
set L_EXISTS=0
set L_MTIME=0
set L_SIZE=0
set L_SHA256=

if exist "%DB_LOCAL%" (
    set L_EXISTS=1
    for /f "usebackq" %%s in (`powershell -NoProfile -Command "(Get-Item '%DB_LOCAL%').Length"`) do set L_SIZE=%%s
    for /f "usebackq" %%t in (`powershell -NoProfile -Command "[int][double](Get-Date (Get-Item '%DB_LOCAL%').LastWriteTimeUtc -UFormat '%%s')"`) do set L_MTIME=%%t
    for /f "usebackq" %%h in (`powershell -NoProfile -Command "(Get-FileHash '%DB_LOCAL%' -Algorithm SHA256).Hash"`) do set L_SHA256=%%h
    echo [sync] local:  exists=%L_EXISTS% mtime=%L_MTIME% size=%L_SIZE% sha256=%L_SHA256%
) else (
    echo [sync] local:  not found
)

REM --- Collect remote metadata ---
set R_EXISTS=0
set R_MTIME=0
set R_SIZE=0
set R_SHA256=

for /f "usebackq tokens=1,2,3" %%m in (`ssh %REMOTE_ALIAS% "bash -c 'if [ -f %DB_REMOTE% ]; then echo $(stat -c %%Y %DB_REMOTE%) $(stat -c %%s %DB_REMOTE%) $(sha256sum %DB_REMOTE% | cut -d\" \" -f1); else echo 0 0 MISSING; fi'"`) do (
    set R_MTIME=%%m
    set R_SIZE=%%n
    set R_SHA256=%%o
)

if not "%R_SHA256%"=="MISSING" (
    set R_EXISTS=1
    echo [sync] remote: exists=%R_EXISTS% mtime=%R_MTIME% size=%R_SIZE% sha256=%R_SHA256%
) else (
    echo [sync] remote: not found
)

REM --- Decide action: remote-preferred pull ---
if %R_EXISTS%==0 (
    echo.
    echo [WARN] Remote database does not exist!
    echo [WARN] Local DB will NOT be pushed automatically.
    echo [WARN] If you want to seed the remote, run:
    echo [WARN]   start.cmd --push-remote
    echo.
    goto write_manifest
)

REM Remote exists, pull it to local
echo.
echo [sync] Remote database found - pulling to local...

REM Create local backup if local exists
if %L_EXISTS%==1 (
    for /f "usebackq" %%t in (`powershell -NoProfile -Command "Get-Date -Format 'yyyyMMdd-HHmmss'"`) do set TIMESTAMP=%%t
    set LOCAL_BACKUP=data\backups\data-!TIMESTAMP!.local.db
    echo [sync] Backing up local → !LOCAL_BACKUP!
    copy "%DB_LOCAL%" "!LOCAL_BACKUP!" >nul
)

REM Create remote backup (include WAL/SHM files)
for /f "usebackq" %%t in (`ssh %REMOTE_ALIAS% "date +%%Y%%m%%d-%%H%%M%%S"`) do set R_TIMESTAMP=%%t
set REMOTE_BACKUP=%REMOTE_PATH%/data/backups/data-!R_TIMESTAMP!.remote.db
echo [sync] Backing up remote → !REMOTE_BACKUP!
REM Use timeout to prevent hang if DB is locked; passive checkpoint is safe even if it fails
ssh %REMOTE_ALIAS% "timeout 5 sqlite3 %DB_REMOTE% 'PRAGMA wal_checkpoint(PASSIVE);' 2>/dev/null || true; cp %DB_REMOTE% !REMOTE_BACKUP!; [ -f %DB_REMOTE%-wal ] && cp %DB_REMOTE%-wal !REMOTE_BACKUP!-wal || true; [ -f %DB_REMOTE%-shm ] && cp %DB_REMOTE%-shm !REMOTE_BACKUP!-shm || true"

REM Pull remote → local (with WAL checkpoint and WAL/SHM files)
echo [sync] Pulling remote database to local...

REM Step 0: Verify remote database integrity BEFORE pulling (optional, non-blocking)
echo [sync] Verifying remote database integrity...
ssh -o ConnectTimeout=5 -o BatchMode=yes %REMOTE_ALIAS% "bash -c 'cd %REMOTE_PATH% 2>/dev/null && timeout 10 node scripts/verify-db-integrity.js %DB_REMOTE% 2>/dev/null'" >nul 2>&1
if errorlevel 1 (
    echo [sync] Remote verification unavailable or failed - will verify after download
) else (
    echo [sync] ✓ Remote database passed integrity check
)

REM Step 1: Checkpoint the WAL on remote to ensure consistency
REM Use PASSIVE checkpoint with timeout to avoid hanging if DB is locked by running bot
echo [sync] Checkpointing WAL on remote (passive mode, non-blocking)...
ssh %REMOTE_ALIAS% "timeout 5 sqlite3 %DB_REMOTE% 'PRAGMA wal_checkpoint(PASSIVE);' 2>/dev/null || echo '[INFO] WAL checkpoint timed out (bot may be running)'"

REM Step 2: Copy main database file to temporary location first
set TEMP_DB=%DB_LOCAL%.temp
scp %REMOTE_ALIAS%:%DB_REMOTE% "%TEMP_DB%"
if errorlevel 1 (
    echo [ERROR] Failed to pull remote database
    exit /b 1
)

REM Step 2.5: Verify the downloaded database before replacing local
echo [sync] Verifying downloaded database...
node scripts/verify-db-integrity.js "%TEMP_DB%" >nul 2>&1
if errorlevel 1 (
    echo.
    echo ╔═══════════════════════════════════════════════════════════════╗
    echo ║  ERROR: DOWNLOADED DATABASE IS CORRUPTED                      ║
    echo ║  The remote database copy failed integrity check.             ║
    echo ║  Your local database has NOT been overwritten.                ║
    echo ╚═══════════════════════════════════════════════════════════════╝
    echo.
    del "%TEMP_DB%" >nul 2>&1
    exit /b 1
)
echo [sync] ✓ Downloaded database verified

REM Step 2.6: Replace local database with verified copy
move /Y "%TEMP_DB%" "%DB_LOCAL%" >nul
echo [sync] ✓ Local database replaced

REM Step 3: Copy WAL file if it exists
scp %REMOTE_ALIAS%:%DB_REMOTE%-wal "%DB_LOCAL%-wal" 2>nul
if not errorlevel 1 (
    echo [sync] WAL file copied
)

REM Step 4: Copy SHM file if it exists
scp %REMOTE_ALIAS%:%DB_REMOTE%-shm "%DB_LOCAL%-shm" 2>nul
if not errorlevel 1 (
    echo [sync] SHM file copied
)

echo [sync] ✓ Remote database pulled successfully
set SYNC_MODE=pull-remote
goto write_manifest

REM ============================================================================
REM PUSH DB TO REMOTE (EXPLICIT ONLY)
REM ============================================================================
:push_db_to_remote
echo.
echo === DB SYNC (PUSH TO REMOTE) ===
echo [sync] Pushing local database to remote (EXPLICIT MODE)...

REM IMPORTANT: Stop remote PM2 process to prevent database corruption during push
echo [sync] Checking remote PM2 status...
for /f "usebackq" %%s in (`ssh %REMOTE_ALIAS% "bash -lc 'pm2 jlist 2>/dev/null | grep -c \"\\\"name\\\":\\\"%PM2_NAME%\\\"\" || echo 0'"`) do set PM2_RUNNING=%%s

if %PM2_RUNNING% GTR 0 (
    echo [sync] Remote PM2 process is running - stopping to prevent corruption...
    ssh %REMOTE_ALIAS% "bash -lc 'pm2 stop %PM2_NAME%'" >nul 2>&1
    echo [sync] Remote process stopped
) else (
    echo [sync] Remote PM2 process not running (safe to push)
)

REM Ensure directories exist
if not exist ".\data" mkdir ".\data"
if not exist ".\data\backups" mkdir ".\data\backups"
ssh %REMOTE_ALIAS% "bash -c 'mkdir -p %REMOTE_PATH%/data/backups'"

REM Check local exists
if not exist "%DB_LOCAL%" (
    echo [ERROR] Local database does not exist: %DB_LOCAL%
    exit /b 1
)

REM Collect local metadata
for /f "usebackq" %%s in (`powershell -NoProfile -Command "(Get-Item '%DB_LOCAL%').Length"`) do set L_SIZE=%%s
for /f "usebackq" %%t in (`powershell -NoProfile -Command "[int][double](Get-Date (Get-Item '%DB_LOCAL%').LastWriteTimeUtc -UFormat '%%s')"`) do set L_MTIME=%%t
for /f "usebackq" %%h in (`powershell -NoProfile -Command "(Get-FileHash '%DB_LOCAL%' -Algorithm SHA256).Hash"`) do set L_SHA256=%%h
echo [sync] local:  mtime=%L_MTIME% size=%L_SIZE% sha256=%L_SHA256%

REM Checkpoint local WAL before push
echo [sync] Checkpointing local WAL...
powershell -NoProfile -Command "& { try { $db = New-Object System.Data.SQLite.SQLiteConnection('Data Source=%DB_LOCAL%'); $db.Open(); $cmd = $db.CreateCommand(); $cmd.CommandText = 'PRAGMA wal_checkpoint(TRUNCATE)'; $cmd.ExecuteNonQuery() | Out-Null; $db.Close(); Write-Host '[sync] WAL checkpoint complete' } catch { Write-Host '[WARN] WAL checkpoint failed - trying sqlite3 command' } }" 2>nul
if errorlevel 1 (
    REM Fallback to sqlite3 command if available
    where sqlite3 >nul 2>&1
    if not errorlevel 1 (
        sqlite3 "%DB_LOCAL%" "PRAGMA wal_checkpoint(TRUNCATE);" 2>nul
    )
)

REM Create local backup (including WAL/SHM files)
for /f "usebackq" %%t in (`powershell -NoProfile -Command "Get-Date -Format 'yyyyMMdd-HHmmss'"`) do set TIMESTAMP=%%t
set LOCAL_BACKUP=data\backups\data-!TIMESTAMP!.local.db
echo [sync] Backing up local → !LOCAL_BACKUP!
copy "%DB_LOCAL%" "!LOCAL_BACKUP!" >nul
if exist "%DB_LOCAL%-wal" (
    copy "%DB_LOCAL%-wal" "!LOCAL_BACKUP!-wal" >nul
    echo [sync] Backed up local WAL file
)
if exist "%DB_LOCAL%-shm" (
    copy "%DB_LOCAL%-shm" "!LOCAL_BACKUP!-shm" >nul
    echo [sync] Backed up local SHM file
)

REM Check if remote exists and back it up (including WAL/SHM)
for /f "usebackq" %%e in (`ssh %REMOTE_ALIAS% "bash -c 'if [ -f %DB_REMOTE% ]; then echo 1; else echo 0; fi'"`) do set R_EXISTS=%%e
if %R_EXISTS%==1 (
    for /f "usebackq" %%t in (`ssh %REMOTE_ALIAS% "date +%%Y%%m%%d-%%H%%M%%S"`) do set R_TIMESTAMP=%%t
    set REMOTE_BACKUP=%REMOTE_PATH%/data/backups/data-!R_TIMESTAMP!.remote.db
    echo [sync] Backing up remote → !REMOTE_BACKUP!
    ssh %REMOTE_ALIAS% "sqlite3 %DB_REMOTE% 'PRAGMA wal_checkpoint(TRUNCATE);' 2>/dev/null; cp %DB_REMOTE% !REMOTE_BACKUP!; [ -f %DB_REMOTE%-wal ] && cp %DB_REMOTE%-wal !REMOTE_BACKUP!-wal || true; [ -f %DB_REMOTE%-shm ] && cp %DB_REMOTE%-shm !REMOTE_BACKUP!-shm || true"
)

REM Push local → remote (including WAL/SHM files)
echo.
echo ╔════════════════════════════════════════════════════════════╗
echo ║  PUSHING LOCAL DATABASE TO REMOTE                         ║
echo ║  This will overwrite the remote database!                 ║
echo ╚════════════════════════════════════════════════════════════╝
echo.

REM Step 1: Push main database file
scp "%DB_LOCAL%" %REMOTE_ALIAS%:%DB_REMOTE%
if errorlevel 1 (
    echo [ERROR] Failed to push database to remote
    exit /b 1
)

REM Step 2: Push WAL file if it exists
if exist "%DB_LOCAL%-wal" (
    scp "%DB_LOCAL%-wal" %REMOTE_ALIAS%:%DB_REMOTE%-wal
    if not errorlevel 1 (
        echo [sync] WAL file pushed
    )
)

REM Step 3: Push SHM file if it exists
if exist "%DB_LOCAL%-shm" (
    scp "%DB_LOCAL%-shm" %REMOTE_ALIAS%:%DB_REMOTE%-shm
    if not errorlevel 1 (
        echo [sync] SHM file pushed
    )
)

echo.
echo [sync] ✓ Local database pushed to remote successfully
echo.
echo [IMPORTANT] Remote PM2 process was stopped to prevent corruption.
echo [IMPORTANT] To restart the remote bot, run:
echo [IMPORTANT]   start.cmd --remote
echo.
set SYNC_MODE=push-remote

REM Collect remote metadata after push
for /f "usebackq tokens=1,2,3" %%m in (`ssh %REMOTE_ALIAS% "bash -c 'echo $(stat -c %%Y %DB_REMOTE%) $(stat -c %%s %DB_REMOTE%) $(sha256sum %DB_REMOTE% | cut -d\" \" -f1)'"`) do (
    set R_MTIME=%%m
    set R_SIZE=%%n
    set R_SHA256=%%o
)

REM Write manifest
set L_EXISTS=1
set R_EXISTS=1
goto write_manifest_after_sync

REM ============================================================================
REM RECOVER REMOTE DB
REM ============================================================================
:recover_remote_db
echo.
echo === DB RECOVERY (REMOTE SEARCH) ===
echo [recovery] Searching for database files on remote...

if not exist "_recovery" mkdir "_recovery"
if not exist "_recovery\remote" mkdir "_recovery\remote"

REM Create a temp file list on remote
echo [recovery] Scanning remote filesystem...
ssh %REMOTE_ALIAS% "bash -c 'find %REMOTE_PATH%/data -name \"*.db*\" 2>/dev/null; find ~/data -name \"*.db*\" 2>/dev/null; find ~/app -path \"*/data/*.db*\" 2>/dev/null; find ~/backups -name \"*.db*\" 2>/dev/null; find %REMOTE_PATH%/data/backups -name \"*.tar\" -o -name \"*.gz\" -o -name \"*.zip\" 2>/dev/null'" > _recovery\remote_candidates.txt

REM Count candidates
for /f %%c in ('powershell -NoProfile -Command "(Get-Content _recovery\remote_candidates.txt | Measure-Object -Line).Lines"') do set CANDIDATE_COUNT=%%c
echo [recovery] Found %CANDIDATE_COUNT% candidate files

if %CANDIDATE_COUNT%==0 (
    echo [recovery] No database files found on remote
    goto :eof
)

REM Show candidates with metadata
echo.
echo [recovery] Remote database candidates:
echo ========================================
for /f "usebackq delims=" %%f in ("_recovery\remote_candidates.txt") do (
    for /f "tokens=1,2" %%m in ('ssh %REMOTE_ALIAS% "bash -c 'if [ -f \"%%f\" ]; then stat -c \"%%Y %%s\" \"%%f\"; fi'"') do (
        echo %%f ^(mtime=%%m size=%%m bytes^)
    )
)

echo.
echo [recovery] Copying candidates to _recovery\remote\...

REM Copy each candidate
set COPY_COUNT=0
for /f "usebackq delims=" %%f in ("_recovery\remote_candidates.txt") do (
    REM Create local mirror path
    set REMOTE_FILE=%%f
    set LOCAL_MIRROR=_recovery\remote\!REMOTE_FILE:%REMOTE_PATH%/=!
    set LOCAL_MIRROR=!LOCAL_MIRROR:/=\!

    REM Ensure directory exists
    for %%d in ("!LOCAL_MIRROR!") do (
        if not exist "%%~dpd" mkdir "%%~dpd"
    )

    REM Check if local file exists, append number if needed
    set TARGET=!LOCAL_MIRROR!
    set SUFFIX=0
    :check_exists
    if exist "!TARGET!" (
        set /a SUFFIX+=1
        set TARGET=!LOCAL_MIRROR!.!SUFFIX!
        goto check_exists
    )

    echo [recovery] Copying %%f → !TARGET!
    scp %REMOTE_ALIAS%:"%%f" "!TARGET!" >nul 2>&1
    if not errorlevel 1 set /a COPY_COUNT+=1
)

echo.
echo [recovery] ✓ Copied %COPY_COUNT% files to _recovery\remote\
echo [recovery] Files saved to: %CD%\_recovery\remote\

REM Show 5 largest files
echo.
echo [recovery] Top 5 largest candidates:
powershell -NoProfile -Command "Get-ChildItem -Path _recovery\remote -Recurse -File | Sort-Object Length -Descending | Select-Object -First 5 | ForEach-Object { Write-Output ('{0,12:N0} bytes - {1}' -f $_.Length, $_.FullName) }"

del _recovery\remote_candidates.txt
goto :eof

REM ============================================================================
REM WRITE MANIFEST
REM ============================================================================
:write_manifest
set SYNC_MODE=pull-remote

:write_manifest_after_sync
echo [sync] Writing manifest to %MANIFEST_FILE%...

REM Get current UTC timestamp
for /f "usebackq" %%t in (`powershell -NoProfile -Command "(Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')"`) do set SYNCED_AT=%%t

REM Write manifest JSON
(
echo {
echo   "local": {
echo     "exists": %L_EXISTS%,
echo     "mtime": %L_MTIME%,
echo     "size": %L_SIZE%,
echo     "sha256": "%L_SHA256%"
echo   },
echo   "remote": {
echo     "exists": %R_EXISTS%,
echo     "mtime": %R_MTIME%,
echo     "size": %R_SIZE%,
echo     "sha256": "%R_SHA256%"
echo   },
echo   "synced_at": "%SYNCED_AT%",
echo   "mode": "%SYNC_MODE%"
echo }
) > "%MANIFEST_FILE%"

echo [sync] ✓ Manifest written
goto :eof

REM ============================================================================
REM LOCAL START
REM ============================================================================
:local_start
REM Sync database before starting (remote-preferred) unless --skip-sync
if %ARG_SKIP_SYNC%==0 (
    call :sync_db_remote_preferred
) else (
    echo.
    echo [SKIP] Database sync skipped (--skip-sync flag)
)

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
REM Sync database before starting remote (remote-preferred) unless --skip-sync
if %ARG_SKIP_SYNC%==0 (
    call :sync_db_remote_preferred
) else (
    echo.
    echo [SKIP] Database sync skipped (--skip-sync flag)
)

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
    ssh %REMOTE_ALIAS% "bash -lc 'pm2 stop %PM2_NAME% 2>/dev/null || true; pm2 save 2>/dev/null || true'" >nul 2>&1
    echo Remote PM2 process stopped ^(if it was running^)
) else (
    echo SSH not found, skipping remote stop
)

echo.
echo [SUCCESS] Stop operation complete
goto :eof

REM ============================================================================
REM INTERACTIVE RECOVERY
REM ============================================================================
:interactive_recovery
echo.
echo === INTERACTIVE DB RECOVERY ===
echo [recovery] Launching interactive recovery tool...
echo.

REM Check if PowerShell script exists
if not exist "scripts\recover-db.ps1" (
    echo [ERROR] Recovery script not found: scripts\recover-db.ps1
    exit /b 1
)

REM Launch PowerShell recovery script
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\recover-db.ps1"
exit /b %ERRORLEVEL%

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
echo   --push-remote        Push local database to remote ^(explicit only^)
echo   --recover            Interactive DB recovery ^(evaluate and restore from any backup^)
echo   --recover-remote-db  Download all remote DB candidates for recovery
echo   --skip-sync          Skip database sync ^(use existing local DB^)
echo.
echo Examples:
echo   start.cmd --local                  # Dev mode with hot reload ^(pulls remote DB^)
echo   start.cmd --local --fresh          # Full rebuild and start
echo   start.cmd --remote                 # Quick restart on server
echo   start.cmd --remote --fresh         # Deploy latest code to server
echo   start.cmd --stop                   # Stop everything
echo   start.cmd --push-remote            # Push local DB to remote ^(after backups^)
echo   start.cmd --recover                # Interactive DB recovery with integrity checks
echo   start.cmd --recover-remote-db      # Recover old databases from remote
echo.
echo Configuration ^(edit at top of script^):
echo   REMOTE_ALIAS=%REMOTE_ALIAS%
echo   REMOTE_PATH=%REMOTE_PATH%
echo   PM2_NAME=%PM2_NAME%
echo.
echo Database Sync:
echo   Default behavior: Pulls remote DB → local ^(never pushes unless --push-remote^)
echo   Backups: data\backups\data-TIMESTAMP.local.db
echo   Manifest: %MANIFEST_FILE%
echo.
exit /b 1
