import type { SupplyItem, SupplyMutationResult, SupplyStatus } from "../api/suppliesInventory";

export type SupplyFilter = "ACTIVE" | "INACTIVE" | "LOW" | "OUT";

const MAX_STOCK = 2_147_483_647;

export function parsePositiveId(value: string | null) {
  if (!value || !/^\d+$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 && id <= MAX_STOCK ? id : null;
}

export function selectSupplyBranchId(
  requestedId: number | null,
  branches: Array<{ id: number; isActive: boolean }>
) {
  if (requestedId && branches.some((branch) => branch.id === requestedId)) return requestedId;
  return branches.find((branch) => branch.isActive)?.id ?? branches[0]?.id ?? null;
}

export function isLatestSupplyRequest(requestId: number, currentRequestId: number) {
  return requestId === currentRequestId;
}

export function filterSupplyItems(items: SupplyItem[], query: string, filter: SupplyFilter) {
  const normalized = query.normalize("NFKC").trim().toLocaleLowerCase("es-MX");
  return items.filter((item) => {
    if (normalized && !item.name.normalize("NFKC").toLocaleLowerCase("es-MX").includes(normalized)) return false;
    if (filter === "INACTIVE") return !item.isActive;
    if (!item.isActive) return false;
    if (filter === "LOW") return item.status === "LOW";
    if (filter === "OUT") return item.status === "OUT";
    return true;
  });
}

export function parseStockInput(value: string, label: string, positive: boolean) {
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) {
    throw new Error(`${label} debe ser un entero ${positive ? "mayor a 0" : "mayor o igual a 0"}`);
  }
  const quantity = Number(normalized);
  if (
    !Number.isSafeInteger(quantity)
    || quantity > MAX_STOCK
    || (positive ? quantity <= 0 : quantity < 0)
  ) {
    throw new Error(`${label} debe ser un entero ${positive ? "mayor a 0" : "mayor o igual a 0"}`);
  }
  return quantity;
}

export function parseOptionalThreshold(value: string) {
  return value.trim() ? parseStockInput(value, "Stock mínimo", false) : null;
}

export function signedSupplyQuantity(quantity: number) {
  return quantity > 0 ? `+${quantity}` : String(quantity);
}

export function supplyStatusLabel(status: SupplyStatus) {
  if (status === "INACTIVE") return "Inactivo";
  if (status === "OUT") return "Sin stock";
  if (status === "LOW") return "Stock bajo";
  return "Disponible";
}

export function supplyMutationNotice(result: SupplyMutationResult) {
  return result.noChange
    ? "El conteo coincide con el stock del sistema; no se registraron cambios."
    : "Inventario de suministros actualizado correctamente.";
}

export function titleCaseUnit(unitLabel: string) {
  return unitLabel ? `${unitLabel.charAt(0).toLocaleUpperCase("es-MX")}${unitLabel.slice(1)}` : "";
}
