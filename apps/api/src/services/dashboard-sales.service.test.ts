import assert from "node:assert/strict";
import test from "node:test";
import { Prisma, UnitType } from "@prisma/client";
import {
  aggregateDashboardSales,
  buildDashboardProductOptions,
  dashboardCustomerOrderWhere,
  dashboardPaymentOrderIdChunks,
  dashboardRecentOrdersQuery,
  dashboardValidOrderWhere,
  filterDashboardSalesItems,
  normalizeDashboardFilters,
  type DashboardSalesItem,
} from "./dashboard-sales.service";

const DAY = "2026-08-10";
const DAY_START = new Date("2026-08-10T06:00:00.000Z");

function salesItem(args: {
  id: number;
  orderId?: number;
  productId?: number;
  quantity?: string;
  subtotal?: string;
  branchId?: number;
  createdAt?: Date;
  notes?: string | null;
  stage?: string;
  name?: string;
  isActive?: boolean;
  unitType?: UnitType;
  hasIva?: boolean;
  orderSubtotal?: string;
  orderIva?: string;
  orderTotal?: string;
}): DashboardSalesItem {
  const productId = args.productId ?? 10;
  const orderId = args.orderId ?? args.id;
  const name = args.name ?? `Producto ${productId}`;
  const unitType = args.unitType ?? UnitType.PIECE;
  return {
    id: args.id,
    orderId,
    productId,
    productNameSnapshot: name,
    unitTypeSnapshot: unitType,
    isCustomProduct: false,
    customProductName: null,
    customUnitType: null,
    quantity: new Prisma.Decimal(args.quantity ?? "1"),
    subtotal: new Prisma.Decimal(args.subtotal ?? "10"),
    product: {
      id: productId,
      name,
      unitType,
      isActive: args.isActive ?? true,
      isCustomProductTemplate: false,
    },
    order: {
      id: orderId,
      branchId: args.branchId ?? 1,
      hasIva: args.hasIva ?? false,
      subtotalBeforeTax: new Prisma.Decimal(args.orderSubtotal ?? args.subtotal ?? "10"),
      ivaAmount: new Prisma.Decimal(args.orderIva ?? "0"),
      total: new Prisma.Decimal(args.orderTotal ?? args.subtotal ?? "10"),
      stage: args.stage ?? "REGISTERED",
      notes: args.notes ?? null,
      createdAt: args.createdAt ?? DAY_START,
    },
  };
}

function filters(query: Record<string, unknown> = {}) {
  return normalizeDashboardFilters({ startDate: DAY, endDate: DAY, ...query });
}

function stats(items: readonly DashboardSalesItem[], query: Record<string, unknown> = {}) {
  const scoped = filterDashboardSalesItems(items, filters(query));
  return aggregateDashboardSales(scoped, false);
}

function productQuantity(result: ReturnType<typeof aggregateDashboardSales>, productId: number) {
  return result.topProducts.find((product) => product.productId === productId)?.quantity ?? 0;
}

test("dashboard sums every variant once and product filtering preserves quantity", () => {
  const items = [
    { ...salesItem({ id: 1, quantity: "1" }), variantId: 101 },
    { ...salesItem({ id: 2, quantity: "4" }), variantId: 102 },
    { ...salesItem({ id: 3, quantity: "5" }), variantId: 103 },
  ];
  assert.equal(productQuantity(stats(items), 10), 10);
  assert.equal(productQuantity(stats(items, { productIds: "10" }), 10), 10);
});

test("product filters preserve independent product totals", () => {
  const items = [
    salesItem({ id: 1, productId: 10, quantity: "10" }),
    salesItem({ id: 2, productId: 20, quantity: "7" }),
  ];
  const unfiltered = stats(items);
  assert.equal(productQuantity(unfiltered, 10), 10);
  assert.equal(productQuantity(unfiltered, 20), 7);
  assert.equal(productQuantity(stats(items, { productIds: "10" }), 10), 10);
  assert.equal(productQuantity(stats(items, { productIds: "20" }), 20), 7);
});

