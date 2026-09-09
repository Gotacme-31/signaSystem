import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const controllers = [
  "src/controllers/adminBranchProducts.controller.ts",
  "src/controllers/branchPricing.controller.ts",
].map((path) => readFileSync(resolve(process.cwd(), path), "utf8"));

test("branch parameter pricing exposes and persists production minutes", () => {
  for (const source of controllers) {
    assert.match(source, /productionTimeMinutesPerUnit/);
    assert.match(source, /normalizeProductionTimeMinutesPerUnit/);
    assert.match(source, /isActive:\s*(?:found|saved)\?\.isActive \?\? false/);
  }
});
