import {
  Prisma,
  ProductionScheduleSource,
  ProductionScheduleStatus,
  ProductionTargetWindow,
} from "@prisma/client";
import { prisma } from "../lib/prisma";
import {
  addBusinessDays,
  businessDateKeyFromDate,
  businessDateToUtcNoon,
  businessDayOfWeek,
  businessTimeKeyFromDate,
  combineBusinessDateTimeToUtc,
  isValidDateKey,
} from "../lib/business-time";
import {
  planProductionCapacity,
  type CapacityEvaluation,
  type ProductionItemPlan,
} from "./production-capacity-planner";
import {
  applyPreviewReservationDeltas,
  buildProductionCapacityPlannerInput,
  loadProductionCapacitySnapshots,
  lockOrderProductionScheduling,
  persistProductionCapacityPlan,
  ProductionCapacityConflictError,
  releaseOrderItemProductionReservations,
  releaseOrderProductionReservations,
} from "./production-capacity-runtime";
import { isValidActiveNormalWindow } from "./production-capacity-window";

type Tx = Prisma.TransactionClient;

type ScheduleResult = {
  ok: boolean;
  status: ProductionScheduleStatus;
  source: ProductionScheduleSource;
  autoEstimatedReadyAt: Date | null;
  estimatedReadyAt: Date | null;
  message: string | null;
};

type ConfigWithScheduling = Prisma.ProductProductionConfigGetPayload<{
  include: {
    product: { select: { name: true; unitType: true } };
    windows: true;
    quantityRules: true;
    dailyExtraCapacities: true;
  };
}>;

type CapacityWindow = ConfigWithScheduling["windows"][number];
type QuantityRule = ConfigWithScheduling["quantityRules"][number];

export type ProductionSchedulePreviewInputItem = {
  productId: number;
  quantity: number | string;
};

export type ProductionSchedulePreviewMatchedRule = {
  minQty: string;
  maxQty: string | null;
  delayBusinessDays: number;
  targetWindow: ProductionTargetWindow;
  capacityStrategy: "NORMAL" | "EXTRA_PREFERRED";
};

export type ProductionSchedulePreviewMatchedWindow = {
  dayOfWeek: number;
  readyAt: string;
  capacityQty: string;
};

export type ProductionScheduleWindowEvaluation = {
  kind: "NORMAL_WINDOW" | "EXTRA_DAILY";
  date: string;
  windowId: number | null;
  extraCapacityId: number | null;
  dayOfWeek: number | null;
  readyAt: string | null;
  capacityQty: string;
  reservedQty: string;
  previewReservedQty: string;
  availableQty: string;
  assignedQty: string;
  remainingQtyAfter: string;
  skippedReason: string | null;
};

export type ProductionSchedulePreviewAllocation = {
  kind: "NORMAL_WINDOW" | "EXTRA_DAILY";
  date: string;
  windowId: number | null;
  extraCapacityId: number | null;
  dayOfWeek: number | null;
  startsAt: string | null;
  endsAt: string | null;
  readyAt: string;
  quantityAssigned: string;
  availableQtyBeforeAllocation: string;
  capacityQty: string;
};

export type ProductionSchedulePreviewDebug = {
  quantity: number;
  matchedRule: boolean;
  defaultRuleApplied: boolean;
  delayBusinessDays: number;
  targetWindow: ProductionTargetWindow;
  allocationMode: "NORMAL_WINDOW" | "EXTRA_DAILY" | null;
  baseDate: string | null;
  evaluatedWindows: ProductionScheduleWindowEvaluation[];
  allocations: ProductionSchedulePreviewAllocation[];
  totalAllocated: string;
  remainingQuantity: string;
  calculatedReadyAt: Date | null;
};

export type ProductionSchedulePreviewItem = {
  productId: number;
  quantity: number;
  plannerStatus: "PLANNED" | "NOT_REQUIRED" | "UNSCHEDULABLE";
  estimatedReadyAt: Date | null;
  status: ProductionScheduleStatus;
  source: ProductionScheduleSource;
  message: string | null;
  matchedRule: ProductionSchedulePreviewMatchedRule | null;
  matchedWindow: ProductionSchedulePreviewMatchedWindow | null;
  debug: ProductionSchedulePreviewDebug | null;
};

export type ProductionSchedulePreviewResult = {
  estimatedReadyAt: Date | null;
  status: ProductionScheduleStatus;
  plannerStatus: "PLANNED" | "NOT_REQUIRED" | "UNSCHEDULABLE";
  items: ProductionSchedulePreviewItem[];
};

type PreviewReservationMap = Map<string, Prisma.Decimal>;

type ProductionBlackoutLookup = {
  allProducts: Set<string>;
  byProductId: Map<number, Set<string>>;
};

type DeliveryScheduleSource = "AUTO" | "MANUAL";

type SchedulePlanMode = "preview" | "commit";

type ScheduleRuleSelection = {
  rule: QuantityRule | null;
  delayBusinessDays: number;
  targetWindow: ProductionTargetWindow;
};

type AutoWindowSearchResult = {
  readyAt: Date;
  productionDate: Date;
  window: CapacityWindow;
  allocations: AutoWindowAllocation[];
  evaluatedWindows: ProductionScheduleWindowEvaluation[];
  totalAllocated: Prisma.Decimal;
  remainingQuantity: Prisma.Decimal;
};

type AutoWindowAllocation = {
  productionDate: Date;
  window: CapacityWindow;
  readyAt: Date;
  windowStartAt: Date;
  windowEndAt: Date;
  quantityAssigned: Prisma.Decimal;
  availableQtyBeforeAllocation: Prisma.Decimal;
  capacityQty: Prisma.Decimal;
};

type SchedulePlanItemInput = ProductionSchedulePreviewInputItem & {
  orderItemId?: number;
  productNameSnapshot?: string | null;
  isCustomProduct?: boolean;
};

type SchedulePlanArgs = {
  branchId: number;
  items: SchedulePlanItemInput[];
  mode: SchedulePlanMode;
  orderId?: number;
  finalReadyAt?: Date | null;
  deliveryScheduleSource?: DeliveryScheduleSource;
};

const MAX_SEARCH_DAYS = 365;
const WINDOW_NOT_FOUND_MESSAGE =
  "No existe una ventana de producción configurada para esa fecha y hora. Configura una ventana o elige una hora de salida existente.";

function localDateOnly(value: Date) {
  return businessDateToUtcNoon(businessDateKeyFromDate(value));
}

function addDays(value: Date, days: number) {
  return businessDateToUtcNoon(addBusinessDays(businessDateKeyFromDate(value), days));
}

