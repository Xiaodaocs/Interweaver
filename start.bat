@echo off
chcp 936 >nul
setlocal EnableDelayedExpansion
title Interweaver - Start

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
set "APP_DIR=%ROOT%app"
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

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   [错误] 未检测到 Node.js。
  echo          请先安装 Node.js：https://nodejs.org  然后重新双击本脚本。
  echo.
  if not defined NOPAUSE pause
  exit /b 1
)

if not exist "%RUN_DIR%" mkdir "%RUN_DIR%" >nul 2>nul
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%" >nul 2>nul

echo.
echo   交织者 Interweaver  ^|  一键启动
echo   ==============================================================
echo.

call :up web "server.mjs"         %WEB_PORT% "前端静态服务"
call :up api "backend\server.mjs" %API_PORT% "后端接口服务"

echo.
echo   ==============================================================
echo   汇总：
call :report web "前端静态服务"
call :report api "后端接口服务"
echo.

if not defined NOOPEN (
  echo   正在打开浏览器 ...
  start "" "http://localhost:%WEB_PORT%/"
  echo.
)

echo   停止服务： stop.bat       查看状态： status.bat
echo   日志目录： %LOG_DIR%
echo.
if not defined NOPAUSE (
  echo   按任意键关闭本窗口（服务会继续在后台运行）...
  pause >nul
)
endlocal
exit /b 0


REM ============================================================
REM
REM ============================================================

:up  %1=service name  %2=entry file  %3=port  %4=label
set "S=%~1"
set "ENTRY=%~2"
set "SPORT=%~3"
set "LABEL=%~4"
set "PIDFILE=%RUN_DIR%\%S%.pid"
set "FULLENTRY=%APP_DIR%\%ENTRY%"

if not exist "%FULLENTRY%" (
  echo   [跳过]   %LABEL% —— 未检测到 %ENTRY%（当前为前后端同源单进程架构）
  exit /b 0
)

call :alive "%PIDFILE%"
if not errorlevel 1 (
  echo   [已运行] %LABEL% —— PID !OLDPID!，无需重复启动
  exit /b 0
)

call :portfree %SPORT%
if errorlevel 1 (
  echo   [警告]   %LABEL% —— 端口 %SPORT% 已被其它程序占用，已跳过
  echo            可用 status.bat 查看占用情况
  exit /b 0
)

echo   [启动中] %LABEL% ^(端口 %SPORT%^) ...
powershell -NoProfile -Command "$p = Start-Process -FilePath 'node' -ArgumentList '%ENTRY%' -WorkingDirectory '%APP_DIR%' -WindowStyle Hidden -PassThru -RedirectStandardOutput '%LOG_DIR%\%S%.out.log' -RedirectStandardError '%LOG_DIR%\%S%.err.log'; if ($p) { Set-Content -Path '%PIDFILE%' -Value $p.Id -Encoding ascii }"

call :alive "%PIDFILE%"
if errorlevel 1 (
  echo   [失败]   %LABEL% —— 进程未存活，请查看 %LOG_DIR%\%S%.err.log
  exit /b 0
)

REM  wait for the HTTP health check to pass (up to 15 seconds)
set "OK="
for /l %%i in (1,1,15) do (
  if not defined OK (
    call :http %SPORT%
    if not errorlevel 1 set "OK=1"
    if not defined OK ping -n 2 127.0.0.1 >nul
  )
)
if defined OK (
  echo   [成功]   %LABEL% —— PID !OLDPID!，健康检查 http://localhost:%SPORT%/ 返回 200
) else (
  echo   [已启动] %LABEL% —— PID !OLDPID!，但 15 秒内未通过 HTTP 健康检查
)
exit /b 0


:report  %1=service name  %2=label
set "S=%~1"
set "PIDFILE=%RUN_DIR%\%S%.pid"
call :alive "%PIDFILE%"
if errorlevel 1 (
  echo     -   %~2  未运行
) else (
  echo     OK  %~2  运行中  PID = !OLDPID!
)
exit /b 0


:alive  %1=pid file  ->  errorlevel 0 if our node process is alive; sets OLDPID
set "OLDPID="
if not exist "%~1" exit /b 1
for /f "usebackq delims=" %%a in ("%~1") do set "OLDPID=%%a"
if not defined OLDPID exit /b 1
powershell -NoProfile -Command "$p = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessId -eq %OLDPID% -and $_.Name -eq 'node.exe' -and $_.CommandLine -like '*server.mjs*' }; if ($p) { exit 0 } else { exit 1 }"
exit /b %errorlevel%


:portfree  %1=port  ->  errorlevel 0 if the port is free
netstat -ano | findstr /r /c:":%~1 .*LISTENING" >nul 2>nul
if errorlevel 1 (exit /b 0) else (exit /b 1)


:http  %1=port  ->  errorlevel 0 if HTTP 200 is returned
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -UseBasicParsing 'http://localhost:%~1/' -TimeoutSec 3; if ($r.StatusCode -eq 200) { exit 0 } else { exit 2 } } catch { exit 3 }"
exit /b %errorlevel%
