import type { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";

// GET /admin/products/:id  (detalle completo)
export async function adminGetProduct(req: Request, res: Response) {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "id inválido" });

  const product = await prisma.product.findUnique({
    where: { id },
    include: {
      processSteps: { orderBy: { order: "asc" } },
      variants: { orderBy: [{ order: "asc" }, { id: "asc" }] },

      // ✅ params catálogo
      params: { orderBy: [{ order: "asc" }, { id: "asc" }] },

      // Legacy (si aún lo usas)
      optionGroups: {
        orderBy: [{ order: "asc" }, { id: "asc" }],
        include: { options: { orderBy: [{ order: "asc" }, { id: "asc" }] } },
      },
    },
  });

  if (!product) return res.status(404).json({ error: "Producto no existe" });
  res.json({ product });
}

// PUT /admin/products/:id/rules
export async function adminUpdateProductRules(req: Request, res: Response) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "id inválido" });

    const body = req.body as {
      minQty?: string | number;
      qtyStep?: string | number;
      halfStepSpecialPrice?: string | number | null;
    };

    const data: Prisma.ProductUpdateInput = {};

    if (body.minQty !== undefined) {
      const v = new Prisma.Decimal(body.minQty);
      if (v.lte(0)) return res.status(400).json({ error: "minQty debe ser > 0" });
      data.minQty = v;
    }

    if (body.qtyStep !== undefined) {
      const v = new Prisma.Decimal(body.qtyStep);
      if (v.lte(0)) return res.status(400).json({ error: "qtyStep debe ser > 0" });
      data.qtyStep = v;
    }

    if (body.halfStepSpecialPrice !== undefined) {
      if (body.halfStepSpecialPrice === null || body.halfStepSpecialPrice === "") {
        data.halfStepSpecialPrice = null;
      } else {
        const v = new Prisma.Decimal(body.halfStepSpecialPrice);
        if (v.isNegative()) return res.status(400).json({ error: "halfStepSpecialPrice no puede ser negativo" });
        data.halfStepSpecialPrice = v;
      }
    }

    const product = await prisma.product.update({ where: { id }, data });
    res.json({ product });
  } catch (e: any) {
    res.status(400).json({ error: e?.message ?? "Error" });
  }
}

