#Requires -Version 5.1
<#
.SYNOPSIS
    Focused, interactive database recovery for Pawtropolis Tech
.DESCRIPTION
    Discovers ONLY SQLite database files under data/ (local and remote),
    evaluates integrity and row counts, allows interactive restore with backups.
    Never scans non-DB files (no .pm2, node_modules, website, etc.).
.EXAMPLE
    .\scripts\recover-db.ps1
#>

$ErrorActionPreference = 'Stop'

# ============================================================================
# Configuration
# ============================================================================
$REMOTE_HOST = if ($Env:REMOTE_HOST) { $Env:REMOTE_HOST } else { 'pawtech' }
$REMOTE_PATH = if ($Env:REMOTE_PATH) { $Env:REMOTE_PATH } else { '~/pawtropolis-tech' }
$REMOTE_DATA = "$REMOTE_PATH/data"

$LOCAL_DB = 'data\data.db'
$LOCAL_DIR = 'data'
$LOCAL_BACKUPS = 'data\backups'
$RECOVERY_ROOT = '_recovery\remote'
$MANIFEST_FILE = 'data\.db-manifest.json'

Write-Host ''
Write-Host '================================================================' -ForegroundColor Cyan
Write-Host '  PAWTROPOLIS TECH - DATABASE RECOVERY' -ForegroundColor Cyan
Write-Host '================================================================' -ForegroundColor Cyan
Write-Host ''

# ============================================================================
# Helper Functions
# ============================================================================

function Get-Timestamp {
    return Get-Date -Format 'yyyyMMdd-HHmmss'
}

function Get-Hash256 {
    param([string]$Path)

    if (-not (Test-Path $Path)) {
        return 'MISSING'
    }

    try {
        $hash = (Get-FileHash -Path $Path -Algorithm SHA256).Hash
        return $hash
    } catch {
        return 'ERROR'
    }
}

function Get-DbInfo {
    param([string]$Path)

    $info = @{
        integrity = 'unknown'
        counts = @{
            review_action = '?'
            application = '?'
            avatar_scan = '?'
            bot_status = '?'
        }
    }

    if (-not (Test-Path $Path)) {
        $info.integrity = 'not found'
        return $info
    }

    # Try Node helper first
    try {
        $jsonOutput = node 'scripts\check-db.js' $Path 2>&1 | Out-String
        $data = $jsonOutput | ConvertFrom-Json
        $info.integrity = $data.integrity
        $info.counts = $data.counts
        return $info
    } catch {
        Write-Host "[WARN] Node check failed for $Path" -ForegroundColor Yellow
    }

    # Try sqlite3 CLI as fallback
    $sqlite3 = Get-Command sqlite3 -ErrorAction SilentlyContinue
    if ($sqlite3) {
        try {
            $integrityResult = & sqlite3 $Path 'PRAGMA integrity_check;' 2>&1
            if ($integrityResult -eq 'ok') {
                $info.integrity = 'ok'
            } else {
                $info.integrity = 'fail'
            }

            # Get counts
            $tables = @('review_action', 'application', 'avatar_scan', 'bot_status')
            foreach ($table in $tables) {
                try {
                    $query = 'SELECT COUNT(*) FROM ' + $table + ';'
                    $count = & sqlite3 $Path $query 2>&1
                    if ($count -match '^\d+$') {
                        $info.counts[$table] = [int]$count
                    } else {
                        $info.counts[$table] = 'missing'
                    }
                } catch {
                    $info.counts[$table] = 'missing'
                }
            }
        } catch {
            $info.integrity = 'error'
        }
    }

    return $info
}

function Checkpoint-Sqlite {
    param([string]$Path)

    if (-not (Test-Path $Path)) {
        return
    }

    $sqlite3 = Get-Command sqlite3 -ErrorAction SilentlyContinue
    if ($sqlite3) {
        try {
            & sqlite3 $Path 'PRAGMA wal_checkpoint(TRUNCATE);' 2>&1 | Out-Null
            Write-Host "[checkpoint] WAL checkpointed for: $Path" -ForegroundColor Gray
        } catch {
            Write-Host "[WARN] Could not checkpoint WAL" -ForegroundColor Yellow
        }
    }
}

