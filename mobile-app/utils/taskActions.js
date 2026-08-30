import { API_BASE_URL } from "../config";
import { getAuthHeaders } from "./apiClient";

// "On My Way": the field unit accepts a dispatched task. Moves the task to
// IN_PROGRESS and advances the linked incident to EN_ROUTE, which is what makes
// the war-room map draw the road route from the unit to the incident and
// announce that the unit is en route.
//
// The incident PATCH is best-effort: the backend also advances the incident as
// a side effect of the task update (TaskViewSet.perform_update), and a 4xx just
// means another unit already moved it past PENDING.
export async function markOnMyWay(task, token, user) {
  if (!task?.id) return false;
  const headers = { "Content-Type": "application/json", ...getAuthHeaders(token, user) };

  let ok = false;
  try {
    const res = await fetch(`${API_BASE_URL}/api/tasks/${task.id}/`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ status: "IN_PROGRESS" }),
    });
    ok = res.ok;
  } catch (_) {
    ok = false;
  }

  // Advance the incident to EN_ROUTE only from a state that allows it — if
  // another unit already drove it to EN_ROUTE / ON_SCENE, this crew's own
  // journey is still tracked by its task + trip, and the incident PATCH would
  // just 400. (The backend also advances the incident as a side effect of the
  // task update above when it's still OPEN/PENDING.)
  const incidentAdvanceable =
    task.incident_status == null
    || ["OPEN", "PENDING"].includes(task.incident_status);
  if (task.incident != null && incidentAdvanceable) {
    try {
      await fetch(`${API_BASE_URL}/api/incidents/${task.incident}/`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ status: "EN_ROUTE" }),
      });
    } catch (_) {
      // non-fatal — see note above
    }
  }

  return ok;
}

// "Arrived": the crew reached the scene. Task stays IN_PROGRESS; the incident
// advances EN_ROUTE -> ON_SCENE, which stops the war-room route/movement and
// switches the report default to "In Progress".
export async function markArrived(task, token, user) {
  if (!task?.id) return false;
  const headers = { "Content-Type": "application/json", ...getAuthHeaders(token, user) };

  let ok = false;
  try {
    const res = await fetch(`${API_BASE_URL}/api/tasks/${task.id}/`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ status: "IN_PROGRESS" }),
    });
    ok = res.ok;
  } catch (_) {
    ok = false;
  }

  if (task.incident != null) {
    try {
      await fetch(`${API_BASE_URL}/api/incidents/${task.incident}/`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ status: "ON_SCENE" }),
      });
    } catch (_) {
      // non-fatal
    }
  }

  return ok;
}
