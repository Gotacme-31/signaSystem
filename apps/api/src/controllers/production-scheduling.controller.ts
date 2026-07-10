import type { Response } from "express";
import { Prisma, ProductionTargetWindow } from "@prisma/client";
import { prisma } from "../lib/prisma";
import type { AuthedRequest } from "../middlewares/auth";
import {
  previewProductionSchedule,
  scheduleOrderProduction,
} from "../services/production-scheduling.service";
import { orderEvents } from "../socket/handlers/orders";
import { getAccessibleBranchIdsForUser } from "../lib/branchAccess";
import {
  BUSINESS_TIME_ZONE,
  addBusinessDays,
  businessDateKeyFromDate,
  businessDateToUtcNoon,
  businessDayOfWeek,
  combineBusinessDateTimeToUtc,
  isValidDateKey,
  nextBusinessDayStartUtc,
  startOfBusinessDayUtc,
} from "../lib/business-time";

function parseId(value: string | undefined) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function parseLocalDateOnly(value: string) {
  return isValidDateKey(value) ? businessDateToUtcNoon(value) : null;
}

function startOfLocalDay(value: Date) {
  return startOfBusinessDayUtc(businessDateKeyFromDate(value));
}

function nextLocalDay(value: Date) {
  return nextBusinessDayStartUtc(businessDateKeyFromDate(value));
}

function parseOptionalId(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new Error("id inválido");
  return id;
}

function serializeBlackoutDate(row: any) {
  return {
    id: row.id,
    branchId: row.branchId,
    productId: row.productId,
    date: row.date ? businessDateKeyFromDate(row.date) : null,
    reason: row.reason,
    isActive: row.isActive,
    branch: row.branch ?? null,
    product: row.product ?? null,
    createdAt: row.createdAt?.toISOString?.(),
    updatedAt: row.updatedAt?.toISOString?.(),
  };
}

function validateTime(value: unknown, field: string) {
  if (typeof value !== "string") throw new Error(`${field} debe tener formato HH:mm`);
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error(`${field} debe tener formato HH:mm`);

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    throw new Error(`${field} debe ser una hora válida`);
  }

  return value;
}

function validateTargetWindow(value: unknown) {
  if (!value) return ProductionTargetWindow.NEXT_AVAILABLE;
  if (!Object.values(ProductionTargetWindow).includes(value as ProductionTargetWindow)) {
    throw new Error("Ventana preferida inválida");
  }
  return value as ProductionTargetWindow;
}

function decimalString(value: Prisma.Decimal | null | undefined) {
  return value == null ? null : value.toString();
}

function serializeConfig(config: any) {
  return {
    id: config.id,
    branchId: config.branchId,
    productId: config.productId,
    enabled: config.enabled,
    createdAt: config.createdAt?.toISOString?.(),
    updatedAt: config.updatedAt?.toISOString?.(),
    windows: (config.windows ?? []).map((window: any) => ({
      ...window,
      capacityQty: decimalString(window.capacityQty),
      createdAt: window.createdAt?.toISOString?.(),
      updatedAt: window.updatedAt?.toISOString?.(),
    })),
    quantityRules: (config.quantityRules ?? []).map((rule: any) => ({
      ...rule,
      minQty: decimalString(rule.minQty),
      maxQty: decimalString(rule.maxQty),
      createdAt: rule.createdAt?.toISOString?.(),
      updatedAt: rule.updatedAt?.toISOString?.(),
    })),
  };
}

function defaultConfig(branchId: number, productId: number) {
  return {
    id: null,
    branchId,
    productId,
    enabled: false,
    windows: [],
    quantityRules: [],
  };
}

function serializePreviewDate(value: Date | null) {
  return value ? value.toISOString() : null;
}

function serializePreview(result: Awaited<ReturnType<typeof previewProductionSchedule>>) {
  return {
    estimatedReadyAt: serializePreviewDate(result.estimatedReadyAt),
    status: result.status,
    items: result.items.map((item) => ({
      productId: item.productId,
      quantity: item.quantity,
      estimatedReadyAt: serializePreviewDate(item.estimatedReadyAt),
      status: item.status,
      source: item.source,
      message: item.message,
      matchedRule: item.matchedRule,
      matchedWindow: item.matchedWindow,
      debug: item.debug
        ? {
            ...item.debug,
            calculatedReadyAt: serializePreviewDate(item.debug.calculatedReadyAt),
          }
        : null,
    })),
  };
}