function Copy-Safe {
    param(
        [string]$Source,
        [string]$Destination
    )

    $destDir = Split-Path -Parent $Destination
    if ($destDir -and -not (Test-Path $destDir)) {
        New-Item -ItemType Directory -Path $destDir -Force | Out-Null
    }

    Copy-Item -Path $Source -Destination $Destination -Force
}

function Get-BaseKey {
    param([string]$Path)

    # If path ends with -wal or -shm, return the base path
    if ($Path -match '^(.+)\-(wal|shm)$') {
        return $matches[1]
    }
    return $Path
}

function Get-WalShmIndicator {
    param(
        [string]$BasePath,
        [hashtable]$AuxByBase
    )

    $key = Get-BaseKey $BasePath
    if ($AuxByBase.ContainsKey($key)) {
        $aux = $AuxByBase[$key]
        $hasWal = $aux | Where-Object { $_ -match '\-wal$' }
        $hasShm = $aux | Where-Object { $_ -match '\-shm$' }

        if ($hasWal -and $hasShm) { return '(+wal,+shm)' }
        if ($hasWal) { return '(+wal)' }
        if ($hasShm) { return '(+shm)' }
    }
    return ''
}

# ============================================================================
# Discovery - Remote DB Candidates (FOCUSED: data/ only)
# ============================================================================

Write-Host '[discovery] Scanning for database candidates...' -ForegroundColor Cyan
Write-Host ''

$candidates = @()
$id = 1

Write-Host '[remote] Scanning remote databases...' -ForegroundColor Gray

try {
    # Ensure recovery dir exists
    if (-not (Test-Path $RECOVERY_ROOT)) {
        New-Item -ItemType Directory -Path $RECOVERY_ROOT -Force | Out-Null
    }

    # Improved remote find: scan entire repo but prune unwanted directories
    $findCmd = @'
sh -lc 'set -e; base=~/pawtropolis-tech; find "$base" \( -path "$base/node_modules" -o -path "$base/.pm2" -o -path "$base/website" \) -prune -o -type f \( -name "*.db" -o -name "*.sqlite" -o -name "*.sqlite3" -o -name "*.db.backup-*" -o -name "*.remote.db" -o -name "*.local-before-restore.db" -o -name "*.bak" -o -name "*.bak.*" -o -name "*-wal" -o -name "*-shm" \) -print 2>/dev/null | sort'
'@

    $remoteFiles = & ssh $REMOTE_HOST $findCmd 2>$null

    if ($remoteFiles) {
        $remoteFiles -split "`n" | Where-Object { $_ -match '\S' } | ForEach-Object {
            $remotePath = $_.Trim()

            # Create local mirror path
            $localMirror = $remotePath -replace "^$REMOTE_PATH/", ''
            $localMirror = $localMirror -replace '^~/', 'home/'
            $localMirror = Join-Path $RECOVERY_ROOT $localMirror
            $localMirror = $localMirror -replace '/', '\'

            # Check if already cached
            if (Test-Path $localMirror) {
                # Already cached, just add to candidates
                $candidates += @{
                    Id = $id++
                    Location = 'remote-cache'
                    Path = (Resolve-Path $localMirror).Path
                    IsLocal = $true
                    OriginalRemotePath = $remotePath
                }
            } else {
                # Download to cache
                Write-Host "[remote] Caching: $remotePath" -ForegroundColor Gray

                $localMirrorDir = Split-Path -Parent $localMirror
                if (-not (Test-Path $localMirrorDir)) {
                    New-Item -ItemType Directory -Path $localMirrorDir -Force | Out-Null
                }

                # Check for existing file with suffix (dedupe)
                $basePath = $localMirror
                $suffix = 0
                while (Test-Path $localMirror) {
                    $suffix++
                    $localMirror = "$basePath.$suffix"
                }

                try {
                    & scp "${REMOTE_HOST}:$remotePath" $localMirror 2>$null

                    if (Test-Path $localMirror) {
                        $candidates += @{
                            Id = $id++
                            Location = 'remote-cache'
                            Path = (Resolve-Path $localMirror).Path
                            IsLocal = $true
                            OriginalRemotePath = $remotePath
                        }
                    }
                } catch {
                    Write-Host "[WARN] Failed to download: $remotePath" -ForegroundColor Yellow
                }
            }
        }
    }

    $remoteCandidateCount = ($candidates | Where-Object { $_.Location -eq 'remote-cache' }).Count
    Write-Host "[remote] Found $remoteCandidateCount remote candidates" -ForegroundColor Gray
} catch {
    Write-Host "[WARN] Remote discovery failed" -ForegroundColor Yellow
}

