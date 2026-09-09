import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const editModal = readFileSync(
  resolve(process.cwd(), "src/pages/components/EditOrderModal.tsx"),
  "utf8"
);
const newOrder = readFileSync(resolve(process.cwd(), "src/pages/NewOrder.tsx"), "utf8");

test("order forms send only parameter identity and piece multiplier", () => {
  for (const source of [editModal, newOrder]) {
    const payloadStart = source.indexOf("selectedParams: it.selectedParams.map");
    const fallbackStart = source.indexOf("selectedParams: selectedParamsChanged");
    const start = payloadStart >= 0 ? payloadStart : fallbackStart;
    assert.ok(start >= 0);
    const payload = source.slice(start, start + 500);
    assert.match(payload, /paramId:/);
    assert.match(payload, /pieceQty:/);
    assert.doesNotMatch(payload, /chargeType:/);
    assert.doesNotMatch(payload, /applied(?:Time|Extra)Minutes/);
  }
});

test("parameter-only edits omit unchanged quantity and expose add/remove controls", () => {
  assert.match(editModal, /quantityChanged\s*\?\s*\{ quantity:/);
  assert.match(editModal, /function handleParamToggle/);
  assert.match(editModal, /function removeItemParam/);
  assert.match(editModal, /param\.isActive && param\.paramIsActive/);
});

test("AdminProductEdit keeps existing ProductParam IDs in its payload", () => {
  const adminProductEdit = readFileSync(
    resolve(process.cwd(), "src/pages/AdminProductEdit.tsx"),
    "utf8"
  );
  assert.match(adminProductEdit, /id:\s*p\.id/);
  assert.match(adminProductEdit, /id:\s*null,\s*name:\s*"Nuevo parámetro"/);
});