function parseTime(value: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return { hours: 0, minutes: 0 };
  return { hours: Number(match[1]), minutes: Number(match[2]) };
}

function timeLabel(value: Date) {
  return businessTimeKeyFromDate(value);
}

function dateWithTime(date: Date, time: string) {
  return combineBusinessDateTimeToUtc(localDateKey(date), time);
}

function maxDate(values: Date[]) {
  if (values.length === 0) return null;
  return values.reduce((latest, value) => (value > latest ? value : latest), values[0]);
}

function localDateKey(value: Date) {
  return businessDateKeyFromDate(value);
}

function previewReservationKey(args: {
  branchId: number;
  productId: number;
  windowId: number;
  productionDate: Date;
}) {
  return `${args.branchId}:${args.productId}:${args.windowId}:${localDateKey(args.productionDate)}`;
}

function isBlackoutDate(config: ConfigWithScheduling, date: Date, blackoutLookup?: ProductionBlackoutLookup) {
  if (!blackoutLookup) return false;

  const key = localDateKey(date);
  return blackoutLookup.allProducts.has(key) || (blackoutLookup.byProductId.get(config.productId)?.has(key) ?? false);
}

function activeWindowsForDate(config: ConfigWithScheduling, date: Date, blackoutLookup?: ProductionBlackoutLookup) {
  if (isBlackoutDate(config, date, blackoutLookup)) return [];

  const dayOfWeek = businessDayOfWeek(localDateKey(date));
  return config.windows
    .filter((window) => isValidActiveNormalWindow(window) && window.dayOfWeek === dayOfWeek)
    .sort((a, b) => {
      if (a.startsAt !== b.startsAt) return a.startsAt.localeCompare(b.startsAt);
      return a.readyAt.localeCompare(b.readyAt);
    });
}

function hasActiveWindows(config: ConfigWithScheduling, date: Date, blackoutLookup?: ProductionBlackoutLookup) {
  return activeWindowsForDate(config, date, blackoutLookup).length > 0;
}

function businessDateAfterDelay(
  config: ConfigWithScheduling,
  startDate: Date,
  delayBusinessDays: number,
  blackoutLookup?: ProductionBlackoutLookup
) {
  let date = localDateOnly(startDate);
  let counted = 0;

  for (let guard = 0; guard <= MAX_SEARCH_DAYS; guard += 1) {
    if (hasActiveWindows(config, date, blackoutLookup)) {
      if (counted === delayBusinessDays) return date;
      counted += 1;
    }
    date = addDays(date, 1);
  }

  return null;
}

function windowsForTarget(
  config: ConfigWithScheduling,
  date: Date,
  targetWindow: ProductionTargetWindow,
  blackoutLookup?: ProductionBlackoutLookup
) {
  const windows = activeWindowsForDate(config, date, blackoutLookup);
  if (targetWindow === ProductionTargetWindow.FIRST_OF_DAY) return windows.slice(0, 1);
  if (targetWindow === ProductionTargetWindow.LAST_OF_DAY) return windows.slice(-1);
  return windows;
}

function findMatchingRule(rules: QuantityRule[], quantity: Prisma.Decimal) {
  return rules
    .filter((rule) => rule.isActive)
    .filter((rule) => quantity.gte(rule.minQty))
    .filter((rule) => !rule.maxQty || quantity.lte(rule.maxQty))
    .sort((a, b) => {
      const minCompare = a.minQty.comparedTo(b.minQty);
      if (minCompare !== 0) return minCompare;
      if (!a.maxQty && b.maxQty) return 1;
      if (a.maxQty && !b.maxQty) return -1;
      if (a.maxQty && b.maxQty) return a.maxQty.comparedTo(b.maxQty);
      return a.id - b.id;
    })[0] ?? null;
}

function selectScheduleRule(rules: QuantityRule[], quantity: Prisma.Decimal): ScheduleRuleSelection {
  const rule = findMatchingRule(rules, quantity);
  if (rule) {
    return {
      rule,
      delayBusinessDays: rule.delayBusinessDays,
      targetWindow: rule.targetWindow,
    };
  }

  return {
    rule: null,
    delayBusinessDays: 0,
    targetWindow: ProductionTargetWindow.NEXT_AVAILABLE,
  };
}

function serializeMatchedRule(rule: QuantityRule): ProductionSchedulePreviewMatchedRule {
  return {
    minQty: rule.minQty.toString(),
    maxQty: rule.maxQty?.toString() ?? null,
    delayBusinessDays: rule.delayBusinessDays,
    targetWindow: rule.targetWindow,
    capacityStrategy: rule.capacityStrategy,
  };
}

function serializeMatchedWindow(window: CapacityWindow): ProductionSchedulePreviewMatchedWindow {
  return {
    dayOfWeek: window.dayOfWeek,
    readyAt: window.readyAt,
    capacityQty: window.capacityQty.toString(),
  };
}

function serializeAllocation(allocation: AutoWindowAllocation): ProductionSchedulePreviewAllocation {
  return {
    kind: "NORMAL_WINDOW",
    date: localDateKey(allocation.productionDate),
    windowId: allocation.window.id,
    extraCapacityId: null,
    dayOfWeek: allocation.window.dayOfWeek,
    startsAt: allocation.window.startsAt,
    endsAt: allocation.window.endsAt,
    readyAt: allocation.window.readyAt,
    quantityAssigned: allocation.quantityAssigned.toString(),
    availableQtyBeforeAllocation: allocation.availableQtyBeforeAllocation.toString(),
    capacityQty: allocation.capacityQty.toString(),
  };
}

function serializePlannerEvaluation(
  entry: CapacityEvaluation,
  config: ConfigWithScheduling
): ProductionScheduleWindowEvaluation {
  const window = entry.windowId === null
    ? null
    : config.windows.find((candidate) => candidate.id === entry.windowId) ?? null;
  return {
    kind: entry.kind,
    date: entry.productionDate,
    windowId: entry.windowId,
    extraCapacityId: entry.extraCapacityId,
    dayOfWeek: window?.dayOfWeek ?? businessDayOfWeek(entry.productionDate),
    readyAt: window?.readyAt ?? null,
    capacityQty: entry.capacityQty.toString(),
    reservedQty: entry.reservedQty.toString(),
    previewReservedQty: entry.previewReservedQty.toString(),
    availableQty: entry.availableQty.toString(),
    assignedQty: entry.quantityAssigned.toString(),
    remainingQtyAfter: entry.remainingAfter.toString(),
    skippedReason: entry.skippedReason,
  };
}

