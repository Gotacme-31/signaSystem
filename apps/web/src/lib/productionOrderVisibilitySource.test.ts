import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(process.cwd(), "../..");
const page = readFileSync(resolve(root, "apps/web/src/pages/ActiveOrders.tsx"), "utf8");

// Slicing between consecutive handler declarations (rather than brace-matching
// the outer useOrderEvents({...}) call) avoids false boundaries from the
// nested "});" that closes each handler's own setOrders(prev => {...}) call.
const onOrderCreatedStart = page.indexOf("onOrderCreated: (newOrder)");
const onOrderUpdatedStart = page.indexOf("onOrderUpdated: (updatedOrder)");
const onOrderDeletedStart = page.indexOf("onOrderDeleted: (orderId)");

assert.ok(
  onOrderCreatedStart !== -1 && onOrderUpdatedStart !== -1 && onOrderDeletedStart !== -1,
  "expected to find onOrderCreated, onOrderUpdated and onOrderDeleted handlers in useOrderEvents"
);

const onOrderCreatedBlock = page.slice(onOrderCreatedStart, onOrderUpdatedStart);

test("onOrderCreated never inserts or notifies for an order a restricted PRODUCTION user cannot see", () => {
  const guardIndex = onOrderCreatedBlock.indexOf("isOrderVisibleForProductionUser(newOrder, user)");
  const setOrdersIndex = onOrderCreatedBlock.indexOf("setOrders(prev =>");
  const notificationIndex = onOrderCreatedBlock.indexOf("setNotification(`🆕 Nuevo pedido");

  assert.notEqual(guardIndex, -1, "expected an isOrderVisibleForProductionUser guard in onOrderCreated");
  assert.ok(guardIndex < setOrdersIndex, "the visibility guard must run before setOrders inserts the order");
  assert.ok(guardIndex < notificationIndex, "the visibility guard must run before the new-order notification");
});

test("onOrderUpdated only applies the visibility guard to the not-yet-visible (found === false) branch", () => {
  const onOrderUpdatedBlock = page.slice(onOrderUpdatedStart, onOrderDeletedStart);
  const notFoundReturnIndex = onOrderUpdatedBlock.indexOf("if (found || !updatedOrder?.id) return updated;");
  const guardIndex = onOrderUpdatedBlock.indexOf("isOrderVisibleForProductionUser(updatedOrder, user)");
  const pushIndex = onOrderUpdatedBlock.indexOf("return [...updated, updatedOrder]");

  assert.notEqual(notFoundReturnIndex, -1);
  assert.notEqual(guardIndex, -1);
  assert.ok(
    notFoundReturnIndex < guardIndex && guardIndex < pushIndex,
    "the guard must sit strictly between the found-branch early return and the insertion"
  );

  // The found === true branch (inside prev.map, merging into the existing visible order) must be untouched.
  const mapStart = onOrderUpdatedBlock.indexOf("const updated = prev.map(o => {");
  const foundTrueBlock = onOrderUpdatedBlock.slice(mapStart, notFoundReturnIndex);
  assert.doesNotMatch(foundTrueBlock, /isOrderVisibleForProductionUser/);
});

test("the production visibility helper is imported from the shared lib, not reimplemented inline", () => {
  assert.match(page, /import \{ isOrderVisibleForProductionUser \} from "\.\.\/lib\/productionOrderVisibility";/);
});
