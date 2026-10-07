@echo off
chcp 936 >nul
setlocal EnableDelayedExpansion
title Interweaver - Status

REM ============================================================
REM  Interweaver  -  service launcher config
REM ------------------------------------------------------------
REM  Service list (keep identical in start / stop / status.bat)
REM
REM    name   entry file (relative to app\)     port    note
REM    web    server.mjs                       5188    front-end static host (only process today)
REM    api    server-api.mjs               5189    back-end API (optional: started if present)
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
set "API_PORT=5189"
REM ---- parse command line flags (see config header) ----
set "NOOPEN="
set "NOPAUSE="
for %%A in (%*) do (
  if /i "%%A"=="noopen"  set "NOOPEN=1"
  if /i "%%A"=="nopause" set "NOPAUSE=1"
)

echo.
echo   ��֯�� Interweaver  ^|  ����״̬
echo   ==============================================================
echo   ����            ״̬      �˿�    PID       �������
echo   --------------------------------------------------------------
call :row web %WEB_PORT% "ǰ�˾�̬����"
call :row api %API_PORT% "��˽ӿڷ���"
echo   --------------------------------------------------------------
call :uptime web "ǰ�˾�̬����"
echo   ���ʵ�ַ�� http://localhost:%WEB_PORT%/
echo.

if exist "%LOG_DIR%\web.out.log" (
  echo   �����־ ^(%LOG_DIR%\web.out.log^)��
  powershell -NoProfile -Command "Get-Content '%LOG_DIR%\web.out.log' -Tail 4 -Encoding UTF8 -ErrorAction SilentlyContinue | ForEach-Object { Write-Output ('     ' + $_) }"
  echo.
)
if exist "%LOG_DIR%\web.err.log" (
  for %%A in ("%LOG_DIR%\web.err.log") do if %%~zA GTR 0 (
    echo   ������־ ^(%LOG_DIR%\web.err.log^) �ǿգ�����У�
    powershell -NoProfile -Command "Get-Content '%LOG_DIR%\web.err.log' -Tail 4 -Encoding UTF8 -ErrorAction SilentlyContinue | ForEach-Object { Write-Output ('     ' + $_) }"
    echo.
  )
)

echo   δ�Ǽǵ� node ������̣������飩��
powershell -NoProfile -Command "$reg = @(); Get-ChildItem '%RUN_DIR%\*.pid' -ErrorAction SilentlyContinue | ForEach-Object { $v = Get-Content $_.FullName -ErrorAction SilentlyContinue | Select-Object -First 1; if ($v) { $reg += [int]$v } }; $ps = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*server.mjs*' -and ($reg -notcontains [int]$_.ProcessId) }; if (-not $ps) { Write-Output '     (none)' } else { $ps | ForEach-Object { Write-Output ('     PID ' + $_.ProcessId + '   ' + $_.CommandLine) } }"
echo.
echo   ������ʾ�� ��� start.bat      ֹͣ stop.bat      ˢ�±�ҳ status.bat
echo.
if not defined NOPAUSE (
  echo   ��������رձ����� ...
  pause >nul
)
endlocal
exit /b 0


REM ============================================================
REM
REM ============================================================

:row  %1=service name  %2=port  %3=label
set "S=%~1"
set "SPORT=%~2"
set "LABEL=%~3"
set "PIDFILE=%RUN_DIR%\%S%.pid"
set "PID=-"
set "STATE=δ����"
set "HLTH=-"

call :alive "%PIDFILE%"
if not errorlevel 1 (
  set "PID=!OLDPID!"
  set "STATE=������"
  call :http %SPORT%
  if !errorlevel! equ 0 (set "HLTH=HTTP 200 OK") else (set "HLTH=����Ӧ")
)

REM  port is busy but no registered process -> report it
if "!STATE!"=="δ����" (
  call :portfree %SPORT%
  if errorlevel 1 set "STATE=�˿�ռ��"
)

echo   %LABEL%      !STATE!    %SPORT%   !PID!      !HLTH!
exit /b 0


:uptime  %1=service name  %2=label
set "PIDFILE=%RUN_DIR%\%~1.pid"
call :alive "%PIDFILE%"
if errorlevel 1 exit /b 0
for /f "usebackq delims=" %%a in (`powershell -NoProfile -Command "$p = Get-Process -Id !OLDPID! -ErrorAction SilentlyContinue; if ($p) { $p.StartTime.ToString('yyyy-MM-dd HH:mm:ss') }"`) do set "START=%%a"
for /f "usebackq delims=" %%a in (`powershell -NoProfile -Command "$p = Get-Process -Id !OLDPID! -ErrorAction SilentlyContinue; if ($p) { [int]((Get-Date) - $p.StartTime).TotalSeconds }"`) do set "SEC=%%a"
echo   %~2 ����� !START!   ������ !SEC! ��
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
