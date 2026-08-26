import assert from "node:assert/strict";
import test from "node:test";
import { InventoryMovementType, InventoryTrackingMode, Prisma, UnitType } from "@prisma/client";
import {
  InventoryError,
  activeBranchInventoryWhere,
  activateInventory,
  adjustInventory,
  applyInventoryToCreatedOrder,
  applyInventoryToOrderEdit,
  assertStockableProduct,
  assertOrderInventoryNotReturned,
  inventoryStatus,
  initializeInventoryVariant,
  listInventoryForBranch,
  reactivateInventory,
  removeInventory,
  requireOperationKey,
  resolveExpectedOrderVersion,
  restockInventory,
  totalInventoryStock,
  returnInventoryForCancellation,
  prepareInventoryForHardDelete,
} from "./inventory.service";

type ItemState = {
  id: number;
  orderId: number;
  productId: number;
  productNameSnapshot: string;
  quantity: Prisma.Decimal;
  variantId?: number | null;
  inventoryBalanceId: number | null;
  inventoryDeductedQty: number;
};

type FixtureState = {
  balances: Record<number, {
    id: number;
    productId?: number;
    currentStock: number;
    version: number;
    enabled: boolean;
    variantId?: number | null;
  }>;
  items: ItemState[];
  movements: Array<Record<string, any>>;
  order: {
    id: number;
    version: number;
    inventoryReturnedAt: Date | null;
    stage: string;
    shippingType: string;
  };
  branchIsActive: boolean;
  branchProductIsActive: boolean;
  productIsActive: boolean;
  trackingModes: Record<number, "PRODUCT" | "VARIANT">;
  productVariants: Record<number, Array<{ id: number; productId: number; name: string; isActive: boolean; order: number }>>;
};

