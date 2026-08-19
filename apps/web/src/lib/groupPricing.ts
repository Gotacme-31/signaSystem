export type PricingGroupMeta = {
  id: number;
  name: string;
  unitType: "METER" | "PIECE";
  isActive: boolean;
};

type CatalogGroupRow = {
  productId: number;
  product: {
    pricingGroup?: PricingGroupMeta | null;
  };
};

type GroupableItem = {
  productId: number;
  quantity: number;
  isCustomProduct?: boolean;
};

type RepricePlanItem = {
  id: number;
  pricingGroupId: number | null;
  appliedPricingGroupId?: number | null;
};

export function buildPricingGroupRepricePlan(args: {
  beforeItems: readonly RepricePlanItem[];
  afterItems: readonly RepricePlanItem[];
  directlyChangedItemIds: ReadonlySet<number>;
}) {
  const beforeById = new Map(args.beforeItems.map((item) => [item.id, item]));
  const affectedGroupIds = new Set<number>();

  for (const itemId of args.directlyChangedItemIds) {
    const before = beforeById.get(itemId);
    const after = args.afterItems.find((item) => item.id === itemId);
    if (before?.pricingGroupId) affectedGroupIds.add(before.pricingGroupId);
    if (before?.appliedPricingGroupId) affectedGroupIds.add(before.appliedPricingGroupId);
    if (after?.pricingGroupId) affectedGroupIds.add(after.pricingGroupId);
  }

  const repricedItemIds = new Set(args.directlyChangedItemIds);
  for (const after of args.afterItems) {
    const before = beforeById.get(after.id);
    if (
      (after.pricingGroupId && affectedGroupIds.has(after.pricingGroupId)) ||
      (before?.appliedPricingGroupId && affectedGroupIds.has(before.appliedPricingGroupId))
    ) {
      repricedItemIds.add(after.id);
    }
  }

  return { affectedGroupIds, repricedItemIds };
}

export function buildGroupQuantities(
  items: readonly GroupableItem[],
  catalog: readonly CatalogGroupRow[]
) {
  const groupByProductId = new Map(
    catalog.map((row) => [row.productId, row.product.pricingGroup ?? null])
  );
  const quantities = new Map<number, number>();

  for (const item of items) {
    const group = groupByProductId.get(item.productId);
    if (item.isCustomProduct || !group?.isActive) continue;
    quantities.set(group.id, (quantities.get(group.id) ?? 0) + Number(item.quantity || 0));
  }

  return quantities;
}

export function groupPricingForItem(
  item: GroupableItem,
  catalog: readonly CatalogGroupRow[],
  groupQuantities: ReadonlyMap<number, number>
) {
  const row = catalog.find((candidate) => candidate.productId === item.productId);
  const group = row?.product.pricingGroup;

  if (item.isCustomProduct || !group?.isActive) {
    return { group: null, pricingQuantity: Number(item.quantity || 0), groupQuantity: null };
  }

  const groupQuantity = groupQuantities.get(group.id) ?? Number(item.quantity || 0);
  return { group, pricingQuantity: groupQuantity, groupQuantity };
}

export function highestApplicableTier<T extends { minQty: number }>(
  tiers: readonly T[],
  pricingQuantity: number
) {
  return tiers
    .filter((tier) => pricingQuantity >= tier.minQty)
    .sort((left, right) => right.minQty - left.minQty)[0] ?? null;
}
