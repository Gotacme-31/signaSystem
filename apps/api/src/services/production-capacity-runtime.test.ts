import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { combineBusinessDateTimeToUtc } from "../lib/business-time";
import { serializeConfig } from "../controllers/production-scheduling.controller";
import { planProductionCapacity } from "./production-capacity-planner";
import {
  buildProductionCapacityPlannerInput,
  assertExtraCapacitiesUseWorkingDays,
  loadProductionCapacitySnapshots,
  lockOrderProductionScheduling,
  normalizeExtraProductionThresholdQty,
  persistProductionCapacityPlan,
  ProductionCapacityConflictError,
  releaseOrderProductionReservations,
  type ProductionCapacityTx,
  type ProductionPlannerConfigSource,
} from "./production-capacity-runtime";
import { isValidActiveNormalWindow } from "./production-capacity-window";

const MONDAY = "2026-07-20";
const TUESDAY = "2026-07-21";
const planningNow = combineBusinessDateTimeToUtc(MONDAY, "08:00");

function workingWindow(dayOfWeek: number, overrides: Record<string, unknown> = {}) {
  return {
    dayOfWeek,
    startsAt: "09:00",
    endsAt: "10:00",
    readyAt: "10:00",
    capacityQty: "100",
    isActive: true,
    ...overrides,
  };
}

function normalConfig(): ProductionPlannerConfigSource {
  return {
    branchId: 1,
    productId: 10,
    extraProductionThresholdQty: null,
    windows: [
      { id: 1, dayOfWeek: 1, startsAt: "11:00", endsAt: "12:00", readyAt: "12:00", capacityQty: "70", isActive: true },
      { id: 2, dayOfWeek: 1, startsAt: "17:00", endsAt: "18:00", readyAt: "18:00", capacityQty: "70", isActive: true },
    ],
    quantityRules: [{ id: 1, minQty: "0", maxQty: null, delayBusinessDays: 0, targetWindow: "LAST_OF_DAY", capacityStrategy: "NORMAL", isActive: true }],
    dailyExtraCapacities: [],
  };
}

function extraConfig(): ProductionPlannerConfigSource {
  return {
    branchId: 1,
    productId: 10,
    extraProductionThresholdQty: "35",
    windows: [
      { id: 1, dayOfWeek: 1, startsAt: "17:00", endsAt: "18:00", readyAt: "18:00", capacityQty: "100", isActive: true },
      { id: 2, dayOfWeek: 2, startsAt: "17:00", endsAt: "18:00", readyAt: "18:00", capacityQty: "100", isActive: true },
    ],
    quantityRules: [{ id: 1, minQty: "0", maxQty: null, delayBusinessDays: 0, targetWindow: "LAST_OF_DAY", capacityStrategy: "EXTRA_PREFERRED", isActive: true }],
    dailyExtraCapacities: [
      { id: 101, dayOfWeek: 1, capacityQty: "100", isActive: true },
      { id: 102, dayOfWeek: 2, capacityQty: "100", isActive: true },
    ],
  };
}

function plannerInput(config: ProductionPlannerConfigSource, quantity: string, snapshots = { normalCapacitySnapshots: [], extraCapacitySnapshots: [] }) {
  return buildProductionCapacityPlannerInput({
    planningNow,
    config,
    itemKey: "order-item:500",
    orderItemId: 500,
    quantity,
    snapshots,
    normalPreviewReservations: new Map(),
    extraPreviewReservations: new Map(),
    blackoutDates: new Set(),
    maxSearchDays: 365,
  });
}

function fakePersistenceTx(claimResults: number[] = []) {
  const upserts: Array<Record<string, unknown>> = [];
  const batchItems: Array<Record<string, unknown>> = [];
  let batchId = 0;
  const tx = {
    productionBatch: {
      upsert: async (args: any) => {
        upserts.push(args);
        batchId += 1;
        return {
          id: batchId,
          kind: args.create.kind,
          branchId: args.create.branchId,
          productId: args.create.productId,
        };
      },
    },
    productionBatchItem: {
      create: async (args: any) => {
        batchItems.push(args.data);
        return args.data;
      },
    },
    $executeRaw: async () => claimResults.shift() ?? 1,
  };
  return { tx: tx as unknown as ProductionCapacityTx, upserts, batchItems };
}

