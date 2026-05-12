import { apiFetch } from "./http";

export type DeliveredOrder = {
  id: number;
  stage: "REGISTERED" | "IN_PROGRESS" | "READY" | "DELIVERED";
  shippingType: "PICKUP" | "DELIVERY";
  paymentMethod: "CASH" | "TRANSFER" | "CARD";
  deliveryDate: string;
  deliveryTime?: string | null;
  deliveredAt?: string | null;
  createdAt: string;
  total: string | number;
  notes?: string | null;

  customer: {
    id: number;
    name: string;
    phone: string;
  };

  branch: {
    id: number;
    name: string;
  };

  pickupBranch?: {
    id: number;
    name: string;
  } | null;

  items: Array<{
    id: number;
    quantity: string | number;
    subtotal: string | number;
    isCustomProduct?: boolean;
    customProductName?: string;
    customUnitType?: "METER" | "PIECE";
    customUnitPrice?: number | string;
    productNameSnapshot?: string;
    unitTypeSnapshot?: "METER" | "PIECE";
    product?: {
      id: number;
      name: string;
      unitType: "METER" | "PIECE";
    } | null;
  }>;
};

export async function getDeliveredOrders(params?: { q?: string }) {
  const qs = new URLSearchParams();
  if (params?.q?.trim()) qs.set("q", params.q.trim());

  const query = qs.toString();

  return apiFetch<{ orders: DeliveredOrder[] }>(
    `/orders/delivered${query ? `?${query}` : ""}`
  );
}

export async function deleteDeliveredOrderPermanent(id: number) {
  return apiFetch<{ success: boolean; message: string }>(
    `/orders/${id}/permanent`,
    { method: "DELETE" }
  );
}