// src/api/orders.ts

import { apiFetch } from "./http";

// ========== TIPOS PARA CREAR ÓRDENES (lo que ya tienes) ==========
export type OrderItemRequest = {
  productId: number;
  quantity: string;
  variantId?: number | null;
  paramIds?: number[];
};

export type OrderRequest = {
  customerId: number;
  branchId: number;
  pickupBranchId: number;
  shippingType: "PICKUP" | "DELIVERY";
  paymentMethod: "CASH" | "TRANSFER" | "CARD";
  deliveryDate: string;
  deliveryTime?: string | null;
  notes?: string | null;
  items: OrderItemRequest[];
};

export type OrderResponse = {
  orderId: number;
  total: number | string;
  branchId?: number;
  pickupBranchId?: number;
  message?: string;
};

export async function createOrder(order: OrderRequest): Promise<OrderResponse> {
  return apiFetch("/orders", {
    method: "POST",
    body: JSON.stringify(order),
  });
}

// ========== TIPOS PARA EDITAR ÓRDENES (nuevos) ==========

// Tipos base (reutilizando los que ya existen en tu sistema)
export type OrderStage = "REGISTERED" | "IN_PROGRESS" | "READY" | "DELIVERED";
export type ShippingType = "PICKUP" | "DELIVERY";
export type PaymentMethod = "CASH" | "TRANSFER" | "CARD";
export type UnitType = "METER" | "PIECE";
export type ShippingStage = "SHIPPED" | "RECEIVED";

// Producto dentro de un item
export type OrderProduct = {
  id: number;
  name: string;
  unitType: UnitType;
  needsVariant: boolean;
  minQty?: string | number;
  qtyStep?: string | number;
};

// Variante de producto
export type ProductVariant = {
  id: number;
  name: string;
  order: number;
  isActive: boolean;
};

// Opción/parámetro de item
export type OrderItemOption = {
  id: number;
  name: string;
  priceDelta: string | number;
  optionId?: number;
};

// Paso de proceso
export type OrderItemStep = {
  id: number;
  name: string;
  order: number;
  status: "PENDING" | "DONE";
  doneAt?: string | null;
};

// Item del pedido
export type OrderItem = {
  id: number;
  orderId: number;
  productId: number;
  product: OrderProduct;
  productNameSnapshot: string;
  unitTypeSnapshot: UnitType;
  quantity: number;
  variantId?: number | null;
  variantRef?: ProductVariant | null;
  variant?: any; // JSON field
  appliedMinQty?: number | null;
  unitPrice: number;
  subtotal: number;
  productionStep: string;
  currentStepOrder: number;
  isReady: boolean;
  steps: OrderItemStep[];
  options: OrderItemOption[];
  createdAt: string;
  updatedAt: string;
};

// Sucursal básica
export type BranchBasic = {
  id: number;
  name: string;
  isActive?: boolean;
};

// Cliente
export type OrderCustomer = {
  id: number;
  name: string;
  phone: string;
  createdAt?: string;
};
export type OrderCreator = {
  id: number;
  name: string;
  username: string;
  role: "ADMIN" | "STAFF" | "COUNTER" | "PRODUCTION";
};
// Detalle completo de orden
export type OrderDetails = {
  id: number;
  branchId: number;
  branch: BranchBasic;
  customerId: number;
  customer: OrderCustomer;
  pickupBranchId: number;
  pickupBranch: BranchBasic;
  createdBy: number;
  creator?: OrderCreator;
  stage: OrderStage;
  shippingType: ShippingType;
  paymentMethod: PaymentMethod;
  shippingStage?: ShippingStage | null;
  deliveryDate: string; // ISO date
  deliveryTime?: string | null;
  notes?: string | null;
  total: number;
  deliveredAt?: string | null;
  createdAt: string;
  updatedAt: string;
  items: OrderItem[];
};

// Respuesta de listado de órdenes
export type OrdersResponse = {
  orders: OrderDetails[];
  pagination?: {
    total: number;
    page: number;
    limit: number;
    pages: number;
  };
};

// Datos para actualizar un item específico
export type UpdateOrderItemData = {
  id: number;
  quantity?: number;
  unitPrice?: number;
  isReady?: boolean;
  currentStepOrder?: number;
  variantId?: number | null;
  options?: Array<{
    id?: number;
    optionId: number;
    name: string;
    priceDelta: number;
  }>;
};

// Datos para actualizar una orden
export type UpdateOrderData = {
  deliveryDate?: string;
  deliveryTime?: string | null;
  notes?: string | null;
  paymentMethod?: PaymentMethod;
  stage?: OrderStage;
  shippingStage?: ShippingStage | null;
  deliveredAt?: string | null;
  items?: UpdateOrderItemData[];
};

// ========== FUNCIONES API PARA ÓRDENES ==========

/**
 * Obtener una orden por su ID
 */
export async function getOrderById(id: number): Promise<{ order: OrderDetails }> {
  return apiFetch(`/orders/${id}`);
}

/**
 * Obtener órdenes activas con filtros
 */
export async function getActiveOrders(params?: { 
  scope?: "all" | "branch";
  branchId?: number;
  stage?: OrderStage;
  fromDate?: string;
  toDate?: string;
  search?: string;
}): Promise<OrdersResponse> {
  const queryParams = new URLSearchParams();
  if (params?.scope) queryParams.append("scope", params.scope);
  if (params?.branchId) queryParams.append("branchId", params.branchId.toString());
  if (params?.stage) queryParams.append("stage", params.stage);
  if (params?.fromDate) queryParams.append("fromDate", params.fromDate);
  if (params?.toDate) queryParams.append("toDate", params.toDate);
  if (params?.search) queryParams.append("search", params.search);
  
  return apiFetch(`/orders/active?${queryParams.toString()}`);
}

/**
 * Avanzar al siguiente paso de un item
 */
export async function nextOrderItemStep(itemId: number): Promise<{ success: boolean }> {
  return apiFetch(`/order-items/${itemId}/next-step`, {
    method: "POST",
  });
}

/**
 * Entregar un pedido (marcar como DELIVERED)
 */
export async function deliverOrder(orderId: number): Promise<{ success: boolean }> {
  return apiFetch(`/orders/${orderId}/deliver`, {
    method: "POST",
  });
}

// Actualizar una orden existente (usa PUT)
export async function updateOrder(id: number, data: UpdateOrderData): Promise<{ success: boolean; total?: string }> {
  return apiFetch(`/orders/${id}`, {
    method: "PUT", // Cambiado de PATCH a PUT
    body: JSON.stringify(data),
  });
}

// Cancelar orden (soft delete)
export async function cancelOrder(id: number): Promise<{ success: boolean }> {
  return apiFetch(`/orders/${id}`, {
    method: "DELETE",
  });
}

// Eliminar orden permanentemente (solo ADMIN)
export async function deleteOrder(id: number): Promise<{ success: boolean }> {
  return apiFetch(`/orders/${id}/permanent`, {
    method: "DELETE",
  });
}