import type { Request, Response } from "express";
import { Prisma, OrderStage, ShippingType, PaymentMethod } from "@prisma/client";
import { prisma } from "../lib/prisma";

export async function createOrder(req: Request, res: Response) {
  try {
    // branchId ya NO se confía del body; lo tomamos del usuario
    const body = req.body as {
      customerId: number;
      pickupBranchId?: number; // ✅ nuevo

      shippingType: ShippingType;
      paymentMethod: PaymentMethod;
      deliveryDate: string; // ISO
      deliveryTime?: string;
      notes?: string;

      items: Array<{
        productId: number;
        quantity: string | number;
        variant?: any;
        productionStep: string;
      }>;
    };

    const authUser = (req as any).user as { role: string; branchId?: number } | undefined;

    if (!authUser?.branchId) {
      return res.status(400).json({ error: "Usuario sin sucursal asignada" });
    }

    const registerBranchId = authUser.branchId; // ✅ sucursal que registra SIEMPRE del usuario
    const pickupBranchId = body.pickupBranchId ?? registerBranchId; // ✅ por defecto la misma

    if (!body?.customerId) {
      return res.status(400).json({ error: "customerId es requerido" });
    }
    if (!body.items?.length) {
      return res.status(400).json({ error: "items es requerido" });
    }

    const result = await prisma.$transaction(async (tx) => {
      // 1) Validar cliente + sucursal recolección
      const [customer, pickupBranch] = await Promise.all([
        tx.customer.findUnique({ where: { id: body.customerId }, select: { id: true } }),
        tx.branch.findUnique({ where: { id: pickupBranchId }, select: { id: true, isActive: true } }),
      ]);

      if (!customer) throw new Error("Cliente no existe");
      if (!pickupBranch || !pickupBranch.isActive) throw new Error("Sucursal de recolección no existe o está inactiva");

      // 2) Validar productos y precios de la sucursal que REGISTRA (registerBranchId)
      const productIds = body.items.map((i) => i.productId);

      const branchProducts = await tx.branchProduct.findMany({
        where: {
          branchId: registerBranchId,
          productId: { in: productIds },
          isActive: true,
        },
        include: { product: true },
      });

      const priceMap = new Map<number, typeof branchProducts[number]>();
      for (const bp of branchProducts) priceMap.set(bp.productId, bp);

      for (const it of body.items) {
        if (!priceMap.has(it.productId)) {
          throw new Error(`Producto ${it.productId} no disponible en esta sucursal`);
        }
      }

      // 3) Crear order con branchId = sucursal del usuario y pickupBranchId seleccionable
      const order = await tx.order.create({
        data: {
          branchId: registerBranchId,
          pickupBranchId, // ✅ nuevo en DB
          customerId: body.customerId,
          stage: OrderStage.REGISTERED,
          shippingType: body.shippingType,
          paymentMethod: body.paymentMethod,
          deliveryDate: new Date(body.deliveryDate),
          deliveryTime: body.deliveryTime,
          notes: body.notes,
          total: new Prisma.Decimal("0"),
        },
        select: { id: true },
      });

      let total = new Prisma.Decimal("0");

      // 4) Items
      for (const it of body.items) {
        const bp = priceMap.get(it.productId)!;

        const quantity = new Prisma.Decimal(it.quantity);
        if (quantity.lte(0)) throw new Error("La cantidad debe ser mayor a 0");

        const unitPrice = bp.price; // por ahora tu precio simple (luego lo cambiamos a metro/medio)
        const subtotal = unitPrice.mul(quantity);

        total = total.add(subtotal);

        await tx.orderItem.create({
          data: {
            orderId: order.id,
            productId: it.productId,
            productNameSnapshot: bp.product.name,
            unitTypeSnapshot: bp.product.unitType,
            quantity,
            variant: it.variant ?? undefined,
            unitPrice,
            subtotal,
            productionStep: it.productionStep,
          },
        });
      }

      await tx.order.update({
        where: { id: order.id },
        data: { total },
      });

      return { orderId: order.id, total: total.toString(), branchId: registerBranchId, pickupBranchId };
    });

    return res.status(201).json(result);
  } catch (e: any) {
    return res.status(400).json({ error: e?.message ?? "Error creando pedido" });
  }
}
