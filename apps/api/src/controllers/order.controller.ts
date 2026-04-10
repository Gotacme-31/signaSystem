import type { Response } from "express";
import { Prisma, OrderStage, ShippingType, PaymentMethod } from "@prisma/client";
import { prisma } from "../lib/prisma";
import type { AuthedRequest } from "../middlewares/auth";
import bcrypt from "bcrypt";
import { orderEvents } from "../socket/handlers/orders";
// Agregar constantes al inicio del archivo
const VOLUME_PRODUCT_IDS = [2, 6]; // Frazadas (2) y Toallas (6)
const VOLUME_THRESHOLDS = [12, 100]; // Umbrales de cantidad

function parseLocalDateOnly(value: string): Date {
  const trimmed = value.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);

  if (!match) {
    throw new Error(`Fecha inválida: ${value}. Formato esperado: YYYY-MM-DD`);
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  // Mediodía local para evitar brincos por zona horaria
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}
// Función auxiliar para obtener el precio por volumen (versión síncrona dentro de la transacción)
async function getVolumePrice(
  tx: any,
  branchProductId: number,
  productId: number,
  variantId: number | null,
  totalGroupQuantity: number
): Promise<{ unitPrice: Prisma.Decimal; minQty: number } | null> {
  if (!VOLUME_PRODUCT_IDS.includes(productId)) return null;

  // Buscar el mejor umbral aplicable (100 primero, luego 12)
  const sortedThresholds = [...VOLUME_THRESHOLDS].sort((a, b) => b - a);

  for (const threshold of sortedThresholds) {
    if (totalGroupQuantity >= threshold) {
      if (variantId) {
        // Buscar en variantQuantityPrices
        const volumePrice = await tx.branchProductVariantQuantityPrice.findFirst({
          where: {
            branchProductId,
            variantId,
            minQty: new Prisma.Decimal(threshold),
            isActive: true
          }
        });

        if (volumePrice) {
          return {
            unitPrice: volumePrice.unitPrice,
            minQty: threshold
          };
        }
      } else {
        // Buscar en quantityPrices
        const volumePrice = await tx.branchProductQuantityPrice.findFirst({
          where: {
            branchProductId,
            minQty: new Prisma.Decimal(threshold),
            isActive: true
          }
        });

        if (volumePrice) {
          return {
            unitPrice: volumePrice.unitPrice,
            minQty: threshold
          };
        }
      }
    }
  }

  return null;
}

// Función para calcular precio unitario (VERSIÓN CORREGIDA - SIN ASYNC)
function calcUnitPriceFromBPWithVolume(args: {
  bp: any;
  variantId: number | null;
  qty: Prisma.Decimal;
  paramIds: number[];
  halfStepSpecialPrice?: Prisma.Decimal | null;
  productUnitType?: string;
  productId: number;
  totalGroupQuantity?: number;
  volumePrice?: { unitPrice: Prisma.Decimal; minQty: number } | null;
}) {
  const {
    bp,
    variantId,
    qty,
    paramIds,
    halfStepSpecialPrice,
    productUnitType,
    productId,
    totalGroupQuantity,
    volumePrice
  } = args;

  // PRECIO ESPECIAL 0.5m
  if (
    productUnitType === "METER" &&
    halfStepSpecialPrice &&
    halfStepSpecialPrice.gt(0) &&
    qty.equals(new Prisma.Decimal("0.5"))
  ) {
    return {
      unitPrice: halfStepSpecialPrice,
      appliedMinQty: null,
      source: "half-meter-special",
      paramDelta: new Prisma.Decimal(0),
      usedVolumePricing: false,
    };
  }

  let unitPrice = bp.price as Prisma.Decimal;
  let source = "base-price";
  let appliedMinQty: Prisma.Decimal | null = null;
  let paramDelta = new Prisma.Decimal(0);
  let usedVolumePricing = false;

  // precio por volumen
  if (
    VOLUME_PRODUCT_IDS.includes(productId) &&
    totalGroupQuantity &&
    totalGroupQuantity > 0 &&
    volumePrice
  ) {
    unitPrice = volumePrice.unitPrice;
    appliedMinQty = new Prisma.Decimal(volumePrice.minQty);
    source = `volume-group-${volumePrice.minQty}`;
    usedVolumePricing = true;
  }

  // lógica normal
  if (!usedVolumePricing) {
    if (variantId) {
      const tiers = (bp.variantQuantityPrices ?? []).filter(
        (x: any) => x.variantId === variantId
      );
      const tier = pickApplicableTier(tiers, qty);

      if (tier) {
        unitPrice = tier.unitPrice;
        appliedMinQty = tier.minQty;
        source = "variant-quantity-matrix";
      } else {
        const vp = (bp.variantPrices ?? []).find(
          (x: any) => x.variantId === variantId
        );
        if (vp) {
          unitPrice = vp.price;
          source = "variant-base-price";
        }
      }
    } else {
      const tier = pickApplicableTier(bp.quantityPrices ?? [], qty);
      if (tier) {
        unitPrice = tier.unitPrice;
        appliedMinQty = tier.minQty;
        source = "quantity-price";
      }
    }
  }

  // parámetros
  const deltas = (bp.paramPrices ?? []).filter((pp: any) =>
    paramIds.includes(pp.paramId)
  );
  paramDelta = deltas.reduce(
    (sum: Prisma.Decimal, pp: any) => sum.add(pp.priceDelta),
    new Prisma.Decimal(0)
  );

  unitPrice = unitPrice.add(paramDelta);

  return { unitPrice, appliedMinQty, source, paramDelta, usedVolumePricing };
}

