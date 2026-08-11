import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDashboardSearchParams,
  dashboardDraftToQueryFilters,
  dashboardDraftValidationMessage,
  dashboardFilterReducer,
  dashboardProductOptionLabel,
  dashboardProductOptionQueryFilters,
  dashboardProductOptionScopeKey,
  dashboardSelectionIncludes,
  dashboardSelectionIsAll,
  dashboardSelectionSummary,
  isLatestDashboardProductRequest,
  reconcileDashboardSelection,
  selectTopDashboardProducts,
  toggleAllDashboardSelection,
  toggleDashboardSelection,
  type DashboardDraftFilters,
  type DashboardFilterState,
} from "./dashboardFilters";

function draft(overrides: Partial<DashboardDraftFilters> = {}): DashboardDraftFilters {
  return {
    startDate: "2026-08-10",
    endDate: "2026-08-10",
    branchIds: null,
    productIds: null,
    includeIva: false,
    ...overrides,
  };
}

function state(filters = draft()): DashboardFilterState {
  return { draft: filters, applied: { ...filters } };
}

test("dashboard query sends one consistent intersection of applied filters", () => {
  const filters = dashboardDraftToQueryFilters(draft({
    branchIds: [2, 5],
    productIds: [10, 15],
    includeIva: true,
  }));
  assert.equal(
    buildDashboardSearchParams(filters).toString(),
    "startDate=2026-08-10&endDate=2026-08-10&branchIds=2%2C5&productIds=10%2C15&includeIva=true"
  );
});

test("product option requests use draft date and branch but never productIds", () => {
  const scope = dashboardProductOptionQueryFilters(draft({
    branchIds: [2],
    productIds: [10],
    includeIva: true,
  }));
  assert.equal(
    buildDashboardSearchParams(scope).toString(),
    "startDate=2026-08-10&endDate=2026-08-10&branchIds=2"
  );
});

test("editing date changes product scope without changing applied filters", () => {
  const initial = state();
  const edited = dashboardFilterReducer(initial, {
    type: "EDIT",
    patch: { startDate: "2026-08-11", endDate: "2026-08-11" },
  });
  assert.notEqual(dashboardProductOptionScopeKey(initial.draft), dashboardProductOptionScopeKey(edited.draft));
  assert.deepEqual(edited.applied, initial.applied);
});

test("editing branch changes product scope without changing applied statistics", () => {
  const initial = state();
  const edited = dashboardFilterReducer(initial, { type: "EDIT", patch: { branchIds: [4] } });
  assert.notEqual(dashboardProductOptionScopeKey(initial.draft), dashboardProductOptionScopeKey(edited.draft));
  assert.deepEqual(edited.applied, initial.applied);
});

test("statistics filters change only with APPLY", () => {
  const initial = state();
  const edited = dashboardFilterReducer(initial, { type: "EDIT", patch: { productIds: [68] } });
  assert.equal(edited.applied.productIds, null);
  const applied = dashboardFilterReducer(edited, { type: "APPLY", filters: edited.draft });
  assert.deepEqual(applied.applied.productIds, [68]);
});

test("APPLY records the request snapshot even if the draft changes while loading", () => {
  const initial = state();
  const requestSnapshot = draft({ branchIds: [4], productIds: [68] });
  const editedDuringRequest = dashboardFilterReducer(initial, {
    type: "EDIT",
    patch: { branchIds: [5], productIds: [20] },
  });
  const completed = dashboardFilterReducer(editedDuringRequest, {
    type: "APPLY",
    filters: requestSnapshot,
  });
  assert.deepEqual(completed.applied.branchIds, [4]);
  assert.deepEqual(completed.applied.productIds, [68]);
  assert.deepEqual(completed.draft.productIds, [20]);
});

test("refreshing product options reconciles draft only", () => {
  const initial = state(draft({ productIds: [10, 30] }));
  const refreshed = dashboardFilterReducer(initial, {
    type: "RECONCILE_PRODUCTS",
    validProductIds: [10, 20],
  });
  assert.deepEqual(refreshed.draft.productIds, [10]);
  assert.deepEqual(refreshed.applied.productIds, [10, 30]);
});

test("valid active selections survive refresh and unavailable historical selections are removed", () => {
  assert.deepEqual(reconcileDashboardSelection([10, 30], [10, 20]), [10]);
  assert.equal(reconcileDashboardSelection(null, [10, 20]), null);
});

test("all and none are distinct states with an inverse toggle", () => {
  const allIds = [1, 2, 3];
  assert.equal(dashboardSelectionSummary(allIds, null), "Todos");
  assert.ok(dashboardSelectionIsAll(allIds, null));
  assert.deepEqual(toggleAllDashboardSelection(allIds, null), []);
  assert.equal(dashboardSelectionSummary(allIds, []), "0/3");
  assert.equal(dashboardSelectionIsAll(allIds, []), false);
  assert.equal(toggleAllDashboardSelection(allIds, []), null);
});

test("deselect all then select one sends only that productId", () => {
  const allIds = [10, 20, 68];
  const none = toggleAllDashboardSelection(allIds, null);
  const selected = toggleDashboardSelection(allIds, none, 68);
  assert.deepEqual(selected, [68]);
  const request = dashboardDraftToQueryFilters(draft({ productIds: selected }));
  assert.deepEqual(request.productIds, [68]);
  assert.equal(dashboardSelectionIncludes(selected, 68), true);
  assert.equal(dashboardSelectionIncludes(selected, 10), false);
});

test("zero selected products or branches cannot be applied as Todos", () => {
  const noProducts = draft({ productIds: [] });
  const noBranches = draft({ branchIds: [] });
  assert.match(dashboardDraftValidationMessage(noProducts) ?? "", /producto/);
  assert.match(dashboardDraftValidationMessage(noBranches) ?? "", /sucursal/);
  assert.throws(() => dashboardDraftToQueryFilters(noProducts), /producto/);
  assert.throws(() => dashboardDraftToQueryFilters(noBranches), /sucursal/);
});

test("branch selection sends only the selected registration branch", () => {
  const request = dashboardDraftToQueryFilters(draft({ branchIds: [4] }));
  assert.deepEqual(request.branchIds, [4]);
});

test("an old product response cannot become the current response", () => {
  assert.equal(isLatestDashboardProductRequest(1, 3), false);
  assert.equal(isLatestDashboardProductRequest(2, 3), false);
  assert.equal(isLatestDashboardProductRequest(3, 3), true);
});

test("Producto Libre filter label remains stable", () => {
  assert.equal(
    dashboardProductOptionLabel({ id: 68, name: "Producto Libre" }),
    "Producto Libre (#68)"
  );
});

test("top products are selected and ordered by the visible metric", () => {
  const rows = [
    { productId: 1, revenue: 1000, quantity: 1 },
    { productId: 2, revenue: 10, quantity: 100 },
    { productId: 3, revenue: 500, quantity: 5 },
  ];
  assert.deepEqual(
    selectTopDashboardProducts(rows, "revenue").map((row) => row.productId),
    [1, 3, 2]
  );
  assert.deepEqual(
    selectTopDashboardProducts(rows, "quantity").map((row) => row.productId),
    [2, 3, 1]
  );
});
