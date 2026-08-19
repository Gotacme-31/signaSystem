import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import {
  appliedGroupMetadata,
  buildGroupPricingContext,
  buildPricingGroupRepricePlan,
  calculateBranchProductItemPrice,
  pricingQuantityForItem,
  validatePricingGroupMembers,
  validateVariantSelection,
} from "./order-pricing.service";

const GROUP = { id: 1, name: "Frazadas y Toallas", isActive: true };

function decimal(value: number | string) {
  return new Prisma.Decimal(value);
}

function variantBranchProduct(args: {
  base?: number;
  variantId?: number;
  tiers?: Array<[number, number]>;
  branchMarker?: string;
} = {}) {
  const variantId = args.variantId ?? 7;
  return {
    price: decimal(args.base ?? 150),
    branchMarker: args.branchMarker ?? "branch-a",
    quantityPrices: [],
    variantPrices: [{ variantId, price: decimal(args.base ?? 150) }],
    variantQuantityPrices: (args.tiers ?? [[12, 110], [100, 99]]).map(
      ([minQty, unitPrice]) => ({ variantId, minQty: decimal(minQty), unitPrice: decimal(unitPrice) })
    ),
    paramPrices: [],
  };
}

function groupedPrice(args: {
  total: number;
  itemQuantity?: number;
  tiers?: Array<[number, number]>;
  variantId?: number;
}) {
  const item = {
    productId: 2,
    quantity: decimal(args.itemQuantity ?? args.total),
    pricingGroup: GROUP,
  };
  const context = buildGroupPricingContext([
    item,
    ...(args.total > Number(item.quantity)
      ? [{ productId: 6, quantity: decimal(args.total - Number(item.quantity)), pricingGroup: GROUP }]
      : []),
  ]);
  const pricing = pricingQuantityForItem(item, context);
  return calculateBranchProductItemPrice({
    bp: variantBranchProduct({ tiers: args.tiers, variantId: args.variantId }),
    variantId: args.variantId ?? 7,
    quantity: item.quantity,
    pricingQuantity: pricing.pricingQuantity,
    selectedParams: [],
    productUnitType: "PIECE",
  });
}

for (const [quantity, expectedPrice, expectedTier] of [
  [11, 150, null],
  [12, 110, 12],
  [13, 110, 12],
  [99, 110, 12],
  [100, 99, 100],
  [101, 99, 100],
] as const) {
  test(`Frazada/Toalla parity at combined quantity ${quantity}`, () => {
    const result = groupedPrice({ total: quantity, itemQuantity: Math.min(quantity, 7) });
    assert.equal(result.unitPrice.toNumber(), expectedPrice);
    assert.equal(result.appliedMinQty?.toNumber() ?? null, expectedTier);
  });
}

test("duplicate lines of the same product all contribute", () => {
  const items = [
    { productId: 2, quantity: decimal(3), pricingGroup: GROUP },
    { productId: 2, quantity: decimal(4), pricingGroup: GROUP },
    { productId: 6, quantity: decimal(5), pricingGroup: GROUP },
  ];
  const context = buildGroupPricingContext(items);
  assert.equal(context.quantitiesByGroupId.get(GROUP.id)?.toNumber(), 12);
  assert.equal(pricingQuantityForItem(items[0], context).pricingQuantity.toNumber(), 12);
});

test("three different products contribute to one generic group", () => {
  const items = [3, 4, 5].map((quantity, index) => ({
    productId: index + 10,
    quantity: decimal(quantity),
    pricingGroup: { id: 2, name: "Termos", isActive: true },
  }));
  assert.equal(buildGroupPricingContext(items).quantitiesByGroupId.get(2)?.toNumber(), 12);
});

test("products may use different tiers at the same group quantity", () => {
  const group = { id: 2, name: "Termos", isActive: true };
  const items = [
    { productId: 10, quantity: decimal(8), pricingGroup: group },
    { productId: 11, quantity: decimal(12), pricingGroup: group },
  ];
  const context = buildGroupPricingContext(items);
  const pricingQuantity = pricingQuantityForItem(items[0], context).pricingQuantity;
  const productA = calculateBranchProductItemPrice({
    bp: variantBranchProduct({ tiers: [[12, 80], [100, 60]] }),
    variantId: 7,
    quantity: items[0].quantity,
    pricingQuantity,
    selectedParams: [],
    productUnitType: "PIECE",
  });
  const productB = calculateBranchProductItemPrice({
    bp: variantBranchProduct({ tiers: [[10, 110], [50, 90]] }),
    variantId: 7,
    quantity: items[1].quantity,
    pricingQuantity,
    selectedParams: [],
    productUnitType: "PIECE",
  });
  assert.equal(productA.appliedMinQty?.toNumber(), 12);
  assert.equal(productB.appliedMinQty?.toNumber(), 10);
});

test("inactive group and ungrouped products use their real quantity", () => {
  const inactive = { productId: 10, quantity: decimal(3), pricingGroup: { ...GROUP, isActive: false } };
  const ungrouped = { productId: 11, quantity: decimal(4), pricingGroup: null };
  const context = buildGroupPricingContext([inactive, ungrouped]);
  assert.equal(pricingQuantityForItem(inactive, context).pricingQuantity.toNumber(), 3);
  assert.equal(pricingQuantityForItem(ungrouped, context).pricingQuantity.toNumber(), 4);
});

