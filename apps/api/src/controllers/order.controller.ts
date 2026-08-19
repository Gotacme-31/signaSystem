import type { Response } from "express";
import {
  Prisma,
  OrderStage,
  ShippingType,
  PaymentMethod,
  ParamChargeType,
} from "@prisma/client";
import { prisma } from "../lib/prisma";
import type { AuthedRequest } from "../middlewares/auth";
import bcrypt from "bcrypt";
import { orderEvents } from "../socket/handlers/orders";
import {
  branchScopeWhere,
  canAccessOrderByBranches,
  getAccessibleBranchIdsForUser,
} from "../lib/branchAccess";
import { cleanupOrderFilesForDeliveredOrder } from "../services/order-file.service";
import {
  applyManualReadyAtToOrderItem,
  getAvailableManualReadyTimes,
  scheduleOrderProduction,
} from "../services/production-scheduling.service";
import {
  lockOrderProductionScheduling,
  releaseOrderProductionReservations,
} from "../services/production-capacity-runtime";
import {
  assertCustomUnitType,
  assertTemplateIsNotNormalProduct,
  customProductUpdateRequiresAvailability,
  resolveCustomProductIdForPersistence,
  resolveEnabledCustomProductTemplate,
} from "../services/custom-product.service";
import {
  appliedGroupMetadata,
  buildGroupPricingContext,
  buildPricingGroupRepricePlan,
  calculateBranchProductItemPrice,
  pricingQuantityForItem,
  validateVariantSelection,
} from "../services/order-pricing.service";
import {
  businessDateKeyFromDate,
  businessDateToUtcNoon,
  businessTimeKeyFromDate,
  combineBusinessDateTimeToUtc,
  formatBusinessDateTime,
  isValidDateKey,
  isValidTimeKey,
  nextBusinessDayStartUtc,
  startOfBusinessDayUtc,
} from "../lib/business-time";

type ParamChargeTypeInput = "PER_METER" | "PER_PIECE";

type SelectedParamInput = {
  paramId: number;
  chargeType?: ParamChargeTypeInput;
  pieceQty?: number | string | null;
};

type CreateOrderItemInput = {
  productId: number;
  quantity: number | string;
  variantId?: number | null;
  paramIds?: number[];
  selectedParams?: SelectedParamInput[];
  isCustomProduct?: boolean;
  customProductName?: string;
  customUnitType?: "METER" | "PIECE";
  customUnitPrice?: number | string;
};

type PaymentInput = {
  method: PaymentMethod;
  amount: number | string;
  reference?: string | null;
};

type DeliveryScheduleSourceInput = "AUTO" | "MANUAL";

function roundMoney(value: Prisma.Decimal): Prisma.Decimal {
  return new Prisma.Decimal(value.toFixed(2));
}

function normalizePaymentsOrThrow(args: {
  payments?: unknown;
  fallbackMethod?: PaymentMethod;
  expectedTotal: Prisma.Decimal;
}): Array<{ method: PaymentMethod; amount: Prisma.Decimal; reference: string | null }> {
  const { payments, fallbackMethod, expectedTotal } = args;

  const parsedFromArray = Array.isArray(payments)
    ? (payments as any[])
        .map((row) => {
          const method = row?.method as PaymentMethod;
          const amount = new Prisma.Decimal(String(row?.amount ?? 0));
          const reference =
            typeof row?.reference === "string" && row.reference.trim()
              ? row.reference.trim()
              : null;

          return { method, amount, reference };
        })
        .filter((row) => ["CASH", "TRANSFER", "CARD"].includes(row.method))
    : [];

  const parsed =
    parsedFromArray.length > 0
      ? parsedFromArray
      : fallbackMethod
      ? [{ method: fallbackMethod, amount: expectedTotal, reference: null }]
      : [];

  if (parsed.length === 0) {
    throw new Error("Debes registrar al menos un método de pago");
  }

  for (const p of parsed) {
    if (p.amount.lte(0)) {
      throw new Error("Cada pago debe ser mayor a 0");
    }
  }

  const sum = parsed.reduce((acc, p) => acc.add(p.amount), new Prisma.Decimal(0));
  const sumRounded = roundMoney(sum);
  const totalRounded = roundMoney(expectedTotal);
  const diff = sumRounded.sub(totalRounded).abs();

  if (diff.gt(new Prisma.Decimal("0.01"))) {
    throw new Error("La suma de pagos debe coincidir con el total del pedido");
  }

  return parsed.map((p) => ({
    method: p.method,
    amount: roundMoney(p.amount),
    reference: p.reference,
  }));
}

function parseLocalDateOnly(value: string): Date {
  const trimmed = value.trim();
  if (!isValidDateKey(trimmed)) {
    throw new Error(`Fecha inválida: ${value}. Formato esperado: YYYY-MM-DD`);
  }
  return businessDateToUtcNoon(trimmed);
}

function parseNullableDateTime(value: unknown): Date | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") {
    throw new Error("Fecha/hora estimada invalida");
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Fecha/hora estimada invalida");
  }

  return date;
}

function dateInputFromDate(value: Date) {
  return businessDateKeyFromDate(value);
}

function timeInputFromDate(value: Date) {
  return businessTimeKeyFromDate(value);
}

function normalizeDeliveryTime(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") throw new Error("Hora de entrega inválida");

  if (!isValidTimeKey(value)) throw new Error("Hora de entrega inválida");

  return value;
}

function deliveryReadyAtFromParts(deliveryDate: Date, deliveryTime: string | null) {
  return combineBusinessDateTimeToUtc(dateInputFromDate(deliveryDate), deliveryTime ?? "18:00");
}

export function normalizeCreateOrderCommercialDelivery(input: {
  deliveryDate: string;
  deliveryTime?: string | null;
}, authorizedRole?: string) {
  void authorizedRole;
  const deliveryDate = parseLocalDateOnly(input.deliveryDate);
  const deliveryTime = normalizeDeliveryTime(input.deliveryTime);
  return {
    deliveryDate,
    deliveryTime,
    finalReadyAt: deliveryReadyAtFromParts(deliveryDate, deliveryTime),
  };
}

export function createOrderOperationalScheduleSource(_requestedSource: unknown): DeliveryScheduleSourceInput {
  void _requestedSource;
  return "AUTO";
}

function parseId(param: string | string[] | undefined): number | null {
  if (!param) return null;
  const str = Array.isArray(param) ? param[0] : param;
  const num = parseInt(str, 10);
  return Number.isFinite(num) ? num : null;
}

function asPositiveInt(value: unknown, fallback = 1): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.floor(n));
}

function normalizeSelectedParams(
  rawSelectedParams: unknown,
  fallbackParamIds: unknown,
  bp: any
): Array<{ paramId: number; chargeType: "PER_METER" | "PER_PIECE"; pieceQty: number }> {
  const validParamMap = new Map<number, any>();

  for (const pp of bp.paramPrices ?? []) {
    if (pp?.isActive && pp?.param?.isActive) {
      validParamMap.set(pp.paramId, pp);
    }
  }

  const rawList = Array.isArray(rawSelectedParams) ? rawSelectedParams : [];
  const normalized: Array<{
    paramId: number;
    chargeType: "PER_METER" | "PER_PIECE";
    pieceQty: number;
  }> = [];

  for (const item of rawList as any[]) {
    const paramId = Number(item?.paramId);
    if (!Number.isFinite(paramId)) continue;

    const meta = validParamMap.get(paramId);
    if (!meta) continue;

    const realChargeType =
      meta.param?.chargeType === "PER_PIECE" ? "PER_PIECE" : "PER_METER";

    normalized.push({
      paramId,
      chargeType: realChargeType,
      pieceQty: realChargeType === "PER_PIECE" ? asPositiveInt(item?.pieceQty, 1) : 1,
    });
  }

  if (Array.isArray(rawSelectedParams)) return normalized;

  const paramIds = Array.isArray(fallbackParamIds)
    ? fallbackParamIds.map((x) => Number(x)).filter((x) => Number.isFinite(x))
    : [];

  return paramIds
    .map((paramId) => {
      const meta = validParamMap.get(paramId);
      if (!meta) return null;

      const realChargeType =
        meta.param?.chargeType === "PER_PIECE" ? "PER_PIECE" : "PER_METER";

      return {
        paramId,
        chargeType: realChargeType as "PER_METER" | "PER_PIECE",
        pieceQty: 1,
      };
    })
    .filter(Boolean) as Array<{
      paramId: number;
      chargeType: "PER_METER" | "PER_PIECE";
      pieceQty: number;
    }>;
}

