import type { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";

export async function listBranches(_req: Request, res: Response) {
  const branches = await prisma.branch.findMany({
    orderBy: { id: "asc" },
    select: { id: true, name: true, isActive: true },
  });
  res.json(branches);
}
export async function listBranchProducts(req: Request, res: Response) {
  try {
    const branchId = Number(req.params.branchId);
    if (!Number.isFinite(branchId)) return res.status(400).json({ error: "branchId inválido" });

    const rows = await prisma.branchProduct.findMany({
      where: { branchId },
      orderBy: [{ productId: "asc" }],
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

            // ✅ catálogo params
            params: {
              select: { id: true, name: true, isActive: true },
            },

            // ⚠️ si tu front usa "variants" en r.product.variants para mensajes/merge
            variants: {
              select: { id: true, name: true, isActive: true },
              orderBy: { order: "asc" }, // si NO tienes "order", bórralo
            },
          },
        },

        quantityPrices: { orderBy: [{ minQty: "asc" }] },

        variantPrices: {
          include: { variant: { select: { id: true, name: true, isActive: true } } },
          orderBy: [{ variantId: "asc" }],
        },

        // ✅ matriz guardada en BD
        variantQuantityPrices: {
          orderBy: [{ variantId: "asc" }, { order: "asc" }, { minQty: "asc" }],
        },

        // ✅ precios params guardados en sucursal
        paramPrices: {
          include: { param: { select: { id: true, name: true, isActive: true } } },
          orderBy: [{ paramId: "asc" }],
        },
      },
    });

    const mapped = rows.map((r) => {
      // ---- matriz variant+qty ----
      const matrix: Record<number, Array<{ id?: number | null; minQty: string; unitPrice: string; isActive: boolean }>> = {};
      for (const row of r.variantQuantityPrices ?? []) {
        if (!matrix[row.variantId]) matrix[row.variantId] = [];
        matrix[row.variantId].push({
          id: row.id,
          minQty: row.minQty.toString(),
          unitPrice: row.unitPrice.toString(),
          isActive: row.isActive,
        });
      }

      // ---- merge params (catálogo + sucursal) ----
      const savedParamMap = new Map(
        (r.paramPrices ?? []).map((pp) => [
          pp.paramId,
          {
            id: pp.id,
            priceDelta: pp.priceDelta,
            isActive: pp.isActive,
            paramIsActive: pp.param?.isActive,
            paramName: pp.param?.name,
          },
        ])
      );

      const mergedParamPrices = (r.product.params ?? []).map((p) => {
        const saved = savedParamMap.get(p.id);
        return {
          id: saved?.id ?? null,
          paramId: p.id,
          paramName: p.name,
          priceDelta: (saved?.priceDelta ?? new Prisma.Decimal(0)).toString(),
          isActive: saved?.isActive ?? true,
          paramIsActive: p.isActive ?? true,
        };
      });

      // ---- merge variants (catálogo + sucursal) ----
      // esto asegura que siempre salgan tamaños aunque no tengan precio guardado
      const savedVariantMap = new Map((r.variantPrices ?? []).map((vp) => [vp.variantId, vp]));
      const mergedVariantPrices = (r.product.variants ?? []).map((v) => {
        const saved = savedVariantMap.get(v.id);
        return {
          id: saved?.id ?? null,
          variantId: v.id,
          variantName: v.name,
          price: (saved?.price ?? new Prisma.Decimal(0)).toString(),
          isActive: saved?.isActive ?? true,
          variantIsActive: v.isActive ?? true,
        };
      });

      return {
        id: r.id,
        productId: r.productId,
        isActive: r.isActive,
        price: r.price.toString(), // <- o Number(...) si quieres number
        product: {
          ...r.product,
          minQty: r.product.minQty, // si ya es number ok
          qtyStep: r.product.qtyStep,
          halfStepSpecialPrice: r.product.halfStepSpecialPrice?.toString() ?? null,
        },

        // ✅ SOLO ACTIVOS y serializados a string
        quantityPrices: (r.quantityPrices ?? [])
          .filter(qp => qp.isActive)
          .map(qp => ({
            minQty: qp.minQty.toString(),
            unitPrice: qp.unitPrice.toString(),
            isActive: qp.isActive,
          })),

        // ✅ mergedVariantPrices (ya lo haces)
        variantPrices: mergedVariantPrices.map(vp => ({
          ...vp,
          price: vp.price.toString(),
        })),

        // ✅ mergedParamPrices (ya lo haces)
        paramPrices: mergedParamPrices.map(pp => ({
          ...pp,
          priceDelta: pp.priceDelta.toString(),
        })),

        // ✅ IMPORTANTÍSIMO: el front espera variantQuantityPrices como array,
        // no "variantQuantityMatrix"
        variantQuantityPrices: (r.variantQuantityPrices ?? [])
          .filter(vqp => vqp.isActive)
          .map(vqp => ({
            variantId: vqp.variantId,
            variantName:
              r.product.variants?.find(v => v.id === vqp.variantId)?.name ?? `Variante ${vqp.variantId}`,
            minQty: vqp.minQty.toString(),
            unitPrice: vqp.unitPrice.toString(),
            isActive: vqp.isActive,
            variantIsActive: r.product.variants?.find(v => v.id === vqp.variantId)?.isActive ?? true,
          })),
      };

    });

    return res.json(mapped);
  } catch (e: any) {
    return res.status(500).json({ error: e?.message ?? "Error interno" });
  }
}

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
    if (decimalPrice.isNegative()) return res.status(400).json({ error: "El precio no puede ser negativo" });

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