function serializePlannerAllocation(
  allocation: Extract<ProductionItemPlan, { status: "PLANNED" }>["allocations"][number],
  config: ConfigWithScheduling
): ProductionSchedulePreviewAllocation {
  const window = allocation.kind === "NORMAL_WINDOW"
    ? config.windows.find((candidate) => candidate.id === allocation.windowId) ?? null
    : null;
  return {
    kind: allocation.kind,
    date: allocation.productionDate,
    windowId: allocation.kind === "NORMAL_WINDOW" ? allocation.windowId : null,
    extraCapacityId: allocation.kind === "EXTRA_DAILY" ? allocation.extraCapacityId : null,
    dayOfWeek: window?.dayOfWeek ?? businessDayOfWeek(allocation.productionDate),
    startsAt: window?.startsAt ?? null,
    endsAt: window?.endsAt ?? null,
    readyAt: window?.readyAt ?? businessTimeKeyFromDate(allocation.readyAt),
    quantityAssigned: allocation.quantityAssigned.toString(),
    availableQtyBeforeAllocation: allocation.availableQtyBeforeAllocation.toString(),
    capacityQty: allocation.capacityQty.toString(),
  };
}

function previewPlannerStatus(items: ProductionSchedulePreviewItem[]) {
  if (items.some((item) => item.plannerStatus === "UNSCHEDULABLE")) return "UNSCHEDULABLE" as const;
  if (items.some((item) => item.plannerStatus === "PLANNED")) return "PLANNED" as const;
  return "NOT_REQUIRED" as const;
}

function decimalZero() {
  return new Prisma.Decimal(0);
}

async function loadProductionBlackoutLookup(args: {
  tx: Tx;
  branchId: number;
  productIds: number[];
}): Promise<ProductionBlackoutLookup> {
  const { tx, branchId, productIds } = args;
  const productIdFilter = productIds.length > 0 ? productIds : [-1];
  const rows = await tx.productionBlackoutDate.findMany({
    where: {
      isActive: true,
      OR: [
        { branchId: null, productId: null },
        { branchId, productId: null },
        { branchId, productId: { in: productIdFilter } },
      ],
    },
    select: { date: true, productId: true },
  });

  const allProducts = new Set<string>();
  const byProductId = new Map<number, Set<string>>();

  for (const row of rows) {
    const key = localDateKey(row.date);
    if (!row.productId) {
      allProducts.add(key);
      continue;
    }

    const dates = byProductId.get(row.productId) ?? new Set<string>();
    dates.add(key);
    byProductId.set(row.productId, dates);
  }

  return { allProducts, byProductId };
}

function isReadyAtExpired(productionDate: Date, readyAt: string, now: Date) {
  return dateWithTime(productionDate, readyAt).getTime() <= now.getTime();
}

function windowAvailabilitySkippedReason(productionDate: Date, window: CapacityWindow, now: Date) {
  if (dateWithTime(productionDate, window.endsAt).getTime() <= now.getTime()) {
    return "window_end_passed";
  }
  if (isReadyAtExpired(productionDate, window.readyAt, now)) {
    return "ready_at_passed";
  }
  return null;
}

function windowsForAllocationSearch(args: {
  config: ConfigWithScheduling;
  date: Date;
  baseDateKey: string;
  targetWindow: ProductionTargetWindow;
  blackoutLookup?: ProductionBlackoutLookup;
}) {
  const dateKey = localDateKey(args.date);

  if (dateKey === args.baseDateKey && args.targetWindow !== ProductionTargetWindow.NEXT_AVAILABLE) {
    // LAST_OF_DAY means try to finish at the end of the calculated base day first.
    // If that capacity is not enough, continue forward chronologically from future windows.
    return windowsForTarget(args.config, args.date, args.targetWindow, args.blackoutLookup);
  }

  return activeWindowsForDate(args.config, args.date, args.blackoutLookup);
}

async function findAutoWindowsForQuantity(args: {
  tx: Tx;
  config: ConfigWithScheduling;
  quantity: Prisma.Decimal;
  delayBusinessDays: number;
  targetWindow: ProductionTargetWindow;
  previewReservations?: PreviewReservationMap;
  blackoutLookup?: ProductionBlackoutLookup;
  now?: Date;
}) {
  const { tx, config, quantity, delayBusinessDays, targetWindow, previewReservations, blackoutLookup } = args;
  const now = args.now ?? new Date();
  const evaluatedWindows: ProductionScheduleWindowEvaluation[] = [];
  const baseDate = businessDateAfterDelay(config, now, delayBusinessDays, blackoutLookup);

  if (!baseDate) {
    return {
      result: null,
      evaluatedWindows,
      totalAllocated: decimalZero(),
      remainingQuantity: quantity,
    };
  }

  let date = baseDate;
  const baseDateKey = localDateKey(baseDate);
  const allocations: AutoWindowAllocation[] = [];
  let remainingQuantity = quantity;
  let totalAllocated = decimalZero();

  for (let guard = 0; guard <= MAX_SEARCH_DAYS; guard += 1) {
    if (hasActiveWindows(config, date, blackoutLookup)) {
      const candidateWindows = windowsForAllocationSearch({
        config,
        date,
        baseDateKey,
        targetWindow,
        blackoutLookup,
      });

      for (const window of candidateWindows) {
        const batch = await tx.productionBatch.findUnique({
          where: {
            branchId_productId_windowId_productionDate: {
              branchId: config.branchId,
              productId: config.productId,
              windowId: window.id,
              productionDate: date,
            },
          },
          select: {
            reservedQty: true,
            status: true,
            items: {
              where: { status: "ACTIVE" },
              select: { quantityAssigned: true },
            },
          },
        });

        const key = previewReservationKey({
          branchId: config.branchId,
          productId: config.productId,
          windowId: window.id,
          productionDate: date,
        });
        const alreadyPreviewed = previewReservations?.get(key) ?? decimalZero();
        const reservedQty = batch?.items.reduce(
          (sum, item) => sum.add(item.quantityAssigned),
          decimalZero()
        ) ?? batch?.reservedQty ?? decimalZero();
        const currentReserved = reservedQty.add(alreadyPreviewed);
        const availableRaw = window.capacityQty.sub(currentReserved);
        const availableQty = availableRaw.gt(0) ? availableRaw : decimalZero();
        const assignQty = availableQty.gt(remainingQuantity) ? remainingQuantity : availableQty;
        const canAssign = assignQty.gt(0);

        let skippedReason = windowAvailabilitySkippedReason(date, window, now);
        if (!skippedReason && batch && batch.status !== "OPEN" && batch.status !== "FULL") {
          skippedReason = `batch_status_${batch.status.toLowerCase()}`;
        } else if (!skippedReason && !canAssign) {
          skippedReason = "insufficient_available_capacity";
        }

        const assignedQty = skippedReason ? decimalZero() : assignQty;
        const remainingAfter = skippedReason ? remainingQuantity : remainingQuantity.sub(assignedQty);

        evaluatedWindows.push({
          kind: "NORMAL_WINDOW",
          date: localDateKey(date),
          windowId: window.id,
          extraCapacityId: null,
          dayOfWeek: window.dayOfWeek,
          readyAt: window.readyAt,
          capacityQty: window.capacityQty.toString(),
          reservedQty: currentReserved.toString(),
          previewReservedQty: alreadyPreviewed.toString(),
          availableQty: availableQty.toString(),
          assignedQty: assignedQty.toString(),
          remainingQtyAfter: remainingAfter.toString(),
          skippedReason,
        });

        if (!skippedReason) {
          const allocation: AutoWindowAllocation = {
            productionDate: date,
            window,
            readyAt: dateWithTime(date, window.readyAt),
            windowStartAt: dateWithTime(date, window.startsAt),
            windowEndAt: dateWithTime(date, window.endsAt),
            quantityAssigned: assignedQty,
            availableQtyBeforeAllocation: availableQty,
            capacityQty: window.capacityQty,
          };

          allocations.push(allocation);
          totalAllocated = totalAllocated.add(assignedQty);
          remainingQuantity = remainingAfter;

          if (remainingQuantity.lte(0)) {
            if (previewReservations) {
              for (const used of allocations) {
                const usedKey = previewReservationKey({
                  branchId: config.branchId,
                  productId: config.productId,
                  windowId: used.window.id,
                  productionDate: used.productionDate,
                });
                const existingPreview = previewReservations.get(usedKey) ?? decimalZero();
                previewReservations.set(usedKey, existingPreview.add(used.quantityAssigned));
              }
            }

            const lastAllocation = allocations[allocations.length - 1];
            return {
              result: {
                readyAt: lastAllocation.readyAt,
                productionDate: lastAllocation.productionDate,
                window: lastAllocation.window,
                allocations,
                evaluatedWindows,
                totalAllocated,
                remainingQuantity: decimalZero(),
              } satisfies AutoWindowSearchResult,
              evaluatedWindows,
              totalAllocated,
              remainingQuantity: decimalZero(),
            };
          }
        }
      }
    }
    date = addDays(date, 1);
  }

  return { result: null, evaluatedWindows, totalAllocated, remainingQuantity };
}

