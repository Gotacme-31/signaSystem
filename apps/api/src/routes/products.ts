import { Router } from "express";
import { prisma } from "../lib/prisma";
import { auth, type AuthedRequest } from "../middlewares/auth";

const router = Router();

/**
 * GET /products
 * STAFF/ADMIN: lista productos (por defecto solo activos)
 * query:
 *  - includeInactive=1  (solo ADMIN recomendado, pero aquí lo dejamos simple)
 */
router.get("/", auth, async (req: AuthedRequest, res) => {
  const includeInactive = req.query.includeInactive === "1";

  const where =
    includeInactive
      ? {}
      : { isActive: true };

  const products = await prisma.product.findMany({
    where,
    orderBy: { id: "asc" },
    select: {
      id: true,
      name: true,
      unitType: true,
      needsVariant: true,
      isActive: true,
      createdAt: true,
    },
  });

  res.json({ products });
});

/**
 * GET /products/:id
 * detalle para pantallas que necesiten ver el proceso (por ejemplo admin edit)
 */
router.get("/:id", auth, async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "id inválido" });

  const product = await prisma.product.findUnique({
    where: { id },
    include: {
      processSteps: {
        where: { isActive: true },
        orderBy: { order: "asc" },
        select: { id: true, name: true, order: true, isActive: true },
      },
    },
  });

  if (!product) return res.status(404).json({ error: "Producto no existe" });

  res.json({ product });
});

export default router;
