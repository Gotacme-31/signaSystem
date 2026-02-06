// controllers/order.controller.ts
import type { Response } from "express";
import { Prisma, OrderStage, ShippingType, PaymentMethod } from "@prisma/client";
import { prisma } from "../lib/prisma";
import type { AuthedRequest } from "../middlewares/auth";

// Función helper para parsear IDs de params
function parseId(param: string | string[] | undefined): number | null {
  if (!param) return null;
  const str = Array.isArray(param) ? param[0] : param;
  const num = parseInt(str, 10);
  return Number.isFinite(num) ? num : null;
}

// Función para calcular precio unitario
async function calculateUnitPrice(
  branchId: number,
  productId: number,
  variantId: number | null,
  quantity: Prisma.Decimal
): Promise<{ unitPrice: Prisma.Decimal; appliedMinQty?: Prisma.Decimal; source: string }> {
  
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

// Crear pedido
export async function createOrder(req: AuthedRequest, res: Response) {
  try {
    const body = req.body as {
      customerId: number;
      pickupBranchId?: number;
      shippingType: ShippingType;
      paymentMethod: PaymentMethod;
      deliveryDate: string;
      deliveryTime?: string;
      notes?: string;
      items: Array<{
        productId: number;
        quantity: string | number;
        variant?: any;
        variantId?: number;
      }>;
    };

    const authUser = req.auth;

    if (!authUser?.branchId) {
      return res.status(400).json({ error: "Usuario sin sucursal asignada" });
    }

    const registerBranchId = authUser.branchId;
    const pickupBranchId = body.pickupBranchId ?? registerBranchId;

    if (!body?.customerId) return res.status(400).json({ error: "customerId es requerido" });
    if (!body.items?.length) return res.status(400).json({ error: "items es requerido" });

    const result = await prisma.$transaction(async (tx) => {
      const [customer, pickupBranch] = await Promise.all([
        tx.customer.findUnique({ where: { id: body.customerId }, select: { id: true } }),
        tx.branch.findUnique({ where: { id: pickupBranchId }, select: { id: true, isActive: true } }),
      ]);

      if (!customer) throw new Error("Cliente no existe");
      if (!pickupBranch || !pickupBranch.isActive) throw new Error("Sucursal de recolección no existe o está inactiva");

      const productIds = body.items.map((i) => i.productId);

      const branchProducts = await tx.branchProduct.findMany({
        where: {
          branchId: registerBranchId,
          productId: { in: productIds },
          isActive: true,
        },
        include: { 
          product: true,
          quantityPrices: {
            where: { isActive: true },
            orderBy: { minQty: 'asc' }
          }
        },
      });

      const bpMap = new Map<number, typeof branchProducts[number]>();
      for (const bp of branchProducts) bpMap.set(bp.productId, bp);

      for (const it of body.items) {
        if (!bpMap.has(it.productId)) {
          throw new Error(`Producto ${it.productId} no disponible en esta sucursal`);
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
          stage: OrderStage.REGISTERED,
          shippingType: body.shippingType,
          paymentMethod: body.paymentMethod,
          shippingStage: body.shippingType === "DELIVERY" ? "SHIPPED" : null,
          deliveryDate: new Date(body.deliveryDate),
          deliveryTime: body.deliveryTime,
          notes: body.notes,
          total: new Prisma.Decimal("0"),
        },
        select: { id: true },
      });

      let total = new Prisma.Decimal("0");

      for (const it of body.items) {
        const bp = bpMap.get(it.productId)!;
        const quantity = new Prisma.Decimal(it.quantity);
        
        if (quantity.lte(0)) throw new Error("La cantidad debe ser mayor a 0");

        // Calcular precio usando la nueva matriz
        const priceResult = await calculateUnitPrice(
          registerBranchId,
          it.productId,
          it.variantId || null,
          quantity
        );

        const unitPrice = priceResult.unitPrice;
        const subtotal = unitPrice.mul(quantity);
        total = total.add(subtotal);

        const createdItem = await tx.orderItem.create({
          data: {
            orderId: order.id,
            productId: it.productId,
            productNameSnapshot: bp.product.name,
            unitTypeSnapshot: bp.product.unitType,
            quantity,
            variant: it.variant ?? undefined,
            variantId: it.variantId || null,
            unitPrice,
            subtotal,
            appliedMinQty: priceResult.appliedMinQty || null,
            currentStepOrder: 1,
            isReady: false,
            productionStep: "AUTO",
          },
          select: { id: true, productId: true },
        });

        const tmpl = stepsByProductId.get(it.productId);
        const steps = tmpl && tmpl.length
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

      await tx.order.update({
        where: { id: order.id },
        data: { total },
      });

      return {
        orderId: order.id,
        total: total.toString(),
        branchId: registerBranchId,
        pickupBranchId,
      };
    });

    return res.status(201).json(result);
  } catch (e: any) {
    console.error('Error creando pedido:', e);
    return res.status(400).json({ error: e?.message ?? "Error creando pedido" });
  }
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
      orderBy: [{ deliveryDate: "asc" }, { id: "desc" }],
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