test("registration branch filters use the same semantics with and without product", () => {
  const items = [
    salesItem({ id: 1, productId: 10, branchId: 1, quantity: "10" }),
    salesItem({ id: 2, productId: 10, branchId: 2, quantity: "6" }),
  ];
  assert.equal(productQuantity(stats(items, { branchIds: "1" }), 10), 10);
  assert.equal(productQuantity(stats(items, { branchIds: "2" }), 10), 6);
  assert.equal(productQuantity(stats(items, { branchIds: "1", productIds: "10" }), 10), 10);
  assert.equal(productQuantity(stats(items, { branchIds: "2", productIds: "10" }), 10), 6);
});

test("cancelled orders contribute no quantity, revenue, orders, branches or products", () => {
  const normal = salesItem({ id: 1, orderId: 1, quantity: "10", subtotal: "100" });
  const cancelled = salesItem({
    id: 2,
    orderId: 2,
    quantity: "5",
    subtotal: "50",
    notes: "Observación\n[Cancelado el 2026-08-10]",
  });
  const result = stats([normal, cancelled]);
  assert.equal(productQuantity(result, 10), 10);
  assert.equal(result.totalRevenue, 100);
  assert.equal(result.totalOrders, 1);
  assert.equal(result.ordersByBranch[0]?.orders, 1);
  assert.deepEqual(result.orderIds, [1]);
});

test("inactive historical products remain identifiable and filterable by real productId", () => {
  const historical = salesItem({
    id: 1,
    productId: 30,
    quantity: "8",
    name: "Histórico",
    isActive: false,
  });
  const options = buildDashboardProductOptions([], [historical]);
  assert.deepEqual(options, [{
    productId: 30,
    product: "Histórico",
    unitType: UnitType.PIECE,
    isActive: false,
  }]);
  assert.equal(productQuantity(stats([historical], { productIds: "30" }), 30), 8);
});

test("active catalog products appear once even with zero or existing sales", () => {
  const activeProducts = [
    { id: 10, name: "Con ventas", unitType: UnitType.PIECE, isActive: true, isCustomProductTemplate: false },
    { id: 20, name: "Sin ventas", unitType: UnitType.PIECE, isActive: true, isCustomProductTemplate: false },
  ];
  const soldItem = salesItem({ id: 1, productId: 10, name: "Con ventas" });
  const options = buildDashboardProductOptions(activeProducts, [soldItem]);
  assert.deepEqual(options.map((option) => option.productId), [10, 20]);
  assert.equal(options.filter((option) => option.productId === 10).length, 1);
});

test("cancelled sales do not make an inactive historical product available", () => {
  const cancelledHistorical = salesItem({
    id: 1,
    productId: 30,
    name: "Solo cancelado",
    isActive: false,
    notes: "[Cancelado el 2026-08-10]",
  });
  assert.deepEqual(buildDashboardProductOptions([], [cancelledHistorical]), []);
});

test("product options keep equal names separated by productId", () => {
  const options = buildDashboardProductOptions([
    { id: 10, name: "DTF", unitType: UnitType.PIECE, isActive: true, isCustomProductTemplate: false },
    { id: 15, name: "DTF", unitType: UnitType.PIECE, isActive: true, isCustomProductTemplate: false },
  ], []);
  assert.deepEqual(options.map((option) => option.productId), [10, 15]);
});

test("Producto Libre keeps its stable template name instead of customProductName", () => {
  const customItem = {
    ...salesItem({ id: 1, productId: 68, name: "__PRODUCTO_LIBRE__" }),
    isCustomProduct: true,
    customProductName: "Termo 40 oz",
    productNameSnapshot: "Termo 40 oz",
    product: {
      id: 68,
      name: "__PRODUCTO_LIBRE__",
      unitType: UnitType.PIECE,
      isActive: true,
      isCustomProductTemplate: true,
    },
  };
  const options = buildDashboardProductOptions([
    {
      id: 68,
      name: "__PRODUCTO_LIBRE__",
      unitType: UnitType.PIECE,
      isActive: true,
      isCustomProductTemplate: true,
    },
  ], [customItem]);
  assert.deepEqual(options, [{
    productId: 68,
    product: "Producto Libre",
    unitType: UnitType.PIECE,
    isActive: true,
  }]);
  assert.equal(aggregateDashboardSales([customItem], false).topProducts[0]?.product, "Producto Libre");
});

