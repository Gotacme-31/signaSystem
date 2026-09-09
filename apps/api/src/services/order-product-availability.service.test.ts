import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  assertNormalProductAvailableForNewOrder,
  isProductAvailableForNewOrder,
  OrderProductUnavailableError,
  type NewOrderProductAvailability,
} from "./order-product-availability.service";

function row(branchActive: boolean, productActive: boolean, isTemplate = false): NewOrderProductAvailability {
  return {
    isActive: branchActive,
    product: {
      name: "Producto A",
      isActive: productActive,
      isCustomProductTemplate: isTemplate,
    },
  };
}

test("new-order availability requires active global and branch records for normal products", () => {
  assert.equal(isProductAvailableForNewOrder(row(true, true)), true);
  assert.equal(isProductAvailableForNewOrder(row(false, true)), false);
  assert.equal(isProductAvailableForNewOrder(row(true, false)), false);
  assert.equal(isProductAvailableForNewOrder(null), false);
});

test("Producto Libre retains its branch-specific availability rule", () => {
  assert.equal(isProductAvailableForNewOrder(row(true, false, true)), true);
  assert.equal(isProductAvailableForNewOrder(row(false, true, true)), false);
});

test("backend availability assertion rejects inactive or missing products structurally", () => {
  for (const unavailable of [row(false, true), row(true, false), null]) {
    assert.throws(
      () => assertNormalProductAvailableForNewOrder(unavailable, 12),
      (error: unknown) => error instanceof OrderProductUnavailableError
        && error.code === "PRODUCT_NOT_AVAILABLE"
        && error.status === 409
        && error.details.productId === 12
    );
  }
  assert.doesNotThrow(() => assertNormalProductAvailableForNewOrder(row(true, true), 12));
});

test("catalog new-order mode filters in Prisma while historical mode remains available", () => {
  const controller = readFileSync(resolve(process.cwd(), "src/controllers/branchPricing.controller.ts"), "utf8");
  assert.match(controller, /req\.query\.mode === "new-order"/);
  assert.match(controller, /isActive: true,[\s\S]*isCustomProductTemplate: false/);
  assert.match(controller, /isCustomProductTemplate: true/);
  assert.match(controller, /newOrderMode[\s\S]*:\s*\{\}\)/);
});

test("POST orders validates Product and BranchProduct activity before pricing", () => {
  const controller = readFileSync(resolve(process.cwd(), "src/controllers/order.controller.ts"), "utf8");
  assert.match(controller, /productId: \{ in: productIds \},\s*isActive: true/);
  assert.match(controller, /name: true,\s*isActive: true,\s*unitType: true/);
  assert.match(controller, /assertNormalProductAvailableForNewOrder\(configuredProduct, item\.productId\)/);
  assert.match(controller, /code: error\.code, error: error\.message, \.\.\.error\.details/);
});