function parseId(param: string | string[] | undefined): number | null {
  if (!param) return null;
  const str = Array.isArray(param) ? param[0] : param;
  const num = parseInt(str, 10);
  return Number.isFinite(num) ? num : null;
}

// Función para encontrar el mejor tier
function pickApplicableTier<T extends { minQty: Prisma.Decimal; unitPrice: Prisma.Decimal }>(
  tiers: T[],
  qty: Prisma.Decimal
): T | null {
  let best: T | null = null;
  for (const t of tiers) {
    if (qty.gte(t.minQty)) best = t;
  }
  return best;
}

export async function nextStep(req: AuthedRequest, res: Response) {
  const authUser = req.auth;
  const id = parseId(req.params.id);

  if (!authUser) return res.status(401).json({ error: "No autorizado" });
  if (!id) return res.status(400).json({ error: "id inválido" });

  try {
    const result = await prisma.$transaction(async (tx) => {
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

      // Recalcular estado del pedido
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
    });

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

// Listar pedidos activos
export async function listActiveOrders(req: AuthedRequest, res: Response) {
  const authUser = req.auth;
  if (!authUser) return res.status(401).json({ error: "No autorizado" });
  if (!authUser.branchId && authUser.role !== "ADMIN") {
    return res.status(400).json({ error: "Usuario sin sucursal asignada" });
  }

  try {
    const where: any = {
      stage: { not: OrderStage.DELIVERED },
      NOT: [{ shippingType: "DELIVERY", shippingStage: "RECEIVED" }],
    };

    const scope = (req.query.scope as string) ?? "all";
    const sortOrder = req.query.sortOrder === "asc" ? "asc" : "desc";

    if (authUser.role !== "ADMIN") {
      if (scope === "production") where.branchId = authUser.branchId;
      else if (scope === "pickup") where.pickupBranchId = authUser.branchId;
      else where.OR = [{ branchId: authUser.branchId }, { pickupBranchId: authUser.branchId }];
    }

    const dateFrom = typeof req.query.dateFrom === "string" ? req.query.dateFrom : undefined;
    const dateTo = typeof req.query.dateTo === "string" ? req.query.dateTo : undefined;

    if (dateFrom || dateTo) {
      const gte = dateFrom ? new Date(`${dateFrom}T00:00:00`) : undefined;
      const lt = dateTo ? new Date(`${dateTo}T00:00:00`) : undefined;
      const ltPlus1 = lt ? new Date(lt.getTime() + 24 * 60 * 60 * 1000) : undefined;

      where.deliveryDate = {
        ...(gte ? { gte } : {}),
        ...(ltPlus1 ? { lt: ltPlus1 } : {}),
      };
    }

    const orders = await prisma.order.findMany({
      where,
      orderBy: sortOrder === "desc"
        ? [{ id: "desc" }]   // Más recientes primero (por defecto)
        : [{ id: "asc" }],
      select: {
        id: true,
        stage: true,
        shippingType: true,     // ✅
        shippingStage: true,    // ✅
        deliveryDate: true,
        deliveryTime: true,
        notes: true,
        total: true,
        paymentMethod: true,
        branchId: true,
        pickupBranchId: true,

        customer: { select: { id: true, name: true, phone: true } },
        branch: { select: { id: true, name: true } },
        pickupBranch: { select: { id: true, name: true } },
        creator: { select: { id: true, name: true, username: true, role: true } },

        items: {
          select: {
            id: true,
            quantity: true,
            isReady: true,
            currentStepOrder: true,
            unitPrice: true,
            subtotal: true,
            product: { select: { id: true, name: true, unitType: true } },
            variantRef: { select: { id: true, name: true } },
            steps: { select: { order: true, name: true, status: true }, orderBy: { order: "asc" } },
            options: { select: { id: true, name: true, priceDelta: true } }
          }
        }
      }
    });

    res.json({ orders });
  } catch (e: any) {
    console.error('Error listando pedidos activos:', e);
    res.status(400).json({ error: e?.message ?? "Error" });
  }
}
// Marcar como entregado
export async function markDelivered(req: AuthedRequest, res: Response) {
  const authUser = req.auth;
  const orderId = parseId(req.params.id);

  if (!authUser) return res.status(401).json({ error: "No autorizado" });
  if (!orderId) return res.status(400).json({ error: "id inválido" });

  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, branchId: true, pickupBranchId: true }, // 👈 Incluir pickupBranchId
    });

    if (!order) return res.status(404).json({ error: "Pedido no existe" });

    if (authUser.role !== "ADMIN" && authUser.branchId !== order.branchId) {
      return res.status(403).json({ error: "No autorizado" });
    }

    await prisma.order.update({
      where: { id: orderId },
      data: { stage: OrderStage.DELIVERED, deliveredAt: new Date() },
    });

    // Emitir eventos de socket
    const io = req.app.get("io");
    const events = orderEvents(io);

    // Emitir a la sucursal de producción
    events.orderDelivered(orderId, order.branchId);

    // Si hay pickup diferente, también emitir allí
    if (order.pickupBranchId && order.pickupBranchId !== order.branchId) {
      events.orderDelivered(orderId, order.pickupBranchId);
    }

    // También emitir order:deleted para que desaparezca de las listas
    events.orderDeleted(orderId, order.branchId, order.pickupBranchId);

    res.json({ ok: true });
  } catch (e: any) {
    console.error('Error marcando como entregado:', e);
    res.status(400).json({ error: e?.message ?? "Error" });
  }
}

