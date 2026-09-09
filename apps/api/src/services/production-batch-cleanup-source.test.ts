import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(
  resolve(process.cwd(), "src/jobs/production-batch-cleanup.job.ts"),
  "utf8"
);

test("batch cleanup remains based on physical batch readyAt", () => {
  assert.match(source, /productionBatch\.deleteMany\([\s\S]*readyAt:\s*\{\s*lte:/);
  assert.doesNotMatch(source, /(?:baseProductionReadyAt|autoEstimatedReadyAt|estimatedReadyAt)/);
});
