import {
  InventoryMovementType,
  InventoryTrackingMode,
  Prisma,
  UnitType,
  type PrismaClient,
} from "@prisma/client";

type InventoryTx = Prisma.TransactionClient;
const MAX_STOCK = 2_147_483_647;

export type InventoryStatus = "AVAILABLE" | "LOW" | "OUT";

type VariantStockInput = {
  variantId: number;
  stock: unknown;
  lowStockThreshold?: unknown;
};

function normalizeVariantStockInputs(value: unknown) {
  if (!Array.isArray(value)) {
    throw new InventoryError("INVENTORY_VARIANTS_REQUIRED", "Captura el stock inicial de cada variante activa", 400);
  }
  const seen = new Set<number>();
  return value.map((row: VariantStockInput) => {
    const variantId = Number(row?.variantId);
    if (!Number.isInteger(variantId) || variantId <= 0 || seen.has(variantId)) {
      throw new InventoryError("INVALID_PRODUCT_VARIANT", "Las variantes de inventario son inválidas o están duplicadas", 400);
    }
    seen.add(variantId);
    return {
      variantId,
      stock: requireNonNegativeInteger(row.stock, "stock"),
      lowStockThreshold: optionalThreshold(row.lowStockThreshold),
    };
  });
}

export class InventoryError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "InventoryError";
  }
}

export function assertOrderInventoryNotReturned(inventoryReturnedAt: Date | null) {
  if (inventoryReturnedAt) {
    throw new InventoryError(
      "ORDER_INVENTORY_ALREADY_RETURNED",
      "El pedido fue cancelado y su inventario ya fue devuelto.",
      409
    );
  }
}

export function resolveExpectedOrderVersion(args: {
  requestedVersion: unknown;
  currentVersion: number;
  inventoryReturnedAt: Date | null;
  items: Array<{ inventoryBalanceId: number | null; inventoryDeductedQty: number }>;
}) {
  if (args.requestedVersion !== undefined && args.requestedVersion !== null && args.requestedVersion !== "") {
    const requested = Number(args.requestedVersion);
    if (!Number.isInteger(requested) || requested <= 0) {
      throw new InventoryError("ORDER_VERSION_REQUIRED", "La versión del pedido es requerida; recarga antes de guardar", 400);
    }
    return requested;
  }

  const participatesInInventory = args.inventoryReturnedAt !== null || args.items.some(
    (item) => item.inventoryBalanceId !== null || item.inventoryDeductedQty > 0
  );
  if (participatesInInventory) {
    throw new InventoryError("ORDER_VERSION_REQUIRED", "La versión del pedido es requerida; recarga antes de guardar", 400);
  }
  return args.currentVersion;
}

export function inventoryStatus(currentStock: number, lowStockThreshold: number | null) {
  if (currentStock === 0) return "OUT" as const;
  if (lowStockThreshold !== null && currentStock <= lowStockThreshold) return "LOW" as const;
  return "AVAILABLE" as const;
}

export function totalInventoryStock(balances: Array<{ currentStock: number }>) {
  return balances.reduce((sum, balance) => sum + balance.currentStock, 0);
}

export function requireNonNegativeInteger(value: unknown, field: string) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0 || number > MAX_STOCK) {
    throw new InventoryError("INVALID_INVENTORY_QUANTITY", `${field} debe ser un entero mayor o igual a 0`, 400);
  }
  return number;
}

export function requirePositiveInteger(value: unknown, field: string) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0 || number > MAX_STOCK) {
    throw new InventoryError("INVALID_INVENTORY_QUANTITY", `${field} debe ser un entero mayor a 0`, 400);
  }
  return number;
}

export function optionalThreshold(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  return requireNonNegativeInteger(value, "lowStockThreshold");
}

export function requireOperationKey(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    throw new InventoryError("INVENTORY_OPERATION_KEY_REQUIRED", "operationKey es requerido", 400);
  }
  return value.trim();
}

export function inventoryQuantity(value: Prisma.Decimal, productName: string) {
  if (!value.isInteger() || value.lte(0) || value.gt(MAX_STOCK)) {
    throw new InventoryError(
      "INVENTORY_REQUIRES_INTEGER_QUANTITY",
      `La cantidad para "${productName}" debe ser un entero cuando el inventario está habilitado`,
      400
    );
  }
  return value.toNumber();
}

export function assertStockableProduct(product: {
  unitType: UnitType;
  isCustomProductTemplate: boolean;
  minQty: Prisma.Decimal;
  qtyStep: Prisma.Decimal;
  name: string;
}) {
  if (product.unitType !== UnitType.PIECE) {
    throw new InventoryError("INVENTORY_PIECE_ONLY", "Solo los productos por pieza pueden controlar inventario", 400);
  }
  if (product.isCustomProductTemplate) {
    throw new InventoryError("INVENTORY_CUSTOM_PRODUCT_FORBIDDEN", "Producto Libre no puede controlar inventario", 400);
  }
  if (!product.minQty.isInteger() || !product.qtyStep.isInteger()) {
    throw new InventoryError(
      "INVENTORY_REQUIRES_INTEGER_RULES",
      `"${product.name}" usa reglas fraccionarias incompatibles con inventario por piezas`,
      400
    );
  }
}

type LockedBalance = {
  id: number;
  currentStock: number;
  version: number;
};

async function lockBalance(tx: InventoryTx, balanceId: number) {
  const rows = await tx.$queryRaw<LockedBalance[]>`
    SELECT "id", "currentStock", "version"
    FROM "BranchInventoryBalance"
    WHERE "id" = ${balanceId}
    FOR UPDATE
  `;
  if (rows.length !== 1) {
    throw new InventoryError("INVENTORY_NOT_FOUND", "Saldo de inventario no encontrado", 404);
  }
  return rows[0];
}

async function lockBranch(tx: InventoryTx, branchId: number) {
  const rows = await tx.$queryRaw<Array<{ id: number }>>`
    SELECT "id"
    FROM "Branch"
    WHERE "id" = ${branchId}
    FOR UPDATE
  `;
  if (rows.length !== 1) {
    throw new InventoryError("BRANCH_NOT_FOUND", "Sucursal no encontrada", 404);
  }
}