test("adapter maps Prisma-like configuration into pure planner input", () => {
  const built = plannerInput(extraConfig(), "90");
  assert.equal(built.normalWindows[0].branchId, 1);
  assert.equal(built.extraCapacityTemplates[0].productId, 10);
  assert.equal(built.quantityRules[0].capacityStrategy, "EXTRA_PREFERRED");
  assert.equal(built.extraProductionThresholdQty?.toString(), "35");
  const plan = planProductionCapacity(built);
  assert.equal(plan.status, "PLANNED");
  assert.equal(plan.status === "PLANNED" && plan.allocationMode, "EXTRA_DAILY");
});

test("order scheduling lock uses the shared Order row", async () => {
  let queries = 0;
  const tx = {
    $queryRaw: async () => {
      queries += 1;
      return [{ id: 50 }];
    },
  } as unknown as ProductionCapacityTx;
  await lockOrderProductionScheduling(tx, 50);
  assert.equal(queries, 1);
});

test("snapshot loader separates NORMAL and EXTRA using reservedQty", async () => {
  const rows = [
    { kind: "NORMAL_WINDOW", branchId: 1, productId: 10, windowId: 1, extraCapacityId: null, productionDate: new Date("2026-07-20T18:00:00.000Z"), capacityQty: new Prisma.Decimal(100), reservedQty: new Prisma.Decimal("20.001"), status: "OPEN" },
    { kind: "EXTRA_DAILY", branchId: 1, productId: 10, windowId: null, extraCapacityId: 101, productionDate: new Date("2026-07-20T18:00:00.000Z"), capacityQty: new Prisma.Decimal(100), reservedQty: new Prisma.Decimal(90), status: "OPEN" },
  ];
  const tx = { productionBatch: { findMany: async () => rows } } as unknown as ProductionCapacityTx;
  const snapshots = await loadProductionCapacitySnapshots({ tx, branchId: 1, productIds: [10], planningNow, maxSearchDays: 365 });
  assert.equal(snapshots.normalCapacitySnapshots[0].reservedQty.toString(), "20.001");
  assert.equal(snapshots.extraCapacitySnapshots[0].reservedQty.toString(), "90");
});

test("persisted NORMAL allocations match preview plan one item per allocation", async () => {
  const plan = planProductionCapacity(plannerInput(normalConfig(), "100"));
  assert.equal(plan.status, "PLANNED");
  const fake = fakePersistenceTx();
  const readyAt = await persistProductionCapacityPlan({ tx: fake.tx, plan, orderId: 50, orderItemId: 500 });
  assert.equal(fake.upserts.length, 2);
  assert.equal(fake.batchItems.length, 2);
  assert.deepEqual(fake.batchItems.map((item: any) => item.quantityAssigned.toString()), ["70", "30"]);
  assert.equal(readyAt?.getTime(), plan.status === "PLANNED" ? plan.targetReadyAt.getTime() : 0);
});

test("persisted EXTRA allocations create discriminated daily batches", async () => {
  const plan = planProductionCapacity(plannerInput(extraConfig(), "150"));
  assert.equal(plan.status, "PLANNED");
  const fake = fakePersistenceTx();
  await persistProductionCapacityPlan({ tx: fake.tx, plan, orderId: 50, orderItemId: 500 });
  assert.equal(fake.upserts.length, 2);
  assert.ok(fake.upserts.every((entry: any) => entry.create.kind === "EXTRA_DAILY"));
  assert.deepEqual(fake.batchItems.map((item: any) => item.quantityAssigned.toString()), ["100", "50"]);
});

