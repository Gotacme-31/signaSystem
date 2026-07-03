import { apiFetch } from "./http";

export type ProductionScheduleStatus =
  | "NOT_REQUIRED"
  | "AUTO_SCHEDULED"
  | "AUTO_OVERFLOW_ESTIMATED"
  | "MANUAL_REQUIRED"
  | "MANUAL_SET"
  | "FAILED";

export type ProductionScheduleSource = "NONE" | "AUTO" | "MANUAL";
export type ProductionTargetWindow = "NEXT_AVAILABLE" | "FIRST_OF_DAY" | "LAST_OF_DAY";
export type ProductionCapacityUnit = "METER" | "PIECE";

export type ProductionCapacityWindow = {
  id?: number | null;
  configId?: number;
  dayOfWeek: number;
  startsAt: string;
  endsAt: string;
  readyAt: string;
  capacityQty: string;
  isActive: boolean;
};

export type ProductionQuantityRule = {
  id?: number | null;
  configId?: number;
  minQty: string;
  maxQty?: string | null;
  delayBusinessDays: number;
  targetWindow: ProductionTargetWindow;
  isActive: boolean;
};

export type ProductionConfig = {
  id?: number | null;
  branchId: number;
  productId: number;
  enabled: boolean;
  windows: ProductionCapacityWindow[];
  quantityRules: ProductionQuantityRule[];
};

export type ProductionConfigRow = {
  branchId: number;
  productId: number;
  product: {
    id: number;
    name: string;
    unitType: ProductionCapacityUnit;
    isActive: boolean;
  };
  branchProductIsActive: boolean;
  config: ProductionConfig;
};

export type ProductionBlackoutDate = {
  id: number;
  branchId: number | null;
  productId: number | null;
  date: string;
  reason: string | null;
  isActive: boolean;
  branch?: { id: number; name: string } | null;
  product?: { id: number; name: string; unitType: ProductionCapacityUnit } | null;
  createdAt?: string;
  updatedAt?: string;
};

export type ProductionBlackoutDateInput = {
  branchId?: number | null;
  productId?: number | null;
  date: string;
  reason?: string | null;
  isActive?: boolean;
};

export type ProductionSchedulePreviewMatchedRule = {
  minQty: string;
  maxQty: string | null;
  delayBusinessDays: number;
  targetWindow: ProductionTargetWindow;
};

export type ProductionSchedulePreviewMatchedWindow = {
  dayOfWeek: number;
  readyAt: string;
  capacityQty: string;
};

export type ProductionScheduleWindowEvaluation = {
  date: string;
  windowId: number;
  dayOfWeek: number;
  readyAt: string;
  capacityQty: string;
  reservedQty: string;
  availableQty: string;
  skippedReason: string | null;
};

export type ProductionSchedulePreviewDebug = {
  quantity: number;
  matchedRule: boolean;
  defaultRuleApplied: boolean;
  delayBusinessDays: number;
  targetWindow: ProductionTargetWindow;
  evaluatedWindows: ProductionScheduleWindowEvaluation[];
  calculatedReadyAt: string | null;
};

export type ProductionSchedulePreviewItem = {
  productId: number;
  quantity: number;
  estimatedReadyAt: string | null;
  status: ProductionScheduleStatus;
  source: ProductionScheduleSource;
  message: string | null;
  matchedRule: ProductionSchedulePreviewMatchedRule | null;
  matchedWindow: ProductionSchedulePreviewMatchedWindow | null;
  debug: ProductionSchedulePreviewDebug | null;
};

export type ProductionSchedulePreviewResponse = {
  estimatedReadyAt: string | null;
  status: ProductionScheduleStatus;
  items: ProductionSchedulePreviewItem[];
};

export async function getProductionConfigs(branchId: number) {
  return apiFetch<{ rows: ProductionConfigRow[] }>(`/admin/branches/${branchId}/production-configs`);
}

export async function setProductionConfig(
  branchId: number,
  productId: number,
  config: Omit<ProductionConfig, "id" | "branchId" | "productId">
) {
  return apiFetch<{ ok: boolean; config: ProductionConfig }>(
    `/admin/branches/${branchId}/products/${productId}/production-config`,
    {
      method: "PUT",
      body: JSON.stringify(config),
    }
  );
}

export async function recalculateOrderProductionSchedule(orderId: number) {
  return apiFetch(`/admin/orders/${orderId}/recalculate-production-schedule`, {
    method: "POST",
  });
}

export async function getProductionBlackoutDates(params?: {
  branchId?: number | null;
  productId?: number | null;
  dateFrom?: string;
  dateTo?: string;
}) {
  const query = new URLSearchParams();
  if (params?.branchId) query.set("branchId", String(params.branchId));
  if (params?.productId) query.set("productId", String(params.productId));
  if (params?.dateFrom) query.set("dateFrom", params.dateFrom);
  if (params?.dateTo) query.set("dateTo", params.dateTo);

  return apiFetch<{ rows: ProductionBlackoutDate[] }>(
    `/admin/production-blackout-dates${query.toString() ? `?${query.toString()}` : ""}`
  );
}

export async function createProductionBlackoutDate(input: ProductionBlackoutDateInput) {
  return apiFetch<{ ok: boolean; blackoutDate: ProductionBlackoutDate }>(
    "/admin/production-blackout-dates",
    {
      method: "POST",
      body: JSON.stringify(input),
    }
  );
}

export async function updateProductionBlackoutDate(id: number, input: Partial<ProductionBlackoutDateInput>) {
  return apiFetch<{ ok: boolean; blackoutDate: ProductionBlackoutDate }>(
    `/admin/production-blackout-dates/${id}`,
    {
      method: "PATCH",
      body: JSON.stringify(input),
    }
  );
}

export async function deleteProductionBlackoutDate(id: number) {
  return apiFetch<{ ok: boolean }>(`/admin/production-blackout-dates/${id}`, {
    method: "DELETE",
  });
}

export async function previewProductionSchedule(
  branchId: number,
  items: Array<{ productId: number; quantity: number | string }>
) {
  return apiFetch<ProductionSchedulePreviewResponse>("/production-schedule/preview", {
    method: "POST",
    body: JSON.stringify({ branchId, items }),
  });
}
