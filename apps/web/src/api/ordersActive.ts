import { apiFetch } from "./http";

export type ActiveOrder = {
    total(total: any): import("react").ReactNode;
    id: number;
    stage: "REGISTERED" | "IN_PROGRESS" | "READY" | "DELIVERED";
    shippingType: "PICKUP" | "DELIVERY";
    paymentMethod: "CASH" | "TRANSFER" | "CARD";
    deliveryDate: string;
    deliveryTime?: string | null;
    createdAt: string;

    customer: { id: number; name: string; phone: string };
    branch: { id: number; name: string };
    pickupBranch?: { id: number; name: string } | null;

    items: Array<{
        id: number;
        quantity: string | number;
        isReady: boolean;
        currentStepOrder: number;
        product: { id: number; name: string; unitType: "METER" | "PIECE" };

        steps?: Array<{ order: number; name: string; status: "PENDING" | "DONE" }>;

    }>;
};

export async function getActiveOrders(params?: { scope?: "production" | "pickup" | "all" }) {
    const q = new URLSearchParams();
    if (params?.scope) q.set("scope", params.scope);
    const qs = q.toString();
    return apiFetch<{ orders: ActiveOrder[] }>(`/orders/active${qs ? `?${qs}` : ""}`);
}
