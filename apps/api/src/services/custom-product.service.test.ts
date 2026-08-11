import assert from "node:assert/strict";
import test from "node:test";
import {
  assertCustomUnitType,
  assertTemplateIsNotNormalProduct,
  customProductUpdateRequiresAvailability,
  resolveCanonicalCustomProductTemplate,
  resolveCustomProductIdForPersistence,
  resolveEnabledCustomProductTemplate,
} from "./custom-product.service";

function lookupDb(args: {
  templates?: Array<{ id: number }>;
  branchProduct?: { isActive: boolean } | null;
} = {}) {
  return {
    product: {
      findMany: async () => args.templates ?? [{ id: 68 }],
    },
    branchProduct: {
      findUnique: async () => args.branchProduct ?? null,
    },
  } as any;
}

test("active BranchProduct enables Producto Libre", async () => {
  const template = await resolveEnabledCustomProductTemplate(
    lookupDb({ branchProduct: { isActive: true } }),
    4
  );

  assert.equal(template.id, 68);
});

test("inactive BranchProduct rejects Producto Libre", async () => {
  await assert.rejects(
    resolveEnabledCustomProductTemplate(
      lookupDb({ branchProduct: { isActive: false } }),
      4
    ),
    /Producto Libre no está habilitado para esta sucursal/
  );
});

test("missing BranchProduct rejects Producto Libre", async () => {
  await assert.rejects(
    resolveEnabledCustomProductTemplate(lookupDb({ branchProduct: null }), 4),
    /Producto Libre no está habilitado para esta sucursal/
  );
});

test("real template ID is accepted and persisted canonically", () => {
  assert.equal(resolveCustomProductIdForPersistence(68, 68), 68);
});

test("legacy productId -1 remains accepted and persists the canonical ID", () => {
  assert.equal(resolveCustomProductIdForPersistence(-1, 68), 68);
});

test("a different custom productId is rejected", () => {
  assert.throws(
    () => resolveCustomProductIdForPersistence(10, 68),
    /productId no corresponde al template/
  );
});

test("template sent as a normal product is rejected", () => {
  assert.throws(
    () => assertTemplateIsNotNormalProduct(68, 68),
    /no puede registrarse como producto normal/
  );
});

test("zero templates fails closed", async () => {
  await assert.rejects(
    resolveCanonicalCustomProductTemplate(lookupDb({ templates: [] })),
    /No existe una configuración válida/
  );
});

test("multiple templates fails closed", async () => {
  await assert.rejects(
    resolveCanonicalCustomProductTemplate(lookupDb({ templates: [{ id: 68 }, { id: 69 }] })),
    /más de un template/
  );
});

test("normal product identity remains valid", () => {
  assert.doesNotThrow(() => assertTemplateIsNotNormalProduct(10, 68));
});

test("invalid customUnitType is rejected", () => {
  assert.throws(
    () => assertCustomUnitType("BOX"),
    /debe ser METER o PIECE/
  );
  assert.doesNotThrow(() => assertCustomUnitType("METER"));
  assert.doesNotThrow(() => assertCustomUnitType("PIECE"));
});

test("historical custom item does not require availability without commercial changes", () => {
  assert.equal(
    customProductUpdateRequiresAvailability(
      {
        isCustomProduct: true,
        quantity: "2.000",
      },
      { quantity: 2 }
    ),
    false
  );
});

test("legacy custom identity does not turn an operational edit into a commercial change", () => {
  assert.equal(
    customProductUpdateRequiresAvailability(
      {
        isCustomProduct: true,
        productId: 68,
        quantity: "2.000",
      },
      {
        productId: -1,
        quantity: 2,
      }
    ),
    false
  );
});

test("commercial changes to custom items require availability", () => {
  assert.equal(
    customProductUpdateRequiresAvailability(
      { isCustomProduct: true, quantity: 1 },
      { quantity: 2 }
    ),
    true
  );
});

test("editing cannot convert normal and custom items", () => {
  assert.throws(
    () => customProductUpdateRequiresAvailability(
      { isCustomProduct: false },
      { isCustomProduct: true }
    ),
    /No se permite convertir/
  );
  assert.throws(
    () => customProductUpdateRequiresAvailability(
      { isCustomProduct: true },
      { isCustomProduct: false }
    ),
    /No se permite convertir/
  );
});
