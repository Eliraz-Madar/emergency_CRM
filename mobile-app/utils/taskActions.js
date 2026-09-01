import { API_BASE_URL } from "../config";
import { getAuthHeaders } from "./apiClient";

// "On My Way": the field unit accepts a dispatched task. A single PATCH moves
// the task to IN_PROGRESS; the backend (TaskViewSet.perform_update) advances
// the linked incident to EN_ROUTE as a side effect and logs one "en route"
// line, which is what makes the war-room draw the road route and announce it.
//
// We deliberately do NOT also PATCH /api/incidents/<id>/ here. That second call
// was redundant — the task update already advances the incident — and racing
// it against the task update could make IncidentViewSet.perform_update log a
// duplicate "Incident status changed: PENDING -> EN_ROUTE" record on top of
// the task's own "en route" line.
export async function markOnMyWay(task, token, user) {
  if (!task?.id) return false;
  const headers = { "Content-Type": "application/json", ...getAuthHeaders(token, user) };

  try {
    const res = await fetch(`${API_BASE_URL}/api/tasks/${task.id}/`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ status: "IN_PROGRESS" }),
    });
    return res.ok;
  } catch (_) {
    return false;
  }
}

// "Arrived": the crew CONFIRMS it has physically reached the scene. This is the
// single signal the dashboards use to show the vehicle "on scene / starting
// operations" and to play the arrival announcement — the war-room's trip
// animation never decides this on its own. The backend (POST /tasks/<id>/arrive/)
// stamps task.arrived_at, advances the incident to ON_SCENE and logs the
// field-command timeline entry, all in one call.
export async function markArrived(task, token, user) {
  if (!task?.id) return false;
  const headers = { "Content-Type": "application/json", ...getAuthHeaders(token, user) };
  try {
    const res = await fetch(`${API_BASE_URL}/api/tasks/${task.id}/arrive/`, {
      method: "POST",
      headers,
      body: JSON.stringify({}),
    });
    return res.ok;
  } catch (_) {
    return false;
  }
}