export async function nextStep(req: AuthedRequest, res: Response) {
  const authUser = req.auth;
  const id = parseId(req.params.id);

  if (!authUser) return res.status(401).json({ error: "No autorizado" });
  if (!id) return res.status(400).json({ error: "id inválido" });

  try {
    const result = await prisma.$transaction(
      async (tx) => {
      const item = await tx.orderItem.findUnique({
        where: { id },
        include: {
          order: { select: { id: true, branchId: true, stage: true } },
          steps: { orderBy: { order: "asc" } },
        },
      });

      if (!item) throw new Error("OrderItem no existe");

      if (item.isReady) {
        return { ok: true, orderId: item.order.id, orderStage: item.order.stage, itemReady: true };
      }

      const current = item.currentStepOrder;
      const step = item.steps.find((s) => s.order === current);
      const lastOrder = item.steps.reduce((m, s) => Math.max(m, s.order), 0);

      if (!step) {
        await tx.orderItem.update({
          where: { id: item.id },
          data: { isReady: true },
        });
      } else {
        await tx.orderItemStep.update({
          where: { id: step.id },
          data: { status: "DONE", doneAt: new Date() },
        });

        const next = current + 1;
        const nextStepRow = item.steps.find((s) => s.order === next);
        const isNextLastAndListo = next === lastOrder && nextStepRow?.name === "LISTO";

        if (isNextLastAndListo) {
          await tx.orderItemStep.update({
            where: { id: nextStepRow!.id },
            data: { status: "DONE", doneAt: new Date() },
          });

          await tx.orderItem.update({
            where: { id: item.id },
            data: { currentStepOrder: lastOrder, isReady: true },
          });
        } else {
          const hasNext = item.steps.some((s) => s.order === next);

          if (hasNext) {
            await tx.orderItem.update({
              where: { id: item.id },
              data: { currentStepOrder: next },
            });
          } else {
            await tx.orderItem.update({
              where: { id: item.id },
              data: { isReady: true },
            });
          }
        }
      }

      const all = await tx.orderItem.findMany({
        where: { orderId: item.order.id },
        select: { isReady: true },
      });

      const allReady = all.every((x) => x.isReady);
      const newStage = allReady ? OrderStage.READY : OrderStage.IN_PROGRESS;

      await tx.order.update({
        where: { id: item.order.id },
        data: { stage: newStage },
      });

      return {
        ok: true,
        orderId: item.order.id,
        orderStage: newStage,
        allReady,
        itemId: id,
      };
      },
      { timeout: 15000, maxWait: 10000 }
    );

    const io = req.app.get("io");
    const events = orderEvents(io);

    const updatedItem = await prisma.orderItem.findUnique({
      where: { id },
      select: {
        currentStepOrder: true,
        order: {
          select: { branchId: true },
        },
      },
    });

    if (updatedItem) {
      events.itemStepAdvanced(
        id,
        result.orderId,
        updatedItem.currentStepOrder,
        updatedItem.order.branchId
      );

      if (result.orderStage) {
        events.orderStatusChanged(
          result.orderId,
          result.orderStage,
          updatedItem.order.branchId
        );
      }
    }

    res.json(result);
  } catch (e: any) {
    console.error("Error avanzando paso:", e);
    res.status(400).json({ error: e?.message ?? "Error" });
  }
}

export async function listActiveOrders(req: AuthedRequest, res: Response) {
  const authUser = req.auth;
  if (!authUser) return res.status(401).json({ error: "No autorizado" });

  try {
    const accessibleBranchIds = await getAccessibleBranchIdsForUser(authUser);
    if (authUser.role !== "ADMIN" && accessibleBranchIds.length === 0) {
      return res.status(400).json({ error: "Usuario sin sucursal asignada" });
    }

    const where: any = {
      stage: { not: OrderStage.DELIVERED },
    };

    const scope = (req.query.scope as string) ?? "all";
    const sortOrder = req.query.sortOrder === "asc" ? "asc" : "desc";

    if (authUser.role !== "ADMIN") {
      Object.assign(where, branchScopeWhere(accessibleBranchIds, scope));
    }

    const dateFrom = typeof req.query.dateFrom === "string" ? req.query.dateFrom : undefined;
    const dateTo = typeof req.query.dateTo === "string" ? req.query.dateTo : undefined;

    if (dateFrom || dateTo) {
      if (dateFrom && !isValidDateKey(dateFrom)) throw new Error("dateFrom inválido");
      if (dateTo && !isValidDateKey(dateTo)) throw new Error("dateTo inválido");

      where.deliveryDate = {
        ...(dateFrom ? { gte: startOfBusinessDayUtc(dateFrom) } : {}),
        ...(dateTo ? { lt: nextBusinessDayStartUtc(dateTo) } : {}),
      };
    }

    const orders = await prisma.order.findMany({
      where,
      orderBy: sortOrder === "desc" ? [{ id: "desc" }] : [{ id: "asc" }],
      select: {
        id: true,
        stage: true,
        shippingType: true,
        shippingStage: true,
        deliveryDate: true,
        deliveryTime: true,
        autoEstimatedReadyAt: true,
        manualReadyAt: true,
        estimatedReadyAt: true,
        productionScheduleStatus: true,
        productionScheduleSource: true,
        productionScheduleMessage: true,
        createdAt: true,
        notes: true,
        total: true,
        paymentMethod: true,
        payments: {
          select: { id: true, method: true, amount: true, reference: true, createdAt: true },
          orderBy: { id: "asc" },
        },
        branchId: true,
        pickupBranchId: true,
        subtotalBeforeTax: true,
        hasIva: true,
        ivaAmount: true,
        customer: { select: { id: true, name: true, phone: true } },
        branch: { select: { id: true, name: true } },
        pickupBranch: { select: { id: true, name: true } },
        creator: { select: { id: true, name: true, username: true, role: true } },
        files: {
          where: { status: "ACTIVE" },
          select: { id: true, orderItemId: true, status: true },
          orderBy: { uploadedAt: "desc" },
        },

        items: {
          select: {
            id: true,
            quantity: true,
            autoEstimatedReadyAt: true,
            manualReadyAt: true,
            estimatedReadyAt: true,
            productionScheduleStatus: true,
            productionScheduleSource: true,
            productionScheduleMessage: true,
            isReady: true,
            currentStepOrder: true,
            unitPrice: true,
            subtotal: true,
            product: { select: { id: true, name: true, unitType: true } },
            isCustomProduct: true,
            customProductName: true,
            customUnitType: true,
            customUnitPrice: true,
            variantRef: { select: { id: true, name: true } },
            steps: {
              select: { order: true, name: true, status: true },
              orderBy: { order: "asc" }
            },
            options: {
              select: {
                id: true,
                name: true,
                priceDelta: true,
                quantity: true,
                chargeType: true,
                subtotal: true,
              },
            },
          },
        },
      }
    });

    res.json({ orders });
  } catch (e: any) {
    console.error("Error listando pedidos activos:", e);
    res.status(400).json({ error: e?.message ?? "Error" });
  }
}

export async function markDelivered(req: AuthedRequest, res: Response) {
  const authUser = req.auth;
  const orderId = parseId(req.params.id);

  if (!authUser) return res.status(401).json({ error: "No autorizado" });
  if (!orderId) return res.status(400).json({ error: "id inválido" });

  try {
    const accessibleBranchIds = await getAccessibleBranchIdsForUser(authUser);
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, branchId: true, pickupBranchId: true },
    });

    if (!order) return res.status(404).json({ error: "Pedido no existe" });

    if (
      authUser.role !== "ADMIN" &&
      !accessibleBranchIds.includes(order.branchId)
    ) {
      return res.status(403).json({ error: "No autorizado" });
    }

    await prisma.order.update({
      where: { id: orderId },
      data: { stage: OrderStage.DELIVERED, deliveredAt: new Date() },
    });

    await cleanupOrderFilesForDeliveredOrder(orderId).catch((error) => {
      console.error("Error limpiando archivos al entregar pedido:", error?.message ?? error);
    });

    const io = req.app.get("io");
    const events = orderEvents(io);

    events.orderDelivered(orderId, order.branchId);

    if (order.pickupBranchId && order.pickupBranchId !== order.branchId) {
      events.orderDelivered(orderId, order.pickupBranchId);
    }

    events.orderDeleted(orderId, order.branchId, order.pickupBranchId);

    res.json({ ok: true });
  } catch (e: any) {
    console.error("Error marcando como entregado:", e);
    res.status(400).json({ error: e?.message ?? "Error" });
  }
}

export async function markReceived(req: AuthedRequest, res: Response) {
  const authUser = req.auth;
  const orderId = parseId(req.params.id);

  if (!authUser) return res.status(401).json({ error: "No autorizado" });
  if (!orderId) return res.status(400).json({ error: "id inválido" });

  try {
    const accessibleBranchIds = await getAccessibleBranchIdsForUser(authUser);
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, branchId: true, shippingType: true },
    });

    if (!order) return res.status(404).json({ error: "Pedido no existe" });
    if (order.shippingType !== "DELIVERY") {
      return res.status(400).json({ error: "Este pedido no es DELIVERY" });
    }

    if (!canAccessOrderByBranches(authUser.role, accessibleBranchIds, order.branchId)) {
      return res.status(403).json({ error: "No autorizado" });
    }

    await prisma.order.update({
      where: { id: orderId },
      data: { shippingStage: "RECEIVED" },
    });

    res.json({ ok: true });
  } catch (e: any) {
    console.error("Error marcando como recibido:", e);
    res.status(400).json({ error: e?.message ?? "Error" });
  }
}

