@echo off
setlocal

set ROOT=%~dp0

echo Starting Emergency CRM stack...

echo [1/2] Backend API
start "Backend" cmd /k "cd /d "%ROOT%backend" && python manage.py runserver"
echo    -> Backend: http://localhost:8000

echo [2/2] Web Dashboard
start "Frontend" cmd /k "cd /d "%ROOT%frontend-web" && npm run dev"
echo    -> Frontend: http://localhost:5173

echo Both services launching in separate terminals.
endlocal
