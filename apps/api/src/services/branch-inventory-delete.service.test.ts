import assert from "node:assert/strict";
import test from "node:test";
import {
  assertBranchHasNoInventoryHistory,
  BranchHasInventoryHistoryError,
  isPrismaForeignKeyError,
} from "./branch-inventory-delete.service";

function db(productInventoryCount: number, supplyCount = 0) {
  return {
    branchInventoryConfig: {
      count: async () => productInventoryCount,
    },
    supplyItem: {
      count: async () => supplyCount,
    },
  };
}

test("branch with inventory configuration is rejected before delete", async () => {
  await assert.rejects(
    assertBranchHasNoInventoryHistory(db(1), 2),
    (error: unknown) => error instanceof BranchHasInventoryHistoryError
  );
});

test("branch without inventory keeps existing delete behavior", async () => {
  await assert.doesNotReject(assertBranchHasNoInventoryHistory(db(0), 2));
});

test("branch with active or inactive supplies is rejected before delete", async () => {
  await assert.rejects(
    assertBranchHasNoInventoryHistory(db(0, 1), 2),
    (error: unknown) => error instanceof BranchHasInventoryHistoryError
  );
});

test("Prisma foreign-key conflicts are detected for HTTP mapping", () => {
  assert.equal(isPrismaForeignKeyError({ code: "P2003" }), true);
  assert.equal(isPrismaForeignKeyError({ code: "P2002" }), false);
});
