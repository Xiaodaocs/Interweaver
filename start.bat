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
REM    api    server-api.mjs               5189    back-end API (optional: started if present)
REM
REM  Command line flags:
REM    fetch     when core files are missing, download the latest from GitHub and replace
REM    noupdate  skip the automatic version check / update on startup
REM    nofetch   never download (default: only report what is missing)
REM    noopen    do not open the browser automatically
REM    nopause   do not wait for a key press before closing (for scripting)
REM ============================================================
set "ROOT=%~dp0"
set "ROOT_NB=%ROOT:~0,-1%"   REM ���� PowerShell ��·�����ܴ�β����б��
set "REPO=Xiaodaocs/Interweaver"
set "BRANCH=main"
set "APP_DIR=%ROOT%app"
set "RUN_DIR=%ROOT%run"
set "LOG_DIR=%ROOT%logs"
set "WEB_PORT=5188"
set "API_PORT=5189"
REM ---- parse command line flags (see config header) ----
set "NOOPEN="
set "NOPAUSE="
set "DOFETCH="
set "NOFETCH="
set "NOUPDATE="
for %%A in (%*) do (
  if /i "%%A"=="noopen"  set "NOOPEN=1"
  if /i "%%A"=="nopause" set "NOPAUSE=1"
  if /i "%%A"=="fetch"   set "DOFETCH=1"
  if /i "%%A"=="nofetch" set "NOFETCH=1"
  if /i "%%A"=="noupdate" set "NOUPDATE=1"
)

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   [����] δ��⵽ Node.js��
  echo          ���Ȱ�װ Node.js��https://nodejs.org  Ȼ������˫�����ű���
  echo.
  if not defined NOPAUSE pause
  exit /b 1
)

REM ============================================================
REM  environment check: dependencies + core files
REM ============================================================
echo   [�����Լ�]
REM ---- ������app\node_modules ȱʧ / ��¼�� package.json �� / ������ puppeteer ȴûװ ----
set "NEED_INSTALL="
set "NEED_WHY="
if not exist "%APP_DIR%\package.json"       (set "NEED_INSTALL=1" & set "NEED_WHY=ȱ�� app\package.json")
if not exist "%APP_DIR%\node_modules"       (set "NEED_INSTALL=1" & set "NEED_WHY=δ��װ���� app\node_modules")
if not exist "%APP_DIR%\node_modules\.package-lock.json" (set "NEED_INSTALL=1" & set "NEED_WHY=ȱ��������¼")
if not defined NEED_INSTALL (
  for %%F in ("%APP_DIR%\package.json") do set "PKG_T=%%~tF"
  for %%F in ("%APP_DIR%\node_modules\.package-lock.json") do set "LOCK_T=%%~tF"
  if "!PKG_T!" GTR "!LOCK_T!" (set "NEED_INSTALL=1" & set "NEED_WHY=package.json ��������¼��")
)
if defined NEED_INSTALL (
  echo     -   !NEED_WHY!�����ڰ�װ���� ^(npm install���״ν���^) ...
  pushd "%APP_DIR%"
  call npm install --no-audit --no-fund
  set "NPMRC=!errorlevel!"
  popd
  if "!NPMRC!"=="0" (echo     OK  �����Ѱ�װ) else (echo     [����] ������װʧ�� ^(�˳��� !NPMRC!^)��ǰ��������ʱ�����Կ��������������Ҫ puppeteer)
) else (
  echo     OK  �����Ѿ���
)
REM ---- �����ļ���ȱʧ�򱨸棻ֻ����ʽ fetch �������滻��������ɾ��Ŀ�ļ���----
set "MISSING="
for %%R in (VERSION app\server.mjs app\package.json app\index.html app\styles.css app\src\main.js app\src\state.js app\src\entities.js) do (
  if not exist "%ROOT%%%R" (if defined MISSING (set "MISSING=!MISSING!, %%R") else (set "MISSING=%%R"))
)
if not defined MISSING (
  echo     OK  �����ļ���ȫ
) else (
  echo     [����] �����ļ�ȱʧ�� !MISSING!
  if defined DOFETCH (
    if defined NOFETCH (
      echo         ��ָ�� nofetch����������
    ) else (
      echo         ���ڴ� GitHub ��ȡ�����ļ� ^(���ȱ��ݵ� backup\^) ...
      powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%tools\fetch-latest.ps1" -Repo "%REPO%" -Root "%ROOT_NB%" -Mode real
      if errorlevel 1 echo         [����] ��ȡʧ�ܣ�����������ֶ�����
    )
  ) else (
    echo         �޸�����������  start.bat fetch   ^(���Զ����ݺ����滻^)
    echo         ���ֶ��� https://github.com/%REPO% ���غ󸲸�
  )
)
echo.

