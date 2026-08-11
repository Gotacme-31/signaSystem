import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import {
  extraPreviewReservationKey,
  normalPreviewReservationKey,
  planProductionCapacity,
  selectProductionQuantityRule,
  type ExtraCapacityTemplateSnapshot,
  type NormalWindowSnapshot,
  type ProductionCapacityPlannerInput,
  type ProductionItemPlan,
  type ProductionQuantityRuleInput,
} from "./production-capacity-planner";
import { applyPreviewReservationDeltas } from "./production-capacity-runtime";
import { businessDateKeyFromDate, combineBusinessDateTimeToUtc } from "../lib/business-time";

const BRANCH_ID = 1;
const PRODUCT_ID = 10;
const MONDAY = "2026-07-20";
const TUESDAY = "2026-07-21";
const WEDNESDAY = "2026-07-22";
const THURSDAY = "2026-07-23";
const planningNow = combineBusinessDateTimeToUtc(MONDAY, "08:00");

function normalRule(targetWindow: ProductionQuantityRuleInput["targetWindow"] = "NEXT_AVAILABLE", delay = 0) {
  return {
    id: 1,
    minQty: "0",
    maxQty: null,
    delayBusinessDays: delay,
    targetWindow,
    capacityStrategy: "NORMAL",
    isActive: true,
  } satisfies ProductionQuantityRuleInput;
}

function extraRule(overrides: Partial<ProductionQuantityRuleInput> = {}) {
  return {
    id: 2,
    minQty: "0",
    maxQty: null,
    delayBusinessDays: 0,
    targetWindow: "LAST_OF_DAY",
    capacityStrategy: "EXTRA_PREFERRED",
    isActive: true,
    ...overrides,
  } satisfies ProductionQuantityRuleInput;
}

function window(id: number, dayOfWeek: number, startsAt: string, endsAt: string, readyAt: string, capacityQty: string) {
  return {
    id,
    branchId: BRANCH_ID,
    productId: PRODUCT_ID,
    dayOfWeek,
    startsAt,
    endsAt,
    readyAt,
    capacityQty,
    isActive: true,
  } satisfies NormalWindowSnapshot;
}

function extra(id: number, dayOfWeek: number, capacityQty = "100") {
  return {
    id,
    branchId: BRANCH_ID,
    productId: PRODUCT_ID,
    dayOfWeek,
    capacityQty,
    isActive: true,
  } satisfies ExtraCapacityTemplateSnapshot;
}

function input(overrides: Partial<ProductionCapacityPlannerInput>): ProductionCapacityPlannerInput {
  return {
    planningNow,
    branchId: BRANCH_ID,
    productId: PRODUCT_ID,
    itemKey: "item",
    quantity: "1",
    extraProductionThresholdQty: "35",
    quantityRules: [normalRule()],
    normalWindows: [window(1, 1, "09:00", "10:00", "10:00", "100")],
    normalCapacitySnapshots: [],
    extraCapacityTemplates: [],
    extraCapacitySnapshots: [],
    blackoutDates: new Set(),
    maxSearchDays: 365,
    ...overrides,
  };
}

function planned(plan: ProductionItemPlan) {
  assert.equal(plan.status, "PLANNED", plan.status === "UNSCHEDULABLE" ? plan.reason : "expected planned");
  if (plan.status !== "PLANNED") throw new Error("expected planned");
  return plan;
}

function quantities(plan: ReturnType<typeof planned>) {
  return plan.allocations.map((allocation) => allocation.quantityAssigned.toString());
}

const anchors = [
  window(1, 1, "17:00", "18:00", "18:00", "100"),
  window(2, 2, "17:00", "18:00", "18:00", "100"),
  window(3, 3, "17:00", "18:00", "18:00", "100"),
];

