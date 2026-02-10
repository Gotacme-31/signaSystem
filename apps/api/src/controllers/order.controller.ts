// controllers/order.controller.ts
import type { Response } from "express";
import { Prisma, OrderStage, ShippingType, PaymentMethod } from "@prisma/client";
import { prisma } from "../lib/prisma";
import type { AuthedRequest } from "../middlewares/auth";

function parseId(param: string | string[] | undefined): number | null {
  if (!param) return null;
  const str = Array.isArray(param) ? param[0] : param;
  const num = parseInt(str, 10);
  return Number.isFinite(num) ? num : null;
}

// Función CORREGIDA para encontrar el mejor tier
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

// Función CORREGIDA para calcular precio con parámetros - ¡CON PRECIO ESPECIAL 0.5m!
function calcUnitPriceFromBP(args: {
  bp: any;
  variantId: number | null;
  qty: Prisma.Decimal;
  paramIds: number[];
  productHalfStepSpecialPrice?: Prisma.Decimal | null;
  productUnitType?: string;
}) {
  const { bp, variantId, qty, paramIds, productHalfStepSpecialPrice, productUnitType } = args;

  // ¡¡¡PRIMERO VERIFICAR PRECIO ESPECIAL 0.5m!!!
  if (productUnitType === "METER" &&
    productHalfStepSpecialPrice &&
    productHalfStepSpecialPrice.gt(0) &&
    qty.equals(new Prisma.Decimal(0.5))) {
    console.log('✅ Backend aplicando precio especial 0.5m:', productHalfStepSpecialPrice.toString());
    return {
      unitPrice: productHalfStepSpecialPrice,
      appliedMinQty: null,
      source: 'half-meter-special',
      paramDelta: new Prisma.Decimal(0)
    };
  }

  let unitPrice = bp.price as Prisma.Decimal;
  let source = "base-price";
  let appliedMinQty: Prisma.Decimal | null = null;
  let paramDelta = new Prisma.Decimal(0);

  if (variantId) {
    // 1) matriz por variante+cantidad
    const tiers = (bp.variantQuantityPrices ?? []).filter((x: any) => x.variantId === variantId);
    const tier = pickApplicableTier(tiers, qty);
    if (tier) {
      unitPrice = tier.unitPrice;
      appliedMinQty = tier.minQty;
      source = "variant-quantity-matrix";
    } else {
      // 2) precio base por variante
      const vp = (bp.variantPrices ?? []).find((x: any) => x.variantId === variantId);
      if (vp) {
        unitPrice = vp.price;
        source = "variant-base-price";
      }
    }
  } else {
    // 3) precios por cantidad normales (solo si NO hay variante)
    const tier = pickApplicableTier(bp.quantityPrices ?? [], qty);
    if (tier) {
      unitPrice = tier.unitPrice;
      appliedMinQty = tier.minQty;
      source = "quantity-price";
    }
  }

  // 4) params delta (por unidad)
  const deltas = (bp.paramPrices ?? []).filter((pp: any) => paramIds.includes(pp.paramId));
  paramDelta = deltas.reduce((sum: Prisma.Decimal, pp: any) => sum.add(pp.priceDelta), new Prisma.Decimal(0));
  unitPrice = unitPrice.add(paramDelta);

  return { unitPrice, appliedMinQty, source, paramDelta };
}

