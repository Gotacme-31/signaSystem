import type { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";

export async function setBranchProductPrice(req: Request, res: Response) {
  try {
    const branchId = Number(req.params.branchId);
    const productId = Number(req.params.productId);
    const { price, isActive } = req.body as { price: string | number; isActive?: boolean };

    if (!Number.isFinite(branchId) || !Number.isFinite(productId)) {
      return res.status(400).json({ error: "branchId/productId inválidos" });
    }
    if (price === undefined || price === null || price === "") {
      return res.status(400).json({ error: "price es requerido" });
    }

    const decimalPrice = new Prisma.Decimal(price);
    if (decimalPrice.isNegative()) {
      return res.status(400).json({ error: "El precio no puede ser negativo" });
    }

    // opcional pero recomendado: validar existencia
    const [branch, product] = await Promise.all([
      prisma.branch.findUnique({ where: { id: branchId }, select: { id: true } }),
      prisma.product.findUnique({ where: { id: productId }, select: { id: true } }),
    ]);
    if (!branch) return res.status(404).json({ error: "Sucursal no existe" });
    if (!product) return res.status(404).json({ error: "Producto no existe" });

    const updated = await prisma.branchProduct.upsert({
      where: { branchId_productId: { branchId, productId } },
      create: {
        branchId,
        productId,
        price: decimalPrice,
        isActive: isActive ?? true,
      },
      update: {
        price: decimalPrice,
        isActive: isActive ?? true,
      },
    });

    return res.json(updated);
  } catch (e: any) {
    return res.status(500).json({ error: e?.message ?? "Error interno" });
  }
}