function runTwoItems() {
  const templates = [extra(101, 1), extra(102, 2)];
  const reservations = new Map();
  const normalReservations = new Map();
  const first = planned(planProductionCapacity(input({
    itemKey: "A",
    quantity: "90",
    quantityRules: [extraRule()],
    normalWindows: anchors,
    extraCapacityTemplates: templates,
  })));
  applyPreviewReservationDeltas({ plan: first, normalReservations, extraReservations: reservations });
  const second = planned(planProductionCapacity(input({
    itemKey: "B",
    quantity: "90",
    quantityRules: [extraRule()],
    normalWindows: anchors,
    extraCapacityTemplates: templates,
    extraPreviewReservations: reservations,
  })));
  applyPreviewReservationDeltas({ plan: second, normalReservations, extraReservations: reservations });
  return { first, second, reservations };
}

test("01 selection keeps inclusive historical precedence and default", () => {
  const selected = selectProductionQuantityRule([
    { ...normalRule(), id: 20, minQty: "10", maxQty: "20" },
    { ...normalRule(), id: 10, minQty: "10", maxQty: "30" },
  ], "20");
  assert.equal(selected.id, 20);
  assert.equal(selectProductionQuantityRule([{ ...normalRule(), minQty: "100" }], "20").defaultRuleApplied, true);
});

test("02 NEXT_AVAILABLE small item uses first window", () => {
  const plan = planned(planProductionCapacity(input({ quantity: "20", normalWindows: [window(1, 1, "09:00", "10:00", "10:00", "80")] })));
  assert.deepEqual(quantities(plan), ["20"]);
  assert.equal(plan.targetWindow?.windowId, 1);
});

test("03 LAST_OF_DAY assigns target first and then backwards", () => {
  const plan = planned(planProductionCapacity(input({
    quantity: "100",
    quantityRules: [normalRule("LAST_OF_DAY")],
    normalWindows: [window(1, 1, "11:00", "12:00", "12:00", "70"), window(2, 1, "17:00", "18:00", "18:00", "70")],
  })));
  assert.deepEqual(plan.allocations.map((allocation) => allocation.kind === "NORMAL_WINDOW" && allocation.windowId), [2, 1]);
  assert.deepEqual(quantities(plan), ["70", "30"]);
});

test("04 zero-capacity target advances with real and preview reservations", () => {
  const key = normalPreviewReservationKey({ branchId: BRANCH_ID, productId: PRODUCT_ID, windowId: 1, productionDate: MONDAY });
  const plan = planned(planProductionCapacity(input({
    quantity: "20",
    normalWindows: [window(1, 1, "09:00", "10:00", "10:00", "80"), window(2, 1, "11:00", "12:00", "12:00", "50")],
    normalCapacitySnapshots: [{ branchId: BRANCH_ID, productId: PRODUCT_ID, windowId: 1, productionDate: MONDAY, capacityQty: "80", reservedQty: "70" }],
    normalPreviewReservations: new Map([[key, "10"]]),
  })));
  assert.equal(plan.targetWindow?.windowId, 2);
});

test("05 partial target gets positive quantity before previous windows", () => {
  const plan = planned(planProductionCapacity(input({
    quantity: "50",
    quantityRules: [normalRule("LAST_OF_DAY")],
    normalWindows: [window(1, 1, "11:00", "12:00", "12:00", "70"), window(2, 1, "17:00", "18:00", "18:00", "20")],
  })));
  assert.deepEqual(quantities(plan), ["20", "30"]);
});

test("06 FIRST_OF_DAY advances without promising second window", () => {
  const plan = planned(planProductionCapacity(input({
    quantity: "30",
    quantityRules: [normalRule("FIRST_OF_DAY")],
    normalWindows: [window(1, 1, "09:00", "10:00", "10:00", "10"), window(2, 1, "15:00", "16:00", "16:00", "100"), window(3, 2, "09:00", "10:00", "10:00", "20")],
  })));
  assert.equal(plan.targetWindow?.productionDate, TUESDAY);
  assert.equal(plan.targetWindow?.windowId, 3);
});