if not exist "%RUN_DIR%" mkdir "%RUN_DIR%" >nul 2>nul
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%" >nul 2>nul

echo.
REM ---- �汾��飺ÿ�������ȥ GitHub ����û�и��µ� Release���о͸��£��û����ݲ�ɾ��----
REM   ������ GitHub ��ֱ������������������������û���ȷҪ�󣩡�
if defined NOUPDATE (
  echo   [�汾���] ��ָ�� noupdate������
) else if not exist "%ROOT%tools\update-check.ps1" (
  echo   [�汾���] ȱ�� tools\update-check.ps1������
) else (
  echo   [�汾���] ���ڲ�ѯ GitHub Release ...
  powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%tools\update-check.ps1" -Repo "%REPO%" -Root "%ROOT_NB%"
  if errorlevel 1 echo   [�汾���] ���/����δ��ɣ���Ӱ�������
)
echo.
echo   ��֯�� Interweaver  ^|  һ�����
echo   ==============================================================
echo.

call :up web "server.mjs"         %WEB_PORT% "ǰ�˾�̬����"
call :up api "server-api.mjs" %API_PORT% "��˽ӿڷ���"

echo.
echo   ==============================================================
echo   ���ܣ�
call :report web "ǰ�˾�̬����"
call :report api "��˽ӿڷ���"
echo.

if not defined NOOPEN (
  echo   ���ڴ������ ...
  start "" "http://localhost:%WEB_PORT%/"
  echo.
)

echo   ֹͣ���� stop.bat       �鿴״̬�� status.bat
echo   ��־Ŀ¼�� %LOG_DIR%
echo.
if not defined NOPAUSE (
  echo   ��������رձ����ڣ����������ں�̨���У�...
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
  echo   [����]   %LABEL% ���� δ��⵽ %ENTRY%����ǰΪǰ���ͬԴ�����̼ܹ���
  exit /b 0
)

call :alive "%PIDFILE%"
if not errorlevel 1 (
  echo   [������] %LABEL% ���� PID !OLDPID!�������ظ����
  exit /b 0
)

call :portfree %SPORT%
if errorlevel 1 (
  echo   [����]   %LABEL% ���� �˿� %SPORT% �ѱ���������ռ�ã�������
  echo            ���� status.bat �鿴ռ�����
  exit /b 0
)

echo   [�����] %LABEL% ^(�˿� %SPORT%^) ...
powershell -NoProfile -Command "$p = Start-Process -FilePath 'node' -ArgumentList '%ENTRY%' -WorkingDirectory '%APP_DIR%' -WindowStyle Hidden -PassThru -RedirectStandardOutput '%LOG_DIR%\%S%.out.log' -RedirectStandardError '%LOG_DIR%\%S%.err.log'; if ($p) { Set-Content -Path '%PIDFILE%' -Value $p.Id -Encoding ascii }"

call :alive "%PIDFILE%"
if errorlevel 1 (
  echo   [ʧ��]   %LABEL% ���� ����δ����鿴 %LOG_DIR%\%S%.err.log
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
  echo   [�ɹ�]   %LABEL% ���� PID !OLDPID!��������� http://localhost:%SPORT%/ ���� 200
) else (
  echo   [�����] %LABEL% ���� PID !OLDPID!���� 15 ����δͨ�� HTTP �������
)
exit /b 0


:report  %1=service name  %2=label
set "S=%~1"
set "PIDFILE=%RUN_DIR%\%S%.pid"
call :alive "%PIDFILE%"
if errorlevel 1 (
  echo     -   %~2  δ����
) else (
  echo     OK  %~2  ������  PID = !OLDPID!
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