// PUT /admin/products/:id/variants  (reemplaza lista completa)
export async function adminSetProductVariants(req: Request, res: Response) {
  try {
    const productId = Number(req.params.id);
    if (!Number.isFinite(productId)) return res.status(400).json({ error: "id inválido" });

    const body = req.body as {
      variants?: Array<{ name: string; isActive: boolean; order: number }>;
    };

    if (!Array.isArray(body.variants)) return res.status(400).json({ error: "variants es requerido (array)" });

    const variants = body.variants
      .map((v) => ({
        name: String(v.name ?? "").trim(),
        isActive: !!v.isActive,
        order: Number.isFinite(v.order) ? v.order : 0,
      }))
      .filter((v) => v.name.length > 0);

    const seen = new Set<string>();
    for (const v of variants) {
      const key = v.name.toUpperCase();
      if (seen.has(key)) return res.status(400).json({ error: `Tamaño duplicado: ${v.name}` });
      seen.add(key);
    }

    await prisma.$transaction(async (tx) => {
      await tx.productVariant.deleteMany({ where: { productId } });
      if (variants.length) {
        await tx.productVariant.createMany({
          data: variants.map((v) => ({ productId, name: v.name, isActive: v.isActive, order: v.order })),
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
 * PUT /admin/products/:id/params
 * body: { params: [{ name, isActive, order? }] }
 * Catálogo de parámetros (sin precio).
 */
export async function adminSetProductParams(req: Request, res: Response) {
  try {
    const productId = Number(req.params.id);
    if (!Number.isFinite(productId)) return res.status(400).json({ error: "id inválido" });

    const body = req.body as {
      params?: Array<{ name: string; isActive: boolean; order?: number }>;
    };

    if (!Array.isArray(body.params)) return res.status(400).json({ error: "params es requerido (array)" });

    const params = body.params
      .map((p, i) => ({
        name: String(p.name ?? "").trim(),
        isActive: !!p.isActive,
        order: Number.isFinite(p.order) ? Number(p.order) : i,
      }))
      .filter((p) => p.name.length > 0);

    const seen = new Set<string>();
    for (const p of params) {
      const key = p.name.toUpperCase();
      if (seen.has(key)) return res.status(400).json({ error: `Parámetro duplicado: ${p.name}` });
      seen.add(key);
    }

    await prisma.$transaction(async (tx) => {
      await tx.productParam.deleteMany({ where: { productId } });
      if (params.length) {
        await tx.productParam.createMany({
          data: params.map((p) => ({
            productId,
            name: p.name,
            isActive: p.isActive,
            order: p.order,
          })),
        });
      }
    });

    res.json({ ok: true });
  } catch (e: any) {
    res.status(400).json({ error: e?.message ?? "Error" });
  }
}
// PUT /admin/products/:id/process-steps
export async function adminSetProcessSteps(req: Request, res: Response) {
  try {
    const productId = Number(req.params.id);
    if (!Number.isFinite(productId)) return res.status(400).json({ error: "id inválido" });

    const body = req.body as { steps?: string[] };
    if (!Array.isArray(body.steps)) return res.status(400).json({ error: "steps es requerido (array)" });

    const steps = body.steps
      .map((s, i) => ({ name: String(s ?? "").trim(), order: i }))
      .filter((s) => s.name.length > 0);

    await prisma.$transaction(async (tx) => {
      await tx.productProcessStep.deleteMany({ where: { productId } });
      if (steps.length) {
        await tx.productProcessStep.createMany({
          data: steps.map((s) => ({
            productId,
            name: s.name,
            order: s.order,
            isActive: true,
          })),
        });
      }
    });

    res.json({ ok: true });
  } catch (e: any) {
    res.status(400).json({ error: e?.message ?? "Error" });
  }
}
// PATCH /admin/products/:id (actualizar datos básicos)
export async function adminUpdateProduct(req: Request, res: Response) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "id inválido" });

    const body = req.body as {
      name?: string;
      unitType?: 'METER' | 'PIECE';
      needsVariant?: boolean;
      isActive?: boolean;
    };

    const data: Prisma.ProductUpdateInput = {};

    if (body.name !== undefined) {
      const trimmed = String(body.name ?? '').trim();
      if (trimmed.length === 0) return res.status(400).json({ error: "Nombre no puede estar vacío" });
      data.name = trimmed;
    }

    if (body.unitType !== undefined) {
      if (!['METER', 'PIECE'].includes(body.unitType)) {
        return res.status(400).json({ error: "unitType debe ser METER o PIECE" });
      }
      data.unitType = body.unitType;
    }

    if (body.needsVariant !== undefined) {
      data.needsVariant = !!body.needsVariant;
    }

    if (body.isActive !== undefined) {
      data.isActive = !!body.isActive;
    }

    // Verificar duplicado de nombre si se cambia
    if (body.name !== undefined) {
      const existing = await prisma.product.findFirst({
        where: {
          name: data.name as string,
          NOT: { id },
        },
      });
      if (existing) return res.status(400).json({ error: "Ya existe otro producto con ese nombre" });
    }

    const product = await prisma.product.update({
      where: { id },
      data,
      include: {
        processSteps: { orderBy: { order: 'asc' } },
        variants: { orderBy: [{ order: 'asc' }, { id: 'asc' }] },
        params: { orderBy: [{ order: 'asc' }, { id: 'asc' }] },
        optionGroups: {
          orderBy: [{ order: 'asc' }, { id: 'asc' }],
          include: { options: { orderBy: [{ order: 'asc' }, { id: 'asc' }] } },
        },
      },
    });

    res.json({ product });
  } catch (e: any) {
    res.status(400).json({ error: e?.message ?? 'Error' });
  }
}