# ============================================================
#  Interweaver - fetch the latest sources (helper for start.bat)
# ------------------------------------------------------------
#  ASCII only on purpose: Windows PowerShell 5.1 reads .ps1 files
#  with the system code page unless a BOM is present, and mixing
#  encodings between cmd / batch / PowerShell has already caused
#  confusing failures here. All user-facing Chinese lives in
#  start.bat (which is GBK), this helper stays plain ASCII.
#
#  Channels (first success wins):
#    1) git clone --depth 1        (when git exists and no -SourceUrl)
#    2) zip download + tar -xf     (built-in tar; works with -SourceUrl)
#
#  Usage:
#    powershell -NoProfile -ExecutionPolicy Bypass -File tools\fetch-latest.ps1 `
#        -Root . -Mode dry
#    powershell ... -SourceUrl http://127.0.0.1:5199/latest.zip -Mode real
#
#  Safety:
#    * node_modules / run / logs / backup / .git are never touched
#    * replaced content is first copied to backup\<stamp>\
#    * -Mode dry only downloads and reports; nothing is modified
#    * start.bat is skipped while running (saved as start.bat.new)
# ============================================================
[CmdletBinding()]
param(
  [string]$Repo      = 'Xiaodaocs/Interweaver',
  [string]$Branch    = 'main',
  [string]$Root      = '.',
  [ValidateSet('dry', 'real')]
  [string]$Mode      = 'dry',
  [string]$SourceUrl = ''
)

$ErrorActionPreference = 'Continue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$ProgressPreference = 'SilentlyContinue'

function Say([string]$msg) { Write-Host "        $msg" }

$Root    = (Resolve-Path -LiteralPath $Root).Path
$stamp   = Get-Date -Format 'yyyyMMdd-HHmmss'
$tmpZip  = Join-Path $env:TEMP 'interweaver-latest.zip'
$tmpDir  = Join-Path $env:TEMP 'interweaver-latest'

if ($SourceUrl) {
  $zipUrls = @($SourceUrl)
} else {
  $zipUrls = @(
    "https://github.com/$Repo/archive/refs/heads/$Branch.zip",
    "https://codeload.github.com/$Repo/zip/refs/heads/$Branch"
  )
}

# ---------- 1) obtain sources ----------
# Channel order matters (learned the hard way):
#   A failed `git clone` makes GitHub answer the *following* archive/zip requests
#   with 404 for a while (observed repeatedly: zip alone succeeds, git-then-zip
#   both fail). So the zip channel goes FIRST and git is only the fallback.
$src = $null
$how = $null

foreach ($u in $zipUrls) {
  Say "channel 1 (zip): $u"
  $got = $false
  for ($try = 1; $try -le 3; $try++) {
    try {
      if (Test-Path -LiteralPath $tmpZip) { Remove-Item -LiteralPath $tmpZip -Force -ErrorAction SilentlyContinue }
      Invoke-WebRequest -UseBasicParsing -Uri $u -OutFile $tmpZip -TimeoutSec 90
      $got = $true
      break
    } catch {
      Say "  attempt $try failed: $($_.Exception.Message)"
      if ($try -lt 3) { Start-Sleep -Seconds 5 }
    }
  }
  if (-not $got) { continue }
  if (Test-Path -LiteralPath $tmpDir) { Remove-Item -LiteralPath $tmpDir -Recurse -Force -ErrorAction SilentlyContinue }
  New-Item -ItemType Directory -Path $tmpDir -Force | Out-Null
  & tar -xf $tmpZip -C $tmpDir 2>&1 | Out-Null
  $inner = Get-ChildItem -LiteralPath $tmpDir -Directory -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($inner -and (Test-Path -LiteralPath (Join-Path $inner.FullName 'app\server.mjs'))) {
    $src = $inner.FullName; $how = 'zip'
    Say ("channel 1 ok (zip, " + [Math]::Round((Get-Item $tmpZip).Length / 1KB, 1) + " KB)")
    break
  }
  Say "  extracted, but app\server.mjs not found inside"
}

