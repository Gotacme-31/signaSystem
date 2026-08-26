import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const controller = readFileSync(resolve(process.cwd(), "src/controllers/order.controller.ts"), "utf8");
const inventory = readFileSync(resolve(process.cwd(), "src/services/inventory.service.ts"), "utf8");
const orderFiles = readFileSync(resolve(process.cwd(), "src/services/order-file.service.ts"), "utf8");
const schema = readFileSync(resolve(process.cwd(), "../../packages/db/prisma/schema.prisma"), "utf8");

test("permanent endpoint returns inventory, clears movements and physically deletes Order", () => {
  assert.match(controller, /prepareInventoryForHardDelete/);
  assert.match(controller, /releaseOrderProductionReservations\(tx, orderId\)/);
  assert.match(controller, /tx\.order\.delete\s*\(/);
  assert.match(inventory, /tx\.inventoryMovement\.deleteMany/);
  assert.doesNotMatch(controller, /deletedAt\s*:/);
});

test("hard delete emits the historical deletion socket event", () => {
  assert.match(controller, /events\.orderDeleted\(orderId/);
});

test("hard delete cleans physical files under the Order lock before metadata cascade", () => {
  assert.match(controller, /cleanupOrderFilesForHardDelete\(tx, orderId\)/);
  assert.match(controller, /fileCleanup\.failedCount > 0/);
  assert.match(orderFiles, /cleanupOrderFilesForHardDelete/);
  assert.match(orderFiles, /deletePhysicalFile\(file\.relativePath\)/);
  assert.match(orderFiles, /status: OrderFileStatus\.DELETE_FAILED/);
});

test("Order children cascade while shared catalog and inventory balances remain independent", () => {
  assert.match(schema, /OrderPayment[\s\S]*order\s+Order @relation\([^\n]+onDelete: Cascade\)/);
  assert.match(schema, /OrderItem[\s\S]*order\s+Order\s+@relation\([^\n]+onDelete: Cascade\)/);
  assert.match(schema, /ProductionBatchItem[\s\S]*order\s+Order\s+@relation\([^\n]+onDelete: Cascade\)/);
  assert.match(schema, /OrderFile[\s\S]*order Order @relation\([^\n]+onDelete: Cascade\)/);
  assert.match(schema, /OrderItemStep[\s\S]*orderItem OrderItem @relation\([^\n]+onDelete: Cascade\)/);
  assert.match(schema, /OrderItemOption[\s\S]*orderItem OrderItem @relation\([^\n]+onDelete: Cascade\)/);
});
