import type { PublicTrackingOrder, PublicTrackingStatus } from "../api/publicTracking";
import { BUSINESS_TIME_ZONE } from "./businessTime";

export type TimelineStep = {
  status: PublicTrackingStatus;
  label: string;
};

export type PublicTrackingRequest = {
  requestId: number;
  token: string;
};

export class PublicTrackingRequestCoordinator {
  private currentToken = "";
  private nextRequestId = 0;
  private inFlight: PublicTrackingRequest | null = null;

  selectToken(token: string) {
    if (token === this.currentToken) return false;
    this.currentToken = token;
    this.nextRequestId += 1;
    this.inFlight = null;
    return true;
  }

  begin(token: string): PublicTrackingRequest | null {
    this.selectToken(token);
    if (this.inFlight?.token === token) return null;

    const request = { requestId: ++this.nextRequestId, token };
    this.inFlight = request;
    return request;
  }

  isCurrent(request: PublicTrackingRequest) {
    return request.token === this.currentToken
      && request.requestId === this.nextRequestId;
  }

  finish(request: PublicTrackingRequest) {
    if (!this.isCurrent(request)) return false;
    this.inFlight = null;
    return true;
  }
}

const PICKUP_STEPS: TimelineStep[] = [
  { status: "REGISTERED", label: "Pedido registrado" },
  { status: "IN_PRODUCTION", label: "En producción" },
  { status: "READY_FOR_PICKUP", label: "Listo para entrega" },
  { status: "DELIVERED", label: "Pedido entregado" },
];

const DELIVERY_STEPS: TimelineStep[] = [
  { status: "REGISTERED", label: "Pedido registrado" },
  { status: "IN_PRODUCTION", label: "En producción" },
  { status: "READY_FOR_SHIPPING", label: "Listo para envío" },
  { status: "SHIPPED", label: "Pedido enviado" },
];

export function getTrackingTimeline(shippingType: PublicTrackingOrder["shippingType"]) {
  return shippingType === "PICKUP" ? PICKUP_STEPS : DELIVERY_STEPS;
}

export function formatTrackingDate(value: string | null) {
  if (!value) return null;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const dateLabel = new Intl.DateTimeFormat("es-MX", {
    timeZone: BUSINESS_TIME_ZONE,
    day: "numeric",
    month: "long",
  }).format(date);
  const timeLabel = new Intl.DateTimeFormat("es-MX", {
    timeZone: BUSINESS_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);

  return `${dateLabel} · ${timeLabel}`;
}
