import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCustomProductRequest,
  splitOrderBranchProducts,
} from "./customProduct";

function row(args: {
  productId: number;
  isActive: boolean;
  isTemplate?: boolean;
  name?: string;
}) {
  return {
    productId: args.productId,
    isActive: args.isActive,
    price: args.productId * 10,
    product: {
      id: args.productId,
      name: args.name ?? `Producto ${args.productId}`,
      isCustomProductTemplate: args.isTemplate === true,
    },
  };
}

test("template never enters the normal order catalog", () => {
  const template = row({ productId: 68, isActive: true, isTemplate: true });
  const normal = row({ productId: 10, isActive: true });
  const result = splitOrderBranchProducts([template, normal]);

  assert.deepEqual(result.normalCatalogRows, [normal]);
  assert.equal(result.normalCatalogRows.includes(template), false);
});

test("active template enables Producto Libre", () => {
  const result = splitOrderBranchProducts([
    row({ productId: 68, isActive: true, isTemplate: true }),
  ]);

  assert.equal(result.customProductAllowed, true);
  assert.equal(result.customProductTemplateId, 68);
});

test("inactive template disables Producto Libre but keeps its ID", () => {
  const result = splitOrderBranchProducts([
    row({ productId: 68, isActive: false, isTemplate: true }),
  ]);

  assert.equal(result.customProductAllowed, false);
  assert.equal(result.customProductTemplateId, 68);
});

test("missing template disables Producto Libre", () => {
  const normal = row({ productId: 10, isActive: true });
  const result = splitOrderBranchProducts([normal]);

  assert.equal(result.customProductAllowed, false);
  assert.equal(result.customProductTemplateId, null);
  assert.deepEqual(result.normalCatalogRows, [normal]);
});

test("multiple templates fail closed in the order form", () => {
  const result = splitOrderBranchProducts([
    row({ productId: 68, isActive: true, isTemplate: true }),
    row({ productId: 69, isActive: true, isTemplate: true }),
  ]);

  assert.equal(result.customProductAllowed, false);
  assert.equal(result.customProductTemplateId, null);
  assert.deepEqual(result.normalCatalogRows, []);
});

test("new custom payload uses the real template ID", () => {
  const payload = buildCustomProductRequest({
    quantity: 2,
    customProductName: "Termo",
    customUnitType: "PIECE",
    customUnitPrice: 150,
  }, 68);

  assert.equal(payload.productId, 68);
  assert.equal(payload.isCustomProduct, true);
  assert.equal(payload.quantity, "2");
});

test("active normal products retain their catalog data", () => {
  const normal = row({ productId: 10, isActive: true, name: "Lona" });
  const inactive = row({ productId: 11, isActive: false, name: "Oculto" });
  const result = splitOrderBranchProducts([normal, inactive]);

  assert.equal(result.normalCatalogRows[0], normal);
  assert.equal(result.normalCatalogRows.length, 1);
});
