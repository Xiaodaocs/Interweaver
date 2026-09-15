@echo off
chcp 936 >nul
setlocal EnableDelayedExpansion
title Interweaver - Stop

REM ============================================================
REM  Interweaver  -  service launcher config
REM ------------------------------------------------------------
REM  Service list (keep identical in start / stop / status.bat)
REM
REM    name   entry file (relative to app\)     port    note
REM    web    server.mjs                       5188    front-end static host (only process today)
REM    api    backend\server.mjs               5190    back-end API (optional: started if present)
REM
REM  Command line flags:
REM    noopen    do not open the browser automatically
REM    nopause   do not wait for a key press before closing (for scripting)
REM ============================================================
set "ROOT=%~dp0"
set "RUN_DIR=%ROOT%run"
set "LOG_DIR=%ROOT%logs"
set "WEB_PORT=5188"
set "API_PORT=5190"
REM ---- parse command line flags (see config header) ----
set "NOOPEN="
set "NOPAUSE="
for %%A in (%*) do (
  if /i "%%A"=="noopen"  set "NOOPEN=1"
  if /i "%%A"=="nopause" set "NOPAUSE=1"
)

echo.
echo   交织者 Interweaver  ^|  一键停止
echo   ==============================================================
echo.

call :down web %WEB_PORT% "前端静态服务"
call :down api %API_PORT% "后端接口服务"

REM  fallback: kill leftover node processes running this project's server.mjs
call :stray_kill

echo.
echo   ==============================================================
echo   停止完成。查看状态： status.bat      重新启动： start.bat
echo.
if not defined NOPAUSE (
  echo   按任意键关闭本窗口 ...
  pause >nul
)
endlocal
exit /b 0


REM ============================================================
REM
REM ============================================================

:down  %1=service name  %2=port  %3=label
set "S=%~1"
set "SPORT=%~2"
set "LABEL=%~3"
set "PIDFILE=%RUN_DIR%\%S%.pid"
set "KILLED="

call :alive "%PIDFILE%"
if not errorlevel 1 (
  taskkill /PID !OLDPID! /T /F >nul 2>nul
  if errorlevel 1 (
    echo   [失败]   %LABEL% —— PID !OLDPID! 无法结束（可能权限不足，请以管理员身份运行）
  ) else (
    echo   [已停止] %LABEL% —— PID !OLDPID!
    set "KILLED=1"
  )
)

REM  also handle a port still held by a leftover process
call :portfree %SPORT%
if errorlevel 1 (
  for /f "tokens=5" %%P in ('netstat -ano ^| findstr /r /c:":%SPORT% .*LISTENING"') do (
    call :isours %%P
    if not errorlevel 1 (
      taskkill /PID %%P /T /F >nul 2>nul
      echo   [已停止] %LABEL% —— 残留进程 PID %%P
      set "KILLED=1"
    ) else (
      echo   [跳过]   端口 %SPORT% 被非本项目进程占用 ^(PID %%P^)，未做处理
    )
  )
)

if not defined KILLED echo   [无需操作] %LABEL% 未在运行
if exist "%PIDFILE%" del "%PIDFILE%" >nul 2>nul
exit /b 0


:stray_kill
REM  fallback: kill leftover node processes running this project's server.mjs
REM  PowerShell  ASCII
set "TMPLIST=%TEMP%\iw_stray.txt"
powershell -NoProfile -Command "$ps = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*server.mjs*' }; foreach ($p in $ps) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue; Add-Content -Path '%TMPLIST%' -Value $p.ProcessId -Encoding ascii }" >nul 2>nul
set "N=0"
if exist "%TMPLIST%" (
  for /f "usebackq delims=" %%P in ("%TMPLIST%") do (
    set /a N+=1
    echo   [已停止] 残留进程 PID %%P
  )
  del "%TMPLIST%" >nul 2>nul
)
if "!N!"=="0" echo   [无需操作] 无残留的 node 服务进程
exit /b 0
:alive  %1=pid file  ->  errorlevel 0 if our node process is alive; sets OLDPID
set "OLDPID="
if not exist "%~1" exit /b 1
for /f "usebackq delims=" %%a in ("%~1") do set "OLDPID=%%a"
if not defined OLDPID exit /b 1
powershell -NoProfile -Command "$p = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessId -eq %OLDPID% -and $_.Name -eq 'node.exe' -and $_.CommandLine -like '*server.mjs*' }; if ($p) { exit 0 } else { exit 1 }"
exit /b %errorlevel%


:isours  %1=PID  ->  errorlevel 0 if this PID is our own node server
powershell -NoProfile -Command "$p = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessId -eq %~1 }; if ($p -and $p.Name -eq 'node.exe' -and $p.CommandLine -like '*server.mjs*') { exit 0 } else { exit 1 }"
exit /b %errorlevel%


:portfree  %1=port  ->  errorlevel 0 if the port is free
netstat -ano | findstr /r /c:":%~1 .*LISTENING" >nul 2>nul
if errorlevel 1 (exit /b 0) else (exit /b 1)
