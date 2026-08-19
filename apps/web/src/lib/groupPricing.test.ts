import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGroupQuantities,
  buildPricingGroupRepricePlan,
  groupPricingForItem,
  highestApplicableTier,
} from "./groupPricing";

const group = { id: 1, name: "Termos", unitType: "PIECE" as const, isActive: true };
const catalog = [10, 11, 12].map((productId) => ({ productId, product: { pricingGroup: group } }));

test("frontend preview sums every line in a generic group", () => {
  const items = [
    { productId: 10, quantity: 3 },
    { productId: 10, quantity: 4 },
    { productId: 11, quantity: 5 },
  ];
  const quantities = buildGroupQuantities(items, catalog);
  assert.equal(quantities.get(1), 12);
  assert.equal(groupPricingForItem(items[0], catalog, quantities).pricingQuantity, 12);
});

test("frontend picks each product's own highest tier", () => {
  assert.equal(highestApplicableTier([{ minQty: 1 }, { minQty: 12 }, { minQty: 100 }], 20)?.minQty, 12);
  assert.equal(highestApplicableTier([{ minQty: 1 }, { minQty: 10 }, { minQty: 50 }], 20)?.minQty, 10);
});

test("inactive and missing groups use real item quantity", () => {
  const item = { productId: 10, quantity: 3 };
  const inactiveCatalog = [{ productId: 10, product: { pricingGroup: { ...group, isActive: false } } }];
  assert.equal(groupPricingForItem(item, inactiveCatalog, new Map()).pricingQuantity, 3);
  assert.equal(groupPricingForItem(item, [], new Map()).pricingQuantity, 3);
});

test("custom products are excluded from frontend group totals", () => {
  const quantities = buildGroupQuantities([
    { productId: 10, quantity: 100, isCustomProduct: true },
    { productId: 11, quantity: 4 },
  ], catalog);
  assert.equal(quantities.get(1), 4);
});

test("edit preview reprices group peers and preserves unrelated historical items", () => {
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
