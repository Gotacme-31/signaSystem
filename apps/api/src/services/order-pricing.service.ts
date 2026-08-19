import { Prisma } from "@prisma/client";

export type PricingItemInput = {
  productId: number;
  quantity: Prisma.Decimal;
  isCustomProduct?: boolean;
  pricingGroup?: {
    id: number;
    name: string;
    isActive: boolean;
  } | null;
};

export type PricingGroupMemberCandidate = {
  id: number;
  name: string;
  unitType: "METER" | "PIECE";
  isCustomProductTemplate: boolean;
  pricingGroupId: number | null;
};

export function validateVariantSelection(args: {
  productName: string;
  needsVariant: boolean;
  variants: readonly { id: number; isActive: boolean }[];
  variantId: number | null;
  requireActive: boolean;
}) {
  if (args.variantId === null) {
    if (args.needsVariant) {
      throw new Error(`El producto "${args.productName}" requiere seleccionar un tamaño`);
    }
    return null;
  }

  if (!args.needsVariant) {
    throw new Error(`El producto "${args.productName}" no usa tamaños`);
  }

  const variant = args.variants.find((candidate) => candidate.id === args.variantId);
  if (!variant) {
    throw new Error(`El tamaño seleccionado no pertenece a "${args.productName}"`);
  }
  if (args.requireActive && !variant.isActive) {
    throw new Error(`El tamaño seleccionado para "${args.productName}" está inactivo`);
  }

  return variant.id;
}

export function validatePricingGroupMembers(args: {
  products: readonly PricingGroupMemberCandidate[];
  requestedProductIds: readonly number[];
  unitType: "METER" | "PIECE";
  currentGroupId?: number | null;
}) {
  const { products, requestedProductIds, unitType, currentGroupId = null } = args;
  if (products.length !== requestedProductIds.length) {
    throw new Error("Uno o más productos no existen");
  }
  if (products.some((product) => product.isCustomProductTemplate)) {
    throw new Error("Producto Libre no puede pertenecer a un grupo de precios");
  }
  const incompatible = products.find((product) => product.unitType !== unitType);
  if (incompatible) {
    throw new Error(`El producto "${incompatible.name}" no usa la unidad ${unitType}`);
  }
  if (products.some((product) =>
    product.pricingGroupId !== null && product.pricingGroupId !== currentGroupId
  )) {
    throw new Error("Uno o más productos ya pertenecen a otro grupo");
  }
}