# ============================================================================
# Discovery - Local DB Candidates (IMPROVED: multiple roots, better patterns)
# ============================================================================

Write-Host '[local] Scanning local databases...' -ForegroundColor Gray

# Define search roots (only existing directories)
$localRoots = @(
    '.\data',
    '.\data\backups',
    '.\_recovery\remote',
    '.\_recovery\local',
    '.\backups'
) | Where-Object { Test-Path $_ }

# Define patterns for primary DBs and auxiliary files
$primaryPatterns = @(
    '*.db', '*.sqlite', '*.sqlite3',
    '*.db.backup-*', '*.remote.db',
    '*.local-before-restore.db', '*.bak', '*.bak.*'
)
$auxPatterns = @('*-wal', '*-shm')

# Collect all primary DB files
$localPrimaries = @()
foreach ($root in $localRoots) {
    try {
        $files = Get-ChildItem $root -File -Recurse -Include $primaryPatterns -ErrorAction SilentlyContinue
        $localPrimaries += $files
    } catch {
        Write-Host "[WARN] Could not scan $root" -ForegroundColor Yellow
    }
}

# Collect all auxiliary files (WAL/SHM)
$localAux = @()
foreach ($root in $localRoots) {
    try {
        $files = Get-ChildItem $root -File -Recurse -Include $auxPatterns -ErrorAction SilentlyContinue
        $localAux += $files
    } catch {
        Write-Host "[WARN] Could not scan $root for WAL/SHM" -ForegroundColor Yellow
    }
}

# Build map of auxiliary files by base key
$auxByBase = @{}
foreach ($aux in $localAux) {
    $key = Get-BaseKey $aux.FullName
    if (-not $auxByBase.ContainsKey($key)) {
        $auxByBase[$key] = @()
    }
    $auxByBase[$key] += $aux.FullName
}

# Add primary DBs to candidates
foreach ($file in $localPrimaries) {
    # Determine location based on path
    $location = 'local'
    if ($file.FullName -match 'backups') {
        $location = 'local-backup'
    } elseif ($file.FullName -match '_recovery\\remote') {
        $location = 'remote-cache'
    } elseif ($file.FullName -match '_recovery\\local') {
        $location = 'local-recovery'
    }

    $candidates += @{
        Id = $id++
        Location = $location
        Path = $file.FullName
        IsLocal = $true
    }
}

$localCandidateCount = ($candidates | Where-Object { $_.Location -ne 'remote-cache' }).Count
Write-Host "[local] Found $localCandidateCount local candidates" -ForegroundColor Gray

Write-Host ''
Write-Host "[discovery] Total candidates: $($candidates.Count)" -ForegroundColor Green
Write-Host ''

if ($candidates.Count -eq 0) {
    Write-Host '[ERROR] No database candidates found!' -ForegroundColor Red
    exit 1
}

# ============================================================================
# Evaluate Candidates
# ============================================================================

Write-Host '[evaluate] Analyzing database candidates...' -ForegroundColor Cyan
Write-Host ''

$evaluatedCandidates = @()

