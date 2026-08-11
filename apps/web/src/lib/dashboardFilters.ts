export type DashboardQueryFilters = {
  startDate?: string;
  endDate?: string;
  branchIds?: number[];
  productIds?: number[];
  unitType?: "METER" | "PIECE";
  includeIva?: boolean;
};

export type DashboardSelection = number[] | null;

export type DashboardDraftFilters = Omit<DashboardQueryFilters, "branchIds" | "productIds"> & {
  branchIds: DashboardSelection;
  productIds: DashboardSelection;
};

export type DashboardFilterState = {
  draft: DashboardDraftFilters;
  applied: DashboardDraftFilters;
};

export type DashboardFilterAction =
  | { type: "EDIT"; patch: Partial<DashboardDraftFilters> }
  | { type: "APPLY"; filters: DashboardDraftFilters }
  | { type: "RECONCILE_PRODUCTS"; validProductIds: number[] };

function copyDraftFilters(filters: DashboardDraftFilters): DashboardDraftFilters {
  return {
    ...filters,
    branchIds: filters.branchIds === null ? null : [...filters.branchIds],
    productIds: filters.productIds === null ? null : [...filters.productIds],
  };
}

export function dashboardFilterReducer(
  state: DashboardFilterState,
  action: DashboardFilterAction
): DashboardFilterState {
  if (action.type === "EDIT") {
    return { ...state, draft: { ...state.draft, ...action.patch } };
  }
  if (action.type === "RECONCILE_PRODUCTS") {
    return {
      ...state,
      draft: {
        ...state.draft,
        productIds: reconcileDashboardSelection(
          state.draft.productIds,
          action.validProductIds
        ),
      },
    };
  }
  return { ...state, applied: copyDraftFilters(action.filters) };
}

function selectionToQuery(selection: DashboardSelection, label: string) {
  if (selection === null) return undefined;
  if (selection.length === 0) {
    throw new Error(`Selecciona al menos ${label} o usa "Seleccionar todos".`);
  }
  return [...selection];
}

export function dashboardDraftToQueryFilters(filters: DashboardDraftFilters): DashboardQueryFilters {
  return {
    ...filters,
    branchIds: selectionToQuery(filters.branchIds, "una sucursal"),
    productIds: selectionToQuery(filters.productIds, "un producto"),
  };
}

export function dashboardProductOptionQueryFilters(
  filters: DashboardDraftFilters
): DashboardQueryFilters {
  return {
    startDate: filters.startDate,
    endDate: filters.endDate,
    branchIds: selectionToQuery(filters.branchIds, "una sucursal"),
    unitType: filters.unitType,
  };
}

export function dashboardDraftValidationMessage(filters: DashboardDraftFilters) {
  if (filters.branchIds !== null && filters.branchIds.length === 0) {
    return "Selecciona al menos una sucursal o usa \"Seleccionar todos\".";
  }
  if (filters.productIds !== null && filters.productIds.length === 0) {
    return "Selecciona al menos un producto o usa \"Seleccionar todos\".";
  }
  return null;
}

export function buildDashboardSearchParams(
  filters?: DashboardQueryFilters,
  options: { includeProductIds?: boolean; includeIva?: boolean } = {}
) {
  const params = new URLSearchParams();
  if (filters?.startDate) params.set("startDate", filters.startDate);
  if (filters?.endDate) params.set("endDate", filters.endDate);
  if (filters?.branchIds?.length) params.set("branchIds", filters.branchIds.join(","));
  if (options.includeProductIds !== false && filters?.productIds?.length) {
    params.set("productIds", filters.productIds.join(","));
  }
  if (filters?.unitType) params.set("unitType", filters.unitType);
  if (options.includeIva !== false && filters?.includeIva) params.set("includeIva", "true");
  return params;
}

export function dashboardSelectionIncludes(selected: DashboardSelection, id: number) {
  return selected === null || selected.includes(id);
}

export function dashboardSelectionIsAll(allIds: readonly number[], selected: DashboardSelection) {
  return selected === null || (allIds.length > 0 && allIds.every((id) => selected.includes(id)));
}

export function toggleDashboardSelection(
  allIds: readonly number[],
  selected: DashboardSelection,
  id: number
): DashboardSelection {
  const current = selected === null ? [...allIds] : selected.filter((value) => allIds.includes(value));
  const next = current.includes(id)
    ? current.filter((value) => value !== id)
    : [...current, id];
  if (allIds.length > 0 && allIds.every((value) => next.includes(value))) return null;
  return next;
}

export function toggleAllDashboardSelection(
  allIds: readonly number[],
  selected: DashboardSelection
): DashboardSelection {
  return dashboardSelectionIsAll(allIds, selected) ? [] : null;
}

export function dashboardSelectionSummary(allIds: readonly number[], selected: DashboardSelection) {
  return dashboardSelectionIsAll(allIds, selected)
    ? "Todos"
    : `${selected?.length ?? 0}/${allIds.length}`;
}

export function reconcileDashboardSelection(
  selected: DashboardSelection,
  validIds: readonly number[]
): DashboardSelection {
  if (selected === null) return null;
  return selected.filter((id) => validIds.includes(id));
}

export function dashboardProductOptionScopeKey(filters: DashboardDraftFilters) {
  return JSON.stringify({
    startDate: filters.startDate ?? "",
    endDate: filters.endDate ?? "",
    branchIds: filters.branchIds === null ? "ALL" : [...filters.branchIds].sort((a, b) => a - b),
    unitType: filters.unitType ?? "ALL",
  });
}

export function isLatestDashboardProductRequest(requestId: number, latestRequestId: number) {
  return requestId === latestRequestId;
}

export function dashboardProductOptionLabel(product: { id: number; name: string }) {
  return `${product.name} (#${product.id})`;
}

export function selectTopDashboardProducts<T extends {
  productId: number;
  revenue: number;
  quantity: number;
}>(items: readonly T[], metric: "revenue" | "quantity", limit = 10) {
  return [...items]
    .sort((a, b) => b[metric] - a[metric] || a.productId - b.productId)
    .slice(0, limit);
}
