import type { ProductionSchedulePreviewResponse } from "../api/productionScheduling";
import {
  dateKeyFromBusinessInstant,
  timeKeyFromBusinessInstant,
} from "./businessTime";

export type DeliveryMode = "AUTO" | "MANUAL";

export type NewOrderSchedulingItem = {
  productId: number;
  quantity: number | string;
  variantId?: number | null;
  selectedParams?: Array<{
    paramId: number;
    chargeType: string;
    pieceQty?: number;
  }>;
  isCustomProduct?: boolean;
};

export type VersionedDeliveryEstimate = {
  estimatedReadyAt: string;
  dataVersion: string;
  requestId: number;
};

export type PreviewSettlement = {
  dataVersion: string;
  requestId: number;
};

const UNSCHEDULABLE_MESSAGES: Record<string, string> = {
  base_date_not_found: "No se encontró una próxima jornada de producción disponible.",
  normal_horizon_exhausted: "No hay capacidad normal suficiente dentro del horizonte de planeación.",
  extra_horizon_exhausted: "No hay capacidad extra suficiente dentro del horizonte de planeación.",
  invalid_extra_rule: "La regla de producción extra aplicable no es válida.",
  invalid_planner_input: "La información enviada al planeador no es válida.",
  planner_invariant_failed: "No fue posible completar la planeación de capacidad.",
};

export function deliveryInputsFromEstimatedReadyAt(value?: string | null) {
  if (!value) return null;
  const date = dateKeyFromBusinessInstant(value);
  const time = timeKeyFromBusinessInstant(value);
  if (!date || !time) return null;
  return { date, time };
}

export function createScheduleDataVersion(
  branchId: number | null,
  items: readonly NewOrderSchedulingItem[]
) {
  return JSON.stringify({
    branchId,
    items: items
      .filter((item) => !item.isCustomProduct && item.productId > 0)
      .map((item) => ({
        productId: item.productId,
        quantity: String(item.quantity),
        variantId: item.variantId ?? null,
        selectedParams: (item.selectedParams ?? []).map((param) => ({
          paramId: param.paramId,
          chargeType: param.chargeType,
          pieceQty: param.pieceQty ?? null,
        })),
      })),
  });
}

export function createSchedulePreviewItems(
  items: readonly NewOrderSchedulingItem[],
  isComplete: (item: NewOrderSchedulingItem) => boolean
) {
  const programmableItems = items.filter((item) => !item.isCustomProduct && item.productId > 0);
  if (programmableItems.length === 0 || programmableItems.some((item) => !isComplete(item))) {
    return [];
  }

  return programmableItems.map((item) => ({
    productId: item.productId,
    quantity: item.quantity,
  }));
}

function readableUnscheduledMessage(message?: string | null) {
  if (!message) return null;
  const reason = message.split(":").at(-1)?.trim() ?? "";
  const readable = UNSCHEDULABLE_MESSAGES[reason];
  if (!readable) return message.includes("_")
    ? "No fue posible encontrar capacidad para completar el pedido."
    : message;
  const separator = message.lastIndexOf(":");
  const product = separator > 0 ? message.slice(0, separator).trim() : "";
  return product ? `${product}: ${readable}` : readable;
}

export function previewIssueMessage(preview: ProductionSchedulePreviewResponse) {
  if (preview.plannerStatus === "UNSCHEDULABLE") {
    const messages = preview.items
      .filter((item) => item.plannerStatus === "UNSCHEDULABLE")
      .map((item) => readableUnscheduledMessage(item.message))
      .filter((message): message is string => !!message);
    return messages.length > 0
      ? messages.join(" ")
      : "No fue posible encontrar capacidad para completar el pedido.";
  }
  if (preview.plannerStatus === "PLANNED" && !preview.estimatedReadyAt) {
    return "El planeador terminó sin devolver una fecha estimada de entrega.";
  }
  if (preview.estimatedReadyAt && !deliveryInputsFromEstimatedReadyAt(preview.estimatedReadyAt)) {
    return "El planeador devolvió una fecha estimada inválida.";
  }
  return null;
}

export function evaluatePreviewResponse(args: {
  requestId: number;
  latestRequestId: number;
  responseDataVersion: string;
  currentDataVersion: string;
  deliveryMode: DeliveryMode;
  preview: ProductionSchedulePreviewResponse;
}) {
  const isCurrent = args.requestId === args.latestRequestId
    && args.responseDataVersion === args.currentDataVersion;
  if (!isCurrent) {
    return { accepted: false, shouldApply: false, estimate: null, issue: null } as const;
  }

  const issue = previewIssueMessage(args.preview);
  const estimatedReadyAt = args.preview.plannerStatus === "PLANNED"
    && !issue
    && args.preview.estimatedReadyAt
      ? args.preview.estimatedReadyAt
      : null;
  const estimate = estimatedReadyAt
    ? { estimatedReadyAt, dataVersion: args.responseDataVersion, requestId: args.requestId }
    : null;

  return {
    accepted: true,
    shouldApply: args.deliveryMode === "AUTO" && estimate !== null,
    estimate,
    issue,
  } as const;
}

export function currentVersionedEstimate(
  estimate: VersionedDeliveryEstimate | null,
  currentDataVersion: string,
  latestRequestId: number
) {
  return estimate?.dataVersion === currentDataVersion && estimate.requestId === latestRequestId
    ? estimate
    : null;
}

export function automaticEstimateAction(
  estimate: VersionedDeliveryEstimate | null,
  currentDataVersion: string,
  latestRequestId: number
) {
  const currentEstimate = currentVersionedEstimate(estimate, currentDataVersion, latestRequestId);
  return {
    estimate: currentEstimate,
    shouldRequestPreview: currentEstimate === null,
  };
}

export function previewIsSettledForCurrentData(
  settlement: PreviewSettlement | null,
  currentDataVersion: string,
  latestRequestId: number
) {
  return settlement?.dataVersion === currentDataVersion
    && settlement.requestId === latestRequestId;
}

export function shouldWaitForCurrentAutoPreview(args: {
  deliveryMode: DeliveryMode;
  hasPreviewableItems: boolean;
  currentPreviewIsSettled: boolean;
}) {
  return args.deliveryMode === "AUTO"
    && args.hasPreviewableItems
    && !args.currentPreviewIsSettled;
}

export function previewNetworkErrorMessage(error: unknown) {
  return error instanceof Error && error.message
    ? `No se pudo calcular la entrega estimada: ${error.message}`
    : "No se pudo calcular la entrega estimada por un error de red.";
}

export function commercialDeliveryIsEditable(role?: string | null) {
  void role;
  return true;
}
