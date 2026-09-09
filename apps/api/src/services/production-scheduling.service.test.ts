import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import {
  createOrderOperationalScheduleSource,
  normalizeCreateOrderCommercialDelivery,
} from "../controllers/order.controller";
import {
  addBusinessDays,
  businessDateKeyFromDate,
  businessDateToUtcNoon,
  businessTimeKeyFromDate,
  combineBusinessDateTimeToUtc,
} from "../lib/business-time";
import {
  calculateProductionSchedulePlan,
  previewProductionSchedule,
  refreshOrderParameterReadyTimesInTransaction,
  scheduleOrderProduction,
} from "./production-scheduling.service";

const FUTURE_DELIVERY_DATE = addBusinessDays(businessDateKeyFromDate(new Date()), 30);
const FUTURE_MANUAL_DATE = addBusinessDays(FUTURE_DELIVERY_DATE, 1);

function addMinutes(value: Date, minutes: number) {
  return new Date(value.getTime() + minutes * 60_000);
}

function productionConfig(options: {
  productId?: number;
  readyAt?: string;
  capacityQty?: string;
  extra?: boolean;
} = {}) {
  const now = new Date();
  const productId = options.productId ?? 10;
  const capacityQty = options.capacityQty ?? "100";
  const extra = options.extra === true;
  return {
    id: productId,
    branchId: 1,
    productId,
    enabled: true,
    extraProductionThresholdQty: extra ? new Prisma.Decimal(35) : null,
    createdAt: now,
    updatedAt: now,
    product: { name: `Producto ${productId}`, unitType: "PIECE" },
    windows: Array.from({ length: 7 }, (_, dayOfWeek) => ({
      id: productId * 10 + dayOfWeek,
      configId: productId,
      dayOfWeek,
      startsAt: "00:00",
      endsAt: "23:58",
      readyAt: options.readyAt ?? "23:59",
      capacityQty: new Prisma.Decimal(capacityQty),
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })),
    quantityRules: extra ? [{
      id: productId,
      configId: productId,
      minQty: new Prisma.Decimal(0),
      maxQty: null,
      delayBusinessDays: 0,
      targetWindow: "LAST_OF_DAY",
      capacityStrategy: "EXTRA_PREFERRED",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    }] : [],
    dailyExtraCapacities: extra
      ? Array.from({ length: 7 }, (_, dayOfWeek) => ({
          id: productId * 10 + dayOfWeek,
          configId: productId,
          dayOfWeek,
          capacityQty: new Prisma.Decimal(capacityQty),
          isActive: true,
          createdAt: now,
          updatedAt: now,
        }))
      : [],
  };
}

function installSchedulingDbStub(options: {
  configs?: ReturnType<typeof productionConfig>[];
  parameterConfigurations?: any[];
  orderOptions?: any[];
} = {}) {
  const orderUpdates: Array<Record<string, unknown>> = [];
  const orderItemUpdates: Array<Record<string, unknown>> = [];
  const createdBatches: Array<Record<string, unknown>> = [];
  const createdBatchItems: Array<Record<string, unknown>> = [];
  const promisedDeliveryDate = businessDateToUtcNoon(FUTURE_DELIVERY_DATE);
  const order = {
    id: 50,
    branchId: 1,
    deliveryDate: promisedDeliveryDate,
    deliveryTime: "15:30",
    estimatedReadyAt: combineBusinessDateTimeToUtc(FUTURE_DELIVERY_DATE, "15:30"),
    items: [{
      id: 500,
      productId: 10,
      productNameSnapshot: "Producto de prueba",
      quantity: new Prisma.Decimal(10),
      isCustomProduct: false,
      options: options.orderOptions ?? [],
    }],
  };
  let batchId = 0;
  const tx = {
    $queryRaw: async () => [{ id: order.id, notes: null }],
    $executeRaw: async () => 1,
    productProductionConfig: {
      findMany: async () => options.configs ?? [productionConfig()],
    },
    branchProductParamPrice: {
      findMany: async () => options.parameterConfigurations ?? [],
    },
    productionBlackoutDate: {
      findMany: async () => [],
    },
    productionBatch: {
      findMany: async () => [],
      upsert: async (args: any) => {
        batchId += 1;
        createdBatches.push(args.create);
        return {
          id: batchId,
          kind: args.create.kind ?? "NORMAL_WINDOW",
          branchId: args.create.branchId,
          productId: args.create.productId,
          readyAt: args.create.readyAt,
        };
      },
    },
    productionBatchItem: {
      findMany: async () => [],
      create: async (args: any) => {
        createdBatchItems.push(args.data);
        return args.data;
      },
    },
    orderItem: {
      update: async (args: any) => {
        orderItemUpdates.push(args.data);
        return args.data;
      },
    },
    order: {
      update: async (args: any) => {
        orderUpdates.push(args.data);
        return args.data;
      },
    },
  };

  const prismaClient = prisma as any;
  const orderDelegate = prisma.order as any;
  const originalTransaction = prismaClient.$transaction;
  const originalFindUnique = orderDelegate.findUnique;
  prismaClient.$transaction = async (callback: (transaction: typeof tx) => unknown) => callback(tx);
  orderDelegate.findUnique = async () => order;

  return {
    orderUpdates,
    orderItemUpdates,
    createdBatches,
    createdBatchItems,
    promisedDeliveryDate,
    restore() {
      prismaClient.$transaction = originalTransaction;
      orderDelegate.findUnique = originalFindUnique;
    },
  };
}

