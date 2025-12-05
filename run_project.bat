@echo off
setlocal

set ROOT=%~dp0

echo Starting Emergency CRM stack...

echo [1/3] Backend API
if not exist "%ROOT%backend\venv\Scripts\activate.bat" (
    echo Creating Python virtual environment for backend...
    python -m venv "%ROOT%backend\venv"
)
start "Backend" cmd /k "cd /d %ROOT%backend && call venv\Scripts\activate && pip install -r requirements.txt && python manage.py migrate && python manage.py runserver"

echo [2/3] Web Dashboard
start "Web" cmd /k "cd /d %ROOT%frontend-web && if not exist node_modules (npm install) && npm run dev"

echo [3/3] Mobile App
start "Mobile" cmd /k "cd /d %ROOT%mobile-app && if not exist node_modules (npm install) && npx expo start"

echo All services launching in separate terminals.
endlocal