// Marcar como recibido (para delivery)
export async function markReceived(req: AuthedRequest, res: Response) {
  const authUser = req.auth;
  const orderId = parseId(req.params.id);

  if (!authUser) return res.status(401).json({ error: "No autorizado" });
  if (!orderId) return res.status(400).json({ error: "id inválido" });

  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, branchId: true, shippingType: true },
    });

    if (!order) return res.status(404).json({ error: "Pedido no existe" });
    if (order.shippingType !== "DELIVERY") return res.status(400).json({ error: "Este pedido no es DELIVERY" });

    if (authUser.role !== "ADMIN" && authUser.branchId !== order.branchId) {
      return res.status(403).json({ error: "No autorizado" });
    }

    await prisma.order.update({
      where: { id: orderId },
      data: { shippingStage: "RECEIVED" },
    });

    res.json({ ok: true });
  } catch (e: any) {
    console.error('Error marcando como recibido:', e);
    res.status(400).json({ error: e?.message ?? "Error" });
  }
}

// Obtener detalles de un pedido
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
        creator: {
          select: {
            id: true,
            name: true,
            username: true,
            role: true
          }
        },
        items: {
          include: {
            product: { select: { id: true, name: true, unitType: true, minQty: true, qtyStep: true } },
            variantRef: { select: { id: true, name: true } },
            steps: { orderBy: { order: 'asc' } },
            options: true
          }
        }
      }
    });

    if (!order) return res.status(404).json({ error: "Pedido no encontrado" });

    // Verificar permisos
    if (authUser.role !== "ADMIN" &&
      authUser.branchId !== order.branchId &&
      authUser.branchId !== order.pickupBranchId) {
      return res.status(403).json({ error: "No autorizado para ver este pedido" });
    }

    res.json({ order });
  } catch (e: any) {
    console.error('Error obteniendo detalles del pedido:', e);
    res.status(400).json({ error: e?.message ?? "Error obteniendo detalles del pedido" });
  }
}

