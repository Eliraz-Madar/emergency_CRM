export const getAuthHeaders = (token, user) => ({
  Authorization: `Bearer ${token}`,
  "X-User-ID": String(user?.id ?? ""),
  "X-User-Role": user?.role ?? "",
});