export async function getOrderDetails(req: AuthedRequest, res: Response) {
  try {
    const orderId = parseId(req.params.id);
    const authUser = req.auth;

    if (!authUser) return res.status(401).json({ error: "No autorizado" });
    if (!orderId) return res.status(400).json({ error: "id inválido" });

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        customer: { select: { id: true, name: true, phone: true } },
        branch: { select: { id: true, name: true } },
        pickupBranch: { select: { id: true, name: true } },
        payments: { orderBy: { id: "asc" } },
        creator: {
          select: {
            id: true,
            name: true,
            username: true,
            role: true,
          },
        },
        items: {
          select: {
            id: true,
            orderId: true,
            productId: true,
            productNameSnapshot: true,
            unitTypeSnapshot: true,
            quantity: true,
            variantId: true,
            variantRef: { select: { id: true, name: true } },
            appliedMinQty: true,
            appliedPricingGroupId: true,
            appliedGroupQuantity: true,
            unitPrice: true,
            subtotal: true,
            autoEstimatedReadyAt: true,
            manualReadyAt: true,
            estimatedReadyAt: true,
            productionScheduleStatus: true,
            productionScheduleSource: true,
            productionScheduleMessage: true,
            productionStep: true,
            currentStepOrder: true,
            isReady: true,
            isCustomProduct: true,
            customProductName: true,
            customUnitType: true,
            customUnitPrice: true,
            createdAt: true,
            updatedAt: true,
            options: {
              select: {
                id: true,
                optionId: true,
                name: true,
                priceDelta: true,
                quantity: true,
                chargeType: true,
                subtotal: true,
              },
            },
          },
        },
      },
    });

    if (!order) return res.status(404).json({ error: "Pedido no encontrado" });

    const accessibleBranchIds = await getAccessibleBranchIdsForUser(authUser);
    if (!canAccessOrderByBranches(authUser.role, accessibleBranchIds, order.branchId, order.pickupBranchId)) {
      return res.status(403).json({ error: "No autorizado para ver este pedido" });
    }

    res.json({ order });
  } catch (e: any) {
    console.error("Error obteniendo detalles del pedido:", e);
    res.status(400).json({ error: e?.message ?? "Error obteniendo detalles del pedido" });
  }
}

export async function listOrderItemManualReadyTimes(req: AuthedRequest, res: Response) {
  try {
    const orderItemId = parseId(req.params.id);
    const date = typeof req.query.date === "string" ? req.query.date : "";
    const authUser = req.auth;

    if (!authUser) return res.status(401).json({ error: "No autorizado" });
    if (!orderItemId) return res.status(400).json({ error: "id inválido" });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: "Fecha inválida" });

    const item = await prisma.orderItem.findUnique({
      where: { id: orderItemId },
      select: {
        order: { select: { branchId: true, pickupBranchId: true } },
      },
    });

    if (!item) return res.status(404).json({ error: "Item no encontrado" });

    const accessibleBranchIds = await getAccessibleBranchIdsForUser(authUser);
    if (!canAccessOrderByBranches(authUser.role, accessibleBranchIds, item.order.branchId, item.order.pickupBranchId)) {
      return res.status(403).json({ error: "No autorizado para ver este pedido" });
    }

    const times = await getAvailableManualReadyTimes(orderItemId, date);
    res.json({ times });
  } catch (e: any) {
    console.error("Error listando horarios manuales:", e);
    res.status(400).json({ error: e?.message ?? "Error listando horarios manuales" });
  }
}

export async function listOrders(req: AuthedRequest, res: Response) {
  try {
    const authUser = req.auth;
    if (!authUser) return res.status(401).json({ error: "No autorizado" });

    const { stage, dateFrom, dateTo, customerId, branchId, pickupBranchId } = req.query;

    const where: any = {};

    const accessibleBranchIds = await getAccessibleBranchIdsForUser(authUser);
    if (authUser.role !== "ADMIN") {
      if (accessibleBranchIds.length === 0) {
        return res.status(400).json({ error: "Usuario sin sucursal asignada" });
      }
      Object.assign(where, branchScopeWhere(accessibleBranchIds, "all"));
    }

    if (stage) where.stage = stage;

    if (customerId) {
      const id = parseInt(customerId as string, 10);
      if (!isNaN(id)) where.customerId = id;
    }

    if (branchId && authUser.role === "ADMIN") {
      const id = parseInt(branchId as string, 10);
      if (!isNaN(id)) where.branchId = id;
    }

    if (pickupBranchId && authUser.role === "ADMIN") {
      const id = parseInt(pickupBranchId as string, 10);
      if (!isNaN(id)) where.pickupBranchId = id;
    }

    if (dateFrom || dateTo) {
      where.deliveryDate = {};
      if (dateFrom) {
        const from = String(dateFrom);
        if (!isValidDateKey(from)) throw new Error("dateFrom inválido");
        where.deliveryDate.gte = startOfBusinessDayUtc(from);
      }
      if (dateTo) {
        const to = String(dateTo);
        if (!isValidDateKey(to)) throw new Error("dateTo inválido");
        where.deliveryDate.lt = nextBusinessDayStartUtc(to);
      }
    }

    const orders = await prisma.order.findMany({
      where,
      orderBy: [{ deliveryDate: "desc" }, { id: "asc" }],
      include: {
        customer: { select: { id: true, name: true, phone: true } },
        branch: { select: { id: true, name: true } },
        pickupBranch: { select: { id: true, name: true } },
        payments: { orderBy: { id: "asc" } },
        items: {
          select: {
            id: true,
            quantity: true,
            autoEstimatedReadyAt: true,
            manualReadyAt: true,
            estimatedReadyAt: true,
            productionScheduleStatus: true,
            productionScheduleSource: true,
            productionScheduleMessage: true,
            isReady: true,
            unitPrice: true,
            subtotal: true,
            isCustomProduct: true,
            customProductName: true,
            customUnitType: true,
            customUnitPrice: true,
            product: { select: { name: true } },
            variantRef: { select: { name: true } },
          },
        },
      },
    });

    res.json({ orders });
  } catch (e: any) {
    console.error("Error listando pedidos:", e);
    res.status(400).json({ error: e?.message ?? "Error listando pedidos" });
  }
}