foreach ($candidate in $candidates) {
    Write-Host "[evaluate] Checking ID $($candidate.Id): $($candidate.Path)" -ForegroundColor Gray

    $fileInfo = Get-Item $candidate.Path
    $fileName = $fileInfo.Name
    $sha256 = Get-Hash256 -Path $candidate.Path

    # Check if this is a WAL/SHM auxiliary file
    $isAuxiliary = $fileName -match '\-(wal|shm)$'

    if ($isAuxiliary) {
        # Don't integrity-check auxiliary files
        $integrity = 'aux'
        $counts = @{
            review_action = '—'
            application = '—'
            avatar_scan = '—'
            bot_status = '—'
        }
    } else {
        # Run integrity check for primary DB files
        $dbInfo = Get-DbInfo -Path $candidate.Path
        $integrity = $dbInfo.integrity
        $counts = $dbInfo.counts
    }

    # Get WAL/SHM indicator for this file
    $walShmIndicator = Get-WalShmIndicator -BasePath $candidate.Path -AuxByBase $auxByBase

    # Check filename for hints
    $notes = ''
    if ($candidate.Path -match 'backup|bak') {
        $notes = 'backup'
    }
    if ($candidate.Path -match '\d{8}') {
        $notes = if ($notes) { "$notes, timestamped" } else { 'timestamped' }
    }

    $evaluatedCandidates += [PSCustomObject]@{
        Id = $candidate.Id
        Location = $candidate.Location
        Path = $candidate.Path
        SizeMB = [math]::Round($fileInfo.Length / 1MB, 2)
        MTime = $fileInfo.LastWriteTime
        SHA256 = $sha256.Substring(0, 16) + '...'
        Integrity = $integrity
        WalShm = $walShmIndicator
        review_action = $counts.review_action
        application = $counts.application
        avatar_scan = $counts.avatar_scan
        bot_status = $counts.bot_status
        Notes = $notes
        FullPath = $candidate.Path
        FullSHA256 = $sha256
        OriginalRemotePath = $candidate.OriginalRemotePath
    }
}

# Sort by MTime desc, then Size desc
$evaluatedCandidates = $evaluatedCandidates | Sort-Object @{Expression={$_.MTime}; Descending=$true}, @{Expression={$_.SizeMB}; Descending=$true}

# ============================================================================
# Display Table
# ============================================================================

Write-Host ''
Write-Host '================================================================' -ForegroundColor Green
Write-Host '  DATABASE CANDIDATES' -ForegroundColor Green
Write-Host '================================================================' -ForegroundColor Green
Write-Host ''

$evaluatedCandidates | Format-Table -Property `
    @{Label='ID'; Expression={$_.Id}; Width=4},
    @{Label='Location'; Expression={$_.Location}; Width=15},
    @{Label='Size(MB)'; Expression={$_.SizeMB}; Width=9},
    @{Label='MTime (local TZ)'; Expression={$_.MTime.ToString('yyyy-MM-dd HH:mm:ss')}; Width=20},
    @{Label='Integrity'; Expression={ if ($_.WalShm) { "$($_.Integrity) $($_.WalShm)" } else { $_.Integrity } }; Width=18},
    @{Label='review'; Expression={$_.review_action}; Width=7},
    @{Label='app'; Expression={$_.application}; Width=5},
    @{Label='avatar'; Expression={$_.avatar_scan}; Width=7},
    @{Label='bot'; Expression={$_.bot_status}; Width=5},
    @{Label='Notes'; Expression={$_.Notes}; Width=18} `
    -AutoSize

# ============================================================================
# Interactive Selection
# ============================================================================

Write-Host ''
Write-Host '================================================================' -ForegroundColor Cyan