const CAPACITY_BOARD_MAX_DAYS = 45;
const WEEKDAY_LABELS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

function queryString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function parseQueryId(value: unknown) {
  const raw = queryString(value);
  if (!raw) return null;
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function decimalZero() {
  return new Prisma.Decimal(0);
}

function decimalToString(value: Prisma.Decimal) {
  return value.toString();
}

function occupancyPercent(capacity: Prisma.Decimal, assigned: Prisma.Decimal) {
  if (capacity.lte(0)) return assigned.gt(0) ? 100 : 0;
  return Math.round((assigned.toNumber() / capacity.toNumber()) * 1000) / 10;
}

function dateKeyToUtcMs(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

function dateRangeDiffInDays(from: string, to: string) {
  return Math.round((dateKeyToUtcMs(to) - dateKeyToUtcMs(from)) / 86400000);
}

function buildDateRangeKeys(from: string, to: string) {
  const diff = dateRangeDiffInDays(from, to);
  return Array.from({ length: diff + 1 }, (_, index) => addBusinessDays(from, index));
}

function isoDate(value?: Date | null) {
  return value ? value.toISOString() : null;
}

function businessDateTimeIso(dateKey: string, timeKey: string) {
  return combineBusinessDateTimeToUtc(dateKey, timeKey).toISOString();
}

function isWindowExpired(dateKey: string, readyAt: string, now: Date) {
  return combineBusinessDateTimeToUtc(dateKey, readyAt).getTime() <= now.getTime();
}

function serializeCapacityStatus(args: {
  active: boolean;
  expired: boolean;
  capacity: Prisma.Decimal;
  assigned: Prisma.Decimal;
}) {
  if (!args.active) return "INACTIVE";
  if (args.expired) return "EXPIRED";
  if (args.assigned.gte(args.capacity)) return "FULL";
  if (args.assigned.gt(0)) return "PARTIAL";
  return "AVAILABLE";
}

export async function previewProductionScheduleForOrder(req: AuthedRequest, res: Response) {
  try {
    const authUser = req.auth;
    if (!authUser) return res.status(401).json({ error: "No autorizado" });

    const body = req.body as any;
    const branchId = Number(body?.branchId);
    if (!Number.isInteger(branchId) || branchId <= 0) {
      return res.status(400).json({ error: "branchId inválido" });
    }

    const accessibleBranchIds = await getAccessibleBranchIdsForUser(authUser);
    if (authUser.role !== "ADMIN" && !accessibleBranchIds.includes(branchId)) {
      return res.status(403).json({ error: "No autorizado para esta sucursal" });
    }

    const items = Array.isArray(body?.items) ? body.items : [];
    const normalizedItems = items.map((item: any) => {
      const productId = Number(item?.productId);
      const quantity = item?.quantity;

      if (!Number.isInteger(productId) || productId <= 0) {
        throw new Error("productId inválido");
      }
      if (quantity === null || quantity === undefined || quantity === "") {
        throw new Error("quantity es requerido");
      }

      return { productId, quantity };
    });

    const result = await previewProductionSchedule({ branchId, items: normalizedItems });
    res.json(serializePreview(result));
  } catch (error: any) {
    console.error("Error calculando preview de producción:", error);
    res.status(400).json({ error: error?.message ?? "Error calculando preview" });
  }
}

export async function adminGetProductionCapacityBoard(req: AuthedRequest, res: Response) {
  try {
    if (!req.auth) return res.status(401).json({ error: "No autorizado" });
    if (req.auth.role !== "ADMIN") return res.status(403).json({ error: "Se requiere rol ADMIN" });

    const branchId = parseQueryId(req.query.branchId);
    const productId = parseQueryId(req.query.productId);
    if (!branchId) return res.status(400).json({ error: "branchId inválido" });
    if (!productId) return res.status(400).json({ error: "productId inválido" });

    const todayKey = businessDateKeyFromDate(new Date());
    const from = queryString(req.query.from) || queryString(req.query.dateFrom) || todayKey;
    const to = queryString(req.query.to) || queryString(req.query.dateTo) || addBusinessDays(from, 7);

    if (!isValidDateKey(from)) return res.status(400).json({ error: "Fecha inicial inválida" });
    if (!isValidDateKey(to)) return res.status(400).json({ error: "Fecha final inválida" });

    const rangeDays = dateRangeDiffInDays(from, to);
    if (rangeDays < 0) return res.status(400).json({ error: "La fecha final debe ser igual o posterior a la inicial" });
    if (rangeDays > CAPACITY_BOARD_MAX_DAYS) {
      return res.status(400).json({ error: `El rango máximo permitido es de ${CAPACITY_BOARD_MAX_DAYS} días` });
    }

    const branchProduct = await prisma.branchProduct.findUnique({
      where: { branchId_productId: { branchId, productId } },
      include: {
        branch: { select: { id: true, name: true, isActive: true } },
        product: { select: { id: true, name: true, unitType: true, isActive: true } },
      },
    });

    if (!branchProduct) {
      return res.status(404).json({ error: "Producto no disponible en esta sucursal" });
    }

    const [config, batches] = await Promise.all([
      prisma.productProductionConfig.findUnique({
        where: { branchId_productId: { branchId, productId } },
        include: {
          windows: { orderBy: [{ dayOfWeek: "asc" }, { startsAt: "asc" }, { readyAt: "asc" }] },
          quantityRules: { select: { id: true, isActive: true } },
        },
      }),
      prisma.productionBatch.findMany({
        where: {
          branchId,
          productId,
          productionDate: {
            gte: businessDateToUtcNoon(from),
            lt: nextBusinessDayStartUtc(to),
          },
        },
        orderBy: [{ productionDate: "asc" }, { windowStartAt: "asc" }, { id: "asc" }],
        include: {
          window: {
            select: {
              id: true,
              dayOfWeek: true,
              startsAt: true,
              endsAt: true,
              readyAt: true,
              capacityQty: true,
              isActive: true,
            },
          },
          items: {
            where: { status: "ACTIVE" },
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            include: {
              order: {
                select: {
                  id: true,
                  stage: true,
                  createdAt: true,
                  estimatedReadyAt: true,
                  productionScheduleStatus: true,
                  productionScheduleSource: true,
                  productionScheduleMessage: true,
                  customer: { select: { id: true, name: true } },
                },
              },
              orderItem: {
                select: {
                  id: true,
                  productId: true,
                  productNameSnapshot: true,
                  quantity: true,
                  createdAt: true,
                  estimatedReadyAt: true,
                  productionScheduleStatus: true,
                  productionScheduleSource: true,
                  productionScheduleMessage: true,
                },
              },
            },
          },
        },
      }),
    ]);

    const dateKeys = buildDateRangeKeys(from, to);
    const now = new Date();
    const batchesByDate = new Map<string, typeof batches>();
    const batchesByDateAndWindow = new Map<string, (typeof batches)[number]>();

    for (const batch of batches) {
      const dateKey = businessDateKeyFromDate(batch.productionDate);
      const rows = batchesByDate.get(dateKey) ?? [];
      rows.push(batch);
      batchesByDate.set(dateKey, rows);
      batchesByDateAndWindow.set(`${dateKey}:${batch.windowId}`, batch);
    }

    let totalCapacity = decimalZero();
    let totalAssigned = decimalZero();
    let totalAssignmentsCount = 0;
    let fullWindowsCount = 0;
    let expiredWindowsCount = 0;
    let overCapacityWindowsCount = 0;
    const uniqueOrderIds = new Set<number>();

    const days = dateKeys.map((dateKey) => {
      const dayOfWeek = businessDayOfWeek(dateKey);
      const dayBatches = batchesByDate.get(dateKey) ?? [];
      const windowRows = new Map<number, {
        id: number;
        dayOfWeek: number;
        startsAt: string;
        endsAt: string;
        readyAt: string;
        capacityQty: Prisma.Decimal;
        isActive: boolean;
        fromBatchOnly: boolean;
      }>();

      for (const window of config?.windows ?? []) {
        if (window.dayOfWeek !== dayOfWeek) continue;
        windowRows.set(window.id, { ...window, fromBatchOnly: false });
      }

      for (const batch of dayBatches) {
        if (windowRows.has(batch.windowId)) continue;
        windowRows.set(batch.windowId, {
          ...batch.window,
          capacityQty: batch.capacityQty,
          fromBatchOnly: true,
        });
      }

      let dayCapacity = decimalZero();
      let dayAssigned = decimalZero();
      const dayOrderIds = new Set<number>();
      let dayAssignmentsCount = 0;

      const windows = Array.from(windowRows.values())
        .sort((a, b) => {
          if (a.startsAt !== b.startsAt) return a.startsAt.localeCompare(b.startsAt);
          if (a.readyAt !== b.readyAt) return a.readyAt.localeCompare(b.readyAt);
          return a.id - b.id;
        })
        .map((window) => {
          const batch = batchesByDateAndWindow.get(`${dateKey}:${window.id}`) ?? null;
          const assignments = (batch?.items ?? []).map((item) => {
            uniqueOrderIds.add(item.orderId);
            dayOrderIds.add(item.orderId);
            totalAssignmentsCount += 1;
            dayAssignmentsCount += 1;

            return {
              batchItemId: item.id,
              orderId: item.orderId,
              orderNumber: `#${item.orderId}`,
              orderItemId: item.orderItemId,
              productId: item.orderItem.productId,
              productName: item.orderItem.productNameSnapshot,
              totalItemQuantity: item.orderItem.quantity.toString(),
              quantityAssigned: item.quantityAssigned.toString(),
              orderStatus: item.order.stage,
              batchItemStatus: item.status,
              source: item.source,
              orderCreatedAt: item.order.createdAt.toISOString(),
              orderItemCreatedAt: item.orderItem.createdAt.toISOString(),
              itemEstimatedReadyAt: isoDate(item.orderItem.estimatedReadyAt),
              orderEstimatedReadyAt: isoDate(item.order.estimatedReadyAt),
              finalReadyAt: isoDate(item.orderItem.estimatedReadyAt ?? item.order.estimatedReadyAt ?? batch?.readyAt ?? null),
              windowReadyAt: isoDate(batch?.readyAt ?? combineBusinessDateTimeToUtc(dateKey, window.readyAt)),
              branch: { id: branchProduct.branch.id, name: branchProduct.branch.name },
              customer: item.order.customer,
              productionScheduleStatus: item.orderItem.productionScheduleStatus,
              productionScheduleSource: item.orderItem.productionScheduleSource,
              productionScheduleMessage: item.orderItem.productionScheduleMessage,
              orderProductionScheduleStatus: item.order.productionScheduleStatus,
              orderProductionScheduleSource: item.order.productionScheduleSource,
              orderProductionScheduleMessage: item.order.productionScheduleMessage,
            };
          });
          const capacity = window.capacityQty;
          const assigned = (batch?.items ?? []).reduce(
            (sum, item) => sum.add(item.quantityAssigned),
            decimalZero()
          );
          const available = capacity.sub(assigned);
          const overCapacity = assigned.gt(capacity) ? assigned.sub(capacity) : decimalZero();
          const active = !!config?.enabled && window.isActive;
          const expired = isWindowExpired(dateKey, window.readyAt, now);
          const status = serializeCapacityStatus({ active, expired, capacity, assigned });

          dayCapacity = dayCapacity.add(capacity);
          dayAssigned = dayAssigned.add(assigned);
          totalCapacity = totalCapacity.add(capacity);
          totalAssigned = totalAssigned.add(assigned);
          if (assigned.gte(capacity)) fullWindowsCount += 1;
          if (expired) expiredWindowsCount += 1;
          if (overCapacity.gt(0)) overCapacityWindowsCount += 1;

          return {
            windowId: window.id,
            dayOfWeek: window.dayOfWeek,
            startsAt: window.startsAt,
            endsAt: window.endsAt,
            readyAt: window.readyAt,
            windowStartAt: businessDateTimeIso(dateKey, window.startsAt),
            windowEndAt: businessDateTimeIso(dateKey, window.endsAt),
            readyAtDateTime: businessDateTimeIso(dateKey, window.readyAt),
            active,
            windowActive: window.isActive,
            fromBatchOnly: window.fromBatchOnly,
            expired,
            status,
            capacity: decimalToString(capacity),
            assigned: decimalToString(assigned),
            available: decimalToString(available),
            occupancyPercent: occupancyPercent(capacity, assigned),
            overCapacity: decimalToString(overCapacity),
            batchId: batch?.id ?? null,
            batchStatus: batch?.status ?? null,
            batchReservedQty: batch?.reservedQty.toString() ?? null,
            assignments,
          };
        });

      const dayAvailable = dayCapacity.sub(dayAssigned);

      return {
        date: dateKey,
        weekday: WEEKDAY_LABELS[dayOfWeek] ?? "",
        capacity: decimalToString(dayCapacity),
        assigned: decimalToString(dayAssigned),
        available: decimalToString(dayAvailable),
        occupancyPercent: occupancyPercent(dayCapacity, dayAssigned),
        ordersCount: dayOrderIds.size,
        assignmentsCount: dayAssignmentsCount,
        windows,
      };
    });

    const totalAvailable = totalCapacity.sub(totalAssigned);

    res.json({
      branch: branchProduct.branch,
      product: branchProduct.product,
      range: { from, to, timezone: BUSINESS_TIME_ZONE, days: dateKeys.length },
      config: {
        exists: !!config,
        enabled: !!config?.enabled,
        windowsCount: config?.windows.length ?? 0,
        activeWindowsCount: config?.windows.filter((window) => window.isActive).length ?? 0,
        quantityRulesCount: config?.quantityRules.length ?? 0,
        activeQuantityRulesCount: config?.quantityRules.filter((rule) => rule.isActive).length ?? 0,
      },
      totals: {
        capacity: decimalToString(totalCapacity),
        assigned: decimalToString(totalAssigned),
        available: decimalToString(totalAvailable),
        occupancyPercent: occupancyPercent(totalCapacity, totalAssigned),
        ordersCount: uniqueOrderIds.size,
        assignmentsCount: totalAssignmentsCount,
        fullWindowsCount,
        expiredWindowsCount,
        overCapacityWindowsCount,
      },
      days,
    });
  } catch (error: any) {
    console.error("Error construyendo tablero de capacidad:", error);
    res.status(400).json({ error: error?.message ?? "Error construyendo tablero de capacidad" });
  }
}

export async function adminListProductionConfigs(req: AuthedRequest, res: Response) {
  try {
    const branchId = parseId(req.params.branchId);
    if (!branchId) return res.status(400).json({ error: "branchId inválido" });

    const branchProducts = await prisma.branchProduct.findMany({
      where: { branchId },
      orderBy: { productId: "asc" },
      include: {
        product: {
          select: { id: true, name: true, unitType: true, isActive: true },
        },
      },
    });

    const configs = await prisma.productProductionConfig.findMany({
      where: { branchId },
      orderBy: { productId: "asc" },
      include: {
        windows: { orderBy: [{ dayOfWeek: "asc" }, { startsAt: "asc" }, { readyAt: "asc" }] },
        quantityRules: { orderBy: [{ minQty: "asc" }, { maxQty: "asc" }] },
      },
    });

    const configByProductId = new Map(configs.map((config) => [config.productId, config]));

    const rows = branchProducts.map((branchProduct) => ({
      branchId,
      productId: branchProduct.productId,
      product: branchProduct.product,
      branchProductIsActive: branchProduct.isActive,
      config: configByProductId.has(branchProduct.productId)
        ? serializeConfig(configByProductId.get(branchProduct.productId))
        : defaultConfig(branchId, branchProduct.productId),
    }));

    res.json({ rows });
  } catch (error: any) {
    console.error("Error listando configuración de producción:", error);
    res.status(400).json({ error: error?.message ?? "Error listando configuración" });
  }
}

export async function adminUpsertProductionConfig(req: AuthedRequest, res: Response) {
  try {
    const branchId = parseId(req.params.branchId);
    const productId = parseId(req.params.productId);
    if (!branchId || !productId) return res.status(400).json({ error: "ids inválidos" });

    const branchProduct = await prisma.branchProduct.findUnique({
      where: { branchId_productId: { branchId, productId } },
      select: { id: true },
    });

    if (!branchProduct) {
      return res.status(404).json({ error: "Producto no disponible en esta sucursal" });
    }

    const body = req.body as any;
    const enabled = body.enabled === true;
    const windows = Array.isArray(body.windows) ? body.windows : [];
    const quantityRules = Array.isArray(body.quantityRules) ? body.quantityRules : [];

    const normalizedWindows = windows.map((window: any) => {
      const dayOfWeek = Number(window.dayOfWeek);
      const capacityQty = new Prisma.Decimal(String(window.capacityQty ?? 0));
      const startsAt = validateTime(window.startsAt, "Inicio");
      const endsAt = validateTime(window.endsAt, "Fin");
      const readyAt = validateTime(window.readyAt, "Listo / salida");

      if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
        throw new Error("Día debe estar entre 0 y 6");
      }
      if (startsAt >= endsAt) throw new Error("Inicio debe ser menor que fin");
      if (capacityQty.lte(0)) throw new Error("Capacidad debe ser mayor a 0");

      return {
        id: Number.isInteger(Number(window.id)) && Number(window.id) > 0 ? Number(window.id) : null,
        dayOfWeek,
        startsAt,
        endsAt,
        readyAt,
        capacityQty,
        isActive: window.isActive !== false,
      };
    });

    const normalizedRules = quantityRules.map((rule: any) => {
      const minQty = new Prisma.Decimal(String(rule.minQty ?? 0));
      const maxQty = rule.maxQty === null || rule.maxQty === "" || rule.maxQty === undefined
        ? null
        : new Prisma.Decimal(String(rule.maxQty));
      const delayBusinessDays = Number(rule.delayBusinessDays ?? 0);
      const targetWindow = validateTargetWindow(rule.targetWindow);

      if (minQty.isNegative()) throw new Error("Cantidad mínima no puede ser negativa");
      if (maxQty && maxQty.lte(minQty)) throw new Error("Cantidad máxima debe ser mayor que cantidad mínima");
      if (!Number.isInteger(delayBusinessDays) || delayBusinessDays < 0 || delayBusinessDays > 365) {
        throw new Error("Retraso en días hábiles debe estar entre 0 y 365");
      }

      return {
        id: Number.isInteger(Number(rule.id)) && Number(rule.id) > 0 ? Number(rule.id) : null,
        minQty,
        maxQty,
        delayBusinessDays,
        targetWindow,
        isActive: rule.isActive !== false,
      };
    });

    const config = await prisma.$transaction(async (tx) => {
      const savedConfig = await tx.productProductionConfig.upsert({
        where: { branchId_productId: { branchId, productId } },
        create: { branchId, productId, enabled },
        update: { enabled },
      });

      const existingWindows = await tx.productionCapacityWindow.findMany({
        where: { configId: savedConfig.id },
        include: { _count: { select: { batches: true } } },
      });
      const incomingWindowIds = new Set<number>();

      for (const window of normalizedWindows) {
        if (window.id && existingWindows.some((existing) => existing.id === window.id)) {
          incomingWindowIds.add(window.id);
          await tx.productionCapacityWindow.update({
            where: { id: window.id },
            data: window,
          });
        } else {
          const created = await tx.productionCapacityWindow.create({
            data: { ...window, configId: savedConfig.id, id: undefined },
            select: { id: true },
          });
          incomingWindowIds.add(created.id);
        }
      }

      for (const existing of existingWindows) {
        if (incomingWindowIds.has(existing.id)) continue;
        if (existing._count.batches > 0) {
          await tx.productionCapacityWindow.update({ where: { id: existing.id }, data: { isActive: false } });
        } else {
          await tx.productionCapacityWindow.delete({ where: { id: existing.id } });
        }
      }

      const existingRules = await tx.productionQuantityRule.findMany({
        where: { configId: savedConfig.id },
        select: { id: true },
      });
      const incomingRuleIds = new Set<number>();

      for (const rule of normalizedRules) {
        if (rule.id && existingRules.some((existing) => existing.id === rule.id)) {
          incomingRuleIds.add(rule.id);
          await tx.productionQuantityRule.update({ where: { id: rule.id }, data: rule });
        } else {
          const created = await tx.productionQuantityRule.create({
            data: { ...rule, configId: savedConfig.id, id: undefined },
            select: { id: true },
          });
          incomingRuleIds.add(created.id);
        }
      }

      const ruleIdsToDelete = existingRules.map((rule) => rule.id).filter((id) => !incomingRuleIds.has(id));
      if (ruleIdsToDelete.length > 0) {
        await tx.productionQuantityRule.deleteMany({ where: { id: { in: ruleIdsToDelete } } });
      }

      return tx.productProductionConfig.findUniqueOrThrow({
        where: { id: savedConfig.id },
        include: {
          windows: { orderBy: [{ dayOfWeek: "asc" }, { startsAt: "asc" }, { readyAt: "asc" }] },
          quantityRules: { orderBy: [{ minQty: "asc" }, { maxQty: "asc" }] },
        },
      });
    });

    res.json({ ok: true, config: serializeConfig(config) });
  } catch (error: any) {
    console.error("Error guardando configuración de producción:", error);
    res.status(400).json({ error: error?.message ?? "Error guardando configuración" });
  }
}

export async function adminListProductionBatches(req: AuthedRequest, res: Response) {
  try {
    const branchId = typeof req.query.branchId === "string" ? Number(req.query.branchId) : undefined;
    const productId = typeof req.query.productId === "string" ? Number(req.query.productId) : undefined;
    const dateFrom = typeof req.query.dateFrom === "string" ? parseLocalDateOnly(req.query.dateFrom) : null;
    const dateTo = typeof req.query.dateTo === "string" ? parseLocalDateOnly(req.query.dateTo) : null;

    const where: any = {};
    if (Number.isInteger(branchId) && branchId && branchId > 0) where.branchId = branchId;
    if (Number.isInteger(productId) && productId && productId > 0) where.productId = productId;
    if (dateFrom || dateTo) {
      where.productionDate = {
        ...(dateFrom ? { gte: dateFrom } : {}),
        ...(dateTo ? { lt: nextLocalDay(dateTo) } : {}),
      };
    }

    const batches = await prisma.productionBatch.findMany({
      where,
      orderBy: [{ productionDate: "asc" }, { windowStartAt: "asc" }],
      take: 300,
      include: {
        branch: { select: { id: true, name: true } },
        product: { select: { id: true, name: true, unitType: true } },
        window: { select: { id: true, dayOfWeek: true, startsAt: true, endsAt: true, readyAt: true } },
        _count: { select: { items: true } },
      },
    });

    res.json({
      batches: batches.map((batch) => ({
        ...batch,
        productionDate: businessDateKeyFromDate(batch.productionDate),
        capacityQty: batch.capacityQty.toString(),
        reservedQty: batch.reservedQty.toString(),
      })),
    });
  } catch (error: any) {
    console.error("Error listando batches de producción:", error);
    res.status(400).json({ error: error?.message ?? "Error listando batches" });
  }
}

export async function adminRecalculateOrderSchedule(req: AuthedRequest, res: Response) {
  try {
    const orderId = parseId(req.params.orderId);
    if (!orderId) return res.status(400).json({ error: "orderId inválido" });

    const result = await scheduleOrderProduction(orderId);
    const updatedOrder = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        branchId: true,
        pickupBranchId: true,
        autoEstimatedReadyAt: true,
        manualReadyAt: true,
        estimatedReadyAt: true,
        productionScheduleStatus: true,
        productionScheduleSource: true,
        productionScheduleMessage: true,
      },
    });

    if (updatedOrder) orderEvents(req.app.get("io")).orderUpdated(updatedOrder);

    res.json({ ok: result.ok, result, order: updatedOrder });
  } catch (error: any) {
    console.error("Error recalculando agenda de pedido:", error);
    res.status(400).json({ error: error?.message ?? "Error recalculando agenda" });
  }
}

