# Quick Start Guide - Field War-Room Dashboard

## 🚀 Get Running in 2 Minutes

### Windows Users

**Option 1: Automatic (Recommended)**
```cmd
cd final_code
run_project.bat
```

**Option 2: Manual**
```cmd
# Terminal 1 - Backend
cd backend
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
python manage.py migrate
python create_sample_data.py
python manage.py runserver

# Terminal 2 - Frontend (new window)
cd frontend-web
npm install
npm run dev

# Terminal 3 - Mobile (new window)
cd mobile-app
npm install
npx expo start
```

Then open browser → `http://localhost:5173`

### Mac/Linux Users

```bash
# Terminal 1
cd backend
source venv/bin/activate
pip3 install -r requirements.txt
python3 manage.py migrate
python3 create_sample_data.py
python3 manage.py runserver

# Terminal 2
cd frontend-web
npm install
npm run dev

# Terminal 3 (mobile)
cd mobile-app
npm install
npx expo start
```

## ✅ You Should See

After start-up: the War-Room Dashboard loads at `http://localhost:5173/regional` with 18+ live incidents, unit markers on the map, and a green **CONNECTED** badge in the top-right corner.

## 🎮 Try These Actions (30 seconds)

1. **Click an incident** in the left list
   - Details panel opens on the right
   
2. **Click the incident on the map**
   - Highlights the incident
   
3. **Change incident status**
   - Click "OPEN" → "IN_PROGRESS"
   - Notice event log updates
   
4. **Dispatch a unit to an incident**
   - Click an incident → "DISPATCH FORCES"
   - Select unit type, tick a unit, click Dispatch
   - Unit drives to the incident on the map in real time
   
5. **Filter by severity**
   - Click "Filters"
   - Toggle "CRITICAL" only
   - Watch list update

6. **Search**
   - Type incident title in search box
   - Results filter instantly

7. **Watch live updates**
   - New incidents appear automatically
   - Units move on map
   - Events log real-time activity

8. **Open the mobile app** (Expo)
   - Log in as `police` / `police123`
   - Select your specific unit (e.g., "Unit 43")
   - Go back to the dashboard and dispatch "Unit 43" to an incident
   - The task appears on the mobile device within 8 seconds

## 🐛 Troubleshooting

### Backend won't start
```bash
# Port 8000 already in use?
netstat -tulpn | grep 8000  # Linux
lsof -i :8000               # Mac
netstat -ano | findstr 8000 # Windows

# Kill the process or use different port
python manage.py runserver 8001
```

### `No module named 'django'`
```powershell
# Virtual environment not active — run this first:
cd backend
.\venv\Scripts\Activate.ps1   # Windows PowerShell
# Then run your manage.py command
```

### Frontend won't load
```bash
# Check backend is running
curl http://localhost:8000/api/mock/incidents/

# Check API URL
export VITE_API_URL=http://localhost:8000/api
npm run dev
```

### No real-time updates
```bash
# Check browser console for errors (F12)
# Try refreshing page (polling fallback)
# Check if SSE is supported (all modern browsers)
```

### Port already in use
```bash
# Change port in vite.config.js
export default defineConfig({
  server: { port: 5174 },
  ...
})

# Or use environment variable
VITE_PORT=5174 npm run dev
```

### Mobile app shows "No units registered yet"
The unit list is populated when the War-Room Dashboard loads in the browser. Start sequence:
1. Start the backend
2. Open `http://localhost:5173/regional` in a browser (registers the 50 routine units)
3. Then open the mobile app and log in

### Mobile app shows "Network request failed"
Check that the IP address in `mobile-app/config.js` matches your machine:
```js
export const API_BASE_URL = "http://192.168.x.x:8000";  // your LAN IP
```
The Android emulator reaches host localhost at `10.0.2.2`; a physical device needs the LAN IP.

## 🔑 Accounts

| Username | Password | Role | Notes |
|---|---|---|---|
| `police` | `police123` | fieldunit | Police unit mobile login |
| `ambulance` | `ambulance123` | fieldunit | Ambulance (EMS) mobile login |
| `fire` | `fire123` | fieldunit | Fire unit mobile login |
| `fieldunit1` | `test123` | fieldunit | Legacy test account |

These accounts are created automatically by `create_sample_data.py` (run at startup). The first three are linked to unit types and are used by the mobile app.

## 📋 What's Included

✅ **War-Room Regional Dashboard** — 18+ incidents, dispatch, map routing, SSE real-time

✅ **Field Incident Command Dashboard** — sector map, task groups, casualty tracker

✅ **Field Mobile App** — unit login, task list, field reports, offline sync, incident map

✅ **Dispatch → Mobile Sync** — dispatch a unit in the dashboard; task appears on the mobile app within 8 seconds

✅ **Push Notifications** — mobile units get alerted when dispatched to an incident

✅ **Offline Mode** — mobile reports saved to SQLite, synced when reconnected

## 📚 Documentation

- `ARCHITECTURE.md` — system architecture, data models, store shapes, API reference
- `IMPLEMENTATION.md` — data flows, design decisions, testing scenarios
- `frontend-web/MAPBOX_SETUP.md` — optional Mapbox routing setup

## 🎓 Learning Resources


## 💡 Pro Tips

### Demo Seed (Reproducible Data)
```bash
DEMO_SEED=42 python manage.py runserver
# Same data every time!
```

### Disable Auto-Simulation
```python
# In dashboard.py page, set:
# demo_mode: false
# Then incidents won't auto-generate
```

### Check API Endpoints
```bash
# Test incidents endpoint
curl http://localhost:8000/api/mock/incidents/ | json_pp

# Test units
curl http://localhost:8000/api/mock/units/ | json_pp

# Test events
curl http://localhost:8000/api/mock/events/?limit=5 | json_pp
```

### Monitor Live Events
```bash
# Watch SSE stream in terminal
curl -N http://localhost:8000/api/mock/updates/stream/
# You'll see real-time updates as JSON
```

## 🚀 Next Steps

After the demo, you can:

1. **Integrate Real Data**
   - Replace mock_data.py with real API queries
   - See IMPLEMENTATION.md for details

2. **Add Authentication**
   - Implement JWT tokens
   - Add role-based access control

3. **Deploy to Production**
   - Use Gunicorn + Nginx for backend
   - Use Docker for containerization
   - Set up proper SSL certificates

4. **Mobile Integration**
   - Use mobile app to receive incidents
   - Real-time dispatch coordination

## 📞 Support

Check the console (F12 in browser) for:

Backend logs in terminal will show:


**Dashboard MVP | Ready to Demo | Built with ❤️**

**Field access:**
- On the selector page, set **Field ID** and enable **Field Manager Access** to open the Field Incident Command Dashboard.