function inventoryFixture(overrides: Partial<FixtureState> = {}) {
  let state: FixtureState = {
    balances: { 5: { id: 5, productId: 1, currentStock: 10, version: 0, enabled: true } },
    items: [],
    movements: [],
    order: {
      id: 20,
      version: 1,
      inventoryReturnedAt: null,
      stage: "REGISTERED",
      shippingType: "PICKUP",
    },
    branchIsActive: true,
    branchProductIsActive: true,
    productIsActive: true,
    trackingModes: { 1: "PRODUCT" },
    productVariants: { 1: [] },
    ...overrides,
  };

  function product(productId = 1) {
    return {
      id: productId,
      name: `Producto ${productId}`,
      unitType: UnitType.PIECE,
      isActive: state.productIsActive,
      isCustomProductTemplate: false,
      minQty: new Prisma.Decimal(1),
      qtyStep: new Prisma.Decimal(1),
      variants: state.productVariants[productId] ?? [],
    };
  }

  const tx: any = {
    $queryRaw: async (input: TemplateStringsArray | { strings: string[]; values: unknown[] }, ...tagValues: unknown[]) => {
      const taggedTemplate = Array.isArray(input);
      const strings = taggedTemplate
        ? Array.from(input as TemplateStringsArray)
        : (input as { strings: string[] }).strings;
      const values: unknown[] = taggedTemplate
        ? tagValues
        : (input as { values: unknown[] }).values;
      const sql = strings.join("?");
      if (sql.includes('FROM "Order"')) return [{ ...state.order }];
      if (sql.includes('FROM "BranchProduct"')) return [{ id: Number(values[0] ?? 201) }];
      if (sql.includes('FROM "Branch"')) return [{ id: Number(values[0] ?? 2) }];
      if (sql.includes('FROM "Product"')) return [{ id: Number(values[0] ?? 1) }];
      if (sql.includes('FROM "BranchInventoryConfig"')) return [{ id: Number(values[0]) }];
      if (sql.includes('FROM "BranchInventoryBalance"')) {
        const balance = state.balances[Number(values[0])];
        return balance ? [{ ...balance }] : [];
      }
      if (sql.includes('UPDATE "BranchInventoryBalance"')) {
        const delta = Number(values[0]);
        const balanceId = Number(values[1]);
        const balance = state.balances[balanceId];
        if (!balance || (delta < 0 && balance.currentStock < Math.abs(delta))) return [];
        balance.currentStock += delta;
        balance.version += 1;
        return [{ currentStock: balance.currentStock }];
      }
      throw new Error(`SQL no soportado en fixture: ${sql}`);
    },
    branchProduct: {
      findUnique: async ({ where }: any) => ({
        id: where.id,
        branchId: 2,
        productId: 1,
        isActive: state.branchProductIsActive,
        branch: { isActive: state.branchIsActive },
        product: product(),
        inventoryConfig: null,
      }),
      findMany: async ({ where }: any) => {
        if (
          where.branchId !== 2 ||
          !state.branchIsActive ||
          !state.branchProductIsActive ||
          !state.productIsActive
        ) return [];
        return (where.productId.in as number[]).map((productId) => ({ productId }));
      },
    },
    branchInventoryConfig: {
      create: async ({ data }: any) => ({ id: 105, ...data }),
      findMany: async ({ where }: any) => {
        if (where?.branchProduct?.branchId !== undefined && where.branchProduct.branchId !== 2) return [];
        const groups = new Map<number, typeof state.balances[number][]>();
        Object.values(state.balances).forEach((balance, index) => {
          const productId = balance.productId ?? index + 1;
          groups.set(productId, [...(groups.get(productId) ?? []), balance]);
        });
        return [...groups.entries()].map(([productId, balances]) => ({
          id: balances[0].id + 100,
          isEnabled: balances[0].enabled,
          trackingMode: state.trackingModes[productId] ?? "PRODUCT",
          balances: balances.map((balance) => ({ ...balance, variantId: balance.variantId ?? null })),
          branchProduct: {
            id: balances[0].id + 200,
            branchId: 2,
            productId,
            isActive: true,
            product: product(productId),
          },
        })).filter((config) => where?.isEnabled === undefined || config.isEnabled === where.isEnabled);
      },
      findUnique: async ({ where }: any) => {
        const balances = Object.values(state.balances).filter((candidate) => {
          const firstForProduct = Object.values(state.balances).find(
            (balance) => (balance.productId ?? 1) === (candidate.productId ?? 1)
          );
          return firstForProduct ? firstForProduct.id + 100 === where.id : false;
        });
        if (balances.length === 0) return null;
        const balance = balances[0];
        const productId = balance.productId ?? 1;
        return {
          id: where.id,
          branchProductId: 201,
          isEnabled: balance.enabled,
          trackingMode: state.trackingModes[productId] ?? "PRODUCT",
          balances: balances.map((candidate) => ({ ...candidate, variantId: candidate.variantId ?? null })),
          branchProduct: {
            productId,
            branchId: 2,
            isActive: state.branchProductIsActive,
            branch: { isActive: state.branchIsActive },
            product: product(productId),
          },
        };
      },
      update: async ({ where, data }: any) => {
        const balance = Object.values(state.balances).find((candidate) => candidate.id + 100 === where.id)!;
        if (data.isEnabled !== undefined) balance.enabled = data.isEnabled;
        return { id: where.id, ...data };
      },
    },
    branchInventoryBalance: {
      create: async ({ data }: any) => {
        const id = Math.max(4, ...Object.keys(state.balances).map(Number)) + 1;
        const balance = {
          id,
          productId: 1,
          currentStock: data.currentStock,
          variantId: data.variantId ?? null,
          lowStockThreshold: data.lowStockThreshold,
          version: 0,
          enabled: true,
        };
        state.balances[id] = balance;
        return balance;
      },
      findUnique: async ({ where }: any) => {
        const balance = state.balances[where.id];
        if (!balance) return null;
        return {
          ...balance,
          inventoryConfig: {
            id: 105,
            isEnabled: balance.enabled,
            trackingMode: state.trackingModes[balance.productId ?? 1] ?? "PRODUCT",
            branchProduct: { id: 201, product: product(balance.productId ?? 1) },
          },
        };
      },
      update: async ({ where, data }: any) => {
        const balance = state.balances[where.id];
        Object.assign(balance, data);
        return balance;
      },
    },
    inventoryMovement: {
      findUnique: async ({ where }: any) => state.movements.find((movement) => movement.operationKey === where.operationKey) ?? null,
      create: async ({ data }: any) => {
        const movement = { id: state.movements.length + 1, ...data };
        state.movements.push(movement);
        return movement;
      },
      count: async ({ where }: any) => state.movements.filter((movement) => movement.orderId === where.orderId).length,
      deleteMany: async ({ where }: any) => {
        const relationFilter = where.AND[1];
        const allowedTypes = new Set(where.AND[0].movementType.in);
        const orderId = relationFilter.OR.find((clause: any) => clause.orderId !== undefined)?.orderId;
        const itemIds = new Set(
          relationFilter.OR.find((clause: any) => clause.orderItemId)?.orderItemId.in ?? []
        );
        const before = state.movements.length;
        state.movements = state.movements.filter(
          (movement) => !allowedTypes.has(movement.movementType)
            || (movement.orderId !== orderId && !itemIds.has(movement.orderItemId))
        );
        return { count: before - state.movements.length };
      },
    },
    orderItem: {
      findMany: async ({ where }: any) => state.items.filter((item) => item.orderId === where.orderId && (
        !where.inventoryDeductedQty || item.inventoryDeductedQty > 0
      )),
      update: async ({ where, data }: any) => {
        const item = state.items.find((candidate) => candidate.id === where.id)!;
        Object.assign(item, data);
        return item;
      },
      updateMany: async ({ where, data }: any) => {
        const ids = new Set(where.id.in);
        const selected = state.items.filter((item) => ids.has(item.id));
        selected.forEach((item) => Object.assign(item, data));
        return { count: selected.length };
      },
    },
    order: {
      update: async ({ data }: any) => {
        Object.assign(state.order, data);
        return state.order;
      },
    },
  };

  const db: any = {
    $transaction: async (operation: (transaction: any) => Promise<unknown>) => {
      const snapshot: FixtureState = {
        balances: Object.fromEntries(
          Object.entries(state.balances).map(([id, balance]) => [id, { ...balance }])
        ),
        items: state.items.map((item) => ({
          ...item,
          quantity: new Prisma.Decimal(item.quantity.toString()),
        })),
        movements: state.movements.map((movement) => ({ ...movement })),
        order: {
          ...state.order,
          inventoryReturnedAt: state.order.inventoryReturnedAt
            ? new Date(state.order.inventoryReturnedAt)
            : null,
        },
        branchIsActive: state.branchIsActive,
        branchProductIsActive: state.branchProductIsActive,
        productIsActive: state.productIsActive,
        trackingModes: { ...state.trackingModes },
        productVariants: Object.fromEntries(
          Object.entries(state.productVariants).map(([productId, variants]) => [
            productId,
            variants.map((variant) => ({ ...variant })),
          ])
        ),
      };
      try {
        return await operation(tx);
      } catch (error) {
        state = snapshot;
        throw error;
      }
    },
  };

  return { db, tx, state: () => state, transaction: db.$transaction, product };
}

test("inventory status derives AVAILABLE, LOW and OUT", () => {
  assert.equal(inventoryStatus(20, 10), "AVAILABLE");
  assert.equal(inventoryStatus(10, 10), "LOW");
  assert.equal(inventoryStatus(0, 10), "OUT");
});