while ($true) {
    Write-Host ''
    $selection = Read-Host 'Select ID to restore to LOCAL (backup first). Enter to cancel'

    if ([string]::IsNullOrWhiteSpace($selection)) {
        Write-Host ''
        Write-Host '[exit] Recovery cancelled by user' -ForegroundColor Yellow
        exit 0
    }

    if ($selection -notmatch '^\d+$') {
        Write-Host '[ERROR] Invalid input. Enter a number or press Enter' -ForegroundColor Red
        continue
    }

    $selectedId = [int]$selection
    $chosen = $evaluatedCandidates | Where-Object { $_.Id -eq $selectedId }

    if (-not $chosen) {
        Write-Host '[ERROR] Invalid ID. Choose from the table above.' -ForegroundColor Red
        continue
    }

    # Don't allow selecting auxiliary files
    if ($chosen.Integrity -eq 'aux') {
        Write-Host ''
        Write-Host '[ERROR] Cannot restore a WAL/SHM file directly.' -ForegroundColor Red
        Write-Host '[INFO] WAL/SHM files are automatically included with their base DB.' -ForegroundColor Yellow
        continue
    }

    # Check integrity
    if ($chosen.Integrity -ne 'ok') {
        Write-Host ''
        Write-Host "[WARN] Database has integrity issues: $($chosen.Integrity)" -ForegroundColor Yellow
        Write-Host '[WARN] This database may be corrupted!' -ForegroundColor Yellow
        $forceChoice = Read-Host "Continue anyway? Type 'force' to proceed"

        if ($forceChoice -ne 'force') {
            Write-Host '[cancelled] Selection cancelled' -ForegroundColor Yellow
            continue
        }
    }

    # Display selected candidate details
    Write-Host ''
    Write-Host '================================================================' -ForegroundColor Magenta
    Write-Host '  SELECTED CANDIDATE' -ForegroundColor Magenta
    Write-Host '================================================================' -ForegroundColor Magenta
    Write-Host ''
    Write-Host "  ID:           $($chosen.Id)" -ForegroundColor White
    Write-Host "  Location:     $($chosen.Location)" -ForegroundColor White
    Write-Host "  Path:         $($chosen.Path)" -ForegroundColor White
    Write-Host "  Size:         $($chosen.SizeMB) MB" -ForegroundColor White
    Write-Host "  Modified:     $($chosen.MTime)" -ForegroundColor White
    Write-Host "  SHA256:       $($chosen.FullSHA256)" -ForegroundColor White
    Write-Host "  Integrity:    $($chosen.Integrity)" -ForegroundColor White
    Write-Host '  Row Counts:' -ForegroundColor White
    Write-Host "    - review_action: $($chosen.review_action)" -ForegroundColor Gray
    Write-Host "    - application:   $($chosen.application)" -ForegroundColor Gray
    Write-Host "    - avatar_scan:   $($chosen.avatar_scan)" -ForegroundColor Gray
    Write-Host "    - bot_status:    $($chosen.bot_status)" -ForegroundColor Gray
    Write-Host ''

    $confirm = Read-Host 'Backup current local DB and replace with this? [y/N]'

    if ($confirm -ne 'y' -and $confirm -ne 'Y') {
        Write-Host '[cancelled] Restore cancelled' -ForegroundColor Yellow
        continue
    }

    break
}

# ============================================================================
# Local Heal
# ============================================================================

Write-Host ''
Write-Host '================================================================' -ForegroundColor Green
Write-Host '  RESTORING LOCAL DATABASE' -ForegroundColor Green
Write-Host '================================================================' -ForegroundColor Green
Write-Host ''

if (-not (Test-Path $LOCAL_BACKUPS)) {
    New-Item -ItemType Directory -Path $LOCAL_BACKUPS -Force | Out-Null
}

$timestamp = Get-Timestamp
$localBackupPath = Join-Path $LOCAL_BACKUPS "data-$timestamp.local-before-restore.db"

if (Test-Path $LOCAL_DB) {
    Write-Host '[backup] Backing up current local DB...' -ForegroundColor Cyan
    Copy-Safe -Source $LOCAL_DB -Destination $localBackupPath
    Write-Host "[backup] Saved to: $localBackupPath" -ForegroundColor Green

    $localWal = "$LOCAL_DB-wal"
    $localShm = "$LOCAL_DB-shm"

    if (Test-Path $localWal) {
        Copy-Safe -Source $localWal -Destination "$localBackupPath-wal"
        Write-Host "[backup] Saved WAL" -ForegroundColor Green
    }

    if (Test-Path $localShm) {
        Copy-Safe -Source $localShm -Destination "$localBackupPath-shm"
        Write-Host "[backup] Saved SHM" -ForegroundColor Green
    }
} else {
    Write-Host '[backup] No existing local DB to backup' -ForegroundColor Gray
}

