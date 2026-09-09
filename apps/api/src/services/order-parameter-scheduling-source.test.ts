import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const controller = readFileSync(
  resolve(process.cwd(), "src/controllers/order.controller.ts"),
  "utf8"
);

test("order edits explicitly guard full scheduling behind physical changes", () => {
  const start = controller.indexOf("export async function updateOrder");
  const end = controller.indexOf("export async function cancelOrder", start);
  const source = controller.slice(start, end);
  assert.match(source, /physicalScheduleDidChange\s*=\s*didPhysicalScheduleChange/);
  assert.match(source, /if \(!physicalScheduleDidChange\)[\s\S]*refreshOrderParameterReadyTimesInTransaction/);
  assert.equal((source.match(/else if \(physicalScheduleDidChange\)/g) ?? []).length, 2);
  assert.equal((source.match(/await scheduleOrderProduction\(/g) ?? []).length, 2);
  assert.doesNotMatch(source, /releaseOrderProductionReservations/);
});
