import { apiFetch } from "./http";

export type OrderItemRequest = {
  productId: number;
  quantity: string;
  variantId?: number | null;
  paramIds?: number[];
};

export type OrderRequest = {
  customerId: number;
  branchId: number; // (el backend toma el auth.branchId como el real)
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