test("different variants use only their own tier prices", () => {
  const bp = {
    ...variantBranchProduct(),
    variantPrices: [{ variantId: 7, price: decimal(150) }, { variantId: 8, price: decimal(250) }],
    variantQuantityPrices: [
      { variantId: 7, minQty: decimal(12), unitPrice: decimal(110) },
      { variantId: 8, minQty: decimal(12), unitPrice: decimal(210) },
    ],
  };
  const common = {
    bp,
    quantity: decimal(6),
    pricingQuantity: decimal(12),
    selectedParams: [],
    productUnitType: "PIECE",
  };
  assert.equal(calculateBranchProductItemPrice({ ...common, variantId: 7 }).unitPrice.toNumber(), 110);
  assert.equal(calculateBranchProductItemPrice({ ...common, variantId: 8 }).unitPrice.toNumber(), 210);
});

test("variant validation preserves the selected variant and rejects cross-product IDs", () => {
  assert.equal(validateVariantSelection({
    productName: "Frazada",
    needsVariant: true,
    variants: [{ id: 7, isActive: true }],
    variantId: 7,
    requireActive: true,
  }), 7);
  assert.throws(() => validateVariantSelection({
    productName: "Frazada",
    needsVariant: true,
    variants: [{ id: 7, isActive: true }],
    variantId: 8,
    requireActive: true,
  }), /no pertenece/);
});

test("editing may preserve an inactive historical variant but cannot newly select it", () => {
  assert.equal(validateVariantSelection({
    productName: "Frazada",
    needsVariant: true,
    variants: [{ id: 7, isActive: false }],
    variantId: 7,
    requireActive: false,
  }), 7);
  assert.throws(() => validateVariantSelection({
    productName: "Frazada",
    needsVariant: true,
    variants: [{ id: 7, isActive: false }],
    variantId: 7,
    requireActive: true,
  }), /inactivo/);
});

test("variant without tier 100 falls back to highest lower tier", () => {
  const result = groupedPrice({ total: 101, itemQuantity: 50, tiers: [[12, 190]] });
  assert.equal(result.unitPrice.toNumber(), 190);
  assert.equal(result.appliedMinQty?.toNumber(), 12);
});

test("branch pricing remains isolated", () => {
  const pricingQuantity = decimal(12);
  const branchA = calculateBranchProductItemPrice({
    bp: variantBranchProduct({ tiers: [[12, 110]], branchMarker: "a" }),
    variantId: 7,
    quantity: decimal(3),
    pricingQuantity,
    selectedParams: [],
    productUnitType: "PIECE",
  });
  const branchB = calculateBranchProductItemPrice({
    bp: variantBranchProduct({ tiers: [[12, 125]], branchMarker: "b" }),
    variantId: 7,
    quantity: decimal(3),
    pricingQuantity,
    selectedParams: [],
    productUnitType: "PIECE",
  });
  assert.equal(branchA.unitPrice.toNumber(), 110);
  assert.equal(branchB.unitPrice.toNumber(), 125);
});

test("subtotal uses real quantity and parameters never use group quantity", () => {
  const bp = {
    ...variantBranchProduct({ tiers: [[12, 80]] }),
    paramPrices: [
      { paramId: 1, priceDelta: decimal(5) },
      { paramId: 2, priceDelta: decimal(3) },
    ],
  };
  const result = calculateBranchProductItemPrice({
    bp,
    variantId: 7,
    quantity: decimal(3),
    pricingQuantity: decimal(12),
    selectedParams: [
      { paramId: 1, chargeType: "PER_METER", pieceQty: 1 },
      { paramId: 2, chargeType: "PER_PIECE", pieceQty: 2 },
    ],
    productUnitType: "PIECE",
  });
  assert.equal(result.unitPrice.toNumber(), 85);
  assert.equal(result.subtotal.toNumber(), 261);
});

test("client-supplied prices cannot override backend branch pricing", () => {
  const manipulatedInput = {
    bp: variantBranchProduct({ tiers: [[12, 80]] }),
    variantId: 7,
    quantity: decimal(3),
    pricingQuantity: decimal(12),
    selectedParams: [],
    productUnitType: "PIECE",
    unitPrice: decimal("0.01"),
    subtotal: decimal("0.01"),
  };
  const result = calculateBranchProductItemPrice(manipulatedInput);
  assert.equal(result.unitPrice.toNumber(), 80);
  assert.equal(result.subtotal.toNumber(), 240);
});

test("half-step retains priority over grouped tiers", () => {
  const result = calculateBranchProductItemPrice({
    bp: variantBranchProduct({ tiers: [[12, 80]] }),
    variantId: 7,
    quantity: decimal("0.5"),
    pricingQuantity: decimal(12),
    selectedParams: [],
    halfStepSpecialPrice: decimal(70),
    productUnitType: "METER",
  });
  assert.equal(result.unitPrice.toNumber(), 70);
  assert.equal(result.appliedMinQty, null);
});

