import type { Request, Response } from "express";
import { Prisma, UnitType } from "@prisma/client";
import { prisma } from "../lib/prisma";
import {
  addBusinessDays,
  businessDayOfWeek,
  todayBusinessDateKey,
} from "../lib/business-time";
import {
  aggregateDashboardSales,
  buildDashboardProductOptions,
  dashboardCustomerOrderWhere,
  dashboardPaymentOrderIdChunks,
  dashboardRecentOrdersQuery,
  DashboardFilterError,
  dashboardSalesItemWhere,
  dashboardValidOrderWhere,
  normalizeDashboardFilters,
  type DashboardNormalizedFilters,
  withDashboardDateRange,
} from "../services/dashboard-sales.service";

type DashboardPaymentRow = {
  orderId: number;
  method: string;
  amount: Prisma.Decimal;
};

type DashboardPaymentLoader = (orderIds: number[]) => Promise<DashboardPaymentRow[]>;

export async function buildPaymentMethodsFromOrderRevenue(
  orderIds: readonly number[],
  orderRevenueById: Map<number, number>,
  orderTotalById: Map<number, number>,
  loadPayments: DashboardPaymentLoader = (ids) => prisma.orderPayment.findMany({
    where: { orderId: { in: ids } },
    select: { orderId: true, method: true, amount: true },
  })
) {
  if (orderIds.length === 0) return [];

  const byMethod = new Map<string, {
    method: string;
    orderIds: Set<number>;
    revenue: number;
  }>();

  // Phase 1 debt: historical order IDs remain materialized only for bounded payment lookups.
  for (const chunk of dashboardPaymentOrderIdChunks(orderIds)) {
    const payments = await loadPayments(chunk);
    for (const payment of payments) {
      const orderRevenue = orderRevenueById.get(payment.orderId) ?? 0;
      const orderTotal = orderTotalById.get(payment.orderId) ?? 0;
      if (orderRevenue <= 0 || orderTotal <= 0) continue;

      const current = byMethod.get(payment.method) ?? {
        method: payment.method,
        orderIds: new Set<number>(),
        revenue: 0,
      };
      current.orderIds.add(payment.orderId);
      current.revenue += orderRevenue * (payment.amount.toNumber() / orderTotal);
      byMethod.set(payment.method, current);
    }
  }

  return Array.from(byMethod.values())
    .map((entry) => ({
      method: entry.method,
      count: entry.orderIds.size,
      revenue: entry.revenue,
    }))
    .sort((a, b) => b.revenue - a.revenue);
}

function currentWeekRange() {
  const todayKey = todayBusinessDateKey();
  const day = businessDayOfWeek(todayKey);
  const diffToMonday = day === 0 ? 6 : day - 1;
  const mondayKey = addBusinessDays(todayKey, -diffToMonday);
  const sundayKey = addBusinessDays(mondayKey, 6);
  return { mondayKey, sundayKey };
}

async function loadDashboardSales(filters: DashboardNormalizedFilters) {
  const items = await prisma.orderItem.findMany({
    where: dashboardSalesItemWhere(filters),
    select: {
      id: true,
      orderId: true,
      productId: true,
      productNameSnapshot: true,
      unitTypeSnapshot: true,
      isCustomProduct: true,
      customProductName: true,
      customUnitType: true,
      quantity: true,
      subtotal: true,
      product: {
        select: {
          id: true,
          name: true,
          unitType: true,
          isActive: true,
          isCustomProductTemplate: true,
        },
      },
      order: {
        select: {
          id: true,
          branchId: true,
          hasIva: true,
          subtotalBeforeTax: true,
          ivaAmount: true,
          total: true,
          stage: true,
          notes: true,
          createdAt: true,
        },
      },
    },
  });
  return aggregateDashboardSales(items, filters.includeIva);
}

function sendDashboardError(res: Response, error: unknown, operation: string) {
  if (error instanceof DashboardFilterError) {
    return res.status(400).json({ error: error.message });
  }
  console.error(`Error en ${operation}:`, error);
  return res.status(500).json({
    error: error instanceof Error ? error.message : "Error interno del servidor",
  });
}

