# ============================================================
#  Interweaver - version check + auto update (helper for start.bat)
# ------------------------------------------------------------
#  Called on every launch. Looks for a newer GitHub *Release* and, if
#  one exists, updates the program files. Requirements from the user:
#    * check the version on every start
#    * if a newer release exists -> update
#    * NEVER delete the user's data
#    * if GitHub is unreachable -> just skip (no error, no blocking)
#
#  ASCII only: Windows PowerShell 5.1 reads .ps1 with the system code
#  page unless a BOM is present; mixing encodings between cmd/batch and
#  PowerShell already caused confusing failures here.
#
#  User data that is never touched:
#    app\node_modules\   dependencies (reinstalled by start.bat if needed)
#    app\tests\artifacts\  test screenshots / outputs
#    run\  logs\  backup\  .git\
#  The app's real user data (drafts, settings, achievements) lives in the
#  browser's localStorage and is not a file at all - file updates cannot
#  touch it.
#
#  Usage:
#    powershell -NoProfile -ExecutionPolicy Bypass -File tools\update-check.ps1 -Root .
#    powershell ... -ApiUrl http://127.0.0.1:5199/release.json -ZipUrl http://127.0.0.1:5199/v0.7.0.zip
#    powershell ... -CurrentVersion 0.6.0 -DryRun
# ============================================================
[CmdletBinding()]
param(
  [string]$Repo    = 'Xiaodaocs/Interweaver',
  [string]$Root    = '.',
  [string]$ApiUrl  = '',        # override: any URL returning a release JSON (tests / mirrors)
  [string]$ZipUrl  = '',        # override: release zip to install (tests / mirrors)
  [string]$CurrentVersion = '', # override: pretend the local version is this
  [switch]$DryRun               # download + report, change nothing
)

$ErrorActionPreference = 'Continue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$ProgressPreference = 'SilentlyContinue'

function Say([string]$m) { Write-Host "        $m" }

$Root = (Resolve-Path -LiteralPath $Root).Path

# ---------- 1) local version ----------
$verFile = Join-Path $Root 'VERSION'
$local = ''
if ($CurrentVersion) {
  $local = $CurrentVersion.Trim()
} elseif (Test-Path -LiteralPath $verFile) {
  $local = ((Get-Content -LiteralPath $verFile -Raw) -replace '\s', '')
} else {
  # no VERSION file yet: fall back to app\package.json
  $pkg = Join-Path $Root 'app\package.json'
  if (Test-Path -LiteralPath $pkg) {
    try { $local = (Get-Content -LiteralPath $pkg -Raw | ConvertFrom-Json).version } catch { $local = '0.0.0' }
  }
  if (-not $local) { $local = '0.0.0' }
}
Say "current version: $local"

# ---------- 2) ask GitHub for the latest release ----------
# 404 means "no release published yet" (a normal state), NOT "offline" - the
# two must be reported differently. When there is no release we fall back to
# tags, so a plain `git tag v0.7.0 && git push --tags` is enough to ship an
# update.
$api = if ($ApiUrl) { $ApiUrl } else { "https://api.github.com/repos/$Repo/releases/latest" }
$rel = $null
$noRelease = $false
try {
  $rel = Invoke-RestMethod -UseBasicParsing -Headers @{ 'User-Agent' = 'Interweaver-Launcher' } -Uri $api -TimeoutSec 20
} catch {
  $status = 0
  try { $status = [int]$_.Exception.Response.StatusCode } catch { $status = 0 }
  if ($status -eq 404) {
    $noRelease = $true
  } else {
    # user's rule: if GitHub cannot be reached, just skip
    Say "GitHub unreachable, version check skipped ($($_.Exception.Message))"
    exit 0
  }
}

$tag = ''
if ($rel) { $tag = [string]$rel.tag_name }

