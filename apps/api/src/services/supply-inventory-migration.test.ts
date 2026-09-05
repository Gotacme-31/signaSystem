import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = readFileSync(
  resolve(process.cwd(), "../../packages/db/prisma/migrations/20260831120000_add_supply_inventory_v1/migration.sql"),
  "utf8"
);

test("supply migration is additive and defines an independent domain", () => {
  assert.match(migration, /CREATE TYPE "SupplyMovementType"/);
  assert.match(migration, /CREATE TABLE "SupplyItem"/);
  assert.match(migration, /CREATE TABLE "SupplyMovement"/);
  assert.doesNotMatch(migration, /\b(DROP|TRUNCATE|DELETE FROM|UPDATE ")\b/);
  assert.doesNotMatch(migration, /REFERENCES "(Order|OrderItem|Product|BranchProduct|ProductVariant)"/);
});

test("supply migration protects branch-local identity and history", () => {
  assert.match(migration, /UNIQUE INDEX "SupplyItem_branchId_normalizedName_key"[\s\S]*\("branchId", "normalizedName"\)/);
  assert.match(migration, /"creationOperationKey" TEXT,/);
  assert.match(migration, /"creationRequestHash" TEXT,/);
  assert.doesNotMatch(migration, /"creationOperationKey" TEXT NOT NULL/);
  assert.doesNotMatch(migration, /"creationRequestHash" TEXT NOT NULL/);
  assert.match(migration, /UNIQUE INDEX "SupplyItem_creationOperationKey_key"[\s\S]*\("creationOperationKey"\)/);
  assert.match(migration, /"creationOperationKey" IS NULL AND "creationRequestHash" IS NULL/);
  assert.match(migration, /REFERENCES "Branch"\("id"\) ON DELETE RESTRICT/);
  assert.match(migration, /REFERENCES "SupplyItem"\("id"\) ON DELETE RESTRICT/);
  assert.match(migration, /REFERENCES "User"\("id"\) ON DELETE SET NULL/);
});

test("supply migration enforces nonnegative balances and consistent movements", () => {
  assert.match(migration, /CHECK \("currentStock" >= 0\)/);
  assert.match(migration, /CHECK \("lowStockThreshold" IS NULL OR "lowStockThreshold" >= 0\)/);
  assert.match(migration, /CHECK \("version" >= 0\)/);
  assert.match(migration, /CHECK \("stockAfter" = "stockBefore" \+ "deltaQty"\)/);
});

test("supply movement constraints reject every zero-delta movement", () => {
  assert.match(migration, /'INITIAL_STOCK'[\s\S]*"deltaQty" > 0/);
  assert.match(migration, /'RESTOCK'[\s\S]*"deltaQty" > 0/);
  assert.match(migration, /'MANUAL_REMOVE'[\s\S]*"deltaQty" < 0/);
  assert.match(migration, /'ADJUSTMENT'[\s\S]*"deltaQty" <> 0/);
  assert.match(migration, /"movementType" NOT IN \('MANUAL_REMOVE', 'ADJUSTMENT'\)/);
});