export async function updateOrder(req: AuthedRequest, res: Response) {
  try {
    const orderId = parseId(req.params.id);
    const authUser = req.auth;
    const updates = req.body;

    if (!authUser) return res.status(401).json({ error: "No autorizado" });
    if (!orderId) return res.status(400).json({ error: "id inválido" });

    const existingOrder = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: {
          include: {
            product: {
              include: {
                pricingGroup: { select: { id: true, name: true, isActive: true } },
              },
            },
            options: true,
            variantRef: true,
          },
        },
      },
    });

    if (!existingOrder) {
      return res.status(404).json({ error: "Pedido no encontrado" });
    }

    const accessibleBranchIds = await getAccessibleBranchIdsForUser(authUser);
    if (
      !canAccessOrderByBranches(
        authUser.role,
        accessibleBranchIds,
        existingOrder.branchId,
        existingOrder.pickupBranchId
      )
    ) {
      return res.status(403).json({ error: "No autorizado para actualizar este pedido" });
    }

    if (existingOrder.stage === OrderStage.DELIVERED) {
      return res.status(400).json({ error: "No se puede actualizar un pedido entregado" });
    }

    let customProductTemplateIdForUpdate: number | null = null;
    if (Array.isArray(updates.items)) {
      const existingItemsById = new Map(existingOrder.items.map((item) => [item.id, item]));

      for (const itemUpdate of updates.items) {
        const existingItem = existingItemsById.get(Number(itemUpdate?.id));
        if (!existingItem) continue;

        const requiresAvailability = customProductUpdateRequiresAvailability(
          existingItem,
          itemUpdate
        );
        if (!requiresAvailability) continue;

        if (customProductTemplateIdForUpdate === null) {
          const template = await resolveEnabledCustomProductTemplate(
            prisma,
            existingOrder.branchId
          );
          customProductTemplateIdForUpdate = template.id;
        }

        resolveCustomProductIdForPersistence(
          Number(itemUpdate.productId ?? existingItem.productId),
          customProductTemplateIdForUpdate
        );
        assertCustomUnitType(itemUpdate.customUnitType ?? existingItem.customUnitType);
      }
    }

    const manualReadyAtUpdates = Array.isArray(updates.items)
      ? updates.items
          .filter((item: any) => Object.prototype.hasOwnProperty.call(item, "manualReadyAt"))
          .map((item: any) => ({
            itemId: Number(item.id),
            manualReadyAt: parseNullableDateTime(item.manualReadyAt),
          }))
          .filter((item: { itemId: number; manualReadyAt: Date | null }) =>
            Number.isFinite(item.itemId) && !!item.manualReadyAt
          ) as Array<{ itemId: number; manualReadyAt: Date }>
      : [];

    const existingOrderItemIds = new Set(existingOrder.items.map((item) => item.id));
    if (manualReadyAtUpdates.some((item) => !existingOrderItemIds.has(item.itemId))) {
      return res.status(400).json({ error: "Item no pertenece al pedido" });
    }

    for (const manualUpdate of manualReadyAtUpdates) {
      const availableTimes = await getAvailableManualReadyTimes(
        manualUpdate.itemId,
        dateInputFromDate(manualUpdate.manualReadyAt)
      );

      if (!availableTimes.includes(timeInputFromDate(manualUpdate.manualReadyAt))) {
        return res.status(400).json({
          error: "No existe una ventana de producción configurada para esa fecha y hora. Configura una ventana o elige una hora de salida existente.",
        });
      }
    }

    const nextDeliveryDate = updates.deliveryDate
      ? parseLocalDateOnly(updates.deliveryDate)
      : existingOrder.deliveryDate;
    const nextDeliveryTime = updates.deliveryTime !== undefined
      ? normalizeDeliveryTime(updates.deliveryTime)
      : existingOrder.deliveryTime ?? null;
    const deliveryDateChanged = updates.deliveryDate !== undefined &&
      dateInputFromDate(nextDeliveryDate) !== dateInputFromDate(existingOrder.deliveryDate);
    const deliveryTimeChanged = updates.deliveryTime !== undefined &&
      nextDeliveryTime !== (existingOrder.deliveryTime ?? null);
    const deliveryWasChanged = deliveryDateChanged || deliveryTimeChanged;

    if (deliveryWasChanged && authUser.role !== "ADMIN") {
      return res.status(403).json({ error: "Solo administradores pueden modificar la fecha de entrega" });
    }

    const nextFinalReadyAt = deliveryReadyAtFromParts(nextDeliveryDate, nextDeliveryTime);
    const scheduleSourceForUpdate: DeliveryScheduleSourceInput = deliveryWasChanged
      ? "MANUAL"
      : existingOrder.productionScheduleSource === "MANUAL"
        ? "MANUAL"
        : "AUTO";

    const orderUpdateData: any = {};

    if (updates.deliveryDate) {
      orderUpdateData.deliveryDate = nextDeliveryDate;
    }

    if (updates.deliveryTime !== undefined) {
      orderUpdateData.deliveryTime = nextDeliveryTime;
    }

    if (updates.deliveryDate || updates.deliveryTime !== undefined) {
      orderUpdateData.autoEstimatedReadyAt = scheduleSourceForUpdate === "AUTO" ? nextFinalReadyAt : null;
      orderUpdateData.manualReadyAt = scheduleSourceForUpdate === "MANUAL" ? nextFinalReadyAt : null;
      orderUpdateData.estimatedReadyAt = nextFinalReadyAt;
      orderUpdateData.productionScheduleSource = scheduleSourceForUpdate;
    }

    if (updates.notes !== undefined) {
      orderUpdateData.notes = updates.notes;
    }

    const requestedPaymentMethod = updates.paymentMethod as PaymentMethod | undefined;

    const nextStage: OrderStage = updates.stage ?? existingOrder.stage;

    const nextShippingType: ShippingType =
      updates.shippingType ?? existingOrder.shippingType;

    let nextShippingStage = existingOrder.shippingStage ?? null;

    if (nextShippingType === ShippingType.PICKUP) {
      nextShippingStage = null;
    } else {
      if (updates.shippingStage !== undefined) {
        nextShippingStage = updates.shippingStage;
      } else {
        if (
          existingOrder.shippingType !== ShippingType.DELIVERY ||
          existingOrder.shippingStage === "RECEIVED"
        ) {
          nextShippingStage = "SHIPPED";
        } else {
          nextShippingStage = existingOrder.shippingStage ?? "SHIPPED";
        }
      }
    }

    orderUpdateData.shippingType = nextShippingType;
    orderUpdateData.shippingStage = nextShippingStage;

    orderUpdateData.stage = nextStage;

    if (nextStage === OrderStage.DELIVERED) {
      orderUpdateData.deliveredAt = existingOrder.deliveredAt ?? new Date();
    } else {
      orderUpdateData.deliveredAt = null;
    }

    const nextHasIva =
      updates.hasIva !== undefined
        ? updates.hasIva === true
        : existingOrder.hasIva === true;

    if (!updates.items || updates.items.length === 0) {
      const result = await prisma.$transaction(
        async (tx) => {
          await tx.order.update({
            where: { id: orderId },
            data: orderUpdateData,
          });

          const currentItems = await tx.orderItem.findMany({
            where: { orderId },
            select: { subtotal: true },
          });

          const subtotalBeforeTax = currentItems.reduce(
            (sum, item) => sum.add(item.subtotal),
            new Prisma.Decimal(0)
          );

          const ivaAmount = nextHasIva
            ? subtotalBeforeTax.mul(new Prisma.Decimal("0.16"))
            : new Prisma.Decimal(0);

          const finalTotal = subtotalBeforeTax.add(ivaAmount);

          const normalizedPayments = normalizePaymentsOrThrow({
            payments: updates.payments,
            fallbackMethod: requestedPaymentMethod ?? existingOrder.paymentMethod,
            expectedTotal: finalTotal,
          });

          await tx.order.update({
            where: { id: orderId },
            data: {
              paymentMethod: normalizedPayments[0].method,
              subtotalBeforeTax,
              hasIva: nextHasIva,
              ivaAmount,
              total: finalTotal,
            },
          });

          await tx.orderPayment.deleteMany({ where: { orderId } });
          await tx.orderPayment.createMany({
            data: normalizedPayments.map((p) => ({
              orderId,
              method: p.method,
              amount: p.amount,
              reference: p.reference,
            })),
          });

          return {
            success: true,
            subtotalBeforeTax: subtotalBeforeTax.toString(),
            hasIva: nextHasIva,
            ivaAmount: ivaAmount.toString(),
            total: finalTotal.toString(),
          };
        },
        {
          timeout: 15000,
          maxWait: 10000,
        }
      );

      const io = req.app.get("io");
      const events = orderEvents(io);

      if (nextStage === OrderStage.DELIVERED) {
        await cleanupOrderFilesForDeliveredOrder(orderId).catch((error) => {
          console.error("Error limpiando archivos al entregar pedido:", error?.message ?? error);
        });
      } else {
        await scheduleOrderProduction(orderId, {
          finalReadyAt: nextFinalReadyAt,
          deliveryScheduleSource: scheduleSourceForUpdate,
        });
        for (const manualUpdate of manualReadyAtUpdates) {
          await applyManualReadyAtToOrderItem(manualUpdate.itemId, manualUpdate.manualReadyAt);
        }
      }

      const updatedOrder = await prisma.order.findUnique({
        where: { id: orderId },
        include: {
          customer: { select: { id: true, name: true, phone: true } },
          branch: { select: { id: true, name: true } },
          pickupBranch: { select: { id: true, name: true } },
          payments: { orderBy: { id: "asc" } },
          creator: { select: { id: true, name: true, username: true, role: true } },
          items: {
            select: {
              id: true,
              quantity: true,
              isReady: true,
              currentStepOrder: true,
              autoEstimatedReadyAt: true,
              manualReadyAt: true,
              estimatedReadyAt: true,
              productionScheduleStatus: true,
              productionScheduleSource: true,
              productionScheduleMessage: true,
              unitPrice: true,
              subtotal: true,
              product: { select: { id: true, name: true, unitType: true } },
              isCustomProduct: true,
              customProductName: true,
              customUnitType: true,
              customUnitPrice: true,
              variantRef: { select: { id: true, name: true } },
              steps: {
                select: { order: true, name: true, status: true },
                orderBy: { order: "asc" },
              },
              options: {
                select: {
                  id: true,
                  name: true,
                  priceDelta: true,
                  quantity: true,
                  chargeType: true,
                  subtotal: true,
                },
              },
            },
          },
        },
      });

      if (updatedOrder) {
        events.orderUpdated(updatedOrder);
      }

      return res.json(result);
    }

    const affectedProductIds = Array.from(
      new Set([
        ...existingOrder.items.map((i) => i.productId),
        ...((updates.items ?? [])
          .map((i: any) => Number(i.productId))
          .filter((id: number) => Number.isFinite(id))),
      ])
    );

    const branchProducts = await prisma.branchProduct.findMany({
      where: {
        branchId: existingOrder.branchId,
        productId: { in: affectedProductIds },
      },
      include: {
        product: {
          select: {
            id: true,
            name: true,
            unitType: true,
            needsVariant: true,
            minQty: true,
            qtyStep: true,
            isCustomProductTemplate: true,
            pricingGroup: {
              select: { id: true, name: true, isActive: true },
            },
            variants: { select: { id: true, isActive: true } },
          },
        },
        quantityPrices: {
          where: { isActive: true },
          orderBy: { minQty: "asc" },
        },
        variantPrices: {
          where: { isActive: true },
          orderBy: { variantId: "asc" },
        },
        variantQuantityPrices: {
          where: { isActive: true },
          orderBy: [{ variantId: "asc" }, { minQty: "asc" }],
        },
        paramPrices: {
          where: { isActive: true },
          orderBy: { paramId: "asc" },
          include: {
            param: {
              select: {
                id: true,
                name: true,
                chargeType: true,
                isActive: true,
              },
            },
          },
        },
      },
    });

    const bpMap = new Map(branchProducts.map((bp) => [bp.productId, bp]));

    const finalItemsMap = new Map<number, any>();

    for (const item of existingOrder.items) {
      finalItemsMap.set(item.id, {
        id: item.id,
        productId: item.productId,
        quantity: item.quantity.toNumber(),
        variantId: item.variantId,
        options: item.options,
        selectedParams: item.options.map((opt: any) => ({
          paramId: opt.optionId,
          chargeType: opt.chargeType,
          pieceQty: Number(opt.quantity ?? 1),
        })),
        isReady: item.isReady,
        currentStepOrder: item.currentStepOrder,
        isCustomProduct: item.isCustomProduct,
        customProductName: item.customProductName ?? undefined,
        customUnitType: item.customUnitType ?? undefined,
        customUnitPrice: item.customUnitPrice ?? undefined,
        unitPrice: item.unitPrice,
        subtotal: item.subtotal,
        appliedMinQty: item.appliedMinQty,
        appliedPricingGroupId: item.appliedPricingGroupId,
        appliedGroupQuantity: item.appliedGroupQuantity,
      });
    }

    for (const itemUpdate of updates.items) {
      const existingItem = finalItemsMap.get(itemUpdate.id);
      if (!existingItem) continue;

      if (
        itemUpdate.productId !== undefined &&
        Number(itemUpdate.productId) !== existingItem.productId
      ) {
        throw new Error("La edición de pedidos no permite cambiar el producto de un item");
      }

      finalItemsMap.set(itemUpdate.id, {
        ...existingItem,
        productId: existingItem.productId,
        quantity:
          itemUpdate.quantity !== undefined
            ? typeof itemUpdate.quantity === "string"
              ? parseFloat(itemUpdate.quantity)
              : itemUpdate.quantity
            : existingItem.quantity,
        variantId:
          itemUpdate.variantId !== undefined
            ? itemUpdate.variantId
            : existingItem.variantId,
        selectedParams:
          itemUpdate.selectedParams !== undefined
            ? itemUpdate.selectedParams
            : existingItem.selectedParams,
        isReady:
          itemUpdate.isReady !== undefined
            ? itemUpdate.isReady
            : existingItem.isReady,
        currentStepOrder:
          itemUpdate.currentStepOrder !== undefined
            ? itemUpdate.currentStepOrder
            : existingItem.currentStepOrder,
        isCustomProduct:
          itemUpdate.isCustomProduct !== undefined
            ? itemUpdate.isCustomProduct
            : existingItem.isCustomProduct,
        customProductName:
          itemUpdate.customProductName !== undefined
            ? itemUpdate.customProductName
            : existingItem.customProductName,
        customUnitType:
          itemUpdate.customUnitType !== undefined
            ? itemUpdate.customUnitType
            : existingItem.customUnitType,
        customUnitPrice:
          itemUpdate.customUnitPrice !== undefined
            ? itemUpdate.customUnitPrice
            : existingItem.customUnitPrice,
      });
    }

    const groupPricingContext = buildGroupPricingContext(
      Array.from(finalItemsMap.values()).map((item) => ({
        productId: item.productId,
        quantity: new Prisma.Decimal(String(item.quantity)),
        isCustomProduct: item.isCustomProduct === true,
        pricingGroup: bpMap.get(item.productId)?.product.pricingGroup ?? null,
      }))
    );

    const directlyChangedItemIds = new Set<number>();
    const existingItemsById = new Map(existingOrder.items.map((item) => [item.id, item]));

    for (const itemUpdate of updates.items) {
      const existingItem = existingItemsById.get(Number(itemUpdate.id));
      if (!existingItem) continue;

      const quantityChanged = itemUpdate.quantity !== undefined &&
        !new Prisma.Decimal(String(itemUpdate.quantity)).equals(existingItem.quantity);
      const variantChanged = itemUpdate.variantId !== undefined &&
        (itemUpdate.variantId ?? null) !== (existingItem.variantId ?? null);
      const paramsChanged = itemUpdate.selectedParams !== undefined;
      const customCommercialChanged = existingItem.isCustomProduct && (
        itemUpdate.customProductName !== undefined ||
        itemUpdate.customUnitType !== undefined ||
        itemUpdate.customUnitPrice !== undefined
      );

      if (!quantityChanged && !variantChanged && !paramsChanged && !customCommercialChanged) {
        continue;
      }

      directlyChangedItemIds.add(existingItem.id);
    }

    const { repricedItemIds } = buildPricingGroupRepricePlan({
      beforeItems: existingOrder.items.map((item) => ({
        id: item.id,
        pricingGroupId: item.product.pricingGroup?.isActive
          ? item.product.pricingGroup.id
          : null,
        appliedPricingGroupId: item.appliedPricingGroupId,
      })),
      afterItems: Array.from(finalItemsMap.values()).map((item) => {
        const group = bpMap.get(item.productId)?.product.pricingGroup;
        return {
          id: item.id,
          pricingGroupId: group?.isActive ? group.id : null,
        };
      }),
      directlyChangedItemIds,
    });

    const computedItems: Array<{
      itemId: number;
      productId: number;
      qty: Prisma.Decimal;
      variantId: number | null;
      unitPrice: Prisma.Decimal;
      subtotal: Prisma.Decimal;
      appliedMinQty: Prisma.Decimal | null;
      appliedPricingGroupId: number | null;
      appliedGroupQuantity: Prisma.Decimal | null;
      isReady: boolean;
      currentStepOrder: number;
      selectedParams: Array<{
        paramId: number;
        chargeType: "PER_METER" | "PER_PIECE";
        pieceQty: number;
      }>;
      isCustomProduct: boolean;
      customProductName?: string;
      customUnitType?: string;
      customUnitPrice?: Prisma.Decimal;
      shouldReprice: boolean;
    }> = [];

    let subtotalBeforeTax = new Prisma.Decimal(0);

    const customProductTemplateId = customProductTemplateIdForUpdate;

    for (const [itemId, finalItem] of finalItemsMap) {
      const qty = new Prisma.Decimal(finalItem.quantity.toString());
      const shouldReprice = repricedItemIds.has(itemId);

      if (!shouldReprice) {
        computedItems.push({
          itemId,
          productId: finalItem.productId,
          qty,
          variantId: finalItem.variantId ?? null,
          unitPrice: finalItem.unitPrice,
          subtotal: finalItem.subtotal,
          appliedMinQty: finalItem.appliedMinQty,
          appliedPricingGroupId: finalItem.appliedPricingGroupId,
          appliedGroupQuantity: finalItem.appliedGroupQuantity,
          isReady: finalItem.isReady,
          currentStepOrder: finalItem.currentStepOrder,
          selectedParams: finalItem.selectedParams,
          isCustomProduct: finalItem.isCustomProduct,
          customProductName: finalItem.customProductName,
          customUnitType: finalItem.customUnitType,
          customUnitPrice: finalItem.customUnitPrice,
          shouldReprice: false,
        });
        subtotalBeforeTax = subtotalBeforeTax.add(finalItem.subtotal);
        continue;
      }

      if (finalItem.isCustomProduct) {
        if (!finalItem.customProductName || !finalItem.customProductName.trim()) {
          throw new Error("El nombre del producto libre es requerido");
        }

        const customUnitPrice = new Prisma.Decimal(
          typeof finalItem.customUnitPrice === "string"
            ? finalItem.customUnitPrice
            : String(finalItem.customUnitPrice ?? 0)
        );

        if (customUnitPrice.lte(0)) {
          throw new Error(`El precio para "${finalItem.customProductName}" debe ser mayor a 0`);
        }

        if (qty.lte(0)) {
          throw new Error(`La cantidad para "${finalItem.customProductName}" debe ser mayor a 0`);
        }

        const subtotal = customUnitPrice.mul(qty);
        subtotalBeforeTax = subtotalBeforeTax.add(subtotal);
        const persistedProductId = customProductTemplateId ?? Number(finalItem.productId);

        computedItems.push({
          itemId,
          productId: persistedProductId,
          qty,
          variantId: null,
          unitPrice: customUnitPrice,
          subtotal,
          appliedMinQty: null,
          appliedPricingGroupId: null,
          appliedGroupQuantity: null,
          isReady: finalItem.isReady,
          currentStepOrder: 0,
          selectedParams: [],
          isCustomProduct: true,
          customProductName: finalItem.customProductName.trim(),
          customUnitType: finalItem.customUnitType,
          customUnitPrice: customUnitPrice,
          shouldReprice: true,
        });

        continue;
      }

      const bp = bpMap.get(finalItem.productId);

      if (!bp) {
        throw new Error(`No se encontró configuración de precio para el producto ${finalItem.productId}`);
      }

      if (bp.product.isCustomProductTemplate) {
        assertTemplateIsNotNormalProduct(finalItem.productId, finalItem.productId);
      }

      if (qty.lte(0)) {
        throw new Error(`La cantidad para "${bp.product.name}" debe ser mayor a 0`);
      }

      const variantId = validateVariantSelection({
        productName: bp.product.name,
        needsVariant: bp.product.needsVariant,
        variants: bp.product.variants,
        variantId: finalItem.variantId ?? null,
        requireActive:
          (finalItem.variantId ?? null) !==
          (existingItemsById.get(itemId)?.variantId ?? null),
      });

      const isHalfSpecial =
        bp.product.unitType === "METER" &&
        bp.halfStepSpecialPrice &&
        bp.halfStepSpecialPrice.gt(0) &&
        qty.equals(new Prisma.Decimal("0.5"));

      if (!isHalfSpecial && bp.product.minQty && qty.lt(bp.product.minQty)) {
        throw new Error(`Cantidad mínima para "${bp.product.name}" es ${bp.product.minQty}`);
      }

      const selectedParams = normalizeSelectedParams(
        finalItem.selectedParams,
        finalItem.options?.map((opt: any) => opt.optionId || opt.id) || [],
        bp
      );
      const pricingContext = pricingQuantityForItem({
        productId: finalItem.productId,
        quantity: qty,
        pricingGroup: bp.product.pricingGroup,
      }, groupPricingContext);
      const priceResult = calculateBranchProductItemPrice({
        bp,
        variantId,
        quantity: qty,
        pricingQuantity: pricingContext.pricingQuantity,
        selectedParams,
        halfStepSpecialPrice: bp.halfStepSpecialPrice,
        productUnitType: bp.product.unitType,
      });
      const groupMetadata = appliedGroupMetadata({
        pricingGroupId: pricingContext.pricingGroupId,
        groupQuantity: pricingContext.groupQuantity,
        appliedMinQty: priceResult.appliedMinQty,
      });

      subtotalBeforeTax = subtotalBeforeTax.add(priceResult.subtotal);

      computedItems.push({
        itemId,
        productId: finalItem.productId,
        qty,
        variantId,
        unitPrice: priceResult.unitPrice,
        subtotal: priceResult.subtotal,
        appliedMinQty: priceResult.appliedMinQty,
        ...groupMetadata,
        isReady: finalItem.isReady,
        currentStepOrder: finalItem.currentStepOrder,
        selectedParams,
        isCustomProduct: false,
        shouldReprice: true,
      });
    }

    const result = await prisma.$transaction(
      async (tx) => {
        const ivaAmount = nextHasIva
          ? subtotalBeforeTax.mul(new Prisma.Decimal("0.16"))
          : new Prisma.Decimal(0);

        const finalTotal = subtotalBeforeTax.add(ivaAmount);
        const normalizedPayments = normalizePaymentsOrThrow({
          payments: updates.payments,
          fallbackMethod: requestedPaymentMethod ?? existingOrder.paymentMethod,
          expectedTotal: finalTotal,
        });

        await tx.order.update({
          where: { id: orderId },
          data: {
            ...orderUpdateData,
            paymentMethod: normalizedPayments[0].method,
            subtotalBeforeTax,
            hasIva: nextHasIva,
            ivaAmount,
            total: finalTotal,
          },
        });

        await tx.orderPayment.deleteMany({ where: { orderId } });
        await tx.orderPayment.createMany({
          data: normalizedPayments.map((p) => ({
            orderId,
            method: p.method,
            amount: p.amount,
            reference: p.reference,
          })),
        });

        for (const item of computedItems) {
          if (!item.shouldReprice) {
            await tx.orderItem.update({
              where: { id: item.itemId },
              data: {
                isReady: item.isReady,
                currentStepOrder: item.currentStepOrder,
              },
            });
            continue;
          }

          const updateData: any = {
            productId: item.productId,
            quantity: item.qty,
            variantId: item.variantId,
            unitPrice: item.unitPrice,
            subtotal: item.subtotal,
            appliedMinQty: item.appliedMinQty,
            appliedPricingGroupId: item.appliedPricingGroupId,
            appliedGroupQuantity: item.appliedGroupQuantity,
            isReady: item.isReady,
            currentStepOrder: item.currentStepOrder,
          };

          if (item.isCustomProduct) {
            updateData.isCustomProduct = true;
            updateData.customProductName = item.customProductName;
            updateData.customUnitType = item.customUnitType as "METER" | "PIECE";
            updateData.customUnitPrice = item.customUnitPrice;
            updateData.productionStep = "CUSTOM";
          }

          await tx.orderItem.update({
            where: { id: item.itemId },
            data: updateData,
          });

          await tx.orderItemOption.deleteMany({
            where: { orderItemId: item.itemId },
          });

          if (item.isCustomProduct) continue;

          const bp = bpMap.get(item.productId);

          if (bp && item.selectedParams.length > 0) {
            const paramsById = new Map<number, any>();

            for (const pp of bp.paramPrices ?? []) {
              if (pp?.param) paramsById.set(pp.paramId, pp);
            }

            for (const selected of item.selectedParams) {
              const meta = paramsById.get(selected.paramId);
              if (!meta?.param) continue;

              const priceDelta = meta.priceDelta
                ? new Prisma.Decimal(meta.priceDelta)
                : new Prisma.Decimal(0);

              const quantity =
                selected.chargeType === "PER_PIECE"
                  ? new Prisma.Decimal(selected.pieceQty)
                  : new Prisma.Decimal(1);

              const optionSubtotal =
                selected.chargeType === "PER_PIECE"
                  ? priceDelta.mul(quantity)
                  : priceDelta.mul(item.qty);

              await tx.orderItemOption.create({
                data: {
                  orderItemId: item.itemId,
                  optionId: selected.paramId,
                  name: meta.param.name,
                  priceDelta,
                  quantity,
                  chargeType:
                    selected.chargeType === "PER_PIECE"
                      ? ParamChargeType.PER_PIECE
                      : ParamChargeType.PER_METER,
                  subtotal: optionSubtotal,
                },
              });
            }
          }
        }

        return {
          success: true,
          subtotalBeforeTax: subtotalBeforeTax.toString(),
          hasIva: nextHasIva,
          ivaAmount: ivaAmount.toString(),
          total: finalTotal.toString(),
        };
      },
      {
        timeout: 15000,
        maxWait: 10000,
      }
    );

    const io = req.app.get("io");
    const events = orderEvents(io);

    if (nextStage === OrderStage.DELIVERED) {
      await cleanupOrderFilesForDeliveredOrder(orderId).catch((error) => {
        console.error("Error limpiando archivos al entregar pedido:", error?.message ?? error);
      });
    } else {
      await scheduleOrderProduction(orderId, {
        finalReadyAt: nextFinalReadyAt,
        deliveryScheduleSource: scheduleSourceForUpdate,
      });
      for (const manualUpdate of manualReadyAtUpdates) {
        await applyManualReadyAtToOrderItem(manualUpdate.itemId, manualUpdate.manualReadyAt);
      }
    }

    const updatedOrder = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        customer: { select: { id: true, name: true, phone: true } },
        branch: { select: { id: true, name: true } },
        pickupBranch: { select: { id: true, name: true } },
        payments: { orderBy: { id: "asc" } },
        creator: { select: { id: true, name: true, username: true, role: true } },
        items: {
          select: {
            id: true,
            quantity: true,
            autoEstimatedReadyAt: true,
            manualReadyAt: true,
            estimatedReadyAt: true,
            productionScheduleStatus: true,
            productionScheduleSource: true,
            productionScheduleMessage: true,
            isReady: true,
            currentStepOrder: true,
            unitPrice: true,
            subtotal: true,
            product: { select: { id: true, name: true, unitType: true } },
            isCustomProduct: true,
            customProductName: true,
            customUnitType: true,
            customUnitPrice: true,
            variantRef: { select: { id: true, name: true } },
            steps: {
              select: { order: true, name: true, status: true },
              orderBy: { order: "asc" },
            },
            options: {
              select: {
                id: true,
                name: true,
                priceDelta: true,
                quantity: true,
                chargeType: true,
                subtotal: true,
              },
            },
          },
        },
      },
    });

    if (updatedOrder) {
      events.orderUpdated(updatedOrder);
    }

    res.json(result);
  } catch (e: any) {
    console.error("Error actualizando pedido:", e);
    res.status(400).json({ error: e?.message ?? "Error actualizando pedido" });
  }
}

