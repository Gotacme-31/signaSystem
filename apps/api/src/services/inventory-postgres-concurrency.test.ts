import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { PaymentMethod, Prisma, PrismaClient, ShippingType, UnitType, UserRole } from "@prisma/client";
import {
  applyInventoryToCreatedOrder,
  InventoryError,
  prepareInventoryForHardDelete,
} from "./inventory.service";

const testDatabaseUrl = process.env.INVENTORY_TEST_DATABASE_URL;
const runPostgresTests = process.env.RUN_INVENTORY_POSTGRES_TESTS === "1";
const safeToRun = !!testDatabaseUrl
  && runPostgresTests
  && testDatabaseUrl !== process.env.DATABASE_URL;

test("PostgreSQL serializes same-balance sales and rolls back multi-balance shortage", {
  skip: safeToRun ? false : "Set a dedicated INVENTORY_TEST_DATABASE_URL and RUN_INVENTORY_POSTGRES_TESTS=1",
}, async () => {
  const databaseUrl = testDatabaseUrl!;
  const main = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const clientA = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const clientB = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const suffix = randomUUID();
  let branchId: number | null = null;
  let userId: number | null = null;
  let customerId: number | null = null;
  const productIds: number[] = [];

  try {
    const branch = await main.branch.create({ data: { name: `INV TEST ${suffix}` } });
    branchId = branch.id;
    const user = await main.user.create({
      data: {
        username: `inv-${suffix}`,
        name: "Inventory Test",
        passwordHash: "not-used",
        role: UserRole.ADMIN,
        branchId,
      },
    });
    userId = user.id;
    const customer = await main.customer.create({
      data: { name: "Inventory Test", phone: `test-${suffix}` },
    });
    customerId = customer.id;

    async function createTrackedProduct(name: string, stock: number) {
      const product = await main.product.create({
        data: { name: `${name} ${suffix}`, unitType: UnitType.PIECE },
      });
      productIds.push(product.id);
      const branchProduct = await main.branchProduct.create({
        data: { branchId: branch.id, productId: product.id, isActive: true, price: new Prisma.Decimal(1) },
      });
      const config = await main.branchInventoryConfig.create({
        data: { branchProductId: branchProduct.id, isEnabled: true, trackingMode: "PRODUCT" },
      });
      const balance = await main.branchInventoryBalance.create({
        data: { inventoryConfigId: config.id, variantId: null, currentStock: stock },
      });
      return { product, balance };
    }

    const king = await createTrackedProduct("King", 10);
    let arrivals = 0;
    let releaseBarrier!: () => void;
    const barrier = new Promise<void>((resolve) => { releaseBarrier = resolve; });

    async function concurrentSale(client: PrismaClient, label: string) {
      return client.$transaction(async (tx) => {
        const order = await tx.order.create({
          data: {
            branchId: branch.id,
            pickupBranchId: branch.id,
            customerId: customer.id,
            createdBy: user.id,
            shippingType: ShippingType.PICKUP,
            paymentMethod: PaymentMethod.CASH,
            deliveryDate: new Date(Date.now() + 86_400_000),
            notes: `${suffix}:${label}`,
          },
        });
        const item = await tx.orderItem.create({
          data: {
            orderId: order.id,
            productId: king.product.id,
            productNameSnapshot: king.product.name,
            unitTypeSnapshot: UnitType.PIECE,
            quantity: new Prisma.Decimal(8),
            unitPrice: new Prisma.Decimal(1),
            subtotal: new Prisma.Decimal(8),
            productionStep: "AUTO",
          },
        });
        arrivals += 1;
        if (arrivals === 2) releaseBarrier();
        await barrier;
        await applyInventoryToCreatedOrder(tx, {
          branchId: branch.id,
          orderId: order.id,
          actorId: user.id,
          items: [{
            orderItemId: item.id,
            productId: king.product.id,
            productName: king.product.name,
            quantity: new Prisma.Decimal(8),
            variantId: null,
            isCustomProduct: false,
          }],
        });
        return order.id;
      });
    }

    const results = await Promise.allSettled([
      concurrentSale(clientA, "A"),
      concurrentSale(clientB, "B"),
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    const failure = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
    assert.ok(failure?.reason instanceof InventoryError);
    assert.equal(failure.reason.code, "INSUFFICIENT_STOCK");
    assert.equal((await main.branchInventoryBalance.findUniqueOrThrow({ where: { id: king.balance.id } })).currentStock, 2);
    assert.equal(await main.inventoryMovement.count({
      where: { inventoryBalanceId: king.balance.id, movementType: "ORDER_CREATED" },
    }), 1);

    const createdOrderId = (results.find(
      (result): result is PromiseFulfilledResult<number> => result.status === "fulfilled"
    ))!.value;
    await main.$transaction(async (tx) => {
      await prepareInventoryForHardDelete(tx, { orderId: createdOrderId });
      await tx.order.delete({ where: { id: createdOrderId } });
    });
    assert.equal(await main.order.findUnique({ where: { id: createdOrderId } }), null);
    assert.equal((await main.branchInventoryBalance.findUniqueOrThrow({ where: { id: king.balance.id } })).currentStock, 10);
    assert.equal(await main.inventoryMovement.count({ where: { orderId: createdOrderId } }), 0);

    const matrimonial = await createTrackedProduct("Matrimonial", 1);
    await assert.rejects(
      main.$transaction(async (tx) => {
        const order = await tx.order.create({
          data: {
            branchId: branch.id,
            pickupBranchId: branch.id,
            customerId: customer.id,
            createdBy: user.id,
            shippingType: ShippingType.PICKUP,
            paymentMethod: PaymentMethod.CASH,
            deliveryDate: new Date(Date.now() + 86_400_000),
            notes: `${suffix}:rollback`,
          },
        });
        const first = await tx.orderItem.create({
          data: {
            orderId: order.id,
            productId: king.product.id,
            productNameSnapshot: king.product.name,
            unitTypeSnapshot: UnitType.PIECE,
            quantity: new Prisma.Decimal(8),
            unitPrice: new Prisma.Decimal(1),
            subtotal: new Prisma.Decimal(8),
            productionStep: "AUTO",
          },
        });
        const second = await tx.orderItem.create({
          data: {
            orderId: order.id,
            productId: matrimonial.product.id,
            productNameSnapshot: matrimonial.product.name,
            unitTypeSnapshot: UnitType.PIECE,
            quantity: new Prisma.Decimal(2),
            unitPrice: new Prisma.Decimal(1),
            subtotal: new Prisma.Decimal(2),
            productionStep: "AUTO",
          },
        });
        await applyInventoryToCreatedOrder(tx, {
          branchId: branch.id,
          orderId: order.id,
          actorId: user.id,
          items: [
            { orderItemId: first.id, productId: king.product.id, productName: king.product.name, quantity: new Prisma.Decimal(8), variantId: null, isCustomProduct: false },
            { orderItemId: second.id, productId: matrimonial.product.id, productName: matrimonial.product.name, quantity: new Prisma.Decimal(2), variantId: null, isCustomProduct: false },
          ],
        });
      }),
      (error: unknown) => error instanceof InventoryError && error.code === "INSUFFICIENT_STOCK"
    );
    assert.equal((await main.branchInventoryBalance.findUniqueOrThrow({ where: { id: king.balance.id } })).currentStock, 10);
    assert.equal((await main.branchInventoryBalance.findUniqueOrThrow({ where: { id: matrimonial.balance.id } })).currentStock, 1);
    assert.equal(await main.order.count({ where: { notes: `${suffix}:rollback` } }), 0);
  } finally {
    await main.inventoryMovement.deleteMany({
      where: { inventoryBalance: { inventoryConfig: { branchProduct: { branchId: branchId ?? -1 } } } },
    }).catch(() => undefined);
    await main.order.deleteMany({ where: { notes: { startsWith: suffix } } }).catch(() => undefined);
    await main.branchInventoryBalance.deleteMany({
      where: { inventoryConfig: { branchProduct: { branchId: branchId ?? -1 } } },
    }).catch(() => undefined);
    await main.branchInventoryConfig.deleteMany({
      where: { branchProduct: { branchId: branchId ?? -1 } },
    }).catch(() => undefined);
    await main.branchProduct.deleteMany({ where: { branchId: branchId ?? -1 } }).catch(() => undefined);
    if (productIds.length > 0) await main.product.deleteMany({ where: { id: { in: productIds } } }).catch(() => undefined);
    if (customerId) await main.customer.delete({ where: { id: customerId } }).catch(() => undefined);
    if (userId) await main.user.delete({ where: { id: userId } }).catch(() => undefined);
    if (branchId) await main.branch.delete({ where: { id: branchId } }).catch(() => undefined);
    await Promise.all([main.$disconnect(), clientA.$disconnect(), clientB.$disconnect()]);
  }
});
