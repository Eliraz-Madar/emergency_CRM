@echo off
setlocal

set ROOT=%~dp0

if not exist "%ROOT%.venv\Scripts\python.exe" (
    echo Missing virtual environment: %ROOT%.venv\Scripts\python.exe
    echo Create it from the repo root with:  py -m venv .venv
    exit /b 1
)

echo Starting Emergency CRM stack...

:: This batch does NOTHING long-running itself - it only opens three windows.
:: The DB prep (deps / migrate / seed) used to run inline here, so a stray
:: Ctrl+C on this console (common when the .bat is launched from a PowerShell
:: prompt) aborted the whole launch mid-migrate. Each window below has its own
:: console and is immune to that.

echo [1/3] Backend API  (deps check + migrate + seed + runserver)
start "Backend" powershell -NoExit -ExecutionPolicy Bypass -File "%ROOT%backend\run_backend.ps1"

echo [2/3] Web Dashboard
start "Frontend" powershell -NoExit -Command "Set-Location '%ROOT%frontend-web'; npm run dev"
echo    -> Frontend: http://localhost:5173

timeout /t 6 /nobreak > nul
start "" http://localhost:5173

echo [3/3] Mobile App - scan the QR code with Expo Go on your phone
start "Mobile App" powershell -NoExit -Command "Set-Location '%ROOT%mobile-app'; npx expo start"

echo All services launching in separate windows.
endlocal