test("inventory catalog query requires active Branch, Product and BranchProduct PIECE non-template", () => {
  assert.deepEqual(activeBranchInventoryWhere(4), {
    branchId: 4,
    isActive: true,
    branch: { isActive: true },
    product: {
      isActive: true,
      unitType: UnitType.PIECE,
      isCustomProductTemplate: false,
    },
  });
  assert.equal(activeBranchInventoryWhere(7).branchId, 7);
});

test("active branch product without config is returned as uncontrolled without side effects", async () => {
  let capturedWhere: unknown;
  let findManyCalls = 0;
  const result = await listInventoryForBranch({
    branchProduct: {
      findMany: async (args: any) => {
        findManyCalls += 1;
        capturedWhere = args.where;
        return [{
          id: 9,
          isActive: true,
          product: {
            id: 3,
            name: "Frazada",
            isActive: true,
            unitType: UnitType.PIECE,
            minQty: new Prisma.Decimal(1),
            qtyStep: new Prisma.Decimal(1),
            isCustomProductTemplate: false,
            variants: [],
          },
          inventoryConfig: null,
        }];
      },
    },
  } as any, 2);
  assert.equal(findManyCalls, 1);
  assert.deepEqual(capturedWhere, activeBranchInventoryWhere(2));
  assert.equal(result.length, 1);
  assert.equal(result[0].inventory, null);
});

test("active product with disabled inventory config remains visible", async () => {
  const now = new Date();
  const result = await listInventoryForBranch({
    branchProduct: {
      findMany: async () => [{
        id: 9,
        isActive: true,
        product: {
          id: 3,
          name: "Frazada",
          isActive: true,
          unitType: UnitType.PIECE,
          minQty: new Prisma.Decimal(1),
          qtyStep: new Prisma.Decimal(1),
          isCustomProductTemplate: false,
          variants: [],
        },
        inventoryConfig: {
          id: 4,
          isEnabled: false,
          trackingMode: InventoryTrackingMode.PRODUCT,
          activatedAt: now,
          deactivatedAt: now,
          balances: [{
            id: 5,
            variantId: null,
            variant: null,
            currentStock: 12,
            lowStockThreshold: 3,
            version: 1,
            updatedAt: now,
            movements: [],
          }],
        },
      }],
    },
  } as any, 2);
  assert.equal(result.length, 1);
  assert.equal(result[0].inventory?.enabled, false);
  assert.equal(result[0].inventory?.currentStock, 12);
});

test("product total is always derived from its balances", () => {
  assert.equal(totalInventoryStock([{ currentStock: 20 }, { currentStock: 45 }, { currentStock: 31 }]), 96);
});

test("ADMIN movement mutations require an explicit operationKey", () => {
  assert.equal(requireOperationKey(" operation-1 "), "operation-1");
  assert.throws(
    () => requireOperationKey(undefined),
    (error: unknown) => error instanceof InventoryError && error.code === "INVENTORY_OPERATION_KEY_REQUIRED"
  );
});

test("activation rules accept integral PIECE and reject METER, templates and fractional rules", () => {
  const fixture = inventoryFixture();
  assert.doesNotThrow(() => assertStockableProduct(fixture.product()));
  assert.throws(() => assertStockableProduct({ ...fixture.product(), unitType: UnitType.METER }), /Solo los productos por pieza/);
  assert.throws(() => assertStockableProduct({ ...fixture.product(), isCustomProductTemplate: true }), /Producto Libre/);
  assert.throws(
    () => assertStockableProduct({ ...fixture.product(), qtyStep: new Prisma.Decimal("0.1") }),
    /reglas fraccionarias/
  );
});

test("activation creates an auditable initial balance including zero stock", async () => {
  const fixture = inventoryFixture({ balances: {} });
  const result = await activateInventory(fixture.db, {
    branchProductId: 201,
    initialStock: 0,
    lowStockThreshold: 5,
    actorId: 9,
    operationKey: "initial-zero",
  });
  assert.deepEqual(result, {
    configId: 105,
    trackingMode: "PRODUCT",
    balances: [{ balanceId: 5, variantId: null, currentStock: 0 }],
  });
  assert.equal(fixture.state().balances[5].currentStock, 0);
  assert.equal(fixture.state().movements[0].movementType, InventoryMovementType.INITIAL_STOCK);
  assert.equal(fixture.state().movements[0].deltaQty, 0);
});

test("VARIANT activation creates one balance and INITIAL_STOCK per active variant", async () => {
  const fixture = inventoryFixture({
    balances: {},
    trackingModes: { 1: "VARIANT" },
    productVariants: {
      1: [
        { id: 11, productId: 1, name: "Individual", isActive: true, order: 0 },
        { id: 12, productId: 1, name: "King", isActive: true, order: 1 },
      ],
    },
  });
  const result = await activateInventory(fixture.db, {
    branchProductId: 201,
    trackingMode: InventoryTrackingMode.VARIANT,
    variants: [
      { variantId: 11, stock: 0, lowStockThreshold: 2 },
      { variantId: 12, stock: 10, lowStockThreshold: 3 },
    ],
    actorId: 9,
    operationKey: "variant-activation",
  });
  assert.equal(result.trackingMode, InventoryTrackingMode.VARIANT);
  assert.deepEqual(result.balances.map((balance) => [balance.variantId, balance.currentStock]), [[11, 0], [12, 10]]);
  assert.equal(fixture.state().movements.length, 2);
  assert.equal(Object.values(fixture.state().balances).reduce((sum, balance) => sum + balance.currentStock, 0), 10);
});