export type GroupPricingContext = {
  quantitiesByGroupId: Map<number, Prisma.Decimal>;
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
  const afterById = new Map(args.afterItems.map((item) => [item.id, item]));
  const affectedGroupIds = new Set<number>();

  for (const itemId of args.directlyChangedItemIds) {
    const before = beforeById.get(itemId);
    const after = afterById.get(itemId);
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

export function buildGroupPricingContext(
  items: readonly PricingItemInput[]
): GroupPricingContext {
  const quantitiesByGroupId = new Map<number, Prisma.Decimal>();

  for (const item of items) {
    const group = item.pricingGroup;
    if (item.isCustomProduct || !group?.isActive) continue;

    quantitiesByGroupId.set(
      group.id,
      (quantitiesByGroupId.get(group.id) ?? new Prisma.Decimal(0)).add(item.quantity)
    );
  }

  return { quantitiesByGroupId };
}

export function pricingQuantityForItem(
  item: PricingItemInput,
  context: GroupPricingContext
) {
  const group = item.pricingGroup;
  if (item.isCustomProduct || !group?.isActive) {
    return {
      pricingQuantity: item.quantity,
      pricingGroupId: null,
      pricingGroupName: null,
      groupQuantity: null,
    };
  }

  const groupQuantity = context.quantitiesByGroupId.get(group.id) ?? item.quantity;
  return {
    pricingQuantity: groupQuantity,
    pricingGroupId: group.id,
    pricingGroupName: group.name,
    groupQuantity,
  };
}

export function pickApplicableTier<T extends { minQty: Prisma.Decimal }>(
  tiers: readonly T[],
  pricingQuantity: Prisma.Decimal
): T | null {
  let best: T | null = null;
  for (const tier of tiers) {
    if (!pricingQuantity.gte(tier.minQty)) continue;
    if (!best || tier.minQty.gt(best.minQty)) best = tier;
  }
  return best;
}

export function calculateBranchProductItemPrice(args: {
  bp: any;
  variantId: number | null;
  quantity: Prisma.Decimal;
  pricingQuantity: Prisma.Decimal;
  selectedParams: Array<{
    paramId: number;
    chargeType: "PER_METER" | "PER_PIECE";
    pieceQty: number;
  }>;
  halfStepSpecialPrice?: Prisma.Decimal | null;
  productUnitType?: string;
}) {
  const {
    bp,
    variantId,
    quantity,
    pricingQuantity,
    selectedParams,
    halfStepSpecialPrice,
    productUnitType,
  } = args;

  const paramPriceMap = new Map<number, any>();
  for (const paramPrice of bp.paramPrices ?? []) {
    paramPriceMap.set(paramPrice.paramId, paramPrice);
  }

  const meterParamDelta = selectedParams
    .filter((param) => param.chargeType === "PER_METER")
    .reduce((sum, param) => {
      const priceDelta = paramPriceMap.get(param.paramId)?.priceDelta;
      return sum.add(priceDelta ? new Prisma.Decimal(priceDelta) : new Prisma.Decimal(0));
    }, new Prisma.Decimal(0));

  const pieceParamsTotal = selectedParams
    .filter((param) => param.chargeType === "PER_PIECE")
    .reduce((sum, param) => {
      const priceDelta = paramPriceMap.get(param.paramId)?.priceDelta;
      const delta = priceDelta ? new Prisma.Decimal(priceDelta) : new Prisma.Decimal(0);
      return sum.add(delta.mul(new Prisma.Decimal(param.pieceQty)));
    }, new Prisma.Decimal(0));

  if (
    productUnitType === "METER" &&
    halfStepSpecialPrice &&
    halfStepSpecialPrice.gt(0) &&
    quantity.equals(new Prisma.Decimal("0.5"))
  ) {
    const unitPrice = halfStepSpecialPrice.add(meterParamDelta);
    return {
      unitPrice,
      subtotal: unitPrice.add(pieceParamsTotal),
      appliedMinQty: null,
      source: "half-meter-special",
    };
  }

  let unitPrice = bp.price as Prisma.Decimal;
  let appliedMinQty: Prisma.Decimal | null = null;
  let source = "base-price";

  if (variantId) {
    const variantTiers = (bp.variantQuantityPrices ?? []).filter(
      (tier: any) => tier.variantId === variantId
    );
    const tier = pickApplicableTier(variantTiers, pricingQuantity);

    if (tier) {
      unitPrice = (tier as any).unitPrice;
      appliedMinQty = tier.minQty;
      source = "variant-quantity-matrix";
    } else {
      const variantPrice = (bp.variantPrices ?? []).find(
        (price: any) => price.variantId === variantId
      );
      if (variantPrice) {
        unitPrice = variantPrice.price;
        source = "variant-base-price";
      }
    }
  } else {
    const tier = pickApplicableTier(bp.quantityPrices ?? [], pricingQuantity);
    if (tier) {
      unitPrice = (tier as any).unitPrice;
      appliedMinQty = tier.minQty;
      source = "quantity-price";
    }
  }

  unitPrice = unitPrice.add(meterParamDelta);
  return {
    unitPrice,
    subtotal: unitPrice.mul(quantity).add(pieceParamsTotal),
    appliedMinQty,
    source,
  };
}

export function appliedGroupMetadata(args: {
  pricingGroupId: number | null;
  groupQuantity: Prisma.Decimal | null;
  appliedMinQty: Prisma.Decimal | null;
}) {
  const groupApplied = args.pricingGroupId !== null && args.appliedMinQty !== null;
  return {
    appliedPricingGroupId: groupApplied ? args.pricingGroupId : null,
    appliedGroupQuantity: groupApplied ? args.groupQuantity : null,
  };
}