if (-not $tag -and -not $ApiUrl) {
  # no release -> try tags
  Say "no Release yet, checking tags ..."
  try {
    $tags = Invoke-RestMethod -UseBasicParsing -Headers @{ 'User-Agent' = 'Interweaver-Launcher' } -Uri "https://api.github.com/repos/$Repo/tags" -TimeoutSec 20
    $tag = [string](@($tags) | Select-Object -First 1).name
  } catch {
    Say "tag query failed, version check skipped"
    exit 0
  }
}
if (-not $tag) {
  Say "no Release / tag published yet, nothing to update"
  exit 0
}
$remote = $tag.TrimStart('v', 'V')

# ---------- 3) compare (numeric, so 0.10.0 > 0.9.0) ----------
function VerParts([string]$v) {
  $out = @()
  foreach ($p in ($v -split '[.\-+]')) { $n = 0; if ([int]::TryParse($p, [ref]$n)) { $out += $n } else { $out += 0 } }
  return $out
}
function IsNewer([string]$a, [string]$b) {
  $pa = VerParts $a; $pb = VerParts $b
  $n = [Math]::Max($pa.Count, $pb.Count)
  for ($i = 0; $i -lt $n; $i++) {
    $x = if ($i -lt $pa.Count) { $pa[$i] } else { 0 }
    $y = if ($i -lt $pb.Count) { $pb[$i] } else { 0 }
    if ($x -gt $y) { return $true }
    if ($x -lt $y) { return $false }
  }
  return $false
}
if (-not (IsNewer $remote $local)) {
  Say "up to date (latest release: $tag)"
  exit 0
}
Say "new version available: $local -> $remote ($tag)"

# ---------- 4) download the release zip ----------
$url = $ZipUrl
if (-not $url) {
  # prefer a *.zip asset, then the release's source zip, then the tag archive
  $asset = $null
  if ($rel -and $rel.assets) { $asset = @($rel.assets) | Where-Object { $_.name -like '*.zip' } | Select-Object -First 1 }
  if ($asset -and $asset.browser_download_url) { $url = $asset.browser_download_url }
  elseif ($rel -and $rel.zipball_url) { $url = $rel.zipball_url }
  else { $url = "https://github.com/$Repo/archive/refs/tags/$tag.zip" }
}
if (-not $url) { Say "release has no downloadable zip, skipped"; exit 0 }

$tmpZip = Join-Path $env:TEMP 'interweaver-update.zip'
$tmpDir = Join-Path $env:TEMP 'interweaver-update'
Say "downloading $url"
$ok = $false
for ($try = 1; $try -le 3; $try++) {
  try {
    if (Test-Path -LiteralPath $tmpZip) { Remove-Item -LiteralPath $tmpZip -Force -ErrorAction SilentlyContinue }
    Invoke-WebRequest -UseBasicParsing -Headers @{ 'User-Agent' = 'Interweaver-Launcher' } -Uri $url -OutFile $tmpZip -TimeoutSec 120
    $ok = $true; break
  } catch {
    Say "  attempt $try failed: $($_.Exception.Message)"
    if ($try -lt 3) { Start-Sleep -Seconds 5 }
  }
}
if (-not $ok) { Say "download failed, update skipped (program keeps working)"; exit 0 }

if (Test-Path -LiteralPath $tmpDir) { Remove-Item -LiteralPath $tmpDir -Recurse -Force -ErrorAction SilentlyContinue }
New-Item -ItemType Directory -Path $tmpDir -Force | Out-Null
& tar -xf $tmpZip -C $tmpDir 2>&1 | Out-Null
$src = Get-ChildItem -LiteralPath $tmpDir -Directory -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $src) { Say "extract failed, update skipped"; exit 0 }
$src = $src.FullName
if (-not (Test-Path -LiteralPath (Join-Path $src 'app\server.mjs'))) { Say "package does not look like Interweaver, update skipped"; exit 0 }
Say "package ok: $([Math]::Round((Get-Item $tmpZip).Length / 1KB, 1)) KB"

if ($DryRun) {
  Say "[dry] would update $local -> $remote (nothing changed)"
  exit 0
}

