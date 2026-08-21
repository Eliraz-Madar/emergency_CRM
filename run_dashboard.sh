#!/bin/bash

# ==============================================================================
# Emergency CRM - Full Stack Launcher (macOS / Linux)
# Starts Backend (Django), Web Dashboard (Vite), and Mobile App (Expo)
# ==============================================================================

set -e

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Root directory
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo -e "${BLUE}╔════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║      Starting Emergency CRM Full Stack (Mac)       ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════╝${NC}\n"

# 1. Check prerequisites
echo -e "${YELLOW}Checking prerequisites...${NC}"
if command -v python3 &> /dev/null; then
    PY_CMD="python3"
elif command -v python &> /dev/null; then
    PY_CMD="python"
else
    echo -e "${RED}✗ Python not found. Please install Python 3.9+${NC}"
    exit 1
fi

if ! command -v node &> /dev/null; then
    echo -e "${RED}✗ Node.js not found. Please install Node.js 18+${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Using Python: $($PY_CMD --version)${NC}"
echo -e "${GREEN}✓ Using Node:   $(node --version)${NC}\n"

# Function to clean up all child processes on exit (Ctrl+C)
cleanup() {
    echo -e "\n${YELLOW}Stopping all Emergency CRM services...${NC}"
    kill 0 2>/dev/null || true
    wait 2>/dev/null || true
    echo -e "${GREEN}All services stopped cleanly.${NC}"
}
trap cleanup EXIT INT TERM

# 2. Backend - Migrations & Sample Data
echo -e "${BLUE}[1/3] Backend API - Preparing database...${NC}"
cd "$ROOT/backend"

# Install requirements if not present / optional check
if [ -f "requirements.txt" ]; then
    pip install -q -r requirements.txt 2>/dev/null || pip3 install -q -r requirements.txt 2>/dev/null || true
fi

$PY_CMD manage.py migrate --noinput
if [ -f "create_sample_data.py" ]; then
    $PY_CMD create_sample_data.py
fi

echo -e "${BLUE}[1/3] Backend API - Starting Django server...${NC}"
$PY_CMD manage.py runserver 0.0.0.0:8000 &
BACKEND_PID=$!
echo -e "${GREEN}   -> Backend running: http://localhost:8000${NC}\n"

# 3. Web Dashboard (Vite)
echo -e "${BLUE}[2/3] Web Dashboard - Starting Vite...${NC}"
cd "$ROOT/frontend-web"
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}Installing web dependencies...${NC}"
    npm install
fi
npm run dev &
FRONTEND_PID=$!
echo -e "${GREEN}   -> Frontend running: http://localhost:5173${NC}\n"

# Open browser automatically on macOS
sleep 2
if [[ "$OSTYPE" == "darwin"* ]]; then
    open http://localhost:5173 || true
elif command -v xdg-open &> /dev/null; then
    xdg-open http://localhost:5173 || true
fi

# 4. Mobile App (Expo)
echo -e "${BLUE}[3/3] Mobile App - Starting Expo...${NC}"
cd "$ROOT/mobile-app"
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}Installing mobile dependencies...${NC}"
    npm install
fi

echo -e "${GREEN}====================================================${NC}"
echo -e "${GREEN}✓ All services active! Scan QR code for Expo Go below${NC}"
echo -e "${GREEN}  Press Ctrl+C at any time to shut down all services ${NC}"
echo -e "${GREEN}====================================================${NC}\n"

npx expo start