test("custom product never contributes to group quantity", () => {
  const context = buildGroupPricingContext([
    { productId: 68, quantity: decimal(100), pricingGroup: GROUP, isCustomProduct: true },
    { productId: 2, quantity: decimal(3), pricingGroup: GROUP },
  ]);
  assert.equal(context.quantitiesByGroupId.get(GROUP.id)?.toNumber(), 3);
});

test("group metadata is persisted only when a group tier applies", () => {
  assert.deepEqual(appliedGroupMetadata({
    pricingGroupId: 1,
    groupQuantity: decimal(12),
    appliedMinQty: decimal(12),
  }), {
    appliedPricingGroupId: 1,
    appliedGroupQuantity: decimal(12),
  });
  assert.deepEqual(appliedGroupMetadata({
    pricingGroupId: 1,
    groupQuantity: decimal(3),
    appliedMinQty: null,
  }), {
    appliedPricingGroupId: null,
    appliedGroupQuantity: null,
  });
});

test("editing one member reprices every member of that group", () => {
  const plan = buildPricingGroupRepricePlan({
    beforeItems: [
      { id: 1, pricingGroupId: 1, appliedPricingGroupId: 1 },
      { id: 2, pricingGroupId: 1, appliedPricingGroupId: 1 },
      { id: 3, pricingGroupId: null, appliedPricingGroupId: null },
    ],
    afterItems: [
      { id: 1, pricingGroupId: 1 },
      { id: 2, pricingGroupId: 1 },
      { id: 3, pricingGroupId: null },
    ],
    directlyChangedItemIds: new Set([2]),
  });

  assert.deepEqual([...plan.repricedItemIds].sort(), [1, 2]);
});

test("editing group quantity moves every member into and out of tiers", () => {
  const items = [
    { productId: 2, quantity: decimal(7), pricingGroup: GROUP },
    { productId: 6, quantity: decimal(6), pricingGroup: GROUP },
  ];
  const highContext = buildGroupPricingContext(items);
  const highPrice = calculateBranchProductItemPrice({
    bp: variantBranchProduct({ tiers: [[12, 110]] }),
    variantId: 7,
    quantity: items[0].quantity,
    pricingQuantity: pricingQuantityForItem(items[0], highContext).pricingQuantity,
    selectedParams: [],
    productUnitType: "PIECE",
  });

  items[1].quantity = decimal(2);
  const lowContext = buildGroupPricingContext(items);
  const lowPrice = calculateBranchProductItemPrice({
    bp: variantBranchProduct({ tiers: [[12, 110]] }),
    variantId: 7,
    quantity: items[0].quantity,
    pricingQuantity: pricingQuantityForItem(items[0], lowContext).pricingQuantity,
    selectedParams: [],
    productUnitType: "PIECE",
  });

  assert.equal(highPrice.appliedMinQty?.toNumber(), 12);
  assert.equal(lowPrice.appliedMinQty, null);
  assert.equal(lowPrice.unitPrice.toNumber(), 150);
});

test("historical group metadata reprices former peers without touching unrelated items", () => {
  const plan = buildPricingGroupRepricePlan({
    beforeItems: [
      { id: 1, pricingGroupId: null, appliedPricingGroupId: 1 },
      { id: 2, pricingGroupId: 1, appliedPricingGroupId: 1 },
      { id: 3, pricingGroupId: 2, appliedPricingGroupId: 2 },
    ],
    afterItems: [
      { id: 1, pricingGroupId: null },
      { id: 2, pricingGroupId: 1 },
      { id: 3, pricingGroupId: 2 },
    ],
    directlyChangedItemIds: new Set([1]),
  });

  assert.deepEqual([...plan.repricedItemIds].sort(), [1, 2]);
});

test("membership allows same-unit products", () => {
  assert.doesNotThrow(() => validatePricingGroupMembers({
    products: [
      { id: 2, name: "Frazada", unitType: "PIECE", isCustomProductTemplate: false, pricingGroupId: null },
      { id: 6, name: "Toalla", unitType: "PIECE", isCustomProductTemplate: false, pricingGroupId: null },
    ],
    requestedProductIds: [2, 6],
    unitType: "PIECE",
  }));
});

test("membership rejects mixed units, duplicate ownership and Producto Libre", () => {
  assert.throws(() => validatePricingGroupMembers({
    products: [{ id: 1, name: "DTF", unitType: "METER", isCustomProductTemplate: false, pricingGroupId: null }],
    requestedProductIds: [1],
    unitType: "PIECE",
  }), /no usa la unidad/);
  assert.throws(() => validatePricingGroupMembers({
    products: [{ id: 1, name: "Termo", unitType: "PIECE", isCustomProductTemplate: false, pricingGroupId: 9 }],
    requestedProductIds: [1],
    unitType: "PIECE",
  }), /otro grupo/);
  assert.throws(() => validatePricingGroupMembers({
    products: [{ id: 68, name: "Producto Libre", unitType: "PIECE", isCustomProductTemplate: true, pricingGroupId: null }],
    requestedProductIds: [68],
    unitType: "PIECE",
  }), /Producto Libre/);
});
