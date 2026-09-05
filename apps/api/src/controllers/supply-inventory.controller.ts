import type { Response } from "express";
import { prisma } from "../lib/prisma";
import type { AuthedRequest } from "../middlewares/auth";
import {
  SupplyInventoryError,
  adjustSupplyItemStock,
  createSupplyItem,
  deactivateSupplyItem,
  listSupplyItems,
  listSupplyMovements,
  reactivateSupplyItem,
  removeSupplyItemStock,
  restockSupplyItem,
  updateSupplyItem,
} from "../services/supply-inventory.service";

function positiveId(value: unknown) {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 && id <= 2_147_483_647 ? id : null;
}

function sendSupplyError(res: Response, error: unknown, fallback: string) {
  if (error instanceof SupplyInventoryError) {
    return res.status(error.status).json({ code: error.code, error: error.message, ...error.details });
  }
  console.error(fallback, error);
  return res.status(500).json({ error: fallback });
}

function actorId(req: AuthedRequest) {
  if (!req.auth) throw new SupplyInventoryError("UNAUTHORIZED", "No autorizado", 401);
  return req.auth.userId;
}

export async function adminListSupplyItems(req: AuthedRequest, res: Response) {
  const branchId = positiveId(req.query.branchId);
  if (!branchId) return res.status(400).json({ code: "INVALID_BRANCH_ID", error: "branchId inválido" });
  const includeInactiveValue = req.query.includeInactive;
  if (
    includeInactiveValue !== undefined
    && includeInactiveValue !== "true"
    && includeInactiveValue !== "false"
  ) {
    return res.status(400).json({ code: "INVALID_INCLUDE_INACTIVE", error: "includeInactive inválido" });
  }
  try {
    const result = await listSupplyItems(prisma, {
      branchId,
      includeInactive: includeInactiveValue === "true",
    });
    return res.json(result);
  } catch (error) {
    return sendSupplyError(res, error, "Error consultando suministros");
  }
}

export async function adminCreateSupplyItem(req: AuthedRequest, res: Response) {
  try {
    const result = await createSupplyItem(prisma, { actorId: actorId(req), body: req.body });
    return res.status(result.repeated ? 200 : 201).json(result);
  } catch (error) {
    return sendSupplyError(res, error, "Error creando suministro");
  }
}

export async function adminUpdateSupplyItem(req: AuthedRequest, res: Response) {
  const supplyItemId = positiveId(req.params.id);
  if (!supplyItemId) return res.status(400).json({ code: "INVALID_SUPPLY_ID", error: "ID inválido" });
  try {
    return res.json(await updateSupplyItem(prisma, { supplyItemId, body: req.body }));
  } catch (error) {
    return sendSupplyError(res, error, "Error editando suministro");
  }
}

export async function adminDeactivateSupplyItem(req: AuthedRequest, res: Response) {
  const supplyItemId = positiveId(req.params.id);
  if (!supplyItemId) return res.status(400).json({ code: "INVALID_SUPPLY_ID", error: "ID inválido" });
  try {
    return res.json(await deactivateSupplyItem(prisma, supplyItemId));
  } catch (error) {
    return sendSupplyError(res, error, "Error desactivando suministro");
  }
}

export async function adminReactivateSupplyItem(req: AuthedRequest, res: Response) {
  const supplyItemId = positiveId(req.params.id);
  if (!supplyItemId) return res.status(400).json({ code: "INVALID_SUPPLY_ID", error: "ID inválido" });
  try {
    return res.json(await reactivateSupplyItem(prisma, supplyItemId));
  } catch (error) {
    return sendSupplyError(res, error, "Error reactivando suministro");
  }
}

export async function adminRestockSupplyItem(req: AuthedRequest, res: Response) {
  const supplyItemId = positiveId(req.params.id);
  if (!supplyItemId) return res.status(400).json({ code: "INVALID_SUPPLY_ID", error: "ID inválido" });
  try {
    return res.json(await restockSupplyItem(prisma, {
      supplyItemId,
      actorId: actorId(req),
      body: req.body,
    }));
  } catch (error) {
    return sendSupplyError(res, error, "Error reponiendo suministro");
  }
}

export async function adminRemoveSupplyItem(req: AuthedRequest, res: Response) {
  const supplyItemId = positiveId(req.params.id);
  if (!supplyItemId) return res.status(400).json({ code: "INVALID_SUPPLY_ID", error: "ID inválido" });
  try {
    return res.json(await removeSupplyItemStock(prisma, {
      supplyItemId,
      actorId: actorId(req),
      body: req.body,
    }));
  } catch (error) {
    return sendSupplyError(res, error, "Error retirando suministro");
  }
}

export async function adminAdjustSupplyItem(req: AuthedRequest, res: Response) {
  const supplyItemId = positiveId(req.params.id);
  if (!supplyItemId) return res.status(400).json({ code: "INVALID_SUPPLY_ID", error: "ID inválido" });
  try {
    return res.json(await adjustSupplyItemStock(prisma, {
      supplyItemId,
      actorId: actorId(req),
      body: req.body,
    }));
  } catch (error) {
    return sendSupplyError(res, error, "Error ajustando suministro");
  }
}

export async function adminListSupplyMovements(req: AuthedRequest, res: Response) {
  const supplyItemId = positiveId(req.params.id);
  if (!supplyItemId) return res.status(400).json({ code: "INVALID_SUPPLY_ID", error: "ID inválido" });
  const limitValue = req.query.limit;
  const limit = limitValue === undefined ? 50 : positiveId(limitValue);
  if (!limit || limit > 100) {
    return res.status(400).json({ code: "INVALID_SUPPLY_LIMIT", error: "limit debe estar entre 1 y 100" });
  }
  if (
    req.query.cursor !== undefined
    && (typeof req.query.cursor !== "string" || req.query.cursor.length === 0)
  ) {
    return res.status(400).json({ code: "INVALID_SUPPLY_CURSOR", error: "cursor inválido" });
  }
  try {
    return res.json(await listSupplyMovements(prisma, {
      supplyItemId,
      cursor: typeof req.query.cursor === "string" ? req.query.cursor : null,
      limit,
    }));
  } catch (error) {
    return sendSupplyError(res, error, "Error consultando historial de suministro");
  }
}
