import { Prisma } from "@prisma/client";
import {
  addBusinessDays,
  businessDateKeyFromDate,
  businessDayOfWeek,
  combineBusinessDateTimeToUtc,
} from "../lib/business-time";
import { isValidActiveNormalWindow } from "./production-capacity-window";

export type DecimalInput = string | Prisma.Decimal;
export type ProductionCapacityStrategyValue = "NORMAL" | "EXTRA_PREFERRED";
export type ProductionTargetWindowValue = "NEXT_AVAILABLE" | "FIRST_OF_DAY" | "LAST_OF_DAY";
export type ProductionAllocationMode = "NORMAL_WINDOW" | "EXTRA_DAILY";
export type ProductionRuleSelectionSource =
  | "EXPLICIT_RULE"
  | "IMPLICIT_EXTRA_THRESHOLD"
  | "DEFAULT_NORMAL";

export type ProductionQuantityRuleInput = {
  id: number;
  minQty: DecimalInput;
  maxQty: DecimalInput | null;
  delayBusinessDays: number;
  targetWindow: ProductionTargetWindowValue;
  capacityStrategy: ProductionCapacityStrategyValue;
  isActive: boolean;
};

export type SelectedRuleSnapshot = {
  id: number | null;
  minQty: Prisma.Decimal;
  maxQty: Prisma.Decimal | null;
  delayBusinessDays: number;
  targetWindow: ProductionTargetWindowValue;
  capacityStrategy: ProductionCapacityStrategyValue;
  defaultRuleApplied: boolean;
  selectionSource: ProductionRuleSelectionSource;
};

export type NormalWindowSnapshot = {
  id: number;
  branchId: number;
  productId: number;
  dayOfWeek: number;
  startsAt: string;
  endsAt: string;
  readyAt: string;
  capacityQty: DecimalInput;
  isActive: boolean;
};

export type NormalCapacitySnapshot = {
  branchId: number;
  productId: number;
  windowId: number;
  productionDate: string;
  capacityQty: DecimalInput;
  reservedQty: DecimalInput;
  status?: "OPEN" | "FULL" | "CLOSED" | "COMPLETED" | "CANCELLED";
};

export type ExtraCapacityTemplateSnapshot = {
  id: number;
  branchId: number;
  productId: number;
  dayOfWeek: number;
  capacityQty: DecimalInput;
  isActive: boolean;
};

export type ExtraCapacityDateSnapshot = {
  branchId: number;
  productId: number;
  extraCapacityId: number;
  productionDate: string;
  capacityQty: DecimalInput;
  reservedQty: DecimalInput;
  status?: "OPEN" | "FULL" | "CLOSED" | "COMPLETED" | "CANCELLED";
};

export type ProductionCapacitySkippedReason =
  | "blackout"
  | "inactive_window"
  | "invalid_window"
  | "window_end_passed"
  | "ready_at_passed"
  | "target_no_available_capacity"
  | "insufficient_accumulated_capacity"
  | "not_first_window"
  | "not_last_window"
  | "before_base_date"
  | "after_target"
  | "batch_unavailable"
  | "extra_not_configured"
  | "extra_not_configured_fallback_normal"
  | "extra_weekday_inactive"
  | "extra_day_without_windows"
  | "extra_anchor_expired"
  | "extra_no_available_capacity"
  | "extra_horizon_exhausted"
  | "invalid_extra_rule";

export type CapacityEvaluation = {
  itemKey: string;
  kind: ProductionAllocationMode;
  productionDate: string;
  windowId: number | null;
  extraCapacityId: number | null;
  capacityQty: Prisma.Decimal;
  reservedQty: Prisma.Decimal;
  previewReservedQty: Prisma.Decimal;
  availableQty: Prisma.Decimal;
  quantityAssigned: Prisma.Decimal;
  remainingBefore: Prisma.Decimal;
  remainingAfter: Prisma.Decimal;
  isTarget: boolean;
  skippedReason: ProductionCapacitySkippedReason | null;
};

export type NormalAllocation = {
  kind: "NORMAL_WINDOW";
  itemKey: string;
  orderItemId: number | null;
  branchId: number;
  productId: number;
  productionDate: string;
  windowId: number;
  windowStartAt: Date;
  windowEndAt: Date;
  readyAt: Date;
  quantityAssigned: Prisma.Decimal;
  availableQtyBeforeAllocation: Prisma.Decimal;
  capacityQty: Prisma.Decimal;
  reservationKey: string;
};

export type ExtraAllocation = {
  kind: "EXTRA_DAILY";
  itemKey: string;
  orderItemId: number | null;
  branchId: number;
  productId: number;
  productionDate: string;
  extraCapacityId: number;
  readyAt: Date;
  quantityAssigned: Prisma.Decimal;
  availableQtyBeforeAllocation: Prisma.Decimal;
  capacityQty: Prisma.Decimal;
  reservationKey: string;
};

export type PreviewReservationDelta = {
  kind: ProductionAllocationMode;
  key: string;
  quantityAssigned: Prisma.Decimal;
};

export type NormalTargetSnapshot = {
  productionDate: string;
  windowId: number;
  dayOfWeek: number;
  startsAt: string;
  endsAt: string;
  readyAt: string;
  readyAtDateTime: Date;
};

