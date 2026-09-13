import { apiFetch } from "./http";

export type OrderTrackingLinkResponse = {
  orderId: number;
  trackingUrl: string;
};

export function nextOrderItemStep(orderItemId: number) {
  return apiFetch(`/orders/order-items/${orderItemId}/next-step`, {
    method: "POST",
  });
}

export function deliverOrder(orderId: number) {
  return apiFetch(`/orders/${orderId}/deliver`, {
    method: "POST",
  });
}

export function receiveOrder(orderId: number) {
  return apiFetch(`/orders/${orderId}/received`, {
    method: "POST",
  });
}

export function getOrderTrackingLink(orderId: number) {
  return apiFetch<OrderTrackingLinkResponse>(`/orders/${orderId}/tracking`);
}

export function regenerateOrderTrackingLink(orderId: number) {
  return apiFetch<OrderTrackingLinkResponse>(`/orders/${orderId}/tracking/regenerate`, {
    method: "POST",
  });
}
