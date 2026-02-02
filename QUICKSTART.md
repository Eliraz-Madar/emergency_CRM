# Quick Start Guide - Field War-Room Dashboard

## 🚀 Get Running in 2 Minutes

### Windows Users

**Option 1: Automatic (Recommended)**
```cmd
cd final_code
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
cd final_code
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

✅ **Professional UI**

✅ **Real-Time Features**

✅ **Production-Ready Code**

## 📚 Documentation


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

**Field access (stub):**
- On the selector page, set **Field ID** and enable **Field Manager Access**.
## 🚀 Next Steps