test("different product IDs never merge even when names match", () => {
  const result = stats([
    salesItem({ id: 1, productId: 10, name: "DTF", quantity: "4" }),
    salesItem({ id: 2, productId: 15, name: "DTF", quantity: "6" }),
  ]);
  assert.equal(result.topProducts.length, 2);
  assert.equal(productQuantity(result, 10), 4);
  assert.equal(productQuantity(result, 15), 6);
});

test("Mexico City day uses inclusive start and exclusive next-day start", () => {
  const items = [
    salesItem({ id: 1, createdAt: new Date("2026-08-10T05:59:59.999Z") }),
    salesItem({ id: 2, createdAt: new Date("2026-08-10T06:00:00.000Z") }),
    salesItem({ id: 3, createdAt: new Date("2026-08-11T05:59:59.999Z") }),
    salesItem({ id: 4, createdAt: new Date("2026-08-11T06:00:00.000Z") }),
  ];
  assert.deepEqual(filterDashboardSalesItems(items, filters()).map((item) => item.id), [2, 3]);
  const normalized = filters();
  assert.equal(normalized.rangeStart?.toISOString(), "2026-08-10T06:00:00.000Z");
  assert.equal(normalized.rangeEndExclusive?.toISOString(), "2026-08-11T06:00:00.000Z");
  assert.deepEqual(dashboardValidOrderWhere(normalized).createdAt, {
    gte: normalized.rangeStart,
    lt: normalized.rangeEndExclusive,
  });
});

test("combined date, branch and product filters return their exact intersection", () => {
  const items = [
    salesItem({ id: 1, branchId: 1, productId: 10, quantity: "2" }),
    salesItem({ id: 2, branchId: 1, productId: 20, quantity: "3" }),
    salesItem({ id: 3, branchId: 2, productId: 10, quantity: "4" }),
    salesItem({ id: 4, branchId: 1, productId: 10, quantity: "5", createdAt: new Date("2026-08-11T06:00:00.000Z") }),
  ];
  const result = stats(items, { branchIds: "1", productIds: "10" });
  assert.equal(result.totalOrders, 1);
  assert.equal(productQuantity(result, 10), 2);
});

test("every returned product satisfies the product-filter invariant", () => {
  const items = [
    salesItem({ id: 1, orderId: 1, branchId: 1, productId: 10, quantity: "2" }),
    salesItem({ id: 2, orderId: 2, branchId: 1, productId: 10, quantity: "3" }),
    salesItem({ id: 3, orderId: 3, branchId: 1, productId: 20, quantity: "7" }),
  ];
  const base = stats(items, { branchIds: "1" });
  for (const product of base.topProducts) {
    const filtered = stats(items, { branchIds: "1", productIds: String(product.productId) });
    assert.equal(productQuantity(filtered, product.productId), product.quantity);
    assert.equal(filtered.totalRevenue, product.revenue);
  }
});

test("stored order IVA is allocated proportionally with the same rule for every product filter", () => {
  const commonOrder = {
    orderId: 1,
    hasIva: true,
    orderSubtotal: "100",
    orderIva: "16",
    orderTotal: "116",
  };
  const items = [
    salesItem({ id: 1, productId: 10, subtotal: "25", ...commonOrder }),
    salesItem({ id: 2, productId: 20, subtotal: "75", ...commonOrder }),
  ];
  const allItems = aggregateDashboardSales(filterDashboardSalesItems(items, filters()), true);
  const productA = aggregateDashboardSales(
    filterDashboardSalesItems(items, filters({ productIds: "10" })),
    true
  );
  assert.equal(allItems.totalRevenue, 116);
  assert.equal(allItems.ivaRevenue, 16);
  assert.equal(productQuantity(allItems, 10), productQuantity(productA, 10));
  assert.equal(allItems.topProducts.find((product) => product.productId === 10)?.revenue, 29);
  assert.equal(productA.totalRevenue, 29);
});

