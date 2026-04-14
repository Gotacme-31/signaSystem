// src/api/orders.ts

import { apiFetch } from "./http";

export type ParamChargeType = "PER_METER" | "PER_PIECE";

export type SelectedParamRequest = {
  paramId: number;
  chargeType: ParamChargeType;
  pieceQty?: number;
};

// ========== TIPOS PARA CREAR ÓRDENES ==========
export type OrderItemRequest = {
  productId: number;
  quantity: string;
  variantId?: number | null;

  // lo puedes dejar por compatibilidad temporal si quieres,
  // pero el backend ya debe usar selectedParams
  paramIds?: number[];

  selectedParams?: SelectedParamRequest[];
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

// ========== TIPOS PARA EDITAR ÓRDENES ==========
export type OrderStage = "REGISTERED" | "IN_PROGRESS" | "READY" | "DELIVERED";
export type ShippingType = "PICKUP" | "DELIVERY";
export type PaymentMethod = "CASH" | "TRANSFER" | "CARD";
export type UnitType = "METER" | "PIECE";
export type ShippingStage = "SHIPPED" | "RECEIVED";

export type OrderProduct = {
  id: number;
  name: string;
  unitType: UnitType;
  needsVariant: boolean;
  minQty?: string | number;
  qtyStep?: string | number;
};

export type ProductVariant = {
  id: number;
  name: string;
  order: number;
  isActive: boolean;
};

export type OrderItemOption = {
  id: number;
  name: string;
  priceDelta: string | number;
  optionId?: number;
  chargeType?: ParamChargeType;
  quantity?: number | string;
};

export type OrderItemStep = {
  id: number;
  name: string;
  order: number;
  status: "PENDING" | "DONE";
  doneAt?: string | null;
};

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
  variant?: any;
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

export type BranchBasic = {
  id: number;
  name: string;
  isActive?: boolean;
};

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
  deliveryDate: string;
  deliveryTime?: string | null;
  notes?: string | null;
  total: number;
  deliveredAt?: string | null;
  createdAt: string;
  updatedAt: string;
  items: OrderItem[];
};

export type OrdersResponse = {
  orders: OrderDetails[];
  pagination?: {
    total: number;
    page: number;
    limit: number;
    pages: number;
  };
};

export type UpdateOrderItemData = {
  id: number;
  quantity?: number | string;
  unitPrice?: number;
  isReady?: boolean;
  currentStepOrder?: number;
  variantId?: number | null;

  // mantener compatibilidad si aún lo usas en algún lado
  options?: Array<{
    id?: number;
    optionId: number;
    name: string;
    priceDelta: number;
  }>;

  selectedParams?: SelectedParamRequest[];
};

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

export async function getOrderById(id: number): Promise<{ order: OrderDetails }> {
  return apiFetch(`/orders/${id}`);
}

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

export async function nextOrderItemStep(itemId: number): Promise<{ success: boolean }> {
  return apiFetch(`/order-items/${itemId}/next-step`, {
    method: "POST",
  });
}

export async function deliverOrder(orderId: number): Promise<{ success: boolean }> {
  return apiFetch(`/orders/${orderId}/deliver`, {
    method: "POST",
  });
}

export async function updateOrder(id: number, data: UpdateOrderData): Promise<{ success: boolean; total?: string }> {
  return apiFetch(`/orders/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export async function cancelOrder(id: number): Promise<{ success: boolean }> {
  return apiFetch(`/orders/${id}`, {
    method: "DELETE",
  });
}

export async function deleteOrder(id: number): Promise<{ success: boolean }> {
  return apiFetch(`/orders/${id}/permanent`, {
    method: "DELETE",
  });
}