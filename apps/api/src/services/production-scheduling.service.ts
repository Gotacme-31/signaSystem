import {
  Prisma,
  ProductionScheduleSource,
  ProductionScheduleStatus,
  ProductionTargetWindow,
} from "@prisma/client";
import { prisma } from "../lib/prisma";

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
  skippedReason: string | null;
};

export type ProductionSchedulePreviewDebug = {
  quantity: number;
  matchedRule: boolean;
  defaultRuleApplied: boolean;
  delayBusinessDays: number;
  targetWindow: ProductionTargetWindow;
  evaluatedWindows: ProductionScheduleWindowEvaluation[];
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
  evaluatedWindows: ProductionScheduleWindowEvaluation[];
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
  return new Date(value.getFullYear(), value.getMonth(), value.getDate(), 12, 0, 0, 0);
}

function addDays(value: Date, days: number) {
  const next = new Date(value);
  next.setDate(next.getDate() + days);
  return next;
}

function parseTime(value: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return { hours: 0, minutes: 0 };
  return { hours: Number(match[1]), minutes: Number(match[2]) };
}

function timeLabel(value: Date) {
  const hours = String(value.getHours()).padStart(2, "0");
  const minutes = String(value.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

function dateWithTime(date: Date, time: string) {
  const { hours, minutes } = parseTime(time);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), hours, minutes, 0, 0);
}

function maxDate(values: Date[]) {
  if (values.length === 0) return null;
  return values.reduce((latest, value) => (value > latest ? value : latest), values[0]);
}

function localDateKey(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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

  const dayOfWeek = date.getDay();
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

async function findAutoWindow(args: {
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

  if (!baseDate) return { result: null, evaluatedWindows };

  let date = baseDate;
  for (let guard = 0; guard <= MAX_SEARCH_DAYS; guard += 1) {
    if (hasActiveWindows(config, date, blackoutLookup)) {
      const candidateWindows = windowsForTarget(config, date, targetWindow, blackoutLookup);
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
          },
        });

        const key = previewReservationKey({
          branchId: config.branchId,
          productId: config.productId,
          windowId: window.id,
          productionDate: date,
        });
        const alreadyPreviewed = previewReservations?.get(key) ?? decimalZero();
        const reservedQty = batch?.reservedQty ?? decimalZero();
        const currentReserved = reservedQty.add(alreadyPreviewed);
        const availableRaw = window.capacityQty.sub(currentReserved);
        const availableQty = availableRaw.gt(0) ? availableRaw : decimalZero();

        let skippedReason: string | null = null;
        if (isReadyAtExpired(date, window.readyAt, now)) {
          skippedReason = "ready_at_passed";
        } else if (quantity.gt(window.capacityQty)) {
          skippedReason = "quantity_exceeds_window_capacity";
        } else if (batch && batch.status !== "OPEN" && batch.status !== "FULL") {
          skippedReason = `batch_status_${batch.status.toLowerCase()}`;
        } else if (currentReserved.add(quantity).gt(window.capacityQty)) {
          skippedReason = "insufficient_available_capacity";
        }

        evaluatedWindows.push({
          date: localDateKey(date),
          windowId: window.id,
          dayOfWeek: window.dayOfWeek,
          readyAt: window.readyAt,
          capacityQty: window.capacityQty.toString(),
          reservedQty: currentReserved.toString(),
          availableQty: availableQty.toString(),
          skippedReason,
        });

        if (!skippedReason) {
          if (previewReservations) {
            previewReservations.set(key, alreadyPreviewed.add(quantity));
          }

          return {
            result: {
              readyAt: dateWithTime(date, window.readyAt),
              productionDate: date,
              window,
              evaluatedWindows,
            } satisfies AutoWindowSearchResult,
            evaluatedWindows,
          };
        }
      }
    }
    date = addDays(date, 1);
  }

  return { result: null, evaluatedWindows };
}

function findWindowForReadyAt(
  config: ConfigWithScheduling,
  readyAt: Date,
  blackoutLookup?: ProductionBlackoutLookup,
  now = new Date()
) {
  const productionDate = localDateOnly(readyAt);
  const readyTime = timeLabel(readyAt);
  const window = readyAt.getTime() <= now.getTime()
    ? null
    : activeWindowsForDate(config, productionDate, blackoutLookup).find((candidate) => candidate.readyAt === readyTime) ?? null;

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
              calculatedReadyAt: readyAt,
            },
          });
          continue;
        }

        const selectedRule = selectScheduleRule(config.quantityRules, item.quantity);
        const search = await findAutoWindow({
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
          calculatedReadyAt: search.result?.readyAt ?? null,
        };

        const autoResult = search.result;
        const autoDiffersFromFinal = !!(
          args.mode === "commit" &&
          args.finalReadyAt &&
          autoResult &&
          autoResult.readyAt.getTime() !== args.finalReadyAt.getTime()
        );

        if (!autoResult || autoDiffersFromFinal) {
          const message = autoDiffersFromFinal
            ? `${productLabel}: el cálculo actual no coincide con la fecha final del pedido; se conserva la fecha final`
            : `${productLabel}: sin ventana con cupo para la cantidad completa; se conserva la fecha final del pedido`;

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
          const reservedReadyAt = await reserveAutoInWindow({
            tx,
            branchId,
            productId: item.productId,
            orderId: args.orderId,
            orderItemId: item.orderItemId,
            quantity: item.quantity,
            productionDate: autoResult.productionDate,
            window: autoResult.window,
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
        autoEstimatedReadyAt: source === ProductionScheduleSource.AUTO ? finalReadyAt : null,
        manualReadyAt: source === ProductionScheduleSource.MANUAL ? finalReadyAt : null,
        estimatedReadyAt: finalReadyAt,
        productionScheduleStatus: status,
        productionScheduleSource: source,
        productionScheduleMessage: messages.length > 0 ? messages.join("; ") : null,
      },
    });

    return {
      ok: true,
      status,
      source,
      autoEstimatedReadyAt: source === ProductionScheduleSource.AUTO ? finalReadyAt : null,
      estimatedReadyAt: finalReadyAt,
      message: messages.length > 0 ? messages.join("; ") : null,
    };
  } catch (error) {
    console.error("Error calculando agenda de producción:", error);
    return markScheduleError(orderId, error);
  }
}

export async function getAvailableManualReadyTimes(orderItemId: number, dateValue: string) {
  const date = (() => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateValue);
    if (!match) return null;
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0, 0);
  })();

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
      .filter((window) => !isReadyAtExpired(date, window.readyAt, now))
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
      const window = manualReadyAt.getTime() <= Date.now()
        ? null
        : activeWindowsForDate(config, productionDate, blackoutLookup).find((candidate) => candidate.readyAt === readyTime);

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
