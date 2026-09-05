import { apiFetch } from "./http";

export type SupplyMovementType = "INITIAL_STOCK" | "RESTOCK" | "MANUAL_REMOVE" | "ADJUSTMENT";
export type SupplyStockStatus = "AVAILABLE" | "LOW" | "OUT";
export type SupplyStatus = SupplyStockStatus | "INACTIVE";

export type SupplyItem = {
  id: number;
  branchId: number;
  name: string;
  normalizedName: string;
  unitLabel: string;
  currentStock: number;
  lowStockThreshold: number | null;
  version: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  status: SupplyStatus;
  unitLabelEditable: boolean;
  lastMovement: {
    id: number;
    movementType: SupplyMovementType;
    deltaQty: number;
    createdAt: string;
  } | null;
};

export type SupplyMovement = {
  id: number;
  supplyItemId: number;
  deltaQty: number;
  stockBefore: number;
  stockAfter: number;
  movementType: SupplyMovementType;
  reason: string | null;
  createdAt: string;
  createdBy: { id: number; name: string; username: string } | null;
};

export type SupplyChangedResult = {
  supplyItemId: number;
  currentStock: number;
  version: number;
  noChange: false;
  repeated: boolean;
  movementId: number;
  movementType: SupplyMovementType;
  stockBefore: number;
  deltaQty: number;
  stockAfter: number;
};

export type SupplyNoChangeResult = {
  supplyItemId: number;
  currentStock: number;
  version: number;
  noChange: true;
  repeated: false;
};

export type SupplyMutationResult = SupplyChangedResult | SupplyNoChangeResult;

export function getSupplyInventory(branchId: number, includeInactive: boolean, signal?: AbortSignal) {
  const query = new URLSearchParams({
    branchId: String(branchId),
    includeInactive: String(includeInactive),
  });
  return apiFetch<{
    branch: { id: number; name: string; isActive: boolean };
    supplies: SupplyItem[];
  }>(`/admin/supplies-inventory?${query.toString()}`, { signal });
}

export function createSupply(body: {
  branchId: number;
  name: string;
  unitLabel: string;
  initialStock: number;
  lowStockThreshold: number | null;
  operationKey: string;
}) {
  return apiFetch<{ supplyItem: SupplyItem; movement: SupplyMutationResult | null; repeated: boolean }>(
    "/admin/supplies-inventory",
    { method: "POST", body: JSON.stringify(body) }
  );
}

export function updateSupply(supplyItemId: number, body: {
  name?: string;
  unitLabel?: string;
  lowStockThreshold?: number | null;
}) {
  return apiFetch<{ supplyItem: SupplyItem }>(`/admin/supplies-inventory/${supplyItemId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function deactivateSupply(supplyItemId: number) {
  return apiFetch<{ supplyItemId: number; isActive: false; currentStock: number; version: number }>(
    `/admin/supplies-inventory/${supplyItemId}/deactivate`,
    { method: "POST" }
  );
}

export function reactivateSupply(supplyItemId: number) {
  return apiFetch<{ supplyItemId: number; isActive: true; currentStock: number; version: number }>(
    `/admin/supplies-inventory/${supplyItemId}/reactivate`,
    { method: "POST" }
  );
}

export function restockSupply(supplyItemId: number, body: {
  quantity: number;
  reason?: string | null;
  operationKey: string;
}) {
  return apiFetch<SupplyMutationResult>(`/admin/supplies-inventory/${supplyItemId}/restock`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function removeSupply(supplyItemId: number, body: {
  quantity: number;
  reason: string;
  operationKey: string;
}) {
  return apiFetch<SupplyMutationResult>(`/admin/supplies-inventory/${supplyItemId}/remove`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function adjustSupply(supplyItemId: number, body: {
  targetStock: number;
  expectedVersion: number;
  reason: string;
  operationKey: string;
}) {
  return apiFetch<SupplyMutationResult>(`/admin/supplies-inventory/${supplyItemId}/adjust`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function getSupplyMovements(
  supplyItemId: number,
  cursor: string | null,
  signal?: AbortSignal
) {
  const query = new URLSearchParams({ limit: "50" });
  if (cursor) query.set("cursor", cursor);
  return apiFetch<{
    supplyItem: { id: number; name: string; unitLabel: string };
    movements: SupplyMovement[];
    nextCursor: string | null;
  }>(`/admin/supplies-inventory/${supplyItemId}/movements?${query.toString()}`, { signal });
}
