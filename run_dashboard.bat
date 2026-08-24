@echo off
REM ============================================
REM Emergency CRM - Field War-Room Dashboard
REM Start script for Windows
REM ============================================

setlocal enabledelayedexpansion

echo.
echo ╔════════════════════════════════════════════════════╗
echo ║  Emergency CRM - Field War-Room Dashboard Demo    ║
echo ║  Starting Backend + Frontend Services...           ║
echo ╚════════════════════════════════════════════════════╝
echo.

REM Set root directory
set ROOT=%~dp0
set VENV_PYTHON=%ROOT%.venv\Scripts\python.exe

if not exist "%VENV_PYTHON%" (
    echo ✗ Python virtual environment not found at %VENV_PYTHON%
    echo Create it with: py -m venv .venv
    exit /b 1
)

REM Check for required tools
echo Checking prerequisites...
where python >nul 2>&1
if errorlevel 1 (
    echo ✗ Python not found. Please install Python 3.9+
    exit /b 1
)

node --version >nul 2>&1
if errorlevel 1 (
    echo ✗ Node.js not found. Please install Node.js 16+
    exit /b 1
)

echo ✓ Python found
echo ✓ Node.js found
echo.

REM Set environment variables
set DJANGO_DEBUG=1
set DEMO_SEED=42
set VITE_API_URL=http://localhost:8000/api

REM Start Backend
echo Starting Backend Service (Django)...
cd /d "%ROOT%backend"
if not exist "requirements.txt" (
    echo Error: requirements.txt not found in backend folder
    exit /b 1
)
start "Emergency CRM - Backend" powershell -NoExit -Command "Set-Location '%ROOT%backend'; & '%VENV_PYTHON%' -m pip install -q -r requirements.txt; Write-Host ''; Write-Host '[✓] Backend running at http://localhost:8000/api'; Write-Host '[✓] Mock Data Endpoints:  GET /mock/incidents, /mock/units, /mock/events'; Write-Host '[✓] Real-time Stream:      GET /mock/updates/stream (Server-Sent Events)'; Write-Host ''; & '%VENV_PYTHON%' manage.py runserver 0.0.0.0:8000"

REM Wait for backend to initialize
timeout /t 3 /nobreak >nul

echo.
echo Starting Frontend Dashboard (Vite)...
cd /d "%ROOT%frontend-web"
if not exist "package.json" (
    echo Error: package.json not found in frontend-web folder
    exit /b 1
)
start "Emergency CRM - Frontend" cmd /k "if not exist node_modules (npm install) && echo. && echo [✓] Frontend running at http://localhost:5173 && echo [✓] Dashboard Features: && echo     - Real-time incident tracking && echo     - Interactive map with units && echo     - Status workflow management && echo     - Live event feed && echo. && npm run dev"
cd /d "%ROOT%"

echo.
echo ╔════════════════════════════════════════════════════╗
echo ║  ✓ Services Starting...                            ║
echo ║                                                    ║
echo ║  FRONTEND:  http://localhost:5173                  ║
echo ║  BACKEND:   http://localhost:8000/api              ║
echo ║                                                    ║
echo ║  Demo Mode: ENABLED (auto-generating incidents)    ║
echo ║  Seed:      42 (reproducible data)                 ║
echo ║                                                    ║
echo ║  Use browser DevTools (F12) to see logs.           ║
echo ║  Check terminal windows for API logs.              ║
echo ║                                                    ║
echo ║  Close this window to stop all services.           ║
echo ╚════════════════════════════════════════════════════╝
echo.

echo Waiting for services to finish...
pause >nul

REM Cleanup: Kill processes
taskkill /FI "WINDOWTITLE eq Emergency CRM - Backend" /T /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq Emergency CRM - Frontend" /T /F >nul 2>&1

echo.
echo Services stopped. Goodbye!
