import type { Request, Response } from "express";
import { prisma } from "../lib/prisma";

export async function listBranches(req: Request, res: Response) {
  const rows = await prisma.branch.findMany({
    select: { id: true, name: true, isActive: true },
    orderBy: { id: "asc" },
  });
  res.json(rows);
}

export async function listBranchProducts(req: Request, res: Response) {
  const branchId = Number(req.params.branchId);
  if (!Number.isFinite(branchId)) return res.status(400).json({ error: "branchId inválido" });

  const rows = await prisma.branchProduct.findMany({
    where: { branchId },
    include: {
      product: { select: { id: true, name: true, unitType: true, needsVariant: true, isActive: true } },
    },
    orderBy: [{ productId: "asc" }],
  });

  // Aplana la respuesta para el front
  res.json(
    rows.map((bp) => ({
      branchId: bp.branchId,
      productId: bp.productId,
      isActive: bp.isActive,
      price: bp.price.toString(),
      product: bp.product,
    }))
  );
}
