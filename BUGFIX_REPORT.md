# Unit Assignment Correlation Fix Report

## Summary
A critical mismatch was causing ambulance/medical units to be interpreted as a different department during dispatch from the mobile app to the regional dashboard. That could lead to the wrong unit type being selected for a mission in a life-safety scenario.

## Root Cause
The system used inconsistent unit-type naming across three layers:
- Mobile app login/unit selection used values such as `EMS` and `Ambulance`.
- The web dashboard and simulation store used `MEDICAL`, `FIRE`, and `POLICE`.
- The backend bridge was not normalizing incoming unit types before registering or dispatching units.

Because of that mismatch, a medical unit could be registered or dispatched under a different department classification than intended.

## Fix Implemented
- Added a shared unit-type normalization function in the backend to canonicalize aliases such as `Ambulance`, `EMS`, `Fire`, `Fire Truck`, and `Police` into the safe operational categories `POLICE`, `FIRE`, and `MEDICAL`.
- Applied the canonical normalization when registering routine units, filtering mobile unit lists, and creating dispatch tasks.
- Updated the web dashboard store to use the same canonical type mapping for simulation and routine units.
- Updated the mobile unit selection flow to align with the same medical/ambulance terminology used by the backend and web dashboard.
- Added regression tests covering the medical, fire, and police aliases.

## Files Updated
- backend/api/views.py
- backend/api/tests.py
- frontend-web/src/store/fieldIncident.js
- mobile-app/screens/UnitSelectScreen.js

## Verification
Verified with fresh runs:
- Backend regression tests: `python manage.py test api.tests` → 3 tests passed
- Frontend build: `npm run build` → Vite production build completed successfully

## Impact
This ensures that when a user selects an ambulance/medical unit in the mobile app, the same unit is treated as a medical unit throughout the dispatch chain and will not be incorrectly exposed as a fire or other department unit on the regional dashboard.