type PlannedNormalItem = {
  status: "PLANNED";
  allocationMode: "NORMAL_WINDOW";
  itemKey: string;
  orderItemId: number | null;
  quantity: Prisma.Decimal;
  selectedRule: SelectedRuleSnapshot;
  baseDate: string;
  targetReadyAt: Date;
  targetWindow: NormalTargetSnapshot;
  allocations: NormalAllocation[];
  evaluations: CapacityEvaluation[];
  previewReservationDeltas: PreviewReservationDelta[];
};

type PlannedExtraItem = {
  status: "PLANNED";
  allocationMode: "EXTRA_DAILY";
  itemKey: string;
  orderItemId: number | null;
  quantity: Prisma.Decimal;
  selectedRule: SelectedRuleSnapshot;
  baseDate: string;
  targetReadyAt: Date;
  targetWindow: null;
  allocations: ExtraAllocation[];
  evaluations: CapacityEvaluation[];
  previewReservationDeltas: PreviewReservationDelta[];
};

type UnplannedItem = {
  status: "NOT_REQUIRED" | "UNSCHEDULABLE";
  allocationMode: null;
  itemKey: string;
  orderItemId: number | null;
  quantity: Prisma.Decimal;
  selectedRule: SelectedRuleSnapshot | null;
  baseDate: string | null;
  reason: string;
  allocations: [];
  evaluations: CapacityEvaluation[];
  previewReservationDeltas: [];
};

export type ProductionItemPlan = PlannedNormalItem | PlannedExtraItem | UnplannedItem;

export type ProductionCapacityPlannerInput = {
  planningNow: Date;
  branchId: number;
  productId: number;
  itemKey: string;
  orderItemId?: number | null;
  quantity: DecimalInput;
  extraProductionThresholdQty: DecimalInput | null;
  requiresScheduling?: boolean;
  quantityRules: readonly ProductionQuantityRuleInput[];
  normalWindows: readonly NormalWindowSnapshot[];
  normalCapacitySnapshots: readonly NormalCapacitySnapshot[];
  extraCapacityTemplates: readonly ExtraCapacityTemplateSnapshot[];
  extraCapacitySnapshots: readonly ExtraCapacityDateSnapshot[];
  normalPreviewReservations?: ReadonlyMap<string, DecimalInput>;
  extraPreviewReservations?: ReadonlyMap<string, DecimalInput>;
  blackoutDates: ReadonlySet<string>;
  maxSearchDays?: number;
};

type DatedNormalWindow = {
  window: NormalWindowSnapshot;
  productionDate: string;
  windowStartAt: Date;
  windowEndAt: Date;
  readyAt: Date;
};

type CapacityAvailability = {
  capacityQty: Prisma.Decimal;
  reservedQty: Prisma.Decimal;
  previewReservedQty: Prisma.Decimal;
  availableQty: Prisma.Decimal;
  unavailable: boolean;
};

type PlannerContext = {
  input: ProductionCapacityPlannerInput;
  quantity: Prisma.Decimal;
  selectedRule: SelectedRuleSnapshot;
  baseDate: string;
  planningDate: string;
  maxSearchDays: number;
  normalSnapshots: Map<string, NormalCapacitySnapshot>;
  extraSnapshots: Map<string, ExtraCapacityDateSnapshot>;
};

const DEFAULT_MAX_SEARCH_DAYS = 365;

function decimal(value: DecimalInput) {
  return new Prisma.Decimal(value);
}

function zero() {
  return new Prisma.Decimal(0);
}

function nonNegative(value: DecimalInput | undefined) {
  const parsed = value === undefined ? zero() : decimal(value);
  return parsed.gt(0) ? parsed : zero();
}

function minDecimal(a: Prisma.Decimal, b: Prisma.Decimal) {
  return a.lte(b) ? a : b;
}

function hasValidDecimalInputs(input: ProductionCapacityPlannerInput) {
  const values: DecimalInput[] = [
    input.quantity,
    ...(input.extraProductionThresholdQty === null ? [] : [input.extraProductionThresholdQty]),
    ...input.quantityRules.flatMap((rule) => rule.maxQty === null ? [rule.minQty] : [rule.minQty, rule.maxQty]),
    ...input.normalWindows.map((window) => window.capacityQty),
    ...input.normalCapacitySnapshots.flatMap((snapshot) => [snapshot.capacityQty, snapshot.reservedQty]),
    ...input.extraCapacityTemplates.map((template) => template.capacityQty),
    ...input.extraCapacitySnapshots.flatMap((snapshot) => [snapshot.capacityQty, snapshot.reservedQty]),
    ...Array.from(input.normalPreviewReservations?.values() ?? []),
    ...Array.from(input.extraPreviewReservations?.values() ?? []),
  ];

  try {
    return values.every((value) => {
      const parsed = decimal(value);
      return parsed.isFinite() && parsed.decimalPlaces() <= 3;
    });
  } catch {
    return false;
  }
}

