import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import {
  PaymentMethod,
  PrismaClient,
  ShippingType,
  UnitType,
  UserRole,
} from "@prisma/client";
import { businessDateKeyFromDate } from "../lib/business-time";
import {
  dashboardRecentOrdersQuery,
  normalizeDashboardFilters,
} from "./dashboard-sales.service";

const testDatabaseUrl = process.env.DASHBOARD_TEST_DATABASE_URL;
const runPostgresTests = process.env.RUN_DASHBOARD_POSTGRES_TESTS === "1";
const safeToRun = !!testDatabaseUrl
  && runPostgresTests
  && testDatabaseUrl !== process.env.DATABASE_URL;

function chunksOf<T>(values: T[], size: number) {
  const chunks: T[][] = [];
  for (let start = 0; start < values.length; start += size) {
    chunks.push(values.slice(start, start + size));
  }
  return chunks;
}

test("PostgreSQL recent dashboard orders support more than 32768 matching orders", {
  skip: safeToRun
    ? false
    : "Set a dedicated DASHBOARD_TEST_DATABASE_URL and RUN_DASHBOARD_POSTGRES_TESTS=1",
  timeout: 180_000,
}, async () => {
  const db = new PrismaClient({ datasources: { db: { url: testDatabaseUrl! } } });
  const suffix = randomUUID();
  const createdAt = new Date();
  const dateKey = businessDateKeyFromDate(createdAt);
  let branchId: number | null = null;
  let userId: number | null = null;
  let customerId: number | null = null;
  let productId: number | null = null;

  try {
    const databaseIdentity = await db.$queryRaw<Array<{ databaseName: string }>>`
      SELECT current_database() AS "databaseName"
    `;
    const databaseName = databaseIdentity[0]?.databaseName ?? "";
    if (!/(^|[_-])test($|[_-])/i.test(databaseName)) {
      throw new Error(`DASHBOARD_TEST_DATABASE_URL debe apuntar a una base dedicada con "test" en el nombre; recibido: ${databaseName}`);
    }

    const branch = await db.branch.create({ data: { name: `DASHBOARD TEST ${suffix}` } });
    branchId = branch.id;
    const user = await db.user.create({
      data: {
        username: `dashboard-${suffix}`,
        name: "Dashboard Test",
        passwordHash: "not-used",
        role: UserRole.ADMIN,
        branchId,
      },
    });
    userId = user.id;
    const customer = await db.customer.create({
      data: { name: "Dashboard Test", phone: `dashboard-${suffix}` },
    });
    customerId = customer.id;
    const product = await db.product.create({
      data: { name: `Dashboard Product ${suffix}`, unitType: UnitType.PIECE },
    });
    productId = product.id;

    const orderInputs = Array.from({ length: 32_769 }, (_, index) => ({
      branchId: branch.id,
      pickupBranchId: branch.id,
      customerId: customer.id,
      createdBy: user.id,
      shippingType: ShippingType.PICKUP,
      paymentMethod: PaymentMethod.CASH,
      deliveryDate: createdAt,
      notes: `${suffix}:${index}`,
      createdAt,
    }));
    for (const chunk of chunksOf(orderInputs, 500)) {
      await db.order.createMany({ data: chunk });
    }

    const orders = await db.order.findMany({
      where: { notes: { startsWith: suffix } },
      select: { id: true },
      orderBy: { id: "asc" },
    });
    assert.equal(orders.length, 32_769);
    const itemInputs = orders.map((order) => ({
      orderId: order.id,
      productId: product.id,
      productNameSnapshot: product.name,
      unitTypeSnapshot: UnitType.PIECE,
      quantity: 1,
      unitPrice: 1,
      subtotal: 1,
      productionStep: "AUTO",
    }));
    for (const chunk of chunksOf(itemInputs, 500)) {
      await db.orderItem.createMany({ data: chunk });
    }

    const filters = normalizeDashboardFilters({
      startDate: dateKey,
      endDate: dateKey,
      branchIds: String(branch.id),
      productIds: String(product.id),
    });
    const recent = await db.order.findMany(dashboardRecentOrdersQuery(filters));
    assert.equal(recent.length, 20);
    assert.deepEqual(
      recent.map((order) => order.id),
      orders.slice(-20).reverse().map((order) => order.id)
    );
  } finally {
    await db.order.deleteMany({ where: { notes: { startsWith: suffix } } }).catch(() => undefined);
    if (productId) await db.product.delete({ where: { id: productId } }).catch(() => undefined);
    if (customerId) await db.customer.delete({ where: { id: customerId } }).catch(() => undefined);
    if (userId) await db.user.delete({ where: { id: userId } }).catch(() => undefined);
    if (branchId) await db.branch.delete({ where: { id: branchId } }).catch(() => undefined);
    await db.$disconnect();
  }
});