export async function adminListProductionBlackoutDates(req: AuthedRequest, res: Response) {
  try {
    const branchId = typeof req.query.branchId === "string" && req.query.branchId
      ? Number(req.query.branchId)
      : null;
    const productId = typeof req.query.productId === "string" && req.query.productId
      ? Number(req.query.productId)
      : null;
    const dateFrom = typeof req.query.dateFrom === "string" ? parseLocalDateOnly(req.query.dateFrom) : null;
    const dateTo = typeof req.query.dateTo === "string" ? parseLocalDateOnly(req.query.dateTo) : null;

    if (branchId !== null && (!Number.isInteger(branchId) || branchId <= 0)) {
      return res.status(400).json({ error: "branchId inválido" });
    }
    if (productId !== null && (!Number.isInteger(productId) || productId <= 0)) {
      return res.status(400).json({ error: "productId inválido" });
    }

    const where: any = {};
    const andFilters: any[] = [];
    if (branchId) andFilters.push({ OR: [{ branchId: null }, { branchId }] });
    if (productId) andFilters.push({ OR: [{ productId: null }, { productId }] });
    if (andFilters.length > 0) where.AND = andFilters;
    if (dateFrom || dateTo) {
      where.date = {
        ...(dateFrom ? { gte: startOfLocalDay(dateFrom) } : {}),
        ...(dateTo ? { lt: nextLocalDay(dateTo) } : {}),
      };
    }

    const rows = await prisma.productionBlackoutDate.findMany({
      where,
      orderBy: [{ date: "asc" }, { id: "asc" }],
      take: 500,
      include: {
        branch: { select: { id: true, name: true } },
        product: { select: { id: true, name: true, unitType: true } },
      },
    });

    res.json({ rows: rows.map(serializeBlackoutDate) });
  } catch (error: any) {
    console.error("Error listando días inhábiles de producción:", error);
    res.status(400).json({ error: error?.message ?? "Error listando días inhábiles" });
  }
}