export function normalPreviewReservationKey(args: {
  branchId: number;
  productId: number;
  windowId: number;
  productionDate: string;
}) {
  return `NORMAL:${args.branchId}:${args.productId}:${args.windowId}:${args.productionDate}`;
}

export function extraPreviewReservationKey(args: {
  branchId: number;
  productId: number;
  extraCapacityId: number;
  productionDate: string;
}) {
  return `EXTRA:${args.branchId}:${args.productId}:${args.extraCapacityId}:${args.productionDate}`;
}

export function selectProductionQuantityRule(
  rules: readonly ProductionQuantityRuleInput[],
  quantityInput: DecimalInput
): SelectedRuleSnapshot {
  const quantity = decimal(quantityInput);
  const selected = rules
    .filter((rule) => rule.isActive)
    .map((rule) => ({
      ...rule,
      minQty: decimal(rule.minQty),
      maxQty: rule.maxQty === null ? null : decimal(rule.maxQty),
    }))
    .filter((rule) => quantity.gte(rule.minQty))
    .filter((rule) => rule.maxQty === null || quantity.lte(rule.maxQty))
    .sort((a, b) => {
      const minCompare = a.minQty.comparedTo(b.minQty);
      if (minCompare !== 0) return minCompare;
      if (a.maxQty === null && b.maxQty !== null) return 1;
      if (a.maxQty !== null && b.maxQty === null) return -1;
      if (a.maxQty !== null && b.maxQty !== null) return a.maxQty.comparedTo(b.maxQty);
      return a.id - b.id;
    })[0];

  if (!selected) {
    return {
      id: null,
      minQty: zero(),
      maxQty: null,
      delayBusinessDays: 0,
      targetWindow: "NEXT_AVAILABLE",
      capacityStrategy: "NORMAL",
      defaultRuleApplied: true,
      selectionSource: "DEFAULT_NORMAL",
    };
  }

  return {
    id: selected.id,
    minQty: selected.minQty,
    maxQty: selected.maxQty,
    delayBusinessDays: selected.delayBusinessDays,
    targetWindow: selected.targetWindow,
    capacityStrategy: selected.capacityStrategy,
    defaultRuleApplied: false,
    selectionSource: "EXPLICIT_RULE",
  };
}

function selectEffectiveProductionRule(args: {
  rules: readonly ProductionQuantityRuleInput[];
  quantity: Prisma.Decimal;
  extraProductionThresholdQty: Prisma.Decimal | null;
}): SelectedRuleSnapshot {
  const explicitRule = selectProductionQuantityRule(args.rules, args.quantity);
  if (explicitRule.selectionSource === "EXPLICIT_RULE") return explicitRule;
  if (args.extraProductionThresholdQty === null || args.quantity.lte(args.extraProductionThresholdQty)) {
    return explicitRule;
  }

  return {
    id: null,
    minQty: args.extraProductionThresholdQty,
    maxQty: null,
    delayBusinessDays: 0,
    targetWindow: "LAST_OF_DAY",
    capacityStrategy: "EXTRA_PREFERRED",
    defaultRuleApplied: false,
    selectionSource: "IMPLICIT_EXTRA_THRESHOLD",
  };
}

function windowsForWeekday(input: ProductionCapacityPlannerInput, productionDate: string) {
  const dayOfWeek = businessDayOfWeek(productionDate);
  return input.normalWindows
    .filter((window) => window.branchId === input.branchId && window.productId === input.productId)
    .filter((window) => window.dayOfWeek === dayOfWeek)
    .sort((a, b) => {
      if (a.startsAt !== b.startsAt) return a.startsAt.localeCompare(b.startsAt);
      if (a.readyAt !== b.readyAt) return a.readyAt.localeCompare(b.readyAt);
      return a.id - b.id;
    });
}

function activeWindowsForDate(input: ProductionCapacityPlannerInput, productionDate: string) {
  if (input.blackoutDates.has(productionDate)) return [];
  return windowsForWeekday(input, productionDate).filter(isValidActiveNormalWindow);
}

function datedWindow(window: NormalWindowSnapshot, productionDate: string): DatedNormalWindow {
  return {
    window,
    productionDate,
    windowStartAt: combineBusinessDateTimeToUtc(productionDate, window.startsAt),
    windowEndAt: combineBusinessDateTimeToUtc(productionDate, window.endsAt),
    readyAt: combineBusinessDateTimeToUtc(productionDate, window.readyAt),
  };
}

function compareDatedWindows(a: DatedNormalWindow, b: DatedNormalWindow) {
  if (a.productionDate !== b.productionDate) return a.productionDate.localeCompare(b.productionDate);
  if (a.window.startsAt !== b.window.startsAt) return a.window.startsAt.localeCompare(b.window.startsAt);
  if (a.window.readyAt !== b.window.readyAt) return a.window.readyAt.localeCompare(b.window.readyAt);
  return a.window.id - b.window.id;
}

function windowExpiredReason(window: DatedNormalWindow, planningNow: Date): ProductionCapacitySkippedReason | null {
  if (window.windowEndAt.getTime() <= planningNow.getTime()) return "window_end_passed";
  if (window.readyAt.getTime() <= planningNow.getTime()) return "ready_at_passed";
  return null;
}

