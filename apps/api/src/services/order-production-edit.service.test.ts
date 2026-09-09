import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { physicalScheduleChanged } from "./order-production-edit.service";

const existingItems = [{ id: 1, productId: 10, quantity: new Prisma.Decimal("5") }];

test("parameter-only, notes, payment and shipping metadata do not change physical schedule", () => {
  for (const itemUpdates of [
    [{ id: 1, selectedParams: [{ paramId: 2, pieceQty: 5 }] }],
    [{ id: 1, quantity: "5", note: "actualizada" }],
    [],
  ]) {
    assert.equal(physicalScheduleChanged({
      deliveryWasChanged: false,
      existingItems,
      itemUpdates,
    }), false);
  }
});

test("quantity and product identity changes require replanning", () => {
  assert.equal(physicalScheduleChanged({
    deliveryWasChanged: false,
    existingItems,
    itemUpdates: [{ id: 1, quantity: "6" }],
  }), true);
  assert.equal(physicalScheduleChanged({
    deliveryWasChanged: false,
    existingItems,
    itemUpdates: [{ id: 1, productId: 11 }],
  }), true);
});

test("Producto Libre quantity remains outside automatic physical scheduling", () => {
  assert.equal(physicalScheduleChanged({
    deliveryWasChanged: false,
    existingItems: [{ ...existingItems[0], isCustomProduct: true }],
    itemUpdates: [{ id: 1, quantity: "6" }],
  }), false);
});

test("commercial delivery changes retain existing manual scheduling behavior", () => {
  assert.equal(physicalScheduleChanged({
    deliveryWasChanged: true,
    existingItems,
    itemUpdates: [],
  }), true);
});
