import type { Response } from "express";
import { prisma } from "../lib/prisma";
import type { AuthedRequest } from "../middlewares/auth";
import {
  InventoryError,
  activateInventory,
  adjustInventory,
  deactivateInventory,
  initializeInventoryVariant,
  listInventoryForBranch,
  listInventoryMovements,
  reactivateInventory,
  requireOperationKey,
  removeInventory,
  restockInventory,
} from "../services/inventory.service";

function positiveId(value: unknown) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function sendInventoryError(res: Response, error: unknown, fallback: string) {
  if (error instanceof InventoryError) {
    return res.status(error.status).json({ code: error.code, error: error.message, ...error.details });
  }
  console.error(fallback, error);
  return res.status(500).json({ error: fallback });
}

export async function adminListInventory(req: AuthedRequest, res: Response) {
  const branchId = positiveId(req.query.branchId);
  if (!branchId) return res.status(400).json({ error: "branchId inválido" });
  try {
    const inventory = await listInventoryForBranch(prisma, branchId);
    return res.json({ inventory });
  } catch (error) {
    return sendInventoryError(res, error, "Error consultando inventario");
  }
}

export async function adminActivateInventory(req: AuthedRequest, res: Response) {
  if (!req.auth) return res.status(401).json({ error: "No autorizado" });
  const branchProductId = positiveId(req.body?.branchProductId);
  if (!branchProductId) return res.status(400).json({ error: "branchProductId inválido" });
  try {
    const result = await activateInventory(prisma, {
      branchProductId,
      trackingMode: req.body?.trackingMode,
      initialStock: req.body?.initialStock,
      lowStockThreshold: req.body?.lowStockThreshold,
      variants: req.body?.variants,
      actorId: req.auth.userId,
      operationKey: requireOperationKey(req.body?.operationKey),
    });
    return res.status(201).json(result);
  } catch (error) {
    return sendInventoryError(res, error, "Error activando inventario");
  }
}

export async function adminDeactivateInventory(req: AuthedRequest, res: Response) {
  if (!req.auth) return res.status(401).json({ error: "No autorizado" });
  const configId = positiveId(req.params.id);
  if (!configId) return res.status(400).json({ error: "ID inválido" });
  try {
    const config = await deactivateInventory(prisma, configId, req.auth.userId);
    return res.json({ config });
  } catch (error) {
    return sendInventoryError(res, error, "Error desactivando inventario");
  }
}

export async function adminReactivateInventory(req: AuthedRequest, res: Response) {
  if (!req.auth) return res.status(401).json({ error: "No autorizado" });
  const configId = positiveId(req.params.id);
  if (!configId) return res.status(400).json({ error: "ID inválido" });
  try {
    const result = await reactivateInventory(prisma, {
      configId,
      trackingMode: req.body?.trackingMode,
      physicalStock: req.body?.physicalStock,
      lowStockThreshold: req.body?.lowStockThreshold,
      variants: req.body?.variants,
      actorId: req.auth.userId,
      operationKey: requireOperationKey(req.body?.operationKey),
    });
    return res.json(result);
  } catch (error) {
    return sendInventoryError(res, error, "Error reactivando inventario");
  }
}

export async function adminInitializeInventoryVariant(req: AuthedRequest, res: Response) {
  if (!req.auth) return res.status(401).json({ error: "No autorizado" });
  const configId = positiveId(req.params.id);
  const variantId = positiveId(req.params.variantId);
  if (!configId || !variantId) return res.status(400).json({ error: "ID inválido" });
  try {
    const result = await initializeInventoryVariant(prisma, {
      configId,
      variantId,
      initialStock: req.body?.initialStock,
      lowStockThreshold: req.body?.lowStockThreshold,
      actorId: req.auth.userId,
      operationKey: requireOperationKey(req.body?.operationKey),
    });
    return res.status(201).json(result);
  } catch (error) {
    return sendInventoryError(res, error, "Error inicializando inventario de variante");
  }
}

export async function adminRestockInventory(req: AuthedRequest, res: Response) {
  if (!req.auth) return res.status(401).json({ error: "No autorizado" });
  const balanceId = positiveId(req.params.id);
  if (!balanceId) return res.status(400).json({ error: "ID inválido" });
  try {
    const result = await restockInventory(prisma, {
      balanceId,
      quantity: req.body?.quantity,
      actorId: req.auth.userId,
      operationKey: requireOperationKey(req.body?.operationKey),
      reason: req.body?.reason,
    });
    return res.json(result);
  } catch (error) {
    return sendInventoryError(res, error, "Error agregando stock");
  }
}

export async function adminRemoveInventory(req: AuthedRequest, res: Response) {
  if (!req.auth) return res.status(401).json({ error: "No autorizado" });
  const balanceId = positiveId(req.params.id);
  if (!balanceId) return res.status(400).json({ error: "ID inválido" });
  try {
    const result = await removeInventory(prisma, {
      balanceId,
      quantity: req.body?.quantity,
      actorId: req.auth.userId,
      operationKey: requireOperationKey(req.body?.operationKey),
      reason: String(req.body?.reason ?? ""),
    });
    return res.json(result);
  } catch (error) {
    return sendInventoryError(res, error, "Error retirando stock");
  }
}

export async function adminAdjustInventory(req: AuthedRequest, res: Response) {
  if (!req.auth) return res.status(401).json({ error: "No autorizado" });
  const balanceId = positiveId(req.params.id);
  if (!balanceId) return res.status(400).json({ error: "ID inválido" });
  try {
    const result = await adjustInventory(prisma, {
      balanceId,
      targetStock: req.body?.targetStock,
      actorId: req.auth.userId,
      operationKey: requireOperationKey(req.body?.operationKey),
      reason: String(req.body?.reason ?? ""),
    });
    return res.json(result);
  } catch (error) {
    return sendInventoryError(res, error, "Error ajustando stock");
  }
}

export async function adminListInventoryMovements(req: AuthedRequest, res: Response) {
  const balanceId = positiveId(req.params.id);
  if (!balanceId) return res.status(400).json({ error: "ID inválido" });
  try {
    const movements = await listInventoryMovements(prisma, balanceId);
    return res.json({ movements });
  } catch (error) {
    return sendInventoryError(res, error, "Error consultando movimientos");
  }
}
