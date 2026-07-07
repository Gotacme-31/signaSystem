import type { Request, Response } from "express";
import { Prisma, UnitType } from "@prisma/client";
import { prisma } from "../lib/prisma";
import {
  addBusinessDays,
  businessDayOfWeek,
  isValidDateKey,
  nextBusinessDayStartUtc,
  startOfBusinessDayUtc,
  todayBusinessDateKey,
} from "../lib/business-time";

const IVA_RATE = 0.16;

function decimalToNumber(value?: Prisma.Decimal | null): number {
  return value?.toNumber?.() ?? 0;
}

function parseBooleanQuery(value: unknown): boolean {
  return String(value ?? "").toLowerCase() === "true" || String(value ?? "") === "1";
}

function parseUnitType(value: unknown): UnitType | undefined {
  return value === "METER" || value === "PIECE" ? value : undefined;
}

function lineAmounts(
  item: { subtotal: Prisma.Decimal; order: { hasIva: boolean } },
  includeIva: boolean
) {
  const subtotal = decimalToNumber(item.subtotal);
  const iva = item.order.hasIva ? subtotal * IVA_RATE : 0;

  return {
    subtotal,
    iva,
    revenue: includeIva ? subtotal + iva : subtotal,
  };
}

async function buildPaymentMethodsFromOrderRevenue(
  orderRevenueById: Map<number, number>,
  orderTotalById: Map<number, number>
) {
  const orderIds = Array.from(orderRevenueById.keys());
  if (orderIds.length === 0) return [];

  const payments = await prisma.orderPayment.findMany({
    where: { orderId: { in: orderIds } },
    select: { orderId: true, method: true, amount: true },
  });

  const byMethod = new Map<string, { method: string; count: number; revenue: number }>();

  for (const payment of payments) {
    const orderRevenue = orderRevenueById.get(payment.orderId) ?? 0;
    const orderTotal = orderTotalById.get(payment.orderId) ?? 0;
    if (orderRevenue <= 0 || orderTotal <= 0) continue;

    const paymentAmount = decimalToNumber(payment.amount);
    const proportionalRevenue = orderRevenue * (paymentAmount / orderTotal);
    const current = byMethod.get(payment.method) ?? {
      method: payment.method,
      count: 0,
      revenue: 0,
    };

    current.count += 1;
    current.revenue += proportionalRevenue;
    byMethod.set(payment.method, current);
  }

  return Array.from(byMethod.values()).sort((a, b) => b.revenue - a.revenue);
}

/** Convierte "YYYY-MM-DD" a Date en inicio del día (zona horaria México) */
function startOfDay(dateStr: string): Date {
  if (!isValidDateKey(dateStr)) throw new Error(`Fecha inválida: ${dateStr}`);
  return startOfBusinessDayUtc(dateStr);
}

/** Convierte "YYYY-MM-DD" a Date en fin del día (incluyente, zona horaria México) */
function endOfDay(dateStr: string): Date {
  if (!isValidDateKey(dateStr)) throw new Error(`Fecha inválida: ${dateStr}`);
  return new Date(nextBusinessDayStartUtc(dateStr).getTime() - 1);
}

/** Devuelve lunes 00:00 a domingo 23:59:59.999 de la semana actual en zona horaria México */
function currentWeekRange() {
  const todayKey = todayBusinessDateKey();
  const day = businessDayOfWeek(todayKey); // 0 dom, 1 lun...
  const diffToMonday = day === 0 ? 6 : day - 1;
  const mondayKey = addBusinessDays(todayKey, -diffToMonday);
  const sundayKey = addBusinessDays(mondayKey, 6);
  const monday = startOfDay(mondayKey);
  const sunday = endOfDay(sundayKey);

  return { monday, sunday, mondayKey, sundayKey };
}

/**
 * GET /api/dashboard/stats
 */