function findBusinessBaseDate(args: {
  input: ProductionCapacityPlannerInput;
  startDate: string;
  delayBusinessDays: number;
  maxSearchDays: number;
}) {
  let counted = 0;
  for (let offset = 0; offset <= args.maxSearchDays; offset += 1) {
    const date = addBusinessDays(args.startDate, offset);
    if (activeWindowsForDate(args.input, date).length === 0) continue;
    if (counted === args.delayBusinessDays) return date;
    counted += 1;
  }
  return null;
}

function normalSnapshotKey(args: {
  branchId: number;
  productId: number;
  windowId: number;
  productionDate: string;
}) {
  return `${args.branchId}:${args.productId}:${args.windowId}:${args.productionDate}`;
}

function extraSnapshotKey(args: {
  branchId: number;
  productId: number;
  extraCapacityId: number;
  productionDate: string;
}) {
  return `${args.branchId}:${args.productId}:${args.extraCapacityId}:${args.productionDate}`;
}

function normalAvailability(context: PlannerContext, candidate: DatedNormalWindow): CapacityAvailability {
  const { input } = context;
  const snapshotKey = normalSnapshotKey({
    branchId: input.branchId,
    productId: input.productId,
    windowId: candidate.window.id,
    productionDate: candidate.productionDate,
  });
  const reservationKey = normalPreviewReservationKey({
    branchId: input.branchId,
    productId: input.productId,
    windowId: candidate.window.id,
    productionDate: candidate.productionDate,
  });
  const snapshot = context.normalSnapshots.get(snapshotKey);
  const capacityQty = nonNegative(snapshot?.capacityQty ?? candidate.window.capacityQty);
  const reservedQty = nonNegative(snapshot?.reservedQty);
  const previewReservedQty = nonNegative(input.normalPreviewReservations?.get(reservationKey));
  const rawAvailable = capacityQty.sub(reservedQty).sub(previewReservedQty);
  const statusAvailable = !snapshot?.status || snapshot.status === "OPEN" || snapshot.status === "FULL";

  return {
    capacityQty,
    reservedQty,
    previewReservedQty,
    availableQty: rawAvailable.gt(0) && statusAvailable ? rawAvailable : zero(),
    unavailable: !statusAvailable,
  };
}

function extraAvailability(
  context: PlannerContext,
  template: ExtraCapacityTemplateSnapshot,
  productionDate: string
): CapacityAvailability {
  const { input } = context;
  const snapshot = context.extraSnapshots.get(extraSnapshotKey({
    branchId: input.branchId,
    productId: input.productId,
    extraCapacityId: template.id,
    productionDate,
  }));
  const reservationKey = extraPreviewReservationKey({
    branchId: input.branchId,
    productId: input.productId,
    extraCapacityId: template.id,
    productionDate,
  });
  const capacityQty = nonNegative(snapshot?.capacityQty ?? template.capacityQty);
  const reservedQty = nonNegative(snapshot?.reservedQty);
  const previewReservedQty = nonNegative(input.extraPreviewReservations?.get(reservationKey));
  const rawAvailable = capacityQty.sub(reservedQty).sub(previewReservedQty);
  const statusAvailable = !snapshot?.status || snapshot.status === "OPEN" || snapshot.status === "FULL";

  return {
    capacityQty,
    reservedQty,
    previewReservedQty,
    availableQty: rawAvailable.gt(0) && statusAvailable ? rawAvailable : zero(),
    unavailable: !statusAvailable,
  };
}

function evaluation(args: {
  context: PlannerContext;
  kind: ProductionAllocationMode;
  productionDate: string;
  windowId?: number | null;
  extraCapacityId?: number | null;
  availability?: CapacityAvailability;
  quantityAssigned?: Prisma.Decimal;
  remainingBefore?: Prisma.Decimal;
  remainingAfter?: Prisma.Decimal;
  isTarget?: boolean;
  skippedReason?: ProductionCapacitySkippedReason | null;
}): CapacityEvaluation {
  const assigned = args.quantityAssigned ?? zero();
  const remainingBefore = args.remainingBefore ?? args.context.quantity;
  return {
    itemKey: args.context.input.itemKey,
    kind: args.kind,
    productionDate: args.productionDate,
    windowId: args.windowId ?? null,
    extraCapacityId: args.extraCapacityId ?? null,
    capacityQty: args.availability?.capacityQty ?? zero(),
    reservedQty: args.availability?.reservedQty ?? zero(),
    previewReservedQty: args.availability?.previewReservedQty ?? zero(),
    availableQty: args.availability?.availableQty ?? zero(),
    quantityAssigned: assigned,
    remainingBefore,
    remainingAfter: args.remainingAfter ?? remainingBefore.sub(assigned),
    isTarget: args.isTarget ?? false,
    skippedReason: args.skippedReason ?? null,
  };
}

function sameDatedWindow(a: DatedNormalWindow, b: DatedNormalWindow) {
  return a.productionDate === b.productionDate && a.window.id === b.window.id;
}