test("07 LAST_OF_DAY advances only to next last target", () => {
  const plan = planned(planProductionCapacity(input({
    quantity: "30",
    quantityRules: [normalRule("LAST_OF_DAY")],
    normalWindows: [window(1, 1, "09:00", "10:00", "10:00", "0"), window(2, 1, "17:00", "18:00", "18:00", "10"), window(3, 2, "09:00", "10:00", "10:00", "0"), window(4, 2, "17:00", "18:00", "18:00", "20")],
  })));
  assert.equal(plan.targetWindow?.windowId, 4);
});

test("08 normal allocations never occur after target", () => {
  const plan = planned(planProductionCapacity(input({ quantity: "100", quantityRules: [normalRule("LAST_OF_DAY")], normalWindows: [window(1, 1, "11:00", "12:00", "12:00", "70"), window(2, 1, "17:00", "18:00", "18:00", "70")] })));
  assert.ok(plan.allocations.every((allocation) => allocation.productionDate <= plan.targetWindow!.productionDate));
});

test("09 targetReadyAt does not depend on allocation tail", () => {
  const plan = planned(planProductionCapacity(input({ quantity: "100", quantityRules: [normalRule("LAST_OF_DAY")], normalWindows: [window(1, 1, "11:00", "12:00", "12:00", "70"), window(2, 1, "17:00", "18:00", "18:00", "70")] })));
  const lastAllocation = plan.allocations[plan.allocations.length - 1];
  assert.equal(lastAllocation.kind === "NORMAL_WINDOW" && lastAllocation.windowId, 1);
  assert.equal(plan.targetReadyAt.getTime(), combineBusinessDateTimeToUtc(MONDAY, "18:00").getTime());
});

test("10 endsAt equal to planningNow is unavailable", () => {
  const plan = planned(planProductionCapacity(input({ quantity: "10", normalWindows: [window(1, 1, "07:00", "08:00", "09:00", "100"), window(2, 1, "09:00", "10:00", "10:00", "100")] })));
  assert.equal(plan.targetWindow?.windowId, 2);
  assert.ok(plan.evaluations.some((entry) => entry.skippedReason === "window_end_passed"));
});

test("11 readyAt equal to planningNow is unavailable", () => {
  const plan = planned(planProductionCapacity(input({ quantity: "10", normalWindows: [window(1, 1, "07:00", "09:00", "08:00", "100"), window(2, 1, "09:00", "10:00", "10:00", "100")] })));
  assert.equal(plan.targetWindow?.windowId, 2);
  assert.ok(plan.evaluations.some((entry) => entry.skippedReason === "ready_at_passed"));
});

test("12 blackout skips normal date", () => {
  const plan = planned(planProductionCapacity(input({ quantity: "10", normalWindows: [window(1, 1, "09:00", "10:00", "10:00", "100"), window(2, 2, "09:00", "10:00", "10:00", "100")], blackoutDates: new Set([MONDAY]) })));
  assert.equal(plan.targetWindow?.productionDate, TUESDAY);
});

test("13 decimals remain exact to three positions", () => {
  const cases = [["9.999", "100.000", "90.001"], ["0.001", "10.125", "10.124"], ["99.999", "100.000", "0.001"]];
  for (const [quantity, capacityQty, reservedQty] of cases) {
    const plan = planned(planProductionCapacity(input({ quantity, normalWindows: [window(1, 1, "09:00", "10:00", "10:00", capacityQty)], normalCapacitySnapshots: [{ branchId: BRANCH_ID, productId: PRODUCT_ID, windowId: 1, productionDate: MONDAY, capacityQty, reservedQty }] })));
    assert.equal(plan.allocations[0].quantityAssigned.toFixed(3), quantity);
  }
});

test("14 extra sufficient assigns today", () => {
  const plan = planned(planProductionCapacity(input({ itemKey: "A", quantity: "90", quantityRules: [extraRule()], normalWindows: anchors, extraCapacityTemplates: [extra(101, 1)] })));
  assert.equal(plan.allocationMode, "EXTRA_DAILY");
  assert.deepEqual(quantities(plan), ["90"]);
});

