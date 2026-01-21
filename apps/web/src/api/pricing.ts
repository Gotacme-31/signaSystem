import { apiFetch } from "./http";

export type Branch = { id: number; name: string; isActive: boolean };

export type BranchProductRow = {
  branchId: number;
  productId: number;
  isActive: boolean;
  price: string; // viene como string
  product: {
    id: number;
    name: string;
    unitType: "METER" | "PIECE";
    needsVariant: boolean;
    isActive: boolean;
  };
};

export function getBranches() {
  return apiFetch<Branch[]>("/branches");
}

export function getBranchProducts(branchId: number) {
  return apiFetch<BranchProductRow[]>(`/branches/${branchId}/products`);
}

export function setBranchProductPrice(branchId: number, productId: number, price: string, isActive: boolean) {
  return apiFetch(`/admin/branches/${branchId}/products/${productId}/price`, {
    method: "PUT",
    body: JSON.stringify({ price, isActive }),
  });
}
