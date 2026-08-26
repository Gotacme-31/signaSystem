import assert from "node:assert/strict";
import test from "node:test";
import { planStableVariantChanges } from "./product-variant-admin.service";
import { InventoryError } from "./inventory.service";

const existing = [
  { id: 17, name: "King", isActive: true, order: 0 },
  { id: 18, name: "Individual", isActive: false, order: 1 },
];

test("rename preserves ID and omitted variant becomes inactive", () => {
  const plan = planStableVariantChanges(existing, [
    { id: 17, name: "King Size", isActive: true, order: 0 },
  ], true);
  assert.deepEqual(plan.updates, [{ id: 17, name: "King Size", isActive: true, order: 0 }]);
  assert.deepEqual(plan.deactivateIds, [18]);
  assert.deepEqual(plan.creates, []);
});

test("new variant is created and exact legacy name reactivates the same ID", () => {
  const plan = planStableVariantChanges(existing, [
    { id: null, name: "Individual", isActive: true, order: 0 },
    { id: null, name: "Super King", isActive: true, order: 1 },
    { id: 17, name: "King", isActive: true, order: 2 },
  ], true);
  assert.equal(plan.updates.find((variant) => variant.name === "Individual")?.id, 18);
  assert.deepEqual(plan.creates, [{ name: "Super King", isActive: true, order: 1 }]);
});

test("ambiguous legacy rename is rejected for an inventory product", () => {
  assert.throws(
    () => planStableVariantChanges(existing, [
      { id: null, name: "King Size", isActive: true, order: 0 },
    ], true),
    (error: unknown) => error instanceof InventoryError && error.code === "VARIANT_IDS_REQUIRED_FOR_INVENTORY_PRODUCT"
  );
});

test("duplicate existing variant IDs are rejected", () => {
  assert.throws(
    () => planStableVariantChanges(existing, [
      { id: 17, name: "King", isActive: true, order: 0 },
      { id: 17, name: "King Size", isActive: true, order: 1 },
    ], true),
    (error: unknown) => error instanceof InventoryError && error.code === "DUPLICATE_PRODUCT_VARIANT_ID"
  );
});
