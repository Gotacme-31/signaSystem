import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = readFileSync(
  resolve(process.cwd(), "../../packages/db/prisma/migrations/20260821120000_add_branch_inventory_v1/migration.sql"),
  "utf8"
);

test("inventory migration defines PRODUCT and VARIANT tracking from the start", () => {
  assert.match(migration, /CREATE TYPE "InventoryTrackingMode" AS ENUM \('PRODUCT', 'VARIANT'\)/);
  assert.match(migration, /"trackingMode" "InventoryTrackingMode" NOT NULL/);
  assert.match(migration, /"variantId" INTEGER/);
  assert.doesNotMatch(migration, /'ORDER_DELETED'/);
  assert.doesNotMatch(migration, /ADD COLUMN "deletedAt"/);
  assert.doesNotMatch(migration, /ADD COLUMN "deletedById"/);
  assert.doesNotMatch(migration, /ADD COLUMN "deleteReason"/);
});

test("inventory migration uniquely protects product and variant balances", () => {
  assert.match(migration, /CREATE UNIQUE INDEX "BranchInventoryBalance_product_key"[\s\S]*WHERE "variantId" IS NULL/);
  assert.match(migration, /CREATE UNIQUE INDEX "BranchInventoryBalance_variant_key"[\s\S]*WHERE "variantId" IS NOT NULL/);
});

test("variant FK and stock checks preserve inventory history", () => {
  assert.match(migration, /REFERENCES "ProductVariant"\("id"\) ON DELETE RESTRICT/);
  assert.match(migration, /CHECK \("currentStock" >= 0\)/);
  assert.match(migration, /CHECK \("stockAfter" = "stockBefore" \+ "deltaQty"\)/);
  assert.doesNotMatch(migration, /\b(DROP|DELETE FROM|UPDATE "|INSERT INTO)\b/);
});
