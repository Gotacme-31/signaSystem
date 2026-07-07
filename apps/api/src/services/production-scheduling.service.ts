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
};

export type ProductionSchedulePreviewMatchedWindow = {
  dayOfWeek: number;
  readyAt: string;
  capacityQty: string;
};

export type ProductionScheduleWindowEvaluation = {
  date: string;
  windowId: number;
  dayOfWeek: number;
  readyAt: string;
  capacityQty: string;
  reservedQty: string;
  availableQty: string;
  assignedQty: string;
  remainingQtyAfter: string;
  skippedReason: string | null;
};

export type ProductionSchedulePreviewAllocation = {
  date: string;
  windowId: number;
  dayOfWeek: number;
  startsAt: string;
  endsAt: string;
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
  evaluatedWindows: ProductionScheduleWindowEvaluation[];
  allocations: ProductionSchedulePreviewAllocation[];
  totalAllocated: string;
  remainingQuantity: string;
  calculatedReadyAt: Date | null;
};

export type ProductionSchedulePreviewItem = {
  productId: number;
  quantity: number;
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
    .filter((window) => window.isActive && window.dayOfWeek === dayOfWeek)
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
    date: localDateKey(allocation.productionDate),
    windowId: allocation.window.id,
    dayOfWeek: allocation.window.dayOfWeek,
    startsAt: allocation.window.startsAt,
    endsAt: allocation.window.endsAt,
    readyAt: allocation.window.readyAt,
    quantityAssigned: allocation.quantityAssigned.toString(),
    availableQtyBeforeAllocation: allocation.availableQtyBeforeAllocation.toString(),
    capacityQty: allocation.capacityQty.toString(),
  };
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
          date: localDateKey(date),
          windowId: window.id,
          dayOfWeek: window.dayOfWeek,
          readyAt: window.readyAt,
          capacityQty: window.capacityQty.toString(),
          reservedQty: currentReserved.toString(),
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
  const batchItems = await tx.productionBatchItem.findMany({
    where: { orderItemId, status: "ACTIVE" },
    select: { id: true, batchId: true, quantityAssigned: true },
  });

  for (const batchItem of batchItems) {
    await tx.productionBatchItem.update({
      where: { id: batchItem.id },
      data: { status: "CANCELLED" },
    });

    await tx.$executeRaw`
      UPDATE "ProductionBatch"
      SET
        "reservedQty" = GREATEST(0, "reservedQty" - ${batchItem.quantityAssigned}),
        "status" = CASE
          WHEN "status" = 'FULL' AND GREATEST(0, "reservedQty" - ${batchItem.quantityAssigned}) < "capacityQty" THEN 'OPEN'::"ProductionBatchStatus"
          ELSE "status"
        END,
        "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${batchItem.batchId}
    `;
  }
}

