# Deployment & Verification Checklist

## Pre-Deployment Checks

### Backend Setup
- [ ] Python 3.9+ installed: `python --version`
- [ ] All dependencies in requirements.txt: `pip install -r requirements.txt`
- [ ] Django migrations applied: `python manage.py migrate`
- [ ] Mock data service initializes without errors
- [ ] Backend starts: `python manage.py runserver` (should see "Starting development server")

### Frontend Setup
- [ ] Node.js 16+ installed: `node --version`
- [ ] npm installed: `npm --version`
- [ ] All dependencies installed: `npm install`
- [ ] Frontend builds without errors: `npm run build`
- [ ] Frontend starts: `npm run dev` (should see "VITE ready in XXXms")

## API Endpoint Verification

Test all endpoints are accessible:

```bash
# Get incidents
curl http://localhost:8000/api/mock/incidents/ | head -20

# Get units
curl http://localhost:8000/api/mock/units/ | head -20

# Get events
curl http://localhost:8000/api/mock/events/ | head -20

# Test status update
curl -X PATCH http://localhost:8000/api/mock/incidents/1/status/ \
  -H "Content-Type: application/json" \
  -d '{"status":"IN_PROGRESS"}'

# Test SSE stream (Ctrl+C to exit)
curl -N http://localhost:8000/api/mock/updates/stream/
```

Expected results:
- [ ] All endpoints return 200 OK
- [ ] Response body is valid JSON
- [ ] SSE stream shows heartbeat messages every 10 seconds

## Frontend Verification

### Initial Load
1. [ ] Open `http://localhost:5173` in browser
2. [ ] Dashboard loads without errors
3. [ ] Check browser console (F12) - no errors/warnings
4. [ ] Page title shows correct

### Data Display
1. [ ] KPI cards show numbers (≥0):
   - [ ] Total Incidents: ~8
   - [ ] Active Incidents: ~5
   - [ ] Critical: ~1
   - [ ] Available Units: ~4-5
2. [ ] Incident list shows incidents with colors
3. [ ] Map displays Tel Aviv area with markers
4. [ ] Event log shows events
5. [ ] Top bar shows "🟢 LIVE" status

### Interaction Testing

**Filtering & Sorting**
1. [ ] Click "Filters" - advanced filters appear
2. [ ] Click severity chip - list filters
3. [ ] Click status chip - list filters
4. [ ] Click channel chip - list filters
5. [ ] Search text - list filters in real-time
6. [ ] Sort dropdown changes sort order

**Incident Selection**
1. [ ] Click incident in list - highlights and details panel opens
2. [ ] Click incident on map - highlights and details open
3. [ ] Details show correct incident info
4. [ ] Click different incident - panel updates

**Actions**
1. [ ] Change status button - incident status updates, event log updates
2. [ ] Change severity button - incident severity updates, event log updates
3. [ ] Assign unit button - unit appears in assigned list
4. [ ] Add note button - prompt appears (cancel/submit)
5. [ ] Toast notification appears for actions

**Map Interactions**
1. [ ] Zoom in/out works
2. [ ] Pan works
3. [ ] Click marker - popup appears with info
4. [ ] Click incident marker - details panel opens
5. [ ] Map legend visible and correct

**Real-Time Updates**
1. [ ] Watch for new incidents appearing automatically
2. [ ] Watch for unit location changes on map
3. [ ] Watch for new events in event log
4. [ ] KPI numbers increase as incidents appear

### Events Tab
1. [ ] Click "📋 Events" button in top right
2. [ ] Event feed displays
3. [ ] Click again - toggles back to details panel
4. [ ] Events show recent activity
5. [ ] Each event shows timestamp, entity type, message

### Connection Status
1. [ ] Top right shows "🟢 LIVE" (green)
2. [ ] "DEMO MODE" badge visible
3. [ ] Timestamp shows "Last update: HH:MM:SS"

## Performance Checks

- [ ] Page loads in < 3 seconds
- [ ] Scrolling incident list is smooth
- [ ] Map panning/zooming is responsive
- [ ] No lag when clicking incidents
- [ ] Real-time updates appear instantly
- [ ] No memory leaks (console clean after 10 min)

