import { apiFetch } from "./http";

export type CreateOrderItem = {
  productId: number;
  quantity: string | number;
  variant?: any;
  productionStep: string;
};

export type CreateOrderPayload = {
  customerId: number;
  pickupBranchId?: number; // ✅ nuevo

  shippingType: "PICKUP" | "DELIVERY";
  paymentMethod: "CASH" | "TRANSFER" | "CARD";
  deliveryDate: string; // ISO
  deliveryTime?: string;
  notes?: string;

  items: CreateOrderItem[];
};

export function createOrder(payload: CreateOrderPayload) {
  return apiFetch<{ orderId: number; total: string; branchId: number; pickupBranchId: number }>("/orders", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
