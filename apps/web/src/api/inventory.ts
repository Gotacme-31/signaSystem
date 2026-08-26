import { apiFetch } from "./http";

export type InventoryStatus = "AVAILABLE" | "LOW" | "OUT";
export type InventoryTrackingMode = "PRODUCT" | "VARIANT";

export type AdminInventoryBalance = {
  balanceId: number;
  variantId: number | null;
  variant: { id: number; name: string; isActive: boolean; order: number } | null;
  currentStock: number;
  lowStockThreshold: number | null;
  version: number;
  status: InventoryStatus;
  updatedAt: string;
  lastMovement: { createdAt: string; movementType: InventoryMovementType } | null;
};

export type AdminInventoryRow = {
  branchProductId: number;
  branchProductIsActive: boolean;
  product: {
    id: number;
    name: string;
    isActive: boolean;
    unitType: "PIECE";
    minQty: string;
    qtyStep: string;
    variants: Array<{ id: number; name: string; isActive: boolean; order: number }>;
  };
  inventory: {
    configId: number;
    enabled: boolean;
    trackingMode: InventoryTrackingMode;
    currentStock: number;
    lowStockThreshold: number | null;
    status: InventoryStatus;
    lowVariantCount: number;
    outVariantCount: number;
    balances: AdminInventoryBalance[];
    uninitializedVariants: Array<{ id: number; name: string; isActive: boolean; order: number }>;
    activatedAt: string | null;
    deactivatedAt: string | null;
    updatedAt: string;
    lastMovement: {
      createdAt: string;
      movementType: InventoryMovementType;
    } | null;
  } | null;
};

export type InventoryMovementType =
  | "INITIAL_STOCK"
  | "RESTOCK"
  | "MANUAL_REMOVE"
  | "ADJUSTMENT"
  | "ORDER_CREATED"
  | "ORDER_EDITED"
  | "ORDER_CANCELLED";

export type InventoryMovement = {
  id: number;
  deltaQty: number;
  stockBefore: number;
  stockAfter: number;
  movementType: InventoryMovementType;
  orderId: number | null;
  orderItemId: number | null;
  reason: string | null;
  operationKey: string;
  createdAt: string;
  createdBy: { id: number; name: string; username: string } | null;
  order: { id: number } | null;
};

export function getAdminInventory(branchId: number) {
  return apiFetch<{ inventory: AdminInventoryRow[] }>(`/admin/inventory?branchId=${branchId}`);
}

export function activateInventory(body: {
  branchProductId: number;
  trackingMode: InventoryTrackingMode;
  initialStock?: number;
  lowStockThreshold?: number | null;
  variants?: Array<{ variantId: number; stock: number; lowStockThreshold: number | null }>;
  operationKey: string;
}) {
  return apiFetch("/admin/inventory/activate", { method: "POST", body: JSON.stringify(body) });
}

export function deactivateInventory(configId: number) {
  return apiFetch(`/admin/inventory/configs/${configId}/deactivate`, { method: "POST" });
}

export function reactivateInventory(configId: number, body: {
  trackingMode: InventoryTrackingMode;
  physicalStock?: number;
  lowStockThreshold?: number | null;
  variants?: Array<{ variantId: number; stock: number; lowStockThreshold: number | null }>;
  operationKey: string;
}) {
  return apiFetch(`/admin/inventory/configs/${configId}/reactivate`, { method: "POST", body: JSON.stringify(body) });
}

export function initializeInventoryVariant(configId: number, variantId: number, body: {
  initialStock: number;
  lowStockThreshold: number | null;
  operationKey: string;
}) {
  return apiFetch(`/admin/inventory/configs/${configId}/variants/${variantId}/initialize`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function restockInventory(balanceId: number, body: {
  quantity: number;
  reason?: string | null;
  operationKey: string;
}) {
  return apiFetch(`/admin/inventory/balances/${balanceId}/restock`, { method: "POST", body: JSON.stringify(body) });
}

export function removeInventory(balanceId: number, body: {
  quantity: number;
  reason: string;
  operationKey: string;
}) {
  return apiFetch(`/admin/inventory/balances/${balanceId}/remove`, { method: "POST", body: JSON.stringify(body) });
}

export function adjustInventory(balanceId: number, body: {
  targetStock: number;
  reason: string;
  operationKey: string;
}) {
  return apiFetch(`/admin/inventory/balances/${balanceId}/adjust`, { method: "POST", body: JSON.stringify(body) });
}

export function getInventoryMovements(balanceId: number) {
  return apiFetch<{ movements: InventoryMovement[] }>(`/admin/inventory/balances/${balanceId}/movements`);
}
