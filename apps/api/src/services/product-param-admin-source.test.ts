import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const controller = readFileSync(
  resolve(process.cwd(), "src/controllers/adminProducts.controller.ts"),
  "utf8"
);

test("ProductParam administration updates and soft-deactivates without destructive replacement", () => {
  const start = controller.indexOf("export async function adminSetProductParams");
  const end = controller.indexOf("export async function adminSetProcessSteps", start);
  const source = controller.slice(start, end);
  assert.match(source, /planStableProductParamChanges/);
  assert.match(source, /__signa_param_rename_/);
  assert.match(source, /productParam\.update\(/);
  assert.match(source, /productParam\.updateMany\(/);
  assert.match(source, /isActive:\s*false/);
  assert.doesNotMatch(source, /productParam\.delete(?:Many)?\(/);
});
