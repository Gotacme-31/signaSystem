import assert from "node:assert/strict";
import test from "node:test";
import type { ProductionSchedulePreviewResponse } from "../api/productionScheduling";
import {
  automaticEstimateAction,
  commercialDeliveryIsEditable,
  createScheduleDataVersion,
  createSchedulePreviewItems,
  currentVersionedEstimate,
  deliveryInputsFromEstimatedReadyAt,
  evaluatePreviewResponse,
  previewNetworkErrorMessage,
  previewIsSettledForCurrentData,
  shouldWaitForCurrentAutoPreview,
} from "./newOrderDeliveryEstimate";

function plannedPreview(overrides: Partial<ProductionSchedulePreviewResponse> = {}): ProductionSchedulePreviewResponse {
  return {
    estimatedReadyAt: "2026-08-04T06:01:00.000Z",
    status: "AUTO_SCHEDULED",
    plannerStatus: "PLANNED",
    items: [{
      productId: 10,
      quantity: 10,
      plannerStatus: "PLANNED",
      estimatedReadyAt: "2026-08-04T06:01:00.000Z",
      status: "AUTO_SCHEDULED",
      source: "AUTO",
      message: null,
      matchedRule: null,
      matchedWindow: null,
      debug: null,
    }],
    ...overrides,
  };
}

test("Producto Libre is ignored when a programmable item is present", () => {
  const items = createSchedulePreviewItems([
    { productId: -1, quantity: 2, isCustomProduct: true },
    { productId: 10, quantity: 20 },
  ], () => true);
  assert.deepEqual(items, [{ productId: 10, quantity: 20 }]);
});

test("only Producto Libre keeps manual capture without preview items", () => {
  const items = createSchedulePreviewItems([
    { productId: -1, quantity: 2, isCustomProduct: true },
  ], () => true);
  assert.deepEqual(items, []);
});

test("all NOT_REQUIRED produces no applicable estimate", () => {
  const preview = plannedPreview({
    estimatedReadyAt: null,
    status: "NOT_REQUIRED",
    plannerStatus: "NOT_REQUIRED",
    items: [],
  });
  const result = evaluatePreviewResponse({
    requestId: 1,
    latestRequestId: 1,
    responseDataVersion: "v1",
    currentDataVersion: "v1",
    deliveryMode: "AUTO",
    preview,
  });
  assert.equal(result.accepted, true);
  assert.equal(result.shouldApply, false);
  assert.equal(result.estimate, null);
});

test("UNSCHEDULABLE does not invent an estimate or overwrite manual mode", () => {
  const preview = plannedPreview({
    estimatedReadyAt: "2026-08-04T06:01:00.000Z",
    status: "FAILED",
    plannerStatus: "UNSCHEDULABLE",
    items: [{
      ...plannedPreview().items[0],
      plannerStatus: "UNSCHEDULABLE",
      estimatedReadyAt: null,
      status: "FAILED",
      source: "NONE",
      message: "Producto: extra_horizon_exhausted",
    }],
  });
  const result = evaluatePreviewResponse({
    requestId: 2,
    latestRequestId: 2,
    responseDataVersion: "v2",
    currentDataVersion: "v2",
    deliveryMode: "MANUAL",
    preview,
  });
  assert.equal(result.shouldApply, false);
  assert.equal(result.estimate, null);
  assert.match(result.issue ?? "", /capacidad extra suficiente/i);
});

test("changing quantity changes preview payload and data version", () => {
  const before = [{ productId: 10, quantity: 20 }];
  const after = [{ productId: 10, quantity: 21 }];
  assert.notDeepEqual(
    createSchedulePreviewItems(before, () => true),
    createSchedulePreviewItems(after, () => true)
  );
  assert.notEqual(createScheduleDataVersion(1, before), createScheduleDataVersion(1, after));
});

test("preview launched in AUTO does not apply after switching to MANUAL", () => {
  const result = evaluatePreviewResponse({
    requestId: 3,
    latestRequestId: 3,
    responseDataVersion: "v3",
    currentDataVersion: "v3",
    deliveryMode: "MANUAL",
    preview: plannedPreview(),
  });
  assert.equal(result.accepted, true);
  assert.equal(result.shouldApply, false);
  assert.equal(result.estimate?.dataVersion, "v3");
});