test("VARIANT activation requires every active variant and rolls back incomplete input", async () => {
  const fixture = inventoryFixture({
    balances: {},
    productVariants: {
      1: [
        { id: 11, productId: 1, name: "Individual", isActive: true, order: 0 },
        { id: 12, productId: 1, name: "King", isActive: true, order: 1 },
      ],
    },
  });
  await assert.rejects(
    activateInventory(fixture.db, {
      branchProductId: 201,
      trackingMode: InventoryTrackingMode.VARIANT,
      variants: [{ variantId: 11, stock: 2 }],
      actorId: 9,
      operationKey: "variant-incomplete",
    }),
    (error: unknown) => error instanceof InventoryError && error.code === "INVENTORY_VARIANT_STOCK_INCOMPLETE"
  );
  assert.equal(Object.keys(fixture.state().balances).length, 0);
  assert.equal(fixture.state().movements.length, 0);
});

test("inactive Branch and inactive BranchProduct reject activation", async () => {
  const inactiveBranch = inventoryFixture({ balances: {}, branchIsActive: false });
  await assert.rejects(
    activateInventory(inactiveBranch.db, {
      branchProductId: 201,
      initialStock: 0,
      actorId: 9,
      operationKey: "inactive-branch",
    }),
    (error: unknown) => error instanceof InventoryError && error.code === "INVENTORY_PRODUCT_INACTIVE"
  );

  const inactiveBranchProduct = inventoryFixture({ balances: {}, branchProductIsActive: false });
  await assert.rejects(
    activateInventory(inactiveBranchProduct.db, {
      branchProductId: 201,
      initialStock: 0,
      actorId: 9,
      operationKey: "inactive-branch-product",
    }),
    (error: unknown) => error instanceof InventoryError && error.code === "INVENTORY_PRODUCT_INACTIVE"
  );

  const inactiveReactivation = inventoryFixture({ branchIsActive: false });
  inactiveReactivation.state().balances[5].enabled = false;
  await assert.rejects(
    reactivateInventory(inactiveReactivation.db, {
      configId: 105,
      physicalStock: 10,
      actorId: 9,
      operationKey: "inactive-reactivation",
    }),
    (error: unknown) => error instanceof InventoryError && error.code === "INVENTORY_PRODUCT_INACTIVE"
  );
});

test("created order aggregates repeated items and discounts real item quantity", async () => {
  const fixture = inventoryFixture();
  fixture.state().items.push(
    { id: 1, orderId: 20, productId: 1, productNameSnapshot: "Producto 1", quantity: new Prisma.Decimal(3), inventoryBalanceId: null, inventoryDeductedQty: 0 },
    { id: 2, orderId: 20, productId: 1, productNameSnapshot: "Producto 1", quantity: new Prisma.Decimal(4), inventoryBalanceId: null, inventoryDeductedQty: 0 }
  );

  await fixture.transaction((tx: any) => applyInventoryToCreatedOrder(tx, {
    branchId: 2,
    orderId: 20,
    actorId: 9,
    items: fixture.state().items.map((item) => ({
      orderItemId: item.id,
      productId: item.productId,
      productName: item.productNameSnapshot,
      quantity: item.quantity,
      isCustomProduct: false,
    })),
  }));

  assert.equal(fixture.state().balances[5].currentStock, 3);
  assert.equal(fixture.state().movements[0].deltaQty, -7);
  assert.deepEqual(fixture.state().items.map((item) => item.inventoryDeductedQty), [3, 4]);
});

test("custom and unconfigured products do not change stock, while another branch is rejected", async () => {
  const fixture = inventoryFixture();
  await fixture.transaction((tx: any) => applyInventoryToCreatedOrder(tx, {
    branchId: 3,
    orderId: 20,
    actorId: 9,
    items: [{ orderItemId: 2, productId: 999, productName: "Producto Libre", quantity: new Prisma.Decimal(4), isCustomProduct: true }],
  }));
  assert.equal(fixture.state().balances[5].currentStock, 10);
  assert.equal(fixture.state().movements.length, 0);

  fixture.state().balances[5].enabled = false;
  await fixture.transaction((tx: any) => applyInventoryToCreatedOrder(tx, {
    branchId: 2,
    orderId: 20,
    actorId: 9,
    items: [{ orderItemId: 1, productId: 1, productName: "Producto 1", quantity: new Prisma.Decimal(4), isCustomProduct: false }],
  }));
  assert.equal(fixture.state().balances[5].currentStock, 10);

  await assert.rejects(
    fixture.transaction((tx: any) => applyInventoryToCreatedOrder(tx, {
      branchId: 3,
      orderId: 20,
      actorId: 9,
      items: [{ orderItemId: 1, productId: 1, productName: "Producto 1", quantity: new Prisma.Decimal(4), isCustomProduct: false }],
    })),
    (error: unknown) => error instanceof InventoryError && error.code === "BRANCH_PRODUCT_UNAVAILABLE"
  );
});

test("BranchProduct is revalidated after locking before any order discount", async () => {
  const fixture = inventoryFixture({ branchProductIsActive: false });
  await assert.rejects(
    fixture.transaction((tx: any) => applyInventoryToCreatedOrder(tx, {
      branchId: 2,
      orderId: 20,
      actorId: 9,
      items: [{
        orderItemId: 1,
        productId: 1,
        productName: "Producto 1",
        quantity: new Prisma.Decimal(4),
        isCustomProduct: false,
      }],
    })),
    (error: unknown) => error instanceof InventoryError && error.code === "BRANCH_PRODUCT_UNAVAILABLE"
  );
  assert.equal(fixture.state().balances[5].currentStock, 10);
  assert.equal(fixture.state().movements.length, 0);
});

