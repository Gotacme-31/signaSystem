import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { buildPaymentMethodsFromOrderRevenue } from "../controllers/dashboard.controller";

test("payment lookup processes more than 32768 orders sequentially in bounded chunks", async () => {
  const orderIds = Array.from({ length: 32_769 }, (_, index) => index + 1);
  const chunkSizes: number[] = [];
  let activeQueries = 0;
  let maxActiveQueries = 0;

  const result = await buildPaymentMethodsFromOrderRevenue(
    orderIds,
    new Map(),
    new Map(),
    async (chunk) => {
      chunkSizes.push(chunk.length);
      activeQueries += 1;
      maxActiveQueries = Math.max(maxActiveQueries, activeQueries);
      await new Promise<void>((resolve) => setImmediate(resolve));
      activeQueries -= 1;
      return [];
    }
  );

  assert.deepEqual(result, []);
  assert.deepEqual(chunkSizes, [5_000, 5_000, 5_000, 5_000, 5_000, 5_000, 2_769]);
  assert.ok(chunkSizes.every((size) => size <= 5_000));
  assert.equal(maxActiveQueries, 1);
});

test("chunked payments preserve split, partial, repeated-method and overpayment semantics", async () => {
  const payments = [
    { orderId: 1, method: "CASH", amount: new Prisma.Decimal(100) },
    { orderId: 1, method: "CARD", amount: new Prisma.Decimal(100) },
    { orderId: 2, method: "TRANSFER", amount: new Prisma.Decimal(116) },
    { orderId: 3, method: "CASH", amount: new Prisma.Decimal(60) },
    { orderId: 3, method: "CASH", amount: new Prisma.Decimal(50) },
    { orderId: 4, method: "CASH", amount: new Prisma.Decimal(10) },
    { orderId: 5, method: "CASH", amount: new Prisma.Decimal(50) },
  ];
  const orderRevenueById = new Map([
    [1, 100],
    [2, 29],
    [3, 100],
    [4, 20],
    [5, 80],
  ]);
  const orderTotalById = new Map([
    [1, 200],
    [2, 116],
    [3, 100],
    [4, 0],
    [5, 100],
  ]);

  const result = await buildPaymentMethodsFromOrderRevenue(
    [1, 2, 3, 4, 5],
    orderRevenueById,
    orderTotalById,
    async (chunk) => payments.filter((payment) => chunk.includes(payment.orderId))
  );

  assert.deepEqual(result, [
    { method: "CASH", count: 3, revenue: 200 },
    { method: "CARD", count: 1, revenue: 50 },
    { method: "TRANSFER", count: 1, revenue: 29 },
  ]);
});