/** GET /api/dashboard/stats */
export async function getDashboardStats(req: Request, res: Response) {
  try {
    const filters = normalizeDashboardFilters(req.query);
    const todayKey = todayBusinessDateKey();
    const { mondayKey, sundayKey } = currentWeekRange();

    const [sales, todaySales, weekSales] = await Promise.all([
      loadDashboardSales(filters),
      loadDashboardSales(withDashboardDateRange(filters, todayKey, todayKey)),
      loadDashboardSales(withDashboardDateRange(filters, mondayKey, sundayKey)),
    ]);

    const [paymentMethods, branchRows, recentOrders, customers] = await Promise.all([
      buildPaymentMethodsFromOrderRevenue(sales.orderIds, sales.orderRevenueById, sales.orderTotalById),
      sales.ordersByBranch.length > 0
        ? prisma.branch.findMany({
            where: { id: { in: sales.ordersByBranch.map((entry) => entry.branchId) } },
            select: { id: true, name: true },
          })
        : Promise.resolve([]),
      prisma.order.findMany(dashboardRecentOrdersQuery(filters)),
      getCustomersData(filters),
    ]);

    const branchMap = new Map(branchRows.map((branch) => [branch.id, branch.name]));
    const totalOrders = sales.totalOrders;

    res.json({
      stats: {
        totalOrders,
        totalRevenue: sales.totalRevenue,
        subtotalRevenue: sales.subtotalRevenue,
        ivaRevenue: sales.ivaRevenue,
        ordersWithIva: sales.ordersWithIva,
        ordersWithoutIva: sales.ordersWithoutIva,
        ivaRateApplied: totalOrders > 0 ? (sales.ordersWithIva / totalOrders) * 100 : 0,
        avgOrderValue: totalOrders > 0 ? sales.totalRevenue / totalOrders : 0,
        ordersByStage: sales.ordersByStage,
        metricsByUnitType: sales.metricsByUnitType,
      },
      quick: {
        today: {
          revenue: todaySales.totalRevenue,
          quantity: todaySales.metricsByUnitType.meters + todaySales.metricsByUnitType.pieces,
          date: todayKey,
        },
        week: {
          revenue: weekSales.totalRevenue,
          quantity: weekSales.metricsByUnitType.meters + weekSales.metricsByUnitType.pieces,
          from: mondayKey,
          to: sundayKey,
        },
      },
      topProducts: sales.topProducts,
      ordersByBranch: sales.ordersByBranch.map((entry) => ({
        ...entry,
        branch: branchMap.get(entry.branchId) ?? "Desconocida",
      })),
      paymentMethods,
      customers,
      recentOrders: recentOrders.map((order) => ({
        id: order.id,
        stage: order.stage,
        shippingType: order.shippingType,
        paymentMethod: order.payments[0]?.method ?? order.paymentMethod,
        total: sales.orderRevenueById.get(order.id) ?? 0,
        deliveryDate: order.deliveryDate,
        deliveryTime: order.deliveryTime,
        customer: order.customer,
        branch: order.branch,
        pickupBranch: order.pickupBranch,
        items: order.items,
        createdAt: order.createdAt,
        updatedAt: order.updatedAt,
      })),
    });
  } catch (error) {
    sendDashboardError(res, error, "getDashboardStats");
  }
}

