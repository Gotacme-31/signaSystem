import assert from "node:assert/strict";
import test from "node:test";
import { canMutateCommercialOrders } from "./order-permissions.service";

test("only commercial roles can create orders or change inventory quantities", () => {
  assert.equal(canMutateCommercialOrders("ADMIN"), true);
  assert.equal(canMutateCommercialOrders("STAFF"), true);
  assert.equal(canMutateCommercialOrders("COUNTER"), true);
  assert.equal(canMutateCommercialOrders("MULTI_COUNTER"), true);
  assert.equal(canMutateCommercialOrders("PRODUCTION"), false);
  assert.equal(canMutateCommercialOrders("PAYMENTS"), false);
});