function findWindowForReadyAt(
  config: ConfigWithScheduling,
  readyAt: Date,
  blackoutLookup?: ProductionBlackoutLookup,
  now = new Date()
) {
  const productionDate = localDateOnly(readyAt);
  const readyTime = timeLabel(readyAt);
  const window = activeWindowsForDate(config, productionDate, blackoutLookup)
    .find((candidate) => candidate.readyAt === readyTime && !windowAvailabilitySkippedReason(productionDate, candidate, now)) ?? null;

  return { productionDate, window };
}

async function releaseActiveBatchItem(tx: Tx, orderItemId: number) {
  await releaseOrderItemProductionReservations(tx, orderItemId);
}

async function releaseActiveBatchItemsForOrder(tx: Tx, orderId: number, source?: ProductionScheduleSource) {
  await releaseOrderProductionReservations(tx, orderId, source);
}

async function getOrCreateBatch(args: {
  tx: Tx;
  branchId: number;
  productId: number;
  productionDate: Date;
  window: CapacityWindow;
}) {
  const { tx, branchId, productId, productionDate, window } = args;
  const windowStartAt = dateWithTime(productionDate, window.startsAt);
  const windowEndAt = dateWithTime(productionDate, window.endsAt);
  const readyAt = dateWithTime(productionDate, window.readyAt);

  return tx.productionBatch.upsert({
    where: {
      branchId_productId_windowId_productionDate: {
        branchId,
        productId,
        windowId: window.id,
        productionDate,
      },
    },
    create: {
      branchId,
      productId,
      windowId: window.id,
      productionDate,
      windowStartAt,
      windowEndAt,
      readyAt,
      capacityQty: window.capacityQty,
      reservedQty: new Prisma.Decimal(0),
    },
    update: {},
    select: { id: true, readyAt: true },
  });
}

async function reserveAutoInWindow(args: {
  tx: Tx;
  branchId: number;
  productId: number;
  orderId: number;
  orderItemId: number;
  quantity: Prisma.Decimal;
  productionDate: Date;
  window: CapacityWindow;
}) {
  const { tx, branchId, productId, orderId, orderItemId, quantity, productionDate, window } = args;
  const batch = await getOrCreateBatch({ tx, branchId, productId, productionDate, window });

  const updatedCount = await tx.$executeRaw`
    UPDATE "ProductionBatch"
    SET
      "reservedQty" = "reservedQty" + ${quantity},
      "status" = CASE
        WHEN ("reservedQty" + ${quantity}) = "capacityQty" THEN 'FULL'::"ProductionBatchStatus"
        ELSE 'OPEN'::"ProductionBatchStatus"
      END,
      "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = ${batch.id}
      AND "status" IN ('OPEN', 'FULL')
      AND ("reservedQty" + ${quantity}) <= "capacityQty"
  `;

  if (updatedCount === 0) return null;

  await tx.productionBatchItem.create({
    data: {
      batchId: batch.id,
      orderId,
      orderItemId,
      quantityAssigned: quantity,
      status: "ACTIVE",
      source: "AUTO",
    },
  });

  return batch.readyAt;
}

async function reserveAutoAllocations(args: {
  tx: Tx;
  branchId: number;
  productId: number;
  orderId: number;
  orderItemId: number;
  allocations: AutoWindowAllocation[];
}) {
  const { tx, branchId, productId, orderId, orderItemId, allocations } = args;
  let latestReadyAt: Date | null = null;

  for (const allocation of allocations) {
    const reservedReadyAt = await reserveAutoInWindow({
      tx,
      branchId,
      productId,
      orderId,
      orderItemId,
      quantity: allocation.quantityAssigned,
      productionDate: allocation.productionDate,
      window: allocation.window,
    });

    if (!reservedReadyAt) {
      await releaseActiveBatchItem(tx, orderItemId);
      return null;
    }

    latestReadyAt = reservedReadyAt;
  }

  return latestReadyAt;
}

