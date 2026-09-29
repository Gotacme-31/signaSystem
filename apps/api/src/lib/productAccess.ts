import { prisma } from "./prisma";

type UserProductAccessClient = {
  userProductAccess: {
    findMany: (args: {
      where: { userId: number };
      select: { productId: true };
    }) => Promise<Array<{ productId: number }>>;
  };
};

export async function getAllowedProductIdsForUser(
  userId: number,
  client: UserProductAccessClient = prisma
): Promise<number[] | null> {
  const accesses = await client.userProductAccess.findMany({
    where: { userId },
    select: { productId: true },
  });

  if (accesses.length === 0) return null;

  return accesses.map((access) => access.productId);
}