export async function getDashboardStats(req: Request, res: Response) {
  try {
    const {
      startDate,
      endDate,
      branchIds,
      productIds,
      unitType,
      includeIva: includeIvaQuery,
    } = req.query;

    const includeIva = parseBooleanQuery(includeIvaQuery);
    const unitTypeFilter = parseUnitType(unitType);

    // --- Branch IDs multi-select ---
    const branchIdList: number[] = typeof branchIds === "string" && branchIds.trim()
      ? branchIds.split(",").map((x) => parseInt(x.trim(), 10)).filter(Number.isFinite)
      : [];

    // --- Product IDs multi-select ---
    const productIdList: number[] = typeof productIds === "string" && productIds.trim()
      ? productIds.split(",").map((x) => parseInt(x.trim(), 10)).filter(Number.isFinite)
      : [];

    // --- Date range (incluyente por día) ---
    const hasRange = !!startDate || !!endDate;
    let rangeStart: Date | undefined;
    let rangeEnd: Date | undefined;
    
    if (startDate) {
      rangeStart = startOfDay(String(startDate));
    }
    if (endDate) {
      rangeEnd = endOfDay(String(endDate));
    }

    // Si no hay rango, usar hoy por defecto
    if (!hasRange) {
      const todayKey = todayBusinessDateKey();
      rangeStart = startOfDay(todayKey);
      rangeEnd = endOfDay(todayKey);
    }

    // --- “Hoy” y “Semana actual” ---
    const todayStr = todayBusinessDateKey();
    const todayStart = startOfDay(todayStr);
    const todayEnd = endOfDay(todayStr);
    const { monday, sunday, mondayKey, sundayKey } = currentWeekRange();

    // ========== QUICK STATS GLOBALES (sin filtros de sucursal ni producto) ==========
    let globalRevenueToday = 0;
    let globalQuantityToday = 0;
    let globalRevenueWeek = 0;
    let globalQuantityWeek = 0;

    // Filtros solo por fecha (sin sucursales ni productos)
    const globalTodayFilter: Prisma.OrderWhereInput = {
      createdAt: { gte: todayStart, lte: todayEnd }
    };
    const globalWeekFilter: Prisma.OrderWhereInput = {
      createdAt: { gte: monday, lte: sunday }
    };

    // Ingresos hoy global
    const globalRevenueTodayAgg = await prisma.order.aggregate({
      where: globalTodayFilter,
      _sum: { total: true },
    });
    globalRevenueToday = globalRevenueTodayAgg._sum.total?.toNumber?.() ?? 0;

    // Cantidad hoy global (desde items)
    const globalQuantityTodayAgg = await prisma.orderItem.aggregate({
      where: { order: globalTodayFilter },
      _sum: { quantity: true },
    });
    globalQuantityToday = globalQuantityTodayAgg._sum.quantity?.toNumber?.() ?? 0;

    // Ingresos semana global
    const globalRevenueWeekAgg = await prisma.order.aggregate({
      where: globalWeekFilter,
      _sum: { total: true },
    });
    globalRevenueWeek = globalRevenueWeekAgg._sum.total?.toNumber?.() ?? 0;

    // Cantidad semana global
    const globalQuantityWeekAgg = await prisma.orderItem.aggregate({
      where: { order: globalWeekFilter },
      _sum: { quantity: true },
    });
    globalQuantityWeek = globalQuantityWeekAgg._sum.quantity?.toNumber?.() ?? 0;
    // ========== FIN QUICK STATS GLOBALES ==========

    // --- Construir filtros base para órdenes (USANDO createdAt) ---
    const orderDateFilter: Prisma.OrderWhereInput = {};
    if (rangeStart || rangeEnd) {
      const dateFilter: Prisma.DateTimeFilter = {};
      if (rangeStart) dateFilter.gte = rangeStart;
      if (rangeEnd) dateFilter.lte = rangeEnd;
      orderDateFilter.createdAt = dateFilter;
    }

    // Filtro de sucursales para órdenes
    if (branchIdList.length > 0) {
      orderDateFilter.branchId = { in: branchIdList };
    }

    // --- FILTRO PRINCIPAL: Para ingresos totales y conteo de órdenes ---
    let totalRevenue = 0;
    let subtotalRevenue = 0;
    let ivaRevenue = 0;
    let totalOrders = 0;
    let ordersWithIva = 0;
    let ordersWithoutIva = 0;
    // Nota: ya no necesitamos revenueToday, revenueWeek, quantityToday, quantityWeek con filtros,
    // pero los dejamos para no romper cálculos intermedios si se usan en otra parte.
    let revenueToday = 0;
    let revenueWeek = 0;
    let quantityToday = 0;
    let quantityWeek = 0;
    let meters = 0;
    let pieces = 0;
    let ordersByStageData: any[] = [];
    let ordersByPaymentData: any[] = [];
    let ordersByBranchData: any[] = [];
    let topProductsData: any[] = [];
    let recentOrdersData: any[] = [];

    // Si hay filtros de productos, calculamos todo desde OrderItem
    if (productIdList.length > 0 || unitTypeFilter) {
      // Filtro para items
      const itemFilter: Prisma.OrderItemWhereInput = {};
      if (productIdList.length > 0) {
        itemFilter.productId = { in: productIdList };
      }
      if (unitTypeFilter) {
        itemFilter.unitTypeSnapshot = unitTypeFilter;
      }

      // Filtro de fecha para los items (a través de la orden)
      if (rangeStart || rangeEnd || branchIdList.length > 0) {
        const orderWhere: Prisma.OrderWhereInput = {};
        
        if (rangeStart || rangeEnd) {
          orderWhere.createdAt = {};
          if (rangeStart) orderWhere.createdAt.gte = rangeStart;
          if (rangeEnd) orderWhere.createdAt.lte = rangeEnd;
        }
        
        if (branchIdList.length > 0) {
          orderWhere.branchId = { in: branchIdList };
        }
        
        itemFilter.order = orderWhere;
      }

      const filteredItems = await prisma.orderItem.findMany({
        where: itemFilter,
        select: {
          orderId: true,
          productId: true,
          productNameSnapshot: true,
          unitTypeSnapshot: true,
          isCustomProduct: true,
          customProductName: true,
          customUnitType: true,
          quantity: true,
          subtotal: true,
          product: { select: { id: true, name: true, unitType: true } },
          order: {
            select: {
              id: true,
              branchId: true,
              hasIva: true,
              total: true,
            },
          },
        },
      });

      const orderIdsSet = new Set<number>();
      const ordersWithIvaSet = new Set<number>();
      const orderRevenueById = new Map<number, number>();
      const orderTotalById = new Map<number, number>();
      const branchRevenueMap = new Map<number, { branchId: number; orderIds: Set<number>; revenue: number }>();
      const topProductMap = new Map<number, {
        productId: number;
        product: string;
        unitType: UnitType;
        quantity: number;
        revenue: number;
      }>();

      for (const item of filteredItems) {
        const amounts = lineAmounts(item, includeIva);
        const qty = decimalToNumber(item.quantity);
        const itemUnitType = item.isCustomProduct
          ? item.customUnitType ?? item.unitTypeSnapshot
          : item.unitTypeSnapshot;
        const productName = item.isCustomProduct
          ? item.customProductName ?? item.productNameSnapshot
          : item.product?.name ?? item.productNameSnapshot;

        subtotalRevenue += amounts.subtotal;
        ivaRevenue += amounts.iva;
        totalRevenue += amounts.revenue;

        orderIdsSet.add(item.orderId);
        if (item.order.hasIva) ordersWithIvaSet.add(item.orderId);

        orderRevenueById.set(
          item.orderId,
          (orderRevenueById.get(item.orderId) ?? 0) + amounts.revenue
        );
        orderTotalById.set(item.orderId, decimalToNumber(item.order.total));

        if (itemUnitType === "METER") {
          meters += qty;
        } else {
          pieces += qty;
        }

        const topProduct = topProductMap.get(item.productId) ?? {
          productId: item.productId,
          product: productName || "Desconocido",
          unitType: itemUnitType,
          quantity: 0,
          revenue: 0,
        };
        topProduct.quantity += qty;
        topProduct.revenue += amounts.revenue;
        topProductMap.set(item.productId, topProduct);

        const branchRevenue = branchRevenueMap.get(item.order.branchId) ?? {
          branchId: item.order.branchId,
          orderIds: new Set<number>(),
          revenue: 0,
        };
        branchRevenue.orderIds.add(item.orderId);
        branchRevenue.revenue += amounts.revenue;
        branchRevenueMap.set(item.order.branchId, branchRevenue);
      }

      const orderIds = Array.from(orderIdsSet);
      totalOrders = orderIds.length;
      ordersWithIva = ordersWithIvaSet.size;
      ordersWithoutIva = Math.max(0, totalOrders - ordersWithIva);
      topProductsData = Array.from(topProductMap.values())
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 10);
      ordersByBranchData = Array.from(branchRevenueMap.values()).map((x) => ({
        branchId: x.branchId,
        orders: x.orderIds.size,
        revenue: x.revenue,
      }));

      // 9. Órdenes por etapa (contando órdenes únicas)
      if (orderIds.length > 0) {
        const stages = await prisma.order.groupBy({
          by: ["stage"],
          where: { id: { in: orderIds } },
          _count: true,
        });
        ordersByStageData = stages;

        // 10. Métodos de pago proporcionales al total filtrado por producto.
        ordersByPaymentData = await buildPaymentMethodsFromOrderRevenue(
          orderRevenueById,
          orderTotalById
        );

        // 12. Órdenes recientes
        recentOrdersData = await prisma.order.findMany({
          where: { id: { in: orderIds } },
          include: {
            customer: { select: { id: true, name: true, phone: true } },
            branch: { select: { id: true, name: true } },
            pickupBranch: { select: { id: true, name: true } },
            payments: { orderBy: { id: "asc" } },
            items: {
              select: {
                id: true,
                product: { select: { id: true, name: true, unitType: true } },
                quantity: true,
                subtotal: true,
              },
            },
          },
          orderBy: { createdAt: "desc" },
          take: 20,
        });
      }
    } else {
      // Total de órdenes
      totalOrders = await prisma.order.count({ where: orderDateFilter });

      // Total de ingresos
      const revenueAgg = await prisma.order.aggregate({
        where: orderDateFilter,
        _sum: {
          subtotalBeforeTax: true,
          ivaAmount: true,
          total: true,
        },
      });
      subtotalRevenue = decimalToNumber(revenueAgg._sum.subtotalBeforeTax);
      ivaRevenue = decimalToNumber(revenueAgg._sum.ivaAmount);
      totalRevenue = includeIva ? subtotalRevenue + ivaRevenue : subtotalRevenue;

      ordersWithIva = await prisma.order.count({
        where: { ...orderDateFilter, hasIva: true },
      });
      ordersWithoutIva = Math.max(0, totalOrders - ordersWithIva);

      // Ingresos HOY (con filtros) - ya no se usan en la respuesta final
      const revenueTodayAgg = await prisma.order.aggregate({
        where: { 
          ...orderDateFilter, 
          createdAt: { gte: todayStart, lte: todayEnd }
        },
        _sum: { total: true },
      });
      revenueToday = revenueTodayAgg._sum.total?.toNumber?.() ?? 0;

      // Cantidad HOY (desde items) - con filtros
      const quantityTodayAgg = await prisma.orderItem.aggregate({
        where: { 
          order: { 
            ...orderDateFilter, 
            createdAt: { gte: todayStart, lte: todayEnd }
          } 
        },
        _sum: { quantity: true },
      });
      quantityToday = quantityTodayAgg._sum.quantity?.toNumber?.() ?? 0;

      // Ingresos SEMANA (con filtros)
      const revenueWeekAgg = await prisma.order.aggregate({
        where: { 
          ...orderDateFilter, 
          createdAt: { gte: monday, lte: sunday }
        },
        _sum: { total: true },
      });
      revenueWeek = revenueWeekAgg._sum.total?.toNumber?.() ?? 0;

      // Cantidad SEMANA (con filtros)
      const quantityWeekAgg = await prisma.orderItem.aggregate({
        where: { 
          order: { 
            ...orderDateFilter, 
            createdAt: { gte: monday, lte: sunday }
          } 
        },
        _sum: { quantity: true },
      });
      quantityWeek = quantityWeekAgg._sum.quantity?.toNumber?.() ?? 0;

      // Métricas por unidad y top productos. Se calculan desde items para poder
      // sumar IVA proporcional solo cuando el filtro de IVA está activo.
      const itemsWithProducts = await prisma.orderItem.findMany({
        where: { order: orderDateFilter },
        select: {
          productId: true,
          productNameSnapshot: true,
          quantity: true,
          subtotal: true,
          unitTypeSnapshot: true,
          isCustomProduct: true,
          customProductName: true,
          customUnitType: true,
          product: { select: { id: true, name: true, unitType: true } },
          order: { select: { hasIva: true } },
        },
      });

      const topProductMap = new Map<number, {
        productId: number;
        product: string;
        unitType: UnitType;
        quantity: number;
        revenue: number;
      }>();

      for (const item of itemsWithProducts) {
        const qty = decimalToNumber(item.quantity);
        const amounts = lineAmounts(item, includeIva);
        const itemUnitType = item.isCustomProduct
          ? item.customUnitType ?? item.unitTypeSnapshot
          : item.unitTypeSnapshot;
        const productName = item.isCustomProduct
          ? item.customProductName ?? item.productNameSnapshot
          : item.product?.name ?? item.productNameSnapshot;

        if (itemUnitType === "METER") {
          meters += qty;
        } else {
          pieces += qty;
        }

        const topProduct = topProductMap.get(item.productId) ?? {
          productId: item.productId,
          product: productName || "Desconocido",
          unitType: itemUnitType,
          quantity: 0,
          revenue: 0,
        };
        topProduct.quantity += qty;
        topProduct.revenue += amounts.revenue;
        topProductMap.set(item.productId, topProduct);
      }

      topProductsData = Array.from(topProductMap.values())
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 10);

      // Órdenes por etapa
      const stages = await prisma.order.groupBy({
        by: ["stage"],
        where: orderDateFilter,
        _count: true,
      });
      ordersByStageData = stages;

      // Órdenes por método de pago, distribuyendo el subtotal si no se incluye IVA.
      const ordersForPaymentSplit = await prisma.order.findMany({
        where: orderDateFilter,
        select: { id: true, total: true, subtotalBeforeTax: true },
      });

      const orderRevenueById = new Map<number, number>();
      const orderTotalById = new Map<number, number>();
      for (const order of ordersForPaymentSplit) {
        orderRevenueById.set(
          order.id,
          includeIva ? decimalToNumber(order.total) : decimalToNumber(order.subtotalBeforeTax)
        );
        orderTotalById.set(order.id, decimalToNumber(order.total));
      }
      ordersByPaymentData = await buildPaymentMethodsFromOrderRevenue(
        orderRevenueById,
        orderTotalById
      );

      // Órdenes por sucursal
      const branches = await prisma.order.groupBy({
        by: ["branchId"],
        where: orderDateFilter,
        _count: true,
        _sum: { total: true, subtotalBeforeTax: true },
      });
      ordersByBranchData = branches.map((x) => ({
        branchId: x.branchId,
        orders: x._count,
        revenue: includeIva
          ? decimalToNumber(x._sum.total)
          : decimalToNumber(x._sum.subtotalBeforeTax),
      }));

      // Órdenes recientes
      recentOrdersData = await prisma.order.findMany({
        where: orderDateFilter,
        include: {
          customer: { select: { id: true, name: true, phone: true } },
          branch: { select: { id: true, name: true } },
          pickupBranch: { select: { id: true, name: true } },
          payments: { orderBy: { id: "asc" } },
          items: {
            select: {
              id: true,
              product: { select: { id: true, name: true, unitType: true } },
              quantity: true,
              subtotal: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
        take: 20,
      });
    }

    // Mapeo de sucursales
    const branchIdsFromData = ordersByBranchData.map(x => x.branchId);
    const branches = branchIdsFromData.length
      ? await prisma.branch.findMany({
          where: { id: { in: branchIdsFromData } },
          select: { id: true, name: true },
        })
      : [];
    const branchMap = new Map(branches.map(b => [b.id, b.name]));

    const ordersByBranch = ordersByBranchData.map(x => ({
      branchId: x.branchId,
      branch: branchMap.get(x.branchId) ?? "Desconocida",
      orders: x.orders,
      revenue: x.revenue,
    }));

    // Métodos de pago
    const paymentMethods = ordersByPaymentData.map(x => ({
      method: x.method,
      count: x.count,
      revenue: x.revenue,
    }));

    // Etapas
    const stageRecord = ordersByStageData.reduce((acc: Record<string, number>, x: any) => {
      acc[x.stage] = x._count;
      return acc;
    }, {});

    const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;
    const ivaRateApplied = totalOrders > 0 ? (ordersWithIva / totalOrders) * 100 : 0;

    // Datos de clientes
    const customersData = await getCustomersData(
      orderDateFilter,
      branchIdList,
      productIdList,
      unitTypeFilter
    );

    res.json({
      stats: {
        totalOrders,
        totalRevenue,
        subtotalRevenue,
        ivaRevenue,
        ordersWithIva,
        ordersWithoutIva,
        ivaRateApplied,
        avgOrderValue,
        ordersByStage: stageRecord,
        metricsByUnitType: { meters, pieces },
      },

      // quick ahora usa los valores globales (sin filtros)
      quick: {
        today: {
          revenue: globalRevenueToday,
          quantity: globalQuantityToday,
          date: todayStr,
        },
        week: {
          revenue: globalRevenueWeek,
          quantity: globalQuantityWeek,
          from: mondayKey,
          to: sundayKey,
        },
      },

      topProducts: topProductsData,
      ordersByBranch,
      paymentMethods,
      customers: customersData,

      recentOrders: recentOrdersData.map(o => ({
        id: o.id,
        stage: o.stage,
        shippingType: o.shippingType,
        paymentMethod: o.payments?.[0]?.method ?? o.paymentMethod,
        total: o.total.toNumber(),
        deliveryDate: o.deliveryDate,
        deliveryTime: o.deliveryTime,
        customer: o.customer,
        branch: o.branch,
        pickupBranch: o.pickupBranch,
        items: o.items,
        createdAt: o.createdAt,
        updatedAt: o.updatedAt,
      })),
    });
  } catch (error: any) {
    console.error("Error en getDashboardStats:", error);
    res.status(500).json({ error: error?.message || "Error interno del servidor" });
  }
}

/**
 * Obtiene datos de clientes para el dashboard
 */
async function getCustomersData(
  orderFilter: Prisma.OrderWhereInput,
  branchIdList: number[],
  productIdList: number[],
  unitType?: UnitType
) {
  // Fechas para períodos
  const now = new Date();
  const todayKey = todayBusinessDateKey(now);
  const sevenDaysAgo = startOfDay(addBusinessDays(todayKey, -7));
  const thirtyDaysAgo = startOfDay(addBusinessDays(todayKey, -30));

  const toDate = (value: unknown): Date | undefined => {
    if (value instanceof Date) return value;
    if (typeof value === "string" || typeof value === "number") {
      const parsed = new Date(value);
      return Number.isNaN(parsed.getTime()) ? undefined : parsed;
    }
    return undefined;
  };

  const getDateRange = (filter: Prisma.OrderWhereInput) => {
    const createdAt = filter.createdAt;
    if (createdAt instanceof Date) {
      return { rangeStartDate: createdAt, rangeEndDate: createdAt };
    }
    if (createdAt && typeof createdAt === "object" && !Array.isArray(createdAt)) {
      const dateFilter = createdAt as Prisma.DateTimeFilter;
      return {
        rangeStartDate: toDate(dateFilter.gte),
        rangeEndDate: toDate(dateFilter.lte),
      };
    }
    return { rangeStartDate: undefined, rangeEndDate: undefined };
  };

  const withoutDateFilter = (filter: Prisma.OrderWhereInput): Prisma.OrderWhereInput => {
    const { createdAt, ...rest } = filter as Prisma.OrderWhereInput & { createdAt?: unknown };
    return rest;
  };

  const applyItemScope = async (
    baseFilter: Prisma.OrderWhereInput
  ): Promise<Prisma.OrderWhereInput | null> => {
    if (productIdList.length === 0 && !unitType) return baseFilter;

    const itemFilter: Prisma.OrderItemWhereInput = { order: baseFilter };
    if (productIdList.length > 0) itemFilter.productId = { in: productIdList };
    if (unitType) itemFilter.unitTypeSnapshot = unitType;

    const ordersWithProducts = await prisma.orderItem.findMany({
      where: itemFilter,
      select: { orderId: true },
      distinct: ["orderId"],
    });

    const orderIds = ordersWithProducts.map((o) => o.orderId);
    if (orderIds.length === 0) return null;
    return { ...baseFilter, id: { in: orderIds } };
  };

  const countUniqueCustomers = async (filter: Prisma.OrderWhereInput | null) => {
    if (!filter) return 0;
    const rows = await prisma.order.groupBy({
      by: ["customerId"],
      where: filter,
      _count: true,
    });
    return rows.length;
  };

  const getFirstOrderMap = async (filter: Prisma.OrderWhereInput | null) => {
    const firstOrderMap = new Map<number, Date>();
    if (!filter) return firstOrderMap;

    const orders = await prisma.order.findMany({
      where: filter,
      select: {
        customerId: true,
        createdAt: true,
      },
      orderBy: {
        createdAt: "asc",
      },
    });

    for (const order of orders) {
      if (!firstOrderMap.has(order.customerId)) {
        firstOrderMap.set(order.customerId, order.createdAt);
      }
    }

    return firstOrderMap;
  };

  const countFirstOrdersBetween = (
    firstOrderMap: Map<number, Date>,
    start?: Date,
    end?: Date
  ) => {
    let count = 0;
    for (const createdAt of firstOrderMap.values()) {
      if (start && createdAt < start) continue;
      if (end && createdAt > end) continue;
      count += 1;
    }
    return count;
  };

  const { rangeStartDate, rangeEndDate } = getDateRange(orderFilter);
  const scopedFilter = withoutDateFilter(orderFilter);
  const activeRangeFilter = await applyItemScope(orderFilter);
  const activeLast30Filter = await applyItemScope({
    ...scopedFilter,
    createdAt: { gte: thirtyDaysAgo },
  });
  const historicalFilter = await applyItemScope(scopedFilter);

  const activeCustomersInRange = await countUniqueCustomers(activeRangeFilter);
  const activeCustomersLast30 = await countUniqueCustomers(activeLast30Filter);
  const firstOrderMap = await getFirstOrderMap(historicalFilter);
  const newCustomersInRange = countFirstOrdersBetween(firstOrderMap, rangeStartDate, rangeEndDate);
  const newCustomersLast7 = countFirstOrdersBetween(firstOrderMap, sevenDaysAgo, now);
  const newCustomersLast30 = countFirstOrdersBetween(firstOrderMap, thirtyDaysAgo, now);

  // Datos por sucursal
  const branchStats = [];

  const branchesToProcess = branchIdList.length > 0
    ? await prisma.branch.findMany({ where: { id: { in: branchIdList } }, select: { id: true, name: true } })
    : await prisma.branch.findMany({ where: { isActive: true }, select: { id: true, name: true } });

  for (const branch of branchesToProcess) {
    const branchScopedFilter: Prisma.OrderWhereInput = { ...scopedFilter, branchId: branch.id };
    const branchRangeFilter = await applyItemScope({ ...orderFilter, branchId: branch.id });
    const branchLast30Filter = await applyItemScope({
      ...branchScopedFilter,
      createdAt: { gte: thirtyDaysAgo },
    });
    const branchHistoricalFilter = await applyItemScope(branchScopedFilter);
    const branchFirstOrderMap = await getFirstOrderMap(branchHistoricalFilter);

    branchStats.push({
      branchId: branch.id,
      branch: branch.name,
      newCustomersInRange: countFirstOrdersBetween(branchFirstOrderMap, rangeStartDate, rangeEndDate),
      activeCustomersInRange: await countUniqueCustomers(branchRangeFilter),
      newCustomersLast7: countFirstOrdersBetween(branchFirstOrderMap, sevenDaysAgo, now),
      newCustomersLast30: countFirstOrdersBetween(branchFirstOrderMap, thirtyDaysAgo, now),
      activeCustomersLast30: await countUniqueCustomers(branchLast30Filter),
    });
  }

  return {
    totalCustomers: activeCustomersInRange,
    newCustomersLast7,
    newCustomersLast30,
    newCustomersInRange,
    activeCustomersLast30,
    activeCustomersInRange,
    byBranch: branchStats,
  };
}

/**
 * GET /api/dashboard/branches
 */
export async function getBranchesList(req: Request, res: Response) {
  try {
    const branches = await prisma.branch.findMany({
      where: { isActive: true },
      select: { id: true, name: true, isActive: true },
      orderBy: { name: "asc" },
    });
    res.json(branches);
  } catch (error: any) {
    console.error("Error en getBranchesList:", error);
    res.status(500).json({ error: error?.message || "Error interno del servidor" });
  }
}

/**
 * GET /api/dashboard/products
 */
export async function getProductsList(req: Request, res: Response) {
  try {
    const products = await prisma.product.findMany({
      where: { isActive: true },
      select: { id: true, name: true, unitType: true, isActive: true },
      orderBy: { name: "asc" },
    });
    res.json(products);
  } catch (error: any) {
    console.error("Error en getProductsList:", error);
    res.status(500).json({ error: error?.message || "Error interno del servidor" });
  }
}
