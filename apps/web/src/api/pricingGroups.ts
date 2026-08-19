import { apiFetch } from "./http";

export type PricingGroupUnit = "METER" | "PIECE";

export type PricingGroupProduct = {
  id: number;
  name: string;
  unitType: PricingGroupUnit;
  isActive: boolean;
};

export type PricingGroup = {
  id: number;
  name: string;
  unitType: PricingGroupUnit;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  products: PricingGroupProduct[];
  _count: { appliedOrderItems: number };
};

export type PricingGroupProductOption = PricingGroupProduct & {
  pricingGroupId: number | null;
  pricingGroup: { id: number; name: string } | null;
};

export function getPricingGroups(): Promise<{ groups: PricingGroup[] }> {
  return apiFetch("/admin/pricing-groups");
}

export function getPricingGroupProducts(): Promise<{ products: PricingGroupProductOption[] }> {
  return apiFetch("/admin/pricing-groups/products");
}

export function createPricingGroup(body: {
  name: string;
  unitType: PricingGroupUnit;
  isActive: boolean;
  productIds: number[];
}): Promise<{ group: PricingGroup }> {
  return apiFetch("/admin/pricing-groups", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function updatePricingGroup(
  id: number,
  body: {
    name: string;
    unitType: PricingGroupUnit;
    isActive: boolean;
    productIds: number[];
  }
): Promise<{ group: PricingGroup }> {
  return apiFetch(`/admin/pricing-groups/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function deletePricingGroup(id: number): Promise<{
  action: "deleted";
  id: number;
  unassignedProductCount: number;
}> {
  return apiFetch(`/admin/pricing-groups/${id}`, { method: "DELETE" });
}

export function archivePricingGroup(id: number): Promise<{
  action: "archived";
  id: number;
  unassignedProductCount: number;
}> {
  return apiFetch(`/admin/pricing-groups/${id}/archive`, { method: "POST" });
}
