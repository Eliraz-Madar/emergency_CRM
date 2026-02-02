# Routing Provider Notes (Current)

## מצב נוכחי
המערכת משתמשת ב-OSRM ציבורי לקבלת מסלולים:
`https://router.project-osrm.org`

הקריאות כוללות cache ו-backoff כדי לצמצם 429/timeouts, אבל השירות הציבורי עלול להיות לא יציב.

## תקלות נפוצות
- `429 Too Many Requests` → האטה אוטומטית וחזרה מאוחרת.
- `net::ERR_CONNECTION_TIMED_OUT` → השירות לא זמין מהרשת שלך; נסה שוב מאוחר יותר.

## אפשרות עתידית: Mapbox (TODO)
כרגע Mapbox **לא משולב** בקוד. אם נרצה יציבות גבוהה:
1. נחליף את `routingService.js` לספק Mapbox Directions/Nearest.
2. נוסיף `VITE_MAPBOX_TOKEN` ב־.env.

## הערה
אם נדרש יציבות מלאה בסביבה ארגונית, עדיף להקים OSRM פרטי.