test("15 sequential 90 items produce A=90 and B=10+80", () => {
  const { first, second, reservations } = runTwoItems();
  assert.deepEqual(quantities(first), ["90"]);
  assert.deepEqual(quantities(second), ["10", "80"]);
  assert.equal(reservations.get(extraPreviewReservationKey({ branchId: BRANCH_ID, productId: PRODUCT_ID, extraCapacityId: 101, productionDate: MONDAY }))?.toString(), "100");
  assert.equal(reservations.get(extraPreviewReservationKey({ branchId: BRANCH_ID, productId: PRODUCT_ID, extraCapacityId: 102, productionDate: TUESDAY }))?.toString(), "80");
});

test("16 extra splits over three days", () => {
  const plan = planned(planProductionCapacity(input({ quantity: "100", quantityRules: [extraRule()], normalWindows: anchors, extraCapacityTemplates: [extra(101, 1, "40"), extra(102, 2, "40"), extra(103, 3, "40")] })));
  assert.deepEqual(quantities(plan), ["40", "40", "20"]);
});

test("17 extra skips intermediate blackout", () => {
  const plan = planned(planProductionCapacity(input({ quantity: "150", quantityRules: [extraRule()], normalWindows: anchors, extraCapacityTemplates: [extra(101, 1), extra(102, 2), extra(103, 3)], blackoutDates: new Set([TUESDAY]) })));
  assert.deepEqual(plan.allocations.map((allocation) => allocation.productionDate), [MONDAY, WEDNESDAY]);
});

test("18 weekday without extra advances", () => {
  const plan = planned(planProductionCapacity(input({ quantity: "50", quantityRules: [extraRule()], normalWindows: anchors, extraCapacityTemplates: [extra(102, 2)] })));
  assert.equal(plan.allocations[0].productionDate, TUESDAY);
});

test("19 extra day without normal windows is skipped", () => {
  const plan = planned(planProductionCapacity(input({ quantity: "150", quantityRules: [extraRule()], normalWindows: [anchors[0], anchors[2]], extraCapacityTemplates: [extra(101, 1), extra(102, 2), extra(103, 3)] })));
  assert.deepEqual(plan.allocations.map((allocation) => allocation.productionDate), [MONDAY, WEDNESDAY]);
  assert.ok(plan.allocations.every((allocation) =>
    allocation.kind !== "EXTRA_DAILY" || allocation.extraCapacityId !== 102
  ));
});

test("20 expired extra anchor advances", () => {
  const plan = planned(planProductionCapacity(input({ quantity: "50", quantityRules: [extraRule()], normalWindows: [window(1, 1, "07:00", "08:00", "08:00", "100"), anchors[1]], extraCapacityTemplates: [extra(101, 1), extra(102, 2)] })));
  assert.equal(plan.allocations[0].productionDate, TUESDAY);
});

test("21 no structural extra falls back to complete normal plan", () => {
  const plan = planned(planProductionCapacity(input({ quantity: "100", quantityRules: [extraRule()], normalWindows: [window(1, 1, "11:00", "12:00", "12:00", "70"), window(2, 1, "17:00", "18:00", "18:00", "70")] })));
  assert.equal(plan.allocationMode, "NORMAL_WINDOW");
  assert.deepEqual(quantities(plan), ["70", "30"]);
});

test("22 configured full extra continues to future pool", () => {
  const plan = planned(planProductionCapacity(input({ quantity: "50", quantityRules: [extraRule()], normalWindows: anchors, extraCapacityTemplates: [extra(101, 1), extra(102, 2), extra(103, 3)], extraCapacitySnapshots: [{ branchId: BRANCH_ID, productId: PRODUCT_ID, extraCapacityId: 101, productionDate: MONDAY, capacityQty: "100", reservedQty: "100" }, { branchId: BRANCH_ID, productId: PRODUCT_ID, extraCapacityId: 102, productionDate: TUESDAY, capacityQty: "100", reservedQty: "100" }] })));
  assert.equal(plan.allocations[0].productionDate, WEDNESDAY);
});

