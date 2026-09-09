import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  clampActiveOrdersPage,
  filterActiveOrders,
  isLatestActiveOrdersRequest,
  reconcileActiveOrdersResponse,
  removeDeliveredOrder,
} from "./activeOrders";

const orders = [
  {
    id: 31275,
    deliveryDate: "2099-01-01",
    notes: "Entregar por la tarde",
    customer: { name: "María López", phone: "55 1234-5678" },
    branch: { name: "Lerma" },
    pickupBranch: { name: "Algarín" },
    items: [{ product: { name: "Taza blanca" } }],
  },
  {
    id: 40000,
    deliveryDate: "2099-01-02",
    customer: { name: "Otro cliente", phone: "5550000000" },
    branch: { name: "Centro" },
    pickupBranch: null,
    items: [{ product: { name: "Lona" } }],
  },
];

function search(query: string) {
  return filterActiveOrders(orders, { query, deliveryFilter: "ALL", exactDay: "" });
}

test("first local search finds the expected order from page 1", () => {
  const filtered = search("31275");
  const page = clampActiveOrdersPage(1, Math.ceil(filtered.length / 10));
  assert.deepEqual(filtered.map((order) => order.id), [31275]);
  assert.equal(page, 1);
});

test("searching from a page above the filtered range clamps back to page 1", () => {
  const filtered = search("31275");
  assert.equal(clampActiveOrdersPage(4, Math.ceil(filtered.length / 10)), 1);
});

test("clearing and entering the same term produces the same result", () => {
  assert.equal(search("").length, 2);
  assert.deepEqual(search("31275"), search("31275"));
});

test("only the latest HTTP request may apply its response", async () => {
  let latestRequestId = 0;
  let visibleIds: number[] = [];
  let resolveOld!: (ids: number[]) => void;
  const oldResponse = new Promise<number[]>((resolve) => { resolveOld = resolve; });

  async function load(response: Promise<number[]>) {
    const requestId = ++latestRequestId;
    const ids = await response;
    if (isLatestActiveOrdersRequest(requestId, latestRequestId)) visibleIds = ids;
  }

  const oldLoad = load(oldResponse);
  await load(Promise.resolve([31275]));
  resolveOld([40000]);
  await oldLoad;

  assert.deepEqual(visibleIds, [31275]);
});

test("search covers customer, phone, order id, product, branch and pickup", () => {
  for (const query of ["maria lopez", "55 1234-5678", "#31275", "taza", "lerma", "algarin"]) {
    assert.deepEqual(search(query).map((order) => order.id), [31275], query);
  }
});

test("a delivered order is removed from the active collection", () => {
  assert.deepEqual(removeDeliveredOrder(orders, 31275).map((order) => order.id), [40000]);
});

test("HTTP reconciliation preserves socket changes received after the request started", () => {
  const fetched = [{ id: 1, value: "old" }, { id: 2, value: "old" }];
  const current = [{ id: 1, value: "updated" }, { id: 3, value: "created" }];
  const reconciled = reconcileActiveOrdersResponse({
    fetchedOrders: fetched,
    currentOrders: current,
    socketOrderVersions: new Map([[1, 2], [3, 3]]),
    socketVersionAtRequestStart: 1,
    removedOrderIds: new Set([2]),
    sortOrder: "asc",
  });

  assert.deepEqual(reconciled, [
    { id: 1, value: "updated" },
    { id: 3, value: "created" },
  ]);
});

test("HTTP reconciliation applies partial socket events received during initial loading", () => {
  const reconciled = reconcileActiveOrdersResponse<{ id: number; stage: string; step: number }>({
    fetchedOrders: [{ id: 1, stage: "REGISTERED", step: 1 }],
    currentOrders: [],
    socketOrderVersions: new Map([[1, 2]]),
    socketMutations: [{
      version: 2,
      orderId: 1,
      apply: (order) => ({ ...order, stage: "IN_PROGRESS", step: 2 }),
    }],
    socketVersionAtRequestStart: 1,
    removedOrderIds: new Set(),
    sortOrder: "asc",
  });

  assert.deepEqual(reconciled, [{ id: 1, stage: "IN_PROGRESS", step: 2 }]);
});

test("HTTP reconciliation never reapplies socket mutations older than the request", () => {
  const reconciled = reconcileActiveOrdersResponse<{ id: number; stage: string }>({
    fetchedOrders: [{ id: 1, stage: "READY" }],
    currentOrders: [],
    socketOrderVersions: new Map([[1, 3]]),
    socketMutations: [{
      version: 2,
      orderId: 1,
      apply: (order) => ({ ...order, stage: "IN_PROGRESS" }),
    }],
    socketVersionAtRequestStart: 3,
    removedOrderIds: new Set(),
    sortOrder: "asc",
  });

  assert.deepEqual(reconciled, [{ id: 1, stage: "READY" }]);
});

test("ActiveOrders resets filters to page 1 and guards HTTP and delivered socket updates", () => {
  const source = readFileSync(resolve(process.cwd(), "src/pages/ActiveOrders.tsx"), "utf8");
  assert.match(source, /setCurrentPage\(1\);\s*\}, \[q, deliveryFilter, exactDay\]\)/);
  assert.match(source, /clampActiveOrdersPage\(page, totalPages\)/);
  assert.match(source, /isLatestActiveOrdersRequest\(requestId, loadRequestIdRef\.current\)/);
  assert.match(source, /reconcileActiveOrdersResponse/);
  assert.match(source, /onOrderDelivered:[\s\S]*removeDeliveredOrder\(prev, orderId\)/);
});