async function lockBranchProduct(tx: InventoryTx, branchProductId: number) {
  const rows = await tx.$queryRaw<Array<{ id: number }>>`
    SELECT "id"
    FROM "BranchProduct"
    WHERE "id" = ${branchProductId}
    FOR UPDATE
  `;
  if (rows.length !== 1) {
    throw new InventoryError("BRANCH_PRODUCT_NOT_FOUND", "Producto de sucursal no encontrado", 404);
  }
}

async function lockProducts(tx: InventoryTx, productIds: number[]) {
  if (productIds.length === 0) return;
  await tx.$queryRaw<Array<{ id: number }>>(Prisma.sql`
    SELECT "id"
    FROM "Product"
    WHERE "id" IN (${Prisma.join(productIds)})
    ORDER BY "id"
    FOR UPDATE
  `);
}

async function lockBranchProducts(
  tx: InventoryTx,
  branchId: number,
  productIds: number[]
) {
  if (productIds.length === 0) return;
  await tx.$queryRaw<Array<{ id: number }>>(Prisma.sql`
    SELECT "id"
    FROM "BranchProduct"
    WHERE "branchId" = ${branchId}
      AND "productId" IN (${Prisma.join(productIds)})
    ORDER BY "id"
    FOR UPDATE
  `);
}

async function lockInventoryConfig(tx: InventoryTx, configId: number) {
  const rows = await tx.$queryRaw<Array<{ id: number }>>`
    SELECT "id"
    FROM "BranchInventoryConfig"
    WHERE "id" = ${configId}
    FOR UPDATE
  `;
  if (rows.length !== 1) {
    throw new InventoryError("INVENTORY_NOT_FOUND", "Configuración de inventario no encontrada", 404);
  }
}

async function applyBalanceDelta(
  tx: InventoryTx,
  args: {
    balanceId: number;
    deltaQty: number;
    movementType: InventoryMovementType;
    operationKey: string;
    actorId?: number | null;
    orderId?: number | null;
    orderItemId?: number | null;
    reason?: string | null;
    product?: { id: number; name: string };
    requested?: number;
  }
) {
  if (!Number.isInteger(args.deltaQty)) {
    throw new InventoryError("INVALID_INVENTORY_QUANTITY", "El movimiento debe usar cantidades enteras", 400);
  }

  const existingMovement = await tx.inventoryMovement.findUnique({
    where: { operationKey: args.operationKey },
    select: {
      id: true,
      stockAfter: true,
      inventoryBalanceId: true,
      movementType: true,
      deltaQty: true,
      orderId: true,
    },
  });
  if (existingMovement) {
    if (
      existingMovement.inventoryBalanceId !== args.balanceId ||
      existingMovement.movementType !== args.movementType ||
      existingMovement.deltaQty !== args.deltaQty ||
      (existingMovement.orderId ?? null) !== (args.orderId ?? null)
    ) {
      throw new InventoryError("INVENTORY_OPERATION_KEY_REUSED", "operationKey ya fue utilizado", 409);
    }
    return { stockAfter: existingMovement.stockAfter, repeated: true };
  }

  const rows = args.deltaQty < 0
    ? await tx.$queryRaw<Array<{ currentStock: number }>>`
        UPDATE "BranchInventoryBalance"
        SET
          "currentStock" = "currentStock" + ${args.deltaQty},
          "version" = "version" + 1,
          "updatedAt" = NOW()
        WHERE "id" = ${args.balanceId}
          AND "currentStock" >= ${Math.abs(args.deltaQty)}
        RETURNING "currentStock"
      `
    : await tx.$queryRaw<Array<{ currentStock: number }>>`
        UPDATE "BranchInventoryBalance"
        SET
          "currentStock" = "currentStock" + ${args.deltaQty},
          "version" = "version" + 1,
          "updatedAt" = NOW()
        WHERE "id" = ${args.balanceId}
          AND "currentStock" <= ${MAX_STOCK - args.deltaQty}
        RETURNING "currentStock"
      `;

  if (rows.length !== 1) {
    const balance = await tx.branchInventoryBalance.findUnique({
      where: { id: args.balanceId },
      select: { currentStock: true },
    });
    if (args.deltaQty > 0) {
      throw new InventoryError("INVENTORY_STOCK_LIMIT", "El stock excede el límite permitido", 409);
    }
    throw new InventoryError("INSUFFICIENT_STOCK", `Stock insuficiente para "${args.product?.name ?? "producto"}"`, 409, {
      productId: args.product?.id,
      productName: args.product?.name,
      requested: args.requested ?? Math.abs(args.deltaQty),
      available: balance?.currentStock ?? 0,
    });
  }

  const stockAfter = Number(rows[0].currentStock);
  const stockBefore = stockAfter - args.deltaQty;

  await tx.inventoryMovement.create({
    data: {
      inventoryBalanceId: args.balanceId,
      deltaQty: args.deltaQty,
      stockBefore,
      stockAfter,
      movementType: args.movementType,
      operationKey: args.operationKey,
      orderId: args.orderId ?? null,
      orderItemId: args.orderItemId ?? null,
      createdById: args.actorId ?? null,
      reason: args.reason?.trim() || null,
    },
  });

  return { stockAfter, repeated: false };
}

export function activeBranchInventoryWhere(branchId: number) {
  return {
    branchId,
    isActive: true,
    branch: { isActive: true },
    product: {
      isActive: true,
      unitType: UnitType.PIECE,
      isCustomProductTemplate: false,
    },
  } as const;
}