// Función para calcular precio unitario (ya no se usa en createOrder, pero la dejo por compatibilidad)
async function calculateUnitPrice(
  branchId: number,
  productId: number,
  variantId: number | null,
  quantity: Prisma.Decimal
): Promise<{ unitPrice: Prisma.Decimal; appliedMinQty?: Prisma.Decimal; source: string }> {

  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { halfStepSpecialPrice: true, unitType: true }
  });

  if (product?.unitType === "METER" &&
    quantity.equals(new Prisma.Decimal(0.5)) &&
    product.halfStepSpecialPrice) {
    return {
      unitPrice: product.halfStepSpecialPrice,
      source: 'half-meter-special'
    };
  }

  const branchProduct = await prisma.branchProduct.findUnique({
    where: {
      branchId_productId: {
        branchId: branchId,
        productId: productId
      }
    },
    include: {
      variantQuantityPrices: variantId ? {
        where: {
          variantId: variantId,
          isActive: true
        },
        orderBy: { minQty: 'asc' }
      } : false,
      quantityPrices: variantId ? false : {
        where: { isActive: true },
        orderBy: { minQty: 'asc' }
      },
      variantPrices: variantId ? {
        where: {
          variantId: variantId,
          isActive: true
        }
      } : false
    }
  });

  if (!branchProduct) {
    throw new Error(`Producto ${productId} no disponible en esta sucursal`);
  }

  // 1. Matriz de precios por variante y cantidad
  if (variantId && branchProduct.variantQuantityPrices?.length > 0) {
    let applicablePrice = null;
    for (const price of branchProduct.variantQuantityPrices) {
      if (quantity.gte(price.minQty)) {
        applicablePrice = price;
      }
    }
    if (applicablePrice) {
      return {
        unitPrice: applicablePrice.unitPrice,
        appliedMinQty: applicablePrice.minQty,
        source: 'variant-quantity-matrix'
      };
    }
  }

  // 2. Precios por cantidad (sin variante)
  if (!variantId && branchProduct.quantityPrices?.length > 0) {
    let applicablePrice = null;
    for (const price of branchProduct.quantityPrices) {
      if (quantity.gte(price.minQty)) {
        applicablePrice = price;
      }
    }
    if (applicablePrice) {
      return {
        unitPrice: applicablePrice.unitPrice,
        appliedMinQty: applicablePrice.minQty,
        source: 'quantity-price'
      };
    }
  }

  // 3. Precio base de variante
  if (variantId && branchProduct.variantPrices?.length > 0) {
    const variantPrice = branchProduct.variantPrices[0];
    if (variantPrice) {
      return {
        unitPrice: variantPrice.price,
        source: 'variant-base-price'
      };
    }
  }

  // 4. Precio base del producto
  return {
    unitPrice: branchProduct.price,
    source: 'base-price'
  };
}