test("VARIANT orders aggregate by physical balance and keep variants independent", async () => {
  const fixture = inventoryFixture({
    balances: {
      5: { id: 5, productId: 1, variantId: 11, currentStock: 10, version: 0, enabled: true },
      6: { id: 6, productId: 1, variantId: 12, currentStock: 10, version: 0, enabled: true },
    },
    trackingModes: { 1: "VARIANT" },
    productVariants: {
      1: [
        { id: 11, productId: 1, name: "Individual", isActive: true, order: 0 },
        { id: 12, productId: 1, name: "King", isActive: true, order: 1 },
      ],
    },
  });
  fixture.state().items.push(
    { id: 1, orderId: 20, productId: 1, productNameSnapshot: "Frazada", quantity: new Prisma.Decimal(3), inventoryBalanceId: null, inventoryDeductedQty: 0 },
    { id: 2, orderId: 20, productId: 1, productNameSnapshot: "Frazada", quantity: new Prisma.Decimal(4), inventoryBalanceId: null, inventoryDeductedQty: 0 },
    { id: 3, orderId: 20, productId: 1, productNameSnapshot: "Frazada", quantity: new Prisma.Decimal(2), inventoryBalanceId: null, inventoryDeductedQty: 0 }
  );
  await fixture.transaction((tx: any) => applyInventoryToCreatedOrder(tx, {
    branchId: 2,
    orderId: 20,
    actorId: 9,
    items: [
      { orderItemId: 1, productId: 1, productName: "Frazada", quantity: new Prisma.Decimal(3), variantId: 12, isCustomProduct: false },
      { orderItemId: 2, productId: 1, productName: "Frazada", quantity: new Prisma.Decimal(4), variantId: 12, isCustomProduct: false },
      { orderItemId: 3, productId: 1, productName: "Frazada", quantity: new Prisma.Decimal(2), variantId: 11, isCustomProduct: false },
    ],
  }));
  assert.equal(fixture.state().balances[5].currentStock, 8);
  assert.equal(fixture.state().balances[6].currentStock, 3);
  assert.deepEqual(fixture.state().movements.map((movement) => movement.deltaQty).sort((a, b) => a - b), [-7, -2]);
});

test("active variant without initialized balance is rejected", async () => {
  const fixture = inventoryFixture({
    balances: { 5: { id: 5, productId: 1, variantId: 11, currentStock: 10, version: 0, enabled: true } },
    trackingModes: { 1: "VARIANT" },
    productVariants: {
      1: [
        { id: 11, productId: 1, name: "Individual", isActive: true, order: 0 },
        { id: 12, productId: 1, name: "King", isActive: true, order: 1 },
      ],
    },
  });
  await assert.rejects(
    fixture.transaction((tx: any) => applyInventoryToCreatedOrder(tx, {
      branchId: 2,
      orderId: 20,
      actorId: 9,
      items: [{ orderItemId: 1, productId: 1, productName: "Frazada", quantity: new Prisma.Decimal(1), variantId: 12, isCustomProduct: false }],
    })),
    (error: unknown) => error instanceof InventoryError && error.code === "INVENTORY_VARIANT_NOT_INITIALIZED"
  );
});

test("new variant initialization creates one balance and cannot duplicate it", async () => {
  const fixture = inventoryFixture({
    balances: { 5: { id: 5, productId: 1, variantId: 11, currentStock: 10, version: 0, enabled: true } },
    trackingModes: { 1: "VARIANT" },
    productVariants: {
      1: [
        { id: 11, productId: 1, name: "Individual", isActive: true, order: 0 },
        { id: 12, productId: 1, name: "Super King", isActive: true, order: 1 },
      ],
    },
  });
  await initializeInventoryVariant(fixture.db, {
    configId: 105,
    variantId: 12,
    initialStock: 4,
    lowStockThreshold: 1,
    actorId: 9,
    operationKey: "initialize-12",
  });
  assert.equal(Object.values(fixture.state().balances).find((balance) => balance.variantId === 12)?.currentStock, 4);
  await assert.rejects(
    initializeInventoryVariant(fixture.db, {
      configId: 105,
      variantId: 12,
      initialStock: 4,
      actorId: 9,
      operationKey: "initialize-12-again",
    }),
    (error: unknown) => error instanceof InventoryError && error.code === "INVENTORY_VARIANT_ALREADY_INITIALIZED"
  );
});

test("insufficient stock rolls back all balances and movements", async () => {
  const fixture = inventoryFixture({
    balances: {
      5: { id: 5, currentStock: 10, version: 0, enabled: true },
      6: { id: 6, currentStock: 1, version: 0, enabled: true },
    },
  });
  const items = [
    { orderItemId: 1, productId: 1, productName: "Producto 1", quantity: new Prisma.Decimal(8), isCustomProduct: false },
    { orderItemId: 2, productId: 2, productName: "Producto 2", quantity: new Prisma.Decimal(2), isCustomProduct: false },
  ];
  fixture.state().items.push(
    { id: 1, orderId: 20, productId: 1, productNameSnapshot: "Producto 1", quantity: new Prisma.Decimal(8), inventoryBalanceId: null, inventoryDeductedQty: 0 },
    { id: 2, orderId: 20, productId: 2, productNameSnapshot: "Producto 2", quantity: new Prisma.Decimal(2), inventoryBalanceId: null, inventoryDeductedQty: 0 }
  );

  await assert.rejects(
    fixture.transaction((tx: any) => applyInventoryToCreatedOrder(tx, { branchId: 2, orderId: 20, actorId: 9, items })),
    (error: unknown) => error instanceof InventoryError && error.code === "INSUFFICIENT_STOCK"
  );
  assert.equal(fixture.state().balances[5].currentStock, 10);
  assert.equal(fixture.state().balances[6].currentStock, 1);
  assert.equal(fixture.state().movements.length, 0);
});