function assertCommercialPromiseUntouched(orderUpdates: Array<Record<string, unknown>>) {
  assert.ok(orderUpdates.length > 0);
  for (const update of orderUpdates) {
    assert.equal(Object.prototype.hasOwnProperty.call(update, "deliveryDate"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(update, "deliveryTime"), false);
  }
}

test("preview calculates production without writing the commercial promise", async () => {
  const stub = installSchedulingDbStub();
  try {
    const preview = await previewProductionSchedule({
      branchId: 1,
      items: [{ productId: 10, quantity: "10" }],
    });
    assert.equal(preview.plannerStatus, "PLANNED");
    assert.equal(preview.items[0].debug?.allocations.length, 1);
    assert.equal(preview.estimatedReadyAt?.getTime(), preview.items[0].estimatedReadyAt?.getTime());
    assert.equal(stub.orderUpdates.length, 0);
  } finally {
    stub.restore();
  }
});

test("parameter minutes change effective ready but keep NORMAL capacity allocations identical", async () => {
  const withoutParams = installSchedulingDbStub();
  let baseline;
  try {
    baseline = await previewProductionSchedule({
      branchId: 1,
      items: [{ clientItemKey: "A", productId: 10, quantity: "10" }],
    });
  } finally {
    withoutParams.restore();
  }

  const withParams = installSchedulingDbStub({
    parameterConfigurations: [{
      id: 1,
      branchProductId: 1,
      paramId: 7,
      priceDelta: new Prisma.Decimal(0),
      productionTimeMinutesPerUnit: 2,
      isActive: true,
      param: {
        id: 7,
        productId: 10,
        name: "Ojillos",
        isActive: true,
        chargeType: "PER_PIECE",
      },
    }],
  });
  try {
    const adjusted = await previewProductionSchedule({
      branchId: 1,
      items: [{
        clientItemKey: "A",
        productId: 10,
        quantity: "10",
        selectedParams: [{ paramId: 7, pieceQty: 20 }],
      }],
    });
    assert.equal(adjusted.items[0].clientItemKey, "A");
    assert.equal(adjusted.items[0].parameterExtraTimeMinutes, 40);
    assert.equal(adjusted.items[0].baseProductionReadyAt?.getTime(), baseline.items[0].estimatedReadyAt?.getTime());
    assert.equal(
      adjusted.items[0].estimatedReadyAt?.getTime(),
      (adjusted.items[0].baseProductionReadyAt?.getTime() ?? 0) + 40 * 60_000
    );
    assert.deepEqual(adjusted.items[0].allocations, baseline.items[0].allocations);
    assert.deepEqual(adjusted.items[0].debug?.allocations, baseline.items[0].debug?.allocations);
    assert.equal(adjusted.items[0].debug?.allocationMode, baseline.items[0].debug?.allocationMode);
  } finally {
    withParams.restore();
  }
});

test("commit persists base and effective ready from snapshots without adding capacity", async () => {
  const stub = installSchedulingDbStub({
    orderOptions: [{
      optionId: 7,
      name: "Ojillos",
      quantity: new Prisma.Decimal(20),
      chargeType: "PER_PIECE",
      appliedTimeMinutesPerUnit: 2,
      appliedExtraTimeMinutes: 40,
    }],
  });
  try {
    const result = await scheduleOrderProduction(50);
    assert.equal(result.ok, true);
    assert.equal(stub.createdBatchItems.length, 1);
    assert.equal(String(stub.createdBatchItems[0].quantityAssigned), "10");
    const scheduledUpdate = stub.orderItemUpdates.find((update) => update.baseProductionReadyAt);
    assert.ok(scheduledUpdate);
    assert.equal(
      (scheduledUpdate?.estimatedReadyAt as Date).getTime(),
      (scheduledUpdate?.baseProductionReadyAt as Date).getTime() + 40 * 60_000
    );
  } finally {
    stub.restore();
  }
});

test("NORMAL and EXTRA capacity persistence is invariant with parameter snapshots", async () => {
  for (const extra of [false, true]) {
    const configs = [productionConfig({ extra })];
    const baselineStub = installSchedulingDbStub({ configs });
    let baselineBatches;
    let baselineBatchItems;
    try {
      await scheduleOrderProduction(50);
      baselineBatches = baselineStub.createdBatches.map((batch) => ({
        kind: batch.kind,
        capacityQty: String(batch.capacityQty),
        reservedQty: String(batch.reservedQty),
        readyAt: (batch.readyAt as Date).toISOString(),
      }));
      baselineBatchItems = baselineStub.createdBatchItems.map((item) => ({
        quantityAssigned: String(item.quantityAssigned),
        source: item.source,
        status: item.status,
      }));
    } finally {
      baselineStub.restore();
    }

    const adjustedStub = installSchedulingDbStub({
      configs,
      orderOptions: [{
        optionId: 7,
        name: "Acabado",
        quantity: new Prisma.Decimal(1),
        chargeType: "PER_METER",
        appliedTimeMinutesPerUnit: 4,
        appliedExtraTimeMinutes: 40,
      }],
    });
    try {
      await scheduleOrderProduction(50);
      assert.deepEqual(adjustedStub.createdBatches.map((batch) => ({
        kind: batch.kind,
        capacityQty: String(batch.capacityQty),
        reservedQty: String(batch.reservedQty),
        readyAt: (batch.readyAt as Date).toISOString(),
      })), baselineBatches);
      assert.deepEqual(adjustedStub.createdBatchItems.map((item) => ({
        quantityAssigned: String(item.quantityAssigned),
        source: item.source,
        status: item.status,
      })), baselineBatchItems);
    } finally {
      adjustedStub.restore();
    }
  }
});

test("preview and commit return the same effective ready for identical parameter inputs", async () => {
  const parameterConfiguration = {
    id: 1,
    branchProductId: 1,
    paramId: 7,
    priceDelta: new Prisma.Decimal(0),
    productionTimeMinutesPerUnit: 2,
    isActive: true,
    param: {
      id: 7,
      productId: 10,
      name: "Ojillos",
      isActive: true,
      chargeType: "PER_PIECE",
    },
  };
  const previewStub = installSchedulingDbStub({ parameterConfigurations: [parameterConfiguration] });
  let previewReadyAt;
  try {
    const preview = await previewProductionSchedule({
      branchId: 1,
      items: [{ productId: 10, quantity: 10, selectedParams: [{ paramId: 7, pieceQty: 20 }] }],
    });
    previewReadyAt = preview.estimatedReadyAt?.toISOString();
  } finally {
    previewStub.restore();
  }

  const commitStub = installSchedulingDbStub({
    orderOptions: [{
      optionId: 7,
      name: "Ojillos",
      quantity: new Prisma.Decimal(20),
      chargeType: "PER_PIECE",
      appliedTimeMinutesPerUnit: 2,
      appliedExtraTimeMinutes: 40,
    }],
  });
  try {
    const commit = await scheduleOrderProduction(50);
    assert.equal(commit.estimatedReadyAt?.toISOString(), previewReadyAt);
  } finally {
    commitStub.restore();
  }
});

test("parameter-only refresh preserves base and capacity while updating item and order maxima", async () => {
  const firstBase = combineBusinessDateTimeToUtc(FUTURE_DELIVERY_DATE, "14:00");
  const secondBase = combineBusinessDateTimeToUtc(FUTURE_DELIVERY_DATE, "14:30");
  const rows: any[] = [
    {
      id: 1,
      baseProductionReadyAt: firstBase,
      autoEstimatedReadyAt: addMinutes(firstBase, 20),
      manualReadyAt: null,
      estimatedReadyAt: addMinutes(firstBase, 20),
      productionScheduleStatus: "AUTO_SCHEDULED",
      productionScheduleSource: "AUTO",
      productionScheduleMessage: null,
      order: { productionScheduleSource: "AUTO" },
      options: [{ appliedExtraTimeMinutes: 60 }],
    },
    {
      id: 2,
      baseProductionReadyAt: secondBase,
      autoEstimatedReadyAt: addMinutes(secondBase, 10),
      manualReadyAt: null,
      estimatedReadyAt: addMinutes(secondBase, 10),
      productionScheduleStatus: "AUTO_SCHEDULED",
      productionScheduleSource: "AUTO",
      productionScheduleMessage: null,
      order: { productionScheduleSource: "AUTO" },
      options: [{ appliedExtraTimeMinutes: 10 }],
    },
  ];
  const itemUpdates: any[] = [];
  const orderUpdates: any[] = [];
  const tx = {
    orderItem: {
      findMany: async () => rows,
      update: async ({ where, data }: any) => {
        itemUpdates.push({ where, data });
        Object.assign(rows.find((row) => row.id === where.id), data);
      },
    },
    order: {
      update: async ({ data }: any) => orderUpdates.push(data),
    },
  } as any;

  await refreshOrderParameterReadyTimesInTransaction(tx, 50);
  assert.equal(itemUpdates.length, 2);
  assert.equal(rows[0].baseProductionReadyAt.getTime(), firstBase.getTime());
  assert.equal(rows[0].estimatedReadyAt.getTime(), addMinutes(firstBase, 60).getTime());
  assert.equal(orderUpdates[0].estimatedReadyAt.getTime(), addMinutes(firstBase, 60).getTime());
});

test("legacy AUTO item uses its historical auto estimate as an unequivocal base", async () => {
  const historicalAutoReady = combineBusinessDateTimeToUtc(FUTURE_DELIVERY_DATE, "14:00");
  const rows: any[] = [{
    id: 1,
    baseProductionReadyAt: null,
    autoEstimatedReadyAt: historicalAutoReady,
    manualReadyAt: null,
    estimatedReadyAt: historicalAutoReady,
    productionScheduleStatus: "AUTO_SCHEDULED",
    productionScheduleSource: "AUTO",
    productionScheduleMessage: null,
    order: { productionScheduleSource: "AUTO" },
    options: [{ appliedExtraTimeMinutes: 30 }],
  }];
  const tx = {
    orderItem: {
      findMany: async () => rows,
      update: async ({ where, data }: any) => Object.assign(rows.find((row) => row.id === where.id), data),
    },
    order: { update: async () => undefined },
  } as any;
  await refreshOrderParameterReadyTimesInTransaction(tx, 50);
  assert.equal(rows[0].baseProductionReadyAt.getTime(), historicalAutoReady.getTime());
  assert.equal(rows[0].estimatedReadyAt.getTime(), addMinutes(historicalAutoReady, 30).getTime());
});

test("legacy AUTO item without a historical base is rejected clearly", async () => {
  const itemUpdates: any[] = [];
  const orderUpdates: any[] = [];
  const tx = {
    orderItem: {
      findMany: async () => [{
        id: 1,
        baseProductionReadyAt: null,
        autoEstimatedReadyAt: null,
        manualReadyAt: null,
        productionScheduleSource: "AUTO",
        order: { productionScheduleSource: "AUTO" },
        options: [{ appliedExtraTimeMinutes: 10 }],
      }],
      update: async (args: any) => itemUpdates.push(args),
    },
    order: { update: async (args: any) => orderUpdates.push(args) },
  } as any;
  await assert.rejects(
    () => refreshOrderParameterReadyTimesInTransaction(tx, 50),
    (error: unknown) => error instanceof Error
      && "code" in error
      && error.code === "LEGACY_PARAMETER_READY_BASE_UNAVAILABLE"
  );
  assert.equal(itemUpdates.length, 0);
  assert.equal(orderUpdates.length, 0);
});

test("parameter-only refresh never adds time to a MANUAL item", async () => {
  const manualReadyAt = combineBusinessDateTimeToUtc(FUTURE_MANUAL_DATE, "16:00");
  const historicalAutoReady = combineBusinessDateTimeToUtc(FUTURE_DELIVERY_DATE, "14:00");
  const rows: any[] = [{
    id: 1,
    baseProductionReadyAt: null,
    autoEstimatedReadyAt: historicalAutoReady,
    manualReadyAt,
    estimatedReadyAt: manualReadyAt,
    productionScheduleStatus: "MANUAL_SET",
    productionScheduleSource: "MANUAL",
    productionScheduleMessage: null,
    order: { productionScheduleSource: "MANUAL" },
    options: [{ appliedExtraTimeMinutes: 120 }],
  }];
  const itemUpdates: any[] = [];
  const orderUpdates: any[] = [];
  const tx = {
    orderItem: {
      findMany: async () => rows,
      update: async (args: any) => itemUpdates.push(args),
    },
    order: { update: async ({ data }: any) => orderUpdates.push(data) },
  } as any;
  await refreshOrderParameterReadyTimesInTransaction(tx, 50);
  assert.equal(itemUpdates.length, 0);
  assert.equal(orderUpdates[0].estimatedReadyAt.getTime(), manualReadyAt.getTime());
});

test("legacy AUTO item with manualReadyAt fails before any write", async () => {
  const autoReadyAt = combineBusinessDateTimeToUtc(FUTURE_DELIVERY_DATE, "14:00");
  const manualReadyAt = combineBusinessDateTimeToUtc(FUTURE_MANUAL_DATE, "16:00");
  const itemUpdates: any[] = [];
  const orderUpdates: any[] = [];
  const tx = {
    orderItem: {
      findMany: async () => [
        {
          id: 1,
          baseProductionReadyAt: autoReadyAt,
          autoEstimatedReadyAt: addMinutes(autoReadyAt, 10),
          manualReadyAt: null,
          productionScheduleSource: "AUTO",
          order: { productionScheduleSource: "AUTO" },
          options: [{ appliedExtraTimeMinutes: 20 }],
        },
        {
          id: 2,
          baseProductionReadyAt: null,
          autoEstimatedReadyAt: autoReadyAt,
          manualReadyAt,
          productionScheduleSource: "AUTO",
          order: { productionScheduleSource: "AUTO" },
          options: [{ appliedExtraTimeMinutes: 30 }],
        },
      ],
      update: async (args: any) => itemUpdates.push(args),
    },
    order: { update: async (args: any) => orderUpdates.push(args) },
  } as any;

  await assert.rejects(
    () => refreshOrderParameterReadyTimesInTransaction(tx, 50),
    (error: unknown) => error instanceof Error
      && "code" in error
      && error.code === "LEGACY_PARAMETER_READY_SOURCE_CONFLICT"
  );
  assert.equal(itemUpdates.length, 0);
  assert.equal(orderUpdates.length, 0);
});

test("AUTO item rejects an inconsistent MANUAL order source before any write", async () => {
  const autoReadyAt = combineBusinessDateTimeToUtc(FUTURE_DELIVERY_DATE, "14:00");
  const itemUpdates: any[] = [];
  const orderUpdates: any[] = [];
  const tx = {
    orderItem: {
      findMany: async () => [{
        id: 1,
        baseProductionReadyAt: null,
        autoEstimatedReadyAt: autoReadyAt,
        manualReadyAt: null,
        productionScheduleSource: "AUTO",
        order: { productionScheduleSource: "MANUAL" },
        options: [{ appliedExtraTimeMinutes: 30 }],
      }],
      update: async (args: any) => itemUpdates.push(args),
    },
    order: { update: async (args: any) => orderUpdates.push(args) },
  } as any;

  await assert.rejects(
    () => refreshOrderParameterReadyTimesInTransaction(tx, 50),
    (error: unknown) => error instanceof Error
      && "code" in error
      && error.code === "LEGACY_PARAMETER_READY_SOURCE_CONFLICT"
  );
  assert.equal(itemUpdates.length, 0);
  assert.equal(orderUpdates.length, 0);
});

test("modern AUTO item always recalculates from baseProductionReadyAt", async () => {
  const baseReadyAt = combineBusinessDateTimeToUtc(FUTURE_DELIVERY_DATE, "14:00");
  const rows: any[] = [{
    id: 1,
    baseProductionReadyAt: baseReadyAt,
    autoEstimatedReadyAt: addMinutes(baseReadyAt, 40),
    manualReadyAt: null,
    estimatedReadyAt: addMinutes(baseReadyAt, 40),
    productionScheduleStatus: "AUTO_SCHEDULED",
    productionScheduleSource: "AUTO",
    productionScheduleMessage: null,
    order: { productionScheduleSource: "AUTO" },
    options: [{ appliedExtraTimeMinutes: 50 }],
  }];
  const tx = {
    orderItem: {
      findMany: async () => rows,
      update: async ({ where, data }: any) => Object.assign(
        rows.find((row) => row.id === where.id),
        data
      ),
    },
    order: { update: async () => undefined },
  } as any;

  await refreshOrderParameterReadyTimesInTransaction(tx, 50);
  assert.equal(rows[0].baseProductionReadyAt.getTime(), baseReadyAt.getTime());
  assert.equal(rows[0].estimatedReadyAt.getTime(), addMinutes(baseReadyAt, 50).getTime());
});

test("MANUAL ready remains authoritative when parameter snapshots exist", async () => {
  const stub = installSchedulingDbStub({
    orderOptions: [{
      optionId: 7,
      name: "Ojillos",
      quantity: new Prisma.Decimal(20),
      chargeType: "PER_PIECE",
      appliedTimeMinutesPerUnit: 2,
      appliedExtraTimeMinutes: 40,
    }],
  });
  const manualReadyAt = combineBusinessDateTimeToUtc(FUTURE_MANUAL_DATE, "23:59");
  try {
    const result = await scheduleOrderProduction(50, {
      finalReadyAt: manualReadyAt,
      deliveryScheduleSource: "MANUAL",
    });
    assert.equal(result.estimatedReadyAt?.getTime(), manualReadyAt.getTime());
    const itemUpdate = stub.orderItemUpdates.find((update) => update.productionScheduleSource === "MANUAL");
    assert.equal((itemUpdate?.estimatedReadyAt as Date).getTime(), manualReadyAt.getTime());
    assert.equal(itemUpdate?.baseProductionReadyAt, null);
  } finally {
    stub.restore();
  }
});

test("split item uses the readyAt of its last required fragment", async () => {
  const stub = installSchedulingDbStub({
    configs: [productionConfig({ productId: 20, capacityQty: "100", extra: true })],
  });
  try {
    const preview = await previewProductionSchedule({
      branchId: 1,
      items: [{ productId: 20, quantity: "150" }],
    });
    const allocations = preview.items[0].debug?.allocations ?? [];
    assert.equal(allocations.length, 2);
    assert.equal(
      allocations[allocations.length - 1].date,
      preview.estimatedReadyAt ? businessDateKeyFromDate(preview.estimatedReadyAt) : null
    );
    const lastAllocationReadyAt = combineBusinessDateTimeToUtc(
      allocations[allocations.length - 1].date,
      allocations[allocations.length - 1].readyAt
    );
    assert.equal(preview.estimatedReadyAt?.getTime(), lastAllocationReadyAt.getTime());
    assert.equal(preview.estimatedReadyAt?.getTime(), preview.items[0].estimatedReadyAt?.getTime());
  } finally {
    stub.restore();
  }
});

test("multiple items use the latest item completion", async () => {
  const stub = installSchedulingDbStub({
    configs: [
      productionConfig({ productId: 10, readyAt: "18:00" }),
      productionConfig({ productId: 20, readyAt: "23:59" }),
    ],
  });
  try {
    const preview = await previewProductionSchedule({
      branchId: 1,
      items: [{ productId: 10, quantity: "10" }, { productId: 20, quantity: "10" }],
    });
    const itemTimes = preview.items
      .map((item) => item.estimatedReadyAt?.getTime() ?? 0);
    assert.equal(preview.estimatedReadyAt?.getTime(), Math.max(...itemTimes));
  } finally {
    stub.restore();
  }
});

test("mixed NORMAL and EXTRA items use the latest completion", async () => {
  const stub = installSchedulingDbStub({
    configs: [
      productionConfig({ productId: 10, readyAt: "18:00" }),
      productionConfig({ productId: 20, capacityQty: "100", extra: true }),
    ],
  });
  try {
    const preview = await previewProductionSchedule({
      branchId: 1,
      items: [{ productId: 10, quantity: "10" }, { productId: 20, quantity: "150" }],
    });
    assert.deepEqual(
      preview.items.map((item) => item.debug?.allocationMode),
      ["NORMAL_WINDOW", "EXTRA_DAILY"]
    );
    const itemTimes = preview.items.map((item) => item.estimatedReadyAt?.getTime() ?? 0);
    assert.equal(preview.estimatedReadyAt?.getTime(), Math.max(...itemTimes));
  } finally {
    stub.restore();
  }
});

test("preview and commit use the same implicit threshold decision", async () => {
  const implicitExtraConfig = { ...productionConfig({ extra: true }), quantityRules: [] };
  const stub = installSchedulingDbStub({ configs: [implicitExtraConfig] });
  try {
    const preview = await previewProductionSchedule({
      branchId: 1,
      items: [{ productId: 10, quantity: "40" }],
    });
    const commit = await calculateProductionSchedulePlan({
      branchId: 1,
      orderId: 50,
      mode: "commit",
      items: [{ productId: 10, quantity: "40", orderItemId: 500 }],
    });
    const previewDecision = preview.items[0].debug;
    const commitDecision = commit.items[0].debug;

    assert.deepEqual(
      previewDecision && {
        matchedRule: previewDecision.matchedRule,
        defaultRuleApplied: previewDecision.defaultRuleApplied,
        delayBusinessDays: previewDecision.delayBusinessDays,
        targetWindow: previewDecision.targetWindow,
        allocationMode: previewDecision.allocationMode,
      },
      commitDecision && {
        matchedRule: commitDecision.matchedRule,
        defaultRuleApplied: commitDecision.defaultRuleApplied,
        delayBusinessDays: commitDecision.delayBusinessDays,
        targetWindow: commitDecision.targetWindow,
        allocationMode: commitDecision.allocationMode,
      }
    );
    assert.equal(previewDecision?.allocationMode, "EXTRA_DAILY");
    assert.equal(preview.items[0].matchedRule, null);
    assert.equal(commit.items[0].matchedRule, null);
    assert.ok(stub.createdBatches.length > 0);
    assert.ok(stub.createdBatches.every((batch) => batch.kind === "EXTRA_DAILY"));
  } finally {
    stub.restore();
  }
});

test("all NOT_REQUIRED items produce no order estimate", async () => {
  const stub = installSchedulingDbStub({ configs: [] });
  try {
    const preview = await previewProductionSchedule({
      branchId: 1,
      items: [{ productId: 99, quantity: "10" }],
    });
    assert.equal(preview.plannerStatus, "NOT_REQUIRED");
    assert.equal(preview.estimatedReadyAt, null);
    assert.equal(preview.items[0].plannerStatus, "NOT_REQUIRED");
  } finally {
    stub.restore();
  }
});

test("UNSCHEDULABLE item does not invent an order estimate", async () => {
  const noWindowsConfig = { ...productionConfig({ productId: 30 }), windows: [] };
  const stub = installSchedulingDbStub({ configs: [noWindowsConfig] });
  try {
    const preview = await previewProductionSchedule({
      branchId: 1,
      items: [{ productId: 30, quantity: "10" }],
    });
    assert.equal(preview.plannerStatus, "UNSCHEDULABLE");
    assert.equal(preview.estimatedReadyAt, null);
  } finally {
    stub.restore();
  }
});

test("mixed planned and UNSCHEDULABLE items expose partial time but remain UNSCHEDULABLE", async () => {
  const noWindowsConfig = { ...productionConfig({ productId: 30 }), windows: [] };
  const stub = installSchedulingDbStub({
    configs: [productionConfig({ productId: 10 }), noWindowsConfig],
  });
  try {
    const preview = await previewProductionSchedule({
      branchId: 1,
      items: [{ productId: 10, quantity: "10" }, { productId: 30, quantity: "10" }],
    });
    assert.equal(preview.plannerStatus, "UNSCHEDULABLE");
    assert.ok(preview.estimatedReadyAt);
    assert.deepEqual(preview.items.map((item) => item.plannerStatus), ["PLANNED", "UNSCHEDULABLE"]);
  } finally {
    stub.restore();
  }
});

test("creation scheduling preserves deliveryDate and deliveryTime", async () => {
  const stub = installSchedulingDbStub();
  try {
    const result = await scheduleOrderProduction(50, {
      finalReadyAt: combineBusinessDateTimeToUtc(FUTURE_DELIVERY_DATE, "15:30"),
      deliveryScheduleSource: "AUTO",
    });
    assert.equal(result.ok, true);
    assert.equal(stub.createdBatchItems.length, 1);
    assert.equal(String(stub.createdBatchItems[0].quantityAssigned), "10");
    assert.equal(stub.createdBatchItems[0].source, "AUTO");
    assertCommercialPromiseUntouched(stub.orderUpdates);
  } finally {
    stub.restore();
  }
});

test("manual edit scheduling preserves deliveryDate and deliveryTime", async () => {
  const stub = installSchedulingDbStub();
  try {
    const result = await scheduleOrderProduction(50, {
      finalReadyAt: combineBusinessDateTimeToUtc(FUTURE_MANUAL_DATE, "23:59"),
      deliveryScheduleSource: "MANUAL",
    });
    assert.equal(result.ok, true);
    assert.equal(result.source, "MANUAL");
    assertCommercialPromiseUntouched(stub.orderUpdates);
  } finally {
    stub.restore();
  }
});

test("automatic reprogramming reads but does not replace the commercial promise", async () => {
  const stub = installSchedulingDbStub();
  try {
    const result = await scheduleOrderProduction(50);
    assert.equal(result.ok, true);
    assertCommercialPromiseUntouched(stub.orderUpdates);
  } finally {
    stub.restore();
  }
});

test("creation preserves exact commercial delivery for ADMIN and non ADMIN", () => {
  for (const role of ["ADMIN", "STAFF", "COUNTER", "MULTI_COUNTER", "PRODUCTION"]) {
    const delivery = normalizeCreateOrderCommercialDelivery({
      deliveryDate: "2026-08-04",
      deliveryTime: "00:01",
    }, role);
    assert.equal(businessDateKeyFromDate(delivery.deliveryDate), "2026-08-04");
    assert.equal(delivery.deliveryTime, "00:01");
    assert.equal(businessDateKeyFromDate(delivery.finalReadyAt), "2026-08-04");
    assert.equal(businessTimeKeyFromDate(delivery.finalReadyAt), "00:01");
  }
});

test("creation keeps strict commercial date and time validation", () => {
  assert.throws(() => normalizeCreateOrderCommercialDelivery({
    deliveryDate: "04/08/2026",
    deliveryTime: "00:01",
  }), /Formato esperado: YYYY-MM-DD/);
  assert.throws(() => normalizeCreateOrderCommercialDelivery({
    deliveryDate: "2026-08-04",
    deliveryTime: "24:00",
  }), /Hora de entrega inválida/);
});

test("creation ignores presentation MANUAL mode and commits operational AUTO scheduling", () => {
  assert.equal(createOrderOperationalScheduleSource("MANUAL"), "AUTO");
  assert.equal(createOrderOperationalScheduleSource("AUTO"), "AUTO");
  assert.equal(createOrderOperationalScheduleSource(undefined), "AUTO");
});
