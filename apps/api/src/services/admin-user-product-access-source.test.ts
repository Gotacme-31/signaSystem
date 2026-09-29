import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(process.cwd(), "../..");
const controller = readFileSync(resolve(root, "apps/api/src/controllers/adminBranches.controller.ts"), "utf8");

const createStart = controller.indexOf("export async function adminCreateBranchUser");
const createEnd = controller.indexOf("export async function adminUpdateUser", createStart);
const createBranchUser = controller.slice(createStart, createEnd);

const updateStart = controller.indexOf("export async function adminUpdateUser");
const updateEnd = controller.indexOf("export async function adminDeactivateUser", updateStart);
const updateUser = controller.slice(updateStart, updateEnd);

test("mapUserWithAccesses derives allowedProductIds from productAccesses, mirroring accessibleBranchIds", () => {
  const mapStart = controller.indexOf("function mapUserWithAccesses");
  const mapEnd = controller.indexOf("\n}\n", mapStart);
  const mapFn = controller.slice(mapStart, mapEnd);

  assert.match(mapFn, /accessibleBranchIds: branchAccesses\?\.map\(\(access\) => access\.branchId\) \?\? \[\]/);
  assert.match(mapFn, /allowedProductIds: productAccesses\?\.map\(\(access\) => access\.productId\) \?\? \[\]/);
});

test("adminGetBranchUsers selects productAccesses so the branch user list can show allowedProductIds", () => {
  const listStart = controller.indexOf("export async function adminGetBranchUsers");
  const listEnd = controller.indexOf("export async function adminCreateBranchUser", listStart);
  const listFn = controller.slice(listStart, listEnd);

  assert.match(listFn, /productAccesses: \{\s*select: \{ productId: true \},?\s*\}/);
});

test("adminCreateBranchUser validates allowedProductIds against active products only for PRODUCTION", () => {
  assert.match(createBranchUser, /normalizeProductIds\(allowedProductIds\)/);
  assert.match(
    createBranchUser,
    /role === "PRODUCTION" && normalizedAllowedProductIds\.length > 0/
  );
  assert.match(createBranchUser, /prisma\.product\.findMany\(\{\s*where: \{ id: \{ in: normalizedAllowedProductIds \}, isActive: true \}/);
  assert.match(createBranchUser, /Uno o más productos permitidos no existen o están inactivos/);
});

test("adminCreateBranchUser creates UserProductAccess rows inside the same transaction, only for PRODUCTION", () => {
  assert.match(
    createBranchUser,
    /tx\.userProductAccess\.createMany\(\{\s*data: normalizedAllowedProductIds\.map\(\(id\) => \(\{ userId: createdUser\.id, productId: id \}\)\),\s*skipDuplicates: true,/
  );
  assert.match(createBranchUser, /productAccesses: \{\s*select: \{ productId: true \},?\s*\}/);
});

test("adminUpdateUser wipes UserProductAccess when the resulting role is not PRODUCTION", () => {
  assert.match(updateUser, /if \(nextRole !== "PRODUCTION"\) \{\s*await tx\.userProductAccess\.deleteMany\(\{ where: \{ userId \} \}\);/);
});

test("adminUpdateUser replaces the full UserProductAccess set only when allowedProductIds is explicitly sent", () => {
  const elseIfIndex = updateUser.indexOf('else if (allowedProductIds !== undefined)');
  assert.notEqual(elseIfIndex, -1);
  const replaceBlock = updateUser.slice(elseIfIndex, updateUser.indexOf("}", updateUser.indexOf("skipDuplicates: true", elseIfIndex)) + 1);
  assert.match(replaceBlock, /tx\.userProductAccess\.deleteMany\(\{ where: \{ userId \} \}\)/);
  assert.match(replaceBlock, /tx\.userProductAccess\.createMany/);

  // A role switch into PRODUCTION with no allowedProductIds sent must not fall into the replace branch,
  // i.e. must not inherit any previous state — it simply skips both delete and create.
  const nextRoleProductionGuard = updateUser.indexOf('if (nextRole !== "PRODUCTION")');
  assert.notEqual(nextRoleProductionGuard, -1);
});

test("adminUpdateUser validates allowedProductIds against active products before writing", () => {
  assert.match(updateUser, /normalizeProductIds\(allowedProductIds\)/);
  assert.match(updateUser, /nextRole === "PRODUCTION" && allowedProductIds !== undefined/);
  assert.match(updateUser, /Uno o más productos permitidos no existen o están inactivos/);
});