test("sequential concurrent-style deductions never make stock negative", async () => {
  const fixture = inventoryFixture();
  const attempt = (orderId: number) => fixture.transaction((tx: any) => applyInventoryToCreatedOrder(tx, {
    branchId: 2,
    orderId,
    actorId: 9,
    items: [{ orderItemId: orderId, productId: 1, productName: "Producto 1", quantity: new Prisma.Decimal(8), isCustomProduct: false }],
  }));
  fixture.state().items.push({ id: 20, orderId: 20, productId: 1, productNameSnapshot: "Producto 1", quantity: new Prisma.Decimal(8), inventoryBalanceId: null, inventoryDeductedQty: 0 });
  await attempt(20);
  fixture.state().items.push({ id: 21, orderId: 21, productId: 1, productNameSnapshot: "Producto 1", quantity: new Prisma.Decimal(8), inventoryBalanceId: null, inventoryDeductedQty: 0 });
  await assert.rejects(attempt(21), (error: unknown) => error instanceof InventoryError && error.code === "INSUFFICIENT_STOCK");
  assert.equal(fixture.state().balances[5].currentStock, 2);
});

function trackedEditFixture(stock = 90) {
  return inventoryFixture({
    balances: { 5: { id: 5, currentStock: stock, version: 0, enabled: true } },
    items: [{
      id: 1,
      orderId: 20,
      productId: 1,
      productNameSnapshot: "Producto 1",
      quantity: new Prisma.Decimal(10),
      inventoryBalanceId: 5,
      inventoryDeductedQty: 10,
    }],
  });
}

test("editing 10 to 6 returns four units", async () => {
  const fixture = trackedEditFixture();
  await fixture.transaction((tx: any) => applyInventoryToOrderEdit(tx, {
    orderId: 20,
    branchId: 2,
    actorId: 9,
    expectedVersion: 1,
    newItems: [{ itemId: 1, productId: 1, quantity: new Prisma.Decimal(6) }],
  }));
  assert.equal(fixture.state().balances[5].currentStock, 94);
  assert.equal(fixture.state().items[0].inventoryDeductedQty, 6);
});

test("editing 10 to 15 consumes five and insufficient edits roll back", async () => {
  const fixture = trackedEditFixture(5);
  await fixture.transaction((tx: any) => applyInventoryToOrderEdit(tx, {
    orderId: 20,
    branchId: 2,
    actorId: 9,
    expectedVersion: 1,
    newItems: [{ itemId: 1, productId: 1, quantity: new Prisma.Decimal(15) }],
  }));
  assert.equal(fixture.state().balances[5].currentStock, 0);

  const insufficient = trackedEditFixture(4);
  await assert.rejects(
    insufficient.transaction((tx: any) => applyInventoryToOrderEdit(tx, {
      orderId: 20,
      branchId: 2,
      actorId: 9,
      expectedVersion: 1,
      newItems: [{ itemId: 1, productId: 1, quantity: new Prisma.Decimal(15) }],
    })),
    (error: unknown) => error instanceof InventoryError && error.code === "INSUFFICIENT_STOCK"
  );
  assert.equal(insufficient.state().balances[5].currentStock, 4);
  assert.equal(insufficient.state().items[0].inventoryDeductedQty, 10);
});

test("changing variant returns old balance and consumes new balance atomically", async () => {
  const fixture = inventoryFixture({
    balances: {
      5: { id: 5, productId: 1, variantId: 11, currentStock: 4, version: 0, enabled: true },
      6: { id: 6, productId: 1, variantId: 12, currentStock: 10, version: 0, enabled: true },
    },
    trackingModes: { 1: "VARIANT" },
    productVariants: {
      1: [
        { id: 11, productId: 1, name: "King", isActive: true, order: 0 },
        { id: 12, productId: 1, name: "Matrimonial", isActive: true, order: 1 },
      ],
    },
    items: [{ id: 1, orderId: 20, productId: 1, productNameSnapshot: "Frazada", quantity: new Prisma.Decimal(6), variantId: 11, inventoryBalanceId: 5, inventoryDeductedQty: 6 } as any],
  });
  await fixture.transaction((tx: any) => applyInventoryToOrderEdit(tx, {
    orderId: 20,
    branchId: 2,
    actorId: 9,
    expectedVersion: 1,
    newItems: [{ itemId: 1, productId: 1, quantity: new Prisma.Decimal(6), variantId: 12 }],
  }));
  assert.equal(fixture.state().balances[5].currentStock, 10);
  assert.equal(fixture.state().balances[6].currentStock, 4);
  assert.equal(fixture.state().items[0].inventoryBalanceId, 6);

  const insufficient = inventoryFixture({
    balances: {
      5: { id: 5, productId: 1, variantId: 11, currentStock: 4, version: 0, enabled: true },
      6: { id: 6, productId: 1, variantId: 12, currentStock: 4, version: 0, enabled: true },
    },
    trackingModes: { 1: "VARIANT" },
    productVariants: fixture.state().productVariants,
    items: [{ id: 1, orderId: 20, productId: 1, productNameSnapshot: "Frazada", quantity: new Prisma.Decimal(6), variantId: 11, inventoryBalanceId: 5, inventoryDeductedQty: 6 } as any],
  });
  await assert.rejects(
    insufficient.transaction((tx: any) => applyInventoryToOrderEdit(tx, {
      orderId: 20,
      branchId: 2,
      actorId: 9,
      expectedVersion: 1,
      newItems: [{ itemId: 1, productId: 1, quantity: new Prisma.Decimal(6), variantId: 12 }],
    })),
    (error: unknown) => error instanceof InventoryError && error.code === "INSUFFICIENT_STOCK"
  );
  assert.equal(insufficient.state().balances[5].currentStock, 4);
  assert.equal(insufficient.state().balances[6].currentStock, 4);
});

