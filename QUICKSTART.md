# Quick Start Guide - Field War-Room Dashboard

## 🚀 Get Running in 2 Minutes

### Windows Users

**Option 1: Automatic (Recommended)**
```cmd
cd emergency_CRM
run_dashboard.bat
```

**Option 2: Manual**
```cmd
# Terminal 1 - Backend
cd backend
pip install -r requirements.txt
python manage.py runserver

# Terminal 2 - Frontend (new window)
cd frontend-web
npm install
npm run dev
```

Then open browser → `http://localhost:5173`

### Mac/Linux Users

```bash
cd emergency_CRM
chmod +x run_dashboard.sh
./run_dashboard.sh
```

Or manual:
```bash
# Terminal 1
cd backend
pip3 install -r requirements.txt
python3 manage.py runserver

# Terminal 2
cd frontend-web
npm install
npm run dev
```

## ✅ You Should See

- [ ] Backend log: `Starting development server at http://0.0.0.0:8000/`
- [ ] Frontend log: `VITE v5.0.2  ready in XXXms`
- [ ] Browser opens: Dashboard with 8 incidents, 12 units
- [ ] Map shows markers with colors
- [ ] Event log shows activity
- [ ] Status badge shows 🟢 LIVE

## 🎮 Try These Actions (30 seconds)

1. **Click an incident** in the left list
   - Details panel opens on the right
   
2. **Click the incident on the map**
   - Highlights the incident
   
3. **Change incident status**
   - Click "OPEN" → "IN_PROGRESS"
   - Notice event log updates
   
4. **Assign a unit**
   - Click "Assign Available Unit"
   - Unit now shows in assigned list
   
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

## 📋 What's Included

✅ **Mock Data Service**
- 8 realistic incidents
- 12 units (Ambulance, Police, Fire, Rescue)
- Continuous event generation
- Real-time updates

✅ **Professional UI**
- KPI dashboard cards
- Filterable incident list
- Interactive Leaflet map
- Incident details panel
- Live event feed
- Connection status indicator

✅ **Real-Time Features**
- Server-Sent Events (SSE) stream
- Auto-reconnection
- Fallback to polling
- Live incident/unit updates

✅ **Production-Ready Code**
- Clean architecture
- Modular components
- Documented code
- Error handling
- Loading states

## 📚 Documentation

- **README.md** - Full feature documentation
- **IMPLEMENTATION.md** - Architecture & technical details
- **This file** - Quick start guide

## 🎓 Learning Resources

- **Frontend**: React + Zustand + Leaflet
- **Backend**: Django + DRF + Server-Sent Events
- **Real-time**: EventSource API (no external WebSocket library)
- **Styling**: CSS Grid + CSS Variables

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
- API request/response logs
- Real-time connection status
- Error messages and stack traces

Backend logs in terminal will show:
- Django request logs
- Mock data generation events
- SSE connection/disconnection

---

**Dashboard MVP | Ready to Demo | Built with ❤️**
