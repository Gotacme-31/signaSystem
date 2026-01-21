import { Router } from "express";
import { prisma } from "../lib/prisma";
import { auth, type AuthedRequest } from "../middlewares/auth";

const router = Router();

// GET /products (PROTEGIDO)
router.get("/", auth, async (_req: AuthedRequest, res) => {
  const products = await prisma.product.findMany({ orderBy: { id: "asc" } });
  res.json({ products });
});

// POST /products (PROTEGIDO)
router.post("/", auth, async (req: AuthedRequest, res) => {
  const { name, unitType, needsVariant } = req.body;

  if (!name || !unitType) {
    return res.status(400).json({ error: "name y unitType son requeridos" });
  }

  const product = await prisma.product.create({
    data: {
      name,
      unitType,
      // opcional: si no lo mandas, prisma usará el default del schema
      ...(typeof needsVariant === "boolean" ? { needsVariant } : {}),
    },
  });

  res.status(201).json({ product });
});

// DELETE /products/:id
router.delete("/:id", async (req, res) => {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: "id inválido" });
    }
  
    try {
      await prisma.product.delete({ where: { id } });
      return res.json({ ok: true });
    } catch (e: any) {
      // Si está referenciado por otras tablas, no te dejará borrarlo
      return res.status(400).json({
        error: "No se pudo borrar (posible referencia en otra tabla).",
        detail: e?.message,
      });
    }
  });
  
export default router;