# ---------- 5) back up what we are about to replace ----------
$stamp  = Get-Date -Format 'yyyyMMdd-HHmmss'
$backup = Join-Path $Root "backup\$stamp"
New-Item -ItemType Directory -Path $backup -Force | Out-Null
Say "backup -> $backup"
foreach ($d in @('app\src', 'app\tests', 'docs')) {
  $p = Join-Path $Root $d
  if (Test-Path -LiteralPath $p) {
    & robocopy $p (Join-Path $backup $d) /E /XD artifacts /NFL /NDL /NJH /NJS | Out-Null
  }
}
foreach ($f in @('VERSION', 'README.md', 'start.bat', 'stop.bat', 'status.bat',
                 'app\index.html', 'app\settings.html', 'app\starmap.html', 'app\styles.css',
                 'app\server.mjs', 'app\package.json', 'app\.puppeteerrc.cjs')) {
  $p = Join-Path $Root $f
  if (Test-Path -LiteralPath $p) {
    $dest = Join-Path $backup $f
    New-Item -ItemType Directory -Path (Split-Path -Parent $dest) -Force | Out-Null
    Copy-Item -LiteralPath $p -Destination $dest -Force
  }
}

# ---------- 6) apply the update ----------
# Program code is mirrored (so a release is applied consistently), but the
# user's data directories are excluded everywhere and never deleted.
Say "applying update ..."
$exclDirs = @('node_modules', 'artifacts', 'run', 'logs', 'backup', '.git')

$srcApp = Join-Path $src 'app'
$dstApp = Join-Path $Root 'app'
if (Test-Path -LiteralPath $srcApp) {
  # app\src : pure program code -> mirror
  if (Test-Path -LiteralPath (Join-Path $srcApp 'src')) {
    & robocopy (Join-Path $srcApp 'src') (Join-Path $dstApp 'src') /MIR /XD @exclDirs /NFL /NDL /NJH /NJS | Out-Null
  }
  # app\tests : program code, but keep artifacts (test outputs are user data)
  if (Test-Path -LiteralPath (Join-Path $srcApp 'tests')) {
    & robocopy (Join-Path $srcApp 'tests') (Join-Path $dstApp 'tests') /MIR /XD artifacts /NFL /NDL /NJH /NJS | Out-Null
  }
  # loose app files: copy over, never delete anything
  & robocopy $srcApp $dstApp /E /XD @exclDirs /NFL /NDL /NJH /NJS | Out-Null
}
$srcDocs = Join-Path $src 'docs'
if (Test-Path -LiteralPath $srcDocs) {
  & robocopy $srcDocs (Join-Path $Root 'docs') /MIR /NFL /NDL /NJH /NJS | Out-Null
}
foreach ($f in @('README.md', 'stop.bat', 'status.bat', 'VERSION')) {
  $p = Join-Path $src $f
  if (Test-Path -LiteralPath $p) { Copy-Item -LiteralPath $p -Destination (Join-Path $Root $f) -Force }
}
# start.bat is the parent process while running -> never overwrite it
$newStart = Join-Path $src 'start.bat'
if (Test-Path -LiteralPath $newStart) {
  $cur = Join-Path $Root 'start.bat'
  $same = $false
  if (Test-Path -LiteralPath $cur) { $same = ((Get-FileHash -LiteralPath $newStart).Hash -eq (Get-FileHash -LiteralPath $cur).Hash) }
  if (-not $same) {
    Copy-Item -LiteralPath $newStart -Destination (Join-Path $Root 'start.bat.new') -Force
    Say "NOTE: start.bat changed -> written as start.bat.new (restart with it when convenient)"
  }
}

# make sure VERSION reflects what we installed
Set-Content -LiteralPath $verFile -Value $remote -Encoding ASCII

Say "OK: updated to $remote (old files in backup\$stamp; user data untouched)"
Say "    if the app was already running, restart it: stop.bat then start.bat"
exit 0