function physicalWindowsThroughTarget(context: PlannerContext, target: DatedNormalWindow) {
  const windows: DatedNormalWindow[] = [];
  const evaluations: CapacityEvaluation[] = [];
  for (let date = context.baseDate, guard = 0; date <= target.productionDate; date = addBusinessDays(date, 1), guard += 1) {
    if (guard > context.maxSearchDays * 3 + 366) break;
    const blackout = context.input.blackoutDates.has(date);
    for (const window of windowsForWeekday(context.input, date)) {
      const dated = datedWindow(window, date);
      const skippedReason = !window.isActive
        ? "inactive_window"
        : !isValidActiveNormalWindow(window)
          ? "invalid_window"
          : blackout
            ? "blackout"
            : compareDatedWindows(dated, target) > 0
              ? "after_target"
              : windowExpiredReason(dated, context.input.planningNow);
      if (skippedReason) {
        evaluations.push(evaluation({
          context,
          kind: "NORMAL_WINDOW",
          productionDate: date,
          windowId: window.id,
          availability: normalAvailability(context, dated),
          isTarget: sameDatedWindow(dated, target),
          skippedReason,
        }));
        continue;
      }
      windows.push(dated);
    }
  }
  return { windows, evaluations };
}

function validateNormalPlan(context: PlannerContext, target: DatedNormalWindow, allocations: NormalAllocation[]) {
  const total = allocations.reduce((sum, allocation) => sum.add(allocation.quantityAssigned), zero());
  const targetAllocation = allocations.find((allocation) =>
    allocation.windowId === target.window.id && allocation.productionDate === target.productionDate
  );
  return total.eq(context.quantity)
    && allocations.length > 0
    && allocations.every((allocation) =>
      allocation.kind === "NORMAL_WINDOW"
      && allocation.itemKey === context.input.itemKey
      && allocation.branchId === context.input.branchId
      && allocation.productId === context.input.productId
      && allocation.quantityAssigned.gt(0)
      && allocation.availableQtyBeforeAllocation.gt(0)
    )
    && !!targetAllocation
    && targetAllocation.quantityAssigned.gt(0);
}

function validateExtraPlan(context: PlannerContext, allocations: ExtraAllocation[]) {
  const total = allocations.reduce((sum, allocation) => sum.add(allocation.quantityAssigned), zero());
  return total.eq(context.quantity)
    && allocations.length > 0
    && allocations.every((allocation) =>
      allocation.kind === "EXTRA_DAILY"
      && allocation.itemKey === context.input.itemKey
      && allocation.branchId === context.input.branchId
      && allocation.productId === context.input.productId
      && allocation.quantityAssigned.gt(0)
      && allocation.availableQtyBeforeAllocation.gt(0)
    );
}

function unplanned(args: {
  context: PlannerContext;
  status?: "NOT_REQUIRED" | "UNSCHEDULABLE";
  reason: string;
  evaluations: CapacityEvaluation[];
}): UnplannedItem {
  return {
    status: args.status ?? "UNSCHEDULABLE",
    allocationMode: null,
    itemKey: args.context.input.itemKey,
    orderItemId: args.context.input.orderItemId ?? null,
    quantity: args.context.quantity,
    selectedRule: args.context.selectedRule,
    baseDate: args.context.baseDate,
    reason: args.reason,
    allocations: [],
    evaluations: args.evaluations,
    previewReservationDeltas: [],
  };
}

function targetCandidatesForDate(
  context: PlannerContext,
  productionDate: string,
  targetWindow: ProductionTargetWindowValue,
  evaluations: CapacityEvaluation[]
) {
  const allWindows = windowsForWeekday(context.input, productionDate);
  const activeWindows = allWindows.filter(isValidActiveNormalWindow);

  for (const window of allWindows.filter((candidate) => !isValidActiveNormalWindow(candidate))) {
    evaluations.push(evaluation({
      context,
      kind: "NORMAL_WINDOW",
      productionDate,
      windowId: window.id,
      skippedReason: window.isActive ? "invalid_window" : "inactive_window",
    }));
  }

  if (context.input.blackoutDates.has(productionDate)) {
    for (const window of activeWindows) {
      evaluations.push(evaluation({
        context,
        kind: "NORMAL_WINDOW",
        productionDate,
        windowId: window.id,
        skippedReason: "blackout",
      }));
    }
    return [];
  }

  if (targetWindow === "NEXT_AVAILABLE") {
    return activeWindows.map((window) => datedWindow(window, productionDate));
  }

  const selected = targetWindow === "FIRST_OF_DAY" ? activeWindows[0] : activeWindows[activeWindows.length - 1];
  for (const window of activeWindows) {
    if (window.id === selected?.id) continue;
    evaluations.push(evaluation({
      context,
      kind: "NORMAL_WINDOW",
      productionDate,
      windowId: window.id,
      skippedReason: targetWindow === "FIRST_OF_DAY" ? "not_first_window" : "not_last_window",
    }));
  }
  return selected ? [datedWindow(selected, productionDate)] : [];
}

