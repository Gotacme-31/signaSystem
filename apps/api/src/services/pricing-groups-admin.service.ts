export const PRICING_GROUP_PRODUCT_WHERE = {
  isCustomProductTemplate: false,
} as const;

type PricingGroupTransaction = {
  pricingGroup: {
    findUnique: (args: unknown) => Promise<{
      id: number;
      _count?: { appliedOrderItems: number };
    } | null>;
    update: (args: unknown) => Promise<unknown>;
    delete: (args: unknown) => Promise<unknown>;
  };
  product: {
    updateMany: (args: unknown) => Promise<{ count: number }>;
  };
};

type PricingGroupDatabase = {
  $transaction: any;
};

export class PricingGroupNotFoundError extends Error {
  readonly code = "PRICING_GROUP_NOT_FOUND";

  constructor() {
    super("Grupo no encontrado");
  }
}

export class PricingGroupHasHistoryError extends Error {
  readonly code = "PRICING_GROUP_HAS_HISTORY";

  constructor(readonly appliedOrderItems: number | null) {
    super("El grupo tiene partidas históricas y no puede eliminarse");
  }
}

function isForeignKeyConstraintError(error: unknown) {
  return !!error && typeof error === "object" && "code" in error && error.code === "P2003";
}

export async function hardDeleteUnusedPricingGroup(
  db: PricingGroupDatabase,
  groupId: number
) {
  try {
    return await db.$transaction(async (tx: PricingGroupTransaction) => {
      const group = await tx.pricingGroup.findUnique({
        where: { id: groupId },
        select: { id: true, _count: { select: { appliedOrderItems: true } } },
      });

      if (!group) throw new PricingGroupNotFoundError();

      const appliedOrderItems = group._count?.appliedOrderItems ?? 0;
      if (appliedOrderItems > 0) {
        throw new PricingGroupHasHistoryError(appliedOrderItems);
      }

      const unassigned = await tx.product.updateMany({
        where: { pricingGroupId: groupId },
        data: { pricingGroupId: null },
      });

      await tx.pricingGroup.delete({ where: { id: groupId } });

      return { id: groupId, unassignedProductCount: unassigned.count };
    });
  } catch (error: unknown) {
    // The historical FK is the final authority if a reference appears after the count.
    if (isForeignKeyConstraintError(error)) {
      throw new PricingGroupHasHistoryError(null);
    }
    throw error;
  }
}

export async function archivePricingGroup(
  db: PricingGroupDatabase,
  groupId: number
) {
  return db.$transaction(async (tx: PricingGroupTransaction) => {
    const group = await tx.pricingGroup.findUnique({
      where: { id: groupId },
      select: { id: true },
    });

    if (!group) throw new PricingGroupNotFoundError();

    await tx.pricingGroup.update({
      where: { id: groupId },
      data: { isActive: false },
    });

    const unassigned = await tx.product.updateMany({
      where: { pricingGroupId: groupId },
      data: { pricingGroupId: null },
    });

    return { id: groupId, unassignedProductCount: unassigned.count };
  });
}
