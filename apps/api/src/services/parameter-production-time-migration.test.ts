import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "../../packages/db/prisma/migrations/20260907120000_add_parameter_production_time/migration.sql"
  ),
  "utf8"
);

test("parameter production time migration adds only the required columns", () => {
  assert.match(migration, /"BranchProductParamPrice"[\s\S]*"productionTimeMinutesPerUnit" INTEGER/);
  assert.match(migration, /"OrderItemOption"[\s\S]*"appliedTimeMinutesPerUnit" INTEGER NOT NULL DEFAULT 0/);
  assert.match(migration, /"OrderItemOption"[\s\S]*"appliedExtraTimeMinutes" INTEGER NOT NULL DEFAULT 0/);
  assert.match(migration, /"OrderItem"[\s\S]*"baseProductionReadyAt" TIMESTAMP\(3\)/);
});

test("parameter production time migration enforces nonnegative values", () => {
  assert.match(migration, /"productionTimeMinutesPerUnit" IS NULL[\s\S]*OR "productionTimeMinutesPerUnit" >= 0/);
  assert.match(migration, /"appliedTimeMinutesPerUnit" >= 0/);
  assert.match(migration, /"appliedExtraTimeMinutes" >= 0/);
});

test("parameter production time migration is additive and does not backfill history", () => {
  assert.doesNotMatch(migration, /\b(?:UPDATE|DELETE|DROP|TRUNCATE)\b/i);
  assert.doesNotMatch(migration, /"productionTimeMinutesPerUnit" INTEGER[^,;]*DEFAULT/i);
  assert.doesNotMatch(migration, /"baseProductionReadyAt" TIMESTAMP\(3\)[^,;]*DEFAULT/i);
});
