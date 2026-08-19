import assert from "node:assert/strict";
import test from "node:test";
import {
  archivePricingGroup,
  hardDeleteUnusedPricingGroup,
  PRICING_GROUP_PRODUCT_WHERE,
  PricingGroupHasHistoryError,
  PricingGroupNotFoundError,
} from "./pricing-groups-admin.service";

type State = {
  groupExists: boolean;
  isActive: boolean;
  appliedOrderItems: number;
  productGroupIds: Array<number | null>;
  historyAppearsOnDelete?: boolean;
};

function database(initial: State) {
  let state = structuredClone(initial);

  const db = {
    $transaction: async <T>(operation: (tx: any) => Promise<T>) => {
      const snapshot = structuredClone(state);
      const tx = {
        pricingGroup: {
          findUnique: async (args: any) => {
            if (!state.groupExists) return null;
            if (args?.select?._count) {
              return { id: 7, _count: { appliedOrderItems: state.appliedOrderItems } };
            }
            return { id: 7 };
          },
          update: async () => {
            state.isActive = false;
            return { id: 7 };
          },
          delete: async () => {
            if (state.historyAppearsOnDelete) {
              state.appliedOrderItems += 1;
              throw { code: "P2003" };
            }
            state.groupExists = false;
            return { id: 7 };
          },
        },
        product: {
          updateMany: async () => {
            let count = 0;
            state.productGroupIds = state.productGroupIds.map((groupId) => {
              if (groupId !== 7) return groupId;
              count += 1;
              return null;
            });
            return { count };
          },
        },
      };

      try {
        return await operation(tx);
      } catch (error) {
        state = snapshot;
        throw error;
      }
    },
  };

  return { db: db as any, state: () => state };
}

test("hard delete releases products and removes an unused group", async () => {
  const fixture = database({
    groupExists: true,
    isActive: true,
    appliedOrderItems: 0,
    productGroupIds: [7, null, 7],
  });

  const result = await hardDeleteUnusedPricingGroup(fixture.db, 7);

  assert.deepEqual(result, { id: 7, unassignedProductCount: 2 });
  assert.equal(fixture.state().groupExists, false);
  assert.deepEqual(fixture.state().productGroupIds, [null, null, null]);
});

test("hard delete rejects a group that already has history", async () => {
  const fixture = database({
    groupExists: true,
    isActive: true,
    appliedOrderItems: 3,
    productGroupIds: [7],
  });

  await assert.rejects(
    hardDeleteUnusedPricingGroup(fixture.db, 7),
    (error: unknown) => {
      assert.ok(error instanceof PricingGroupHasHistoryError);
      assert.equal(error.code, "PRICING_GROUP_HAS_HISTORY");
      return true;
    }
  );
  assert.equal(fixture.state().groupExists, true);
  assert.deepEqual(fixture.state().productGroupIds, [7]);
});

test("hard delete returns a history conflict when a reference appears concurrently", async () => {
  const fixture = database({
    groupExists: true,
    isActive: true,
    appliedOrderItems: 0,
    productGroupIds: [7],
    historyAppearsOnDelete: true,
  });

  await assert.rejects(
    hardDeleteUnusedPricingGroup(fixture.db, 7),
    (error: unknown) => {
      assert.ok(error instanceof PricingGroupHasHistoryError);
      assert.equal(error.code, "PRICING_GROUP_HAS_HISTORY");
      return true;
    }
  );
  assert.equal(fixture.state().groupExists, true);
  assert.deepEqual(fixture.state().productGroupIds, [7]);
});

test("archive keeps history, deactivates the group, and releases products", async () => {
  const fixture = database({
    groupExists: true,
    isActive: true,
    appliedOrderItems: 4,
    productGroupIds: [7, 9, 7],
  });

  const result = await archivePricingGroup(fixture.db, 7);

  assert.deepEqual(result, { id: 7, unassignedProductCount: 2 });
  assert.equal(fixture.state().groupExists, true);
  assert.equal(fixture.state().isActive, false);
  assert.equal(fixture.state().appliedOrderItems, 4);
  assert.deepEqual(fixture.state().productGroupIds, [null, 9, null]);
});

test("delete and archive reject a missing group", async () => {
  const fixture = database({
    groupExists: false,
    isActive: false,
    appliedOrderItems: 0,
    productGroupIds: [],
  });

  await assert.rejects(
    hardDeleteUnusedPricingGroup(fixture.db, 7),
    (error: unknown) => error instanceof PricingGroupNotFoundError
  );
  await assert.rejects(
    archivePricingGroup(fixture.db, 7),
    (error: unknown) => error instanceof PricingGroupNotFoundError
  );
});

test("pricing-group product queries exclude custom product templates", () => {
  assert.deepEqual(PRICING_GROUP_PRODUCT_WHERE, { isCustomProductTemplate: false });
});