export async function adminCreateProductionBlackoutDate(req: AuthedRequest, res: Response) {
  try {
    const body = req.body as any;
    const branchId = parseOptionalId(body.branchId);
    const productId = parseOptionalId(body.productId);
    const date = typeof body.date === "string" ? parseLocalDateOnly(body.date) : null;

    if (!date) return res.status(400).json({ error: "Fecha inválida" });
    if (productId && !branchId) {
      return res.status(400).json({ error: "Para inhábil por producto, branchId es requerido" });
    }

    const row = await prisma.productionBlackoutDate.create({
      data: {
        branchId,
        productId,
        date,
        reason: typeof body.reason === "string" && body.reason.trim() ? body.reason.trim() : null,
        isActive: body.isActive !== false,
      },
      include: {
        branch: { select: { id: true, name: true } },
        product: { select: { id: true, name: true, unitType: true } },
      },
    });

    res.status(201).json({ ok: true, blackoutDate: serializeBlackoutDate(row) });
  } catch (error: any) {
    console.error("Error creando día inhábil de producción:", error);
    res.status(400).json({ error: error?.message ?? "Error creando día inhábil" });
  }
}

export async function adminUpdateProductionBlackoutDate(req: AuthedRequest, res: Response) {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: "id inválido" });

    const body = req.body as any;
    const data: any = {};

    if (Object.prototype.hasOwnProperty.call(body, "branchId")) {
      data.branchId = parseOptionalId(body.branchId);
    }
    if (Object.prototype.hasOwnProperty.call(body, "productId")) {
      data.productId = parseOptionalId(body.productId);
    }
    if (Object.prototype.hasOwnProperty.call(body, "date")) {
      const date = typeof body.date === "string" ? parseLocalDateOnly(body.date) : null;
      if (!date) return res.status(400).json({ error: "Fecha inválida" });
      data.date = date;
    }
    if (Object.prototype.hasOwnProperty.call(body, "reason")) {
      data.reason = typeof body.reason === "string" && body.reason.trim() ? body.reason.trim() : null;
    }
    if (Object.prototype.hasOwnProperty.call(body, "isActive")) {
      data.isActive = body.isActive === true;
    }

    const nextBranchId = Object.prototype.hasOwnProperty.call(data, "branchId") ? data.branchId : undefined;
    const nextProductId = Object.prototype.hasOwnProperty.call(data, "productId") ? data.productId : undefined;
    if (nextProductId && nextBranchId === null) {
      return res.status(400).json({ error: "Para inhábil por producto, branchId es requerido" });
    }

    const row = await prisma.productionBlackoutDate.update({
      where: { id },
      data,
      include: {
        branch: { select: { id: true, name: true } },
        product: { select: { id: true, name: true, unitType: true } },
      },
    });

    res.json({ ok: true, blackoutDate: serializeBlackoutDate(row) });
  } catch (error: any) {
    console.error("Error actualizando día inhábil de producción:", error);
    res.status(400).json({ error: error?.message ?? "Error actualizando día inhábil" });
  }
}

export async function adminDeleteProductionBlackoutDate(req: AuthedRequest, res: Response) {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: "id inválido" });

    await prisma.productionBlackoutDate.delete({ where: { id } });
    res.json({ ok: true });
  } catch (error: any) {
    console.error("Error eliminando día inhábil de producción:", error);
    res.status(400).json({ error: error?.message ?? "Error eliminando día inhábil" });
  }
}
