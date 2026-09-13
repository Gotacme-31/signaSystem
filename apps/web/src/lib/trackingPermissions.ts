const TRACKING_COPY_ROLES = new Set(["ADMIN", "STAFF", "COUNTER", "MULTI_COUNTER"]);

export function canCopyTracking(role: string | null | undefined) {
  return role ? TRACKING_COPY_ROLES.has(role) : false;
}

export function canRegenerateTracking(role: string | null | undefined) {
  return role === "ADMIN";
}