export async function listInventoryForBranch(db: PrismaClient, branchId: number) {
  const rows = await db.branchProduct.findMany({
    where: activeBranchInventoryWhere(branchId),
    select: {
      id: true,
      isActive: true,
      product: {
        select: {
          id: true,
          name: true,
          isActive: true,
          unitType: true,
          minQty: true,
          qtyStep: true,
          isCustomProductTemplate: true,
          variants: {
            select: { id: true, name: true, isActive: true, order: true },
            orderBy: [{ order: "asc" }, { id: "asc" }],
          },
        },
      },
      inventoryConfig: {
        select: {
          id: true,
          isEnabled: true,
          trackingMode: true,
          activatedAt: true,
          deactivatedAt: true,
          balances: {
            select: {
              id: true,
              variantId: true,
              variant: { select: { id: true, name: true, isActive: true, order: true } },
              currentStock: true,
              lowStockThreshold: true,
              version: true,
              updatedAt: true,
              movements: {
                select: { createdAt: true, movementType: true },
                orderBy: { createdAt: "desc" },
                take: 1,
              },
            },
            orderBy: [{ variant: { order: "asc" } }, { id: "asc" }],
          },
        },
      },
    },
    orderBy: { product: { name: "asc" } },
  });

  return rows.map((row) => {
    const balances = row.inventoryConfig?.balances ?? [];
    const totalStock = totalInventoryStock(balances);
    const balanceDetails = balances.map((balance) => ({
      balanceId: balance.id,
      variantId: balance.variantId,
      variant: balance.variant,
      currentStock: balance.currentStock,
      lowStockThreshold: balance.lowStockThreshold,
      version: balance.version,
      status: inventoryStatus(balance.currentStock, balance.lowStockThreshold),
      updatedAt: balance.updatedAt,
      lastMovement: balance.movements[0] ?? null,
    }));
    const initializedVariantIds = new Set(balances.flatMap((balance) => balance.variantId ? [balance.variantId] : []));
    const lowVariantCount = balanceDetails.filter(
      (balance) => balance.variant?.isActive && balance.status === "LOW"
    ).length;
    const outVariantCount = balanceDetails.filter(
      (balance) => balance.variant?.isActive && balance.status === "OUT"
    ).length;
    const aggregateStatus = totalStock === 0
      ? "OUT"
      : lowVariantCount > 0 || outVariantCount > 0
        ? "LOW"
        : "AVAILABLE";
    return {
      branchProductId: row.id,
      branchProductIsActive: row.isActive,
      product: {
        id: row.product.id,
        name: row.product.name,
        isActive: row.product.isActive,
        unitType: row.product.unitType,
        minQty: row.product.minQty.toString(),
        qtyStep: row.product.qtyStep.toString(),
        variants: row.product.variants,
      },
      inventory: row.inventoryConfig && balances.length > 0
        ? {
            configId: row.inventoryConfig.id,
            enabled: row.inventoryConfig.isEnabled,
            trackingMode: row.inventoryConfig.trackingMode,
            currentStock: totalStock,
            lowStockThreshold: row.inventoryConfig.trackingMode === InventoryTrackingMode.PRODUCT
              ? balances[0]?.lowStockThreshold ?? null
              : null,
            status: aggregateStatus,
            lowVariantCount,
            outVariantCount,
            balances: balanceDetails,
            uninitializedVariants: row.product.variants.filter(
              (variant) => variant.isActive && !initializedVariantIds.has(variant.id)
            ),
            activatedAt: row.inventoryConfig.activatedAt,
            deactivatedAt: row.inventoryConfig.deactivatedAt,
            updatedAt: balances.reduce(
              (latest, balance) => balance.updatedAt > latest ? balance.updatedAt : latest,
              balances[0].updatedAt
            ),
            lastMovement: balances
              .flatMap((balance) => balance.movements)
              .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())[0] ?? null,
          }
        : null,
    };
  });
}

export async function activateInventory(
  db: PrismaClient,
  input: {
    branchProductId: number;
    trackingMode?: unknown;
    initialStock?: unknown;
    lowStockThreshold?: unknown;
    variants?: unknown;
    actorId: number;
    operationKey: string;
  }
) {
  const trackingMode = input.trackingMode === undefined
    ? InventoryTrackingMode.PRODUCT
    : input.trackingMode === InventoryTrackingMode.VARIANT
    ? InventoryTrackingMode.VARIANT
    : input.trackingMode === InventoryTrackingMode.PRODUCT
      ? InventoryTrackingMode.PRODUCT
      : null;
  if (!trackingMode) throw new InventoryError("INVALID_INVENTORY_TRACKING_MODE", "Modo de inventario inválido", 400);

  return db.$transaction(async (tx) => {
    const reference = await tx.branchProduct.findUnique({
      where: { id: input.branchProductId },
      select: { branchId: true, productId: true },
    });
    if (!reference) throw new InventoryError("BRANCH_PRODUCT_NOT_FOUND", "Producto de sucursal no encontrado", 404);
    await lockBranch(tx, reference.branchId);
    await lockProducts(tx, [reference.productId]);
    await lockBranchProduct(tx, input.branchProductId);
    const branchProduct = await tx.branchProduct.findUnique({
      where: { id: input.branchProductId },
      include: {
        product: {
          include: {
            variants: {
              where: { isActive: true },
              orderBy: [{ order: "asc" }, { id: "asc" }],
            },
          },
        },
        branch: { select: { isActive: true } },
        inventoryConfig: true,
      },
    });
    if (!branchProduct) throw new InventoryError("BRANCH_PRODUCT_NOT_FOUND", "Producto de sucursal no encontrado", 404);
    assertStockableProduct(branchProduct.product);
    if (!branchProduct.branch.isActive || !branchProduct.isActive || !branchProduct.product.isActive) {
      throw new InventoryError("INVENTORY_PRODUCT_INACTIVE", "El producto debe estar activo en la sucursal", 400);
    }
    if (branchProduct.inventoryConfig) {
      throw new InventoryError("INVENTORY_ALREADY_CONFIGURED", "El producto ya tiene configuración de inventario", 409);
    }

    const config = await tx.branchInventoryConfig.create({
      data: {
        branchProductId: branchProduct.id,
        isEnabled: true,
        trackingMode,
        activatedAt: new Date(),
        activatedById: input.actorId,
      },
    });
    const balanceInputs = trackingMode === InventoryTrackingMode.PRODUCT
      ? [{
          variantId: null,
          stock: requireNonNegativeInteger(input.initialStock, "initialStock"),
          lowStockThreshold: optionalThreshold(input.lowStockThreshold),
        }]
      : normalizeVariantStockInputs(input.variants);

    if (trackingMode === InventoryTrackingMode.VARIANT) {
      const activeVariantIds = branchProduct.product.variants.map((variant) => variant.id);
      if (activeVariantIds.length === 0) {
        throw new InventoryError("INVENTORY_VARIANTS_REQUIRED", "El producto no tiene variantes activas", 400);
      }
      const requestedIds = new Set(balanceInputs.map((balance) => balance.variantId));
      if (
        requestedIds.size !== activeVariantIds.length ||
        activeVariantIds.some((variantId) => !requestedIds.has(variantId))
      ) {
        throw new InventoryError(
          "INVENTORY_VARIANT_STOCK_INCOMPLETE",
          "Captura el stock inicial de todas las variantes activas",
          400
        );
      }
    }

    const createdBalances = [];
    for (const balanceInput of balanceInputs) {
      const balance = await tx.branchInventoryBalance.create({
        data: {
          inventoryConfigId: config.id,
          variantId: balanceInput.variantId,
          currentStock: balanceInput.stock,
          lowStockThreshold: balanceInput.lowStockThreshold,
        },
      });
      await tx.inventoryMovement.create({
        data: {
          inventoryBalanceId: balance.id,
          deltaQty: balanceInput.stock,
          stockBefore: 0,
          stockAfter: balanceInput.stock,
          movementType: InventoryMovementType.INITIAL_STOCK,
          createdById: input.actorId,
          reason: "Stock inicial",
          operationKey: `${input.operationKey}:${balanceInput.variantId ?? "product"}`,
        },
      });
      createdBalances.push({
        balanceId: balance.id,
        variantId: balance.variantId,
        currentStock: balance.currentStock,
      });
    }
    return { configId: config.id, trackingMode, balances: createdBalances };
  });
}

