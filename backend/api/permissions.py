from rest_framework.permissions import BasePermission, SAFE_METHODS


class ReadOnlyOrAdminDispatcher(BasePermission):
    def has_permission(self, request, view):
        return True  # auth temporarily bypassed for MVP


# No login is enforced for the regional/field-command dashboard (see
# final changes notes) — the dashboard is never an authenticated
# request.user. Rather than gate writes behind a login flow, the client
# declares who it's acting as via this header, and it's trusted (there's no
# auth boundary to check it against yet). Only used as a fallback when
# request.user has no real role, so an authenticated caller (e.g. the mobile
# app, which does log in) always wins on its actual role.
ACTOR_ROLE_HEADER = "HTTP_X_ACTOR_ROLE"
_ACTOR_ROLE_TO_USER_ROLE = {
    "COMMAND_CENTER": "dispatcher",
    "UNIT": "fieldunit",
    # Alias for "UNIT" used by the MajorIncident/Perimeter/Sector endpoints,
    # which speak FieldCommand.ClosedByRole's vocabulary (FIELD_OPERATOR/
    # COMMAND_CENTER) rather than Incident.ClosedBy's (UNIT/COMMAND_CENTER).
    # Both resolve to the same underlying "fieldunit" User.Roles value.
    "FIELD_OPERATOR": "fieldunit",
}


def effective_role(request):
    """Resolve the acting role for a request: real authenticated role first,
    else whatever the client declared via X-Actor-Role."""
    role = getattr(getattr(request, "user", None), "role", "") or ""
    if role:
        return role
    declared = request.META.get(ACTOR_ROLE_HEADER, "")
    return _ACTOR_ROLE_TO_USER_ROLE.get(declared, "")


class TaskPermission(BasePermission):
    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False
        if request.method in SAFE_METHODS:
            return True
        if request.method == "PATCH":
            return True
        return getattr(request.user, "role", "") in {"admin", "dispatcher"}

    def has_object_permission(self, request, view, obj):
        if request.method in SAFE_METHODS:
            return True
        user_role = getattr(request.user, "role", "")
        if request.method == "PATCH":
            return user_role in {"admin", "dispatcher", "fieldunit"}
        return user_role in {"admin", "dispatcher"}
