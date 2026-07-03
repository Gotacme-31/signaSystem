import { apiFetch } from "./http";

export type ActiveOrder = {
    total(total: any): import("react").ReactNode;
    id: number;
    stage: "REGISTERED" | "IN_PROGRESS" | "READY" | "DELIVERED";
    productionScheduleStatus?: "NOT_REQUIRED" | "AUTO_SCHEDULED" | "AUTO_OVERFLOW_ESTIMATED" | "MANUAL_REQUIRED" | "MANUAL_SET" | "FAILED";
    productionScheduleSource?: "NONE" | "AUTO" | "MANUAL";
    productionScheduleMessage?: string | null;
    shippingType: "PICKUP" | "DELIVERY";
    paymentMethod: "CASH" | "TRANSFER" | "CARD";
    deliveryDate: string;
    deliveryTime?: string | null;
    autoEstimatedReadyAt?: string | null;
    manualReadyAt?: string | null;
    estimatedReadyAt?: string | null;
    createdAt: string;

    customer: { id: number; name: string; phone: string };
    branch: { id: number; name: string };
    pickupBranch?: { id: number; name: string } | null;

    files?: Array<{
        id: number;
        orderItemId?: number | null;
        status: "ACTIVE" | "PENDING_DELETE" | "DELETED" | "DELETE_FAILED";
    }>;

    items: Array<{
        id: number;
        quantity: string | number;
        autoEstimatedReadyAt?: string | null;
        manualReadyAt?: string | null;
        estimatedReadyAt?: string | null;
        productionScheduleStatus?: "NOT_REQUIRED" | "AUTO_SCHEDULED" | "AUTO_OVERFLOW_ESTIMATED" | "MANUAL_REQUIRED" | "MANUAL_SET" | "FAILED";
        productionScheduleSource?: "NONE" | "AUTO" | "MANUAL";
        productionScheduleMessage?: string | null;
        isReady: boolean;
        currentStepOrder: number;
        product: { id: number; name: string; unitType: "METER" | "PIECE" };

        steps?: Array<{ order: number; name: string; status: "PENDING" | "DONE" }>;

    }>;
};

export async function getActiveOrders(params?: { scope?: "production" | "pickup" | "all", sortOrder?: "asc" | "desc"; }) {
    const q = new URLSearchParams();
    if (params?.scope) q.set("scope", params.scope);
    const qs = q.toString();
    return apiFetch<{ orders: ActiveOrder[] }>(`/orders/active${qs ? `?${qs}` : ""}`);
}