test("23 exhausted horizon returns no allocations or deltas", () => {
  const reservations = new Map([[extraPreviewReservationKey({ branchId: BRANCH_ID, productId: PRODUCT_ID, extraCapacityId: 101, productionDate: MONDAY }), "100"]]);
  const plan = planProductionCapacity(input({ quantity: "50", quantityRules: [extraRule()], normalWindows: anchors, extraCapacityTemplates: [extra(101, 1), extra(102, 2)], extraCapacitySnapshots: [{ branchId: BRANCH_ID, productId: PRODUCT_ID, extraCapacityId: 102, productionDate: TUESDAY, capacityQty: "100", reservedQty: "100" }], extraPreviewReservations: reservations, maxSearchDays: 2 }));
  assert.equal(plan.status, "UNSCHEDULABLE");
  assert.deepEqual(plan.allocations, []);
  assert.deepEqual(plan.previewReservationDeltas, []);
});

test("24 invalid extra rule is controlled", () => {
  const plan = planProductionCapacity(input({ quantity: "50", quantityRules: [extraRule({ targetWindow: "NEXT_AVAILABLE" })], normalWindows: anchors, extraCapacityTemplates: [extra(101, 1)] }));
  assert.equal(plan.status, "UNSCHEDULABLE");
  assert.equal(plan.status === "UNSCHEDULABLE" && plan.reason, "invalid_extra_rule");
});

test("25 item identities and allocation modes never mix", () => {
  const { first, second } = runTwoItems();
  assert.ok(first.allocations.every((allocation) => allocation.kind === "EXTRA_DAILY" && allocation.itemKey === "A"));
  assert.ok(second.allocations.every((allocation) => allocation.kind === "EXTRA_DAILY" && allocation.itemKey === "B"));
});

test("26 delayed rule resolves business base date", () => {
  const plan = planned(planProductionCapacity(input({ quantity: "10", quantityRules: [normalRule("FIRST_OF_DAY", 1)], normalWindows: [window(1, 1, "09:00", "10:00", "10:00", "100"), window(2, 2, "09:00", "10:00", "10:00", "100")] })));
  assert.equal(plan.baseDate, TUESDAY);
  assert.equal(businessDateKeyFromDate(plan.targetReadyAt), TUESDAY);
});

test("26a one-day delay never consumes capacity before base date", () => {
  const plan = planned(planProductionCapacity(input({
    quantity: "100",
    quantityRules: [normalRule("LAST_OF_DAY", 1)],
    normalWindows: [
      window(1, 1, "17:00", "18:00", "18:00", "100"),
      window(2, 2, "17:00", "18:00", "18:00", "60"),
      window(3, 3, "17:00", "18:00", "18:00", "50"),
    ],
  })));
  assert.equal(plan.baseDate, TUESDAY);
  assert.deepEqual(plan.allocations.map((allocation) => allocation.productionDate), [WEDNESDAY, TUESDAY]);
  assert.ok(plan.allocations.every((allocation) => allocation.productionDate >= plan.baseDate));
});

test("26b multi-day delay never consumes capacity before base date", () => {
  const plan = planned(planProductionCapacity(input({
    quantity: "100",
    quantityRules: [normalRule("LAST_OF_DAY", 2)],
    normalWindows: [
      window(1, 1, "17:00", "18:00", "18:00", "100"),
      window(2, 2, "17:00", "18:00", "18:00", "100"),
      window(3, 3, "17:00", "18:00", "18:00", "60"),
      window(4, 4, "17:00", "18:00", "18:00", "50"),
    ],
  })));
  assert.equal(plan.baseDate, WEDNESDAY);
  assert.deepEqual(plan.allocations.map((allocation) => allocation.productionDate), [THURSDAY, WEDNESDAY]);
  assert.ok(plan.allocations.every((allocation) => allocation.productionDate >= plan.baseDate));
});

