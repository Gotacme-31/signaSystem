import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const controller = readFileSync(
  resolve(process.cwd(), "src/controllers/dashboard.controller.ts"),
  "utf8"
);

test("recent orders never use the historical sales.orderIds array", () => {
  assert.doesNotMatch(controller, /where:\s*\{\s*id:\s*\{\s*in:\s*sales\.orderIds/);
  assert.match(controller, /prisma\.order\.findMany\(dashboardRecentOrdersQuery\(filters\)\)/);
});

test("customer metrics never materialize OrderItem IDs into Order.id IN", () => {
  assert.doesNotMatch(controller, /rows\.map\(\(row\)\s*=>\s*row\.orderId\)/);
  assert.match(controller, /dashboardCustomerOrderWhere\(filters,/);
});

test("sales.orderIds remains only as the documented Phase 1 payment debt", () => {
  const uses = controller.match(/sales\.orderIds/g) ?? [];
  assert.equal(uses.length, 1);
  assert.match(controller, /buildPaymentMethodsFromOrderRevenue\(sales\.orderIds,/);
});