export async function setBranchProductQuantityPrices(req: Request, res: Response) {
  try {
    const branchId = Number(req.params.branchId);
    const productId = Number(req.params.productId);
    if (!Number.isFinite(branchId) || !Number.isFinite(productId)) return res.status(400).json({ error: "ids inválidos" });

    const body = req.body as {
      prices?: Array<{ minQty: string | number; unitPrice: string | number; isActive: boolean }>;
    };
    if (!Array.isArray(body.prices)) return res.status(400).json({ error: "prices es requerido (array)" });

    const bp = await prisma.branchProduct.upsert({
      where: { branchId_productId: { branchId, productId } },
      create: {
        branchId,
        productId,
        price: new Prisma.Decimal(0),
        isActive: true,
      },
      update: {},
      select: { id: true },
    });

    const rows = body.prices.map((p, idx) => {
      const minQty = new Prisma.Decimal(p.minQty);
      const unitPrice = new Prisma.Decimal(p.unitPrice);
      if (minQty.lte(0)) throw new Error("minQty debe ser mayor a 0");
      if (unitPrice.isNegative()) throw new Error("unitPrice no puede ser negativo");
      return { minQty, unitPrice, isActive: !!p.isActive, order: idx };
    });

    // evita duplicados por minQty
    const seen = new Set<string>();
    for (const r of rows) {
      const k = r.minQty.toFixed(3);
      if (seen.has(k)) throw new Error(`Cantidad mínima duplicada: ${k}`);
      seen.add(k);
    }

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
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

export async function setBranchProductVariantPrices(req: Request, res: Response) {
  try {
    const branchId = Number(req.params.branchId);
    const productId = Number(req.params.productId);
    if (!Number.isFinite(branchId) || !Number.isFinite(productId)) return res.status(400).json({ error: "ids inválidos" });

    const body = req.body as {
      variantPrices?: Array<{ variantId: number; price: string | number; isActive: boolean }>;
    };
    if (!Array.isArray(body.variantPrices)) return res.status(400).json({ error: "variantPrices es requerido (array)" });

    const bp = await prisma.branchProduct.upsert({
      where: { branchId_productId: { branchId, productId } },
      create: {
        branchId,
        productId,
        price: new Prisma.Decimal(0),
        isActive: true,
      },
      update: {},
      select: { id: true },
    });

    const validVariantIds = new Set(
      (await prisma.productVariant.findMany({ where: { productId }, select: { id: true } })).map((v) => v.id)
    );

    const rows = body.variantPrices.map((v) => {
      if (!validVariantIds.has(v.variantId)) throw new Error(`variantId inválido para este producto: ${v.variantId}`);
      const price = new Prisma.Decimal(v.price);
      if (price.isNegative()) throw new Error("El precio no puede ser negativo");
      return { variantId: v.variantId, price, isActive: !!v.isActive };
    });

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
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
// Obtener matriz de precios por variante y cantidad
export async function getBranchProductVariantQuantityMatrix(req: Request, res: Response) {
  try {
    const branchId = Number(req.params.branchId);
    const productId = Number(req.params.productId);

    if (!Number.isFinite(branchId) || !Number.isFinite(productId)) {
      return res.status(400).json({ error: "branchId/productId inválidos" });
    }

    // Buscar el BranchProduct
    const bp = await prisma.branchProduct.upsert({
      where: { branchId_productId: { branchId, productId } },
      create: {
        branchId,
        productId,
        price: new Prisma.Decimal(0),
        isActive: true,
      },
      update: {},
      select: { id: true },
    });


    // Obtener todos los precios por variante y cantidad
    const variantQuantityPrices = await prisma.branchProductVariantQuantityPrice.findMany({
      where: { branchProductId: bp.id },
      orderBy: [{ variantId: "asc" }, { order: "asc" }, { minQty: "asc" }],
    });

    // Transformar a la estructura que espera el frontend
    const matrix: Record<number, Array<{
      id?: number | null;
      minQty: string;
      unitPrice: string;
      isActive: boolean;
    }>> = {};

    for (const price of variantQuantityPrices) {
      if (!matrix[price.variantId]) {
        matrix[price.variantId] = [];
      }

      matrix[price.variantId].push({
        id: price.id,
        minQty: price.minQty.toString(),
        unitPrice: price.unitPrice.toString(),
        isActive: price.isActive,
      });
    }

    res.json({ matrix });
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? "Error interno" });
  }
}

// Guardar matriz de precios por variante y cantidad
export async function setBranchProductVariantQuantityMatrix(req: Request, res: Response) {
  try {
    const branchId = Number(req.params.branchId);
    const productId = Number(req.params.productId);

    if (!Number.isFinite(branchId) || !Number.isFinite(productId)) {
      return res.status(400).json({ error: "branchId/productId inválidos" });
    }

    const body = req.body as {
      matrix?: Record<string, Array<{ minQty: string | number; unitPrice: string | number; isActive: boolean }>>;
    };

    if (!body.matrix || typeof body.matrix !== 'object') {
      return res.status(400).json({ error: "matrix es requerido (objeto)" });
    }

    // Buscar el BranchProduct
    const bp = await prisma.branchProduct.upsert({
      where: { branchId_productId: { branchId, productId } },
      create: {
        branchId,
        productId,
        price: new Prisma.Decimal(0),
        isActive: true,
      },
      update: {},
      select: { id: true },
    });


    // Validar variantes
    const validVariantIds = new Set(
      (await prisma.productVariant.findMany({ where: { productId }, select: { id: true } })).map((v) => v.id)
    );

    // Preparar datos para guardar
    const allRows: Array<{
      branchProductId: number;
      variantId: number;
      minQty: Prisma.Decimal;
      unitPrice: Prisma.Decimal;
      isActive: boolean;
      order: number;
    }> = [];

    let globalOrder = 0;

    for (const [variantIdStr, prices] of Object.entries(body.matrix)) {
      const variantId = Number(variantIdStr);

      if (!validVariantIds.has(variantId)) {
        return res.status(400).json({ error: `variantId inválido: ${variantId}` });
      }

      if (!Array.isArray(prices)) {
        return res.status(400).json({ error: `Los precios para variantId ${variantId} deben ser un array` });
      }

      const seen = new Set<string>();

      for (const [idx, price] of prices.entries()) {
        const minQty = new Prisma.Decimal(price.minQty);
        const unitPrice = new Prisma.Decimal(price.unitPrice);

        // Validaciones
        if (minQty.lte(0)) {
          return res.status(400).json({ error: `variantId ${variantId}: minQty debe ser mayor a 0` });
        }
        if (unitPrice.isNegative()) {
          return res.status(400).json({ error: `variantId ${variantId}: unitPrice no puede ser negativo` });
        }

        // Evitar duplicados
        const key = minQty.toFixed(3);
        if (seen.has(key)) {
          return res.status(400).json({ error: `variantId ${variantId}: cantidad mínima duplicada: ${key}` });
        }
        seen.add(key);

        allRows.push({
          branchProductId: bp.id,
          variantId,
          minQty,
          unitPrice,
          isActive: !!price.isActive,
          order: globalOrder++,
        });
      }
    }

    // Guardar en transacción
    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // Eliminar precios existentes para este BranchProduct
      await tx.branchProductVariantQuantityPrice.deleteMany({
        where: { branchProductId: bp.id },
      });

      // Insertar nuevos precios si hay
      if (allRows.length > 0) {
        await tx.branchProductVariantQuantityPrice.createMany({
          data: allRows,
        });
      }
    });

    res.json({ ok: true });
  } catch (e: any) {
    res.status(400).json({ error: e?.message ?? "Error" });
  }
}
export async function setBranchProductParamPrices(req: Request, res: Response) {
  try {
    const branchId = Number(req.params.branchId);
    const productId = Number(req.params.productId);
    if (!Number.isFinite(branchId) || !Number.isFinite(productId)) {
      return res.status(400).json({ error: "ids inválidos" });
    }

    const body = req.body as {
      paramPrices?: Array<{ paramId: number; priceDelta: string | number; isActive: boolean }>;
    };
    if (!Array.isArray(body.paramPrices)) {
      return res.status(400).json({ error: "paramPrices es requerido (array)" });
    }

    // asegurar BranchProduct exista
    const bp = await prisma.branchProduct.upsert({
      where: { branchId_productId: { branchId, productId } },
      create: { branchId, productId, price: new Prisma.Decimal(0), isActive: true },
      update: {},
      select: { id: true },
    });

    // validar params válidos del producto
    const validParamIds = new Set(
      (await prisma.productParam.findMany({ where: { productId }, select: { id: true } })).map((p) => p.id)
    );

    const rows = body.paramPrices.map((p) => {
      if (!validParamIds.has(p.paramId)) throw new Error(`paramId inválido para este producto: ${p.paramId}`);
      const priceDelta = new Prisma.Decimal(p.priceDelta);
      // puede ser negativo, así que NO validamos isNegative aquí
      return { paramId: p.paramId, priceDelta, isActive: !!p.isActive };
    });

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
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

    return res.json({ ok: true });
  } catch (e: any) {
    return res.status(400).json({ error: e?.message ?? "Error" });
  }
}