test("27 quantity equal to threshold remains NORMAL", () => {
  const plan = planned(planProductionCapacity(input({
    quantity: "35.000",
    quantityRules: [],
    normalWindows: [
      window(1, 1, "09:00", "10:00", "10:00", "100"),
      window(2, 1, "17:00", "18:00", "18:00", "100"),
    ],
    extraCapacityTemplates: [extra(101, 1)],
  })));
  assert.equal(plan.allocationMode, "NORMAL_WINDOW");
  assert.equal(plan.selectedRule.selectionSource, "DEFAULT_NORMAL");
  assert.equal(plan.selectedRule.targetWindow, "NEXT_AVAILABLE");
  assert.equal(plan.targetWindow?.windowId, 1);
});

test("28 quantity above threshold uses EXTRA", () => {
  const plan = planned(planProductionCapacity(input({
    quantity: "35.001",
    quantityRules: [],
    normalWindows: anchors,
    extraCapacityTemplates: [extra(101, 1)],
  })));
  assert.equal(plan.allocationMode, "EXTRA_DAILY");
  assert.equal(plan.selectedRule.selectionSource, "IMPLICIT_EXTRA_THRESHOLD");
  assert.equal(plan.selectedRule.delayBusinessDays, 0);
  assert.equal(plan.selectedRule.targetWindow, "LAST_OF_DAY");
});

test("29 decimal threshold compares exactly to three positions", () => {
  const equal = planned(planProductionCapacity(input({
    quantity: "35.125",
    extraProductionThresholdQty: "35.125",
    quantityRules: [],
    normalWindows: anchors,
    extraCapacityTemplates: [extra(101, 1)],
  })));
  const above = planned(planProductionCapacity(input({
    quantity: "35.126",
    extraProductionThresholdQty: "35.125",
    quantityRules: [],
    normalWindows: anchors,
    extraCapacityTemplates: [extra(101, 1)],
  })));
  assert.equal(equal.allocationMode, "NORMAL_WINDOW");
  assert.equal(above.allocationMode, "EXTRA_DAILY");
});

test("30 null threshold without an explicit rule uses default NORMAL", () => {
  const plan = planned(planProductionCapacity(input({
    quantity: "90",
    extraProductionThresholdQty: null,
    quantityRules: [],
    normalWindows: anchors,
    extraCapacityTemplates: [extra(101, 1), extra(102, 2)],
  })));
  assert.equal(plan.allocationMode, "NORMAL_WINDOW");
  assert.equal(plan.selectedRule.selectionSource, "DEFAULT_NORMAL");
  assert.equal(plan.selectedRule.targetWindow, "NEXT_AVAILABLE");
});

test("30a null threshold respects an explicit EXTRA rule", () => {
  const plan = planned(planProductionCapacity(input({
    quantity: "90",
    extraProductionThresholdQty: null,
    quantityRules: [extraRule()],
    normalWindows: anchors,
    extraCapacityTemplates: [extra(101, 1), extra(102, 2)],
  })));
  assert.equal(plan.allocationMode, "EXTRA_DAILY");
  assert.equal(plan.selectedRule.selectionSource, "EXPLICIT_RULE");
});

test("31 two small items are not combined to exceed threshold", () => {
  const plans = ["small-a", "small-b"].map((itemKey) => planned(planProductionCapacity(input({
    itemKey,
    quantity: "20",
    quantityRules: [],
    normalWindows: anchors,
    extraCapacityTemplates: [extra(101, 1)],
  }))));
  assert.ok(plans.every((plan) => plan.allocationMode === "NORMAL_WINDOW"));
  assert.ok(plans.every((plan) => plan.selectedRule.selectionSource === "DEFAULT_NORMAL"));
  assert.ok(plans.every((plan) => plan.selectedRule.targetWindow === "NEXT_AVAILABLE"));
});

