type BranchInventoryLookup = {
  branchInventoryConfig: {
    count: any;
  };
};

export class BranchHasInventoryHistoryError extends Error {
  readonly code = "BRANCH_HAS_INVENTORY_HISTORY";
  readonly status = 409;

  constructor() {
    super("La sucursal tiene inventario o historial de inventario y no puede eliminarse.");
    this.name = "BranchHasInventoryHistoryError";
  }
}

export async function branchHasInventoryHistory(db: BranchInventoryLookup, branchId: number) {
  return (await db.branchInventoryConfig.count({
    where: { branchProduct: { branchId } },
  })) > 0;
}

export async function assertBranchHasNoInventoryHistory(db: BranchInventoryLookup, branchId: number) {
  if (await branchHasInventoryHistory(db, branchId)) {
    throw new BranchHasInventoryHistoryError();
  }
}

export function isPrismaForeignKeyError(error: unknown) {
  return !!error && typeof error === "object" && "code" in error && error.code === "P2003";
}
