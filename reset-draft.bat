@echo off
REM ============================================================================
REM  reset-draft.bat  --  a copy of start.bat whose ONLY behavioural change is
REM  the page opened at the end: index.html?reset=1. The app then runs
REM  newScene() on boot, which clears the local draft AND the server draft, so
REM  the canvas really is blank (clearing localStorage alone is not enough).
REM
REM  Why this copy is ASCII while start.bat uses Chinese: a .bat saved as UTF-8
REM  with Chinese text makes cmd cut a line in the middle and report
REM  "is not recognized as an internal or external command". Pure ASCII parses
REM  the same on every code page. Service list, ports, flags and helpers are
REM  the same as start.bat.
REM
REM  Flags (same as start.bat):
REM    noupdate  skip the version check on startup
REM    nofetch   never download
REM    noopen    do not open the browser
REM    nopause   do not wait for a key press
REM ============================================================================
setlocal EnableDelayedExpansion
title Interweaver - Reset draft and start blank canvas
set "ROOT=%~dp0"
set "ROOT_NB=%ROOT:~0,-1%"
set "REPO=Xiaodaocs/Interweaver"
set "APP_DIR=%ROOT%app"
set "RUN_DIR=%ROOT%run"
set "LOG_DIR=%ROOT%logs"
set "WEB_PORT=5188"
set "API_PORT=5189"

REM ---- parse command line flags ----
set "NOOPEN="
set "NOPAUSE="
set "NOFETCH="
set "NOUPDATE="
for %%A in (%*) do (
  if /i "%%A"=="noopen"  set "NOOPEN=1"
  if /i "%%A"=="nopause" set "NOPAUSE=1"
  if /i "%%A"=="nofetch" set "NOFETCH=1"
  if /i "%%A"=="noupdate" set "NOUPDATE=1"
)

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   [ERROR] Node.js not found. Install it from https://nodejs.org then run again.
  echo.
  if not defined NOPAUSE pause
  exit /b 1
)

if not exist "%RUN_DIR%" mkdir "%RUN_DIR%" >nul 2>nul
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%" >nul 2>nul

echo.
echo   Interweaver  ^|  reset draft and start a blank canvas
echo   ==============================================================
echo.

REM ---- version check: same as start.bat, skippable with noupdate ----
if defined NOUPDATE (
  echo   [version] noupdate given, skipped
) else if not exist "%ROOT%tools\update-check.ps1" (
  echo   [version] tools\update-check.ps1 missing, skipped
) else (
  echo   [version] checking GitHub Release ...
  powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%tools\update-check.ps1" -Repo "%REPO%" -Root "%ROOT_NB%"
  if errorlevel 1 echo   [version] check/update did not finish (startup continues)
)
echo.

REM ---- start BOTH services exactly like start.bat ----
call :up web "server.mjs"     %WEB_PORT% "front-end static host"
call :up api "server-api.mjs" %API_PORT% "back-end API"

echo.
echo   ==============================================================
echo   summary:
call :report web "front-end static host"
call :report api "back-end API"
echo.

if not defined NOOPEN (
  echo   opening the reset page ... the browser turns into a blank canvas
  REM ===== THE ONLY BEHAVIOURAL DIFFERENCE FROM start.bat =====
  start "" "http://localhost:%WEB_PORT%/index.html?reset=1"
  echo.
  echo   IMPORTANT: if an OLD frozen tab is still open, CLOSE it.
  echo              Do NOT refresh it: refresh would restore the frozen draft.
  echo.
)

echo   stop services: stop.bat     status: status.bat
echo   logs: %LOG_DIR%
echo.
if not defined NOPAUSE (
  echo   Press any key to close this window (services keep running in the background)...
  pause >nul
)
endlocal
exit /b 0


REM ============================================================================
REM  helper: start one service (same contract as start.bat :up)
REM    %1 service name  %2 entry file  %3 port  %4 label
REM ============================================================================
:up
set "S=%~1"
set "ENTRY=%~2"
set "SPORT=%~3"
set "LABEL=%~4"
set "PIDFILE=%RUN_DIR%\%S%.pid"
set "FULLENTRY=%APP_DIR%\%ENTRY%"

if not exist "%FULLENTRY%" (
  echo   [skip]    %LABEL% -- %ENTRY% not found
  exit /b 0
)

call :alive "%PIDFILE%"
if not errorlevel 1 (
  echo   [running] %LABEL% -- PID !OLDPID!, not started again
  exit /b 0
)

call :portfree %SPORT%
if errorlevel 1 (
  echo   [warn]    %LABEL% -- port %SPORT% is taken by another program, skipped
  echo             use status.bat to see what holds it
  exit /b 0
)

echo   [start]   %LABEL% ^(port %SPORT%^) ...
powershell -NoProfile -Command "$p = Start-Process -FilePath 'node' -ArgumentList '%ENTRY%' -WorkingDirectory '%APP_DIR%' -WindowStyle Hidden -PassThru -RedirectStandardOutput '%LOG_DIR%\%S%.out.log' -RedirectStandardError '%LOG_DIR%\%S%.err.log'; if ($p) { Set-Content -Path '%PIDFILE%' -Value $p.Id -Encoding ascii }"

call :alive "%PIDFILE%"
if errorlevel 1 (
  echo   [fail]    %LABEL% -- process did not survive, see %LOG_DIR%\%S%.err.log
  exit /b 0
)

set "OK="
for /l %%i in (1,1,15) do (
  if not defined OK (
    call :http %SPORT%
    if not errorlevel 1 set "OK=1"
    if not defined OK ping -n 2 127.0.0.1 >nul
  )
)
if defined OK (
  echo   [ok]      %LABEL% -- PID !OLDPID!, health check returned 200
) else (
  echo   [started] %LABEL% -- PID !OLDPID!, but no HTTP 200 within 15s
)
exit /b 0


REM ============================================================================
REM  helper: report one service status
REM ============================================================================
:report
set "S=%~1"
set "PIDFILE=%RUN_DIR%\%S%.pid"
call :alive "%PIDFILE%"
if errorlevel 1 (
  echo     -   %~2  not running
) else (
  echo     OK  %~2  running  PID = !OLDPID!
)
exit /b 0


REM ============================================================================
REM  helper: is our node process alive? sets OLDPID
REM ============================================================================
:alive
set "OLDPID="
if not exist "%~1" exit /b 1
for /f "usebackq delims=" %%a in ("%~1") do set "OLDPID=%%a"
if not defined OLDPID exit /b 1
powershell -NoProfile -Command "$p = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessId -eq %OLDPID% -and $_.Name -eq 'node.exe' -and $_.CommandLine -like '*server*.mjs*' }; if ($p) { exit 0 } else { exit 1 }"
exit /b %errorlevel%


REM ============================================================================
REM  helper: is the port free?
REM ============================================================================
:portfree
netstat -ano | findstr /r /c:":%~1 .*LISTENING" >nul 2>nul
if errorlevel 1 (exit /b 0) else (exit /b 1)


REM ============================================================================
REM  helper: does the port answer HTTP 200?
REM ============================================================================
:http
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -UseBasicParsing 'http://localhost:%~1/' -TimeoutSec 3; if ($r.StatusCode -eq 200) { exit 0 } else { exit 2 } } catch { exit 3 }"
exit /b %errorlevel%