export async function deactivateInventory(db: PrismaClient, configId: number, actorId: number) {
  return db.$transaction(async (tx) => {
    const reference = await tx.branchInventoryConfig.findUnique({
      where: { id: configId },
      select: { branchProductId: true },
    });
    if (!reference) throw new InventoryError("INVENTORY_NOT_FOUND", "Configuración de inventario no encontrada", 404);
    await lockBranchProduct(tx, reference.branchProductId);
    await lockInventoryConfig(tx, configId);
    const existing = await tx.branchInventoryConfig.findUnique({ where: { id: configId } });
    if (!existing) throw new InventoryError("INVENTORY_NOT_FOUND", "Configuración de inventario no encontrada", 404);
    return tx.branchInventoryConfig.update({
      where: { id: configId },
      data: { isEnabled: false, deactivatedAt: new Date(), deactivatedById: actorId },
    });
  });
}

export async function reactivateInventory(
  db: PrismaClient,
  input: {
    configId: number;
    trackingMode?: unknown;
    physicalStock?: unknown;
    lowStockThreshold?: unknown;
    variants?: unknown;
    actorId: number;
    operationKey: string;
  }
) {
  return db.$transaction(async (tx) => {
    const reference = await tx.branchInventoryConfig.findUnique({
      where: { id: input.configId },
      select: {
        branchProductId: true,
        branchProduct: { select: { branchId: true, productId: true } },
      },
    });
    if (!reference) throw new InventoryError("INVENTORY_NOT_FOUND", "Configuración de inventario no encontrada", 404);
    await lockBranch(tx, reference.branchProduct.branchId);
    await lockProducts(tx, [reference.branchProduct.productId]);
    await lockBranchProduct(tx, reference.branchProductId);
    await lockInventoryConfig(tx, input.configId);
    const config = await tx.branchInventoryConfig.findUnique({
      where: { id: input.configId },
      include: {
        balances: { orderBy: { id: "asc" } },
        branchProduct: {
          include: {
            product: {
              include: {
                variants: { orderBy: [{ order: "asc" }, { id: "asc" }] },
              },
            },
            branch: { select: { isActive: true } },
          },
        },
      },
    });
    if (!config || config.balances.length === 0) {
      throw new InventoryError("INVENTORY_NOT_FOUND", "Configuración de inventario no encontrada", 404);
    }
    assertStockableProduct(config.branchProduct.product);
    if (!config.branchProduct.branch.isActive || !config.branchProduct.isActive || !config.branchProduct.product.isActive) {
      throw new InventoryError("INVENTORY_PRODUCT_INACTIVE", "El producto debe estar activo en la sucursal", 400);
    }
    if (config.isEnabled) throw new InventoryError("INVENTORY_ALREADY_ENABLED", "El inventario ya está activo", 409);
    if (input.trackingMode !== undefined && input.trackingMode !== config.trackingMode) {
      throw new InventoryError(
        "INVENTORY_TRACKING_MODE_IMMUTABLE",
        "El modo de inventario no puede cambiar después de inicializar movimientos",
        409
      );
    }

    const targets = config.trackingMode === InventoryTrackingMode.PRODUCT
      ? [{
          variantId: null,
          stock: requireNonNegativeInteger(input.physicalStock, "physicalStock"),
          lowStockThreshold: optionalThreshold(input.lowStockThreshold),
        }]
      : normalizeVariantStockInputs(input.variants);

    if (config.trackingMode === InventoryTrackingMode.VARIANT) {
      const validVariantIds = new Set(config.branchProduct.product.variants.map((variant) => variant.id));
      const requiredVariantIds = new Set([
        ...config.balances.flatMap((balance) => balance.variantId ? [balance.variantId] : []),
        ...config.branchProduct.product.variants.filter((variant) => variant.isActive).map((variant) => variant.id),
      ]);
      const targetIds = new Set(targets.map((target) => target.variantId));
      if (
        targets.some((target) => target.variantId === null || !validVariantIds.has(target.variantId)) ||
        targetIds.size !== requiredVariantIds.size ||
        [...requiredVariantIds].some((variantId) => !targetIds.has(variantId))
      ) {
        throw new InventoryError(
          "INVENTORY_VARIANT_STOCK_INCOMPLETE",
          "Captura el conteo físico de todas las variantes con inventario",
          400
        );
      }
    }

    const existingByVariant = new Map(
      config.balances.map((balance) => [balance.variantId ?? 0, balance])
    );
    const resultingBalances = [];
    for (const target of targets) {
      const existing = existingByVariant.get(target.variantId ?? 0);
      if (!existing) {
        const created = await tx.branchInventoryBalance.create({
          data: {
            inventoryConfigId: config.id,
            variantId: target.variantId,
            currentStock: target.stock,
            lowStockThreshold: target.lowStockThreshold,
          },
        });
        await tx.inventoryMovement.create({
          data: {
            inventoryBalanceId: created.id,
            deltaQty: target.stock,
            stockBefore: 0,
            stockAfter: target.stock,
            movementType: InventoryMovementType.INITIAL_STOCK,
            createdById: input.actorId,
            reason: "Stock inicial al reactivar",
            operationKey: `${input.operationKey}:${target.variantId ?? "product"}:initial`,
          },
        });
        resultingBalances.push({ balanceId: created.id, variantId: created.variantId, currentStock: created.currentStock });
        continue;
      }

      const locked = await lockBalance(tx, existing.id);
      const deltaQty = target.stock - locked.currentStock;
      if (deltaQty !== 0) {
        await applyBalanceDelta(tx, {
          balanceId: locked.id,
          deltaQty,
          movementType: InventoryMovementType.ADJUSTMENT,
          operationKey: `${input.operationKey}:${target.variantId ?? "product"}:adjust`,
          actorId: input.actorId,
          reason: "Conteo físico de reactivación",
        });
      }
      await tx.branchInventoryBalance.update({
        where: { id: locked.id },
        data: { lowStockThreshold: target.lowStockThreshold },
      });
      resultingBalances.push({ balanceId: locked.id, variantId: target.variantId, currentStock: target.stock });
    }
    await tx.branchInventoryConfig.update({
      where: { id: config.id },
      data: {
        isEnabled: true,
        activatedAt: new Date(),
        activatedById: input.actorId,
        deactivatedAt: null,
        deactivatedById: null,
      },
    });
    return { configId: config.id, trackingMode: config.trackingMode, balances: resultingBalances };
  });
}

