import type { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";

/**
 * GET /admin/branches
 * Lista sucursales
 */
export async function adminListBranches(_req: Request, res: Response) {
  const branches = await prisma.branch.findMany({ orderBy: { id: "asc" } });
  res.json(branches);
}

/**
 * Asegura BranchProduct para todos los productos en una sucursal
 */
async function ensureBranchProducts(tx: Prisma.TransactionClient, branchId: number) {
  const products = await tx.product.findMany({
    select: { id: true },
    orderBy: { id: "asc" },
  });

  for (const p of products) {
    const exists = await tx.branchProduct.findUnique({
      where: { branchId_productId: { branchId, productId: p.id } },
      select: { id: true },
    });
    if (!exists) {
      await tx.branchProduct.create({
        data: { branchId, productId: p.id, isActive: true, price: new Prisma.Decimal(0) },
      });
    }
  }
}

/**
 * GET /admin/branches/:branchId/products
 * Lista productos de una sucursal con:
 * - precio base
 * - precios por cantidad
 * - precios por tamaño (merge con variantes del producto)
 * - precios por parámetros (merge con params del producto)
 */
export async function adminGetBranchProducts(req: Request, res: Response) {
  const branchId = Number(req.params.branchId);
  
  if (!Number.isFinite(branchId)) return res.status(400).json({ error: "branchId inválido" });
    
  await prisma.$transaction(async (tx) => {
    await ensureBranchProducts(tx, branchId);
  });
  
  const rows = await prisma.branchProduct.findMany({
    where: { branchId },
    orderBy: { productId: "asc" },
    include: {
      product: {
        select: {
          id: true,
          name: true,
          unitType: true,
          needsVariant: true,
          variants: { 
            orderBy: [{ order: "asc" }, { id: "asc" }] 
          },
          params: { 
            orderBy: [{ order: "asc" }, { id: "asc" }] 
          },
        },
      },
      quantityPrices: { 
        where: { isActive: true },
        orderBy: [{ order: "asc" }, { minQty: "asc" }] 
      },
      variantPrices: { 
        where: { isActive: true },
        orderBy: [{ variantId: "asc" }] 
      },
      paramPrices: {
        where: { isActive: true },
        include: { param: { select: { id: true, name: true, isActive: true, order: true } } },
        orderBy: [{ paramId: "asc" }],
      },
    },
    
  });
  console.log("=== DEBUG adminGetBranchProducts ===");
  console.log("Total productos:", rows.length);
  
  const out = rows.map((bp) => {
    // -------- merge variantes
    const priceByVariantId = new Map<number, { id: number; price: any; isActive: boolean }>();
    for (const vp of bp.variantPrices ?? []) {
      priceByVariantId.set(vp.variantId, { 
        id: vp.id, 
        price: vp.price, 
        isActive: vp.isActive 
      });
    }

    // MODIFICACIÓN IMPORTANTE: Mostrar variantes aunque needsVariant sea false
    const mergedVariantPrices = bp.product.variants.map((v) => {
      const found = priceByVariantId.get(v.id);
      return {
        id: found?.id ?? null,
        variantId: v.id,
        variantName: v.name,
        price: found?.price ? found.price.toString() : "0",
        isActive: found?.isActive ?? true,
        variantIsActive: v.isActive,
      };
    });

    // -------- merge params
    const priceByParamId = new Map<number, { id: number; priceDelta: any; isActive: boolean }>();
    for (const pp of bp.paramPrices ?? []) {
      priceByParamId.set(pp.paramId, { 
        id: pp.id, 
        priceDelta: pp.priceDelta, 
        isActive: pp.isActive 
      });
    }

    const mergedParamPrices = bp.product.params.map((p) => {
      const found = priceByParamId.get(p.id);
      return {
        id: found?.id ?? null,
        paramId: p.id,
        paramName: p.name,
        priceDelta: found?.priceDelta ? found.priceDelta.toString() : "0",
        isActive: found?.isActive ?? true,
        paramIsActive: p.isActive,
      };
    });

    return {
      productId: bp.productId,
      isActive: bp.isActive,
      price: bp.price ? bp.price.toString() : "0",
      product: bp.product,
      quantityPrices: (bp.quantityPrices ?? []).map((q) => ({
        id: q.id,
        minQty: q.minQty.toString(),
        unitPrice: q.unitPrice.toString(),
        isActive: q.isActive,
        order: q.order,
      })),
      variantPrices: mergedVariantPrices,
      paramPrices: mergedParamPrices,
    };
  });

  res.json(out);
}

/**
 * PATCH /admin/branches/:branchId/products/:productId/price
 * body: { price, isActive }
 */
export async function adminSetBranchProductPrice(req: Request, res: Response) {
  try {
    const branchId = Number(req.params.branchId);
    const productId = Number(req.params.productId);
    if (!Number.isFinite(branchId) || !Number.isFinite(productId)) return res.status(400).json({ error: "ids inválidos" });

    const body = req.body as { price: string | number; isActive: boolean };

    const price = new Prisma.Decimal(body.price);
    if (price.isNegative()) return res.status(400).json({ error: "price no puede ser negativo" });

    const updated = await prisma.branchProduct.update({
      where: { branchId_productId: { branchId, productId } },
      data: { price, isActive: !!body.isActive },
    });

    res.json({ ok: true, row: updated });
  } catch (e: any) {
    res.status(400).json({ error: e?.message ?? "Error" });
  }
}

/**
 * PUT /admin/branches/:branchId/products/:productId/quantity-prices
 * body: { rows: [{minQty, unitPrice, isActive}] }
 * (Reemplaza lista completa)
 */
export async function adminSetBranchProductQuantityPrices(req: Request, res: Response) {
  try {
    const branchId = Number(req.params.branchId);
    const productId = Number(req.params.productId);
    if (!Number.isFinite(branchId) || !Number.isFinite(productId)) return res.status(400).json({ error: "ids inválidos" });

    const body = req.body as {
      rows: Array<{ minQty: string | number; unitPrice: string | number; isActive: boolean }>;
    };
    if (!Array.isArray(body.rows)) return res.status(400).json({ error: "rows requerido (array)" });

    const bp = await prisma.branchProduct.findUnique({
      where: { branchId_productId: { branchId, productId } },
      select: { id: true },
    });
    if (!bp) return res.status(404).json({ error: "BranchProduct no existe" });

    const rows = body.rows.map((r, idx) => ({
      minQty: new Prisma.Decimal(r.minQty),
      unitPrice: new Prisma.Decimal(r.unitPrice),
      isActive: !!r.isActive,
      order: idx,
    }));

    for (const r of rows) {
      if (r.minQty.lte(0)) return res.status(400).json({ error: "minQty debe ser > 0" });
      if (r.unitPrice.isNegative()) return res.status(400).json({ error: "unitPrice no puede ser negativo" });
    }

    const seen = new Set<string>();
    for (const r of rows) {
      const key = r.minQty.toFixed(3);
      if (seen.has(key)) return res.status(400).json({ error: `Cantidad mínima duplicada: ${key}` });
      seen.add(key);
    }

    await prisma.$transaction(async (tx) => {
      await tx.branchProductQuantityPrice.deleteMany({ where: { branchProductId: bp.id } });
      if (rows.length) {
        await tx.branchProductQuantityPrice.createMany({
          data: rows.map((r) => ({
            branchProductId: bp.id,
            minQty: r.minQty,
            unitPrice: r.unitPrice,
            isActive: r.isActive,
            order: r.order,
          })),
        });
      }
    });

    res.json({ ok: true });
  } catch (e: any) {
    res.status(400).json({ error: e?.message ?? "Error" });
  }
}

/**
 * PUT /admin/branches/:branchId/products/:productId/variant-prices
 * body: { rows: [{variantId, price, isActive}] }
 * (Reemplaza lista completa)
 */
export async function adminSetBranchProductVariantPrices(req: Request, res: Response) {
  try {
    const branchId = Number(req.params.branchId);
    const productId = Number(req.params.productId);
    if (!Number.isFinite(branchId) || !Number.isFinite(productId)) return res.status(400).json({ error: "ids inválidos" });

    const body = req.body as {
      rows: Array<{ variantId: number; price: string | number; isActive: boolean }>;
    };
    if (!Array.isArray(body.rows)) return res.status(400).json({ error: "rows requerido (array)" });

    const bp = await prisma.branchProduct.findUnique({
      where: { branchId_productId: { branchId, productId } },
      select: { id: true },
    });
    if (!bp) return res.status(404).json({ error: "BranchProduct no existe" });

    const validVariantIds = new Set(
      (await prisma.productVariant.findMany({ where: { productId }, select: { id: true } })).map((v) => v.id)
    );

    const rows = body.rows.map((r) => ({
      variantId: Number(r.variantId),
      price: new Prisma.Decimal(r.price),
      isActive: !!r.isActive,
    }));

    for (const r of rows) {
      if (!Number.isFinite(r.variantId) || !validVariantIds.has(r.variantId)) {
        return res.status(400).json({ error: `variantId inválido para este producto: ${r.variantId}` });
      }
      if (r.price.isNegative()) return res.status(400).json({ error: "price no puede ser negativo" });
    }

    await prisma.$transaction(async (tx) => {
      await tx.branchProductVariantPrice.deleteMany({ where: { branchProductId: bp.id } });
      if (rows.length) {
        await tx.branchProductVariantPrice.createMany({
          data: rows.map((r) => ({
            branchProductId: bp.id,
            variantId: r.variantId,
            price: r.price,
            isActive: r.isActive,
          })),
        });
      }
    });

    res.json({ ok: true });
  } catch (e: any) {
    res.status(400).json({ error: e?.message ?? "Error" });
  }
}

/**
 * ✅ NUEVO
 * PUT /admin/branches/:branchId/products/:productId/param-prices
 * body: { rows: [{ paramId, priceDelta, isActive }] }
 * (Reemplaza lista completa)
 */
export async function adminSetBranchProductParamPrices(req: Request, res: Response) {
  try {
    const branchId = Number(req.params.branchId);
    const productId = Number(req.params.productId);
    if (!Number.isFinite(branchId) || !Number.isFinite(productId)) return res.status(400).json({ error: "ids inválidos" });

    const body = req.body as {
      rows: Array<{ paramId: number; priceDelta: string | number; isActive: boolean }>;
    };
    if (!Array.isArray(body.rows)) return res.status(400).json({ error: "rows requerido (array)" });

    const bp = await prisma.branchProduct.findUnique({
      where: { branchId_productId: { branchId, productId } },
      select: { id: true },
    });
    if (!bp) return res.status(404).json({ error: "BranchProduct no existe" });

    const validParamIds = new Set(
      (await prisma.productParam.findMany({ where: { productId }, select: { id: true } })).map((p) => p.id)
    );

    const rows = body.rows.map((r) => ({
      paramId: Number(r.paramId),
      priceDelta: new Prisma.Decimal(r.priceDelta),
      isActive: !!r.isActive,
    }));

    for (const r of rows) {
      if (!Number.isFinite(r.paramId) || !validParamIds.has(r.paramId)) {
        return res.status(400).json({ error: `paramId inválido para este producto: ${r.paramId}` });
      }
      // priceDelta puede ser negativo (resta) o positivo (suma)
    }

    await prisma.$transaction(async (tx) => {
      await tx.branchProductParamPrice.deleteMany({ where: { branchProductId: bp.id } });
      if (rows.length) {
        await tx.branchProductParamPrice.createMany({
          data: rows.map((r) => ({
            branchProductId: bp.id,
            paramId: r.paramId,
            priceDelta: r.priceDelta,
            isActive: r.isActive,
          })),
        });
      }
    });

    res.json({ ok: true });
  } catch (e: any) {
    res.status(400).json({ error: e?.message ?? "Error" });
  }
}