// Listar todos los pedidos
export async function listOrders(req: AuthedRequest, res: Response) {
  try {
    const authUser = req.auth;
    if (!authUser) return res.status(401).json({ error: "No autorizado" });

    const {
      stage,
      dateFrom,
      dateTo,
      customerId,
      branchId,
      pickupBranchId
    } = req.query;

    const where: any = {};

    // Filtrar por usuario
    if (authUser.role !== "ADMIN") {
      where.OR = [
        { branchId: authUser.branchId },
        { pickupBranchId: authUser.branchId }
      ];
    }

    // Filtros adicionales
    if (stage) where.stage = stage;
    if (customerId) {
      const id = parseInt(customerId as string);
      if (!isNaN(id)) where.customerId = id;
    }
    if (branchId && authUser.role === "ADMIN") {
      const id = parseInt(branchId as string);
      if (!isNaN(id)) where.branchId = id;
    }
    if (pickupBranchId && authUser.role === "ADMIN") {
      const id = parseInt(pickupBranchId as string);
      if (!isNaN(id)) where.pickupBranchId = id;
    }

    // Filtrar por fecha
    if (dateFrom || dateTo) {
      where.deliveryDate = {};
      if (dateFrom) where.deliveryDate.gte = new Date(`${dateFrom}T00:00:00`);
      if (dateTo) {
        const toDate = new Date(`${dateTo}T00:00:00`);
        toDate.setDate(toDate.getDate() + 1);
        where.deliveryDate.lt = toDate;
      }
    }

    const orders = await prisma.order.findMany({
      where,
      orderBy: [{ deliveryDate: 'desc' }, { id: 'asc' }],
      include: {
        customer: { select: { id: true, name: true, phone: true } },
        branch: { select: { id: true, name: true } },
        pickupBranch: { select: { id: true, name: true } },
        items: {
          select: {
            id: true,
            quantity: true,
            isReady: true,
            unitPrice: true,
            subtotal: true,
            product: { select: { name: true } },
            variantRef: { select: { name: true } }
          }
        }
      }
    });

    res.json({ orders });
  } catch (e: any) {
    console.error('Error listando pedidos:', e);
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
            product: true,
            options: true,
            variantRef: true,
          },
        },
      },
    });

    if (!existingOrder) {
      return res.status(404).json({ error: "Pedido no encontrado" });
    }

    if (existingOrder.stage === OrderStage.DELIVERED) {
      return res.status(400).json({ error: "No se puede actualizar un pedido entregado" });
    }

    const orderUpdateData: any = {};

    if (updates.deliveryDate) {
      orderUpdateData.deliveryDate = parseLocalDateOnly(updates.deliveryDate);
    }

    if (updates.deliveryTime !== undefined) {
      orderUpdateData.deliveryTime = updates.deliveryTime;
    }

    if (updates.notes !== undefined) {
      orderUpdateData.notes = updates.notes;
    }

    if (updates.paymentMethod) {
      orderUpdateData.paymentMethod = updates.paymentMethod;
    }

    if (updates.stage) {
      orderUpdateData.stage = updates.stage;
    }

    // Si no hay items para actualizar, solo actualizar pedido y recalcular total actual
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

          const currentTotal = currentItems.reduce(
            (sum, item) => sum.add(item.subtotal),
            new Prisma.Decimal(0)
          );

          await tx.order.update({
            where: { id: orderId },
            data: { total: currentTotal },
          });

          return { success: true, total: currentTotal.toString() };
        },
        {
          timeout: 15000,
          maxWait: 10000,
        }
      );

      const io = req.app.get("io");
      const events = orderEvents(io);

      const updatedOrder = await prisma.order.findUnique({
        where: { id: orderId },
        include: {
          customer: { select: { id: true, name: true, phone: true } },
          branch: { select: { id: true, name: true } },
          pickupBranch: { select: { id: true, name: true } },
          creator: { select: { id: true, name: true, username: true, role: true } },
          items: {
            select: {
              id: true,
              quantity: true,
              isReady: true,
              currentStepOrder: true,
              unitPrice: true,
              subtotal: true,
              product: { select: { id: true, name: true, unitType: true } },
              variantRef: { select: { id: true, name: true } },
              steps: {
                select: { order: true, name: true, status: true },
                orderBy: { order: "asc" },
              },
              options: {
                select: { id: true, name: true, priceDelta: true },
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

    // Obtener branchProducts fuera de la transacción
    const affectedProductIds = Array.from(
      new Set(existingOrder.items.map((i) => i.productId))
    );

    const branchProducts = await prisma.branchProduct.findMany({
      where: {
        branchId: existingOrder.branchId,
        productId: { in: affectedProductIds },
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
        },
      },
    });

    const bpMap = new Map(branchProducts.map((bp) => [bp.productId, bp]));

    // Estado final de items
    const finalItemsMap = new Map<number, any>();

    for (const item of existingOrder.items) {
      finalItemsMap.set(item.id, {
        id: item.id,
        productId: item.productId,
        quantity: item.quantity.toNumber(),
        variantId: item.variantId,
        options: item.options,
        isReady: item.isReady,
        currentStepOrder: item.currentStepOrder,
      });
    }

    for (const itemUpdate of updates.items) {
      const existingItem = finalItemsMap.get(itemUpdate.id);
      if (!existingItem) continue;

      finalItemsMap.set(itemUpdate.id, {
        ...existingItem,
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
        isReady:
          itemUpdate.isReady !== undefined
            ? itemUpdate.isReady
            : existingItem.isReady,
        currentStepOrder:
          itemUpdate.currentStepOrder !== undefined
            ? itemUpdate.currentStepOrder
            : existingItem.currentStepOrder,
      });
    }

    // Total grupo para volumen
    let totalVolumeQuantity = 0;
    for (const [, finalItem] of finalItemsMap) {
      if (VOLUME_PRODUCT_IDS.includes(finalItem.productId)) {
        totalVolumeQuantity += Number(finalItem.quantity ?? 0);
      }
    }

    // Precalcular todo fuera de la transacción
    const computedItems: Array<{
      itemId: number;
      qty: Prisma.Decimal;
      unitPrice: Prisma.Decimal;
      subtotal: Prisma.Decimal;
      appliedMinQty: Prisma.Decimal | null;
      isReady: boolean;
      currentStepOrder: number;
    }> = [];

    let total = new Prisma.Decimal(0);

    for (const [itemId, finalItem] of finalItemsMap) {
      const bp = bpMap.get(finalItem.productId);
      if (!bp) {
        throw new Error(`No se encontró configuración de precio para el producto ${finalItem.productId}`);
      }

      const qty = new Prisma.Decimal(finalItem.quantity.toString());

      if (qty.lte(0)) {
        throw new Error(`La cantidad para "${bp.product.name}" debe ser mayor a 0`);
      }

      const variantId = finalItem.variantId ?? null;
      const paramIds =
        finalItem.options?.map((opt: any) => opt.optionId || opt.id) || [];

      const isHalfSpecial =
        bp.product.unitType === "METER" &&
        bp.halfStepSpecialPrice &&
        bp.halfStepSpecialPrice.gt(0) &&
        qty.equals(new Prisma.Decimal("0.5"));

      if (!isHalfSpecial && bp.product.minQty && qty.lt(bp.product.minQty)) {
        throw new Error(`Cantidad mínima para "${bp.product.name}" es ${bp.product.minQty}`);
      }

      // Calcular volumen sin consultar a la DB otra vez
      let volumePrice: { unitPrice: Prisma.Decimal; minQty: number } | null = null;

      if (VOLUME_PRODUCT_IDS.includes(finalItem.productId) && totalVolumeQuantity > 0) {
        const sortedThresholds = [...VOLUME_THRESHOLDS].sort((a, b) => b - a);

        for (const threshold of sortedThresholds) {
          if (totalVolumeQuantity >= threshold) {
            if (variantId) {
              const found = (bp.variantQuantityPrices ?? []).find(
                (x: any) =>
                  x.variantId === variantId &&
                  new Prisma.Decimal(x.minQty).equals(new Prisma.Decimal(threshold))
              );

              if (found) {
                volumePrice = {
                  unitPrice: found.unitPrice,
                  minQty: threshold,
                };
                break;
              }
            } else {
              const found = (bp.quantityPrices ?? []).find(
                (x: any) => new Prisma.Decimal(x.minQty).equals(new Prisma.Decimal(threshold))
              );

              if (found) {
                volumePrice = {
                  unitPrice: found.unitPrice,
                  minQty: threshold,
                };
                break;
              }
            }
          }
        }
      }

      const priceResult = calcUnitPriceFromBPWithVolume({
        bp,
        variantId,
        qty,
        paramIds,
        halfStepSpecialPrice: bp.halfStepSpecialPrice,
        productUnitType: bp.product.unitType,
        productId: finalItem.productId,
        totalGroupQuantity: totalVolumeQuantity,
        volumePrice,
      });

      const subtotal =
        priceResult.source === "half-meter-special"
          ? priceResult.unitPrice
          : priceResult.unitPrice.mul(qty);

      total = total.add(subtotal);

      computedItems.push({
        itemId,
        qty,
        unitPrice: priceResult.unitPrice,
        subtotal,
        appliedMinQty: priceResult.appliedMinQty,
        isReady: finalItem.isReady,
        currentStepOrder: finalItem.currentStepOrder,
      });
    }

    const result = await prisma.$transaction(
      async (tx) => {
        await tx.order.update({
          where: { id: orderId },
          data: orderUpdateData,
        });

        for (const item of computedItems) {
          await tx.orderItem.update({
            where: { id: item.itemId },
            data: {
              quantity: item.qty,
              unitPrice: item.unitPrice,
              subtotal: item.subtotal,
              appliedMinQty: item.appliedMinQty,
              isReady: item.isReady,
              currentStepOrder: item.currentStepOrder,
            },
          });
        }

        await tx.order.update({
          where: { id: orderId },
          data: { total },
        });

        return { success: true, total: total.toString() };
      },
      {
        timeout: 15000,
        maxWait: 10000,
      }
    );

    const io = req.app.get("io");
    const events = orderEvents(io);

    const updatedOrder = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        customer: { select: { id: true, name: true, phone: true } },
        branch: { select: { id: true, name: true } },
        pickupBranch: { select: { id: true, name: true } },
        creator: { select: { id: true, name: true, username: true, role: true } },
        items: {
          select: {
            id: true,
            quantity: true,
            isReady: true,
            currentStepOrder: true,
            unitPrice: true,
            subtotal: true,
            product: { select: { id: true, name: true, unitType: true } },
            variantRef: { select: { id: true, name: true } },
            steps: {
              select: { order: true, name: true, status: true },
              orderBy: { order: "asc" },
            },
            options: {
              select: { id: true, name: true, priceDelta: true },
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
// Cancelar pedido (soft delete)
export async function cancelOrder(req: AuthedRequest, res: Response) {
  try {
    const orderId = parseId(req.params.id);
    const authUser = req.auth;

    if (!authUser) return res.status(401).json({ error: "No autorizado" });
    if (!orderId) return res.status(400).json({ error: "id inválido" });

    const existingOrder = await prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, branchId: true, stage: true, notes: true }
    });

    if (!existingOrder) return res.status(404).json({ error: "Pedido no encontrado" });

    if (authUser.role !== "ADMIN" && authUser.branchId !== existingOrder.branchId) {
      return res.status(403).json({ error: "No autorizado para cancelar este pedido" });
    }

    if (existingOrder.stage === OrderStage.DELIVERED) {
      return res.status(400).json({ error: "No se puede cancelar un pedido entregado" });
    }

    const canceledOrder = await prisma.order.update({
      where: { id: orderId },
      data: {
        stage: OrderStage.REGISTERED,
        notes: existingOrder.notes ?
          `${existingOrder.notes}\n[Cancelado el ${new Date().toLocaleDateString()}]` :
          `[Cancelado el ${new Date().toLocaleDateString()}]`
      }
    });

    res.json({ order: canceledOrder });
  } catch (e: any) {
    console.error('Error cancelando pedido:', e);
    res.status(400).json({ error: e?.message ?? "Error cancelando pedido" });
  }
}

// Eliminar orden permanentemente (solo ADMIN)
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
      select: { id: true, branchId: true, pickupBranchId: true }
    });

    if (!existingOrder) return res.status(404).json({ error: "Pedido no encontrado" });

    // Eliminar items relacionados primero
    await prisma.orderItem.deleteMany({
      where: { orderId }
    });

    // Eliminar la orden
    await prisma.order.delete({
      where: { id: orderId }
    });

    // Emitir eventos de socket
    const io = req.app.get("io");
    const events = orderEvents(io);
    events.orderDeleted(orderId, existingOrder.branchId, existingOrder.pickupBranchId || undefined);

    res.json({ success: true, message: "Pedido eliminado permanentemente" });
  } catch (e: any) {
    console.error('Error eliminando pedido:', e);
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
      deliveryDate: string;
      deliveryTime?: string | null;
      notes?: string | null;
      items: Array<{
        productId: number;
        quantity: string | number;
        variantId?: number | null;
        paramIds?: number[];
      }>;
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

    let pickupBranchId: number;
    if (body.pickupBranchId) pickupBranchId = body.pickupBranchId;
    else pickupBranchId = registerBranchId;

    if (!body?.customerId) {
      return res.status(400).json({ error: "customerId es requerido" });
    }

    if (!body.items?.length) {
      return res.status(400).json({ error: "Debe agregar al menos un producto" });
    }

    const result = await prisma.$transaction(async (tx) => {
      const [customer, pickupBranch, registerBranch] = await Promise.all([
        tx.customer.findUnique({
          where: { id: body.customerId },
          select: { id: true, name: true },
        }),
        tx.branch.findUnique({
          where: { id: pickupBranchId },
          select: { id: true, name: true, isActive: true },
        }),
        tx.branch.findUnique({
          where: { id: registerBranchId },
          select: { id: true, name: true, isActive: true },
        }),
      ]);

      if (!customer) throw new Error("Cliente no existe");
      if (!pickupBranch || !pickupBranch.isActive) {
        throw new Error("Sucursal de recolección no existe o está inactiva");
      }
      if (!registerBranch || !registerBranch.isActive) {
        throw new Error("Sucursal de registro no existe o está inactiva");
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
          },
        },
      });

      const bpMap = new Map<number, (typeof branchProducts)[number]>();
      for (const bp of branchProducts) {
        bpMap.set(bp.productId, bp);
      }

      for (const item of body.items) {
        if (!bpMap.has(item.productId)) {
          const product = await tx.product.findUnique({
            where: { id: item.productId },
            select: { name: true },
          });

          throw new Error(
            `Producto "${product?.name || item.productId}" no disponible en esta sucursal`
          );
        }
      }

      // Total combinado para productos con precio por volumen
      let totalVolumeQuantity = 0;
      for (const item of body.items) {
        if (VOLUME_PRODUCT_IDS.includes(item.productId)) {
          const qty =
            typeof item.quantity === "string"
              ? parseFloat(item.quantity)
              : item.quantity;

          totalVolumeQuantity += qty;
        }
      }

      const productSteps = await tx.productProcessStep.findMany({
        where: { productId: { in: productIds }, isActive: true },
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
          deliveryDate: parseLocalDateOnly(body.deliveryDate),
          deliveryTime: body.deliveryTime ?? null,
          notes: body.notes ?? null,
          total: new Prisma.Decimal("0"),
        },
        select: { id: true },
      });

      let total = new Prisma.Decimal("0");

      for (const it of body.items) {
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

        const variantId = it.variantId ?? null;
        const paramIds = Array.isArray(it.paramIds) ? it.paramIds : [];

        if (bp.product.needsVariant && !variantId) {
          throw new Error(`El producto "${bp.product.name}" requiere seleccionar un tamaño`);
        }

        // Buscar precio por volumen solo una vez por item, pero usando el total combinado del grupo
        const volumePrice = await getVolumePrice(
          tx,
          bp.id,
          it.productId,
          variantId,
          totalVolumeQuantity
        );

        const priceResult = calcUnitPriceFromBPWithVolume({
          bp,
          variantId,
          qty,
          paramIds,
          halfStepSpecialPrice: bp.halfStepSpecialPrice,
          productUnitType: bp.product.unitType,
          productId: it.productId,
          totalGroupQuantity: totalVolumeQuantity,
          volumePrice,
        });

        let subtotal: Prisma.Decimal;
        if (priceResult.source === "half-meter-special") {
          subtotal = priceResult.unitPrice;
        } else {
          subtotal = priceResult.unitPrice.mul(qty);
        }

        total = total.add(subtotal);

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
            currentStepOrder: firstOrder,
            isReady: false,
            productionStep: "AUTO",
          },
          select: { id: true },
        });

        if (paramIds.length > 0) {
          const params = await tx.productParam.findMany({
            where: { id: { in: paramIds } },
            select: { id: true, name: true },
          });

          for (const param of params) {
            const paramPrice = bp.paramPrices?.find((pp: any) => pp.paramId === param.id);

            await tx.orderItemOption.create({
              data: {
                orderItemId: createdItem.id,
                optionId: param.id,
                name: param.name,
                priceDelta: paramPrice
                  ? paramPrice.priceDelta
                  : new Prisma.Decimal(0),
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

      await tx.order.update({
        where: { id: order.id },
        data: { total },
      });

      return {
        orderId: order.id,
        total: total.toString(),
        branchId: registerBranchId,
        pickupBranchId,
        message: "Pedido creado exitosamente",
      };
    });

    const io = req.app.get("io");
    const events = orderEvents(io);

    const newOrder = await prisma.order.findUnique({
      where: { id: result.orderId },
      include: {
        customer: { select: { id: true, name: true, phone: true } },
        branch: { select: { id: true, name: true } },
        pickupBranch: { select: { id: true, name: true } },
        creator: { select: { id: true, name: true, role: true } },
        items: {
          include: {
            product: { select: { id: true, name: true, unitType: true } },
            variantRef: { select: { id: true, name: true } },
            steps: {
              select: { order: true, name: true, status: true },
              orderBy: { order: "asc" },
            },
            options: { select: { id: true, name: true, priceDelta: true } },
          },
        },
      },
    });

    if (newOrder) {
      events.orderCreated(newOrder);
    }

    return res.status(201).json(result);
  } catch (e: any) {
    console.error("Error creando pedido:", e);
    console.error("Stack trace:", e.stack);

    return res.status(400).json({
      error: e?.message ?? "Error creando pedido",
      details: process.env.NODE_ENV === "development" ? e.stack : undefined,
    });
  }
}

// Verificar contraseña de la sucursal (para edición de pedidos)
export async function verifyBranchPassword(req: AuthedRequest, res: Response) {
  try {
    const { branchId, password } = req.body;

    if (!branchId || !password) {
      return res.status(400).json({ error: "Faltan datos" });
    }

    // Buscar un usuario ACTIVO de esa sucursal (STAFF o COUNTER)
    const branchUser = await prisma.user.findFirst({
      where: {
        branchId: branchId,
        role: { in: ["STAFF", "COUNTER"] },
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
    const branchId = typeof req.query.branchId === "string" ? parseInt(req.query.branchId, 10) : undefined;
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
      if (dateFrom) where.deliveryDate.gte = new Date(`${dateFrom}T00:00:00.000Z`);
      if (dateTo) {
        const toDate = new Date(`${dateTo}T00:00:00.000Z`);
        toDate.setDate(toDate.getDate() + 1);
        where.deliveryDate.lt = toDate;
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
        deliveryDate: true,
        deliveryTime: true,
        deliveredAt: true,
        createdAt: true,
        total: true,
        notes: true,
        branchId: true,
        pickupBranchId: true,
        customer: {
          select: {
            id: true,
            name: true,
            phone: true,
          },
        },
        branch: {
          select: {
            id: true,
            name: true,
          },
        },
        pickupBranch: {
          select: {
            id: true,
            name: true,
          },
        },
        items: {
          select: {
            id: true,
            quantity: true,
            subtotal: true,
            productNameSnapshot: true,
            unitTypeSnapshot: true,
            product: {
              select: {
                id: true,
                name: true,
                unitType: true,
              },
            },
          },
          orderBy: { id: "asc" },
        },
      },
    });

    return res.json({ orders });
  } catch (e: any) {
    console.error("Error listando pedidos entregados:", e);
    return res.status(400).json({ error: e?.message ?? "Error listando pedidos entregados" });
  }
}

export async function deleteDeliveredOrderPermanent(req: AuthedRequest, res: Response) {
  const authUser = req.auth;
  if (!authUser) return res.status(401).json({ error: "No autorizado" });

  if (authUser.role !== "ADMIN") {
    return res.status(403).json({ error: "Solo administradores pueden eliminar pedidos" });
  }

  const orderId = parseId(req.params.id);
  if (!orderId) return res.status(400).json({ error: "id inválido" });

  try {
    const existingOrder = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        branchId: true,
        pickupBranchId: true,
        stage: true,
      },
    });

    if (!existingOrder) {
      return res.status(404).json({ error: "Pedido no encontrado" });
    }

    if (existingOrder.stage !== OrderStage.DELIVERED) {
      return res.status(400).json({ error: "Solo se pueden eliminar pedidos entregados" });
    }

    await prisma.$transaction(async (tx) => {
      await tx.orderItem.deleteMany({ where: { orderId } });
      await tx.order.delete({ where: { id: orderId } });
    });

    const io = req.app.get("io");
    const events = orderEvents(io);
    events.orderDeleted(orderId, existingOrder.branchId, existingOrder.pickupBranchId ?? undefined);

    return res.json({
      success: true,
      message: "Pedido eliminado permanentemente",
    });
  } catch (e: any) {
    console.error("Error eliminando pedido entregado:", e);
    return res.status(400).json({ error: e?.message ?? "Error eliminando pedido" });
  }
}