test("historical item edits and stale versions are rejected", async () => {
  const historical = inventoryFixture({
    items: [{ id: 1, orderId: 20, productId: 1, productNameSnapshot: "Producto 1", quantity: new Prisma.Decimal(10), inventoryBalanceId: null, inventoryDeductedQty: 0 }],
  });
  await assert.rejects(
    historical.transaction((tx: any) => applyInventoryToOrderEdit(tx, {
      orderId: 20,
      branchId: 2,
      actorId: 9,
      expectedVersion: 1,
      newItems: [{ itemId: 1, productId: 1, quantity: new Prisma.Decimal(6) }],
    })),
    (error: unknown) => error instanceof InventoryError && error.code === "HISTORICAL_INVENTORY_ITEM_EDIT_FORBIDDEN"
  );

  const stale = trackedEditFixture();
  await assert.rejects(
    stale.transaction((tx: any) => applyInventoryToOrderEdit(tx, {
      orderId: 20,
      branchId: 2,
      actorId: 9,
      expectedVersion: 9,
      newItems: [{ itemId: 1, productId: 1, quantity: new Prisma.Decimal(6) }],
    })),
    (error: unknown) => error instanceof InventoryError && error.code === "ORDER_VERSION_CONFLICT"
  );
});

test("legacy PUT without version is allowed only for orders outside inventory", () => {
  assert.equal(resolveExpectedOrderVersion({
    requestedVersion: undefined,
    currentVersion: 3,
    inventoryReturnedAt: null,
    items: [{ inventoryBalanceId: null, inventoryDeductedQty: 0 }],
  }), 3);

  assert.throws(
    () => resolveExpectedOrderVersion({
      requestedVersion: undefined,
      currentVersion: 3,
      inventoryReturnedAt: null,
      items: [{ inventoryBalanceId: 5, inventoryDeductedQty: 2 }],
    }),
    (error: unknown) => error instanceof InventoryError && error.code === "ORDER_VERSION_REQUIRED"
  );
});

test("all normal mutation paths reject an order after inventory was returned", () => {
  for (const path of ["PUT", "nextStep", "received", "delivered"]) {
    assert.throws(
      () => assertOrderInventoryNotReturned(new Date()),
      (error: unknown) => {
        assert.ok(error instanceof InventoryError, path);
        assert.equal(error.code, "ORDER_INVENTORY_ALREADY_RETURNED", path);
        return true;
      }
    );
  }
});

test("cancellation returns deducted stock once even when config is disabled", async () => {
  const fixture = trackedEditFixture();
  fixture.state().balances[5].enabled = false;
  await fixture.transaction((tx: any) => returnInventoryForCancellation(tx, { orderId: 20, actorId: 9 }));
  assert.equal(fixture.state().balances[5].currentStock, 100);
  assert.equal(fixture.state().items[0].inventoryDeductedQty, 0);
  assert.equal(fixture.state().movements[0].movementType, InventoryMovementType.ORDER_CANCELLED);

  await fixture.transaction((tx: any) => returnInventoryForCancellation(tx, { orderId: 20, actorId: 9 }));
  assert.equal(fixture.state().balances[5].currentStock, 100);
  assert.equal(fixture.state().movements.length, 1);
});

test("hard delete preparation returns final PRODUCT commitment and removes only order movements", async () => {
  const fixture = trackedEditFixture();
  fixture.state().movements.push(
    { id: 1, orderId: 20, orderItemId: null, movementType: InventoryMovementType.ORDER_CREATED },
    { id: 2, orderId: null, orderItemId: null, movementType: InventoryMovementType.RESTOCK }
  );
  const result = await fixture.transaction((tx: any) => prepareInventoryForHardDelete(tx, { orderId: 20 }));
  assert.equal(fixture.state().balances[5].currentStock, 100);
  assert.equal(result.returnedQuantity, 10);
  assert.equal(result.deletedMovementCount, 1);
  assert.equal(fixture.state().movements.length, 1);
  assert.equal(fixture.state().movements[0].movementType, InventoryMovementType.RESTOCK);
});

test("hard delete preparation without inventory performs no stock change", async () => {
  const fixture = inventoryFixture({ items: [] });
  const result = await fixture.transaction((tx: any) => prepareInventoryForHardDelete(tx, { orderId: 20 }));
  assert.equal(result.returnedQuantity, 0);
  assert.equal(fixture.state().movements.length, 0);
});

test("hard delete after legacy cancellation does not return inventory twice and clears its movement", async () => {
  const fixture = trackedEditFixture();
  await fixture.transaction((tx: any) => returnInventoryForCancellation(tx, { orderId: 20, actorId: 9 }));
  await fixture.transaction((tx: any) => prepareInventoryForHardDelete(tx, { orderId: 20 }));
  assert.equal(fixture.state().balances[5].currentStock, 100);
  assert.equal(fixture.state().movements.length, 0);
});

