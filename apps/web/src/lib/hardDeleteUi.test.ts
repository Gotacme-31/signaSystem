import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const modal = readFileSync(resolve(process.cwd(), "src/pages/components/EditOrderModal.tsx"), "utf8");
const api = readFileSync(resolve(process.cwd(), "src/api/orders.ts"), "utf8");
const activeOrders = readFileSync(resolve(process.cwd(), "src/pages/ActiveOrders.tsx"), "utf8");

test("modal close is unambiguous and does not call cancellation", () => {
  assert.match(modal, /Cerrar sin guardar/);
  assert.match(modal, /onClick=\{onClose\}/);
});

test("Eliminar Pedido uses the compatible permanent endpoint and definitive copy", () => {
  assert.match(modal, /Eliminar Pedido/);
  assert.match(modal, /se eliminará definitivamente/);
  assert.match(modal, /await deleteOrder\(orderId\)/);
  assert.match(api, /`\/orders\/\$\{id\}\/permanent`/);
});

test("out-of-order created events cannot resurrect a hard-deleted order", () => {
  assert.match(activeOrders, /deletedOrderIdsRef\.current\.add\(orderId\)/);
  assert.match(activeOrders, /deletedOrderIdsRef\.current\.has\(newOrder\.id\)/);
});