test("32 orphan Sunday template is ignored and Monday is used", () => {
  const sunday = "2026-07-19";
  const plan = planned(planProductionCapacity(input({
    planningNow: combineBusinessDateTimeToUtc(sunday, "08:00"),
    quantity: "50",
    quantityRules: [extraRule()],
    normalWindows: [window(1, 1, "17:00", "18:00", "18:00", "100")],
    extraCapacityTemplates: [extra(100, 0), extra(101, 1)],
  })));
  assert.equal(plan.allocationMode, "EXTRA_DAILY");
  assert.equal(plan.allocations[0].productionDate, MONDAY);
  assert.equal(plan.allocations[0].kind === "EXTRA_DAILY" && plan.allocations[0].extraCapacityId, 101);
});

test("33 active normal Sunday allows Sunday EXTRA", () => {
  const sunday = "2026-07-19";
  const plan = planned(planProductionCapacity(input({
    planningNow: combineBusinessDateTimeToUtc(sunday, "08:00"),
    quantity: "50",
    quantityRules: [extraRule()],
    normalWindows: [window(10, 0, "17:00", "18:00", "18:00", "100")],
    extraCapacityTemplates: [extra(100, 0)],
  })));
  assert.equal(plan.allocationMode, "EXTRA_DAILY");
  assert.equal(plan.allocations[0].productionDate, sunday);
});

test("34 small and large items choose NORMAL and EXTRA independently", () => {
  const small = planned(planProductionCapacity(input({
    itemKey: "small",
    quantity: "20",
    quantityRules: [],
    normalWindows: anchors,
    extraCapacityTemplates: [extra(101, 1)],
  })));
  const large = planned(planProductionCapacity(input({
    itemKey: "large",
    quantity: "50",
    quantityRules: [],
    normalWindows: anchors,
    extraCapacityTemplates: [extra(101, 1)],
  })));
  assert.equal(small.allocationMode, "NORMAL_WINDOW");
  assert.equal(large.allocationMode, "EXTRA_DAILY");
});

test("35 only orphan EXTRA templates behave as not configured", () => {
  const plan = planned(planProductionCapacity(input({
    quantity: "50",
    quantityRules: [extraRule()],
    normalWindows: [window(1, 1, "17:00", "18:00", "18:00", "100")],
    extraCapacityTemplates: [extra(100, 0)],
  })));
  assert.equal(plan.allocationMode, "NORMAL_WINDOW");
  assert.ok(plan.evaluations.some((entry) => entry.skippedReason === "extra_not_configured_fallback_normal"));
});

test("36 invalid active Sunday windows do not make Sunday a working day", () => {
  const sunday = "2026-07-19";
  const plan = planned(planProductionCapacity(input({
    planningNow: combineBusinessDateTimeToUtc(sunday, "08:00"),
    quantity: "50",
    quantityRules: [extraRule()],
    normalWindows: [
      window(10, 0, "09:00", "10:00", "10:00", "0"),
      window(11, 0, "09:00", "24:00", "24:00", "100"),
      window(12, 0, "18:00", "17:00", "18:00", "100"),
      window(13, 0, "11:00", "11:00", "10:00", "100"),
      window(20, 1, "17:00", "18:00", "18:00", "100"),
    ],
    extraCapacityTemplates: [extra(100, 0), extra(101, 1)],
  })));
  assert.equal(plan.allocationMode, "EXTRA_DAILY");
  assert.equal(plan.allocations[0].productionDate, MONDAY);
  assert.equal(plan.allocations[0].kind === "EXTRA_DAILY" && plan.allocations[0].extraCapacityId, 101);
});

