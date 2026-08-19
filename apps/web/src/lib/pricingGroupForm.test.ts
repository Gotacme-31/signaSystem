import assert from "node:assert/strict";
import test from "node:test";
import type { PricingGroupProductOption } from "../api/pricingGroups";
import {
  filterPricingGroupProducts,
  incompatibleProductIds,
  isProductOccupied,
  toggleProductId,
  uniqueProductIds,
} from "./pricingGroupForm";

const products: PricingGroupProductOption[] = [
  {
    id: 10,
    name: "Termo 20 oz",
    unitType: "PIECE",
    isActive: true,
    pricingGroupId: null,
    pricingGroup: null,
  },
  {
    id: 11,
    name: "Termo 30 OZ",
    unitType: "PIECE",
    isActive: false,
    pricingGroupId: 5,
    pricingGroup: { id: 5, name: "Termos" },
  },
  {
    id: 25,
    name: "Lona",
    unitType: "METER",
    isActive: true,
    pricingGroupId: null,
    pricingGroup: null,
  },
];

test("local search matches product names case-insensitively and IDs", () => {
  assert.deepEqual(
    filterPricingGroupProducts(products, "PIECE", "termo").map((product) => product.id),
    [10, 11]
  );
  assert.deepEqual(
    filterPricingGroupProducts(products, "PIECE", "11").map((product) => product.id),
    [11]
  );
});

test("multi-select toggles IDs and deduplicates the payload", () => {
  assert.deepEqual(toggleProductId([10], 11), [10, 11]);
  assert.deepEqual(toggleProductId([10, 11], 10), [11]);
  assert.deepEqual(uniqueProductIds([10, 10, 11]), [10, 11]);
});

test("unit changes identify only incompatible selected products", () => {
  assert.deepEqual(incompatibleProductIds([10, 25], products, "METER"), [10]);
  assert.deepEqual(incompatibleProductIds([10, 11], products, "PIECE"), []);
});

test("products owned by another group are occupied, but current members are not", () => {
  assert.equal(isProductOccupied(products[1], null), true);
  assert.equal(isProductOccupied(products[1], 4), true);
  assert.equal(isProductOccupied(products[1], 5), false);
  assert.equal(isProductOccupied(products[0], null), false);
});