// Avanzar paso de producción
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

      if (authUser.role !== "ADMIN" && authUser.branchId !== item.order.branchId) {
        throw new Error("No autorizado para este pedido");
      }

      if (item.isReady) {
        return { ok: true, orderId: item.order.id, orderStage: item.order.stage, itemReady: true };
      }

      const current = item.currentStepOrder;
      const step = item.steps.find((s) => s.order === current);
      const lastOrder = item.steps.reduce((m, s) => Math.max(m, s.order), 0);

      if (!step) {
        await tx.orderItem.update({ where: { id: item.id }, data: { isReady: true } });
      } else {
        // Marcar paso actual como DONE
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
            await tx.orderItem.update({ where: { id: item.id }, data: { currentStepOrder: next } });
          } else {
            await tx.orderItem.update({ where: { id: item.id }, data: { isReady: true } });
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

      return { ok: true, orderId: item.order.id, orderStage: newStage, allReady };
    });

    res.json(result);
  } catch (e: any) {
    console.error('Error avanzando paso:', e);
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
      orderBy: [{ deliveryDate: "desc" }, { id: "desc" }],
      take: 200,
      include: {
        customer: { select: { id: true, name: true, phone: true } },
        branch: { select: { id: true, name: true } },
        pickupBranch: { select: { id: true, name: true } },
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
            options: { 
              select: {
                id: true,
                name: true,
                priceDelta: true
              }
            }
          },

        },

      },
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
      select: { id: true, branchId: true },
    });

    if (!order) return res.status(404).json({ error: "Pedido no existe" });

    if (authUser.role !== "ADMIN" && authUser.branchId !== order.branchId) {
      return res.status(403).json({ error: "No autorizado" });
    }

    await prisma.order.update({
      where: { id: orderId },
      data: { stage: OrderStage.DELIVERED, deliveredAt: new Date() },
    });

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
        items: {
          include: {
            product: { select: { id: true, name: true, unitType: true } },
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
      orderBy: [{ deliveryDate: 'desc' }, { id: 'desc' }],
      take: 100,
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

// Actualizar pedido
export async function updateOrder(req: AuthedRequest, res: Response) {
  try {
    const orderId = parseId(req.params.id);
    const authUser = req.auth;
    const updates = req.body;

    if (!authUser) return res.status(401).json({ error: "No autorizado" });
    if (!orderId) return res.status(400).json({ error: "id inválido" });

    const existingOrder = await prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, branchId: true, stage: true }
    });

    if (!existingOrder) return res.status(404).json({ error: "Pedido no encontrado" });

    if (authUser.role !== "ADMIN" && authUser.branchId !== existingOrder.branchId) {
      return res.status(403).json({ error: "No autorizado para actualizar este pedido" });
    }

    if (existingOrder.stage === OrderStage.DELIVERED) {
      return res.status(400).json({ error: "No se puede actualizar un pedido entregado" });
    }

    const allowedUpdates = ['notes', 'deliveryTime', 'shippingType', 'paymentMethod'];
    const filteredUpdates: any = {};

    for (const key of allowedUpdates) {
      if (updates[key] !== undefined) {
        filteredUpdates[key] = updates[key];
      }
    }

    if (updates.deliveryDate) {
      filteredUpdates.deliveryDate = new Date(updates.deliveryDate);
    }

    const updatedOrder = await prisma.order.update({
      where: { id: orderId },
      data: filteredUpdates,
      include: {
        customer: { select: { name: true, phone: true } },
        branch: { select: { name: true } },
        pickupBranch: { select: { name: true } }
      }
    });

    res.json({ order: updatedOrder });
  } catch (e: any) {
    console.error('Error actualizando pedido:', e);
    res.status(400).json({ error: e?.message ?? "Error actualizando pedido" });
  }
}

// Cancelar pedido
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