export async function cancelOrder(req: AuthedRequest, res: Response) {
  try {
    const orderId = parseId(req.params.id);
    const authUser = req.auth;

    if (!authUser) return res.status(401).json({ error: "No autorizado" });
    if (!orderId) return res.status(400).json({ error: "id inválido" });

    const existingOrder = await prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, branchId: true, pickupBranchId: true, stage: true, notes: true },
    });

    if (!existingOrder) return res.status(404).json({ error: "Pedido no encontrado" });

    const accessibleBranchIds = await getAccessibleBranchIdsForUser(authUser);
    if (authUser.role !== "ADMIN" && !accessibleBranchIds.includes(existingOrder.branchId)) {
      return res.status(403).json({ error: "No autorizado para cancelar este pedido" });
    }

    if (existingOrder.stage === OrderStage.DELIVERED) {
      return res.status(400).json({ error: "No se puede cancelar un pedido entregado" });
    }

    const cancellationDate = formatBusinessDateTime(new Date()).slice(0, 10);
    const canceledOrder = await prisma.$transaction(async (tx) => {
      await lockOrderProductionScheduling(tx, orderId);
      await releaseOrderProductionReservations(tx, orderId);
      return tx.order.update({
        where: { id: orderId },
        data: {
          stage: OrderStage.REGISTERED,
          notes: existingOrder.notes
            ? `${existingOrder.notes}\n[Cancelado el ${cancellationDate}]`
            : `[Cancelado el ${cancellationDate}]`,
        },
      });
    });

    res.json({ order: canceledOrder });
  } catch (e: any) {
    console.error("Error cancelando pedido:", e);
    res.status(400).json({ error: e?.message ?? "Error cancelando pedido" });
  }
}