async function assignManualToWindow(args: {
  tx: Tx;
  branchId: number;
  productId: number;
  orderId: number;
  orderItemId: number;
  quantity: Prisma.Decimal;
  productionDate: Date;
  window: CapacityWindow;
}) {
  const { tx, branchId, productId, orderId, orderItemId, quantity, productionDate, window } = args;
  await releaseActiveBatchItem(tx, orderItemId);
  const batch = await getOrCreateBatch({ tx, branchId, productId, productionDate, window });

  const updatedCount = await tx.$executeRaw`
    UPDATE "ProductionBatch"
    SET
      "reservedQty" = "reservedQty" + ${quantity},
      "status" = CASE
        WHEN ("reservedQty" + ${quantity}) >= "capacityQty" THEN 'FULL'::"ProductionBatchStatus"
        ELSE 'OPEN'::"ProductionBatchStatus"
      END,
      "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = ${batch.id}
      AND "status" IN ('OPEN', 'FULL')
  `;
  if (updatedCount !== 1) throw new Error("La ventana de producción ya no admite asignaciones manuales.");

  await tx.productionBatchItem.create({
    data: {
      batchId: batch.id,
      orderId,
      orderItemId,
      quantityAssigned: quantity,
      status: "ACTIVE",
      source: "MANUAL",
    },
  });

  return batch.readyAt;
}

function aggregatePreviewStatus(items: ProductionSchedulePreviewItem[]) {
  const configuredItems = items.filter((item) => item.status !== ProductionScheduleStatus.NOT_REQUIRED);
  if (configuredItems.some((item) => item.status === ProductionScheduleStatus.FAILED)) {
    return ProductionScheduleStatus.FAILED;
  }
  if (configuredItems.some((item) => item.status === ProductionScheduleStatus.MANUAL_REQUIRED)) {
    return ProductionScheduleStatus.MANUAL_REQUIRED;
  }
  if (configuredItems.some((item) => item.status === ProductionScheduleStatus.AUTO_SCHEDULED)) {
    return ProductionScheduleStatus.AUTO_SCHEDULED;
  }
  return ProductionScheduleStatus.NOT_REQUIRED;
}

export async function previewProductionSchedule(args: {
  branchId: number;
  items: ProductionSchedulePreviewInputItem[];
}): Promise<ProductionSchedulePreviewResult> {
  return calculateProductionSchedulePlan({
    branchId: args.branchId,
    items: args.items,
    mode: "preview",
  });
}

