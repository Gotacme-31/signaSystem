import { prisma } from "./prisma";

type AuthUser = {
  userId: number;
  role: string;
  branchId?: number | null;
};

export function isMultiCounterRole(role: string) {
  return role === "MULTI_COUNTER";
}

export async function getAccessibleBranchIdsForUser(authUser: AuthUser): Promise<number[]> {
  if (authUser.role === "ADMIN") return [];

  const branchIds = new Set<number>();
  if (authUser.branchId) branchIds.add(authUser.branchId);

  if (!isMultiCounterRole(authUser.role)) {
    return Array.from(branchIds);
  }

  const extraAccesses = await prisma.userBranchAccess.findMany({
    where: { userId: authUser.userId },
    select: { branchId: true },
  });

  for (const access of extraAccesses) {
    branchIds.add(access.branchId);
  }

  return Array.from(branchIds);
}

export function branchScopeWhere(branchIds: number[], scope: string) {
  if (scope === "production") {
    return { branchId: { in: branchIds } };
  }

  if (scope === "pickup") {
    return { pickupBranchId: { in: branchIds } };
  }

  return {
    OR: [{ branchId: { in: branchIds } }, { pickupBranchId: { in: branchIds } }],
  };
}

export function canAccessOrderByBranches(
  role: string,
  accessibleBranchIds: number[],
  orderBranchId: number,
  pickupBranchId?: number | null
) {
  if (role === "ADMIN") return true;
  if (accessibleBranchIds.includes(orderBranchId)) return true;
  return pickupBranchId ? accessibleBranchIds.includes(pickupBranchId) : false;
}
