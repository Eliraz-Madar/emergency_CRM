from rest_framework.permissions import BasePermission, SAFE_METHODS


class ReadOnlyOrAdminDispatcher(BasePermission):
    def has_permission(self, request, view):
        return True  # auth temporarily bypassed for MVP


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