# Checkpoint selected DB if it has WAL
$chosenWal = "$($chosen.FullPath)-wal"
if (Test-Path $chosenWal) {
    Write-Host '[checkpoint] Checkpointing selected database WAL...' -ForegroundColor Cyan
    Checkpoint-Sqlite -Path $chosen.FullPath
}

Write-Host "[restore] Copying selected database to $LOCAL_DB..." -ForegroundColor Cyan

$dataDir = Split-Path -Parent $LOCAL_DB
if (-not (Test-Path $dataDir)) {
    New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
}

Copy-Safe -Source $chosen.FullPath -Destination $LOCAL_DB

if (Test-Path $chosenWal) {
    Copy-Safe -Source $chosenWal -Destination "$LOCAL_DB-wal"
    Write-Host '[restore] Copied WAL file' -ForegroundColor Green
}

$chosenShm = "$($chosen.FullPath)-shm"
if (Test-Path $chosenShm) {
    Copy-Safe -Source $chosenShm -Destination "$LOCAL_DB-shm"
    Write-Host '[restore] Copied SHM file' -ForegroundColor Green
}

Write-Host ''
Write-Host '[restore] Local database restored successfully!' -ForegroundColor Green
Write-Host ''
Write-Host "  Path:     $LOCAL_DB" -ForegroundColor White
Write-Host "  SHA256:   $($chosen.FullSHA256)" -ForegroundColor White
Write-Host "  Size:     $($chosen.SizeMB) MB" -ForegroundColor White
Write-Host "  Modified: $($chosen.MTime)" -ForegroundColor White
Write-Host ''

$localAfter = @{
    sha256 = Get-Hash256 -Path $LOCAL_DB
    size = (Get-Item $LOCAL_DB).Length
    mtime = [int][double](Get-Date (Get-Item $LOCAL_DB).LastWriteTimeUtc -UFormat '%s')
}

# ============================================================================
# Optional Remote Heal
# ============================================================================

Write-Host '================================================================' -ForegroundColor Cyan
Write-Host ''
$remoteChoice = Read-Host 'Also update REMOTE? (backs up remote first) [y/N]'

$remoteAfter = $null

