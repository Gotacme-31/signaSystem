import assert from "node:assert/strict";
import test from "node:test";
import type { SupplyItem } from "../api/suppliesInventory";
import {
  filterSupplyItems,
  isLatestSupplyRequest,
  parseStockInput,
  selectSupplyBranchId,
  signedSupplyQuantity,
  supplyMutationNotice,
  supplyStatusLabel,
} from "./suppliesInventory";

function supply(overrides: Partial<SupplyItem> = {}): SupplyItem {
  return {
    id: 1,
    branchId: 1,
    name: "Tinta Negra DTF",
    normalizedName: "tinta negra dtf",
    unitLabel: "botella",
    currentStock: 5,
    lowStockThreshold: 2,
    version: 0,
    isActive: true,
    createdAt: "2026-08-31T12:00:00.000Z",
    updatedAt: "2026-08-31T12:00:00.000Z",
    status: "AVAILABLE",
    unitLabelEditable: false,
    lastMovement: null,
    ...overrides,
  };
}

test("branch selection preserves a valid query and falls back deterministically", () => {
  const branches = [
    { id: 1, isActive: false },
    { id: 2, isActive: true },
    { id: 3, isActive: true },
  ];
  assert.equal(selectSupplyBranchId(3, branches), 3);
  assert.equal(selectSupplyBranchId(99, branches), 2);
  assert.equal(selectSupplyBranchId(null, [{ id: 1, isActive: false }]), 1);
  assert.equal(selectSupplyBranchId(null, []), null);
});

test("only the latest branch response may update the supply table", () => {
  assert.equal(isLatestSupplyRequest(4, 4), true);
  assert.equal(isLatestSupplyRequest(3, 4), false);
});

test("supply filters isolate active, inactive, low and out rows", () => {
  const active = supply();
  const inactive = supply({ id: 2, name: "Polvo", normalizedName: "polvo", isActive: false, status: "INACTIVE" });
  const low = supply({ id: 3, name: "Tinta Magenta", normalizedName: "tinta magenta", currentStock: 1, status: "LOW" });
  const out = supply({ id: 4, name: "Papel", normalizedName: "papel", currentStock: 0, status: "OUT" });
  const items = [active, inactive, low, out];
  assert.deepEqual(filterSupplyItems(items, "", "ACTIVE").map((item) => item.id), [1, 3, 4]);
  assert.deepEqual(filterSupplyItems(items, "", "INACTIVE").map((item) => item.id), [2]);
  assert.deepEqual(filterSupplyItems(items, "", "LOW").map((item) => item.id), [3]);
  assert.deepEqual(filterSupplyItems(items, "", "OUT").map((item) => item.id), [4]);
  assert.deepEqual(filterSupplyItems(items, "MAGENTA", "ACTIVE").map((item) => item.id), [3]);
});

test("stock input parsing is strict and compatible with PostgreSQL INTEGER", () => {
  assert.equal(parseStockInput("0", "Stock", false), 0);
  assert.equal(parseStockInput("10", "Stock", true), 10);
  for (const value of ["", "1.5", "-1", "1e3", "2147483648"]) {
    assert.throws(() => parseStockInput(value, "Stock", false));
  }
  assert.throws(() => parseStockInput("0", "Cantidad", true));
});

test("status and signed quantities have operational labels", () => {
  assert.equal(supplyStatusLabel("AVAILABLE"), "Disponible");
  assert.equal(supplyStatusLabel("LOW"), "Stock bajo");
  assert.equal(supplyStatusLabel("OUT"), "Sin stock");
  assert.equal(supplyStatusLabel("INACTIVE"), "Inactivo");
  assert.equal(signedSupplyQuantity(3), "+3");
  assert.equal(signedSupplyQuantity(-2), "-2");
});

test("no-change adjustment reports that no movement was created", () => {
  assert.match(supplyMutationNotice({
    supplyItemId: 1,
    currentStock: 5,
    version: 3,
    noChange: true,
    repeated: false,
  }), /no se registraron cambios/i);
});
