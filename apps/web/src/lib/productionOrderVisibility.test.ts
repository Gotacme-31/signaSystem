import assert from "node:assert/strict";
import test from "node:test";
import { isOrderVisibleForProductionUser } from "./productionOrderVisibility";

const orderWithItems = (items: Array<{ productId?: number | null; complete?: boolean }>) => ({
  items: items.map((item) => ({
    product: item.productId != null ? { id: item.productId } : null,
    steps: item.complete === false ? undefined : [{ order: 1, name: "Paso", status: "PENDING" }],
  })),
});

test("non-PRODUCTION roles always see every order, restriction configured or not", () => {
  const restrictedLikeUser = { role: "ADMIN", allowedProductIds: [1] };
  assert.equal(isOrderVisibleForProductionUser(orderWithItems([{ productId: 99 }]), restrictedLikeUser), true);
  assert.equal(isOrderVisibleForProductionUser(undefined, { role: "STAFF" }), true);
  assert.equal(isOrderVisibleForProductionUser(null, { role: "COUNTER", allowedProductIds: [1] }), true);
  assert.equal(isOrderVisibleForProductionUser({ items: undefined }, { role: "MULTI_COUNTER", allowedProductIds: [1] }), true);
});

test("PRODUCTION without any allowedProductIds configured is unrestricted", () => {
  assert.equal(isOrderVisibleForProductionUser(orderWithItems([{ productId: 5 }]), { role: "PRODUCTION" }), true);
  assert.equal(
    isOrderVisibleForProductionUser(orderWithItems([{ productId: 5 }]), { role: "PRODUCTION", allowedProductIds: [] }),
    true
  );
  // Even a structurally incomplete payload is fine when there is no restriction to verify against.
  assert.equal(isOrderVisibleForProductionUser({ items: undefined }, { role: "PRODUCTION", allowedProductIds: [] }), true);
});

test("restricted PRODUCTION user sees an order with at least one allowed product", () => {
  const user = { role: "PRODUCTION", allowedProductIds: [10, 20] };
  const order = orderWithItems([{ productId: 999 }, { productId: 20 }]);
  assert.equal(isOrderVisibleForProductionUser(order, user), true);
});

test("restricted PRODUCTION user does not see an order with none of their allowed products", () => {
  const user = { role: "PRODUCTION", allowedProductIds: [10, 20] };
  const order = orderWithItems([{ productId: 1 }, { productId: 2 }]);
  assert.equal(isOrderVisibleForProductionUser(order, user), false);
});

test("restricted PRODUCTION user cannot qualify an order with missing or incomplete items", () => {
  const user = { role: "PRODUCTION", allowedProductIds: [10] };
  assert.equal(isOrderVisibleForProductionUser({ items: undefined }, user), false);
  assert.equal(isOrderVisibleForProductionUser({}, user), false);
  // One item missing product/steps makes the whole payload untrustworthy, per looksIncomplete semantics.
  assert.equal(
    isOrderVisibleForProductionUser(orderWithItems([{ productId: 10 }, { complete: false }]), user),
    false
  );
});
