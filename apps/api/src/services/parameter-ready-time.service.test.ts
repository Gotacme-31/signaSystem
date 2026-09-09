import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import {
  MAX_PARAMETER_EXTRA_TIME_MINUTES,
  ParameterReadyTimeError,
  addElapsedMinutes,
  calculateParameterExtraTimeMinutes,
  normalizeProductionTimeMinutesPerUnit,
  resolveParameterTimeSnapshots,
  sumParameterExtraTimeMinutes,
} from "./parameter-ready-time.service";

function configuration(overrides: Partial<any> = {}) {
  return {
    paramId: 10,
    isActive: true,
    productionTimeMinutesPerUnit: 2,
    param: {
      id: 10,
      productId: 5,
      name: "Ojillos",
      isActive: true,
      chargeType: "PER_PIECE" as const,
    },
    ...overrides,
  };
}

test("parameter time configuration maps null and zero to zero", () => {
  assert.equal(normalizeProductionTimeMinutesPerUnit(null), 0);
  assert.equal(normalizeProductionTimeMinutesPerUnit(0), 0);
  assert.equal(normalizeProductionTimeMinutesPerUnit(3), 3);
});

test("negative parameter time is rejected", () => {
  assert.throws(
    () => normalizeProductionTimeMinutesPerUnit(-1),
    (error: unknown) => error instanceof ParameterReadyTimeError
      && error.code === "INVALID_PARAMETER_TIME"
  );
});

test("PER_PIECE multiplies minutes by selected pieceQty, never item quantity", () => {
  assert.equal(calculateParameterExtraTimeMinutes({
    chargeType: "PER_PIECE",
    productionTimeMinutesPerUnit: 2,
    itemQuantity: 999,
    pieceQty: 20,
  }), 40);
});

test("PER_METER multiplies by item quantity and rounds fractional minutes up", () => {
  assert.equal(calculateParameterExtraTimeMinutes({
    chargeType: "PER_METER",
    productionTimeMinutesPerUnit: 5,
    itemQuantity: new Prisma.Decimal("0.5"),
  }), 3);
});

test("multiple parameter times are summed instead of taking their maximum", () => {
  assert.equal(sumParameterExtraTimeMinutes([
    { appliedExtraTimeMinutes: 20 },
    { appliedExtraTimeMinutes: 30 },
  ]), 50);
});

test("elapsed minutes cross windows and midnight without seeking capacity", () => {
  assert.equal(
    addElapsedMinutes(new Date("2026-09-08T23:30:00.000Z"), 120).toISOString(),
    "2026-09-09T01:30:00.000Z"
  );
});

test("individual and summed minute overflow are rejected", () => {
  assert.throws(() => calculateParameterExtraTimeMinutes({
    chargeType: "PER_PIECE",
    productionTimeMinutesPerUnit: MAX_PARAMETER_EXTRA_TIME_MINUTES,
    itemQuantity: 1,
    pieceQty: 2,
  }), /máximo permitido/);
  assert.throws(() => sumParameterExtraTimeMinutes([
    { appliedExtraTimeMinutes: MAX_PARAMETER_EXTRA_TIME_MINUTES },
    { appliedExtraTimeMinutes: 1 },
  ]), /suma del tiempo adicional/i);
});

test("snapshot resolution rejects total overflow before persistence", () => {
  assert.throws(
    () => resolveParameterTimeSnapshots({
      productId: 5,
      itemQuantity: 1,
      selectedParams: [
        { paramId: 10, pieceQty: 1 },
        { paramId: 11, pieceQty: 1 },
      ],
      configurations: [
        configuration({ productionTimeMinutesPerUnit: MAX_PARAMETER_EXTRA_TIME_MINUTES }),
        configuration({
          paramId: 11,
          productionTimeMinutesPerUnit: 1,
          param: { id: 11, productId: 5, name: "Refuerzo", isActive: true, chargeType: "PER_PIECE" },
        }),
      ],
    }),
    (error: unknown) => error instanceof ParameterReadyTimeError
      && error.code === "PARAMETER_TIME_OVERFLOW"
  );
});

test("malformed selected parameter payloads are rejected structurally", () => {
  assert.throws(
    () => resolveParameterTimeSnapshots({
      productId: 5,
      itemQuantity: 1,
      selectedParams: { paramId: 10 },
      configurations: [configuration()],
    }),
    (error: unknown) => error instanceof ParameterReadyTimeError
      && error.code === "INVALID_SELECTED_PARAMS"
  );
  assert.throws(
    () => resolveParameterTimeSnapshots({
      productId: 5,
      itemQuantity: 1,
      selectedParams: [null],
      configurations: [configuration()],
    }),
    (error: unknown) => error instanceof ParameterReadyTimeError
      && error.code === "INVALID_ORDER_ITEM_PARAM"
  );
});

