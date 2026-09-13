import assert from "node:assert/strict";
import test from "node:test";
import {
  formatTrackingDate,
  getTrackingTimeline,
  PublicTrackingRequestCoordinator,
  type PublicTrackingRequest,
} from "./trackOrder";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

test("pickup timeline has delivered and delivery timeline never has delivered", () => {
  assert.deepEqual(
    getTrackingTimeline("PICKUP").map((step) => step.status),
    ["REGISTERED", "IN_PRODUCTION", "READY_FOR_PICKUP", "DELIVERED"]
  );
  assert.deepEqual(
    getTrackingTimeline("DELIVERY").map((step) => step.status),
    ["REGISTERED", "IN_PRODUCTION", "READY_FOR_SHIPPING", "SHIPPED"]
  );
  assert.equal(getTrackingTimeline("DELIVERY").some((step) => step.label === "Pedido entregado"), false);
});

test("tracking date uses a human Spanish Mexico City format and handles null", () => {
  assert.equal(formatTrackingDate(null), null);
  const formatted = formatTrackingDate("2026-09-09T20:40:00.000Z");
  assert.ok(formatted);
  assert.match(formatted, /septiembre/);
  assert.match(formatted, /·/);
});

test("a response for the previous route token cannot replace the current order", async () => {
  const coordinator = new PublicTrackingRequestCoordinator();
  const responseA = deferred<number>();
  const responseB = deferred<number>();
  let visibleOrder: number | null = null;

  coordinator.selectToken("token-a");
  const requestA = coordinator.begin("token-a");
  assert.ok(requestA);

  coordinator.selectToken("token-b");
  const requestB = coordinator.begin("token-b");
  assert.ok(requestB);

  const apply = async (request: PublicTrackingRequest, response: Promise<number>) => {
    const orderNumber = await response;
    if (coordinator.isCurrent(request)) visibleOrder = orderNumber;
    coordinator.finish(request);
  };
  const loadA = apply(requestA, responseA.promise);
  const loadB = apply(requestB, responseB.promise);

  responseB.resolve(101);
  await loadB;
  responseA.resolve(100);
  await loadA;

  assert.equal(visibleOrder, 101);
  const pollingRequest = coordinator.begin("token-b");
  assert.ok(pollingRequest);
  assert.equal(pollingRequest.token, "token-b");
});

test("polling does not overlap for the current token", () => {
  const coordinator = new PublicTrackingRequestCoordinator();
  coordinator.selectToken("token-b");
  const first = coordinator.begin("token-b");
  assert.ok(first);
  assert.equal(coordinator.begin("token-b"), null);
  assert.equal(coordinator.finish(first), true);
  assert.ok(coordinator.begin("token-b"));
});