export async function initializeInventoryVariant(
  db: PrismaClient,
  input: {
    configId: number;
    variantId: number;
    initialStock: unknown;
    lowStockThreshold?: unknown;
    actorId: number;
    operationKey: string;
  }
) {
  const initialStock = requireNonNegativeInteger(input.initialStock, "initialStock");
  const lowStockThreshold = optionalThreshold(input.lowStockThreshold);

  return db.$transaction(async (tx) => {
    const reference = await tx.branchInventoryConfig.findUnique({
      where: { id: input.configId },
      select: {
        branchProductId: true,
        branchProduct: { select: { branchId: true, productId: true } },
      },
    });
    if (!reference) throw new InventoryError("INVENTORY_NOT_FOUND", "Configuración de inventario no encontrada", 404);
    await lockBranch(tx, reference.branchProduct.branchId);
    await lockProducts(tx, [reference.branchProduct.productId]);
    await lockBranchProduct(tx, reference.branchProductId);
    await lockInventoryConfig(tx, input.configId);

    const config = await tx.branchInventoryConfig.findUnique({
      where: { id: input.configId },
      include: {
        balances: true,
        branchProduct: {
          include: {
            branch: { select: { isActive: true } },
            product: { include: { variants: true } },
          },
        },
      },
    });
    if (!config) throw new InventoryError("INVENTORY_NOT_FOUND", "Configuración de inventario no encontrada", 404);
    if (!config.isEnabled) throw new InventoryError("INVENTORY_DISABLED", "Reactiva el inventario antes de inicializar variantes", 409);
    if (config.trackingMode !== InventoryTrackingMode.VARIANT) {
      throw new InventoryError("INVENTORY_NOT_VARIANT_TRACKED", "El inventario no está configurado por variante", 409);
    }
    assertStockableProduct(config.branchProduct.product);
    if (!config.branchProduct.branch.isActive || !config.branchProduct.isActive || !config.branchProduct.product.isActive) {
      throw new InventoryError("INVENTORY_PRODUCT_INACTIVE", "El producto debe estar activo en la sucursal", 400);
    }
    const variant = config.branchProduct.product.variants.find((candidate) => candidate.id === input.variantId);
    if (!variant || !variant.isActive) {
      throw new InventoryError("INVALID_PRODUCT_VARIANT", "La variante no existe o está inactiva", 400);
    }
    if (config.balances.some((balance) => balance.variantId === variant.id)) {
      throw new InventoryError("INVENTORY_VARIANT_ALREADY_INITIALIZED", "La variante ya tiene inventario inicializado", 409);
    }

    const balance = await tx.branchInventoryBalance.create({
      data: {
        inventoryConfigId: config.id,
        variantId: variant.id,
        currentStock: initialStock,
        lowStockThreshold,
      },
    });
    await tx.inventoryMovement.create({
      data: {
        inventoryBalanceId: balance.id,
        deltaQty: initialStock,
        stockBefore: 0,
        stockAfter: initialStock,
        movementType: InventoryMovementType.INITIAL_STOCK,
        createdById: input.actorId,
        reason: "Stock inicial de variante",
        operationKey: `${input.operationKey}:${variant.id}`,
      },
    });
    return { balanceId: balance.id, variantId: variant.id, currentStock: balance.currentStock };
  });
}

async function manualStockChange(
  db: PrismaClient,
  input: {
    balanceId: number;
    actorId: number;
    operationKey: string;
    movementType: InventoryMovementType;
    deltaQty?: number;
    targetStock?: number;
    reason?: string | null;
  }
) {
  return db.$transaction(async (tx) => {
    const balance = await tx.branchInventoryBalance.findUnique({
      where: { id: input.balanceId },
      include: { inventoryConfig: { include: { branchProduct: { include: { product: true } } } } },
    });
    if (!balance) throw new InventoryError("INVENTORY_NOT_FOUND", "Saldo de inventario no encontrado", 404);
    await lockBranchProduct(tx, balance.inventoryConfig.branchProduct.id);
    await lockInventoryConfig(tx, balance.inventoryConfig.id);
    const config = await tx.branchInventoryConfig.findUnique({
      where: { id: balance.inventoryConfig.id },
      select: { isEnabled: true },
    });
    if (!config?.isEnabled) {
      throw new InventoryError("INVENTORY_DISABLED", "Reactiva el inventario con un conteo físico antes de modificar stock", 409);
    }
    const locked = await lockBalance(tx, balance.id);
    const deltaQty = input.targetStock === undefined
      ? input.deltaQty!
      : input.targetStock - locked.currentStock;
    if (deltaQty === 0) return { currentStock: locked.currentStock, unchanged: true };
    return applyBalanceDelta(tx, {
      balanceId: balance.id,
      deltaQty,
      movementType: input.movementType,
      operationKey: input.operationKey,
      actorId: input.actorId,
      reason: input.reason,
      product: {
        id: balance.inventoryConfig.branchProduct.product.id,
        name: balance.inventoryConfig.branchProduct.product.name,
      },
    });
  });
}