async function calculateProductionSchedulePlanAttempt(
  args: SchedulePlanArgs,
  planningNow: Date
): Promise<ProductionSchedulePreviewResult> {
  return prisma.$transaction(
    async (tx) => {
      const branchId = Number(args.branchId);
      if (!Number.isInteger(branchId) || branchId <= 0) throw new Error("branchId inválido");

      if (args.mode === "commit" && args.orderId) {
        const lockedOrder = await lockOrderProductionScheduling(tx, args.orderId);
        if (lockedOrder.notes?.includes("[Cancelado el ")) {
          throw new Error("No se puede programar producción para un pedido cancelado.");
        }
        await releaseActiveBatchItemsForOrder(tx, args.orderId);
      }

      const normalizedItems = args.items.map((item) => {
        const productId = Number(item.productId);
        const quantity = new Prisma.Decimal(String(item.quantity));

        if (!Number.isInteger(productId) || productId <= 0) throw new Error("productId inválido");
        if (quantity.lte(0)) throw new Error("quantity debe ser mayor a 0");

        return {
          ...item,
          productId,
          quantity,
          quantityNumber: Number(quantity.toString()),
          isCustomProduct: item.isCustomProduct === true,
        };
      });

      const productIds = Array.from(
        new Set(
          normalizedItems
            .filter((item) => !item.isCustomProduct)
            .map((item) => item.productId)
        )
      );
      const configs = productIds.length
        ? await tx.productProductionConfig.findMany({
            where: { branchId, productId: { in: productIds }, enabled: true },
            include: {
              product: { select: { name: true, unitType: true } },
              windows: true,
              quantityRules: true,
              dailyExtraCapacities: true,
            },
          })
        : [];

      const blackoutLookup = await loadProductionBlackoutLookup({ tx, branchId, productIds });
      const capacitySnapshots = await loadProductionCapacitySnapshots({
        tx,
        branchId,
        productIds,
        planningNow,
        maxSearchDays: MAX_SEARCH_DAYS,
      });
      const configByProductId = new Map(configs.map((config) => [config.productId, config]));
      const normalPreviewReservations = new Map<string, Prisma.Decimal>();
      const extraPreviewReservations = new Map<string, Prisma.Decimal>();
      const previewItems: ProductionSchedulePreviewItem[] = [];

      for (const [itemIndex, item] of normalizedItems.entries()) {
        const config = configByProductId.get(item.productId);
        const productLabel = config?.product?.name ?? item.productNameSnapshot ?? item.productId;

        if (item.isCustomProduct || !config) {
          if (args.mode === "commit" && item.orderItemId) {
            await tx.orderItem.update({
              where: { id: item.orderItemId },
              data: {
                autoEstimatedReadyAt: null,
                manualReadyAt: null,
                estimatedReadyAt: null,
                productionScheduleStatus: ProductionScheduleStatus.NOT_REQUIRED,
                productionScheduleSource: ProductionScheduleSource.NONE,
                productionScheduleMessage: null,
              },
            });
          }

          previewItems.push({
            productId: item.productId,
            quantity: item.quantityNumber,
            plannerStatus: "NOT_REQUIRED",
            estimatedReadyAt: null,
            status: ProductionScheduleStatus.NOT_REQUIRED,
            source: ProductionScheduleSource.NONE,
            message: null,
            matchedRule: null,
            matchedWindow: null,
            debug: null,
          });
          continue;
        }

        if (
          args.mode === "commit" &&
          args.deliveryScheduleSource === "MANUAL" &&
          args.orderId &&
          item.orderItemId &&
          args.finalReadyAt
        ) {
          const { productionDate, window } = findWindowForReadyAt(config, args.finalReadyAt, blackoutLookup);
          const readyAt = window
            ? await assignManualToWindow({
                tx,
                branchId,
                productId: item.productId,
                orderId: args.orderId,
                orderItemId: item.orderItemId,
                quantity: item.quantity,
                productionDate,
                window,
              })
            : args.finalReadyAt;

          await tx.orderItem.update({
            where: { id: item.orderItemId },
            data: {
              autoEstimatedReadyAt: null,
              manualReadyAt: readyAt,
              estimatedReadyAt: readyAt,
              productionScheduleStatus: ProductionScheduleStatus.MANUAL_SET,
              productionScheduleSource: ProductionScheduleSource.MANUAL,
              productionScheduleMessage: window
                ? null
                : `${productLabel}: sin ventana configurada para la fecha/hora final`,
            },
          });

          previewItems.push({
            productId: item.productId,
            quantity: item.quantityNumber,
            plannerStatus: "PLANNED",
            estimatedReadyAt: readyAt,
            status: ProductionScheduleStatus.MANUAL_SET,
            source: ProductionScheduleSource.MANUAL,
            message: window ? null : `${productLabel}: sin ventana configurada para la fecha/hora final`,
            matchedRule: null,
            matchedWindow: window ? serializeMatchedWindow(window) : null,
            debug: {
              quantity: item.quantityNumber,
              matchedRule: false,
              defaultRuleApplied: false,
              delayBusinessDays: 0,
              targetWindow: ProductionTargetWindow.NEXT_AVAILABLE,
              allocationMode: "NORMAL_WINDOW",
              baseDate: localDateKey(productionDate),
              evaluatedWindows: [],
              allocations: [],
              totalAllocated: "0",
              remainingQuantity: "0",
              calculatedReadyAt: readyAt,
            },
          });
          continue;
        }

        const blackoutDates = new Set([
          ...blackoutLookup.allProducts,
          ...(blackoutLookup.byProductId.get(item.productId) ?? []),
        ]);
        const plannerInput = buildProductionCapacityPlannerInput({
          planningNow,
          config,
          itemKey: item.orderItemId ? `order-item:${item.orderItemId}` : `preview:${itemIndex}:${item.productId}`,
          orderItemId: item.orderItemId,
          quantity: item.quantity,
          snapshots: capacitySnapshots,
          normalPreviewReservations,
          extraPreviewReservations,
          blackoutDates,
          maxSearchDays: MAX_SEARCH_DAYS,
        });
        const capacityPlan = planProductionCapacity(plannerInput);
        const totalAllocated = capacityPlan.status === "PLANNED"
          ? capacityPlan.allocations.reduce((sum, allocation) => sum.add(allocation.quantityAssigned), decimalZero())
          : decimalZero();
        const explicitRuleApplied = capacityPlan.selectedRule?.selectionSource === "EXPLICIT_RULE";
        const defaultNormalApplied = capacityPlan.selectedRule?.selectionSource === "DEFAULT_NORMAL";
        const debug: ProductionSchedulePreviewDebug = {
          quantity: item.quantityNumber,
          matchedRule: explicitRuleApplied,
          defaultRuleApplied: defaultNormalApplied,
          delayBusinessDays: capacityPlan.selectedRule?.delayBusinessDays ?? 0,
          targetWindow: capacityPlan.selectedRule?.targetWindow ?? ProductionTargetWindow.NEXT_AVAILABLE,
          allocationMode: capacityPlan.status === "PLANNED" ? capacityPlan.allocationMode : null,
          baseDate: capacityPlan.baseDate,
          evaluatedWindows: capacityPlan.evaluations.map((entry) => serializePlannerEvaluation(entry, config)),
          allocations: capacityPlan.status === "PLANNED"
            ? capacityPlan.allocations.map((allocation) => serializePlannerAllocation(allocation, config))
            : [],
          totalAllocated: totalAllocated.toString(),
          remainingQuantity: item.quantity.sub(totalAllocated).toString(),
          calculatedReadyAt: capacityPlan.status === "PLANNED" ? capacityPlan.targetReadyAt : null,
        };
        const matchedRule = capacityPlan.selectedRule && explicitRuleApplied
          ? {
              minQty: capacityPlan.selectedRule.minQty.toString(),
              maxQty: capacityPlan.selectedRule.maxQty?.toString() ?? null,
              delayBusinessDays: capacityPlan.selectedRule.delayBusinessDays,
              targetWindow: capacityPlan.selectedRule.targetWindow,
              capacityStrategy: capacityPlan.selectedRule.capacityStrategy,
            }
          : null;

        if (capacityPlan.status !== "PLANNED") {
          const message = `${productLabel}: ${capacityPlan.reason}`;
          if (args.mode === "commit" && item.orderItemId) {
            await tx.orderItem.update({
              where: { id: item.orderItemId },
              data: {
                autoEstimatedReadyAt: null,
                manualReadyAt: null,
                estimatedReadyAt: args.finalReadyAt ?? null,
                productionScheduleStatus: capacityPlan.status === "NOT_REQUIRED"
                  ? ProductionScheduleStatus.NOT_REQUIRED
                  : ProductionScheduleStatus.FAILED,
                productionScheduleSource: ProductionScheduleSource.NONE,
                productionScheduleMessage: message,
              },
            });
          }
          previewItems.push({
            productId: item.productId,
            quantity: item.quantityNumber,
            plannerStatus: capacityPlan.status,
            estimatedReadyAt: null,
            status: capacityPlan.status === "NOT_REQUIRED"
              ? ProductionScheduleStatus.NOT_REQUIRED
              : ProductionScheduleStatus.FAILED,
            source: ProductionScheduleSource.NONE,
            message,
            matchedRule,
            matchedWindow: null,
            debug,
          });
          continue;
        }

        if (args.mode === "commit") {
          if (!args.orderId || !item.orderItemId) {
            throw new Error("Faltan identificadores para persistir la agenda de producción.");
          }
          await persistProductionCapacityPlan({
            tx,
            plan: capacityPlan,
            orderId: args.orderId,
            orderItemId: item.orderItemId,
          });
        }
        applyPreviewReservationDeltas({
          plan: capacityPlan,
          normalReservations: normalPreviewReservations,
          extraReservations: extraPreviewReservations,
        });

        if (args.mode === "commit" && item.orderItemId) {
          await tx.orderItem.update({
            where: { id: item.orderItemId },
            data: {
              autoEstimatedReadyAt: capacityPlan.targetReadyAt,
              manualReadyAt: null,
              estimatedReadyAt: capacityPlan.targetReadyAt,
              productionScheduleStatus: ProductionScheduleStatus.AUTO_SCHEDULED,
              productionScheduleSource: ProductionScheduleSource.AUTO,
              productionScheduleMessage: defaultNormalApplied
                ? "Sin regla especial: default NEXT_AVAILABLE"
                : null,
            },
          });
        }

        const targetConfigWindow = capacityPlan.allocationMode === "NORMAL_WINDOW"
          ? config.windows.find((window) => window.id === capacityPlan.targetWindow.windowId) ?? null
          : null;
        previewItems.push({
          productId: item.productId,
          quantity: item.quantityNumber,
          plannerStatus: "PLANNED",
          estimatedReadyAt: capacityPlan.targetReadyAt,
          status: ProductionScheduleStatus.AUTO_SCHEDULED,
          source: ProductionScheduleSource.AUTO,
          message: defaultNormalApplied
            ? `${productLabel}: sin regla especial, default NEXT_AVAILABLE`
            : `${productLabel}: estimado automáticamente`,
          matchedRule,
          matchedWindow: targetConfigWindow
            ? serializeMatchedWindow(targetConfigWindow)
            : null,
          debug,
        });
      }

      const estimatedReadyAt = maxDate(
        previewItems
          .map((item) => item.estimatedReadyAt)
          .filter((value): value is Date => !!value)
      );
      const aggregateStatus = aggregatePreviewStatus(previewItems);
      const aggregatePlannerStatus = previewPlannerStatus(previewItems);

      if (args.mode === "commit" && args.orderId) {
        const messages = previewItems
          .map((item) => item.message)
          .filter((message): message is string => !!message);
        const hasManual = args.deliveryScheduleSource === "MANUAL";
        const hasAuto = previewItems.some((item) => item.source === ProductionScheduleSource.AUTO);
        const hasUnscheduled = aggregatePlannerStatus === "UNSCHEDULABLE";
        const scheduledReadyAt = hasManual
          ? args.finalReadyAt ?? estimatedReadyAt
          : estimatedReadyAt ?? args.finalReadyAt ?? null;
        const orderStatus = hasManual
          ? ProductionScheduleStatus.MANUAL_SET
          : hasUnscheduled
            ? ProductionScheduleStatus.FAILED
            : hasAuto
              ? ProductionScheduleStatus.AUTO_SCHEDULED
              : ProductionScheduleStatus.NOT_REQUIRED;
        const orderSource = hasManual
          ? ProductionScheduleSource.MANUAL
          : hasAuto
            ? ProductionScheduleSource.AUTO
            : ProductionScheduleSource.NONE;

        await tx.order.update({
          where: { id: args.orderId },
          data: {
            autoEstimatedReadyAt: orderSource === ProductionScheduleSource.AUTO ? scheduledReadyAt : null,
            manualReadyAt: orderSource === ProductionScheduleSource.MANUAL ? scheduledReadyAt : null,
            estimatedReadyAt: scheduledReadyAt,
            productionScheduleStatus: orderStatus,
            productionScheduleSource: orderSource,
            productionScheduleMessage: messages.length > 0 ? messages.join("; ") : null,
          },
        });
      }

      return {
        estimatedReadyAt,
        status: aggregateStatus,
        plannerStatus: aggregatePlannerStatus,
        items: previewItems,
      };
    },
    { timeout: 15000, maxWait: 10000 }
  );
}

