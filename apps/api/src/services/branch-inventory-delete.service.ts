type BranchInventoryLookup = {
  branchInventoryConfig: {
    count: any;
  };
  supplyItem: {
    count: any;
  };
};

export class BranchHasInventoryHistoryError extends Error {
  readonly code = "BRANCH_HAS_INVENTORY_HISTORY";
  readonly status = 409;

  constructor() {
    super("La sucursal tiene inventario de productos o suministros y no puede eliminarse.");
    this.name = "BranchHasInventoryHistoryError";
  }
}

export async function branchHasInventoryHistory(db: BranchInventoryLookup, branchId: number) {
  const [productInventoryCount, supplyCount] = await Promise.all([
    db.branchInventoryConfig.count({
      where: { branchProduct: { branchId } },
    }),
    db.supplyItem.count({ where: { branchId } }),
  ]);
  return productInventoryCount > 0 || supplyCount > 0;
}

export async function assertBranchHasNoInventoryHistory(db: BranchInventoryLookup, branchId: number) {
  if (await branchHasInventoryHistory(db, branchId)) {
    throw new BranchHasInventoryHistoryError();
  }
}

export function isPrismaForeignKeyError(error: unknown) {
  return !!error && typeof error === "object" && "code" in error && error.code === "P2003";
}