## Browser Compatibility

Test on these browsers:
- [ ] Chrome/Chromium latest
- [ ] Firefox latest
- [ ] Safari latest (if on Mac)
- [ ] Edge latest

All should show:
- [ ] Dashboard loads
- [ ] No console errors
- [ ] All features work
- [ ] Real-time updates work

## Responsive Design

Test screen sizes:
- [ ] 1920x1080 (Full HD)
- [ ] 1366x768 (Minimum)
- [ ] 1024x768 (Tablets)
- [ ] Layout adapts appropriately

## Error Scenarios

### Disconnect Backend
1. [ ] Stop backend (Ctrl+C)
2. [ ] Wait 5 seconds
3. [ ] Status changes to "🔴 OFFLINE"
4. [ ] Polling fallback activates
5. [ ] Restart backend
6. [ ] Auto-reconnects within 10 seconds

### Network Latency
1. [ ] Simulate slow network (Browser DevTools → Network Throttling)
2. [ ] Set to "Slow 3G"
3. [ ] Dashboard still loads and works
4. [ ] Real-time updates still arrive (delayed)

### Missing Incident Data
1. [ ] Search for non-existent incident: "xyzabc"
2. [ ] List shows "No incidents matching your filters"
3. [ ] Empty state message appears

## Documentation Verification

- [ ] README.md exists and readable
- [ ] QUICKSTART.md exists and accurate
- [ ] IMPLEMENTATION.md exists and detailed
- [ ] COMPLETED.md exists with summary
- [ ] run_dashboard.bat exists and works (Windows)
- [ ] run_dashboard.sh exists and works (Mac/Linux)

## Final Smoke Tests

**5-Minute Quick Test:**
1. [ ] Run `run_dashboard.bat` (or `.sh`)
2. [ ] Wait for both services to start
3. [ ] Open browser → `http://localhost:5173`
4. [ ] Wait for dashboard to load
5. [ ] Verify 8 incidents visible
6. [ ] Click incident → details open
7. [ ] Change status → updates instantly
8. [ ] Watch new incident appear automatically
9. [ ] Check event log → shows activity
10. [ ] All working ✅

**2-Minute Feature Demo:**
1. [ ] Point to KPI cards (metrics)
2. [ ] Search incident (filtering)
3. [ ] Click map marker (interaction)
4. [ ] Change incident status (workflow)
5. [ ] Assign unit (action)
6. [ ] Show event log (real-time)
7. [ ] Point to connection status (live)

## Known Limitations

⚠️ **Not Included (Out of Scope for MVP):**
- No authentication/login
- No real database
- No mobile app integration
- No email/SMS notifications
- No export/reporting
- No video integration
- No offline mode

✅ **Fully Functional:**
- Dashboard UI and all features
- Real-time mock data
- All filters and searches
- Map visualization
- Incident management workflow
- Event logging

## Troubleshooting Quick Reference

| Problem | Solution |
|---------|----------|
| Port 8000 in use | `lsof -i :8000` then kill process, or use `python manage.py runserver 8001` |
| Port 5173 in use | Vite will try 5174, 5175, etc. Check terminal output |
| Backend won't start | Check Python version, pip install dependencies |
| Frontend won't connect | Check backend is running, verify VITE_API_URL |
| No real-time updates | Check browser console, try refreshing page, ensure SSE supported |
| Missing dependencies | Run `pip install -r requirements.txt` and `npm install` |
| Wrong API URL | Set `VITE_API_URL=http://localhost:8000/api` environment variable |

## Sign-Off

- [ ] All checks passed
- [ ] Dashboard ready for demo
- [ ] Code is clean and documented
- [ ] No console errors
- [ ] All features working
- [ ] Real-time updates verified
- [ ] Run scripts tested
- [ ] Documentation complete

**Ready for Demo:** ✅

---

**Verification Date:** ___________
**Verified By:** ___________
**Status:** APPROVED FOR DEMO
