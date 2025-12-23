#!/bin/bash

# Emergency CRM - Field War-Room Dashboard
# Start script for Linux/Mac

set -e

echo ""
echo "╔════════════════════════════════════════════════════╗"
echo "║  Emergency CRM - Field War-Room Dashboard Demo    ║"
echo "║  Starting Backend + Frontend Services...           ║"
echo "╚════════════════════════════════════════════════════╝"
echo ""

# Check prerequisites
echo "Checking prerequisites..."

if ! command -v python3 &> /dev/null; then
    echo "✗ Python 3 not found. Please install Python 3.9+"
    exit 1
fi

if ! command -v node &> /dev/null; then
    echo "✗ Node.js not found. Please install Node.js 16+"
    exit 1
fi

echo "✓ Python 3 found"
echo "✓ Node.js found"
echo ""

# Get root directory
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Set environment variables
export DJANGO_DEBUG=1
export DEMO_SEED=42
export VITE_API_URL=http://localhost:8000/api

# Function to cleanup on exit
cleanup() {
    echo ""
    echo "Shutting down services..."
    kill %1 %2 2>/dev/null || true
    wait %1 %2 2>/dev/null || true
}

trap cleanup EXIT

# Start Backend
echo "Starting Backend Service (Django)..."
(
    cd "$ROOT/backend"
    echo "Installing dependencies..."
    pip install -q -r requirements.txt 2>/dev/null || pip3 install -q -r requirements.txt
    python manage.py migrate --noinput >/dev/null 2>&1 || python3 manage.py migrate --noinput >/dev/null 2>&1
    echo ""
    echo "[✓] Backend running at http://localhost:8000/api"
    echo "[✓] Mock Data Endpoints:  GET /mock/incidents, /mock/units, /mock/events"
    echo "[✓] Real-time Stream:      GET /mock/updates/stream (Server-Sent Events)"
    echo ""
    python manage.py runserver 0.0.0.0:8000 2>&1 || python3 manage.py runserver 0.0.0.0:8000 2>&1
) &
BACKEND_PID=$!

# Wait for backend to initialize
sleep 3

echo ""
echo "Starting Frontend Dashboard (Vite)..."
(
    cd "$ROOT/frontend-web"
    echo "Installing dependencies..."
    if [ ! -d "node_modules" ]; then
        npm install >/dev/null 2>&1
    fi
    echo ""
    echo "[✓] Frontend running at http://localhost:5173"
    echo "[✓] Dashboard Features:"
    echo "    - Real-time incident tracking"
    echo "    - Interactive map with units"
    echo "    - Status workflow management"
    echo "    - Live event feed"
    echo ""
    npm run dev 2>&1
) &
FRONTEND_PID=$!

echo ""
echo "╔════════════════════════════════════════════════════╗"
echo "║  ✓ Services Starting...                            ║"
echo "║                                                    ║"
echo "║  FRONTEND:  http://localhost:5173                  ║"
echo "║  BACKEND:   http://localhost:8000/api              ║"
echo "║                                                    ║"
echo "║  Demo Mode: ENABLED (auto-generating incidents)    ║"
echo "║  Seed:      42 (reproducible data)                 ║"
echo "║                                                    ║"
echo "║  Press Ctrl+C to stop all services.                ║"
echo "╚════════════════════════════════════════════════════╝"
echo ""

# Wait for processes
wait
