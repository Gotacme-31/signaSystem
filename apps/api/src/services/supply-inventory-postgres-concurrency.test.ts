import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { PrismaClient, UserRole } from "@prisma/client";
import {
  SupplyInventoryError,
  removeSupplyItemStock,
} from "./supply-inventory.service";

const testDatabaseUrl = process.env.SUPPLY_TEST_DATABASE_URL;
const runPostgresTests = process.env.RUN_SUPPLY_POSTGRES_TESTS === "1";
const safeToRun = !!testDatabaseUrl
  && runPostgresTests
  && testDatabaseUrl !== process.env.DATABASE_URL;

test("PostgreSQL serializes concurrent supply removals without negative stock", {
  skip: safeToRun
    ? false
    : "Set a dedicated SUPPLY_TEST_DATABASE_URL and RUN_SUPPLY_POSTGRES_TESTS=1",
}, async () => {
  const databaseUrl = testDatabaseUrl!;
  const main = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const clientA = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const clientB = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const suffix = randomUUID();
  let branchId: number | null = null;
  let userId: number | null = null;
  let supplyItemId: number | null = null;

  try {
    const branch = await main.branch.create({ data: { name: `SUPPLY TEST ${suffix}` } });
    branchId = branch.id;
    const user = await main.user.create({
      data: {
        username: `supply-${suffix}`,
        name: "Supply Test",
        passwordHash: "not-used",
        role: UserRole.ADMIN,
        branchId,
      },
    });
    userId = user.id;
    const supply = await main.supplyItem.create({
      data: {
        branchId,
        name: `Tinta ${suffix}`,
        normalizedName: `tinta ${suffix}`,
        unitLabel: "botella",
        currentStock: 5,
      },
    });
    supplyItemId = supply.id;

    let arrivals = 0;
    let releaseBarrier!: () => void;
    const barrier = new Promise<void>((resolve) => { releaseBarrier = resolve; });

    async function concurrentRemoval(client: PrismaClient, operationKey: string) {
      arrivals += 1;
      if (arrivals === 2) releaseBarrier();
      await barrier;
      return removeSupplyItemStock(client, {
        supplyItemId: supply.id,
        actorId: user.id,
        body: { quantity: 4, reason: "Prueba concurrente", operationKey },
      });
    }

    const results = await Promise.allSettled([
      concurrentRemoval(clientA, `remove-a-${suffix}`),
      concurrentRemoval(clientB, `remove-b-${suffix}`),
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    const failure = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
    assert.ok(failure?.reason instanceof SupplyInventoryError);
    assert.equal(failure.reason.code, "INSUFFICIENT_SUPPLY_STOCK");
    assert.equal((await main.supplyItem.findUniqueOrThrow({ where: { id: supply.id } })).currentStock, 1);
    assert.equal(await main.supplyMovement.count({ where: { supplyItemId: supply.id } }), 1);
  } finally {
    if (supplyItemId) {
      await main.supplyMovement.deleteMany({ where: { supplyItemId } }).catch(() => undefined);
      await main.supplyItem.delete({ where: { id: supplyItemId } }).catch(() => undefined);
    }
    if (userId) await main.user.delete({ where: { id: userId } }).catch(() => undefined);
    if (branchId) await main.branch.delete({ where: { id: branchId } }).catch(() => undefined);
    await Promise.all([main.$disconnect(), clientA.$disconnect(), clientB.$disconnect()]);
  }
});
