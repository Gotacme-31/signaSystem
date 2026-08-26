import assert from "node:assert/strict";
import test from "node:test";
import { Prisma, UnitType } from "@prisma/client";
import {
  assertProductInventoryCompatibility,
  ProductInventoryCompatibilityError,
} from "./product-inventory-compatibility.service";

const integerState = {
  hasInventoryConfig: true,
  unitType: UnitType.PIECE,
  minQty: new Prisma.Decimal(1),
  qtyStep: new Prisma.Decimal(1),
};

test("inventory configuration prevents changing PIECE to METER", () => {
  assert.throws(
    () => assertProductInventoryCompatibility({ ...integerState, unitType: UnitType.METER }),
    (error: unknown) => error instanceof ProductInventoryCompatibilityError
  );
});

test("inventory configuration prevents fractional minQty and qtyStep", () => {
  assert.throws(
    () => assertProductInventoryCompatibility({ ...integerState, minQty: new Prisma.Decimal("0.5") }),
    (error: unknown) => error instanceof ProductInventoryCompatibilityError
  );
  assert.throws(
    () => assertProductInventoryCompatibility({ ...integerState, qtyStep: new Prisma.Decimal("0.5") }),
    (error: unknown) => error instanceof ProductInventoryCompatibilityError
  );
});

test("disabled inventory config remains protected and products without config keep prior behavior", () => {
  assert.doesNotThrow(() => assertProductInventoryCompatibility(integerState));
  assert.doesNotThrow(() => assertProductInventoryCompatibility({
    ...integerState,
    hasInventoryConfig: false,
    unitType: UnitType.METER,
    minQty: new Prisma.Decimal("0.5"),
    qtyStep: new Prisma.Decimal("0.5"),
  }));
});
