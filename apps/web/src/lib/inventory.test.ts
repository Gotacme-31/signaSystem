import assert from "node:assert/strict";
import test from "node:test";
import type { AdminInventoryRow } from "../api/inventory";
import { filterInventoryRows, isLatestInventoryRequest, signedQuantity } from "./inventory";

const baseRow: AdminInventoryRow = {
  branchProductId: 10,
  branchProductIsActive: true,
  product: {
    id: 20,
    name: "Termo 20 oz",
    isActive: true,
    unitType: "PIECE",
    minQty: "1",
    qtyStep: "1",
    variants: [],
  },
  inventory: {
    configId: 1,
    enabled: true,
    trackingMode: "PRODUCT",
    currentStock: 8,
    lowStockThreshold: 10,
    status: "LOW",
    lowVariantCount: 0,
    outVariantCount: 0,
    balances: [{
      balanceId: 2,
      variantId: null,
      variant: null,
      currentStock: 8,
      lowStockThreshold: 10,
      version: 1,
      status: "LOW",
      updatedAt: "2026-08-21T00:00:00.000Z",
      lastMovement: null,
    }],
    uninitializedVariants: [],
    activatedAt: "2026-08-21T00:00:00.000Z",
    deactivatedAt: null,
    updatedAt: "2026-08-21T00:00:00.000Z",
    lastMovement: null,
  },
};

test("inventory search matches product name and ID", () => {
  assert.equal(filterInventoryRows([baseRow], "TERMO", "ALL").length, 1);
  assert.equal(filterInventoryRows([baseRow], "20", "ALL").length, 1);
  assert.equal(filterInventoryRows([baseRow], "taza", "ALL").length, 0);
});

test("inventory filters distinguish controlled, uncontrolled, low and out", () => {
  const uncontrolled = { ...baseRow, branchProductId: 11, inventory: null };
  const out = {
    ...baseRow,
    branchProductId: 12,
    inventory: { ...baseRow.inventory!, currentStock: 0, status: "OUT" as const },
  };
  const rows = [baseRow, uncontrolled, out];
  assert.deepEqual(filterInventoryRows(rows, "", "CONTROLLED").map((row) => row.branchProductId), [10, 12]);
  assert.deepEqual(filterInventoryRows(rows, "", "UNCONTROLLED").map((row) => row.branchProductId), [11]);
  assert.deepEqual(filterInventoryRows(rows, "", "LOW").map((row) => row.branchProductId), [10]);
  assert.deepEqual(filterInventoryRows(rows, "", "OUT").map((row) => row.branchProductId), [12]);
});

test("disabled inventory remains controlled and filters run on the active branch catalog", () => {
  const disabled = {
    ...baseRow,
    branchProductId: 13,
    inventory: { ...baseRow.inventory!, enabled: false },
  };
  const uncontrolled = { ...baseRow, branchProductId: 14, inventory: null };
  assert.deepEqual(
    filterInventoryRows([disabled, uncontrolled], "", "CONTROLLED").map((row) => row.branchProductId),
    [13]
  );
  assert.deepEqual(
    filterInventoryRows([disabled, uncontrolled], "", "UNCONTROLLED").map((row) => row.branchProductId),
    [14]
  );
});

test("only the latest branch inventory request may update the table", () => {
  assert.equal(isLatestInventoryRequest(3, 3), true);
  assert.equal(isLatestInventoryRequest(1, 3), false);
  assert.equal(isLatestInventoryRequest(2, 3), false);
});

test("movement quantities are formatted with an explicit positive sign", () => {
  assert.equal(signedQuantity(5), "+5");
  assert.equal(signedQuantity(-3), "-3");
});