test("failed CAS rejects commit before creating batch item", async () => {
  const plan = planProductionCapacity(plannerInput(normalConfig(), "20"));
  const fake = fakePersistenceTx([0]);
  await assert.rejects(
    persistProductionCapacityPlan({ tx: fake.tx, plan, orderId: 50, orderItemId: 500 }),
    ProductionCapacityConflictError
  );
  assert.equal(fake.batchItems.length, 0);
});

test("release claims ACTIVE rows once for NORMAL and EXTRA", async () => {
  const rows = [
    { id: 1, batchId: 10, quantityAssigned: new Prisma.Decimal(30), active: true },
    { id: 2, batchId: 20, quantityAssigned: new Prisma.Decimal(40), active: true },
  ];
  let decrements = 0;
  const tx = {
    productionBatchItem: {
      findMany: async () => rows.filter((row) => row.active),
      updateMany: async ({ where }: any) => {
        const row = rows.find((candidate) => candidate.id === where.id && candidate.active);
        if (!row) return { count: 0 };
        row.active = false;
        return { count: 1 };
      },
    },
    $executeRaw: async () => {
      decrements += 1;
      return 1;
    },
  } as unknown as ProductionCapacityTx;
  assert.equal(await releaseOrderProductionReservations(tx, 50), 2);
  assert.equal(await releaseOrderProductionReservations(tx, 50), 0);
  assert.equal(decrements, 2);
});

test("two sequential adapter plans preserve 90 then 10+80", () => {
  const config = extraConfig();
  const first = planProductionCapacity(plannerInput(config, "90"));
  assert.equal(first.status, "PLANNED");
  const normalReservations = new Map<string, Prisma.Decimal>();
  const extraReservations = new Map<string, Prisma.Decimal>();
  if (first.status === "PLANNED") {
    for (const delta of first.previewReservationDeltas) extraReservations.set(delta.key, delta.quantityAssigned);
  }
  const secondInput = buildProductionCapacityPlannerInput({
    planningNow,
    config,
    itemKey: "order-item:501",
    orderItemId: 501,
    quantity: "90",
    snapshots: { normalCapacitySnapshots: [], extraCapacitySnapshots: [] },
    normalPreviewReservations: normalReservations,
    extraPreviewReservations: extraReservations,
    blackoutDates: new Set(),
    maxSearchDays: 365,
  });
  const second = planProductionCapacity(secondInput);
  assert.equal(second.status, "PLANNED");
  assert.deepEqual(second.status === "PLANNED" ? second.allocations.map((allocation) => allocation.quantityAssigned.toString()) : [], ["10", "80"]);
  assert.equal(
    second.status === "PLANNED" ? second.allocations[second.allocations.length - 1]?.productionDate : null,
    TUESDAY
  );
});

test("backend threshold normalization rejects zero and negative", () => {
  assert.throws(() => normalizeExtraProductionThresholdQty("0"), /mayor a 0/);
  assert.throws(() => normalizeExtraProductionThresholdQty("-0.001"), /mayor a 0/);
  assert.equal(normalizeExtraProductionThresholdQty("35.001")?.toString(), "35.001");
  assert.equal(normalizeExtraProductionThresholdQty(null), null);
});

test("backend rejects active EXTRA on non-working weekday", () => {
  assert.throws(() => assertExtraCapacitiesUseWorkingDays({
    windows: [workingWindow(1)],
    dailyExtraCapacities: [{ dayOfWeek: 0, capacityQty: "100", isActive: true }],
  }), /jornada de producción normal/);
  assert.doesNotThrow(() => assertExtraCapacitiesUseWorkingDays({
    windows: [workingWindow(0)],
    dailyExtraCapacities: [{ dayOfWeek: 0, capacityQty: "100", isActive: true }],
  }));
  assert.doesNotThrow(() => assertExtraCapacitiesUseWorkingDays({
    windows: [workingWindow(1)],
    dailyExtraCapacities: [{ dayOfWeek: 0, capacityQty: "100", isActive: false }],
  }));
});

