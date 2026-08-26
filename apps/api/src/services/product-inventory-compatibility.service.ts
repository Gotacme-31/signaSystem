import { Prisma, UnitType } from "@prisma/client";

type ProductInventoryTx = Prisma.TransactionClient;

export class ProductInventoryCompatibilityError extends Error {
  readonly code = "PRODUCT_HAS_INVENTORY_CONFIGURATION";
  readonly status = 409;

  constructor() {
    super("El producto tiene configuración de inventario y debe conservar unidad y cantidades enteras.");
    this.name = "ProductInventoryCompatibilityError";
  }
}

export function assertProductInventoryCompatibility(args: {
  hasInventoryConfig: boolean;
  unitType: UnitType;
  minQty: Prisma.Decimal;
  qtyStep: Prisma.Decimal;
}) {
  if (!args.hasInventoryConfig) return;
  if (
    args.unitType !== UnitType.PIECE ||
    !args.minQty.isInteger() ||
    !args.qtyStep.isInteger()
  ) {
    throw new ProductInventoryCompatibilityError();
  }
}

export async function validateProductInventoryChange(
  tx: ProductInventoryTx,
  input: {
    productId: number;
    unitType?: UnitType;
    minQty?: Prisma.Decimal;
    qtyStep?: Prisma.Decimal;
  }
) {
  const locked = await tx.$queryRaw<Array<{ id: number }>>`
    SELECT "id"
    FROM "Product"
    WHERE "id" = ${input.productId}
    FOR UPDATE
  `;
  if (locked.length !== 1) throw new Error("Producto no existe");

  const product = await tx.product.findUnique({
    where: { id: input.productId },
    select: { unitType: true, minQty: true, qtyStep: true },
  });
  if (!product) throw new Error("Producto no existe");

  const inventoryConfig = await tx.branchInventoryConfig.findFirst({
    where: { branchProduct: { productId: input.productId } },
    select: { id: true },
  });

  assertProductInventoryCompatibility({
    hasInventoryConfig: inventoryConfig !== null,
    unitType: input.unitType ?? product.unitType,
    minQty: input.minQty ?? product.minQty,
    qtyStep: input.qtyStep ?? product.qtyStep,
  });
}
