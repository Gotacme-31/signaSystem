const COMMERCIAL_ORDER_ROLES = new Set(["ADMIN", "STAFF", "COUNTER", "MULTI_COUNTER"]);

export function canMutateCommercialOrders(role: string) {
  return COMMERCIAL_ORDER_ROLES.has(role);
}
