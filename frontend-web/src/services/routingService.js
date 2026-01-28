/**
 * Routing Service
 * Provides vehicle routing along roads using OSRM (Open Source Routing Machine)
 * Free, no API key required, CORS enabled
 */

// OSRM Public API - Free, no auth required, CORS enabled
const OSRM_BASE_URL = 'https://router.project-osrm.org/route/v1/driving';

// Cache for routes to avoid excessive API calls
const routeCache = new Map();

/**
 * Calculate route between two points using road network
 * @param {number} fromLat - Starting latitude
 * @param {number} fromLng - Starting longitude
 * @param {number} toLat - Destination latitude
 * @param {number} toLng - Destination longitude
 * @returns {Promise<Array>} Array of [lat, lng] coordinates along the route
 */
export async function calculateRoute(fromLat, fromLng, toLat, toLng) {
    console.log(`🗺️ Calculating route from [${fromLat}, ${fromLng}] to [${toLat}, ${toLng}]`);

    // Create cache key
    const cacheKey = `${fromLat.toFixed(4)},${fromLng.toFixed(4)}-${toLat.toFixed(4)},${toLng.toFixed(4)}`;

    // Check cache first
    if (routeCache.has(cacheKey)) {
        console.log('✅ Route found in cache');
        return routeCache.get(cacheKey);
    }

    try {
        console.log('📡 Fetching route from OSRM API...');
        // OSRM expects: /route/v1/{profile}/{lon1},{lat1};{lon2},{lat2}
        const url = `${OSRM_BASE_URL}/${fromLng},${fromLat};${toLng},${toLat}?steps=false&geometries=geojson&overview=full`;

        const response = await fetch(url);

        if (!response.ok) {
            console.warn(`⚠️ OSRM API error: ${response.status}. Falling back to straight line.`);
            return fallbackStraightLine(fromLat, fromLng, toLat, toLng);
        }

        const data = await response.json();

        if (!data.routes || data.routes.length === 0) {
            console.warn('⚠️ No route found. Falling back to straight line.');
            return fallbackStraightLine(fromLat, fromLng, toLat, toLng);
        }

        console.log('✅ Route received from OSRM:', data.routes[0].geometry.coordinates.length, 'points');

        // Extract coordinates from GeoJSON format
        // OSRM returns coordinates as [lng, lat], we need [lat, lng]
        const coordinates = data.routes[0].geometry.coordinates.map(coord => [coord[1], coord[0]]);

        // Cache the result
        routeCache.set(cacheKey, coordinates);

        // Limit cache size to prevent memory issues
        if (routeCache.size > 100) {
            const firstKey = routeCache.keys().next().value;
            routeCache.delete(firstKey);
        }

        return coordinates;

    } catch (error) {
        console.warn('OSRM routing error:', error.message, '- Using straight line');
        return fallbackStraightLine(fromLat, fromLng, toLat, toLng);
    }
}

/**
 * Fallback method: create a straight line route when API is unavailable
 * @returns {Array} Simple two-point route
 */
function fallbackStraightLine(fromLat, fromLng, toLat, toLng) {
    // Create a simple straight line with intermediate points for smoother animation
    const steps = 20;
    const route = [];

    for (let i = 0; i <= steps; i++) {
        const ratio = i / steps;
        const lat = fromLat + (toLat - fromLat) * ratio;
        const lng = fromLng + (toLng - fromLng) * ratio;
        route.push([lat, lng]);
    }

    return route;
}

/**
 * Get the next position along a route
 * @param {Array} route - Array of [lat, lng] coordinates
 * @param {number} currentLat - Current latitude
 * @param {number} currentLng - Current longitude
 * @param {number} currentIndex - Current position index in route (hint for optimization)
 * @param {number} speed - Movement speed (degrees per tick)
 * @returns {Object} { lat, lng, index, arrived }
 */
export function getNextPositionOnRoute(route, currentLat, currentLng, currentIndex = 0, speed = 0.001) {
    if (!route || !Array.isArray(route) || route.length === 0) {
        console.warn('❌ Invalid route provided');
        return { lat: null, lng: null, index: 0, arrived: true };
    }

    if (!Number.isFinite(currentLat) || !Number.isFinite(currentLng)) {
        console.warn('❌ Invalid current position');
        return { lat: null, lng: null, index: 0, arrived: true };
    }

    // Ensure currentIndex is valid
    let targetIndex = Math.max(0, Math.min(currentIndex, route.length - 1));

    // Get the target waypoint we're heading towards
    const targetPoint = route[targetIndex];
    const targetLat = targetPoint[0];
    const targetLng = targetPoint[1];

    console.log(`🎯 Current: [${currentLat.toFixed(6)}, ${currentLng.toFixed(6)}], Target [${targetIndex}]: [${targetLat.toFixed(6)}, ${targetLng.toFixed(6)}]`);

    // Calculate distance to current target waypoint
    const dLat = targetLat - currentLat;
    const dLng = targetLng - currentLng;
    const distanceToTarget = Math.sqrt(dLat * dLat + dLng * dLng);

    console.log(`📏 Distance to waypoint ${targetIndex}: ${distanceToTarget.toFixed(6)}, speed threshold: ${(speed * 1.5).toFixed(6)}`);

    // Check if we've reached this waypoint
    if (distanceToTarget < speed * 1.5) {
        console.log(`✅ Reached waypoint ${targetIndex}, moving to next`);
        // Move to next waypoint
        targetIndex++;

        // Check if we've completed the route
        if (targetIndex >= route.length) {
            console.log(`🏁 Route completed!`);
            return {
                lat: targetLat,
                lng: targetLng,
                index: route.length - 1,
                arrived: true
            };
        }

        // Target the next waypoint
        const nextPoint = route[targetIndex];
        const nextLat = nextPoint[0];
        const nextLng = nextPoint[1];

        const dLat2 = nextLat - currentLat;
        const dLng2 = nextLng - currentLng;
        const dist2 = Math.sqrt(dLat2 * dLat2 + dLng2 * dLng2);

        // Move towards next waypoint
        const ratio2 = Math.min(speed / dist2, 1.0);

        const newLat = currentLat + dLat2 * ratio2;
        const newLng = currentLng + dLng2 * ratio2;
        console.log(`➡️ Moving to next waypoint ${targetIndex}: [${newLat.toFixed(6)}, ${newLng.toFixed(6)}]`);

        return {
            lat: newLat,
            lng: newLng,
            index: targetIndex,
            arrived: false
        };
    }

    // Move towards current target waypoint at constant speed
    const ratio = Math.min(speed / distanceToTarget, 1.0);
    const nextLat = currentLat + dLat * ratio;
    const nextLng = currentLng + dLng * ratio;

    console.log(`🚗 Moving towards waypoint ${targetIndex}: [${nextLat.toFixed(6)}, ${nextLng.toFixed(6)}], ratio: ${ratio.toFixed(4)}`);

    return {
        lat: nextLat,
        lng: nextLng,
        index: targetIndex,
        arrived: false
    };
}

/**
 * Clear the route cache (useful for testing or memory management)
 */
export function clearRouteCache() {
    routeCache.clear();
}
