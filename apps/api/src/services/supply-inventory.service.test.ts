import assert from "node:assert/strict";
import test from "node:test";
import { Prisma, SupplyMovementType } from "@prisma/client";
import {
  SupplyInventoryError,
  adjustSupplyItemStock,
  createSupplyItem,
  deactivateSupplyItem,
  listSupplyMovements,
  normalizeSupplyName,
  reactivateSupplyItem,
  removeSupplyItemStock,
  requireSupplyInteger,
  restockSupplyItem,
  supplyRequestHash,
  supplyStockStatus,
  updateSupplyItem,
} from "./supply-inventory.service";

type Item = {
  id: number;
  branchId: number;
  name: string;
  normalizedName: string;
  unitLabel: string;
  currentStock: number;
  lowStockThreshold: number | null;
  version: number;
  isActive: boolean;
  creationOperationKey: string | null;
  creationRequestHash: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type Movement = {
  id: number;
  supplyItemId: number;
  deltaQty: number;
  stockBefore: number;
  stockAfter: number;
  movementType: SupplyMovementType;
  reason: string | null;
  createdById: number | null;
  operationKey: string;
  requestHash: string;
  createdAt: Date;
};

type FixtureState = {
  branches: Record<number, { id: number; name: string; isActive: boolean }>;
  items: Record<number, Item>;
  movements: Movement[];
};

function fixture(initial?: Partial<FixtureState>) {
  let state: FixtureState = {
    branches: {
      1: { id: 1, name: "Lerma", isActive: true },
      2: { id: 2, name: "Algarín 1", isActive: true },
    },
    items: {},
    movements: [],
    ...initial,
  };

  function itemWithIncludes(item: Item, args: any) {
    return {
      ...item,
      ...(args?.include?._count
        ? { _count: { movements: state.movements.filter((movement) => movement.supplyItemId === item.id).length } }
        : {}),
      ...(args?.include?.movements
        ? {
            movements: state.movements
              .filter((movement) => (
                movement.supplyItemId === item.id
                && (!args.include.movements.where?.movementType
                  || movement.movementType === args.include.movements.where.movementType)
              ))
              .slice(0, args.include.movements.take),
          }
        : {}),
    };
  }

  const tx: any = {
    $queryRaw: async (input: TemplateStringsArray | { strings: string[]; values: unknown[] }, ...tagValues: unknown[]) => {
      const tagged = Array.isArray(input);
      const strings = tagged ? Array.from(input as TemplateStringsArray) : (input as { strings: string[] }).strings;
      const rawValues = tagged ? tagValues : (input as { values: unknown[] }).values;
      const values = rawValues.flatMap((value) => (
        value && typeof value === "object" && "values" in value
          ? (value as { values: unknown[] }).values
          : [value]
      ));
      const sql = strings.join("?");
      if (sql.includes('FROM "Branch"')) {
        const branch = state.branches[Number(values[0])];
        return branch ? [{ ...branch }] : [];
      }
      if (sql.includes('FROM "SupplyItem"')) {
        const item = state.items[Number(values[0])];
        return item ? [{ ...item }] : [];
      }
      if (sql.includes('UPDATE "SupplyItem"')) {
        const delta = Number(values[0]);
        const item = state.items[Number(values[1])];
        const guard = Number(values[2]);
        const expectedVersion = values.length > 3 ? Number(values[3]) : undefined;
        if (!item || !item.isActive || (expectedVersion !== undefined && item.version !== expectedVersion)) return [];
        if (delta < 0 && item.currentStock < guard) return [];
        if (delta > 0 && item.currentStock > guard) return [];
        item.currentStock += delta;
        item.version += 1;
        item.updatedAt = new Date();
        return [{ currentStock: item.currentStock, version: item.version }];
      }
      throw new Error(`SQL no soportado en fixture: ${sql}`);
    },
    branch: {
      findUnique: async ({ where }: any) => state.branches[where.id] ? { ...state.branches[where.id] } : null,
    },
    supplyItem: {
      findUnique: async (args: any) => {
        let item: Item | undefined;
        if (args.where.id !== undefined) item = state.items[args.where.id];
        if (args.where.creationOperationKey !== undefined) {
          item = Object.values(state.items).find(
            (candidate) => candidate.creationOperationKey === args.where.creationOperationKey
          );
        }
        if (args.where.branchId_normalizedName) {
          const key = args.where.branchId_normalizedName;
          item = Object.values(state.items).find(
            (candidate) => candidate.branchId === key.branchId && candidate.normalizedName === key.normalizedName
          );
        }
        return item ? itemWithIncludes(item, args) : null;
      },
      findMany: async () => Object.values(state.items),
      create: async ({ data }: any) => {
        const duplicateOperation = Object.values(state.items).find(
          (candidate) => candidate.creationOperationKey === data.creationOperationKey
        );
        const duplicate = Object.values(state.items).find(
          (candidate) => candidate.branchId === data.branchId && candidate.normalizedName === data.normalizedName
        );
        if (duplicate || duplicateOperation) {
          throw new Prisma.PrismaClientKnownRequestError("Unique", {
            code: "P2002",
            clientVersion: "5.22.0",
          });
        }
        const id = Math.max(0, ...Object.keys(state.items).map(Number)) + 1;
        const item: Item = {
          id,
          branchId: data.branchId,
          name: data.name,
          normalizedName: data.normalizedName,
          unitLabel: data.unitLabel,
          currentStock: data.currentStock ?? 0,
          lowStockThreshold: data.lowStockThreshold ?? null,
          version: 0,
          isActive: true,
          creationOperationKey: data.creationOperationKey ?? null,
          creationRequestHash: data.creationRequestHash ?? null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        state.items[id] = item;
        return { ...item };
      },
      update: async (args: any) => {
        const item = state.items[args.where.id];
        if (!item) throw new Error("missing item");
        if (args.data.normalizedName) {
          const duplicate = Object.values(state.items).find(
            (candidate) => candidate.id !== item.id
              && candidate.branchId === item.branchId
              && candidate.normalizedName === args.data.normalizedName
          );
          if (duplicate) {
            throw new Prisma.PrismaClientKnownRequestError("Unique", {
              code: "P2002",
              clientVersion: "5.22.0",
            });
          }
        }
        Object.assign(item, args.data, { updatedAt: new Date() });
        return itemWithIncludes(item, args);
      },
    },
    supplyMovement: {
      findUnique: async ({ where }: any) => {
        const movement = state.movements.find((candidate) => candidate.operationKey === where.operationKey);
        return movement ? { ...movement, supplyItem: { ...state.items[movement.supplyItemId] } } : null;
      },
      count: async ({ where }: any) => state.movements.filter(
        (movement) => movement.supplyItemId === where.supplyItemId
      ).length,
      create: async ({ data }: any) => {
        if (state.movements.some((movement) => movement.operationKey === data.operationKey)) {
          throw new Prisma.PrismaClientKnownRequestError("Unique", {
            code: "P2002",
            clientVersion: "5.22.0",
          });
        }
        const movement: Movement = {
          id: state.movements.length + 1,
          supplyItemId: data.supplyItemId,
          deltaQty: data.deltaQty,
          stockBefore: data.stockBefore,
          stockAfter: data.stockAfter,
          movementType: data.movementType,
          reason: data.reason ?? null,
          createdById: data.createdById ?? null,
          operationKey: data.operationKey,
          requestHash: data.requestHash,
          createdAt: new Date(),
        };
        state.movements.push(movement);
        return { ...movement, supplyItem: { ...state.items[movement.supplyItemId] } };
      },
      findMany: async ({ where, take }: any) => {
        let movements = state.movements
          .filter((movement) => movement.supplyItemId === where.supplyItemId)
          .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime() || right.id - left.id);
        if (where.OR) {
          const cursorDate = where.OR[0].createdAt.lt as Date;
          const cursorId = where.OR[1].id.lt as number;
          movements = movements.filter((movement) => (
            movement.createdAt < cursorDate
            || (movement.createdAt.getTime() === cursorDate.getTime() && movement.id < cursorId)
          ));
        }
        return movements.slice(0, take).map((movement) => ({ ...movement, createdBy: null }));
      },
    },
  };

  const db: any = {
    ...tx,
    $transaction: async (operation: (transaction: any) => Promise<unknown>) => {
      const snapshot: FixtureState = {
        branches: Object.fromEntries(Object.entries(state.branches).map(([id, branch]) => [id, { ...branch }])),
        items: Object.fromEntries(Object.entries(state.items).map(([id, item]) => [id, { ...item }])),
        movements: state.movements.map((movement) => ({ ...movement })),
      };
      try {
        return await operation(tx);
      } catch (error) {
        state = snapshot;
        throw error;
      }
    },
  };

  return { db, state: () => state };
}

function createBody(overrides: Record<string, unknown> = {}) {
  return {
    branchId: 1,
    name: "Tinta Negra",
    unitLabel: "botella",
    initialStock: 5,
    lowStockThreshold: 2,
    operationKey: "create-supply-1",
    ...overrides,
  };
}

async function createDefault(currentStock = 5) {
  const context = fixture();
  await createSupplyItem(context.db, {
    actorId: 9,
    body: createBody({ initialStock: currentStock }),
  });
  return context;
}

test("supply names normalize Unicode, whitespace and case deterministically", () => {
  assert.deepEqual(normalizeSupplyName("  TINTA   Negra  "), {
    name: "TINTA Negra",
    normalizedName: "tinta negra",
  });
  assert.equal(normalizeSupplyName("ＴＩＮＴＡ").normalizedName, "tinta");
});

test("strict integer validation rejects coercions, decimals and overflow", () => {
  for (const value of [null, true, false, [], "5", 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2_147_483_648]) {
    assert.throws(
      () => requireSupplyInteger(value, "stock"),
      (error: unknown) => error instanceof SupplyInventoryError && error.code === "INVALID_SUPPLY_QUANTITY"
    );
  }
  assert.equal(requireSupplyInteger(0, "stock"), 0);
});

test("supply status prioritizes OUT and supports nullable thresholds", () => {
  assert.equal(supplyStockStatus(0, null), "OUT");
  assert.equal(supplyStockStatus(1, 2), "LOW");
  assert.equal(supplyStockStatus(1, null), "AVAILABLE");
  assert.equal(supplyStockStatus(1, 0), "AVAILABLE");
});

test("creation with positive stock is atomic and records INITIAL_STOCK", async () => {
  const context = fixture();
  const result = await createSupplyItem(context.db, { actorId: 9, body: createBody() });
  assert.equal(result.supplyItem.currentStock, 5);
  assert.equal(result.supplyItem.unitLabelEditable, false);
  assert.equal(context.state().movements.length, 1);
  assert.equal(context.state().movements[0].movementType, SupplyMovementType.INITIAL_STOCK);
  assert.equal(context.state().movements[0].deltaQty, 5);
});

test("creation with zero stock creates no movement and keeps unit editable", async () => {
  const context = fixture();
  const result = await createSupplyItem(context.db, {
    actorId: 9,
    body: createBody({ initialStock: 0 }),
  });
  assert.equal(result.movement, null);
  assert.equal(result.supplyItem.currentStock, 0);
  assert.equal(result.supplyItem.unitLabelEditable, true);
  assert.equal(context.state().movements.length, 0);
  assert.equal(context.state().items[1].creationOperationKey, "create-supply-1");
  assert.match(context.state().items[1].creationRequestHash ?? "", /^[0-9a-f]{64}$/);
  const replay = await createSupplyItem(context.db, {
    actorId: 9,
    body: createBody({ initialStock: 0 }),
  });
  assert.equal(replay.repeated, true);
  assert.equal(replay.movement, null);
  assert.equal(context.state().items[1].currentStock, 0);
  assert.equal(Object.keys(context.state().items).length, 1);
  assert.equal(context.state().movements.length, 0);
});

test("positive-stock creation replay keeps exactly one INITIAL_STOCK", async () => {
  const context = fixture();
  const first = await createSupplyItem(context.db, { actorId: 9, body: createBody() });
  const replay = await createSupplyItem(context.db, { actorId: 9, body: createBody() });
  assert.equal(first.repeated, false);
  assert.equal(replay.repeated, true);
  assert.equal(replay.supplyItem.id, first.supplyItem.id);
  assert.equal(Object.keys(context.state().items).length, 1);
  assert.equal(context.state().movements.length, 1);
  assert.equal(context.state().movements[0].movementType, SupplyMovementType.INITIAL_STOCK);
  assert.notEqual(context.state().movements[0].operationKey, "create-supply-1");
  assert.match(context.state().movements[0].operationKey, /^initial:[0-9a-f]{64}$/);
});

test("creation operation key rejects a different normalized payload or actor", async () => {
  const context = fixture();
  await createSupplyItem(context.db, { actorId: 9, body: createBody({ initialStock: 0 }) });
  await assert.rejects(
    createSupplyItem(context.db, {
      actorId: 9,
      body: createBody({ initialStock: 0, unitLabel: "caja" }),
    }),
    (error: unknown) => error instanceof SupplyInventoryError && error.code === "SUPPLY_OPERATION_KEY_REUSED"
  );
  await assert.rejects(
    createSupplyItem(context.db, { actorId: 10, body: createBody({ initialStock: 0 }) }),
    (error: unknown) => error instanceof SupplyInventoryError && error.code === "SUPPLY_OPERATION_KEY_REUSED"
  );
  assert.equal(Object.keys(context.state().items).length, 1);
});

test("inactive branches reject supply creation", async () => {
  const context = fixture({
    branches: { 1: { id: 1, name: "Lerma", isActive: false } },
  });
  await assert.rejects(
    createSupplyItem(context.db, { actorId: 9, body: createBody() }),
    (error: unknown) => error instanceof SupplyInventoryError && error.code === "BRANCH_INACTIVE"
  );
});

test("normalized names are unique per branch and allowed across branches", async () => {
  const context = fixture();
  await createSupplyItem(context.db, { actorId: 9, body: createBody() });
  await assert.rejects(
    createSupplyItem(context.db, {
      actorId: 9,
      body: createBody({ name: " tinta NEGRA ", operationKey: "create-supply-2" }),
    }),
    (error: unknown) => error instanceof SupplyInventoryError && error.code === "SUPPLY_ALREADY_EXISTS"
  );
  await assert.doesNotReject(createSupplyItem(context.db, {
    actorId: 9,
    body: createBody({ branchId: 2, operationKey: "create-supply-3" }),
  }));
});

test("an inactive duplicate must be reactivated instead of recreated", async () => {
  const context = await createDefault();
  await deactivateSupplyItem(context.db, 1);
  await assert.rejects(
    createSupplyItem(context.db, {
      actorId: 9,
      body: createBody({ operationKey: "create-supply-4" }),
    }),
    (error: unknown) => error instanceof SupplyInventoryError && error.code === "SUPPLY_INACTIVE_EXISTS"
  );
});

test("restock increments stock and version and safely replays", async () => {
  const context = await createDefault();
  const body = { quantity: 10, reason: "Compra", operationKey: "restock-key-1" };
  const first = await restockSupplyItem(context.db, { supplyItemId: 1, actorId: 9, body });
  const replay = await restockSupplyItem(context.db, { supplyItemId: 1, actorId: 9, body });
  assert.equal(first.stockAfter, 15);
  assert.equal(context.state().items[1].version, 1);
  assert.equal(replay.repeated, true);
  assert.equal(context.state().movements.length, 2);
});

test("restock rejects overflow and inactive supplies", async () => {
  const overflow = await createDefault(2_147_483_647);
  await assert.rejects(
    restockSupplyItem(overflow.db, {
      supplyItemId: 1,
      actorId: 9,
      body: { quantity: 1, operationKey: "restock-overflow" },
    }),
    (error: unknown) => error instanceof SupplyInventoryError && error.code === "SUPPLY_STOCK_LIMIT"
  );
  await deactivateSupplyItem(overflow.db, 1);
  await assert.rejects(
    restockSupplyItem(overflow.db, {
      supplyItemId: 1,
      actorId: 9,
      body: { quantity: 1, operationKey: "restock-inactive" },
    }),
    (error: unknown) => error instanceof SupplyInventoryError && error.code === "SUPPLY_INACTIVE"
  );
});

test("manual removal requires a reason and never makes stock negative", async () => {
  const context = await createDefault();
  await assert.rejects(
    removeSupplyItemStock(context.db, {
      supplyItemId: 1,
      actorId: 9,
      body: { quantity: 1, reason: "", operationKey: "remove-no-reason" },
    }),
    (error: unknown) => error instanceof SupplyInventoryError && error.code === "SUPPLY_REASON_REQUIRED"
  );
  await assert.rejects(
    removeSupplyItemStock(context.db, {
      supplyItemId: 1,
      actorId: 9,
      body: { quantity: 6, reason: "Uso", operationKey: "remove-shortage" },
    }),
    (error: unknown) => error instanceof SupplyInventoryError && error.code === "INSUFFICIENT_SUPPLY_STOCK"
  );
  const result = await removeSupplyItemStock(context.db, {
    supplyItemId: 1,
    actorId: 9,
    body: { quantity: 4, reason: "Uso", operationKey: "remove-success" },
  });
  assert.equal(result.stockAfter, 1);
  assert.equal(context.state().items[1].currentStock, 1);
});

test("remove rejects zero, negative and numeric-string quantities", async () => {
  const context = await createDefault();
  for (const quantity of [0, -1, "1"]) {
    await assert.rejects(
      removeSupplyItemStock(context.db, {
        supplyItemId: 1,
        actorId: 9,
        body: { quantity, reason: "Uso", operationKey: `remove-invalid-${String(quantity)}` },
      }),
      (error: unknown) => error instanceof SupplyInventoryError && error.code === "INVALID_SUPPLY_QUANTITY"
    );
  }
});

test("adjust supports positive, negative and zero targets", async () => {
  const context = await createDefault();
  const higher = await adjustSupplyItemStock(context.db, {
    supplyItemId: 1,
    actorId: 9,
    body: { targetStock: 8, expectedVersion: 0, reason: "Conteo", operationKey: "adjust-higher" },
  });
  if (higher.noChange) assert.fail("expected a positive adjustment");
  assert.equal(higher.deltaQty, 3);
  const lower = await adjustSupplyItemStock(context.db, {
    supplyItemId: 1,
    actorId: 9,
    body: { targetStock: 3, expectedVersion: 1, reason: "Conteo", operationKey: "adjust-lower" },
  });
  if (lower.noChange) assert.fail("expected a negative adjustment");
  assert.equal(lower.deltaQty, -5);
  const zero = await adjustSupplyItemStock(context.db, {
    supplyItemId: 1,
    actorId: 9,
    body: { targetStock: 0, expectedVersion: 2, reason: "Conteo", operationKey: "adjust-zero" },
  });
  if (zero.noChange) assert.fail("expected an adjustment to zero");
  assert.equal(zero.stockAfter, 0);
});

test("same-stock adjustment is a no-op without movement or version change", async () => {
  const context = await createDefault();
  const movementCount = context.state().movements.length;
  const result = await adjustSupplyItemStock(context.db, {
    supplyItemId: 1,
    actorId: 9,
    body: { targetStock: 5, expectedVersion: 0, reason: "Conteo", operationKey: "adjust-no-change" },
  });
  assert.equal(result.noChange, true);
  assert.equal(context.state().items[1].version, 0);
  assert.equal(context.state().movements.length, movementCount);
  assert.equal(context.state().movements.some((movement) => movement.operationKey === "adjust-no-change"), false);
});

test("adjust rejects stale versions and missing reasons", async () => {
  const context = await createDefault();
  await assert.rejects(
    adjustSupplyItemStock(context.db, {
      supplyItemId: 1,
      actorId: 9,
      body: { targetStock: 4, expectedVersion: 1, reason: "Conteo", operationKey: "adjust-stale" },
    }),
    (error: unknown) => error instanceof SupplyInventoryError && error.code === "SUPPLY_VERSION_CONFLICT"
  );
  await assert.rejects(
    adjustSupplyItemStock(context.db, {
      supplyItemId: 1,
      actorId: 9,
      body: { targetStock: 4, expectedVersion: 0, reason: "", operationKey: "adjust-reason" },
    }),
    (error: unknown) => error instanceof SupplyInventoryError && error.code === "SUPPLY_REASON_REQUIRED"
  );
});

test("editing supports rename and threshold while preserving stock", async () => {
  const context = await createDefault();
  const result = await updateSupplyItem(context.db, {
    supplyItemId: 1,
    body: { name: "Tinta Negra DTF", lowStockThreshold: 7 },
  });
  assert.equal(result.supplyItem.name, "Tinta Negra DTF");
  assert.equal(result.supplyItem.lowStockThreshold, 7);
  assert.equal(result.supplyItem.currentStock, 5);
});

test("unit label is editable before movements and immutable afterwards", async () => {
  const empty = await createDefault(0);
  await assert.doesNotReject(updateSupplyItem(empty.db, {
    supplyItemId: 1,
    body: { unitLabel: "bote" },
  }));
  await restockSupplyItem(empty.db, {
    supplyItemId: 1,
    actorId: 9,
    body: { quantity: 1, operationKey: "restock-lock-unit" },
  });
  await assert.rejects(
    updateSupplyItem(empty.db, { supplyItemId: 1, body: { unitLabel: "caja" } }),
    (error: unknown) => error instanceof SupplyInventoryError && error.code === "SUPPLY_UNIT_IMMUTABLE"
  );
});

test("rename rejects a duplicate in the same branch", async () => {
  const context = fixture();
  await createSupplyItem(context.db, { actorId: 9, body: createBody() });
  await createSupplyItem(context.db, {
    actorId: 9,
    body: createBody({ name: "Polvo", operationKey: "create-powder-1" }),
  });
  await assert.rejects(
    updateSupplyItem(context.db, { supplyItemId: 2, body: { name: " tinta negra " } }),
    (error: unknown) => error instanceof SupplyInventoryError && error.code === "SUPPLY_NAME_CONFLICT"
  );
});

test("deactivate blocks movements and reactivate preserves stock, version and history", async () => {
  const context = await createDefault();
  const stock = context.state().items[1].currentStock;
  const version = context.state().items[1].version;
  const movements = context.state().movements.length;
  await deactivateSupplyItem(context.db, 1);
  await assert.rejects(
    removeSupplyItemStock(context.db, {
      supplyItemId: 1,
      actorId: 9,
      body: { quantity: 1, reason: "Uso", operationKey: "remove-inactive" },
    }),
    (error: unknown) => error instanceof SupplyInventoryError && error.code === "SUPPLY_INACTIVE"
  );
  await reactivateSupplyItem(context.db, 1);
  assert.equal(context.state().items[1].currentStock, stock);
  assert.equal(context.state().items[1].version, version);
  assert.equal(context.state().movements.length, movements);
  assert.equal(context.state().items[1].isActive, true);
});

test("reactivation rejects an inactive branch", async () => {
  const context = await createDefault();
  await deactivateSupplyItem(context.db, 1);
  context.state().branches[1].isActive = false;
  await assert.rejects(
    reactivateSupplyItem(context.db, 1),
    (error: unknown) => error instanceof SupplyInventoryError && error.code === "BRANCH_INACTIVE"
  );
  assert.equal(context.state().items[1].isActive, false);
});

test("movement history uses a stable createdAt and id cursor", async () => {
  const context = await createDefault();
  await restockSupplyItem(context.db, {
    supplyItemId: 1,
    actorId: 9,
    body: { quantity: 2, operationKey: "history-restock" },
  });
  const first = await listSupplyMovements(context.db, { supplyItemId: 1, cursor: null, limit: 1 });
  assert.equal(first.movements.length, 1);
  assert.equal(first.movements[0].movementType, SupplyMovementType.RESTOCK);
  assert.ok(first.nextCursor);
  const second = await listSupplyMovements(context.db, {
    supplyItemId: 1,
    cursor: first.nextCursor,
    limit: 1,
  });
  assert.equal(second.movements.length, 1);
  assert.equal(second.movements[0].movementType, SupplyMovementType.INITIAL_STOCK);
  assert.equal(second.nextCursor, null);
});

test("same operation key with a different payload is rejected", async () => {
  const context = await createDefault();
  await restockSupplyItem(context.db, {
    supplyItemId: 1,
    actorId: 9,
    body: { quantity: 2, operationKey: "shared-operation" },
  });
  await assert.rejects(
    restockSupplyItem(context.db, {
      supplyItemId: 1,
      actorId: 9,
      body: { quantity: 3, operationKey: "shared-operation" },
    }),
    (error: unknown) => error instanceof SupplyInventoryError && error.code === "SUPPLY_OPERATION_KEY_REUSED"
  );
});

test("P2002 movement races resolve as a safe replay", async () => {
  const item: Item = {
    id: 1,
    branchId: 1,
    name: "Tinta",
    normalizedName: "tinta",
    unitLabel: "botella",
    currentStock: 7,
    lowStockThreshold: 2,
    version: 1,
    isActive: true,
    creationOperationKey: "original-create-key",
    creationRequestHash: supplyRequestHash({ original: true }),
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const body = { quantity: 2, operationKey: "race-operation-1" };
  const expectedHash = supplyRequestHash({
    action: "RESTOCK",
    actorId: 9,
    supplyItemId: 1,
    quantity: 2,
    reason: null,
  });
  const db: any = {
    $transaction: async () => {
      throw new Prisma.PrismaClientKnownRequestError("Unique", {
        code: "P2002",
        clientVersion: "5.22.0",
      });
    },
    supplyMovement: {
      findUnique: async () => ({
        id: 2,
        supplyItemId: 1,
        deltaQty: 2,
        stockBefore: 5,
        stockAfter: 7,
        movementType: SupplyMovementType.RESTOCK,
        reason: null,
        createdById: 9,
        operationKey: body.operationKey,
        requestHash: expectedHash,
        createdAt: new Date(),
        supplyItem: item,
      }),
    },
  };
  const result = await restockSupplyItem(db, { supplyItemId: 1, actorId: 9, body });
  assert.equal(result.repeated, true);
  assert.equal(result.stockAfter, 7);
});

test("P2002 create race with the same key resolves as one replay", async () => {
  const body = createBody({ initialStock: 0, operationKey: "concurrent-create-key" });
  const creationRequestHash = supplyRequestHash({
    action: "CREATE",
    actorId: 9,
    branchId: 1,
    name: "Tinta Negra",
    normalizedName: "tinta negra",
    unitLabel: "botella",
    initialStock: 0,
    lowStockThreshold: 2,
  });
  const winner: Item = {
    id: 1,
    branchId: 1,
    name: "Tinta Negra",
    normalizedName: "tinta negra",
    unitLabel: "botella",
    currentStock: 0,
    lowStockThreshold: 2,
    version: 0,
    isActive: true,
    creationOperationKey: body.operationKey,
    creationRequestHash,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const db: any = {
    $transaction: async () => {
      throw new Prisma.PrismaClientKnownRequestError("Unique", {
        code: "P2002",
        clientVersion: "5.22.0",
      });
    },
    supplyItem: {
      findUnique: async ({ where }: any) => where.creationOperationKey
        ? { ...winner, _count: { movements: 0 }, movements: [] }
        : null,
    },
  };
  const result = await createSupplyItem(db, { actorId: 9, body });
  assert.equal(result.repeated, true);
  assert.equal(result.supplyItem.id, winner.id);
  assert.equal(result.supplyItem.currentStock, 0);
});

test("P2002 same-name race with different keys maps to an existing-supply conflict", async () => {
  const db: any = {
    $transaction: async () => {
      throw new Prisma.PrismaClientKnownRequestError("Unique", {
        code: "P2002",
        clientVersion: "5.22.0",
      });
    },
    supplyItem: {
      findUnique: async ({ where }: any) => {
        if (where.creationOperationKey) return null;
        if (where.branchId_normalizedName) return { id: 1, isActive: true };
        return null;
      },
    },
  };
  await assert.rejects(
    createSupplyItem(db, {
      actorId: 9,
      body: createBody({ operationKey: "different-create-key" }),
    }),
    (error: unknown) => error instanceof SupplyInventoryError && error.code === "SUPPLY_ALREADY_EXISTS"
  );
});