test("AUTO applies a current estimate and reactivates automatic mode", () => {
  const result = evaluatePreviewResponse({
    requestId: 4,
    latestRequestId: 4,
    responseDataVersion: "v4",
    currentDataVersion: "v4",
    deliveryMode: "AUTO",
    preview: plannedPreview(),
  });
  assert.equal(result.shouldApply, true);
  assert.equal(currentVersionedEstimate(result.estimate, "v4", 4)?.estimatedReadyAt, plannedPreview().estimatedReadyAt);
});

test("Usar fecha estimada rejects an obsolete estimate", () => {
  const estimate = {
    estimatedReadyAt: "2026-08-04T06:01:00.000Z",
    dataVersion: "old",
    requestId: 4,
  };
  const action = automaticEstimateAction(estimate, "current", 5);
  assert.equal(action.estimate, null);
  assert.equal(action.shouldRequestPreview, true);
});

test("A to B to A does not revive an estimate from an older request", () => {
  const estimate = {
    estimatedReadyAt: "2026-08-04T06:01:00.000Z",
    dataVersion: "A",
    requestId: 1,
  };
  assert.equal(currentVersionedEstimate(estimate, "A", 3), null);
  assert.equal(previewIsSettledForCurrentData({ dataVersion: "A", requestId: 1 }, "A", 3), false);
});

test("AUTO waits for the preview of changed order data before submission", () => {
  assert.equal(shouldWaitForCurrentAutoPreview({
    deliveryMode: "AUTO",
    hasPreviewableItems: true,
    currentPreviewIsSettled: false,
  }), true);
  assert.equal(shouldWaitForCurrentAutoPreview({
    deliveryMode: "MANUAL",
    hasPreviewableItems: true,
    currentPreviewIsSettled: false,
  }), false);
  assert.equal(shouldWaitForCurrentAutoPreview({
    deliveryMode: "AUTO",
    hasPreviewableItems: true,
    currentPreviewIsSettled: true,
  }), false);
});

test("an older preview response cannot replace the current order version", () => {
  const oldRequest = evaluatePreviewResponse({
    requestId: 5,
    latestRequestId: 6,
    responseDataVersion: "old",
    currentDataVersion: "new",
    deliveryMode: "AUTO",
    preview: plannedPreview(),
  });
  assert.equal(oldRequest.accepted, false);
  assert.equal(oldRequest.shouldApply, false);
});

test("matching request ID still cannot apply a different data version", () => {
  const staleData = evaluatePreviewResponse({
    requestId: 6,
    latestRequestId: 6,
    responseDataVersion: "old",
    currentDataVersion: "new",
    deliveryMode: "AUTO",
    preview: plannedPreview(),
  });
  assert.equal(staleData.accepted, false);
  assert.equal(staleData.shouldApply, false);
});

test("PLANNED without estimatedReadyAt is rejected", () => {
  const result = evaluatePreviewResponse({
    requestId: 7,
    latestRequestId: 7,
    responseDataVersion: "v7",
    currentDataVersion: "v7",
    deliveryMode: "AUTO",
    preview: plannedPreview({ estimatedReadyAt: null }),
  });
  assert.equal(result.estimate, null);
  assert.equal(result.shouldApply, false);
  assert.match(result.issue ?? "", /sin devolver una fecha/i);
});

test("network errors remain visible and do not provide an estimate", () => {
  assert.equal(
    previewNetworkErrorMessage(new Error("conexión interrumpida")),
    "No se pudo calcular la entrega estimada: conexión interrumpida"
  );
});

test("commercial delivery fields stay editable for ADMIN and non ADMIN", () => {
  assert.equal(commercialDeliveryIsEditable("ADMIN"), true);
  assert.equal(commercialDeliveryIsEditable("COUNTER"), true);
});

test("Mexico City conversion changes date correctly around midnight", () => {
  assert.deepEqual(
    deliveryInputsFromEstimatedReadyAt("2026-08-04T05:59:00.000Z"),
    { date: "2026-08-03", time: "23:59" }
  );
  assert.deepEqual(
    deliveryInputsFromEstimatedReadyAt("2026-08-04T06:01:00.000Z"),
    { date: "2026-08-04", time: "00:01" }
  );
});