export async function calculateProductionSchedulePlan(args: SchedulePlanArgs): Promise<ProductionSchedulePreviewResult> {
  const planningNow = new Date();
  const maxAttempts = args.mode === "commit" ? 3 : 1;
  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await calculateProductionSchedulePlanAttempt(args, planningNow);
    } catch (error) {
      lastError = error;
      const retryable = error instanceof ProductionCapacityConflictError
        || (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034");
      if (!retryable || attempt === maxAttempts - 1) throw error;
    }
  }

  throw lastError;
}

async function updateOrderScheduleFromItems(tx: Tx, orderId: number) {
  const items = await tx.orderItem.findMany({
    where: { orderId },
    select: {
      autoEstimatedReadyAt: true,
      manualReadyAt: true,
      estimatedReadyAt: true,
      productionScheduleStatus: true,
      productionScheduleSource: true,
      productionScheduleMessage: true,
    },
  });

  const autoEstimatedReadyAt = maxDate(
    items
      .map((item) => item.autoEstimatedReadyAt)
      .filter((value): value is Date => !!value)
  );
  const manualReadyAt = maxDate(
    items
      .map((item) => item.manualReadyAt)
      .filter((value): value is Date => !!value)
  );
  const estimatedReadyAt = maxDate(
    items
      .map((item) => item.estimatedReadyAt)
      .filter((value): value is Date => !!value)
  );
  const configuredItems = items.filter((item) => item.productionScheduleStatus !== "NOT_REQUIRED");
  const manualRequired = configuredItems.some((item) => item.productionScheduleStatus === "MANUAL_REQUIRED");
  const failed = configuredItems.some((item) => item.productionScheduleStatus === "FAILED");
  const manualSet = configuredItems.length > 0 && configuredItems.every((item) => item.productionScheduleStatus === "MANUAL_SET");
  const hasAuto = configuredItems.some((item) => item.productionScheduleSource === "AUTO");
  const messages = configuredItems
    .map((item) => item.productionScheduleMessage)
    .filter((message): message is string => !!message);

  const status = failed
    ? ProductionScheduleStatus.FAILED
    : manualRequired
      ? ProductionScheduleStatus.MANUAL_REQUIRED
      : manualSet
        ? ProductionScheduleStatus.MANUAL_SET
        : hasAuto
          ? ProductionScheduleStatus.AUTO_SCHEDULED
          : ProductionScheduleStatus.NOT_REQUIRED;

  const source = status === ProductionScheduleStatus.MANUAL_SET
    ? ProductionScheduleSource.MANUAL
    : hasAuto
      ? ProductionScheduleSource.AUTO
      : ProductionScheduleSource.NONE;

  await tx.order.update({
    where: { id: orderId },
    data: {
      autoEstimatedReadyAt,
      manualReadyAt,
      estimatedReadyAt,
      productionScheduleStatus: status,
      productionScheduleSource: source,
      productionScheduleMessage: messages.length > 0 ? messages.join("; ") : null,
    },
  });

  return { status, source, estimatedReadyAt, message: messages.length > 0 ? messages.join("; ") : null };
}

async function markScheduleError(orderId: number, error: unknown): Promise<ScheduleResult> {
  const message = error instanceof Error ? error.message : "Error calculando agenda de producción";
  await prisma.order.update({
    where: { id: orderId },
    data: {
      productionScheduleStatus: ProductionScheduleStatus.FAILED,
      productionScheduleSource: ProductionScheduleSource.NONE,
      productionScheduleMessage: message,
    },
  }).catch(() => undefined);

  return {
    ok: false,
    status: ProductionScheduleStatus.FAILED,
    source: ProductionScheduleSource.NONE,
    autoEstimatedReadyAt: null,
    estimatedReadyAt: null,
    message,
  };
}

function resolveFinalReadyAtFromOrder(order: {
  deliveryDate: Date;
  deliveryTime: string | null;
  estimatedReadyAt: Date | null;
}) {
  if (order.deliveryTime) return dateWithTime(order.deliveryDate, order.deliveryTime);
  return order.estimatedReadyAt ?? dateWithTime(order.deliveryDate, "18:00");
}