export function restockInventory(db: PrismaClient, input: {
  balanceId: number;
  quantity: unknown;
  actorId: number;
  operationKey: string;
  reason?: string | null;
}) {
  const quantity = requirePositiveInteger(input.quantity, "quantity");
  return manualStockChange(db, {
    ...input,
    deltaQty: quantity,
    movementType: InventoryMovementType.RESTOCK,
  });
}

export function removeInventory(db: PrismaClient, input: {
  balanceId: number;
  quantity: unknown;
  actorId: number;
  operationKey: string;
  reason: string;
}) {
  const quantity = requirePositiveInteger(input.quantity, "quantity");
  if (!input.reason?.trim()) throw new InventoryError("INVENTORY_REASON_REQUIRED", "El motivo es obligatorio", 400);
  return manualStockChange(db, {
    ...input,
    deltaQty: -quantity,
    movementType: InventoryMovementType.MANUAL_REMOVE,
  });
}

export function adjustInventory(db: PrismaClient, input: {
  balanceId: number;
  targetStock: unknown;
  actorId: number;
  operationKey: string;
  reason: string;
}) {
  const targetStock = requireNonNegativeInteger(input.targetStock, "targetStock");
  if (!input.reason?.trim()) throw new InventoryError("INVENTORY_REASON_REQUIRED", "El motivo es obligatorio", 400);
  return manualStockChange(db, {
    ...input,
    targetStock,
    movementType: InventoryMovementType.ADJUSTMENT,
  });
}