if ($remoteChoice -eq 'y' -or $remoteChoice -eq 'Y') {
    Write-Host ''
    Write-Host '================================================================' -ForegroundColor Yellow
    Write-Host '  UPDATING REMOTE DATABASE' -ForegroundColor Yellow
    Write-Host '================================================================' -ForegroundColor Yellow
    Write-Host ''

    try {
        Write-Host '[remote] Ensuring remote backup directory...' -ForegroundColor Cyan
        & ssh $REMOTE_HOST "bash -c 'mkdir -p $REMOTE_DATA/backups'" 2>$null

        $remoteExists = & ssh $REMOTE_HOST "bash -c 'if [ -f $REMOTE_DATA/data.db ]; then echo 1; else echo 0; fi'" 2>$null

        if ($remoteExists -eq '1') {
            $remoteTimestamp = & ssh $REMOTE_HOST 'date +%Y%m%d-%H%M%S' 2>$null
            $remoteBackupPath = "$REMOTE_DATA/backups/data-$remoteTimestamp.remote-before-restore.db"

            Write-Host '[backup] Backing up remote DB...' -ForegroundColor Cyan
            & ssh $REMOTE_HOST "cp $REMOTE_DATA/data.db $remoteBackupPath" 2>$null
            Write-Host "[backup] Remote backed up to: $remoteBackupPath" -ForegroundColor Green

            & ssh $REMOTE_HOST "bash -c 'if [ -f $REMOTE_DATA/data.db-wal ]; then cp $REMOTE_DATA/data.db-wal $remoteBackupPath-wal; fi'" 2>$null
            & ssh $REMOTE_HOST "bash -c 'if [ -f $REMOTE_DATA/data.db-shm ]; then cp $REMOTE_DATA/data.db-shm $remoteBackupPath-shm; fi'" 2>$null
        } else {
            Write-Host '[backup] No existing remote DB to backup' -ForegroundColor Gray
        }

        Write-Host '[upload] Uploading healed database to remote...' -ForegroundColor Cyan
        & scp $LOCAL_DB "${REMOTE_HOST}:$REMOTE_DATA/data.db" 2>$null

        if (Test-Path "$LOCAL_DB-wal") {
            & scp "$LOCAL_DB-wal" "${REMOTE_HOST}:$REMOTE_DATA/data.db-wal" 2>$null
            Write-Host '[upload] Uploaded WAL file' -ForegroundColor Green
        }

        if (Test-Path "$LOCAL_DB-shm") {
            & scp "$LOCAL_DB-shm" "${REMOTE_HOST}:$REMOTE_DATA/data.db-shm" 2>$null
            Write-Host '[upload] Uploaded SHM file' -ForegroundColor Green
        }

        Write-Host ''
        Write-Host '[remote] Remote database updated successfully!' -ForegroundColor Green

        $remoteDbPath = "$REMOTE_DATA/data.db"
        $bashCmd = "stat -c '%Y %s' $remoteDbPath && sha256sum $remoteDbPath | cut -d' ' -f1"
        $remoteStats = & ssh $REMOTE_HOST "bash -c `"$bashCmd`"" 2>$null

        if ($remoteStats) {
            $parts = $remoteStats -split '\s+'
            $remoteAfter = @{
                sha256 = $parts[2]
                size = [int]$parts[1]
                mtime = [int]$parts[0]
            }
        }
    } catch {
        Write-Host '[ERROR] Failed to update remote' -ForegroundColor Red
    }
}

# ============================================================================
# Update Manifest
# ============================================================================

Write-Host ''
Write-Host '[manifest] Updating recovery manifest...' -ForegroundColor Cyan

$manifest = @{
    last_recovery = @{
        chosen_path = $chosen.FullPath
        chosen_sha256 = $chosen.FullSHA256
        chosen_size = $chosen.SizeMB * 1MB
        chosen_mtime = [int][double](Get-Date $chosen.MTime -UFormat '%s')
        recovered_at = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    }
    local_after = $localAfter
}

if ($remoteAfter) {
    $manifest.remote_after = $remoteAfter
}

if (Test-Path $MANIFEST_FILE) {
    try {
        $existingManifest = Get-Content $MANIFEST_FILE -Raw | ConvertFrom-Json
        if ($existingManifest.local) { $manifest.local = $existingManifest.local }
        if ($existingManifest.remote) { $manifest.remote = $existingManifest.remote }
        if ($existingManifest.synced_at) { $manifest.synced_at = $existingManifest.synced_at }
        if ($existingManifest.mode) { $manifest.mode = $existingManifest.mode }
    } catch {
        Write-Host '[WARN] Could not read existing manifest' -ForegroundColor Yellow
    }
}

try {
    $manifest | ConvertTo-Json -Depth 10 | Set-Content -Path $MANIFEST_FILE -Encoding UTF8
    Write-Host "[manifest] Manifest updated: $MANIFEST_FILE" -ForegroundColor Green
} catch {
    Write-Host '[ERROR] Failed to write manifest' -ForegroundColor Red
}

# ============================================================================
# Success Summary
# ============================================================================

Write-Host ''
Write-Host '================================================================' -ForegroundColor Green
Write-Host '  RECOVERY COMPLETE' -ForegroundColor Green
Write-Host '================================================================' -ForegroundColor Green
Write-Host ''
Write-Host 'Summary:' -ForegroundColor White
Write-Host "  [OK] Local database restored from: $($chosen.Path)" -ForegroundColor Green
Write-Host "  [OK] Local backup saved to: $localBackupPath" -ForegroundColor Green

if ($remoteAfter) {
    Write-Host '  [OK] Remote database updated' -ForegroundColor Green
}

Write-Host ''
Write-Host 'No backups were deleted. All operations were copy-based.' -ForegroundColor Cyan
Write-Host ''

exit 0
