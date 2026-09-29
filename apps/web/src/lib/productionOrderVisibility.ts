type ProductionVisibilityOrderItem = {
  product?: { id?: number | null } | null;
  steps?: unknown;
};

type ProductionVisibilityOrder = {
  items?: ProductionVisibilityOrderItem[] | null;
};

type ProductionVisibilityUser = {
  role?: string;
  allowedProductIds?: number[] | null;
};

export function isOrderVisibleForProductionUser(
  order: ProductionVisibilityOrder | null | undefined,
  user: ProductionVisibilityUser | null | undefined
): boolean {
  if (!user || user.role !== "PRODUCTION") return true;
  if (!user.allowedProductIds || user.allowedProductIds.length === 0) return true;

  const items = Array.isArray(order?.items) ? (order!.items as ProductionVisibilityOrderItem[]) : null;
  if (!items) return false;

  const looksIncomplete = items.some((item) => !item?.product || !item?.steps);
  if (looksIncomplete) return false;

  const allowed = new Set(user.allowedProductIds);
  return items.some((item) => item.product?.id != null && allowed.has(item.product.id));
}