export async function listInventoryMovements(db: PrismaClient, balanceId: number) {
  const balance = await db.branchInventoryBalance.findUnique({ where: { id: balanceId }, select: { id: true } });
  if (!balance) throw new InventoryError("INVENTORY_NOT_FOUND", "Saldo de inventario no encontrado", 404);
  return db.inventoryMovement.findMany({
    where: { inventoryBalanceId: balanceId },
    include: {
      createdBy: { select: { id: true, name: true, username: true } },
      order: { select: { id: true } },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 500,
  });
}

type CreatedInventoryItem = {
  orderItemId: number;
  productId: number;
  productName: string;
  quantity: Prisma.Decimal;
  variantId?: number | null;
  isCustomProduct: boolean;
};

export async function applyInventoryToCreatedOrder(
  tx: InventoryTx,
  args: {
    branchId: number;
    orderId: number;
    actorId: number;
    items: CreatedInventoryItem[];
  }
) {
  const normalItems = args.items.filter((item) => !item.isCustomProduct);
  if (normalItems.length === 0) return;
  const productIds = [...new Set(normalItems.map((item) => item.productId))];
  await lockBranch(tx, args.branchId);
  await lockProducts(tx, productIds);
  await lockBranchProducts(tx, args.branchId, productIds);
  const activeBranchProducts = await tx.branchProduct.findMany({
    where: {
      branchId: args.branchId,
      productId: { in: productIds },
      isActive: true,
      branch: { isActive: true },
      product: { isActive: true },
    },
    select: { productId: true },
  });
  const activeProductIds = new Set(activeBranchProducts.map((row) => row.productId));
  const unavailableProductId = productIds.find((productId) => !activeProductIds.has(productId));
  if (unavailableProductId !== undefined) {
    throw new InventoryError(
      "BRANCH_PRODUCT_UNAVAILABLE",
      "El producto dejó de estar disponible en la sucursal",
      409,
      { productId: unavailableProductId }
    );
  }
  const configs = await tx.branchInventoryConfig.findMany({
    where: {
      isEnabled: true,
      branchProduct: { branchId: args.branchId, productId: { in: productIds } },
    },
    include: {
      balances: true,
      branchProduct: {
        include: {
          product: { include: { variants: true } },
        },
      },
    },
  });
  const byProductId = new Map(configs.map((config) => [config.branchProduct.productId, config]));
  const aggregates = new Map<number, {
    balanceId: number;
    product: { id: number; name: string };
    quantity: number;
    items: Array<{ orderItemId: number; quantity: number }>;
  }>();

  for (const item of normalItems) {
    const config = byProductId.get(item.productId);
    if (!config) continue;
    assertStockableProduct(config.branchProduct.product);
    let balance;
    if (config.trackingMode === InventoryTrackingMode.PRODUCT) {
      balance = config.balances.find((candidate) => candidate.variantId === null);
    } else {
      if (!item.variantId) {
        throw new InventoryError("INVENTORY_VARIANT_REQUIRED", `Selecciona una variante para "${item.productName}"`, 400);
      }
      const variant = config.branchProduct.product.variants.find((candidate) => candidate.id === item.variantId);
      if (!variant || !variant.isActive) {
        throw new InventoryError("INVALID_PRODUCT_VARIANT", `La variante de "${item.productName}" no está disponible`, 400);
      }
      balance = config.balances.find((candidate) => candidate.variantId === item.variantId);
      if (!balance) {
        throw new InventoryError(
          "INVENTORY_VARIANT_NOT_INITIALIZED",
          `La variante de "${item.productName}" no tiene inventario inicializado`,
          409,
          { productId: item.productId, variantId: item.variantId }
        );
      }
    }
    if (!balance) {
      throw new InventoryError("INVENTORY_NOT_FOUND", `No existe saldo para "${item.productName}"`, 409);
    }
    const quantity = inventoryQuantity(item.quantity, item.productName);
    const current = aggregates.get(balance.id) ?? {
      balanceId: balance.id,
      product: { id: item.productId, name: item.productName },
      quantity: 0,
      items: [],
    };
    current.quantity += quantity;
    current.items.push({ orderItemId: item.orderItemId, quantity });
    aggregates.set(balance.id, current);
  }

  for (const aggregate of [...aggregates.values()].sort((a, b) => a.balanceId - b.balanceId)) {
    await applyBalanceDelta(tx, {
      balanceId: aggregate.balanceId,
      deltaQty: -aggregate.quantity,
      movementType: InventoryMovementType.ORDER_CREATED,
      operationKey: `order:create:${args.orderId}:balance:${aggregate.balanceId}`,
      actorId: args.actorId,
      orderId: args.orderId,
      product: aggregate.product,
      requested: aggregate.quantity,
    });
    for (const item of aggregate.items) {
      await tx.orderItem.update({
        where: { id: item.orderItemId },
        data: { inventoryBalanceId: aggregate.balanceId, inventoryDeductedQty: item.quantity },
      });
    }
  }
}

export async function lockOrderForInventory(tx: InventoryTx, orderId: number) {
  const rows = await tx.$queryRaw<Array<{
    id: number;
    version: number;
    inventoryReturnedAt: Date | null;
    stage: string;
    shippingType: string;
  }>>`
    SELECT "id", "version", "inventoryReturnedAt", "stage", "shippingType"
    FROM "Order"
    WHERE "id" = ${orderId}
    FOR UPDATE
  `;
  if (rows.length !== 1) throw new InventoryError("ORDER_NOT_FOUND", "Pedido no encontrado", 404);
  return rows[0];
}

export async function applyInventoryToOrderEdit(
  tx: InventoryTx,
  args: {
    orderId: number;
    branchId: number;
    actorId: number;
    expectedVersion: number;
    newItems: Array<{
      itemId: number;
      productId: number;
      quantity: Prisma.Decimal;
      variantId?: number | null;
    }>;
  }
) {
  const lockedOrder = await lockOrderForInventory(tx, args.orderId);
  if (lockedOrder.version !== args.expectedVersion) {
    throw new InventoryError("ORDER_VERSION_CONFLICT", "El pedido cambió; recarga antes de guardar", 409);
  }
  assertOrderInventoryNotReturned(lockedOrder.inventoryReturnedAt);
  const existingItems = await tx.orderItem.findMany({
    where: { orderId: args.orderId },
    select: {
      id: true,
      productId: true,
      quantity: true,
      variantId: true,
      inventoryBalanceId: true,
      inventoryDeductedQty: true,
      productNameSnapshot: true,
    },
  });
  const newById = new Map(args.newItems.map((item) => [item.itemId, item]));
  await lockProducts(tx, [...new Set(args.newItems.map((item) => item.productId))]);
  const configs = await tx.branchInventoryConfig.findMany({
    where: {
      branchProduct: {
        branchId: args.branchId,
        productId: { in: [...new Set(args.newItems.map((item) => item.productId))] },
      },
    },
    include: {
      balances: true,
      branchProduct: {
        include: { product: { include: { variants: true } } },
      },
    },
  });
  const configByProduct = new Map(configs.map((config) => [config.branchProduct.productId, config]));
  const stockDeltaByBalance = new Map<number, {
    deltaQty: number;
    product: { id: number; name: string };
  }>();
  const itemUpdates: Array<{ itemId: number; balanceId: number; deductedQty: number }> = [];

  function addBalanceDelta(
    balanceId: number,
    deltaQty: number,
    product: { id: number; name: string }
  ) {
    const current = stockDeltaByBalance.get(balanceId) ?? { deltaQty: 0, product };
    current.deltaQty += deltaQty;
    stockDeltaByBalance.set(balanceId, current);
  }

  for (const existing of existingItems) {
    const next = newById.get(existing.id);
    if (!next) continue;
    const quantityChanged = !next.quantity.equals(existing.quantity);
    const nextVariantId = next.variantId ?? null;
    const variantChanged = nextVariantId !== existing.variantId;
    const config = configByProduct.get(existing.productId);
    if (existing.inventoryBalanceId === null) {
      if ((quantityChanged || variantChanged) && config?.isEnabled) {
        throw new InventoryError(
          "HISTORICAL_INVENTORY_ITEM_EDIT_FORBIDDEN",
          `No se puede cambiar la cantidad histórica de "${existing.productNameSnapshot}" después de activar inventario`,
          409
        );
      }
      continue;
    }

    const nextQuantity = inventoryQuantity(next.quantity, existing.productNameSnapshot);
    if (!config) throw new InventoryError("INVENTORY_NOT_FOUND", "La configuración de inventario ya no existe", 409);
    let nextBalance;
    if (config.trackingMode === InventoryTrackingMode.PRODUCT) {
      nextBalance = config.balances.find((balance) => balance.variantId === null);
    } else {
      if (!nextVariantId) {
        throw new InventoryError("INVENTORY_VARIANT_REQUIRED", `Selecciona una variante para "${existing.productNameSnapshot}"`, 400);
      }
      const variant = config.branchProduct.product.variants.find((candidate) => candidate.id === nextVariantId);
      if (!variant || (variantChanged && !variant.isActive)) {
        throw new InventoryError("INVALID_PRODUCT_VARIANT", "La variante no existe o está inactiva", 400);
      }
      nextBalance = config.balances.find((balance) => balance.variantId === nextVariantId);
      if (!nextBalance) {
        throw new InventoryError(
          "INVENTORY_VARIANT_NOT_INITIALIZED",
          `La variante de "${existing.productNameSnapshot}" no tiene inventario inicializado`,
          409,
          { productId: existing.productId, variantId: nextVariantId }
        );
      }
    }
    if (!nextBalance) throw new InventoryError("INVENTORY_NOT_FOUND", "Saldo de inventario no encontrado", 409);

    const product = { id: existing.productId, name: existing.productNameSnapshot };
    if (nextBalance.id === existing.inventoryBalanceId) {
      addBalanceDelta(existing.inventoryBalanceId, existing.inventoryDeductedQty - nextQuantity, product);
    } else {
      addBalanceDelta(existing.inventoryBalanceId, existing.inventoryDeductedQty, product);
      addBalanceDelta(nextBalance.id, -nextQuantity, product);
    }
    itemUpdates.push({ itemId: existing.id, balanceId: nextBalance.id, deductedQty: nextQuantity });
  }

  for (const [balanceId, change] of [...stockDeltaByBalance.entries()].sort(([a], [b]) => a - b)) {
    if (change.deltaQty !== 0) {
      await applyBalanceDelta(tx, {
        balanceId,
        deltaQty: change.deltaQty,
        movementType: InventoryMovementType.ORDER_EDITED,
        operationKey: `order:edit:${args.orderId}:v${lockedOrder.version + 1}:balance:${balanceId}`,
        actorId: args.actorId,
        orderId: args.orderId,
        product: change.product,
        requested: Math.abs(change.deltaQty),
      });
    }
  }
  for (const item of itemUpdates) {
    await tx.orderItem.update({
      where: { id: item.itemId },
      data: {
        inventoryBalanceId: item.balanceId,
        inventoryDeductedQty: item.deductedQty,
      },
    });
  }

  return { nextVersion: lockedOrder.version + 1 };
}

export async function returnInventoryForCancellation(
  tx: InventoryTx,
  args: { orderId: number; actorId: number }
) {
  const lockedOrder = await lockOrderForInventory(tx, args.orderId);
  if (lockedOrder.stage === "DELIVERED") {
    throw new InventoryError("DELIVERED_ORDER_CANNOT_BE_CANCELLED", "No se puede cancelar un pedido entregado", 409);
  }
  if (lockedOrder.inventoryReturnedAt) return { returned: false, inventoryReturnedAt: lockedOrder.inventoryReturnedAt };
  const items = await tx.orderItem.findMany({
    where: { orderId: args.orderId, inventoryBalanceId: { not: null }, inventoryDeductedQty: { gt: 0 } },
    select: { id: true, inventoryBalanceId: true, inventoryDeductedQty: true, productId: true, productNameSnapshot: true },
  });
  const aggregates = new Map<number, { quantity: number; product: { id: number; name: string }; itemIds: number[] }>();
  for (const item of items) {
    const balanceId = item.inventoryBalanceId!;
    const current = aggregates.get(balanceId) ?? {
      quantity: 0,
      product: { id: item.productId, name: item.productNameSnapshot },
      itemIds: [],
    };
    current.quantity += item.inventoryDeductedQty;
    current.itemIds.push(item.id);
    aggregates.set(balanceId, current);
  }
  for (const [balanceId, aggregate] of [...aggregates.entries()].sort(([a], [b]) => a - b)) {
    await applyBalanceDelta(tx, {
      balanceId,
      deltaQty: aggregate.quantity,
      movementType: InventoryMovementType.ORDER_CANCELLED,
      operationKey: `order:cancel:${args.orderId}:balance:${balanceId}`,
      actorId: args.actorId,
      orderId: args.orderId,
      product: aggregate.product,
    });
    await tx.orderItem.updateMany({
      where: { id: { in: aggregate.itemIds } },
      data: { inventoryDeductedQty: 0 },
    });
  }
  const inventoryReturnedAt = new Date();
  await tx.order.update({ where: { id: args.orderId }, data: { inventoryReturnedAt } });
  return { returned: true, inventoryReturnedAt };
}

async function returnBalanceWithoutMovement(
  tx: InventoryTx,
  balanceId: number,
  quantity: number
) {
  const rows = await tx.$queryRaw<Array<{ currentStock: number }>>`
    UPDATE "BranchInventoryBalance"
    SET
      "currentStock" = "currentStock" + ${quantity},
      "version" = "version" + 1,
      "updatedAt" = NOW()
    WHERE "id" = ${balanceId}
      AND "currentStock" <= ${MAX_STOCK - quantity}
    RETURNING "currentStock"
  `;
  if (rows.length !== 1) {
    throw new InventoryError("INVENTORY_STOCK_LIMIT", "El stock excede el límite permitido", 409);
  }
  return rows[0].currentStock;
}

export async function prepareInventoryForHardDelete(
  tx: InventoryTx,
  args: { orderId: number }
) {
  const lockedOrder = await lockOrderForInventory(tx, args.orderId);

  const items = await tx.orderItem.findMany({
    where: {
      orderId: args.orderId,
    },
    select: {
      id: true,
      inventoryBalanceId: true,
      inventoryDeductedQty: true,
      productId: true,
      productNameSnapshot: true,
    },
  });
  const aggregates = new Map<number, {
    quantity: number;
    product: { id: number; name: string };
    itemIds: number[];
  }>();
  for (const item of items) {
    if (
      lockedOrder.inventoryReturnedAt ||
      item.inventoryBalanceId === null ||
      item.inventoryDeductedQty <= 0
    ) continue;
    const balanceId = item.inventoryBalanceId!;
    const current = aggregates.get(balanceId) ?? {
      quantity: 0,
      product: { id: item.productId, name: item.productNameSnapshot },
      itemIds: [],
    };
    current.quantity += item.inventoryDeductedQty;
    current.itemIds.push(item.id);
    aggregates.set(balanceId, current);
  }

  for (const [balanceId, aggregate] of [...aggregates.entries()].sort(([a], [b]) => a - b)) {
    await returnBalanceWithoutMovement(tx, balanceId, aggregate.quantity);
  }

  const itemIds = items.map((item) => item.id);
  const deletedMovements = await tx.inventoryMovement.deleteMany({
    where: {
      AND: [
        {
          movementType: {
            in: [
              InventoryMovementType.ORDER_CREATED,
              InventoryMovementType.ORDER_EDITED,
              InventoryMovementType.ORDER_CANCELLED,
            ],
          },
        },
        {
          OR: [
            { orderId: args.orderId },
            ...(itemIds.length > 0 ? [{ orderItemId: { in: itemIds } }] : []),
          ],
        },
      ],
    },
  });
  return {
    returnedQuantity: [...aggregates.values()].reduce((sum, aggregate) => sum + aggregate.quantity, 0),
    deletedMovementCount: deletedMovements.count,
    itemIds,
  };
}

export async function orderHasInventoryMovements(tx: InventoryTx, orderId: number) {
  return (await tx.inventoryMovement.count({ where: { orderId } })) > 0;
}