test("production allocation rows cannot change dashboard quantity", () => {
  const itemWithProductionData = {
    ...salesItem({ id: 1, quantity: "10" }),
    productionBatchItems: [
      { quantityAssigned: "2" },
      { quantityAssigned: "3" },
      { quantityAssigned: "5" },
    ],
  };
  const result = stats([itemWithProductionData]);
  assert.equal(productQuantity(result, 10), 10);
});

test("ID filters are normalized once, deduplicated and strictly validated", () => {
  const normalized = filters({ branchIds: "2,1,2", productIds: "10,10" });
  assert.deepEqual(normalized.branchIds, [2, 1]);
  assert.deepEqual(normalized.productIds, [10]);
  assert.throws(() => filters({ productIds: "10abc" }), /ID inválido/);
  assert.throws(() => filters({ branchIds: "0" }), /ID inválido/);
});

test("recent orders query is relational, bounded and deterministically ordered", () => {
  const query = dashboardRecentOrdersQuery(filters()) as any;
  assert.equal(query.where.id, undefined);
  assert.deepEqual(query.where.items, { some: {} });
  assert.deepEqual(query.select.items.where, {});
  assert.equal(query.take, 20);
  assert.deepEqual(query.orderBy, [{ createdAt: "desc" }, { id: "desc" }]);
  assert.deepEqual(query.select.customer, { select: { id: true, name: true, phone: true } });
  assert.deepEqual(query.select.payments, {
    orderBy: { id: "asc" },
    select: { method: true },
  });
});

test("recent orders apply branch, product and unit filters without historical order IDs", () => {
  const scoped = filters({ branchIds: "2", productIds: "10,20", unitType: "PIECE" });
  const query = dashboardRecentOrdersQuery(scoped) as any;
  assert.deepEqual(query.where.branchId, { in: [2] });
  assert.deepEqual(query.where.items.some, {
    productId: { in: [10, 20] },
    unitTypeSnapshot: UnitType.PIECE,
  });
  assert.deepEqual(query.select.items.where, query.where.items.some);
  assert.equal(query.where.id, undefined);
  assert.ok(Array.isArray(query.where.OR));
});

test("a conceptual 32768-order history cannot enter the recent-orders query", () => {
  const conceptualHistoricalOrderIds = Array.from({ length: 32_768 }, (_, index) => index + 1);
  const query = dashboardRecentOrdersQuery(filters()) as any;
  assert.equal(query.where.id, undefined);
  assert.equal(
    JSON.stringify(query).includes(String(conceptualHistoricalOrderIds[conceptualHistoricalOrderIds.length - 1])),
    false
  );
  assert.equal(query.take, 20);
});

test("customer item scope uses a relation and preserves historical date semantics", () => {
  const scoped = filters({ branchIds: "2", productIds: "10", unitType: "METER" });
  const activeFilter = dashboardValidOrderWhere(scoped);
  const active = dashboardCustomerOrderWhere(scoped, activeFilter) as any;
  assert.deepEqual(active.createdAt, activeFilter.createdAt);
  assert.deepEqual(active.branchId, { in: [2] });
  assert.deepEqual(active.items, {
    some: { productId: { in: [10] }, unitTypeSnapshot: UnitType.METER },
  });
  assert.equal(active.id, undefined);

  const { createdAt: _removedDate, ...historicalBase } = activeFilter;
  const historical = dashboardCustomerOrderWhere(scoped, historicalBase) as any;
  assert.equal(historical.createdAt, undefined);
  assert.deepEqual(historical.items, active.items);
});

test("customer metrics without item filters preserve the original order scope", () => {
  const unscoped = filters({ branchIds: "1" });
  const base = dashboardValidOrderWhere(unscoped);
  assert.equal(dashboardCustomerOrderWhere(unscoped, base), base);
});

test("payment chunks are bounded at 5000 for histories beyond the bind limit", () => {
  const chunks = dashboardPaymentOrderIdChunks(Array.from({ length: 32_768 }, (_, index) => index + 1));
  assert.deepEqual(chunks.map((chunk) => chunk.length), [5_000, 5_000, 5_000, 5_000, 5_000, 5_000, 2_768]);
  assert.ok(chunks.every((chunk) => chunk.length <= 5_000));
  assert.deepEqual(chunks.flat(), Array.from({ length: 32_768 }, (_, index) => index + 1));
});
