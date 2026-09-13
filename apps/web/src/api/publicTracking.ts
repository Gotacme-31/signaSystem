import { apiFetch } from "./http";

export type PublicTrackingStatus =
  | "REGISTERED"
  | "IN_PRODUCTION"
  | "READY_FOR_PICKUP"
  | "READY_FOR_SHIPPING"
  | "SHIPPED"
  | "DELIVERED";

export type PublicTrackingOrder = {
  orderNumber: number;
  publicStatus: PublicTrackingStatus;
  shippingType: "PICKUP" | "DELIVERY";
  estimatedReadyAt: string | null;
  createdAt: string;
};

export function getPublicOrderTracking(token: string) {
  return apiFetch<PublicTrackingOrder>(`/public/orders/track/${encodeURIComponent(token)}`);
}
