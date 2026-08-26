import { apiFetch } from "./http";

export interface Branch {
  id: number;
  name: string;
  address?: string;
  phone?: string;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface QuantityPriceRow {
  id?: number | null;
  minQty: string;
  unitPrice: string;
  isActive: boolean;
}

export interface VariantPriceRow {
  id?: number | null;
  variantId: number;
  variantName?: string;
  price: string;
  isActive: boolean;
  variantIsActive?: boolean;
}

export interface ParamPriceRow {
  id?: number | null;
  paramId: number;
  paramName?: string;
  priceDelta: string;
  isActive: boolean;
  paramIsActive?: boolean;
  chargeType?: "PER_METER" | "PER_PIECE";
}

export interface BranchProductRow {
  productId: number;
  product: {
    id: number;
    name: string;
    description?: string;
    basePrice?: number;
    unitType: string;
    needsVariant: boolean;
    isCustomProductTemplate: boolean;
    pricingGroup?: {
      id: number;
      name: string;
      unitType: "METER" | "PIECE";
      isActive: boolean;
    } | null;
    minQty?: string;
    qtyStep?: string;
    variants?: Array<{
      id: number;
      name: string;
      isActive?: boolean;
    }>;
    params?: Array<{
      id: number;
      name: string;
      isActive?: boolean;
    }>;
    paramPrices?: Array<{
      id?: number | null;
      paramId: number;
      paramName?: string;
      priceDelta: string | number;
      isActive: boolean;
      paramIsActive?: boolean;
      chargeType?: "PER_METER" | "PER_PIECE";
    }>;
  };

  price: string | number;
  isActive: boolean;
  inventory?: {
    enabled: true;
    trackingMode: "PRODUCT" | "VARIANT";
    currentStock: number;
    lowStockThreshold: number | null;
    status: "AVAILABLE" | "LOW" | "OUT";
    version: number;
    inventoryByVariant: Array<{
      variantId: number;
      currentStock: number;
      lowStockThreshold: number | null;
      status: "AVAILABLE" | "LOW" | "OUT";
      version: number;
    }>;
  } | null;

  // NUEVO: solo por sucursal
  halfStepSpecialPrice?: string | null;

  quantityPrices?: Array<{
    id?: number | null;
    minQty: string | number;
    unitPrice: string | number;
    isActive: boolean;
  }>;
  variantPrices?: Array<{
    id?: number | null;
    variantId: number;
    variantName?: string;
    price: string | number;
    isActive: boolean;
    variantIsActive?: boolean;
  }>;
  paramPrices?: Array<{
    id?: number | null;
    paramId: number;
    paramName?: string;
    priceDelta: string | number;
    isActive: boolean;
    paramIsActive?: boolean;
    chargeType?: "PER_METER" | "PER_PIECE";
  }>;
  variantQuantityMatrix?: Record<number, QuantityPriceRow[]>;
}

interface QuantityPriceData {
  minQty: string;
  unitPrice: string;
  isActive: boolean;
}

interface VariantPriceData {
  variantId: number;
  price: string;
  isActive: boolean;
}

interface ParamPriceData {
  paramId: number;
  priceDelta: string;
  isActive: boolean;
}

export const getBranches = async (): Promise<Branch[]> => {
  return apiFetch("/admin/branches");
};

export const getBranchProducts = async (branchId: number): Promise<BranchProductRow[]> => {
  return apiFetch(`/admin/branches/${branchId}/products`);
};

export const getOrderBranches = async (): Promise<Branch[]> => {
  return apiFetch("/pricing/branches");
};

export const getOrderBranchProducts = async (branchId: number): Promise<BranchProductRow[]> => {
  return apiFetch(`/pricing/branch/${branchId}/products`);
};

export const setBranchProductPrice = async (
  branchId: number,
  productId: number,
  price: string,
  isActive: boolean,
  halfStepSpecialPrice?: string | null
): Promise<{ ok: boolean; row?: any }> => {
  return apiFetch(`/admin/branches/${branchId}/products/${productId}/price`, {
    method: "PATCH",
    body: JSON.stringify({
      price: Number(price),
      isActive,
      halfStepSpecialPrice:
        halfStepSpecialPrice === undefined
          ? undefined
          : halfStepSpecialPrice === null || halfStepSpecialPrice === ""
            ? null
            : Number(halfStepSpecialPrice),
    }),
  });
};

export const setBranchProductQuantityPrices = async (
  branchId: number,
  productId: number,
  quantityPrices: QuantityPriceData[]
): Promise<{ ok: boolean }> => {
  return apiFetch(`/admin/branches/${branchId}/products/${productId}/quantity-prices`, {
    method: "PUT",
    body: JSON.stringify({
      rows: quantityPrices.map((qp) => ({
        minQty: Number(qp.minQty),
        unitPrice: Number(qp.unitPrice),
        isActive: qp.isActive,
      })),
    }),
  });
};

export const setBranchProductVariantPrices = async (
  branchId: number,
  productId: number,
  variantPrices: VariantPriceData[]
): Promise<{ ok: boolean }> => {
  return apiFetch(`/admin/branches/${branchId}/products/${productId}/variant-prices`, {
    method: "PUT",
    body: JSON.stringify({
      rows: variantPrices.map((vp) => ({
        variantId: vp.variantId,
        price: Number(vp.price),
        isActive: vp.isActive,
      })),
    }),
  });
};

export const setBranchProductParamPrices = async (
  branchId: number,
  productId: number,
  paramPrices: ParamPriceData[]
): Promise<{ ok: boolean }> => {
  return apiFetch(`/admin/branches/${branchId}/products/${productId}/param-prices`, {
    method: "PUT",
    body: JSON.stringify({
      rows: paramPrices.map((pp) => ({
        paramId: pp.paramId,
        priceDelta: Number(pp.priceDelta),
        isActive: pp.isActive,
      })),
    }),
  });
};

export const getBranchProductVariantQuantityMatrix = async (
  branchId: number,
  productId: number
): Promise<{ matrix: Record<number, QuantityPriceRow[]> }> => {
  return apiFetch(`/admin/branches/${branchId}/products/${productId}/variant-quantity-prices`);
};

export const setBranchProductVariantQuantityMatrix = async (
  branchId: number,
  productId: number,
  matrix: Record<number, QuantityPriceRow[]>
): Promise<{ ok: boolean }> => {
  const formattedMatrix: Record<number, Array<{
    minQty: number;
    unitPrice: number;
    isActive: boolean;
  }>> = {};

  Object.entries(matrix).forEach(([variantIdStr, rows]) => {
    const variantId = Number(variantIdStr);
    formattedMatrix[variantId] = rows.map((row) => ({
      minQty: Number(row.minQty),
      unitPrice: Number(row.unitPrice),
      isActive: row.isActive,
    }));
  });

  return apiFetch(`/admin/branches/${branchId}/products/${productId}/variant-quantity-prices`, {
    method: "PUT",
    body: JSON.stringify({ matrix: formattedMatrix }),
  });
};