async function getCustomersData(filters: DashboardNormalizedFilters) {
  const now = new Date();
  const todayKey = todayBusinessDateKey(now);
  const sevenDaysAgo = withDashboardDateRange(filters, addBusinessDays(todayKey, -7), todayKey).rangeStart!;
  const thirtyDaysAgo = withDashboardDateRange(filters, addBusinessDays(todayKey, -30), todayKey).rangeStart!;
  const orderFilter = dashboardValidOrderWhere(filters);

  const withoutDateFilter = (filter: Prisma.OrderWhereInput): Prisma.OrderWhereInput => {
    const { createdAt, ...rest } = filter;
    return rest;
  };
  const countUniqueCustomers = async (filter: Prisma.OrderWhereInput) => {
    const rows = await prisma.order.groupBy({ by: ["customerId"], where: filter, _count: true });
    return rows.length;
  };
  const getFirstOrderMap = async (filter: Prisma.OrderWhereInput) => {
    const firstOrders = new Map<number, Date>();
    const orders = await prisma.order.findMany({
      where: filter,
      select: { customerId: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });
    for (const order of orders) {
      if (!firstOrders.has(order.customerId)) firstOrders.set(order.customerId, order.createdAt);
    }
    return firstOrders;
  };
  const countFirstOrdersBetween = (orders: Map<number, Date>, start?: Date, end?: Date) => {
    let count = 0;
    for (const createdAt of orders.values()) {
      if (start && createdAt < start) continue;
      if (end && createdAt >= end) continue;
      count += 1;
    }
    return count;
  };

  const scopedFilter = withoutDateFilter(orderFilter);
  const activeRangeFilter = dashboardCustomerOrderWhere(filters, orderFilter);
  const activeLast30Filter = dashboardCustomerOrderWhere(filters, {
    ...scopedFilter,
    createdAt: { gte: thirtyDaysAgo },
  });
  const historicalFilter = dashboardCustomerOrderWhere(filters, scopedFilter);
  const firstOrderMap = await getFirstOrderMap(historicalFilter);
  const activeCustomersInRange = await countUniqueCustomers(activeRangeFilter);
  const activeCustomersLast30 = await countUniqueCustomers(activeLast30Filter);
  const branchStats = [];
  const branchRows = filters.branchIds.length > 0
    ? await prisma.branch.findMany({
        where: { id: { in: filters.branchIds } },
        select: { id: true, name: true },
      })
    : await prisma.branch.findMany({ where: { isActive: true }, select: { id: true, name: true } });

  for (const branch of branchRows) {
    const branchScopedFilter = { ...scopedFilter, branchId: branch.id };
    const branchRangeFilter = dashboardCustomerOrderWhere(filters, { ...orderFilter, branchId: branch.id });
    const branchLast30Filter = dashboardCustomerOrderWhere(filters, {
      ...branchScopedFilter,
      createdAt: { gte: thirtyDaysAgo },
    });
    const branchHistoricalFilter = dashboardCustomerOrderWhere(filters, branchScopedFilter);
    const branchFirstOrderMap = await getFirstOrderMap(branchHistoricalFilter);

    branchStats.push({
      branchId: branch.id,
      branch: branch.name,
      newCustomersInRange: countFirstOrdersBetween(
        branchFirstOrderMap,
        filters.rangeStart,
        filters.rangeEndExclusive
      ),
      activeCustomersInRange: await countUniqueCustomers(branchRangeFilter),
      newCustomersLast7: countFirstOrdersBetween(branchFirstOrderMap, sevenDaysAgo, now),
      newCustomersLast30: countFirstOrdersBetween(branchFirstOrderMap, thirtyDaysAgo, now),
      activeCustomersLast30: await countUniqueCustomers(branchLast30Filter),
    });
  }

  return {
    totalCustomers: activeCustomersInRange,
    newCustomersLast7: countFirstOrdersBetween(firstOrderMap, sevenDaysAgo, now),
    newCustomersLast30: countFirstOrdersBetween(firstOrderMap, thirtyDaysAgo, now),
    newCustomersInRange: countFirstOrdersBetween(
      firstOrderMap,
      filters.rangeStart,
      filters.rangeEndExclusive
    ),
    activeCustomersLast30,
    activeCustomersInRange,
    byBranch: branchStats,
  };
}

/** GET /api/dashboard/branches */
export async function getBranchesList(_req: Request, res: Response) {
  try {
    const branches = await prisma.branch.findMany({
      where: { isActive: true },
      select: { id: true, name: true, isActive: true },
      orderBy: { name: "asc" },
    });
    res.json(branches);
  } catch (error) {
    sendDashboardError(res, error, "getBranchesList");
  }
}

/** GET /api/dashboard/products */
export async function getProductsList(req: Request, res: Response) {
  try {
    const filters = { ...normalizeDashboardFilters(req.query), productIds: [] };
    const [activeProducts, historicalItems] = await Promise.all([
      prisma.product.findMany({
        where: { isActive: true },
        select: {
          id: true,
          name: true,
          unitType: true,
          isActive: true,
          isCustomProductTemplate: true,
        },
      }),
      prisma.orderItem.findMany({
        where: dashboardSalesItemWhere(filters),
        distinct: ["productId"],
        select: {
          productId: true,
          productNameSnapshot: true,
          unitTypeSnapshot: true,
          isCustomProduct: true,
          customProductName: true,
          customUnitType: true,
          product: {
            select: {
              id: true,
              name: true,
              unitType: true,
              isActive: true,
              isCustomProductTemplate: true,
            },
          },
          order: { select: { notes: true } },
        },
      }),
    ]);
    res.json(buildDashboardProductOptions(activeProducts, historicalItems).map((product) => ({
      id: product.productId,
      name: product.product,
      unitType: product.unitType,
      isActive: product.isActive,
    })));
  } catch (error) {
    sendDashboardError(res, error, "getProductsList");
  }
}
