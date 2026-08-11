import { Prisma, ProductionScheduleSource } from "@prisma/client";
import {
  addBusinessDays,
  businessDateKeyFromDate,
  businessDateToUtcNoon,
} from "../lib/business-time";
import {
  type DecimalInput,
  type ExtraCapacityDateSnapshot,
  type NormalCapacitySnapshot,
  type ProductionCapacityPlannerInput,
  type ProductionItemPlan,
  type ProductionQuantityRuleInput,
} from "./production-capacity-planner";
import {
  workingWeekdaysFromNormalWindows,
  type NormalWindowWorkdayCandidate,
} from "./production-capacity-window";

export type ProductionCapacityTx = Prisma.TransactionClient;

export type ProductionPlannerConfigSource = {
  branchId: number;
  productId: number;
  extraProductionThresholdQty: DecimalInput | null;
  windows: readonly {
    id: number;
    dayOfWeek: number;
    startsAt: string;
    endsAt: string;
    readyAt: string;
    capacityQty: DecimalInput;
    isActive: boolean;
  }[];
  quantityRules: readonly {
    id: number;
    minQty: DecimalInput;
    maxQty: DecimalInput | null;
    delayBusinessDays: number;
    targetWindow: ProductionQuantityRuleInput["targetWindow"];
    capacityStrategy: ProductionQuantityRuleInput["capacityStrategy"];
    isActive: boolean;
  }[];
  dailyExtraCapacities: readonly {
    id: number;
    dayOfWeek: number;
    capacityQty: DecimalInput;
    isActive: boolean;
  }[];
};

export type ProductionCapacitySnapshotBundle = {
  normalCapacitySnapshots: NormalCapacitySnapshot[];
  extraCapacitySnapshots: ExtraCapacityDateSnapshot[];
};

export class ProductionCapacityConflictError extends Error {
  constructor() {
    super("La capacidad de producción cambió durante la reserva; vuelve a calcular el pedido.");
    this.name = "ProductionCapacityConflictError";
  }
}

export async function lockOrderProductionScheduling(tx: ProductionCapacityTx, orderId: number) {
  const rows = await tx.$queryRaw<Array<{ id: number; notes: string | null }>>`
    SELECT "id", "notes"
    FROM "Order"
    WHERE "id" = ${orderId}
    FOR UPDATE
  `;
  if (rows.length !== 1) throw new Error("Pedido no encontrado para agenda de producción.");
  return rows[0];
}

export function buildProductionCapacityPlannerInput(args: {
  planningNow: Date;
  config: ProductionPlannerConfigSource;
  itemKey: string;
  orderItemId?: number | null;
  quantity: DecimalInput;
  snapshots: ProductionCapacitySnapshotBundle;
  normalPreviewReservations?: ReadonlyMap<string, DecimalInput>;
  extraPreviewReservations?: ReadonlyMap<string, DecimalInput>;
  blackoutDates: ReadonlySet<string>;
  maxSearchDays: number;
}): ProductionCapacityPlannerInput {
  const { config } = args;
  return {
    planningNow: args.planningNow,
    branchId: config.branchId,
    productId: config.productId,
    itemKey: args.itemKey,
    orderItemId: args.orderItemId,
    quantity: args.quantity,
    extraProductionThresholdQty: config.extraProductionThresholdQty,
    quantityRules: config.quantityRules.map((rule) => ({ ...rule })),
    normalWindows: config.windows.map((window) => ({
      ...window,
      branchId: config.branchId,
      productId: config.productId,
    })),
    normalCapacitySnapshots: args.snapshots.normalCapacitySnapshots,
    extraCapacityTemplates: config.dailyExtraCapacities.map((template) => ({
      ...template,
      branchId: config.branchId,
      productId: config.productId,
    })),
    extraCapacitySnapshots: args.snapshots.extraCapacitySnapshots,
    normalPreviewReservations: args.normalPreviewReservations,
    extraPreviewReservations: args.extraPreviewReservations,
    blackoutDates: args.blackoutDates,
    maxSearchDays: args.maxSearchDays,
  };
}

export function normalizeExtraProductionThresholdQty(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const threshold = new Prisma.Decimal(String(value));
  if (threshold.lte(0)) {
    throw new Error("El umbral de producción extra debe ser mayor a 0.");
  }
  if (threshold.decimalPlaces() > 3) {
    throw new Error("El umbral de producción extra admite hasta 3 decimales.");
  }
  return threshold;
}