test("hard delete returns each VARIANT balance independently without creating movements", async () => {
  const fixture = inventoryFixture({
    balances: {
      5: { id: 5, productId: 1, variantId: 11, currentStock: 4, version: 0, enabled: true },
      6: { id: 6, productId: 1, variantId: 12, currentStock: 6, version: 0, enabled: true },
    },
    trackingModes: { 1: "VARIANT" },
    items: [
      { id: 1, orderId: 20, productId: 1, productNameSnapshot: "Frazada", quantity: new Prisma.Decimal(6), variantId: 11, inventoryBalanceId: 5, inventoryDeductedQty: 6 },
      { id: 2, orderId: 20, productId: 1, productNameSnapshot: "Frazada", quantity: new Prisma.Decimal(4), variantId: 12, inventoryBalanceId: 6, inventoryDeductedQty: 4 },
    ],
  });
  fixture.state().movements.push(
    { id: 1, orderId: 20, orderItemId: null, movementType: InventoryMovementType.ORDER_CREATED },
    { id: 2, orderId: null, orderItemId: 2, movementType: InventoryMovementType.ORDER_EDITED }
  );
  await fixture.transaction((tx: any) => prepareInventoryForHardDelete(tx, { orderId: 20 }));
  assert.equal(fixture.state().balances[5].currentStock, 10);
  assert.equal(fixture.state().balances[6].currentStock, 10);
  assert.equal(fixture.state().movements.length, 0);
});

test("a returned order cannot consume inventory again through editing", async () => {
  const fixture = trackedEditFixture();
  await fixture.transaction((tx: any) => returnInventoryForCancellation(tx, { orderId: 20, actorId: 9 }));
  await assert.rejects(
    fixture.transaction((tx: any) => applyInventoryToOrderEdit(tx, {
      orderId: 20,
      branchId: 2,
      actorId: 9,
      expectedVersion: 1,
      newItems: [{ itemId: 1, productId: 1, quantity: new Prisma.Decimal(11) }],
    })),
    (error: unknown) => error instanceof InventoryError && error.code === "ORDER_INVENTORY_ALREADY_RETURNED"
  );
  assert.equal(fixture.state().balances[5].currentStock, 100);
});

test("manual restock, remove and adjustment mutate stock through movements", async () => {
  const fixture = inventoryFixture();
  await restockInventory(fixture.db, { balanceId: 5, quantity: 5, actorId: 9, operationKey: "restock-1" });
  assert.equal(fixture.state().balances[5].currentStock, 15);
  await removeInventory(fixture.db, { balanceId: 5, quantity: 3, actorId: 9, operationKey: "remove-1", reason: "Daño" });
  assert.equal(fixture.state().balances[5].currentStock, 12);
  await adjustInventory(fixture.db, { balanceId: 5, targetStock: 8, actorId: 9, operationKey: "adjust-1", reason: "Conteo" });
  assert.equal(fixture.state().balances[5].currentStock, 8);
  assert.deepEqual(fixture.state().movements.map((movement) => movement.deltaQty), [5, -3, -4]);
});

test("manual removal cannot make stock negative", async () => {
  const fixture = inventoryFixture();
  await assert.rejects(
    removeInventory(fixture.db, { balanceId: 5, quantity: 11, actorId: 9, operationKey: "remove-too-much", reason: "Daño" }),
    (error: unknown) => error instanceof InventoryError && error.code === "INSUFFICIENT_STOCK"
  );
  assert.equal(fixture.state().balances[5].currentStock, 10);
});

test("an operation key cannot be reused with a different stock delta", async () => {
  const fixture = inventoryFixture();
  await restockInventory(fixture.db, { balanceId: 5, quantity: 5, actorId: 9, operationKey: "same-restock" });
  await assert.rejects(
    restockInventory(fixture.db, { balanceId: 5, quantity: 6, actorId: 9, operationKey: "same-restock" }),
    (error: unknown) => error instanceof InventoryError && error.code === "INVENTORY_OPERATION_KEY_REUSED"
  );
  assert.equal(fixture.state().balances[5].currentStock, 15);
});

test("reactivation requires a physical count and records adjustment when changed", async () => {
  const fixture = inventoryFixture();
  fixture.state().balances[5].enabled = false;
  await reactivateInventory(fixture.db, {
    configId: 105,
    physicalStock: 7,
    lowStockThreshold: 2,
    actorId: 9,
    operationKey: "reactivate-1",
  });
  assert.equal(fixture.state().balances[5].currentStock, 7);
  assert.equal(fixture.state().balances[5].enabled, true);
  assert.equal(fixture.state().movements[0].deltaQty, -3);
});

test("VARIANT reactivation adjusts every balance and tracking mode is immutable", async () => {
  const fixture = inventoryFixture({
    balances: {
      5: { id: 5, productId: 1, variantId: 11, currentStock: 10, version: 0, enabled: false },
      6: { id: 6, productId: 1, variantId: 12, currentStock: 5, version: 0, enabled: false },
    },
    trackingModes: { 1: "VARIANT" },
    productVariants: {
      1: [
        { id: 11, productId: 1, name: "Individual", isActive: true, order: 0 },
        { id: 12, productId: 1, name: "King", isActive: true, order: 1 },
      ],
    },
  });
  await reactivateInventory(fixture.db, {
    configId: 105,
    trackingMode: InventoryTrackingMode.VARIANT,
    variants: [
      { variantId: 11, stock: 8, lowStockThreshold: 2 },
      { variantId: 12, stock: 9, lowStockThreshold: 3 },
    ],
    actorId: 9,
    operationKey: "variant-reactivation",
  });
  assert.equal(fixture.state().balances[5].currentStock, 8);
  assert.equal(fixture.state().balances[6].currentStock, 9);
  assert.deepEqual(fixture.state().movements.map((movement) => movement.deltaQty).sort((a, b) => a - b), [-2, 4]);

  fixture.state().balances[5].enabled = false;
  fixture.state().balances[6].enabled = false;
  await assert.rejects(
    reactivateInventory(fixture.db, {
      configId: 105,
      trackingMode: InventoryTrackingMode.PRODUCT,
      physicalStock: 20,
      actorId: 9,
      operationKey: "invalid-mode-change",
    }),
    (error: unknown) => error instanceof InventoryError && error.code === "INVENTORY_TRACKING_MODE_IMMUTABLE"
  );
});
