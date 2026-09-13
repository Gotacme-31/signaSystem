import assert from "node:assert/strict";
import test from "node:test";
import { canCopyTracking, canRegenerateTracking } from "./trackingPermissions";

test("tracking copy roles match the backend contract", () => {
  for (const role of ["ADMIN", "STAFF", "COUNTER", "MULTI_COUNTER"]) {
    assert.equal(canCopyTracking(role), true);
  }
  for (const role of ["PRODUCTION", "PAYMENTS", "UNKNOWN", undefined]) {
    assert.equal(canCopyTracking(role), false);
  }
});

test("tracking regeneration is ADMIN-only", () => {
  assert.equal(canRegenerateTracking("ADMIN"), true);
  for (const role of ["STAFF", "COUNTER", "MULTI_COUNTER", "PRODUCTION", "PAYMENTS", undefined]) {
    assert.equal(canRegenerateTracking(role), false);
  }
});
