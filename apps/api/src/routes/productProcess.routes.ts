import { Router } from "express";
import { prisma } from "../lib/prisma";
import { auth, requireAdmin, type AuthedRequest } from "../middlewares/auth";

const router = Router();

/**
 * GET /admin/products
 * Lista completa para Admin (activos + inactivos)
 */
router.get("/admin/products", auth, requireAdmin, async (_req: AuthedRequest, res) => {
  const products = await prisma.product.findMany({
    orderBy: { id: "asc" },
    include: {
      processSteps: {
        where: { isActive: true },
        orderBy: { order: "asc" },
        select: { id: true, name: true, order: true },
      },
    },
  });

  res.json({ products });
});

/**
 * POST /admin/products
 * Crear producto (ADMIN)
 */
router.post("/admin/products", auth, requireAdmin, async (req: AuthedRequest, res) => {
  const { name, unitType, needsVariant } = req.body as {
    name?: string;
    unitType?: "METER" | "PIECE";
    needsVariant?: boolean;
  };

  if (!name?.trim()) return res.status(400).json({ error: "name es requerido" });
  if (!unitType) return res.status(400).json({ error: "unitType es requerido" });

  const product = await prisma.product.create({
    data: {
      name: name.trim(),
      unitType,
      needsVariant: typeof needsVariant === "boolean" ? needsVariant : false,
      isActive: true,
    },
  });

  res.status(201).json({ product });
});

/**
 * PUT /admin/products/:id
 * Editar producto (ADMIN)
 */
router.put("/admin/products/:id", auth, requireAdmin, async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "id inválido" });

  const { name, unitType, needsVariant, isActive } = req.body as {
    name?: string;
    unitType?: "METER" | "PIECE";
    needsVariant?: boolean;
    isActive?: boolean;
  };

  const data: any = {};
  if (typeof name === "string") data.name = name.trim();
  if (unitType) data.unitType = unitType;
  if (typeof needsVariant === "boolean") data.needsVariant = needsVariant;
  if (typeof isActive === "boolean") data.isActive = isActive;

  const product = await prisma.product.update({
    where: { id },
    data,
  });

  res.json({ product });
});

/**
 * PATCH /admin/products/:id/toggle
 * Activar/desactivar (soft delete)
 */
router.patch("/admin/products/:id/toggle", auth, requireAdmin, async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "id inválido" });

  const p = await prisma.product.findUnique({ where: { id }, select: { id: true, isActive: true } });
  if (!p) return res.status(404).json({ error: "Producto no existe" });

  const product = await prisma.product.update({
    where: { id },
    data: { isActive: !p.isActive },
  });

  res.json({ product });
});

/**
 * PUT /admin/products/:productId/process-steps
 * body: { steps: ["IMPRESION","CALANDRADO","ACABADOS","LISTO"] }
 *
 * Nota: Borra y vuelve a crear (como lo tenías) porque es lo más simple y limpio.
 */
router.put("/admin/products/:productId/process-steps", auth, requireAdmin, async (req: AuthedRequest, res) => {
  const productId = Number(req.params.productId);
  const body = req.body as { steps?: string[] };

  if (!Number.isFinite(productId)) return res.status(400).json({ error: "productId inválido" });
  if (!body.steps || !Array.isArray(body.steps) || body.steps.length === 0) {
    return res.status(400).json({ error: "steps es requerido (array)" });
  }

  const steps = body.steps.map((s) => String(s).trim()).filter(Boolean);
  if (!steps.length) return res.status(400).json({ error: "steps vacío" });

  // (Opcional) evitar duplicados exactos
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const s of steps) {
    const key = s.toUpperCase();
    if (!seen.has(key)) {
      seen.add(key);
      normalized.push(s);
    }
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.productProcessStep.deleteMany({ where: { productId } });

      for (let i = 0; i < normalized.length; i++) {
        await tx.productProcessStep.create({
          data: {
            productId,
            name: normalized[i],
            order: i + 1,
            isActive: true,
          },
        });
      }
    });

    res.json({ ok: true });
  } catch (e: any) {
    res.status(400).json({ error: e?.message ?? "Error" });
  }
});

export default router;
