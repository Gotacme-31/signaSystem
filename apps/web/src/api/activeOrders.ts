import { apiFetch } from "./http";

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
