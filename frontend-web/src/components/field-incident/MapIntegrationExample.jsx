/**
 * אופציונלי: להוסיף מפה עם ניידות נעות לדף הראשי
 * 
 * אם תרצה להוסיף מפה לדשבורד הראשי (FieldIncidentDashboard), 
 * תוכל להוסיף את זה:
 */

// 1. ייבוא MapView
import MapView from '../../map/MapView.jsx';

// 2. שימוש בתוך הקומפוננט:
const FieldIncidentDashboard = () => {
    // ... קוד קיים ...

    const incidents = useFieldIncidentStore((s) => s.incidents);
    const units = useFieldIncidentStore((s) => s.units);

    return (
        <div className="dashboard">
            {/* ... קוד קיים ... */}

            {/* הוספת מפה לאזור שתרצה */}
            <section className="dashboard-section map-section">
                <div className="operations-card map-card">
                    <h3>Live Map</h3>
                    <MapView
                        incidents={incidents}
                        units={units}
                        includeUnits={true}
                    />
                </div>
            </section>

            {/* ... המשך הקוד ... */}
        </div>
    );
};

/**
 * או להחליף את SectorMap במפה אמיתית:
 */

// ב-FieldIncidentDashboard.jsx, במקום:
// <SectorMap />

// תוכל להשתמש ב:
<MapView
    incidents={incidents}
    units={units}
    includeUnits={true}
/>