export async function createOrder(req: AuthedRequest, res: Response) {
  try {
    console.log('=== CREATE ORDER STARTED ===');
    console.log('Usuario autenticado:', req.auth);

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
      console.log('ERROR: No hay usuario autenticado');
      return res.status(401).json({ error: "No autorizado" });
    }

    console.log('Usuario:', authUser.email, 'Rol:', authUser.role, 'BranchId:', authUser.branchId);

    // === IMPORTANTE: STAFF PUEDE CREAR PEDIDOS ===
    // Solo necesitamos verificar que tenga branchId si es STAFF

    let registerBranchId: number;

    if (authUser.role === "STAFF") {
      // ADMIN puede especificar branchId en el body o usar su branchId
      if (body.branchId) {
        registerBranchId = body.branchId;
      } else if (authUser.branchId) {
        registerBranchId = authUser.branchId;
      } else {
        // Si ADMIN no tiene branchId, usar la primera sucursal activa
        const defaultBranch = await prisma.branch.findFirst({
          where: { isActive: true },
          select: { id: true }
        });
        if (!defaultBranch) {
          return res.status(400).json({ error: "No hay sucursales activas disponibles" });
        }
        registerBranchId = defaultBranch.id;
      }
    } else {
      // === STAFF: Debe tener branchId ===
      if (!authUser.branchId) {
        console.log('ERROR: Usuario STAFF sin branchId:', authUser);
        return res.status(400).json({
          error: "No tienes una sucursal asignada. Contacta al administrador."
        });
      }
      registerBranchId = authUser.branchId;
    }

    // DETERMINAR LA SUCURSAL DE RECOGIDA
    let pickupBranchId: number;
    if (body.pickupBranchId) {
      pickupBranchId = body.pickupBranchId;
    } else {
      pickupBranchId = registerBranchId; // Por defecto, misma sucursal
    }

    console.log('Sucursal de registro:', registerBranchId, 'Sucursal de recogida:', pickupBranchId);

    // VALIDACIONES BÁSICAS
    if (!body?.customerId) {
      return res.status(400).json({ error: "customerId es requerido" });
    }

    if (!body.items?.length) {
      return res.status(400).json({ error: "Debe agregar al menos un producto" });
    }

    // TRANSACCIÓN PRISMA
    const result = await prisma.$transaction(async (tx) => {
      // 1. VERIFICAR CLIENTE Y SUCURSALES
      const [customer, pickupBranch, registerBranch] = await Promise.all([
        tx.customer.findUnique({
          where: { id: body.customerId },
          select: { id: true, name: true }
        }),
        tx.branch.findUnique({
          where: { id: pickupBranchId },
          select: { id: true, name: true, isActive: true }
        }),
        tx.branch.findUnique({
          where: { id: registerBranchId },
          select: { id: true, name: true, isActive: true }
        }),
      ]);

      if (!customer) {
        throw new Error("Cliente no existe");
      }

      if (!pickupBranch || !pickupBranch.isActive) {
        throw new Error("Sucursal de recolección no existe o está inactiva");
      }

      if (!registerBranch || !registerBranch.isActive) {
        throw new Error("Sucursal de registro no existe o está inactiva");
      }

      // 2. OBTENER PRODUCTOS
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
              halfStepSpecialPrice: true
            }
          },
          quantityPrices: {
            where: { isActive: true },
            orderBy: { minQty: "asc" }
          },
          variantPrices: {
            where: { isActive: true },
            orderBy: { variantId: "asc" }
          },
          variantQuantityPrices: {
            where: { isActive: true },
            orderBy: [{ variantId: "asc" }, { minQty: "asc" }],
          },
          paramPrices: {
            where: { isActive: true },
            orderBy: { paramId: "asc" }
          },
        },
      });

      // Verificar que todos los productos existan en la sucursal
      const bpMap = new Map<number, (typeof branchProducts)[number]>();
      for (const bp of branchProducts) {
        bpMap.set(bp.productId, bp);
      }

      for (const item of body.items) {
        if (!bpMap.has(item.productId)) {
          const product = await tx.product.findUnique({
            where: { id: item.productId },
            select: { name: true }
          });
          throw new Error(`Producto "${product?.name || item.productId}" no disponible en esta sucursal`);
        }
      }

      // 3. OBTENER PASOS DE PRODUCCIÓN
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

      // 4. CREAR LA ORDEN
      const order = await tx.order.create({
        data: {
          branchId: registerBranchId,
          pickupBranchId,
          customerId: body.customerId,
          stage: OrderStage.REGISTERED,
          shippingType: body.shippingType,
          paymentMethod: body.paymentMethod,
          shippingStage: body.shippingType === "DELIVERY" ? "SHIPPED" : null,
          deliveryDate: new Date(body.deliveryDate),
          deliveryTime: body.deliveryTime ?? null,
          notes: body.notes ?? null,
          total: new Prisma.Decimal("0"),
        },
        select: { id: true },
      });

      console.log('Orden creada ID:', order.id);

      // 5. CREAR ITEMS DE LA ORDEN
      let total = new Prisma.Decimal("0");

      for (const it of body.items) {
        const bp = bpMap.get(it.productId)!;
        const qty = new Prisma.Decimal(it.quantity.toString());

        console.log(`Procesando item: ${bp.product.name}, Cantidad: ${qty.toString()}`);
        console.log(`halfStepSpecialPrice: ${bp.product.halfStepSpecialPrice?.toString() || 'null'}`);
        console.log(`unitType: ${bp.product.unitType}`);

        // Validar cantidad
        if (qty.lte(0)) {
          throw new Error(`La cantidad para "${bp.product.name}" debe ser mayor a 0`);
        }

        // Validar cantidad mínima
        if (qty.lt(bp.product.minQty)) {
          throw new Error(`Cantidad mínima para "${bp.product.name}" es ${bp.product.minQty}`);
        }

        const variantId = it.variantId ?? null;
        const paramIds = Array.isArray(it.paramIds) ? it.paramIds : [];

        // Validar variante requerida
        if (bp.product.needsVariant && !variantId) {
          throw new Error(`El producto "${bp.product.name}" requiere seleccionar un tamaño`);
        }

        // Calcular precio - ¡¡¡USANDO LA FUNCIÓN CORREGIDA!!!
        const price = calcUnitPriceFromBP({
          bp,
          variantId,
          qty,
          paramIds,
          productHalfStepSpecialPrice: bp.product.halfStepSpecialPrice,
          productUnitType: bp.product.unitType
        });

        console.log(`Precio calculado: ${price.unitPrice.toString()}, Fuente: ${price.source}`);

        // IMPORTANTE: Para precio especial 0.5m, el subtotal es el precio especial mismo
        let subtotal: Prisma.Decimal;

        if (price.source === 'half-meter-special') {
          // Para precio especial 0.5m: el total es el precio especial ($100), NO 0.5 × $100
          subtotal = price.unitPrice;
          console.log(`✅ Subtotal especial 0.5m: ${subtotal.toString()} (precio fijo)`);
        } else {
          // Para precios normales: cantidad × precio unitario
          subtotal = price.unitPrice.mul(qty);
          console.log(`💰 Subtotal normal: ${subtotal.toString()} = ${qty.toString()} × ${price.unitPrice.toString()}`);
        }

        total = total.add(subtotal);
        console.log(`Total acumulado: ${total.toString()}`);

        // Crear item
        const createdItem = await tx.orderItem.create({
          data: {
            orderId: order.id,
            productId: it.productId,
            productNameSnapshot: bp.product.name,
            unitTypeSnapshot: bp.product.unitType,
            quantity: qty,
            variantId,
            unitPrice: price.unitPrice,
            subtotal,
            appliedMinQty: price.appliedMinQty,
            currentStepOrder: 1,
            isReady: false,
            productionStep: "AUTO",
          },
          select: { id: true },
        });

        // Guardar parámetros
        if (paramIds.length > 0) {
          // Obtener detalles de parámetros
          const params = await tx.productParam.findMany({
            where: { id: { in: paramIds } },
            select: { id: true, name: true }
          });

          // Crear options para cada parámetro
          for (const param of params) {
            const paramPrice = bp.paramPrices?.find((pp: any) => pp.paramId === param.id);

            await tx.orderItemOption.create({
              data: {
                orderItemId: createdItem.id,
                optionId: param.id,
                name: param.name,
                priceDelta: paramPrice ? paramPrice.priceDelta : new Prisma.Decimal(0)
              }
            });
          }
        }

        // Crear pasos de producción
        const tmpl = stepsByProductId.get(it.productId);
        const steps = tmpl && tmpl.length > 0
          ? tmpl
          : [
            { name: "IMPRESION", order: 1 },
            { name: "LISTO", order: 2 },
          ];

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

      // 6. ACTUALIZAR TOTAL DE LA ORDEN
      await tx.order.update({
        where: { id: order.id },
        data: { total },
      });

      console.log('Total final de la orden:', total.toString());

      return {
        orderId: order.id,
        total: total.toString(),
        branchId: registerBranchId,
        pickupBranchId,
        message: "Pedido creado exitosamente"
      };
    });

    console.log('=== CREATE ORDER COMPLETED ===');
    return res.status(201).json(result);

  } catch (e: any) {
    console.error("Error creando pedido:", e);
    console.error("Stack trace:", e.stack);
    return res.status(400).json({
      error: e?.message ?? "Error creando pedido",
      details: process.env.NODE_ENV === 'development' ? e.stack : undefined
    });
  }
}