function planNormal(
  context: PlannerContext,
  targetWindow: ProductionTargetWindowValue,
  initialEvaluations: CapacityEvaluation[] = []
): ProductionItemPlan {
  const evaluations = [...initialEvaluations];

  for (let offset = 0; offset < context.maxSearchDays; offset += 1) {
    const targetDate = addBusinessDays(context.baseDate, offset);
    const candidates = targetCandidatesForDate(context, targetDate, targetWindow, evaluations);

    for (const target of candidates) {
      const targetAvailability = normalAvailability(context, target);
      const expiredReason = windowExpiredReason(target, context.input.planningNow);
      const unavailableReason = expiredReason
        ?? (targetAvailability.unavailable ? "batch_unavailable" : null)
        ?? (targetAvailability.availableQty.lte(0) ? "target_no_available_capacity" : null);

      if (unavailableReason) {
        evaluations.push(evaluation({
          context,
          kind: "NORMAL_WINDOW",
          productionDate: target.productionDate,
          windowId: target.window.id,
          availability: targetAvailability,
          isTarget: true,
          skippedReason: unavailableReason,
        }));
        continue;
      }

      const physicalSearch = physicalWindowsThroughTarget(context, target);
      evaluations.push(...physicalSearch.evaluations);
      const physicalWindows = physicalSearch.windows
        .map((window) => ({ window, availability: normalAvailability(context, window) }))
        .filter(({ availability }) => !availability.unavailable && availability.availableQty.gt(0));
      const accumulated = physicalWindows.reduce(
        (sum, candidate) => sum.add(candidate.availability.availableQty),
        zero()
      );

      if (accumulated.lt(context.quantity)) {
        for (const candidate of physicalWindows) {
          evaluations.push(evaluation({
            context,
            kind: "NORMAL_WINDOW",
            productionDate: candidate.window.productionDate,
            windowId: candidate.window.window.id,
            availability: candidate.availability,
            isTarget: sameDatedWindow(candidate.window, target),
            skippedReason: sameDatedWindow(candidate.window, target) ? "insufficient_accumulated_capacity" : null,
          }));
        }
        continue;
      }

      const targetCapacity = physicalWindows.find((candidate) => sameDatedWindow(candidate.window, target));
      if (!targetCapacity) continue;
      const priorCapacities = physicalWindows
        .filter((candidate) => !sameDatedWindow(candidate.window, target))
        .sort((a, b) => compareDatedWindows(b.window, a.window));
      const allocationOrder = [targetCapacity, ...priorCapacities];
      const allocations: NormalAllocation[] = [];
      let remaining = context.quantity;

      for (const candidate of allocationOrder) {
        if (remaining.lte(0)) break;
        const remainingBefore = remaining;
        const quantityAssigned = minDecimal(candidate.availability.availableQty, remaining);
        if (quantityAssigned.lte(0)) continue;
        remaining = remaining.sub(quantityAssigned);
        const reservationKey = normalPreviewReservationKey({
          branchId: context.input.branchId,
          productId: context.input.productId,
          windowId: candidate.window.window.id,
          productionDate: candidate.window.productionDate,
        });
        allocations.push({
          kind: "NORMAL_WINDOW",
          itemKey: context.input.itemKey,
          orderItemId: context.input.orderItemId ?? null,
          branchId: context.input.branchId,
          productId: context.input.productId,
          productionDate: candidate.window.productionDate,
          windowId: candidate.window.window.id,
          windowStartAt: candidate.window.windowStartAt,
          windowEndAt: candidate.window.windowEndAt,
          readyAt: candidate.window.readyAt,
          quantityAssigned,
          availableQtyBeforeAllocation: candidate.availability.availableQty,
          capacityQty: candidate.availability.capacityQty,
          reservationKey,
        });
        evaluations.push(evaluation({
          context,
          kind: "NORMAL_WINDOW",
          productionDate: candidate.window.productionDate,
          windowId: candidate.window.window.id,
          availability: candidate.availability,
          quantityAssigned,
          remainingBefore,
          remainingAfter: remaining,
          isTarget: sameDatedWindow(candidate.window, target),
        }));
      }

      if (!remaining.eq(0) || !validateNormalPlan(context, target, allocations)) {
        return unplanned({ context, reason: "planner_invariant_failed", evaluations });
      }

      return {
        status: "PLANNED",
        allocationMode: "NORMAL_WINDOW",
        itemKey: context.input.itemKey,
        orderItemId: context.input.orderItemId ?? null,
        quantity: context.quantity,
        selectedRule: context.selectedRule,
        baseDate: context.baseDate,
        targetReadyAt: target.readyAt,
        targetWindow: {
          productionDate: target.productionDate,
          windowId: target.window.id,
          dayOfWeek: target.window.dayOfWeek,
          startsAt: target.window.startsAt,
          endsAt: target.window.endsAt,
          readyAt: target.window.readyAt,
          readyAtDateTime: target.readyAt,
        },
        allocations,
        evaluations,
        previewReservationDeltas: allocations.map((allocation) => ({
          kind: allocation.kind,
          key: allocation.reservationKey,
          quantityAssigned: allocation.quantityAssigned,
        })),
      };
    }
  }

  return unplanned({ context, reason: "normal_horizon_exhausted", evaluations });
}