test("branch-specific current configuration creates authoritative snapshots", () => {
  const snapshots = resolveParameterTimeSnapshots({
    productId: 5,
    itemQuantity: 12,
    selectedParams: [{ paramId: 10, pieceQty: 15 }],
    configurations: [configuration()],
  });
  assert.deepEqual(snapshots, [{
    paramId: 10,
    name: "Ojillos",
    chargeType: "PER_PIECE",
    pieceQty: 15,
    appliedTimeMinutesPerUnit: 2,
    appliedExtraTimeMinutes: 30,
    retainedSnapshot: false,
  }]);
});

test("the same parameter uses each branch-specific time configuration", () => {
  const firstBranch = resolveParameterTimeSnapshots({
    productId: 5,
    itemQuantity: 2,
    selectedParams: [{ paramId: 10, pieceQty: 3 }],
    configurations: [configuration({ productionTimeMinutesPerUnit: 2 })],
  });
  const secondBranch = resolveParameterTimeSnapshots({
    productId: 5,
    itemQuantity: 2,
    selectedParams: [{ paramId: 10, pieceQty: 3 }],
    configurations: [configuration({ productionTimeMinutesPerUnit: 7 })],
  });
  assert.equal(firstBranch[0].appliedExtraTimeMinutes, 6);
  assert.equal(secondBranch[0].appliedExtraTimeMinutes, 21);
});

test("duplicate selected param IDs are rejected structurally", () => {
  assert.throws(
    () => resolveParameterTimeSnapshots({
      productId: 5,
      itemQuantity: 1,
      selectedParams: [{ paramId: 10, pieceQty: 1 }, { paramId: 10, pieceQty: 2 }],
      configurations: [configuration()],
    }),
    (error: unknown) => error instanceof ParameterReadyTimeError
      && error.code === "DUPLICATE_ORDER_ITEM_PARAM"
  );
});

test("inactive branch configuration cannot be used for a new selection", () => {
  assert.throws(
    () => resolveParameterTimeSnapshots({
      productId: 5,
      itemQuantity: 1,
      selectedParams: [{ paramId: 10, pieceQty: 1 }],
      configurations: [configuration({ isActive: false })],
    }),
    (error: unknown) => error instanceof ParameterReadyTimeError
      && error.code === "INACTIVE_ORDER_ITEM_PARAM"
  );
});

test("retained parameter keeps old minutes when admin configuration changes", () => {
  const snapshots = resolveParameterTimeSnapshots({
    productId: 5,
    itemQuantity: 20,
    selectedParams: [{ paramId: 10, pieceQty: 15 }],
    configurations: [configuration({ productionTimeMinutesPerUnit: 3 })],
    existingSnapshots: [{
      optionId: 10,
      name: "Ojillos históricos",
      quantity: new Prisma.Decimal(10),
      chargeType: "PER_PIECE",
      appliedTimeMinutesPerUnit: 2,
      appliedExtraTimeMinutes: 20,
    }],
  });
  assert.equal(snapshots[0].appliedTimeMinutesPerUnit, 2);
  assert.equal(snapshots[0].appliedExtraTimeMinutes, 30);
});

test("retained PER_METER snapshot recalculates only its multiplier", () => {
  const snapshots = resolveParameterTimeSnapshots({
    productId: 5,
    itemQuantity: "2.5",
    selectedParams: [{ paramId: 10 }],
    configurations: [configuration({
      productionTimeMinutesPerUnit: 8,
      param: { ...configuration().param, chargeType: "PER_METER" },
    })],
    existingSnapshots: [{
      optionId: 10,
      name: "Acabado",
      quantity: 1,
      chargeType: "PER_METER",
      appliedTimeMinutesPerUnit: 3,
      appliedExtraTimeMinutes: 3,
    }],
  });
  assert.equal(snapshots[0].appliedTimeMinutesPerUnit, 3);
  assert.equal(snapshots[0].appliedExtraTimeMinutes, 8);
});

test("new parameter during edit uses current branch configuration", () => {
  const snapshots = resolveParameterTimeSnapshots({
    productId: 5,
    itemQuantity: 2,
    selectedParams: [{ paramId: 10, pieceQty: 4 }, { paramId: 11 }],
    configurations: [
      configuration(),
      configuration({
        paramId: 11,
        productionTimeMinutesPerUnit: 5,
        param: { id: 11, productId: 5, name: "Laminado", isActive: true, chargeType: "PER_METER" },
      }),
    ],
    existingSnapshots: [{
      optionId: 10,
      name: "Ojillos",
      quantity: 4,
      chargeType: "PER_PIECE",
      appliedTimeMinutesPerUnit: 2,
      appliedExtraTimeMinutes: 8,
    }],
  });
  assert.equal(snapshots[1].retainedSnapshot, false);
  assert.equal(snapshots[1].appliedExtraTimeMinutes, 10);
});