if (-not $src -and -not $SourceUrl) {
  $git = Get-Command git -ErrorAction SilentlyContinue
  if ($git) {
    Say "channel 2 (git): clone $Repo ($Branch) ..."
    if (Test-Path -LiteralPath $tmpDir) { Remove-Item -LiteralPath $tmpDir -Recurse -Force -ErrorAction SilentlyContinue }
    $out = & git clone --depth 1 --branch $Branch "https://github.com/$Repo.git" $tmpDir 2>&1
    if ($LASTEXITCODE -eq 0 -and (Test-Path -LiteralPath (Join-Path $tmpDir 'app\server.mjs'))) {
      $src = $tmpDir; $how = 'git'
      Say "channel 2 ok (git)"
    } else {
      Say "channel 2 failed:"
      $out | Select-Object -First 4 | ForEach-Object { Say ("  git: " + ($_ -as [string])) }
    }
  } else {
    Say "git not found, zip was the only channel"
  }
}

if (-not $src) {
  Say "FAILED: neither git nor zip channel could fetch the sources."
  Say "        Check the network, or download manually from https://github.com/$Repo"
  exit 1
}

# ---------- 2) dry run ----------
if ($Mode -eq 'dry') {
  Say "[dry] sources obtained via '$how'. The following WOULD be replaced (nothing changed now):"
  Say "        app\            (node_modules kept)"
  Say "        docs\"
  Say "        README.md"
  Say "        stop.bat  status.bat"
  Say "        start.bat -> start.bat.new (this script is running)"
  Say "      Re-run without dry to actually update."
  exit 0
}

# ---------- 3) real: back up, then replace ----------
$backup = Join-Path $Root "backup\$stamp"
Say "backup -> $backup"
New-Item -ItemType Directory -Path $backup -Force | Out-Null

$appDir = Join-Path $Root 'app'
if (Test-Path -LiteralPath $appDir) {
  & robocopy $appDir (Join-Path $backup 'app') /E /XD node_modules /NFL /NDL /NJH /NJS | Out-Null
}
if (Test-Path -LiteralPath (Join-Path $Root 'docs')) {
  & robocopy (Join-Path $Root 'docs') (Join-Path $backup 'docs') /E /NFL /NDL /NJH /NJS | Out-Null
}
foreach ($f in @('README.md', 'start.bat', 'stop.bat', 'status.bat')) {
  $p = Join-Path $Root $f
  if (Test-Path -LiteralPath $p) { Copy-Item -LiteralPath $p -Destination (Join-Path $backup $f) -Force }
}

Say "replacing project files ..."
$newApp = Join-Path $src 'app'
if (Test-Path -LiteralPath $newApp) {
  & robocopy $newApp $appDir /MIR /XD node_modules /NFL /NDL /NJH /NJS | Out-Null
}
$newDocs = Join-Path $src 'docs'
if (Test-Path -LiteralPath $newDocs) {
  & robocopy $newDocs (Join-Path $Root 'docs') /MIR /NFL /NDL /NJH /NJS | Out-Null
}
foreach ($f in @('README.md', 'stop.bat', 'status.bat')) {
  $p = Join-Path $src $f
  if (Test-Path -LiteralPath $p) { Copy-Item -LiteralPath $p -Destination (Join-Path $Root $f) -Force }
}

# start.bat is the parent process: never overwrite it while running
$newStart = Join-Path $src 'start.bat'
if (Test-Path -LiteralPath $newStart) {
  $curStart = Join-Path $Root 'start.bat'
  $same = $false
  if (Test-Path -LiteralPath $curStart) {
    $same = ((Get-FileHash -LiteralPath $newStart).Hash -eq (Get-FileHash -LiteralPath $curStart).Hash)
  }
  if (-not $same) {
    Copy-Item -LiteralPath $newStart -Destination (Join-Path $Root 'start.bat.new') -Force
    Say "NOTE: start.bat changed upstream -> written as start.bat.new"
  }
}

Say "OK: project files updated (old ones in backup\$stamp)"
exit 0
