import { createHash } from "node:crypto";
import {
  Prisma,
  SupplyMovementType,
  type PrismaClient,
} from "@prisma/client";

type SupplyTx = Prisma.TransactionClient;

const MAX_STOCK = 2_147_483_647;
const MAX_NAME_LENGTH = 120;
const MAX_UNIT_LABEL_LENGTH = 40;
const MAX_REASON_LENGTH = 500;

export type SupplyStockStatus = "AVAILABLE" | "LOW" | "OUT";
export type SupplyStatus = SupplyStockStatus | "INACTIVE";

export class SupplyInventoryError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "SupplyInventoryError";
  }
}

function requireBody(value: unknown, allowedFields: readonly string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SupplyInventoryError("INVALID_SUPPLY_REQUEST", "El cuerpo de la solicitud es inválido", 400);
  }
  const body = value as Record<string, unknown>;
  const unknownField = Object.keys(body).find((field) => !allowedFields.includes(field));
  if (unknownField) {
    throw new SupplyInventoryError(
      "INVALID_SUPPLY_REQUEST",
      `El campo ${unknownField} no está permitido`,
      400
    );
  }
  return body;
}

function cleanText(value: unknown, field: string, maxLength: number) {
  if (typeof value !== "string") {
    throw new SupplyInventoryError("INVALID_SUPPLY_TEXT", `${field} debe ser texto`, 400);
  }
  const cleaned = value.normalize("NFKC").trim().replace(/\s+/gu, " ");
  if (!cleaned || cleaned.length > maxLength) {
    throw new SupplyInventoryError(
      "INVALID_SUPPLY_TEXT",
      `${field} debe tener entre 1 y ${maxLength} caracteres`,
      400
    );
  }
  return cleaned;
}

export function normalizeSupplyName(value: unknown) {
  const name = cleanText(value, "name", MAX_NAME_LENGTH);
  return {
    name,
    normalizedName: name.toLocaleLowerCase("es-MX"),
  };
}

export function normalizeSupplyUnitLabel(value: unknown) {
  return cleanText(value, "unitLabel", MAX_UNIT_LABEL_LENGTH).toLocaleLowerCase("es-MX");
}

export function requireSupplyInteger(value: unknown, field: string, minimum = 0) {
  if (
    typeof value !== "number"
    || !Number.isSafeInteger(value)
    || value < minimum
    || value > MAX_STOCK
  ) {
    throw new SupplyInventoryError(
      "INVALID_SUPPLY_QUANTITY",
      `${field} debe ser un entero entre ${minimum} y ${MAX_STOCK}`,
      400
    );
  }
  return value;
}

function optionalThreshold(value: unknown) {
  if (value === undefined || value === null) return null;
  return requireSupplyInteger(value, "lowStockThreshold");
}

function optionalReason(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    throw new SupplyInventoryError("INVALID_SUPPLY_REASON", "reason debe ser texto", 400);
  }
  const reason = value.normalize("NFKC").trim().replace(/\s+/gu, " ");
  if (!reason) return null;
  if (reason.length > MAX_REASON_LENGTH) {
    throw new SupplyInventoryError(
      "INVALID_SUPPLY_REASON",
      `reason no puede exceder ${MAX_REASON_LENGTH} caracteres`,
      400
    );
  }
  return reason;
}

function requiredReason(value: unknown) {
  const reason = optionalReason(value);
  if (!reason) {
    throw new SupplyInventoryError("SUPPLY_REASON_REQUIRED", "El motivo es obligatorio", 400);
  }
  return reason;
}

export function requireSupplyOperationKey(value: unknown) {
  if (typeof value !== "string") {
    throw new SupplyInventoryError(
      "SUPPLY_OPERATION_KEY_REQUIRED",
      "operationKey es requerido",
      400
    );
  }
  const operationKey = value.trim();
  if (operationKey.length < 8 || operationKey.length > 100) {
    throw new SupplyInventoryError(
      "SUPPLY_OPERATION_KEY_REQUIRED",
      "operationKey debe tener entre 8 y 100 caracteres",
      400
    );
  }
  return operationKey;
}

