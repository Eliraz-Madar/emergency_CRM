/**
 * Shared unit proximity/availability helpers. Plain functions, no React
 * dependency — pure data transformation (filter + sort), not stateful or
 * lifecycle-bound, so a hook would add rules-of-hooks ceremony for no
 * benefit. Extracted from MapView.jsx's Dispatch Force modal, which had
 * this logic inlined; also used by the FieldCommand creation modal's unit
 * checklist (Dashboard.jsx).
 */

export function calculateDistanceKm(lat1, lon1, lat2, lon2) {
  if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) return Infinity;
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

/**
 * Returns units that are genuinely available (online, not already EN_ROUTE/
 * ON_SCENE, not already attached to a FieldCommand), optionally narrowed by
 * a caller-specific filterFn (e.g. agency type), sorted nearest-first to
 * `point`.
 *
 * `is_online` is checked here directly, not just relied on from the
 * caller's own pre-filtering — the Dispatch Force modal's existing caller
 * already only ever passed is_online-filtered units in (so this is a no-op
 * there), but a shared helper should be correct on its own for any future
 * caller that doesn't happen to pre-filter the same way.
 *
 * @param {Array} units - candidate units (real, DB-backed Unit shape)
 * @param {{lat: number, lng: number}} point - reference point to sort by
 * @param {(unit: object) => boolean} [filterFn] - optional extra inclusion filter
 */
export function getSortedAvailableUnits(units, point, filterFn) {
  if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return [];

  const pool = (Array.isArray(units) ? units : []).filter((unit) => {
    if (unit.is_online !== true) return false;
    // Already committed to an incident (dispatched / en route / on scene) —
    // not available for a new assignment.
    if (unit.assignedTo != null) return false;
    const status = (unit.status || '').toUpperCase();
    if (status === 'EN_ROUTE' || status === 'ON_SCENE' || status === 'ASSIGNED') return false;
    // Confirmed gap fix: a unit already attached to a FieldCommand should
    // not show up as available for a new dispatch/assignment. Checked as
    // `field_id`, not the raw model field name `field_command` — UnitSerializer
    // (backend/api/serializers.py) exposes this as
    // field_id = source="field_command.field_key", default=None; the raw
    // FK never reaches the frontend, so checking `unit.field_command` here
    // would silently never exclude anything against real API data.
    if (unit.field_id) return false;
    if (filterFn && !filterFn(unit)) return false;
    return true;
  });

  return pool
    .map((unit) => {
      const hasPosition = Array.isArray(unit.position) && unit.position.length >= 2;
      const uLat = hasPosition ? unit.position[0] : (unit.latitude ?? unit.location_lat);
      const uLng = hasPosition ? unit.position[1] : (unit.longitude ?? unit.location_lng);
      return {
        ...unit,
        distanceKm: calculateDistanceKm(point.lat, point.lng, uLat, uLng),
      };
    })
    .sort((a, b) => a.distanceKm - b.distanceKm);
}