export async function scheduleOrderProduction(
  orderId: number,
  options: { finalReadyAt?: Date | null; deliveryScheduleSource?: DeliveryScheduleSource } = {}
): Promise<ScheduleResult> {
  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        branchId: true,
        deliveryDate: true,
        deliveryTime: true,
        estimatedReadyAt: true,
        items: {
          select: {
            id: true,
            productId: true,
            productNameSnapshot: true,
            quantity: true,
            isCustomProduct: true,
          },
        },
      },
    });

    if (!order) throw new Error("Pedido no encontrado para agenda de producción");

    const finalReadyAt = options.finalReadyAt ?? resolveFinalReadyAtFromOrder(order);
    const deliveryScheduleSource = options.deliveryScheduleSource ?? "AUTO";
    const plan = await calculateProductionSchedulePlan({
      branchId: order.branchId,
      orderId: order.id,
      mode: "commit",
      finalReadyAt,
      deliveryScheduleSource,
      items: order.items.map((item) => ({
        productId: item.productId,
        quantity: item.quantity.toString(),
        orderItemId: item.id,
        productNameSnapshot: item.productNameSnapshot,
        isCustomProduct: item.isCustomProduct,
      })),
    });

    const messages = plan.items
      .map((item) => item.message)
      .filter((message): message is string => !!message);
    const hasAuto = plan.items.some((item) => item.source === ProductionScheduleSource.AUTO);
    const hasManual = deliveryScheduleSource === "MANUAL";
    const hasUnscheduled = plan.plannerStatus === "UNSCHEDULABLE";
    const scheduledReadyAt = hasManual ? finalReadyAt : plan.estimatedReadyAt ?? finalReadyAt;
    const status = hasManual
      ? ProductionScheduleStatus.MANUAL_SET
      : hasUnscheduled
        ? ProductionScheduleStatus.FAILED
        : hasAuto
          ? ProductionScheduleStatus.AUTO_SCHEDULED
          : ProductionScheduleStatus.NOT_REQUIRED;
    const source = hasManual
      ? ProductionScheduleSource.MANUAL
      : hasAuto
        ? ProductionScheduleSource.AUTO
        : ProductionScheduleSource.NONE;

    return {
      ok: status !== ProductionScheduleStatus.FAILED,
      status,
      source,
      autoEstimatedReadyAt: source === ProductionScheduleSource.AUTO ? scheduledReadyAt : null,
      estimatedReadyAt: scheduledReadyAt,
      message: messages.length > 0 ? messages.join("; ") : null,
    };
  } catch (error) {
    console.error("Error calculando agenda de producción:", error);
    return markScheduleError(orderId, error);
  }
}

export async function getAvailableManualReadyTimes(orderItemId: number, dateValue: string) {
  const date = isValidDateKey(dateValue) ? businessDateToUtcNoon(dateValue) : null;

  if (!date) throw new Error("Fecha inválida");

  return prisma.$transaction(async (tx) => {
    const item = await tx.orderItem.findUnique({
      where: { id: orderItemId },
      select: {
        productId: true,
        isCustomProduct: true,
        order: { select: { branchId: true } },
      },
    });

    if (!item || item.isCustomProduct) return [];

    const config = await tx.productProductionConfig.findUnique({
      where: { branchId_productId: { branchId: item.order.branchId, productId: item.productId } },
      include: {
        product: { select: { name: true, unitType: true } },
        windows: true,
        quantityRules: true,
        dailyExtraCapacities: true,
      },
    });

    if (!config?.enabled) return [];

    const blackoutLookup = await loadProductionBlackoutLookup({
      tx,
      branchId: item.order.branchId,
      productIds: [item.productId],
    });
    const now = new Date();

    return activeWindowsForDate(config, date, blackoutLookup)
      .filter((window) => !windowAvailabilitySkippedReason(date, window, now))
      .map((window) => window.readyAt);
  });
}

export async function applyManualReadyAtToOrderItem(orderItemId: number, manualReadyAt: Date) {
  return prisma.$transaction(
    async (tx) => {
      const itemIdentity = await tx.orderItem.findUnique({
        where: { id: orderItemId },
        select: { orderId: true },
      });
      if (!itemIdentity) throw new Error("Item no válido para agenda manual");
      const lockedOrder = await lockOrderProductionScheduling(tx, itemIdentity.orderId);
      if (lockedOrder.notes?.includes("[Cancelado el ")) {
        throw new Error("No se puede programar producción para un pedido cancelado.");
      }

      const item = await tx.orderItem.findUnique({
        where: { id: orderItemId },
        select: {
          id: true,
          orderId: true,
          productId: true,
          productNameSnapshot: true,
          quantity: true,
          isCustomProduct: true,
          order: { select: { branchId: true } },
        },
      });

      if (!item || item.isCustomProduct) throw new Error("Item no válido para agenda manual");

      const config = await tx.productProductionConfig.findUnique({
        where: { branchId_productId: { branchId: item.order.branchId, productId: item.productId } },
        include: {
          product: { select: { name: true, unitType: true } },
          windows: true,
          quantityRules: true,
          dailyExtraCapacities: true,
        },
      });

      if (!config?.enabled) throw new Error("El producto no tiene configuración de producción activa");

      const blackoutLookup = await loadProductionBlackoutLookup({
        tx,
        branchId: item.order.branchId,
        productIds: [item.productId],
      });
      const productionDate = localDateOnly(manualReadyAt);
      const readyTime = timeLabel(manualReadyAt);
      const now = new Date();
      const window = activeWindowsForDate(config, productionDate, blackoutLookup)
        .find((candidate) => candidate.readyAt === readyTime && !windowAvailabilitySkippedReason(productionDate, candidate, now));

      if (!window) throw new Error(WINDOW_NOT_FOUND_MESSAGE);

      const readyAt = await assignManualToWindow({
        tx,
        branchId: item.order.branchId,
        productId: item.productId,
        orderId: item.orderId,
        orderItemId: item.id,
        quantity: item.quantity,
        productionDate,
        window,
      });

      await tx.orderItem.update({
        where: { id: item.id },
        data: {
          autoEstimatedReadyAt: null,
          manualReadyAt: readyAt,
          estimatedReadyAt: readyAt,
          productionScheduleStatus: ProductionScheduleStatus.MANUAL_SET,
          productionScheduleSource: ProductionScheduleSource.MANUAL,
          productionScheduleMessage: null,
        },
      });

      await updateOrderScheduleFromItems(tx, item.orderId);

      return { orderId: item.orderId, orderItemId: item.id, estimatedReadyAt: readyAt };
    },
    { timeout: 15000, maxWait: 10000 }
  );
}
