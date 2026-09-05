import type { AdminInventoryRow, InventoryMovementType } from "../api/inventory";

export type InventoryFilter = "ALL" | "CONTROLLED" | "UNCONTROLLED" | "LOW" | "OUT";

export function isLatestInventoryRequest(requestId: number, currentRequestId: number) {
  return requestId === currentRequestId;
}

export function filterInventoryRows(rows: AdminInventoryRow[], query: string, filter: InventoryFilter) {
  const normalized = query.trim().toLocaleLowerCase("es");
  return rows.filter((row) => {
    const matchesQuery = !normalized
      || row.product.name.toLocaleLowerCase("es").includes(normalized)
      || String(row.product.id).includes(normalized);
    if (!matchesQuery) return false;
    if (filter === "CONTROLLED") return row.inventory !== null;
    if (filter === "UNCONTROLLED") return row.inventory === null;
    if (filter === "LOW") return row.inventory?.enabled === true && row.inventory.status === "LOW";
    if (filter === "OUT") return row.inventory?.enabled === true && row.inventory.status === "OUT";
    return true;
  });
}

export function signedQuantity(quantity: number) {
  return quantity > 0 ? `+${quantity}` : String(quantity);
}

const INVENTORY_MOVEMENT_LABELS = {
  INITIAL_STOCK: "Stock inicial",
  RESTOCK: "Reposición",
  MANUAL_REMOVE: "Retiro manual",
  ADJUSTMENT: "Ajuste de inventario",
  ORDER_CREATED: "Salida por pedido",
  ORDER_EDITED: "Ajuste por edición de pedido",
  ORDER_CANCELLED: "Devolución por cancelación",
} satisfies Record<InventoryMovementType, string>;

export function inventoryMovementLabel(type: InventoryMovementType) {
  return INVENTORY_MOVEMENT_LABELS[type];
}