export function assertExtraCapacitiesUseWorkingDays(args: {
  windows: readonly NormalWindowWorkdayCandidate[];
  dailyExtraCapacities: readonly { dayOfWeek: number; capacityQty: DecimalInput; isActive: boolean }[];
}) {
  const workingWeekdays = workingWeekdaysFromNormalWindows(args.windows);
  const orphan = args.dailyExtraCapacities.find((extra) =>
    extra.isActive
    && new Prisma.Decimal(extra.capacityQty).gt(0)
    && !workingWeekdays.has(extra.dayOfWeek)
  );
  if (orphan) {
    throw new Error("La capacidad extra activa solo puede configurarse en días con jornada de producción normal.");
  }
}

export async function loadProductionCapacitySnapshots(args: {
  tx: ProductionCapacityTx;
  branchId: number;
  productIds: number[];
  planningNow: Date;
  maxSearchDays: number;
}): Promise<ProductionCapacitySnapshotBundle> {
  if (args.productIds.length === 0) {
    return { normalCapacitySnapshots: [], extraCapacitySnapshots: [] };
  }

  const planningDate = businessDateKeyFromDate(args.planningNow);
  const endDate = addBusinessDays(planningDate, args.maxSearchDays * 2 + 1);
  const batches = await args.tx.productionBatch.findMany({
    where: {
      branchId: args.branchId,
      productId: { in: args.productIds },
      productionDate: {
        gte: businessDateToUtcNoon(planningDate),
        lt: businessDateToUtcNoon(endDate),
      },
    },
    select: {
      kind: true,
      branchId: true,
      productId: true,
      windowId: true,
      extraCapacityId: true,
      productionDate: true,
      capacityQty: true,
      reservedQty: true,
      status: true,
    },
  });

  const normalCapacitySnapshots: NormalCapacitySnapshot[] = [];
  const extraCapacitySnapshots: ExtraCapacityDateSnapshot[] = [];

  for (const batch of batches) {
    const productionDate = businessDateKeyFromDate(batch.productionDate);
    if (batch.kind === "NORMAL_WINDOW" && batch.windowId !== null) {
      normalCapacitySnapshots.push({
        branchId: batch.branchId,
        productId: batch.productId,
        windowId: batch.windowId,
        productionDate,
        capacityQty: batch.capacityQty,
        reservedQty: batch.reservedQty,
        status: batch.status,
      });
    } else if (batch.kind === "EXTRA_DAILY" && batch.extraCapacityId !== null) {
      extraCapacitySnapshots.push({
        branchId: batch.branchId,
        productId: batch.productId,
        extraCapacityId: batch.extraCapacityId,
        productionDate,
        capacityQty: batch.capacityQty,
        reservedQty: batch.reservedQty,
        status: batch.status,
      });
    }
  }

  return { normalCapacitySnapshots, extraCapacitySnapshots };
}

export function applyPreviewReservationDeltas(args: {
  plan: ProductionItemPlan;
  normalReservations: Map<string, Prisma.Decimal>;
  extraReservations: Map<string, Prisma.Decimal>;
}) {
  if (args.plan.status !== "PLANNED") return;
  for (const delta of args.plan.previewReservationDeltas) {
    const target = delta.kind === "NORMAL_WINDOW" ? args.normalReservations : args.extraReservations;
    const current = target.get(delta.key) ?? new Prisma.Decimal(0);
    target.set(delta.key, current.add(delta.quantityAssigned));
  }
}

async function upsertBatchForAllocation(
  tx: ProductionCapacityTx,
  allocation: Extract<ProductionItemPlan, { status: "PLANNED" }>["allocations"][number]
) {
  const productionDate = businessDateToUtcNoon(allocation.productionDate);
  if (allocation.kind === "NORMAL_WINDOW") {
    return tx.productionBatch.upsert({
      where: {
        branchId_productId_windowId_productionDate: {
          branchId: allocation.branchId,
          productId: allocation.productId,
          windowId: allocation.windowId,
          productionDate,
        },
      },
      create: {
        kind: "NORMAL_WINDOW",
        branchId: allocation.branchId,
        productId: allocation.productId,
        windowId: allocation.windowId,
        extraCapacityId: null,
        productionDate,
        windowStartAt: allocation.windowStartAt,
        windowEndAt: allocation.windowEndAt,
        readyAt: allocation.readyAt,
        capacityQty: allocation.capacityQty,
        reservedQty: new Prisma.Decimal(0),
      },
      update: {},
      select: { id: true, kind: true, branchId: true, productId: true },
    });
  }

  return tx.productionBatch.upsert({
    where: {
      extraCapacityId_productionDate: {
        extraCapacityId: allocation.extraCapacityId,
        productionDate,
      },
    },
    create: {
      kind: "EXTRA_DAILY",
      branchId: allocation.branchId,
      productId: allocation.productId,
      windowId: null,
      extraCapacityId: allocation.extraCapacityId,
      productionDate,
      windowStartAt: null,
      windowEndAt: null,
      readyAt: allocation.readyAt,
      capacityQty: allocation.capacityQty,
      reservedQty: new Prisma.Decimal(0),
    },
    update: {},
    select: { id: true, kind: true, branchId: true, productId: true },
  });
}

