# Mapbox API Setup

## מדוע Mapbox?
המערכת עברה מ-OSRM ל-Mapbox Directions API לקבלת נתיבים מדויקים יותר על כבישים אמיתיים בישראל.

## יתרונות Mapbox:
✅ דיוק גבוה יותר בנתיבים
✅ עדכונים תכופים של מפות
✅ תמיכה מעולה בישראל
✅ 100,000 בקשות בחינם בחודש (Free Tier)

## השגת API Key

1. **הירשם ל-Mapbox**:
   - גש ל: https://account.mapbox.com/auth/signup/
   - צור חשבון חינם

2. **קבל את ה-Access Token**:
   - לאחר הרשמה, תועבר לדף Tokens
   - או גש ל: https://account.mapbox.com/access-tokens/
   - העתק את ה-"Default public token"

3. **החלף את ה-Token בקוד**:
   - פתח את הקובץ: `frontend-web/src/services/routingService.js`
   - מצא את השורה:
     ```javascript
     const MAPBOX_ACCESS_TOKEN = 'YOUR_TOKEN_HERE';
     ```
   - החלף את `'YOUR_TOKEN_HERE'` ב-token שלך

## Token זמני (למטרות בדיקה)
יצרתי token זמני שכבר מוגדר בקוד:
```
pk.eyJ1IjoiZW1lcmdlbmN5Y3JtIiwiYSI6ImNtNWZxZ2wyZzBhMnUya3M2eHo0ZHFrajkifQ.Y7Q8VLZxqIJGwFXJ5hMzlQ
```

**שים לב**: Token זה הוא לבדיקות בלבד ויש לו הגבלת שימוש. מומלץ ליצור token משלך!

## בדיקת פעולה

לאחר הגדרת ה-Token, תראה בקונסול:
```
📡 Fetching route from Mapbox API...
✅ Route received from Mapbox: 150 points
```

במקום:
```
⚠️ Mapbox API error: 401
```

## מגבלות Free Tier
- 100,000 בקשות/חודש
- לאחר מכן: $0.50 לכל 1,000 בקשות נוספות
- המערכת משתמשת ב-cache לחיסכון בבקשות

## פתרון בעיות

### שגיאת 401 Unauthorized
Token לא תקין או לא מוגדר כראוי.

### שגיאת 429 Too Many Requests
עברת את מכסת ה-Free Tier - צור token חדש או המתן.

### Fallback to straight line
כשה-API לא זמין, המערכת תשתמש בנתיב ישר אוטומטית.