test("37 implicit EXTRA covers the decimal gap before an explicit NORMAL rule", () => {
  const delayedNormal = { ...normalRule("LAST_OF_DAY", 1), minQty: "50" };
  const gapPlan = planned(planProductionCapacity(input({
    quantity: "49.999",
    quantityRules: [delayedNormal],
    normalWindows: anchors,
    extraCapacityTemplates: [extra(101, 1)],
  })));
  assert.equal(gapPlan.allocationMode, "EXTRA_DAILY");
  assert.equal(gapPlan.selectedRule.selectionSource, "IMPLICIT_EXTRA_THRESHOLD");

  for (const quantity of ["50", "80"]) {
    const normalPlan = planned(planProductionCapacity(input({
      quantity,
      quantityRules: [delayedNormal],
      normalWindows: anchors,
      extraCapacityTemplates: [extra(101, 1), extra(102, 2)],
    })));
    assert.equal(normalPlan.allocationMode, "NORMAL_WINDOW");
    assert.equal(normalPlan.selectedRule.selectionSource, "EXPLICIT_RULE");
    assert.equal(normalPlan.selectedRule.delayBusinessDays, 1);
    assert.equal(normalPlan.selectedRule.targetWindow, "LAST_OF_DAY");
    assert.equal(normalPlan.baseDate, TUESDAY);
  }
});

test("38 an explicit bounded EXTRA rule wins and unmatched quantities return to implicit EXTRA", () => {
  const boundedExtra = extraRule({ minQty: "60", maxQty: "100" });
  const cases = [
    ["50", "IMPLICIT_EXTRA_THRESHOLD"],
    ["60", "EXPLICIT_RULE"],
    ["100", "EXPLICIT_RULE"],
    ["100.001", "IMPLICIT_EXTRA_THRESHOLD"],
  ] as const;

  for (const [quantity, selectionSource] of cases) {
    const plan = planned(planProductionCapacity(input({
      quantity,
      quantityRules: [boundedExtra],
      normalWindows: anchors,
      extraCapacityTemplates: [extra(101, 1, "200")],
    })));
    assert.equal(plan.allocationMode, "EXTRA_DAILY");
    assert.equal(plan.selectedRule.selectionSource, selectionSource);
  }
});

test("39 two quantities above threshold are evaluated separately as EXTRA", () => {
  const normalReservations = new Map<string, Prisma.Decimal>();
  const extraReservations = new Map<string, Prisma.Decimal>();
  const plans = ["A", "B"].map((itemKey) => {
    const plan = planned(planProductionCapacity(input({
      itemKey,
      quantity: "40",
      quantityRules: [],
      normalWindows: anchors,
      extraCapacityTemplates: [extra(101, 1)],
      extraPreviewReservations: extraReservations,
    })));
    applyPreviewReservationDeltas({ plan, normalReservations, extraReservations });
    return plan;
  });

  assert.ok(plans.every((plan) => plan.allocationMode === "EXTRA_DAILY"));
  assert.ok(plans.every((plan) => plan.selectedRule.selectionSource === "IMPLICIT_EXTRA_THRESHOLD"));
  assert.deepEqual(plans.map(quantities), [["40"], ["40"]]);
});

test("40 mixed items independently choose implicit EXTRA and explicit delayed NORMAL", () => {
  const delayedNormal = { ...normalRule("LAST_OF_DAY", 1), minQty: "50" };
  const extraPlan = planned(planProductionCapacity(input({
    itemKey: "40",
    quantity: "40",
    quantityRules: [delayedNormal],
    normalWindows: anchors,
    extraCapacityTemplates: [extra(101, 1)],
  })));
  const normalPlan = planned(planProductionCapacity(input({
    itemKey: "60",
    quantity: "60",
    quantityRules: [delayedNormal],
    normalWindows: anchors,
    extraCapacityTemplates: [extra(101, 1)],
  })));

  assert.equal(extraPlan.allocationMode, "EXTRA_DAILY");
  assert.equal(extraPlan.selectedRule.selectionSource, "IMPLICIT_EXTRA_THRESHOLD");
  assert.equal(normalPlan.allocationMode, "NORMAL_WINDOW");
  assert.equal(normalPlan.selectedRule.selectionSource, "EXPLICIT_RULE");
  assert.equal(normalPlan.selectedRule.delayBusinessDays, 1);
});
