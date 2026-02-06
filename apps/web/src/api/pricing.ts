import { apiFetch } from "./http";

// Tipos que coinciden con AdminPricing.tsx
export interface Branch {
  id: number;
  name: string;
  address?: string;
  phone?: string;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface BranchProductRow {
  productId: number;
  product: {
    id: number;
    name: string;
    description?: string;
    basePrice: number;
    unitType: string;
    needsVariant: boolean;
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
  };
  price: number;
  isActive: boolean;
  quantityPrices?: Array<{
    id?: number | null;
    minQty: number;
    unitPrice: number;
    isActive: boolean;
  }>;
  variantPrices?: Array<{
    id?: number | null;
    variantId: number;
    variantName?: string;
    price: number;
    isActive: boolean;
    variantIsActive?: boolean;
  }>;
  paramPrices?: Array<{
    id?: number | null;
    paramId: number;
    paramName?: string;
    priceDelta: number;
    isActive: boolean;
    paramIsActive?: boolean;
  }>;
  variantQuantityMatrix?: Record<number, QuantityPriceRow[]>;
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
}

// Tipos para peticiones
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

// Obtener todas las sucursales
export const getBranches = async (): Promise<Branch[]> => {
  return apiFetch('/pricing/branches');
};

// Obtener productos de una sucursal específica
export const getBranchProducts = async (branchId: number): Promise<BranchProductRow[]> => {
  return apiFetch(`/pricing/branch/${branchId}/products`);
};

// Actualizar precio base de un producto en sucursal
export const setBranchProductPrice = async (
  branchId: number,
  productId: number,
  price: string,
  isActive: boolean
): Promise<{ success: boolean }> => {
  return apiFetch(`/pricing/branch/${branchId}/products/${productId}`, {
    method: 'PUT',
    body: JSON.stringify({
      price: Number(price),
      isActive
    }),
  });
};

// Establecer precios por cantidad
export const setBranchProductQuantityPrices = async (
  branchId: number,
  productId: number,
  quantityPrices: QuantityPriceData[]
): Promise<{ success: boolean }> => {
  return apiFetch(`/pricing/branch/${branchId}/products/${productId}/quantity-prices`, {
    method: 'PUT',
    body: JSON.stringify({
      prices: quantityPrices.map(qp => ({
        minQty: Number(qp.minQty),
        unitPrice: Number(qp.unitPrice),
        isActive: qp.isActive
      }))
    }),
  });
};

// Establecer precios por variante
export const setBranchProductVariantPrices = async (
  branchId: number,
  productId: number,
  variantPrices: VariantPriceData[]
): Promise<{ success: boolean }> => {
  return apiFetch(`/pricing/branch/${branchId}/products/${productId}/variants`, {
    method: 'PUT',
    body: JSON.stringify({
      variantPrices: variantPrices.map(vp => ({
        variantId: vp.variantId,
        price: Number(vp.price),
        isActive: vp.isActive
      }))
    }),
  });
};

// Establecer precios por parámetro (NOTA: Verifica que esta ruta exista en tu backend)
export const setBranchProductParamPrices = async (
  branchId: number,
  productId: number,
  paramPrices: ParamPriceData[]
): Promise<{ success: boolean }> => {
  return apiFetch(`/pricing/branch/${branchId}/products/${productId}/param-prices`, {
    method: 'PUT',
    body: JSON.stringify({
      paramPrices: paramPrices.map(pp => ({
        paramId: pp.paramId,
        priceDelta: Number(pp.priceDelta),
        isActive: pp.isActive
      }))
    }),
  });
};

// Obtener matriz de precios por variante y cantidad
export const getBranchProductVariantQuantityMatrix = async (
  branchId: number,
  productId: number
): Promise<Record<number, QuantityPriceRow[]>> => {
  return apiFetch(`/pricing/branch/${branchId}/product/${productId}/variant-quantity-prices`);
};

// Establecer matriz de precios por variante y cantidad
export const setBranchProductVariantQuantityMatrix = async (
  branchId: number,
  productId: number,
  matrix: Record<number, QuantityPriceRow[]>
): Promise<{ success: boolean }> => {
  // Convertir los datos para el backend
  const formattedMatrix: Record<number, Array<{
    minQty: number;
    unitPrice: number;
    isActive: boolean;
  }>> = {};

  Object.entries(matrix).forEach(([variantIdStr, rows]) => {
    const variantId = Number(variantIdStr);
    formattedMatrix[variantId] = rows.map(row => ({
      minQty: Number(row.minQty),
      unitPrice: Number(row.unitPrice),
      isActive: row.isActive
    }));
  });

  return apiFetch(`/pricing/branch/${branchId}/product/${productId}/variant-quantity-prices`, {
    method: 'POST',
    body: JSON.stringify({ matrix: formattedMatrix }),
  });
};