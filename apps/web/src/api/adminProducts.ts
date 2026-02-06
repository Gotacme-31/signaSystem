import { apiFetch } from "./http";

export type UnitType = "METER" | "PIECE";

export type ProductProcessStep = { id: number; name: string; order: number; isActive: boolean };
export type ProductVariant = { id: number; name: string; order: number; isActive: boolean };

// ✅ Catálogo de parámetros (sin precio)
export type ProductParamDTO = { id: number; name: string; isActive: boolean; order: number };

export type ProductOption = {
  id: number;
  name: string;
  priceDelta: string;
  order: number;
  isActive: boolean;
};

export type ProductOptionGroup = {
  id: number;
  name: string;
  required: boolean;
  minPick: number;
  maxPick: number | null;
  order: number;
  isActive: boolean;
  options: ProductOption[];
};

export type AdminProduct = {
  id: number;
  name: string;
  unitType: UnitType;
  needsVariant: boolean;
  isActive: boolean;

  minQty: string;
  qtyStep: string;
  halfStepSpecialPrice: string | null;

  processSteps: ProductProcessStep[];
  variants: ProductVariant[];
  params: ProductParamDTO[];

  optionGroups: ProductOptionGroup[];
};

export type AdminProductFull = AdminProduct;

export async function adminGetProduct(id: number): Promise<{ product: AdminProductFull }> {
  return apiFetch(`/admin/products/${id}`); // ← Ahora es /admin/products/:id
}
export async function adminUpdateProduct(
  id: number,
  body: Partial<Pick<AdminProduct, 'name' | 'unitType' | 'needsVariant' | 'isActive'>>
): Promise<{ product: AdminProduct }> {
  return apiFetch(`/admin/products/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}
export async function adminSetProcessSteps(productId: number, steps: string[]): Promise<{ ok: true }> {
  return apiFetch(`/admin/products/${productId}/process-steps`, {
    method: 'PUT',
    body: JSON.stringify({ steps }),
  });
}
export async function adminUpdateRules(
  productId: number,
  body: { minQty?: string | number; qtyStep?: string | number; halfStepSpecialPrice?: string | number | null }
): Promise<{ product: AdminProductFull }> {
  return apiFetch(`/admin/products/${productId}/rules`, {
    method: "PUT",
    body: JSON.stringify({
      minQty: body.minQty ?? 1,
      qtyStep: body.qtyStep ?? 1,
      halfStepSpecialPrice: body.halfStepSpecialPrice ?? null,
    }),
  });
}

export async function adminSetVariants(
  productId: number,
  variants: Array<{ name: string; isActive: boolean; order: number }>
) {
  return apiFetch(`/admin/products/${productId}/variants`, {
    method: "PUT",
    body: JSON.stringify({ variants }),
  });
}

// ✅ NUEVO: params catálogo (sin precio)
export async function adminSetParams(
  productId: number,
  params: Array<{ name: string; isActive: boolean; order: number }>
) {
  return apiFetch(`/admin/products/${productId}/params`, {
    method: "PUT",
    body: JSON.stringify({ params }),
  });
}