test("working weekday requires an active positive window with valid ordered times", () => {
  assert.equal(isValidActiveNormalWindow(workingWindow(1)), true);
  assert.equal(isValidActiveNormalWindow(workingWindow(1, { isActive: false })), false);
  assert.equal(isValidActiveNormalWindow(workingWindow(1, { capacityQty: "0" })), false);
  assert.equal(isValidActiveNormalWindow(workingWindow(1, { endsAt: "24:00" })), false);
  assert.equal(isValidActiveNormalWindow(workingWindow(1, { readyAt: "10:60" })), false);
  assert.equal(isValidActiveNormalWindow(workingWindow(1, { startsAt: "10:00", endsAt: "09:00" })), false);
});

test("changing threshold changes both preview plan and persisted batch kind", async () => {
  const highThreshold = { ...extraConfig(), extraProductionThresholdQty: "100", quantityRules: [] };
  const lowThreshold = { ...extraConfig(), extraProductionThresholdQty: "35", quantityRules: [] };
  const normalPlan = planProductionCapacity(plannerInput(highThreshold, "90"));
  const extraPlan = planProductionCapacity(plannerInput(lowThreshold, "90"));
  assert.equal(normalPlan.status === "PLANNED" && normalPlan.allocationMode, "NORMAL_WINDOW");
  assert.equal(extraPlan.status === "PLANNED" && extraPlan.allocationMode, "EXTRA_DAILY");

  const normalFake = fakePersistenceTx();
  const extraFake = fakePersistenceTx();
  await persistProductionCapacityPlan({ tx: normalFake.tx, plan: normalPlan, orderId: 50, orderItemId: 500 });
  await persistProductionCapacityPlan({ tx: extraFake.tx, plan: extraPlan, orderId: 50, orderItemId: 500 });
  assert.ok(normalFake.upserts.every((entry: any) => entry.create.kind === "NORMAL_WINDOW"));
  assert.ok(extraFake.upserts.every((entry: any) => entry.create.kind === "EXTRA_DAILY"));
});

test("threshold and daily capacity remain independent values", () => {
  const config = { ...extraConfig(), extraProductionThresholdQty: "35.125" };
  config.dailyExtraCapacities = config.dailyExtraCapacities.map((template) => ({ ...template, capacityQty: "250.500" }));
  const built = plannerInput(config, "36");
  assert.equal(built.extraProductionThresholdQty?.toString(), "35.125");
  assert.equal(built.extraCapacityTemplates[0].capacityQty.toString(), "250.500");
});

test("API serialization retains threshold and identifies orphan templates", () => {
  const serialized = serializeConfig({
    id: 1,
    branchId: 1,
    productId: 10,
    enabled: true,
    extraProductionThresholdQty: new Prisma.Decimal("35.001"),
    windows: [{
      id: 1,
      dayOfWeek: 1,
      startsAt: "09:00",
      endsAt: "10:00",
      readyAt: "10:00",
      capacityQty: new Prisma.Decimal(100),
      isActive: true,
    }, {
      id: 2,
      dayOfWeek: 0,
      startsAt: "09:00",
      endsAt: "10:00",
      readyAt: "10:00",
      capacityQty: new Prisma.Decimal(0),
      isActive: true,
    }],
    quantityRules: [],
    dailyExtraCapacities: [
      { id: 101, dayOfWeek: 1, capacityQty: new Prisma.Decimal(100), isActive: true },
      { id: 100, dayOfWeek: 0, capacityQty: new Prisma.Decimal(100), isActive: true },
    ],
  });
  assert.equal(serialized.extraProductionThresholdQty, "35.001");
  assert.equal(serialized.dailyExtraCapacities[0].isOrphaned, false);
  assert.equal(serialized.dailyExtraCapacities[1].isOrphaned, true);
});
