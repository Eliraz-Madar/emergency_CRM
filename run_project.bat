@echo off
setlocal

:: Switch console to UTF-8 so Python checkmarks (✓) print cleanly
chcp 65001 > nul

set ROOT=%~dp0
set VENV_PYTHON=%ROOT%.venv\Scripts\python.exe

if not exist "%VENV_PYTHON%" (
    echo Missing virtual environment: %VENV_PYTHON%
    echo Create it with: py -m venv .venv
    exit /b 1
)

echo Starting Emergency CRM stack...

echo [1/3] Backend API - preparing database...
cd /d "%ROOT%backend"

:: Only install dependencies when they're actually missing. Running
:: "pip install" on every launch blocks the whole script for seconds on a
:: cold start (requirement resolution + a network self-version-check), and a
:: stray Ctrl+C in that window aborts the batch ("Terminate batch job Y/N").
"%VENV_PYTHON%" -c "import django, rest_framework, rest_framework_simplejwt, corsheaders, faker, dateutil" >nul 2>&1
if errorlevel 1 (
    echo     installing backend dependencies...
    "%VENV_PYTHON%" -m pip install -q --disable-pip-version-check -r requirements.txt
) else (
    echo     backend dependencies already installed
)

"%VENV_PYTHON%" manage.py migrate
"%VENV_PYTHON%" create_sample_data.py

echo [1/3] Backend API - starting server...
start "Backend" powershell -NoExit -Command "Set-Location '%ROOT%backend'; & '%VENV_PYTHON%' manage.py runserver 0.0.0.0:8000"
echo    -> Backend: http://localhost:8000

cd /d "%ROOT%"

echo [2/3] Web Dashboard
start "Frontend" powershell -NoExit -Command "Set-Location '%ROOT%frontend-web'; npm run dev"
echo    -> Frontend: http://localhost:5173

timeout /t 5 /nobreak > nul
start "" http://localhost:5173

echo [3/3] Mobile App - scan QR code with Expo Go on your phone
start "Mobile App" powershell -NoExit -Command "Set-Location '%ROOT%mobile-app'; npx expo start"

echo All services launching in separate terminals.
endlocal
