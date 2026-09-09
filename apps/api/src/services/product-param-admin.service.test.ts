import assert from "node:assert/strict";
import test from "node:test";
import {
  ProductParamAdminError,
  planStableProductParamChanges,
} from "./product-param-admin.service";

const existing = [
  { id: 17, name: "Ojillos", isActive: true, order: 0, chargeType: "PER_PIECE" as const },
  { id: 18, name: "Refuerzo", isActive: false, order: 1, chargeType: "PER_METER" as const },
];

test("parameter rename preserves its ID and branch configuration identity", () => {
  const branchPrice = { paramId: 17, priceDelta: "5.00" };
  const historicalOption = { optionId: 17, name: "Ojillos" };
  const plan = planStableProductParamChanges(existing, [
    { id: 17, name: "Ojillos metálicos", isActive: true, order: 0, chargeType: "PER_PIECE" },
  ]);

  assert.deepEqual(plan.updates, [{
    id: 17,
    name: "Ojillos metálicos",
    isActive: true,
    order: 0,
    chargeType: "PER_PIECE",
  }]);
  assert.equal(plan.updates[0].id, 17);
  assert.equal(branchPrice.paramId, plan.updates[0].id);
  assert.equal(historicalOption.optionId, plan.updates[0].id);
  assert.deepEqual(plan.deactivateIds, [18]);
});

test("new parameter creates a new row without replacing retained history", () => {
  const plan = planStableProductParamChanges(existing, [
    { id: 17, name: "Ojillos", isActive: true, order: 0, chargeType: "PER_PIECE" },
    { id: null, name: "Dobladillo", isActive: true, order: 1, chargeType: "PER_METER" },
    { id: 18, name: "Refuerzo", isActive: false, order: 2, chargeType: "PER_METER" },
  ]);

  assert.deepEqual(plan.creates, [{
    name: "Dobladillo",
    isActive: true,
    order: 1,
    chargeType: "PER_METER",
  }]);
  assert.deepEqual(plan.deactivateIds, []);
});

test("current ID-aware payload may remove one parameter and add another", () => {
  const plan = planStableProductParamChanges(existing, [
    { id: 17, name: "Ojillos", isActive: true, order: 0, chargeType: "PER_PIECE" },
    { id: null, name: "Dobladillo", isActive: true, order: 1, chargeType: "PER_METER" },
  ]);
  assert.equal(plan.creates[0].name, "Dobladillo");
  assert.deepEqual(plan.deactivateIds, [18]);
});

test("omitted parameter is soft-deactivated", () => {
  const plan = planStableProductParamChanges(existing, [
    { id: 17, name: "Ojillos", isActive: true, order: 0, chargeType: "PER_PIECE" },
  ]);
  assert.deepEqual(plan.deactivateIds, [18]);
});

test("legacy exact name reactivates the same row and ID", () => {
  const plan = planStableProductParamChanges(existing, [
    { id: null, name: "Refuerzo", isActive: true, order: 0, chargeType: "PER_METER" },
    { id: null, name: "Ojillos", isActive: true, order: 1, chargeType: "PER_PIECE" },
  ]);
  assert.equal(plan.updates.find((param) => param.name === "Refuerzo")?.id, 18);
  assert.deepEqual(plan.creates, []);
});

test("ambiguous legacy rename is rejected instead of recreating rows", () => {
  assert.throws(
    () => planStableProductParamChanges(existing, [
      { name: "Ojillos premium", isActive: true, order: 0, chargeType: "PER_PIECE" },
    ]),
    (error: unknown) => error instanceof ProductParamAdminError
      && error.code === "AMBIGUOUS_LEGACY_PRODUCT_PARAM"
  );
});

test("mixed ID-aware and ambiguous legacy rows are rejected", () => {
  assert.throws(
    () => planStableProductParamChanges(existing, [
      { id: 17, name: "Ojillos", isActive: true, order: 0, chargeType: "PER_PIECE" },
      { name: "Refuerzo premium", isActive: true, order: 1, chargeType: "PER_METER" },
    ]),
    (error: unknown) => error instanceof ProductParamAdminError
      && error.code === "AMBIGUOUS_LEGACY_PRODUCT_PARAM"
  );
});

test("explicit new row may be created while another row is retired", () => {
  const plan = planStableProductParamChanges(existing, [
    { id: 17, name: "Ojillos", isActive: true, order: 0, chargeType: "PER_PIECE" },
    { id: null, name: "Dobladillo", isActive: true, order: 1, chargeType: "PER_METER" },
  ]);
  assert.deepEqual(plan.creates.map((param) => param.name), ["Dobladillo"]);
  assert.deepEqual(plan.deactivateIds, [18]);
});

test("two ID-aware renames can exchange names without changing IDs", () => {
  const plan = planStableProductParamChanges(existing, [
    { id: 17, name: "Refuerzo", isActive: true, order: 0, chargeType: "PER_PIECE" },
    { id: 18, name: "Ojillos", isActive: true, order: 1, chargeType: "PER_METER" },
  ]);
  assert.deepEqual(plan.updates.map((param) => [param.id, param.name]), [
    [17, "Refuerzo"],
    [18, "Ojillos"],
  ]);
});

test("rename to an omitted historical row is rejected with a reactivation instruction", () => {
  assert.throws(
    () => planStableProductParamChanges(existing, [
      { id: 17, name: "Refuerzo", isActive: true, order: 0, chargeType: "PER_PIECE" },
    ]),
    (error: unknown) => error instanceof ProductParamAdminError
      && error.code === "PRODUCT_PARAM_NAME_CONFLICT"
  );
});

test("duplicate existing parameter IDs are rejected", () => {
  assert.throws(
    () => planStableProductParamChanges(existing, [
      { id: 17, name: "Ojillos", isActive: true, order: 0, chargeType: "PER_PIECE" },
      { id: 17, name: "Ojillos dobles", isActive: true, order: 1, chargeType: "PER_PIECE" },
    ]),
    (error: unknown) => error instanceof ProductParamAdminError
      && error.code === "DUPLICATE_PRODUCT_PARAM_ID"
  );
});
