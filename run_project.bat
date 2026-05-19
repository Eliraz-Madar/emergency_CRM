@echo off
setlocal

set ROOT=%~dp0

echo Starting Emergency CRM stack...

echo [1/3] Backend API - preparing database...
cd /d %ROOT%backend
python manage.py migrate
python create_sample_data.py

echo [1/3] Backend API - starting server...
start "Backend" cmd /k "cd /d %ROOT%backend && python manage.py runserver"
echo    -> Backend: http://localhost:8000

cd /d %ROOT%

echo [2/3] Web Dashboard
start "Frontend" cmd /k "cd /d %ROOT%frontend-web && npm run dev"
echo    -> Frontend: http://localhost:5173

timeout /t 5 /nobreak > nul

echo [3/3] Run mobile Application on Emulator
start "Mobile Emulator" cmd /k "cd /d %ROOT%mobile-app && npx expo start --android"

echo All services launching in separate terminals.
endlocal