export async function deleteOrder(req: AuthedRequest, res: Response) {
  try {
    const orderId = parseId(req.params.id);
    const authUser = req.auth;

    if (!authUser) return res.status(401).json({ error: "No autorizado" });
    if (authUser.role !== "ADMIN") {
      return res.status(403).json({ error: "Solo administradores pueden eliminar órdenes" });
    }
    if (!orderId) return res.status(400).json({ error: "id inválido" });

    const existingOrder = await prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, branchId: true, pickupBranchId: true },
    });

    if (!existingOrder) return res.status(404).json({ error: "Pedido no encontrado" });

    await prisma.$transaction(async (tx) => {
      await lockOrderProductionScheduling(tx, orderId);
      await releaseOrderProductionReservations(tx, orderId);
      await tx.order.delete({
        where: { id: orderId },
      });
    });

    const io = req.app.get("io");
    const events = orderEvents(io);
    events.orderDeleted(orderId, existingOrder.branchId, existingOrder.pickupBranchId || undefined);

    res.json({ success: true, message: "Pedido eliminado permanentemente" });
  } catch (e: any) {
    console.error("Error eliminando pedido:", e);
    res.status(400).json({ error: e?.message ?? "Error eliminando pedido" });
  }
}

export async function createOrder(req: AuthedRequest, res: Response) {
  try {
    const body = req.body as {
      branchId: number;
      customerId: number;
      pickupBranchId?: number;
      shippingType: ShippingType;
      paymentMethod: PaymentMethod;
      payments?: PaymentInput[];
      deliveryDate: string;
      deliveryTime?: string | null;
      deliveryScheduleSource?: DeliveryScheduleSourceInput;
      notes?: string | null;
      hasIva?: boolean;
      items: CreateOrderItemInput[];
    };

    const authUser = req.auth;

    if (!authUser) {
      return res.status(401).json({ error: "No autorizado" });
    }

    let registerBranchId: number;

    if (authUser.role === "ADMIN") {
      if (body.branchId) {
        registerBranchId = body.branchId;
      } else if (authUser.branchId) {
        registerBranchId = authUser.branchId;
      } else {
        const defaultBranch = await prisma.branch.findFirst({
          where: { isActive: true },
          select: { id: true },
        });

        if (!defaultBranch) {
          return res.status(400).json({ error: "No hay sucursales activas disponibles" });
        }

        registerBranchId = defaultBranch.id;
      }
    } else {
      if (!authUser.branchId) {
        return res.status(400).json({
          error: "No tienes una sucursal asignada. Contacta al administrador.",
        });
      }

      registerBranchId = authUser.branchId;
    }

    const pickupBranchId = body.pickupBranchId || registerBranchId;
    const commercialDelivery = normalizeCreateOrderCommercialDelivery(body, authUser.role);
    const parsedDeliveryDate = commercialDelivery.deliveryDate;
    const normalizedDeliveryTime = commercialDelivery.deliveryTime;
    const finalReadyAt = commercialDelivery.finalReadyAt;
    const deliveryScheduleSource = createOrderOperationalScheduleSource(body.deliveryScheduleSource);

    if (!body?.customerId) {
      return res.status(400).json({ error: "customerId es requerido" });
    }

    if (!body.items?.length) {
      return res.status(400).json({ error: "Debe agregar al menos un producto" });
    }

    const result = await prisma.$transaction(async (tx) => {
      let customProductTemplateId: number | null = null;
      let allItemsReady = true;

      const customer = await tx.customer.findUnique({
        where: { id: body.customerId },
        select: { id: true, name: true },
      });

      const pickupBranch = await tx.branch.findUnique({
        where: { id: pickupBranchId },
        select: { id: true, name: true, isActive: true },
      });

      const registerBranch = await tx.branch.findUnique({
        where: { id: registerBranchId },
        select: { id: true, name: true, isActive: true },
      });

      if (!customer) throw new Error("Cliente no existe");

      if (!pickupBranch || !pickupBranch.isActive) {
        throw new Error("Sucursal de recolección no existe o está inactiva");
      }

      if (!registerBranch || !registerBranch.isActive) {
        throw new Error("Sucursal de registro no existe o está inactiva");
      }

      const customItems = body.items.filter((item) => item.isCustomProduct === true);
      if (customItems.length > 0) {
        const template = await resolveEnabledCustomProductTemplate(tx, registerBranchId);
        customProductTemplateId = template.id;

        for (const item of customItems) {
          resolveCustomProductIdForPersistence(Number(item.productId), template.id);
          assertCustomUnitType(item.customUnitType);
        }
      }

      const productIds = body.items.map((i) => i.productId);

      const branchProducts = await tx.branchProduct.findMany({
        where: {
          branchId: registerBranchId,
          productId: { in: productIds },
          isActive: true,
        },
        include: {
          product: {
            select: {
              id: true,
              name: true,
              unitType: true,
              needsVariant: true,
              minQty: true,
              qtyStep: true,
              halfStepSpecialPrice: true,
              isCustomProductTemplate: true,
              pricingGroup: {
                select: { id: true, name: true, isActive: true },
              },
              variants: { select: { id: true, isActive: true } },
            },
          },
          quantityPrices: {
            where: { isActive: true },
            orderBy: { minQty: "asc" },
          },
          variantPrices: {
            where: { isActive: true },
            orderBy: { variantId: "asc" },
          },
          variantQuantityPrices: {
            where: { isActive: true },
            orderBy: [{ variantId: "asc" }, { minQty: "asc" }],
          },
          paramPrices: {
            where: { isActive: true },
            orderBy: { paramId: "asc" },
            include: {
              param: {
                select: {
                  id: true,
                  name: true,
                  chargeType: true,
                  isActive: true,
                },
              },
            },
          },
        },
      });

      const bpMap = new Map<number, (typeof branchProducts)[number]>();

      for (const bp of branchProducts) {
        bpMap.set(bp.productId, bp);
      }

      for (const item of body.items) {
        if (item.isCustomProduct === true) continue;

        const configuredProduct = bpMap.get(item.productId);
        if (configuredProduct?.product.isCustomProductTemplate) {
          assertTemplateIsNotNormalProduct(item.productId, item.productId);
        }

        if (!bpMap.has(item.productId)) {
          const product = await tx.product.findUnique({
            where: { id: item.productId },
            select: { name: true, isCustomProductTemplate: true },
          });

          if (product?.isCustomProductTemplate) {
            assertTemplateIsNotNormalProduct(item.productId, item.productId);
          }

          throw new Error(
            `Producto "${product?.name || item.productId}" no disponible en esta sucursal`
          );
        }
      }

      const groupPricingContext = buildGroupPricingContext(
        body.items.map((item) => ({
          productId: item.productId,
          quantity: new Prisma.Decimal(String(item.quantity)),
          isCustomProduct: item.isCustomProduct === true,
          pricingGroup: bpMap.get(item.productId)?.product.pricingGroup ?? null,
        }))
      );

      const productSteps = await tx.productProcessStep.findMany({
        where: {
          productId: { in: productIds },
          isActive: true,
        },
        orderBy: [{ productId: "asc" }, { order: "asc" }],
      });

      const stepsByProductId = new Map<number, Array<{ name: string; order: number }>>();

      for (const s of productSteps) {
        const arr = stepsByProductId.get(s.productId) ?? [];
        arr.push({ name: s.name, order: s.order });
        stepsByProductId.set(s.productId, arr);
      }

      const order = await tx.order.create({
        data: {
          branchId: registerBranchId,
          pickupBranchId,
          customerId: body.customerId,
          createdBy: authUser.userId,
          stage: OrderStage.REGISTERED,
          shippingType: body.shippingType,
          paymentMethod: body.paymentMethod,
          shippingStage: body.shippingType === "DELIVERY" ? "SHIPPED" : null,
          deliveryDate: parsedDeliveryDate,
          deliveryTime: normalizedDeliveryTime,
          autoEstimatedReadyAt: deliveryScheduleSource === "AUTO" ? finalReadyAt : null,
          manualReadyAt: deliveryScheduleSource === "MANUAL" ? finalReadyAt : null,
          estimatedReadyAt: finalReadyAt,
          productionScheduleSource: deliveryScheduleSource,
          notes: body.notes ?? null,

          subtotalBeforeTax: new Prisma.Decimal("0"),
          hasIva: !!body.hasIva,
          ivaAmount: new Prisma.Decimal("0"),
          total: new Prisma.Decimal("0"),
        },
        select: { id: true },
      });

      let subtotalBeforeTax = new Prisma.Decimal("0");

      for (const it of body.items) {
        if (it.isCustomProduct === true) {
          if (customProductTemplateId === null) {
            throw new Error("No existe una configuración válida de Producto Libre.");
          }

          if (!it.customProductName || !it.customProductName.trim()) {
            throw new Error("El nombre del producto libre es requerido");
          }

          const customUnitPrice = new Prisma.Decimal(
            typeof it.customUnitPrice === "string"
              ? it.customUnitPrice
              : String(it.customUnitPrice ?? 0)
          );

          if (customUnitPrice.lte(0)) {
            throw new Error(`El precio para "${it.customProductName}" debe ser mayor a 0`);
          }

          const qty = new Prisma.Decimal(it.quantity.toString());
          if (qty.lte(0)) {
            throw new Error(`La cantidad para "${it.customProductName}" debe ser mayor a 0`);
          }

          assertCustomUnitType(it.customUnitType);
          const customUnitType = it.customUnitType;
          const subtotal = customUnitPrice.mul(qty);
          subtotalBeforeTax = subtotalBeforeTax.add(subtotal);

          await tx.orderItem.create({
            data: {
              orderId: order.id,
              productId: customProductTemplateId,
              productNameSnapshot: it.customProductName.trim(),
              unitTypeSnapshot: customUnitType,
              quantity: qty,
              variantId: null,
              unitPrice: customUnitPrice,
              subtotal,
              appliedMinQty: null,
              currentStepOrder: 0,
              isReady: true,
              productionStep: "CUSTOM",
              isCustomProduct: true,
              customProductName: it.customProductName.trim(),
              customUnitType,
              customUnitPrice,
            },
            select: { id: true },
          });

          continue;
        }

        const bp = bpMap.get(it.productId)!;
        const qty = new Prisma.Decimal(it.quantity.toString());

        if (qty.lte(0)) {
          throw new Error(`La cantidad para "${bp.product.name}" debe ser mayor a 0`);
        }

        const isHalfSpecial =
          bp.product.unitType === "METER" &&
          bp.halfStepSpecialPrice &&
          bp.halfStepSpecialPrice.gt(0) &&
          qty.equals(new Prisma.Decimal("0.5"));

        if (!isHalfSpecial && qty.lt(bp.product.minQty)) {
          throw new Error(`Cantidad mínima para "${bp.product.name}" es ${bp.product.minQty}`);
        }

        const variantId = validateVariantSelection({
          productName: bp.product.name,
          needsVariant: bp.product.needsVariant,
          variants: bp.product.variants,
          variantId: it.variantId ?? null,
          requireActive: true,
        });

        const selectedParams = normalizeSelectedParams(it.selectedParams, it.paramIds, bp);

        const pricingContext = pricingQuantityForItem({
          productId: it.productId,
          quantity: qty,
          pricingGroup: bp.product.pricingGroup,
        }, groupPricingContext);
        const priceResult = calculateBranchProductItemPrice({
          bp,
          variantId,
          quantity: qty,
          pricingQuantity: pricingContext.pricingQuantity,
          selectedParams,
          halfStepSpecialPrice: bp.halfStepSpecialPrice,
          productUnitType: bp.product.unitType,
        });
        const groupMetadata = appliedGroupMetadata({
          pricingGroupId: pricingContext.pricingGroupId,
          groupQuantity: pricingContext.groupQuantity,
          appliedMinQty: priceResult.appliedMinQty,
        });

        const subtotal = priceResult.subtotal;

        subtotalBeforeTax = subtotalBeforeTax.add(subtotal);

        const tmpl = stepsByProductId.get(it.productId);

        const steps =
          tmpl && tmpl.length > 0
            ? tmpl
            : [
              { name: "REGISTRADO", order: 1 },
              { name: "DISEÑO", order: 2 },
              { name: "IMPRESION", order: 3 },
              { name: "LISTO", order: 4 },
            ];

        const firstOrder = steps[0]?.order ?? 1;

        const createdItem = await tx.orderItem.create({
          data: {
            orderId: order.id,
            productId: it.productId,
            productNameSnapshot: bp.product.name,
            unitTypeSnapshot: bp.product.unitType,
            quantity: qty,
            variantId,
            unitPrice: priceResult.unitPrice,
            subtotal,
            appliedMinQty: priceResult.appliedMinQty,
            ...groupMetadata,
            currentStepOrder: firstOrder,
            isReady: false,
            productionStep: "AUTO",
          },
          select: { id: true },
        });

        allItemsReady = false;

        if (selectedParams.length > 0) {
          const paramsById = new Map<number, any>();

          for (const pp of bp.paramPrices ?? []) {
            if (pp?.param) {
              paramsById.set(pp.paramId, pp);
            }
          }

          for (const selected of selectedParams) {
            const meta = paramsById.get(selected.paramId);

            if (!meta?.param) continue;

            const priceDelta = meta.priceDelta
              ? new Prisma.Decimal(meta.priceDelta)
              : new Prisma.Decimal(0);

            const quantity =
              selected.chargeType === "PER_PIECE"
                ? new Prisma.Decimal(selected.pieceQty ?? 1)
                : new Prisma.Decimal(1);

            const optionSubtotal =
              selected.chargeType === "PER_PIECE"
                ? priceDelta.mul(quantity)
                : priceDelta.mul(qty);

            await tx.orderItemOption.create({
              data: {
                orderItemId: createdItem.id,
                optionId: selected.paramId,
                name: meta.param.name,
                priceDelta,
                quantity,
                chargeType:
                  selected.chargeType === "PER_PIECE"
                    ? ParamChargeType.PER_PIECE
                    : ParamChargeType.PER_METER,
                subtotal: optionSubtotal,
              },
            });
          }
        }

        for (const st of steps) {
          await tx.orderItemStep.create({
            data: {
              orderItemId: createdItem.id,
              name: st.name,
              order: st.order,
              status: "PENDING",
            },
          });
        }
      }

      const hasIva = !!body.hasIva;

      const ivaAmount = hasIva
        ? subtotalBeforeTax.mul(new Prisma.Decimal("0.16"))
        : new Prisma.Decimal("0");

      const finalTotal = subtotalBeforeTax.add(ivaAmount);
      const normalizedPayments = normalizePaymentsOrThrow({
        payments: body.payments,
        fallbackMethod: body.paymentMethod,
        expectedTotal: finalTotal,
      });

      await tx.order.update({
        where: { id: order.id },
        data: {
          paymentMethod: normalizedPayments[0].method,
          subtotalBeforeTax,
          hasIva,
          ivaAmount,
          total: finalTotal,
          stage: allItemsReady ? OrderStage.READY : OrderStage.REGISTERED,
        },
      });

      await tx.orderPayment.createMany({
        data: normalizedPayments.map((p) => ({
          orderId: order.id,
          method: p.method,
          amount: p.amount,
          reference: p.reference,
        })),
      });

      return {
        orderId: order.id,
        subtotalBeforeTax: subtotalBeforeTax.toString(),
        hasIva,
        ivaAmount: ivaAmount.toString(),
        total: finalTotal.toString(),
        branchId: registerBranchId,
        pickupBranchId,
        estimatedReadyAt: finalReadyAt.toISOString(),
        deliveryScheduleSource,
        message: "Pedido creado exitosamente",
      };
    }, { timeout: 20000, maxWait: 10000 });

    const io = req.app.get("io");
    const events = orderEvents(io);

    const scheduleResult = await scheduleOrderProduction(result.orderId, {
      finalReadyAt,
      deliveryScheduleSource,
    });

    const newOrder = await prisma.order.findUnique({
      where: { id: result.orderId },
      include: {
        customer: true,
        branch: true,
        pickupBranch: true,
        payments: { orderBy: { id: "asc" } },
        creator: true,
        items: {
          include: {
            product: true,
            variantRef: true,
            steps: {
              orderBy: { order: "asc" },
            },
            options: true,
          },
        },
      },
    });

    if (newOrder) {
      events.orderCreated(newOrder);
    }

    return res.status(201).json({
      ...result,
      estimatedReadyAt: scheduleResult.ok
        ? scheduleResult.estimatedReadyAt?.toISOString() ?? result.estimatedReadyAt
        : null,
      productionScheduleStatus: scheduleResult.status,
      productionScheduleMessage: scheduleResult.message,
    });
  } catch (e: any) {
    console.error("Error creando orden:", e);
    res.status(400).json({ error: e?.message ?? "Error creando orden" });
  }
}

