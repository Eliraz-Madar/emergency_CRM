# עדכון: תנועת ניידות על כבישים

## מה השתנה? (עדכון 2)

### תיקונים חדשים:

1. **סנכרון אירועים בין דאשבורדים** 🔄
   - כל אירוע שנוצר ב-Dashboard (War-Room) עכשיו מסונכרן אוטומטית לـ fieldIncident store
   - זה מאפשר ל-dispatchUnitsToIncident למצוא את האירוע!
   - **זהו תיקון קריטי** - זה היה הסיבה ל-"Target incident not found"

2. **מהירות ניידות מתוקננת** 🚗
   - שינינו את speed factor מ-0.002 ל-0.0005 
   - זה מסתכם ל-~50 מטר לשנייה (הגיוני לניידות חירום)
   - קודם היו ניידות שנעות מהר מדי

3. **לוגים משופרים** 📝
   - MapView עכשיו מודיע כאשר מציירת מסלול
   - אתה יכול לראות בדיוק אילו ניידות יש מסלולים ואילו לא

### תרחיש עדכון - איך זה אמור לעבוד:

1. **בדאשבורד**: אירוע נוצר עם ID "7"
2. **סנכרון**: האירוע מועתק ל-fieldIncident store
3. **קליק Dispatch**: נשלחת קריאה ל-dispatchUnitsToIncident עם incident ID "7"
4. **חיפוש אירוע**: store מוצא את אירוע 7 בחיפוש ש-SYNC סיפק
5. **חישוב מסלול**: ה-API מחזיר מסלול של נקודות
6. **תנועה**: `moveUnits()` מזיז את הניידות לאורך המסלול

### פקודות מהקונסול שתראה:

```
💾 Syncing 5 incidents to fieldIncident store
🚨 Dispatching from IncidentDetailsPanel: ["routine-1"] to 7
🚨 Dispatching units: ["routine-1"] to incident: 7
🎯 Target location: 32.0853 34.7818
🚗 Unit routine-1 starting from: 31.9730 34.7925
🗺️ Calculating route from [31.9730, 34.7925] to [32.0853, 34.7818]
📡 Fetching route from OpenRouteService API...
✅ Route received from API: 145 points
✅ Route calculated for unit routine-1: 145 waypoints
✅ All routes calculated: 1
✅ Dispatch completed
📍 Drawing route for unit routine-1: 145 waypoints
🚗 Moved 1 units this tick
```

## תשובה ל-EDGE3:

**לא צריך!** OpenRouteService עובד בצורה מושלמת כל עוד:
- יש קישור אינטרנט
- ה-API key תקין
- יש בקשות זמינות (40 לדקה / 2000 ביום)

אם אתה רוצה יותר בקשות, פשוט יצור חשבון ב-OpenRouteService וקבל API key משלך בחינם.

## בדיקה טוב:

1. פתח את F12 (Developer Console)
2. לך ל-War-Room Dashboard
3. בחר אירוע כלשהו
4. בחר ניידה אחת או יותר
5. לחץ "Dispatch"
6. צפה בקונסול לפקודות הלוג
7. צפה בניידה נעה על המפה עם קו מקווקו!

---
**אם עדיין יש בעיות:**
- בדוק בקונסול עבור הודעות שגיאה
- תמונת העיתוד שלך הראתה "Target incident not found" - זה תיקן עכשיו
- אם הניידה עדיין לא נעה, בדוק שה-moveUnits רץ (אמור להדפיס "🚗 Moved X units this tick")

