import { Router } from "express";
import { prisma } from "../lib/prisma";
import { auth, type AuthedRequest } from "../middlewares/auth";
import { requireAdmin } from "../middlewares/auth";

const router = Router();

/**
 * GET /branch-products/my
 * Productos habilitados para MI sucursal (STAFF/ADMIN)
 */
router.get("/my", auth, async (req: AuthedRequest, res) => {
  const branchId = req.auth?.branchId;
  if (!branchId) return res.status(400).json({ error: "Usuario sin branchId" });

  const rows = await prisma.branchProduct.findMany({
    where: { branchId, isActive: true }, // <-- OJO: isActive
    orderBy: { id: "asc" },
    select: { productId: true },
  });

  const productIds = rows.map((r) => r.productId);

  const products = await prisma.product.findMany({
    where: { id: { in: productIds }, isActive: true },
    orderBy: { id: "asc" },
  });

  res.json({ products });
});

/**
 * GET /branch-products/:branchId
 * ADMIN ve productos habilitados de cualquier sucursal
 */
router.get("/:branchId", auth, requireAdmin, async (req, res) => {
  const branchId = Number(req.params.branchId);
  if (Number.isNaN(branchId)) return res.status(400).json({ error: "branchId inválido" });

  const rows = await prisma.branchProduct.findMany({
    where: { branchId, isActive: true }, // <-- OJO: isActive
    orderBy: { id: "asc" },
    select: { productId: true },
  });

  const productIds = rows.map((r) => r.productId);

  const products = await prisma.product.findMany({
    where: { id: { in: productIds }, isActive: true },
    orderBy: { id: "asc" },
  });

  res.json({ products });
});

/**
 * PUT /branch-products/:branchId
 * ADMIN actualiza lista de productos habilitados para sucursal
 * body: { productIds: number[] }
 */
router.put("/:branchId", auth, requireAdmin, async (req, res) => {
  const branchId = Number(req.params.branchId);
  if (Number.isNaN(branchId)) return res.status(400).json({ error: "branchId inválido" });

  const productIds = (req.body?.productIds ?? []) as number[];
  if (!Array.isArray(productIds)) {
    return res.status(400).json({ error: "productIds debe ser un arreglo" });
  }

  // 1) desactivar todos
  await prisma.branchProduct.updateMany({
    where: { branchId },
    data: { isActive: false }, // <-- OJO: isActive
  });

  // 2) activar/crear los enviados
  for (const productId of productIds) {
    await prisma.branchProduct.upsert({
      where: { branchId_productId: { branchId, productId } },
      update: { isActive: true },
      create: { branchId, productId, isActive: true },
    });
  }

  res.json({ ok: true });
});
// PUT /branch-products/my
// body: { productIds: number[] }
router.put("/my", auth, async (req: AuthedRequest, res) => {
  const branchId = req.auth!.branchId;

  if (!branchId) {
    return res.status(400).json({ error: "Usuario sin branchId" });
  }

  const { productIds } = req.body as { productIds?: number[] };

  if (!Array.isArray(productIds)) {
    return res.status(400).json({ error: "productIds debe ser un arreglo" });
  }

  // 1) desactivar todos los de la sucursal
  await prisma.branchProduct.updateMany({
    where: { branchId },
    data: { isActive: false },
  });

  // 2) activar/crear los enviados
  for (const productId of productIds) {
    await prisma.branchProduct.upsert({
      where: {
        branchId_productId: { branchId, productId },
      },
      update: { isActive: true },
      create: { branchId, productId, isActive: true },
    });
  }

  res.json({ ok: true, branchId, enabledCount: productIds.length });
});

export default router;
