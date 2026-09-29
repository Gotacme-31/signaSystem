import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(process.cwd(), "../..");
const controller = readFileSync(resolve(root, "apps/api/src/controllers/order.controller.ts"), "utf8");
const schema = readFileSync(resolve(root, "packages/db/prisma/schema.prisma"), "utf8");
const migration = readFileSync(
  resolve(root, "packages/db/prisma/migrations/20260923120000_add_user_product_access/migration.sql"),
  "utf8"
);

const listStart = controller.indexOf("export async function listActiveOrders");
const listEnd = controller.indexOf("\n}\n", listStart);
const listActiveOrders = controller.slice(listStart, listEnd);

test("schema and migration for UserProductAccess are additive with cascading FKs and a composite unique", () => {
  assert.match(schema, /model UserProductAccess \{[\s\S]*?@@unique\(\[userId, productId\]\)/);
  assert.match(schema, /user\s+User\s+@relation\(fields: \[userId\], references: \[id\], onDelete: Cascade\)/);
  assert.match(schema, /product\s+Product\s+@relation\(fields: \[productId\], references: \[id\], onDelete: Cascade\)/);
  assert.match(migration, /CREATE TABLE "UserProductAccess"/);
  assert.match(migration, /CREATE UNIQUE INDEX "UserProductAccess_userId_productId_key"/);
  assert.match(migration, /ON DELETE CASCADE ON UPDATE CASCADE/);
  assert.doesNotMatch(migration, /^\s*(UPDATE|DELETE FROM|DROP|TRUNCATE|INSERT)\b/im);
});

test("listActiveOrders only narrows visibility by product for PRODUCTION, and only when the user is restricted", () => {
  const productionBlockStart = listActiveOrders.indexOf('authUser.role === "PRODUCTION"');
  assert.notEqual(productionBlockStart, -1, "expected a role === PRODUCTION branch");

  const productionBlockEnd = listActiveOrders.indexOf("\n    }\n", productionBlockStart);
  const productionBlock = listActiveOrders.slice(productionBlockStart, productionBlockEnd);

  assert.match(productionBlock, /getAllowedProductIdsForUser\(authUser\.userId\)/);
  assert.match(productionBlock, /allowedProductIds !== null/);
  assert.match(productionBlock, /where\.items = \{ some: \{ productId: \{ in: allowedProductIds \} \} \}/);

  // The productId filter must not leak outside the PRODUCTION-only branch.
  const beforeProductionBlock = listActiveOrders.slice(0, productionBlockStart);
  assert.doesNotMatch(beforeProductionBlock, /getAllowedProductIdsForUser/);
  const afterProductionBlock = listActiveOrders.slice(productionBlockEnd);
  assert.doesNotMatch(afterProductionBlock, /getAllowedProductIdsForUser/);
});

test("PRODUCTION branch-scope filtering runs before the product filter, so both narrow the same where clause", () => {
  const branchScopeIndex = listActiveOrders.indexOf("branchScopeWhere(accessibleBranchIds, scope)");
  const productionIndex = listActiveOrders.indexOf('authUser.role === "PRODUCTION"');
  assert.ok(branchScopeIndex !== -1 && productionIndex !== -1 && branchScopeIndex < productionIndex);
});