async function releaseActiveBatchItemsForOrder(tx: Tx, orderId: number, source?: ProductionScheduleSource) {
  const batchItems = await tx.productionBatchItem.findMany({
    where: {
      orderId,
      status: "ACTIVE",
      ...(source ? { source } : {}),
    },
    select: { orderItemId: true },
  });

  for (const item of batchItems) {
    await releaseActiveBatchItem(tx, item.orderItemId);
  }
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
    update: {
      windowStartAt,
      windowEndAt,
      readyAt,
      capacityQty: window.capacityQty,
    },
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

  await tx.$executeRaw`
    UPDATE "ProductionBatch"
    SET
      "reservedQty" = "reservedQty" + ${quantity},
      "status" = CASE
        WHEN ("reservedQty" + ${quantity}) >= "capacityQty" THEN 'FULL'::"ProductionBatchStatus"
        ELSE 'OPEN'::"ProductionBatchStatus"
      END,
      "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = ${batch.id}
  `;

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

export async function calculateProductionSchedulePlan(args: SchedulePlanArgs): Promise<ProductionSchedulePreviewResult> {
  return prisma.$transaction(
    async (tx) => {
      const branchId = Number(args.branchId);
      if (!Number.isInteger(branchId) || branchId <= 0) throw new Error("branchId inválido");

      if (args.mode === "commit" && args.orderId) {
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
            },
          })
        : [];

      const blackoutLookup = await loadProductionBlackoutLookup({ tx, branchId, productIds });
      const configByProductId = new Map(configs.map((config) => [config.productId, config]));
      const previewReservations: PreviewReservationMap | undefined = args.mode === "preview" ? new Map() : undefined;
      const previewItems: ProductionSchedulePreviewItem[] = [];

      for (const item of normalizedItems) {
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
              evaluatedWindows: [],
              allocations: [],
              totalAllocated: "0",
              remainingQuantity: "0",
              calculatedReadyAt: readyAt,
            },
          });
          continue;
        }

        const selectedRule = selectScheduleRule(config.quantityRules, item.quantity);
        const search = await findAutoWindowsForQuantity({
          tx,
          config,
          quantity: item.quantity,
          delayBusinessDays: selectedRule.delayBusinessDays,
          targetWindow: selectedRule.targetWindow,
          previewReservations,
          blackoutLookup,
        });

        const debug: ProductionSchedulePreviewDebug = {
          quantity: item.quantityNumber,
          matchedRule: !!selectedRule.rule,
          defaultRuleApplied: !selectedRule.rule,
          delayBusinessDays: selectedRule.delayBusinessDays,
          targetWindow: selectedRule.targetWindow,
          evaluatedWindows: search.evaluatedWindows,
          allocations: search.result?.allocations.map(serializeAllocation) ?? [],
          totalAllocated: search.totalAllocated.toString(),
          remainingQuantity: search.remainingQuantity.toString(),
          calculatedReadyAt: search.result?.readyAt ?? null,
        };

        const autoResult = search.result;
        if (!autoResult) {
          const message = `${productLabel}: sin ventana con cupo para la cantidad completa; se conserva la fecha final del pedido`;

          if (args.mode === "commit" && item.orderItemId) {
            await tx.orderItem.update({
              where: { id: item.orderItemId },
              data: {
                autoEstimatedReadyAt: null,
                manualReadyAt: null,
                estimatedReadyAt: args.finalReadyAt ?? null,
                productionScheduleStatus: ProductionScheduleStatus.NOT_REQUIRED,
                productionScheduleSource: ProductionScheduleSource.NONE,
                productionScheduleMessage: message,
              },
            });
          }

          previewItems.push({
            productId: item.productId,
            quantity: item.quantityNumber,
            estimatedReadyAt: null,
            status: ProductionScheduleStatus.NOT_REQUIRED,
            source: ProductionScheduleSource.NONE,
            message,
            matchedRule: selectedRule.rule ? serializeMatchedRule(selectedRule.rule) : null,
            matchedWindow: null,
            debug,
          });
          continue;
        }

        let readyAt = autoResult.readyAt;
        let reserveFailed = false;
        if (args.mode === "commit" && args.orderId && item.orderItemId) {
          const reservedReadyAt = await reserveAutoAllocations({
            tx,
            branchId,
            productId: item.productId,
            orderId: args.orderId,
            orderItemId: item.orderItemId,
            allocations: autoResult.allocations,
          });

          if (reservedReadyAt) {
            readyAt = reservedReadyAt;
          } else {
            reserveFailed = true;
          }

          await tx.orderItem.update({
            where: { id: item.orderItemId },
            data: reserveFailed
              ? {
                  autoEstimatedReadyAt: null,
                  manualReadyAt: null,
                  estimatedReadyAt: args.finalReadyAt ?? null,
                  productionScheduleStatus: ProductionScheduleStatus.NOT_REQUIRED,
                  productionScheduleSource: ProductionScheduleSource.NONE,
                  productionScheduleMessage: `${productLabel}: no se pudo reservar el cupo calculado; se conserva la fecha final del pedido`,
                }
              : {
                  autoEstimatedReadyAt: readyAt,
                  manualReadyAt: null,
                  estimatedReadyAt: readyAt,
                  productionScheduleStatus: ProductionScheduleStatus.AUTO_SCHEDULED,
                  productionScheduleSource: ProductionScheduleSource.AUTO,
                  productionScheduleMessage: selectedRule.rule ? null : "Sin regla especial: default NEXT_AVAILABLE",
                },
          });
        }

        previewItems.push({
          productId: item.productId,
          quantity: item.quantityNumber,
          estimatedReadyAt: reserveFailed ? null : readyAt,
          status: reserveFailed ? ProductionScheduleStatus.NOT_REQUIRED : ProductionScheduleStatus.AUTO_SCHEDULED,
          source: reserveFailed ? ProductionScheduleSource.NONE : ProductionScheduleSource.AUTO,
          message: reserveFailed
            ? `${productLabel}: no se pudo reservar el cupo calculado; se conserva la fecha final del pedido`
            : selectedRule.rule
              ? `${productLabel}: estimado automáticamente`
              : `${productLabel}: sin regla especial, default NEXT_AVAILABLE`,
          matchedRule: selectedRule.rule ? serializeMatchedRule(selectedRule.rule) : null,
          matchedWindow: reserveFailed ? null : serializeMatchedWindow(autoResult.window),
          debug,
        });
      }

      const estimatedReadyAt = maxDate(
        previewItems
          .map((item) => item.estimatedReadyAt)
          .filter((value): value is Date => !!value)
      );

      return {
        estimatedReadyAt,
        status: aggregatePreviewStatus(previewItems),
        items: previewItems,
      };
    },
    { timeout: 15000, maxWait: 10000 }
  );
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
    const scheduledReadyAt = hasManual ? finalReadyAt : plan.estimatedReadyAt ?? finalReadyAt;
    const status = hasManual
      ? ProductionScheduleStatus.MANUAL_SET
      : hasAuto
        ? ProductionScheduleStatus.AUTO_SCHEDULED
        : ProductionScheduleStatus.NOT_REQUIRED;
    const source = hasManual
      ? ProductionScheduleSource.MANUAL
      : hasAuto
        ? ProductionScheduleSource.AUTO
        : ProductionScheduleSource.NONE;

    await prisma.order.update({
      where: { id: orderId },
      data: {
        autoEstimatedReadyAt: source === ProductionScheduleSource.AUTO ? scheduledReadyAt : null,
        manualReadyAt: source === ProductionScheduleSource.MANUAL ? scheduledReadyAt : null,
        estimatedReadyAt: scheduledReadyAt,
        productionScheduleStatus: status,
        productionScheduleSource: source,
        productionScheduleMessage: messages.length > 0 ? messages.join("; ") : null,
      },
    });

    return {
      ok: true,
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