function stableSerialize(value: unknown): string {
  if (value === undefined) return "null";
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${stableSerialize(child)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function supplyRequestHash(value: unknown) {
  return createHash("sha256").update(stableSerialize(value)).digest("hex");
}

export function supplyStockStatus(currentStock: number, lowStockThreshold: number | null): SupplyStockStatus {
  if (currentStock === 0) return "OUT";
  if (lowStockThreshold !== null && currentStock <= lowStockThreshold) return "LOW";
  return "AVAILABLE";
}

function supplyStatus(item: { isActive: boolean; currentStock: number; lowStockThreshold: number | null }): SupplyStatus {
  return item.isActive ? supplyStockStatus(item.currentStock, item.lowStockThreshold) : "INACTIVE";
}

function supplyView<T extends {
  isActive: boolean;
  currentStock: number;
  lowStockThreshold: number | null;
  _count?: { movements: number };
  movements?: unknown[];
}>(item: T) {
  const { _count } = item;
  const rest = { ...item };
  delete (rest as { _count?: unknown })._count;
  delete (rest as { creationOperationKey?: unknown }).creationOperationKey;
  delete (rest as { creationRequestHash?: unknown }).creationRequestHash;
  return {
    ...rest,
    status: supplyStatus(item),
    unitLabelEditable: (_count?.movements ?? 0) === 0,
  };
}

type LockedSupplyItem = {
  id: number;
  branchId: number;
  name: string;
  unitLabel: string;
  currentStock: number;
  lowStockThreshold: number | null;
  version: number;
  isActive: boolean;
};

async function lockSupplyItem(tx: SupplyTx, supplyItemId: number) {
  const rows = await tx.$queryRaw<LockedSupplyItem[]>`
    SELECT
      "id",
      "branchId",
      "name",
      "unitLabel",
      "currentStock",
      "lowStockThreshold",
      "version",
      "isActive"
    FROM "SupplyItem"
    WHERE "id" = ${supplyItemId}
    FOR UPDATE
  `;
  if (rows.length !== 1) {
    throw new SupplyInventoryError("SUPPLY_NOT_FOUND", "Suministro no encontrado", 404);
  }
  return rows[0];
}

async function lockBranch(tx: SupplyTx, branchId: number) {
  const rows = await tx.$queryRaw<Array<{ id: number; isActive: boolean }>>`
    SELECT "id", "isActive"
    FROM "Branch"
    WHERE "id" = ${branchId}
    FOR UPDATE
  `;
  if (rows.length !== 1) {
    throw new SupplyInventoryError("BRANCH_NOT_FOUND", "Sucursal no encontrada", 404);
  }
  if (!rows[0].isActive) {
    throw new SupplyInventoryError("BRANCH_INACTIVE", "La sucursal está inactiva", 409);
  }
  return rows[0];
}

type ReplayMovement = Prisma.SupplyMovementGetPayload<{
  include: { supplyItem: true };
}>;

type CreationReplayItem = Prisma.SupplyItemGetPayload<{}> & {
  _count: { movements: number };
  movements: Array<Prisma.SupplyMovementGetPayload<{}>>;
};

async function findReplay(
  db: PrismaClient | SupplyTx,
  operationKey: string,
  requestHash: string,
  actorId: number
): Promise<ReplayMovement | null> {
  const movement = await db.supplyMovement.findUnique({
    where: { operationKey },
    include: { supplyItem: true },
  });
  if (!movement) return null;
  if (movement.requestHash !== requestHash || movement.createdById !== actorId) {
    throw new SupplyInventoryError(
      "SUPPLY_OPERATION_KEY_REUSED",
      "operationKey ya fue utilizado con una operación diferente",
      409
    );
  }
  return movement;
}

function movementResult(movement: ReplayMovement, repeated: boolean) {
  return {
    supplyItemId: movement.supplyItemId,
    movementId: movement.id,
    movementType: movement.movementType,
    stockBefore: movement.stockBefore,
    deltaQty: movement.deltaQty,
    stockAfter: movement.stockAfter,
    currentStock: movement.supplyItem.currentStock,
    version: movement.supplyItem.version,
    noChange: false as const,
    repeated,
  };
}

function initialStockOperationKey(creationOperationKey: string) {
  const digest = createHash("sha256").update(creationOperationKey).digest("hex");
  return `initial:${digest}`;
}

async function findCreationReplay(
  db: PrismaClient | SupplyTx,
  creationOperationKey: string,
  creationRequestHash: string
): Promise<CreationReplayItem | null> {
  const item = await db.supplyItem.findUnique({
    where: { creationOperationKey },
    include: {
      _count: { select: { movements: true } },
      movements: {
        where: { movementType: SupplyMovementType.INITIAL_STOCK },
        take: 1,
      },
    },
  });
  if (!item) return null;
  if (item.creationRequestHash !== creationRequestHash) {
    throw new SupplyInventoryError(
      "SUPPLY_OPERATION_KEY_REUSED",
      "operationKey ya fue utilizado con una creación diferente",
      409
    );
  }
  return item;
}

function creationResult(item: CreationReplayItem, repeated: boolean) {
  const movement = item.movements[0] ?? null;
  const { movements, ...withoutMovements } = item;
  return {
    supplyItem: supplyView(withoutMovements),
    movement: movement
      ? {
          supplyItemId: movement.supplyItemId,
          movementId: movement.id,
          movementType: movement.movementType,
          stockBefore: movement.stockBefore,
          deltaQty: movement.deltaQty,
          stockAfter: movement.stockAfter,
          currentStock: item.currentStock,
          version: item.version,
          noChange: false as const,
          repeated,
        }
      : null,
    repeated,
  };
}

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

async function resolveMovementRace(
  db: PrismaClient,
  operationKey: string,
  requestHash: string,
  actorId: number,
  error: unknown
) {
  if (!isUniqueConstraintError(error)) throw error;
  const replay = await findReplay(db, operationKey, requestHash, actorId);
  if (!replay) throw error;
  return movementResult(replay, true);
}

function duplicateSupplyError(item: { id: number; isActive: boolean }) {
  if (item.isActive) {
    return new SupplyInventoryError(
      "SUPPLY_ALREADY_EXISTS",
      "Ya existe un suministro con ese nombre en la sucursal",
      409,
      { supplyItemId: item.id }
    );
  }
  return new SupplyInventoryError(
    "SUPPLY_INACTIVE_EXISTS",
    "Ya existe un suministro inactivo con ese nombre; reactívalo en lugar de crear otro",
    409,
    { supplyItemId: item.id }
  );
}

export async function listSupplyItems(
  db: PrismaClient,
  input: { branchId: number; includeInactive: boolean }
) {
  const branch = await db.branch.findUnique({
    where: { id: input.branchId },
    select: { id: true, name: true, isActive: true },
  });
  if (!branch) throw new SupplyInventoryError("BRANCH_NOT_FOUND", "Sucursal no encontrada", 404);

  const supplies = await db.supplyItem.findMany({
    where: {
      branchId: input.branchId,
      ...(input.includeInactive ? {} : { isActive: true }),
    },
    include: {
      _count: { select: { movements: true } },
      movements: {
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 1,
        select: {
          id: true,
          movementType: true,
          deltaQty: true,
          createdAt: true,
        },
      },
    },
    orderBy: [{ isActive: "desc" }, { name: "asc" }, { id: "asc" }],
  });

  return {
    branch,
    supplies: supplies.map((item) => {
      const { movements, ...withoutMovements } = item;
      return {
        ...supplyView(withoutMovements),
        lastMovement: movements[0] ?? null,
      };
    }),
  };
}

export async function createSupplyItem(
  db: PrismaClient,
  input: { actorId: number; body: unknown }
) {
  const body = requireBody(input.body, [
    "branchId",
    "name",
    "unitLabel",
    "initialStock",
    "lowStockThreshold",
    "operationKey",
  ]);
  const branchId = requireSupplyInteger(body.branchId, "branchId", 1);
  const { name, normalizedName } = normalizeSupplyName(body.name);
  const unitLabel = normalizeSupplyUnitLabel(body.unitLabel);
  const initialStock = requireSupplyInteger(body.initialStock, "initialStock");
  const lowStockThreshold = optionalThreshold(body.lowStockThreshold);
  const operationKey = requireSupplyOperationKey(body.operationKey);
  const requestHash = supplyRequestHash({
    action: "CREATE",
    actorId: input.actorId,
    branchId,
    name,
    normalizedName,
    unitLabel,
    initialStock,
    lowStockThreshold,
  });

  try {
    return await db.$transaction(async (tx) => {
      await lockBranch(tx, branchId);

      const replay = await findCreationReplay(tx, operationKey, requestHash);
      if (replay) return creationResult(replay, true);

      const duplicate = await tx.supplyItem.findUnique({
        where: { branchId_normalizedName: { branchId, normalizedName } },
        select: { id: true, isActive: true },
      });
      if (duplicate) throw duplicateSupplyError(duplicate);

      const created = await tx.supplyItem.create({
        data: {
          branchId,
          name,
          normalizedName,
          unitLabel,
          currentStock: initialStock,
          lowStockThreshold,
          creationOperationKey: operationKey,
          creationRequestHash: requestHash,
        },
      });

      if (initialStock === 0) {
        return creationResult({ ...created, _count: { movements: 0 }, movements: [] }, false);
      }

      const movement = await tx.supplyMovement.create({
        data: {
          supplyItemId: created.id,
          deltaQty: initialStock,
          stockBefore: 0,
          stockAfter: initialStock,
          movementType: SupplyMovementType.INITIAL_STOCK,
          reason: "Stock inicial",
          createdById: input.actorId,
          operationKey: initialStockOperationKey(operationKey),
          requestHash,
        },
        include: { supplyItem: true },
      });

      return creationResult({ ...created, _count: { movements: 1 }, movements: [movement] }, false);
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      const replay = await findCreationReplay(db, operationKey, requestHash);
      if (replay) return creationResult(replay, true);
      const duplicate = await db.supplyItem.findUnique({
        where: { branchId_normalizedName: { branchId, normalizedName } },
        select: { id: true, isActive: true },
      });
      if (duplicate) throw duplicateSupplyError(duplicate);
      throw new SupplyInventoryError(
        "SUPPLY_OPERATION_KEY_REUSED",
        "No se pudo reservar la clave idempotente de creación",
        409
      );
    }
    throw error;
  }
}

async function applySupplyDelta(
  tx: SupplyTx,
  input: {
    locked: LockedSupplyItem;
    deltaQty: number;
    movementType: SupplyMovementType;
    reason: string | null;
    actorId: number;
    operationKey: string;
    requestHash: string;
    expectedVersion?: number;
  }
) {
  const rows = input.deltaQty < 0
    ? await tx.$queryRaw<Array<{ currentStock: number; version: number }>>`
        UPDATE "SupplyItem"
        SET
          "currentStock" = "currentStock" + ${input.deltaQty},
          "version" = "version" + 1,
          "updatedAt" = NOW()
        WHERE "id" = ${input.locked.id}
          AND "isActive" = true
          AND "currentStock" >= ${Math.abs(input.deltaQty)}
          ${input.expectedVersion === undefined
            ? Prisma.empty
            : Prisma.sql`AND "version" = ${input.expectedVersion}`}
        RETURNING "currentStock", "version"
      `
    : await tx.$queryRaw<Array<{ currentStock: number; version: number }>>`
        UPDATE "SupplyItem"
        SET
          "currentStock" = "currentStock" + ${input.deltaQty},
          "version" = "version" + 1,
          "updatedAt" = NOW()
        WHERE "id" = ${input.locked.id}
          AND "isActive" = true
          AND "currentStock" <= ${MAX_STOCK - input.deltaQty}
          ${input.expectedVersion === undefined
            ? Prisma.empty
            : Prisma.sql`AND "version" = ${input.expectedVersion}`}
        RETURNING "currentStock", "version"
      `;

  if (rows.length !== 1) {
    if (input.expectedVersion !== undefined) {
      throw new SupplyInventoryError(
        "SUPPLY_VERSION_CONFLICT",
        "El stock cambió; recarga el suministro antes de ajustar",
        409,
        { expectedVersion: input.expectedVersion, currentVersion: input.locked.version }
      );
    }
    if (input.deltaQty < 0) {
      throw new SupplyInventoryError(
        "INSUFFICIENT_SUPPLY_STOCK",
        `Stock insuficiente para ${input.locked.name}`,
        409,
        { requested: Math.abs(input.deltaQty), available: input.locked.currentStock }
      );
    }
    throw new SupplyInventoryError("SUPPLY_STOCK_LIMIT", "El stock excede el límite permitido", 409);
  }

  const stockAfter = rows[0].currentStock;
  const stockBefore = stockAfter - input.deltaQty;
  const movement = await tx.supplyMovement.create({
    data: {
      supplyItemId: input.locked.id,
      deltaQty: input.deltaQty,
      stockBefore,
      stockAfter,
      movementType: input.movementType,
      reason: input.reason,
      createdById: input.actorId,
      operationKey: input.operationKey,
      requestHash: input.requestHash,
    },
    include: { supplyItem: true },
  });
  return movementResult(movement, false);
}

export async function restockSupplyItem(
  db: PrismaClient,
  input: { supplyItemId: number; actorId: number; body: unknown }
) {
  const body = requireBody(input.body, ["quantity", "reason", "operationKey"]);
  const quantity = requireSupplyInteger(body.quantity, "quantity", 1);
  const reason = optionalReason(body.reason);
  const operationKey = requireSupplyOperationKey(body.operationKey);
  const requestHash = supplyRequestHash({
    action: "RESTOCK",
    actorId: input.actorId,
    supplyItemId: input.supplyItemId,
    quantity,
    reason,
  });

  try {
    return await db.$transaction(async (tx) => {
      const locked = await lockSupplyItem(tx, input.supplyItemId);
      const replay = await findReplay(tx, operationKey, requestHash, input.actorId);
      if (replay) return movementResult(replay, true);
      if (!locked.isActive) {
        throw new SupplyInventoryError("SUPPLY_INACTIVE", "El suministro está inactivo", 409);
      }
      if (locked.currentStock > MAX_STOCK - quantity) {
        throw new SupplyInventoryError("SUPPLY_STOCK_LIMIT", "El stock excede el límite permitido", 409);
      }
      return applySupplyDelta(tx, {
        locked,
        deltaQty: quantity,
        movementType: SupplyMovementType.RESTOCK,
        reason,
        actorId: input.actorId,
        operationKey,
        requestHash,
      });
    });
  } catch (error) {
    return resolveMovementRace(db, operationKey, requestHash, input.actorId, error);
  }
}

export async function removeSupplyItemStock(
  db: PrismaClient,
  input: { supplyItemId: number; actorId: number; body: unknown }
) {
  const body = requireBody(input.body, ["quantity", "reason", "operationKey"]);
  const quantity = requireSupplyInteger(body.quantity, "quantity", 1);
  const reason = requiredReason(body.reason);
  const operationKey = requireSupplyOperationKey(body.operationKey);
  const requestHash = supplyRequestHash({
    action: "REMOVE",
    actorId: input.actorId,
    supplyItemId: input.supplyItemId,
    quantity,
    reason,
  });

  try {
    return await db.$transaction(async (tx) => {
      const locked = await lockSupplyItem(tx, input.supplyItemId);
      const replay = await findReplay(tx, operationKey, requestHash, input.actorId);
      if (replay) return movementResult(replay, true);
      if (!locked.isActive) {
        throw new SupplyInventoryError("SUPPLY_INACTIVE", "El suministro está inactivo", 409);
      }
      if (locked.currentStock < quantity) {
        throw new SupplyInventoryError(
          "INSUFFICIENT_SUPPLY_STOCK",
          `Stock insuficiente para ${locked.name}`,
          409,
          { requested: quantity, available: locked.currentStock }
        );
      }
      return applySupplyDelta(tx, {
        locked,
        deltaQty: -quantity,
        movementType: SupplyMovementType.MANUAL_REMOVE,
        reason,
        actorId: input.actorId,
        operationKey,
        requestHash,
      });
    });
  } catch (error) {
    return resolveMovementRace(db, operationKey, requestHash, input.actorId, error);
  }
}

export async function adjustSupplyItemStock(
  db: PrismaClient,
  input: { supplyItemId: number; actorId: number; body: unknown }
) {
  const body = requireBody(input.body, ["targetStock", "expectedVersion", "reason", "operationKey"]);
  const targetStock = requireSupplyInteger(body.targetStock, "targetStock");
  const expectedVersion = requireSupplyInteger(body.expectedVersion, "expectedVersion");
  const reason = requiredReason(body.reason);
  const operationKey = requireSupplyOperationKey(body.operationKey);
  const requestHash = supplyRequestHash({
    action: "ADJUST",
    actorId: input.actorId,
    supplyItemId: input.supplyItemId,
    targetStock,
    expectedVersion,
    reason,
  });

  try {
    return await db.$transaction(async (tx) => {
      const locked = await lockSupplyItem(tx, input.supplyItemId);
      const replay = await findReplay(tx, operationKey, requestHash, input.actorId);
      if (replay) return movementResult(replay, true);
      if (!locked.isActive) {
        throw new SupplyInventoryError("SUPPLY_INACTIVE", "El suministro está inactivo", 409);
      }
      if (locked.version !== expectedVersion) {
        throw new SupplyInventoryError(
          "SUPPLY_VERSION_CONFLICT",
          "El stock cambió; recarga el suministro antes de ajustar",
          409,
          { expectedVersion, currentVersion: locked.version, currentStock: locked.currentStock }
        );
      }

      const deltaQty = targetStock - locked.currentStock;
      if (deltaQty === 0) {
        return {
          supplyItemId: locked.id,
          currentStock: locked.currentStock,
          version: locked.version,
          noChange: true as const,
          repeated: false,
        };
      }

      return applySupplyDelta(tx, {
        locked,
        deltaQty,
        movementType: SupplyMovementType.ADJUSTMENT,
        reason,
        actorId: input.actorId,
        operationKey,
        requestHash,
        expectedVersion,
      });
    });
  } catch (error) {
    return resolveMovementRace(db, operationKey, requestHash, input.actorId, error);
  }
}

export async function updateSupplyItem(
  db: PrismaClient,
  input: { supplyItemId: number; body: unknown }
) {
  const body = requireBody(input.body, ["name", "unitLabel", "lowStockThreshold"]);
  if (Object.keys(body).length === 0) {
    throw new SupplyInventoryError("INVALID_SUPPLY_REQUEST", "No hay cambios para guardar", 400);
  }

  const nameInput = Object.prototype.hasOwnProperty.call(body, "name") ? normalizeSupplyName(body.name) : null;
  const unitLabel = Object.prototype.hasOwnProperty.call(body, "unitLabel")
    ? normalizeSupplyUnitLabel(body.unitLabel)
    : null;
  const hasThreshold = Object.prototype.hasOwnProperty.call(body, "lowStockThreshold");
  const lowStockThreshold = hasThreshold ? optionalThreshold(body.lowStockThreshold) : undefined;

  try {
    return await db.$transaction(async (tx) => {
      const locked = await lockSupplyItem(tx, input.supplyItemId);
      if (unitLabel !== null && unitLabel !== locked.unitLabel) {
        const movementCount = await tx.supplyMovement.count({
          where: { supplyItemId: locked.id },
        });
        if (movementCount > 0) {
          throw new SupplyInventoryError(
            "SUPPLY_UNIT_IMMUTABLE",
            "La presentación no puede cambiar después de registrar movimientos de stock",
            409
          );
        }
      }

      const updated = await tx.supplyItem.update({
        where: { id: locked.id },
        data: {
          ...(nameInput ?? {}),
          ...(unitLabel === null ? {} : { unitLabel }),
          ...(hasThreshold ? { lowStockThreshold } : {}),
        },
        include: { _count: { select: { movements: true } } },
      });
      return { supplyItem: supplyView(updated) };
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new SupplyInventoryError(
        "SUPPLY_NAME_CONFLICT",
        "Ya existe otro suministro con ese nombre en la sucursal",
        409
      );
    }
    throw error;
  }
}

export async function deactivateSupplyItem(db: PrismaClient, supplyItemId: number) {
  return db.$transaction(async (tx) => {
    const locked = await lockSupplyItem(tx, supplyItemId);
    if (!locked.isActive) {
      return { supplyItemId: locked.id, isActive: false, currentStock: locked.currentStock, version: locked.version };
    }
    const item = await tx.supplyItem.update({
      where: { id: locked.id },
      data: { isActive: false },
    });
    return { supplyItemId: item.id, isActive: item.isActive, currentStock: item.currentStock, version: item.version };
  });
}

export async function reactivateSupplyItem(db: PrismaClient, supplyItemId: number) {
  return db.$transaction(async (tx) => {
    const locked = await lockSupplyItem(tx, supplyItemId);
    await lockBranch(tx, locked.branchId);
    if (locked.isActive) {
      return { supplyItemId: locked.id, isActive: true, currentStock: locked.currentStock, version: locked.version };
    }
    const item = await tx.supplyItem.update({
      where: { id: locked.id },
      data: { isActive: true },
    });
    return { supplyItemId: item.id, isActive: item.isActive, currentStock: item.currentStock, version: item.version };
  });
}

function encodeMovementCursor(createdAt: Date, id: number) {
  return Buffer.from(`${createdAt.toISOString()}|${id}`, "utf8").toString("base64url");
}

function decodeMovementCursor(value: string) {
  try {
    if (!value) throw new Error("invalid");
    const decoded = Buffer.from(value, "base64url").toString("utf8");
    const separator = decoded.lastIndexOf("|");
    const createdAt = new Date(decoded.slice(0, separator));
    const id = Number(decoded.slice(separator + 1));
    if (separator <= 0 || Number.isNaN(createdAt.getTime()) || !Number.isSafeInteger(id) || id <= 0) {
      throw new Error("invalid");
    }
    if (encodeMovementCursor(createdAt, id) !== value) throw new Error("invalid");
    return { createdAt, id };
  } catch {
    throw new SupplyInventoryError("INVALID_SUPPLY_CURSOR", "Cursor de historial inválido", 400);
  }
}

export async function listSupplyMovements(
  db: PrismaClient,
  input: { supplyItemId: number; cursor: string | null; limit: number }
) {
  const item = await db.supplyItem.findUnique({
    where: { id: input.supplyItemId },
    select: { id: true, name: true, unitLabel: true },
  });
  if (!item) throw new SupplyInventoryError("SUPPLY_NOT_FOUND", "Suministro no encontrado", 404);
  const cursor = input.cursor ? decodeMovementCursor(input.cursor) : null;
  const movements = await db.supplyMovement.findMany({
    where: {
      supplyItemId: input.supplyItemId,
      ...(cursor
        ? {
            OR: [
              { createdAt: { lt: cursor.createdAt } },
              { createdAt: cursor.createdAt, id: { lt: cursor.id } },
            ],
          }
        : {}),
    },
    select: {
      id: true,
      supplyItemId: true,
      deltaQty: true,
      stockBefore: true,
      stockAfter: true,
      movementType: true,
      reason: true,
      createdAt: true,
      createdBy: { select: { id: true, name: true, username: true } },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: input.limit + 1,
  });
  const hasMore = movements.length > input.limit;
  const page = hasMore ? movements.slice(0, input.limit) : movements;
  const last = page[page.length - 1];
  return {
    supplyItem: item,
    movements: page,
    nextCursor: hasMore && last ? encodeMovementCursor(last.createdAt, last.id) : null,
  };
}
