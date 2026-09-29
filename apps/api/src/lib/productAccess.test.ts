import assert from "node:assert/strict";
import test from "node:test";
import { getAllowedProductIdsForUser } from "./productAccess";

test("no UserProductAccess rows means unrestricted (null), not an empty allow-list", async () => {
  const client = {
    userProductAccess: {
      findMany: async () => [],
    },
  };

  const result = await getAllowedProductIdsForUser(1, client);
  assert.equal(result, null);
});

test("rows present return the exact set of allowed productIds for that user", async () => {
  let queriedWhere: unknown;
  const client = {
    userProductAccess: {
      findMany: async (args: { where: { userId: number } }) => {
        queriedWhere = args.where;
        return [{ productId: 10 }, { productId: 20 }];
      },
    },
  };

  const result = await getAllowedProductIdsForUser(7, client);
  assert.deepEqual(result, [10, 20]);
  assert.deepEqual(queriedWhere, { userId: 7 });
});
