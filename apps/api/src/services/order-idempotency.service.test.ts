import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeClientRequestId,
  orderRequestHash,
  OrderIdempotencyError,
} from "./order-idempotency.service";

test("equivalent order payloads produce the same stable request hash", () => {
  assert.equal(
    orderRequestHash({ customerId: 1, items: [{ productId: 2, quantity: "4" }] }),
    orderRequestHash({ items: [{ quantity: "4", productId: 2 }], customerId: 1 })
  );
});

test("commercially different order payloads produce different hashes", () => {
  assert.notEqual(
    orderRequestHash({ customerId: 1, items: [{ productId: 2, quantity: "4" }] }),
    orderRequestHash({ customerId: 1, items: [{ productId: 2, quantity: "5" }] })
  );
});

test("client request IDs are normalized and invalid IDs are rejected", () => {
  assert.equal(normalizeClientRequestId(" 12345678 "), "12345678");
  assert.throws(
    () => normalizeClientRequestId("short"),
    (error: unknown) => error instanceof OrderIdempotencyError && error.code === "INVALID_CLIENT_REQUEST_ID"
  );
});
