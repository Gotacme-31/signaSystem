import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(process.cwd(), "../..");
const controller = readFileSync(resolve(root, "apps/api/src/controllers/public-tracking.controller.ts"), "utf8");
const routes = readFileSync(resolve(root, "apps/api/src/routes/public-tracking.routes.ts"), "utf8");
const orderController = readFileSync(resolve(root, "apps/api/src/controllers/order.controller.ts"), "utf8");
const inventory = readFileSync(resolve(root, "apps/api/src/services/inventory.service.ts"), "utf8");
const cancellation = readFileSync(resolve(root, "apps/api/src/services/order-cancellation.service.ts"), "utf8");
const cancellationStart = orderController.indexOf("export async function cancelOrder");
const cancellationEnd = orderController.indexOf("export async function deleteOrder", cancellationStart);
const cancellationFlow = orderController.slice(cancellationStart, cancellationEnd);
const schema = readFileSync(resolve(root, "packages/db/prisma/schema.prisma"), "utf8");
const migration = readFileSync(resolve(root, "packages/db/prisma/migrations/20260909120000_add_public_tracking_token/migration.sql"), "utf8");
const rateLimit = readFileSync(resolve(root, "apps/api/src/middlewares/publicTrackingRateLimit.ts"), "utf8");
const publicDtoStart = controller.indexOf("return res.json({");
const publicDto = controller.slice(publicDtoStart, controller.indexOf("});", publicDtoStart) + 3);

test("schema and migration are additive and nullable without historical backfill", () => {
  assert.match(schema, /publicTrackingToken\s+String\?\s+@unique/);
  assert.match(schema, /publicTrackingTokenCreatedAt\s+DateTime\?/);
  assert.match(migration, /ADD COLUMN "publicTrackingToken" TEXT/);
  assert.match(migration, /ADD COLUMN "publicTrackingTokenCreatedAt" TIMESTAMP\(3\)/);
  assert.match(migration, /CREATE UNIQUE INDEX "Order_publicTrackingToken_key"/);
  assert.doesNotMatch(migration, /UPDATE|DELETE|DROP|TRUNCATE|INSERT/i);
});

test("public route is unauthenticated, cache-disabled, minimal, and generic on misses", () => {
  assert.match(routes, /router\.get\("\/track\/:token", publicTrackingRateLimit, getPublicOrderTracking\)/);
  assert.doesNotMatch(routes, /auth/);
  assert.match(controller, /res\.set\("Cache-Control", "no-store"\)/);
  assert.match(controller, /where: \{ publicTrackingToken: token \}/);
  assert.match(controller, /select: \{/);
  assert.doesNotMatch(controller, /include:/);
  assert.doesNotMatch(publicDto, /customer|phone|email|address|notes|products|items|files|subtotal|total|payments|users|branches|shippingStage|scheduling|capacity|inventory|parameters/);
  assert.match(controller, /Pedido no encontrado/);
});

test("public DTO exposes only the pickup branch name, no id, address, or registration/production branch", () => {
  assert.match(controller, /pickupBranch: \{ select: \{ name: true \} \}/);
  assert.match(publicDto, /branchName: order\.pickupBranch\?\.name \?\? null/);
  assert.doesNotMatch(controller, /select: \{[^}]*\bbranch: \{/s);
  assert.doesNotMatch(controller, /pickupBranchId/);
});

test("internal cancellation revokes tracking token and creation generates it inside the transaction", () => {
  assert.match(cancellation, /publicTrackingToken: null/);
  assert.match(cancellation, /publicTrackingTokenCreatedAt: null/);
  assert.match(orderController, /revokePublicTrackingData/);
  assert.doesNotMatch(inventory, /publicTrackingToken/);
  assert.match(cancellationFlow, /const cancellationResult = await prisma\.\$transaction/);
  assert.equal((cancellationFlow.match(/revokePublicTrackingData/g) ?? []).length, 2);
  assert.match(orderController, /publicTrackingToken: generatePublicTrackingToken\(\)/);
  assert.match(orderController, /isPublicTrackingTokenUniqueViolation/);
  assert.match(orderController, /clientRequestId/);
});

test("normal cancellation and inventory-return replay each revoke once inside the transaction", () => {
  assert.doesNotMatch(cancellationFlow, /if \(existingOrder\.inventoryReturnedAt\)/);
  assert.doesNotMatch(cancellationFlow, /prisma\.order\.update/);
  assert.match(cancellationFlow, /if \(!inventoryReturn\.returned\)[\s\S]*idempotent: true/);
  assert.match(cancellationFlow, /releaseOrderProductionReservations\(tx, orderId\)[\s\S]*revokePublicTrackingData/);
  assert.match(cancellation, /publicTrackingToken: null/);
  assert.match(cancellation, /publicTrackingTokenCreatedAt: null/);
});

test("internal tracking endpoints keep role and branch authorization separate from the public route", () => {
  assert.match(orderController, /TRACKING_LINK_ROLES = new Set\(\["ADMIN", "STAFF", "COUNTER", "MULTI_COUNTER"\]\)/);
  assert.match(orderController, /canAccessOrderByBranches\(authUser\.role, accessibleBranchIds, order\.branchId, order\.pickupBranchId\)/);
  assert.match(orderController, /authUser\.role !== "ADMIN"/);
  assert.match(orderController, /buildOrderTrackingResponse\(access\.order\.id, link\.token, trackingBaseUrl\)/);
  assert.match(orderController, /buildOrderTrackingResponse\(link\.id, link\.publicTrackingToken, trackingBaseUrl\)/);
  assert.match(orderController, /ensurePublicTrackingToken\(prisma, orderId\)/);
  assert.doesNotMatch(orderController.slice(
    orderController.indexOf("export async function getOrderTrackingLink"),
    orderController.indexOf("function resolveSelectedParams")
  ), /findFirst|createdAt:\s*["']desc["']/);
  assert.match(routes, /\/track\/:token/);
});

test("tracking link generation has one production URL configuration and no localhost fallback there", () => {
  const tracking = readFileSync(resolve(root, "apps/api/src/services/public-tracking.service.ts"), "utf8");
  const index = readFileSync(resolve(root, "apps/api/src/index.ts"), "utf8");
  assert.match(tracking, /process\.env\.PUBLIC_WEB_URL/);
  assert.match(tracking, /environment === "production"/);
  assert.match(tracking, /PublicTrackingConfigurationError/);
  assert.match(tracking, /http:\/\/localhost:5173/);
  assert.match(index, /app\.set\("trust proxy", 1\)/);
  assert.match(rateLimit, /req\.ip/);
  assert.doesNotMatch(rateLimit, /X-Forwarded-For/);
});