function baseDateEvaluations(context: PlannerContext) {
  const evaluations: CapacityEvaluation[] = [];
  for (let date = context.planningDate, guard = 0; date < context.baseDate; date = addBusinessDays(date, 1), guard += 1) {
    if (guard > context.maxSearchDays) break;
    if (!context.input.blackoutDates.has(date)) continue;
    for (const window of windowsForWeekday(context.input, date).filter((candidate) => candidate.isActive)) {
      evaluations.push(evaluation({
        context,
        kind: "NORMAL_WINDOW",
        productionDate: date,
        windowId: window.id,
        skippedReason: "blackout",
      }));
    }
  }
  return evaluations;
}

function structuralExtraTemplates(context: PlannerContext) {
  const workingWeekdays = new Set(
    context.input.normalWindows
      .filter((window) => window.branchId === context.input.branchId && window.productId === context.input.productId)
      .filter(isValidActiveNormalWindow)
      .map((window) => window.dayOfWeek)
  );
  return context.input.extraCapacityTemplates
    .filter((template) => template.branchId === context.input.branchId && template.productId === context.input.productId)
    .filter((template) => workingWeekdays.has(template.dayOfWeek))
    .filter((template) => template.isActive && decimal(template.capacityQty).gt(0));
}

function extraTemplateForDate(context: PlannerContext, productionDate: string) {
  const dayOfWeek = businessDayOfWeek(productionDate);
  return structuralExtraTemplates(context)
    .filter((template) => template.dayOfWeek === dayOfWeek)
    .sort((a, b) => a.id - b.id)[0] ?? null;
}

function planExtra(context: PlannerContext, initialEvaluations: CapacityEvaluation[] = []): ProductionItemPlan {
  const configuredTemplates = structuralExtraTemplates(context);
  const evaluations: CapacityEvaluation[] = [...initialEvaluations];

  if (configuredTemplates.length === 0) {
    evaluations.push(evaluation({
      context,
      kind: "EXTRA_DAILY",
      productionDate: context.baseDate,
      skippedReason: "extra_not_configured_fallback_normal",
    }));
    return planNormal(context, "LAST_OF_DAY", evaluations);
  }

  const tentativeAllocations: ExtraAllocation[] = [];
  let remaining = context.quantity;

  // The horizon contains exactly maxSearchDays dates: baseDate is index 0 and the last index is maxSearchDays - 1.
  for (let offset = 0; offset < context.maxSearchDays; offset += 1) {
    const productionDate = addBusinessDays(context.baseDate, offset);
    const template = extraTemplateForDate(context, productionDate);

    if (context.input.blackoutDates.has(productionDate)) {
      evaluations.push(evaluation({
        context,
        kind: "EXTRA_DAILY",
        productionDate,
        extraCapacityId: template?.id,
        skippedReason: "blackout",
        remainingBefore: remaining,
        remainingAfter: remaining,
      }));
      continue;
    }

    if (!template) {
      evaluations.push(evaluation({
        context,
        kind: "EXTRA_DAILY",
        productionDate,
        skippedReason: "extra_weekday_inactive",
        remainingBefore: remaining,
        remainingAfter: remaining,
      }));
      continue;
    }

    const normalWindows = activeWindowsForDate(context.input, productionDate);
    if (normalWindows.length === 0) {
      evaluations.push(evaluation({
        context,
        kind: "EXTRA_DAILY",
        productionDate,
        extraCapacityId: template.id,
        skippedReason: "extra_day_without_windows",
        remainingBefore: remaining,
        remainingAfter: remaining,
      }));
      continue;
    }

    const anchor = datedWindow(normalWindows[normalWindows.length - 1], productionDate);
    if (productionDate === context.planningDate && windowExpiredReason(anchor, context.input.planningNow)) {
      evaluations.push(evaluation({
        context,
        kind: "EXTRA_DAILY",
        productionDate,
        extraCapacityId: template.id,
        skippedReason: "extra_anchor_expired",
        remainingBefore: remaining,
        remainingAfter: remaining,
      }));
      continue;
    }

    const availability = extraAvailability(context, template, productionDate);
    if (availability.availableQty.lte(0)) {
      evaluations.push(evaluation({
        context,
        kind: "EXTRA_DAILY",
        productionDate,
        extraCapacityId: template.id,
        availability,
        skippedReason: "extra_no_available_capacity",
        remainingBefore: remaining,
        remainingAfter: remaining,
      }));
      continue;
    }

    const remainingBefore = remaining;
    const quantityAssigned = minDecimal(availability.availableQty, remaining);
    remaining = remaining.sub(quantityAssigned);
    const reservationKey = extraPreviewReservationKey({
      branchId: context.input.branchId,
      productId: context.input.productId,
      extraCapacityId: template.id,
      productionDate,
    });
    tentativeAllocations.push({
      kind: "EXTRA_DAILY",
      itemKey: context.input.itemKey,
      orderItemId: context.input.orderItemId ?? null,
      branchId: context.input.branchId,
      productId: context.input.productId,
      productionDate,
      extraCapacityId: template.id,
      readyAt: anchor.readyAt,
      quantityAssigned,
      availableQtyBeforeAllocation: availability.availableQty,
      capacityQty: availability.capacityQty,
      reservationKey,
    });
    evaluations.push(evaluation({
      context,
      kind: "EXTRA_DAILY",
      productionDate,
      extraCapacityId: template.id,
      availability,
      quantityAssigned,
      remainingBefore,
      remainingAfter: remaining,
    }));

    if (remaining.eq(0)) {
      if (!validateExtraPlan(context, tentativeAllocations)) {
        return unplanned({ context, reason: "planner_invariant_failed", evaluations });
      }
      return {
        status: "PLANNED",
        allocationMode: "EXTRA_DAILY",
        itemKey: context.input.itemKey,
        orderItemId: context.input.orderItemId ?? null,
        quantity: context.quantity,
        selectedRule: context.selectedRule,
        baseDate: context.baseDate,
        targetReadyAt: tentativeAllocations[tentativeAllocations.length - 1].readyAt,
        targetWindow: null,
        allocations: tentativeAllocations,
        evaluations,
        previewReservationDeltas: tentativeAllocations.map((allocation) => ({
          kind: allocation.kind,
          key: allocation.reservationKey,
          quantityAssigned: allocation.quantityAssigned,
        })),
      };
    }
  }

  const lastDate = addBusinessDays(context.baseDate, context.maxSearchDays - 1);
  evaluations.push(evaluation({
    context,
    kind: "EXTRA_DAILY",
    productionDate: lastDate,
    skippedReason: "extra_horizon_exhausted",
    remainingBefore: remaining,
    remainingAfter: remaining,
  }));
  return unplanned({ context, reason: "extra_horizon_exhausted", evaluations });
}

