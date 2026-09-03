# Backend launcher — deps check, migrate, seed, then runserver.
# Kept as its own script (not inline in run_project.bat) so the batch never
# has a long-running foreground command that a stray Ctrl+C on its console can
# abort. Run directly, or via run_project.bat.

$env:PYTHONUTF8 = '1'
Set-Location $PSScriptRoot
$py = Join-Path $PSScriptRoot '..\.venv\Scripts\python.exe'

if (-not (Test-Path $py)) {
    Write-Host "Missing virtual environment: $py" -ForegroundColor Red
    Write-Host "Create it from the repo root with:  py -m venv .venv" -ForegroundColor Red
    Read-Host "Press Enter to close"
    exit 1
}

# Only install dependencies when one is actually missing — a full `pip install`
# on every launch is slow on a cold start and pointless once set up.
& $py -c 'import django, rest_framework, rest_framework_simplejwt, corsheaders, faker, dateutil' 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host 'Installing backend dependencies...' -ForegroundColor Yellow
    & $py -m pip install -q --disable-pip-version-check -r requirements.txt
} else {
    Write-Host 'Backend dependencies OK' -ForegroundColor Green
}

& $py manage.py migrate
& $py create_sample_data.py

Write-Host ''
Write-Host 'Backend: http://localhost:8000' -ForegroundColor Cyan
& $py manage.py runserver 0.0.0.0:8000