export async function persistProductionCapacityPlan(args: {
  tx: ProductionCapacityTx;
  plan: ProductionItemPlan;
  orderId: number;
  orderItemId: number;
}) {
  if (args.plan.status !== "PLANNED") return null;

  for (const allocation of args.plan.allocations) {
    const batch = await upsertBatchForAllocation(args.tx, allocation);
    if (
      batch.kind !== allocation.kind
      || batch.branchId !== allocation.branchId
      || batch.productId !== allocation.productId
    ) {
      throw new Error("El batch materializado no coincide con la asignación planificada.");
    }

    const updatedCount = await args.tx.$executeRaw`
      UPDATE "ProductionBatch"
      SET
        "reservedQty" = "reservedQty" + ${allocation.quantityAssigned},
        "status" = CASE
          WHEN ("reservedQty" + ${allocation.quantityAssigned}) >= "capacityQty" THEN 'FULL'::"ProductionBatchStatus"
          ELSE 'OPEN'::"ProductionBatchStatus"
        END,
        "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${batch.id}
        AND "kind" = ${allocation.kind}::"ProductionBatchKind"
        AND "status" IN ('OPEN', 'FULL')
        AND ("reservedQty" + ${allocation.quantityAssigned}) <= "capacityQty"
    `;

    if (updatedCount !== 1) throw new ProductionCapacityConflictError();

    await args.tx.productionBatchItem.create({
      data: {
        batchId: batch.id,
        orderId: args.orderId,
        orderItemId: args.orderItemId,
        quantityAssigned: allocation.quantityAssigned,
        status: "ACTIVE",
        source: ProductionScheduleSource.AUTO,
      },
    });
  }

  return args.plan.targetReadyAt;
}

async function releaseActiveReservations(args: {
  tx: ProductionCapacityTx;
  orderId?: number;
  orderItemId?: number;
  source?: ProductionScheduleSource;
}) {
  const batchItems = await args.tx.productionBatchItem.findMany({
    where: {
      status: "ACTIVE",
      ...(args.orderId ? { orderId: args.orderId } : {}),
      ...(args.orderItemId ? { orderItemId: args.orderItemId } : {}),
      ...(args.source ? { source: args.source } : {}),
    },
    select: { id: true, batchId: true, quantityAssigned: true },
  });
  let released = 0;

  for (const batchItem of batchItems) {
    const claimed = await args.tx.productionBatchItem.updateMany({
      where: { id: batchItem.id, status: "ACTIVE" },
      data: { status: "CANCELLED" },
    });
    if (claimed.count !== 1) continue;

    await args.tx.$executeRaw`
      UPDATE "ProductionBatch"
      SET
        "reservedQty" = GREATEST(0, "reservedQty" - ${batchItem.quantityAssigned}),
        "status" = CASE
          WHEN "status" = 'FULL' AND GREATEST(0, "reservedQty" - ${batchItem.quantityAssigned}) < "capacityQty"
            THEN 'OPEN'::"ProductionBatchStatus"
          ELSE "status"
        END,
        "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${batchItem.batchId}
    `;
    released += 1;
  }

  return released;
}

export function releaseOrderProductionReservations(
  tx: ProductionCapacityTx,
  orderId: number,
  source?: ProductionScheduleSource
) {
  return releaseActiveReservations({ tx, orderId, source });
}

export function releaseOrderItemProductionReservations(
  tx: ProductionCapacityTx,
  orderItemId: number,
  source?: ProductionScheduleSource
) {
  return releaseActiveReservations({ tx, orderItemId, source });
}