export function planProductionCapacity(input: ProductionCapacityPlannerInput): ProductionItemPlan {
  let quantity: Prisma.Decimal;
  let extraProductionThresholdQty: Prisma.Decimal | null;
  try {
    quantity = decimal(input.quantity);
    extraProductionThresholdQty = input.extraProductionThresholdQty === null
      ? null
      : decimal(input.extraProductionThresholdQty);
  } catch {
    quantity = zero();
    extraProductionThresholdQty = null;
  }

  const orderItemId = input.orderItemId ?? null;
  if (input.requiresScheduling === false) {
    return {
      status: "NOT_REQUIRED",
      allocationMode: null,
      itemKey: input.itemKey,
      orderItemId,
      quantity,
      selectedRule: null,
      baseDate: null,
      reason: "production_not_required",
      allocations: [],
      evaluations: [],
      previewReservationDeltas: [],
    };
  }

  if (!Number.isInteger(input.maxSearchDays ?? DEFAULT_MAX_SEARCH_DAYS)
    || (input.maxSearchDays ?? DEFAULT_MAX_SEARCH_DAYS) <= 0
    || quantity.lte(0)
    || (extraProductionThresholdQty !== null && extraProductionThresholdQty.lte(0))
    || !hasValidDecimalInputs(input)
    || !Number.isFinite(input.planningNow.getTime())) {
    return {
      status: "UNSCHEDULABLE",
      allocationMode: null,
      itemKey: input.itemKey,
      orderItemId,
      quantity,
      selectedRule: null,
      baseDate: null,
      reason: "invalid_planner_input",
      allocations: [],
      evaluations: [],
      previewReservationDeltas: [],
    };
  }

  const selectedRule = selectEffectiveProductionRule({
    rules: input.quantityRules,
    quantity,
    extraProductionThresholdQty,
  });
  const shouldUseExtra = selectedRule.capacityStrategy === "EXTRA_PREFERRED";
  const maxSearchDays = input.maxSearchDays ?? DEFAULT_MAX_SEARCH_DAYS;
  const planningDate = businessDateKeyFromDate(input.planningNow);
  const contextSeed = {
    input,
    quantity,
    selectedRule,
    baseDate: planningDate,
    planningDate,
    maxSearchDays,
    normalSnapshots: new Map(input.normalCapacitySnapshots.map((snapshot) => [normalSnapshotKey(snapshot), snapshot])),
    extraSnapshots: new Map(input.extraCapacitySnapshots.map((snapshot) => [extraSnapshotKey(snapshot), snapshot])),
  } satisfies PlannerContext;

  if (
    shouldUseExtra
    && (selectedRule.delayBusinessDays !== 0 || selectedRule.targetWindow !== "LAST_OF_DAY")
  ) {
    const invalidEvaluation = evaluation({
      context: contextSeed,
      kind: "EXTRA_DAILY",
      productionDate: planningDate,
      skippedReason: "invalid_extra_rule",
    });
    return unplanned({
      context: contextSeed,
      reason: "invalid_extra_rule",
      evaluations: [invalidEvaluation],
    });
  }

  const baseDate = findBusinessBaseDate({
    input,
    startDate: planningDate,
    delayBusinessDays: selectedRule.delayBusinessDays,
    maxSearchDays,
  });
  if (!baseDate) {
    return unplanned({
      context: contextSeed,
      reason: "base_date_not_found",
      evaluations: [],
    });
  }

  const context: PlannerContext = { ...contextSeed, baseDate };
  const initialEvaluations = baseDateEvaluations(context);
  return shouldUseExtra
    ? planExtra(context, initialEvaluations)
    : planNormal(context, selectedRule.targetWindow, initialEvaluations);
}