export async function verifyBranchPassword(req: AuthedRequest, res: Response) {
  try {
    const { branchId, password } = req.body;

    if (!branchId || !password) {
      return res.status(400).json({ error: "Faltan datos" });
    }

    const branchUser = await prisma.user.findFirst({
      where: {
        branchId: branchId,
        role: { in: ["STAFF", "COUNTER", "MULTI_COUNTER"] },
        isActive: true,
      },
      select: {
        passwordHash: true,
      },
    });

    if (!branchUser) {
      return res.status(404).json({ error: "No hay usuarios activos en esta sucursal" });
    }

    const valid = await bcrypt.compare(password, branchUser.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: "Contraseña incorrecta" });
    }

    res.json({ success: true });
  } catch (error) {
    console.error("Error en verifyBranchPassword:", error);
    res.status(500).json({ error: "Error en el servidor" });
  }
}

export async function listDeliveredOrders(req: AuthedRequest, res: Response) {
  const authUser = req.auth;
  if (!authUser) return res.status(401).json({ error: "No autorizado" });

  if (authUser.role !== "ADMIN") {
    return res.status(403).json({ error: "Solo administradores pueden ver pedidos entregados" });
  }

  try {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const branchId =
      typeof req.query.branchId === "string" ? parseInt(req.query.branchId, 10) : undefined;
    const dateFrom = typeof req.query.dateFrom === "string" ? req.query.dateFrom : undefined;
    const dateTo = typeof req.query.dateTo === "string" ? req.query.dateTo : undefined;

    const where: any = {
      stage: OrderStage.DELIVERED,
    };

    if (!Number.isNaN(branchId as number) && branchId) {
      where.branchId = branchId;
    }

    if (dateFrom || dateTo) {
      where.deliveryDate = {};
      if (dateFrom) {
        if (!isValidDateKey(dateFrom)) throw new Error("dateFrom inválido");
        where.deliveryDate.gte = startOfBusinessDayUtc(dateFrom);
      }
      if (dateTo) {
        if (!isValidDateKey(dateTo)) throw new Error("dateTo inválido");
        where.deliveryDate.lt = nextBusinessDayStartUtc(dateTo);
      }
    }

    if (q) {
      where.OR = [
        { id: Number.isFinite(Number(q)) ? Number(q) : undefined },
        { customer: { name: { contains: q, mode: "insensitive" } } },
        { customer: { phone: { contains: q, mode: "insensitive" } } },
        { branch: { name: { contains: q, mode: "insensitive" } } },
        { pickupBranch: { name: { contains: q, mode: "insensitive" } } },
        {
          items: {
            some: {
              productNameSnapshot: { contains: q, mode: "insensitive" },
            },
          },
        },
      ].filter((x) => Object.values(x)[0] !== undefined);
    }

    const orders = await prisma.order.findMany({
      where,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: 500,
      select: {
        id: true,
        stage: true,
        shippingType: true,
        paymentMethod: true,
        payments: {
          select: { id: true, method: true, amount: true, reference: true, createdAt: true },
          orderBy: { id: "asc" },
        },
        deliveryDate: true,
        deliveryTime: true,
        autoEstimatedReadyAt: true,
        manualReadyAt: true,
        estimatedReadyAt: true,
        productionScheduleStatus: true,
        productionScheduleSource: true,
        productionScheduleMessage: true,
        deliveredAt: true,
        createdAt: true,
        total: true,
        notes: true,
        customer: { select: { id: true, name: true, phone: true } },
        branch: { select: { id: true, name: true } },
        pickupBranch: { select: { id: true, name: true } },
        creator: { select: { id: true, name: true, username: true, role: true } },
        items: {
          select: {
            id: true,
            quantity: true,
            unitPrice: true,
            subtotal: true,
            isCustomProduct: true,
            customProductName: true,
            customUnitType: true,
            customUnitPrice: true,
            product: { select: { id: true, name: true, unitType: true } },
            variantRef: { select: { id: true, name: true } },
            options: {
              select: {
                id: true,
                name: true,
                priceDelta: true,
                quantity: true,
                chargeType: true,
                subtotal: true,
              },
            },
          },
        },
      },
    });

    res.json({ orders });
  } catch (error: any) {
    console.error("Error listando pedidos entregados:", error);
    res.status(400).json({ error: error?.message ?? "Error listando pedidos entregados" });
  }
}
