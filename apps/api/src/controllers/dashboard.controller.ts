import type { Request, Response } from "express";
import { Prisma, UnitType } from "@prisma/client";
import { prisma } from "../lib/prisma";

/** Convierte "YYYY-MM-DD" a Date en inicio del día (zona horaria México) */
function startOfDay(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00-06:00`);
}

/** Convierte "YYYY-MM-DD" a Date en fin del día (incluyente, zona horaria México) */
function endOfDay(dateStr: string): Date {
  return new Date(`${dateStr}T23:59:59-06:00`);
}

/** Devuelve lunes 00:00 a domingo 23:59:59.999 de la semana actual en zona horaria México */
function currentWeekRange() {
  const now = new Date();
  const day = now.getDay(); // 0 dom, 1 lun...
  const diffToMonday = day === 0 ? 6 : day - 1;
  const monday = new Date(now);
  monday.setDate(now.getDate() - diffToMonday);
  monday.setHours(0, 0, 0, 0);

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);

  return { monday, sunday };
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
    } = req.query;

    console.log("Filtros recibidos:", { startDate, endDate, branchIds, productIds, unitType });

    // --- Branch IDs multi-select ---
    const branchIdList: number[] = typeof branchIds === "string" && branchIds.trim()
      ? branchIds.split(",").map((x) => parseInt(x.trim(), 10)).filter(Number.isFinite)
      : [];

    // --- Product IDs multi-select ---
    const productIdList: number[] = typeof productIds === "string" && productIds.trim()
      ? productIds.split(",").map((x) => parseInt(x.trim(), 10)).filter(Number.isFinite)
      : [];

    console.log("Branch IDs:", branchIdList);
    console.log("Product IDs:", productIdList);

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
      const today = new Date();
      rangeStart = startOfDay(today.toISOString().split('T')[0]);
      rangeEnd = endOfDay(today.toISOString().split('T')[0]);
    }

    console.log("Rango de fechas:", { rangeStart, rangeEnd });

    // --- “Hoy” y “Semana actual” ---
    const todayStr = new Date().toISOString().slice(0, 10);
    const todayStart = startOfDay(todayStr);
    const todayEnd = endOfDay(todayStr);
    const { monday, sunday } = currentWeekRange();

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
    let totalOrders = 0;
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
    if (productIdList.length > 0 || unitType) {
      console.log("Calculando desde OrderItem por filtros de productos");
      
      // Filtro para items
      const itemFilter: Prisma.OrderItemWhereInput = {};
      if (productIdList.length > 0) {
        itemFilter.productId = { in: productIdList };
      }
      if (unitType) {
        itemFilter.unitTypeSnapshot = unitType as UnitType;
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

      // 1. Total de ingresos (suma de subtotales de items filtrados)
      const revenueAgg = await prisma.orderItem.aggregate({
        where: itemFilter,
        _sum: { subtotal: true },
      });
      totalRevenue = revenueAgg._sum.subtotal?.toNumber?.() ?? 0;

      // 2. Total de órdenes únicas que tienen estos items
      const uniqueOrders = await prisma.orderItem.findMany({
        where: itemFilter,
        select: { orderId: true },
        distinct: ['orderId'],
      });
      totalOrders = uniqueOrders.length;

      // 3. Ingresos HOY (con filtros) - ya no se usan en la respuesta final
      const todayItemFilter: Prisma.OrderItemWhereInput = {
        ...itemFilter,
        order: {
          ...(itemFilter.order as Prisma.OrderWhereInput || {}),
          createdAt: { gte: todayStart, lte: todayEnd }
        }
      };
      
      const revenueTodayAgg = await prisma.orderItem.aggregate({
        where: todayItemFilter,
        _sum: { subtotal: true },
      });
      revenueToday = revenueTodayAgg._sum.subtotal?.toNumber?.() ?? 0;

      // 4. Cantidad HOY (con filtros)
      const quantityTodayAgg = await prisma.orderItem.aggregate({
        where: todayItemFilter,
        _sum: { quantity: true },
      });
      quantityToday = quantityTodayAgg._sum.quantity?.toNumber?.() ?? 0;

      // 5. Ingresos SEMANA (con filtros)
      const weekItemFilter: Prisma.OrderItemWhereInput = {
        ...itemFilter,
        order: {
          ...(itemFilter.order as Prisma.OrderWhereInput || {}),
          createdAt: { gte: monday, lte: sunday }
        }
      };
      
      const revenueWeekAgg = await prisma.orderItem.aggregate({
        where: weekItemFilter,
        _sum: { subtotal: true },
      });
      revenueWeek = revenueWeekAgg._sum.subtotal?.toNumber?.() ?? 0;

      // 6. Cantidad SEMANA (con filtros)
      const quantityWeekAgg = await prisma.orderItem.aggregate({
        where: weekItemFilter,
        _sum: { quantity: true },
      });
      quantityWeek = quantityWeekAgg._sum.quantity?.toNumber?.() ?? 0;

      // 7. Métricas por unidad (metros/piezas)
      const itemsWithProducts = await prisma.orderItem.findMany({
        where: itemFilter,
        include: {
          product: {
            select: { unitType: true }
          }
        }
      });

      for (const item of itemsWithProducts) {
        const qty = item.quantity.toNumber();
        if (item.product?.unitType === "METER") {
          meters += qty;
        } else {
          pieces += qty;
        }
      }

      // 8. Top productos
      const topProductsGrouped = await prisma.orderItem.groupBy({
        by: ["productId"],
        where: itemFilter,
        _sum: { quantity: true, subtotal: true },
        orderBy: { _sum: { subtotal: "desc" } },
        take: 10,
      });

      const topProductIds = topProductsGrouped.map(x => x.productId);
      const productsForTop = topProductIds.length
        ? await prisma.product.findMany({
            where: { id: { in: topProductIds } },
            select: { id: true, name: true, unitType: true },
          })
        : [];
      const productMap = new Map(productsForTop.map(p => [p.id, p]));

      topProductsData = topProductsGrouped.map(x => {
        const p = productMap.get(x.productId);
        return {
          productId: p?.id,
          product: p?.name ?? "Desconocido",
          unitType: p?.unitType ?? "PIECE",
          quantity: x._sum.quantity?.toNumber?.() ?? 0,
          revenue: x._sum.subtotal?.toNumber?.() ?? 0,
        };
      });

      // 9. Órdenes por etapa (contando órdenes únicas)
      const orderIds = uniqueOrders.map(o => o.orderId);
      if (orderIds.length > 0) {
        const stages = await prisma.order.groupBy({
          by: ["stage"],
          where: { id: { in: orderIds } },
          _count: true,
        });
        ordersByStageData = stages;

        // 10. Órdenes por método de pago
        const payments = await prisma.order.groupBy({
          by: ["paymentMethod"],
          where: { id: { in: orderIds } },
          _count: true,
          _sum: { total: true },
        });
        ordersByPaymentData = payments;

        // 11. Órdenes por sucursal
        const branches = await prisma.order.groupBy({
          by: ["branchId"],
          where: { id: { in: orderIds } },
          _count: true,
          _sum: { total: true },
        });
        ordersByBranchData = branches;

        // 12. Órdenes recientes
        recentOrdersData = await prisma.order.findMany({
          where: { id: { in: orderIds } },
          include: {
            customer: { select: { id: true, name: true, phone: true } },
            branch: { select: { id: true, name: true } },
            pickupBranch: { select: { id: true, name: true } },
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
      // Sin filtros de productos, calculamos todo desde Order (más eficiente)
      console.log("Calculando desde Order sin filtros de productos");
      
      // Total de órdenes
      totalOrders = await prisma.order.count({ where: orderDateFilter });

      // Total de ingresos
      const revenueAgg = await prisma.order.aggregate({
        where: orderDateFilter,
        _sum: { total: true },
      });
      totalRevenue = revenueAgg._sum.total?.toNumber?.() ?? 0;

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

      // Métricas por unidad
      const itemsWithProducts = await prisma.orderItem.findMany({
        where: { order: orderDateFilter },
        include: {
          product: {
            select: { unitType: true }
          }
        }
      });

      for (const item of itemsWithProducts) {
        const qty = item.quantity.toNumber();
        if (item.product?.unitType === "METER") {
          meters += qty;
        } else {
          pieces += qty;
        }
      }

      // Top productos
      const topProductsGrouped = await prisma.orderItem.groupBy({
        by: ["productId"],
        where: { order: orderDateFilter },
        _sum: { quantity: true, subtotal: true },
        orderBy: { _sum: { subtotal: "desc" } },
        take: 10,
      });

      const topProductIds = topProductsGrouped.map(x => x.productId);
      const productsForTop = topProductIds.length
        ? await prisma.product.findMany({
            where: { id: { in: topProductIds } },
            select: { id: true, name: true, unitType: true },
          })
        : [];
      const productMap = new Map(productsForTop.map(p => [p.id, p]));

      topProductsData = topProductsGrouped.map(x => {
        const p = productMap.get(x.productId);
        return {
          productId: p?.id,
          product: p?.name ?? "Desconocido",
          unitType: p?.unitType ?? "PIECE",
          quantity: x._sum.quantity?.toNumber?.() ?? 0,
          revenue: x._sum.subtotal?.toNumber?.() ?? 0,
        };
      });

      // Órdenes por etapa
      const stages = await prisma.order.groupBy({
        by: ["stage"],
        where: orderDateFilter,
        _count: true,
      });
      ordersByStageData = stages;

      // Órdenes por método de pago
      const payments = await prisma.order.groupBy({
        by: ["paymentMethod"],
        where: orderDateFilter,
        _count: true,
        _sum: { total: true },
      });
      ordersByPaymentData = payments;

      // Órdenes por sucursal
      const branches = await prisma.order.groupBy({
        by: ["branchId"],
        where: orderDateFilter,
        _count: true,
        _sum: { total: true },
      });
      ordersByBranchData = branches;

      // Órdenes recientes
      recentOrdersData = await prisma.order.findMany({
        where: orderDateFilter,
        include: {
          customer: { select: { id: true, name: true, phone: true } },
          branch: { select: { id: true, name: true } },
          pickupBranch: { select: { id: true, name: true } },
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

    console.log("Resultados calculados (filtrados):", {
      totalOrders,
      totalRevenue,
      revenueToday,
      revenueWeek,
      quantityToday,
      quantityWeek,
      meters,
      pieces,
    });

    // --- Procesar datos para la respuesta ---

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
      orders: x._count,
      revenue: x._sum?.total?.toNumber?.() ?? 0,
    }));

    // Métodos de pago
    const paymentMethods = ordersByPaymentData.map(x => ({
      method: x.paymentMethod,
      count: x._count,
      revenue: x._sum?.total?.toNumber?.() ?? 0,
    }));

    // Etapas
    const stageRecord = ordersByStageData.reduce((acc: Record<string, number>, x: any) => {
      acc[x.stage] = x._count;
      return acc;
    }, {});

    const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

    // Datos de clientes
    const customersData = await getCustomersData(
      orderDateFilter,
      branchIdList,
      productIdList,
      unitType as UnitType | undefined
    );

    res.json({
      stats: {
        totalOrders,
        totalRevenue,
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
          from: monday.toISOString().slice(0, 10),
          to: sunday.toISOString().slice(0, 10),
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
        paymentMethod: o.paymentMethod,
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
  const sevenDaysAgo = new Date(now);
  sevenDaysAgo.setDate(now.getDate() - 7);
  sevenDaysAgo.setHours(0, 0, 0, 0);

  const thirtyDaysAgo = new Date(now);
  thirtyDaysAgo.setDate(now.getDate() - 30);
  thirtyDaysAgo.setHours(0, 0, 0, 0);

  // Construir filtro final para órdenes
  let finalOrderFilter = { ...orderFilter };

  // Si hay filtros de productos, necesitamos filtrar las órdenes que contienen esos productos
  if (productIdList.length > 0 || unitType) {
    const itemFilter: Prisma.OrderItemWhereInput = {};
    if (productIdList.length > 0) itemFilter.productId = { in: productIdList };
    if (unitType) itemFilter.unitTypeSnapshot = unitType;
    
    const ordersWithProducts = await prisma.orderItem.findMany({
      where: {
        ...itemFilter,
        order: orderFilter
      },
      select: { orderId: true },
      distinct: ['orderId']
    });
    
    const orderIds = ordersWithProducts.map(o => o.orderId);
    if (orderIds.length > 0) {
      finalOrderFilter.id = { in: orderIds };
    } else {
      return {
        totalCustomers: 0,
        newCustomersLast7: 0,
        newCustomersLast30: 0,
        newCustomersInRange: 0,
        activeCustomersLast30: 0,
        activeCustomersInRange: 0,
        byBranch: [],
      };
    }
  }

  // Clientes únicos en el rango seleccionado
  const customersInRange = await prisma.order.groupBy({
    by: ["customerId"],
    where: finalOrderFilter,
    _count: true,
  });

  // Clientes únicos en los últimos 7 días
  const customersLast7 = await prisma.order.groupBy({
    by: ["customerId"],
    where: {
      ...finalOrderFilter,
      createdAt: { gte: sevenDaysAgo },
    },
    _count: true,
  });

  // Clientes únicos en los últimos 30 días (activos)
  const customersLast30 = await prisma.order.groupBy({
    by: ["customerId"],
    where: {
      ...finalOrderFilter,
      createdAt: { gte: thirtyDaysAgo },
    },
    _count: true,
  });

  // Obtener la fecha de inicio del rango
  let rangeStartDate: Date | undefined;
  if (finalOrderFilter.createdAt && typeof finalOrderFilter.createdAt === 'object' && 'gte' in finalOrderFilter.createdAt) {
    rangeStartDate = finalOrderFilter.createdAt.gte as Date;
  }

  // Clientes nuevos (primer pedido) en el rango
  const allOrders = await prisma.order.findMany({
    where: finalOrderFilter,
    select: {
      customerId: true,
      createdAt: true,
    },
    orderBy: {
      createdAt: 'asc',
    },
  });

  // Crear un mapa del primer pedido de cada cliente
  const firstOrderMap = new Map<number, Date>();
  allOrders.forEach(order => {
    if (!firstOrderMap.has(order.customerId)) {
      firstOrderMap.set(order.customerId, order.createdAt);
    }
  });

  const newCustomerIds = Array.from(firstOrderMap.entries())
    .filter(([_, createdAt]) => {
      if (!rangeStartDate) return true;
      return createdAt >= rangeStartDate;
    })
    .map(([customerId]) => customerId);

  // Datos por sucursal
  const branchStats = [];

  const branchesToProcess = branchIdList.length > 0 
    ? await prisma.branch.findMany({ where: { id: { in: branchIdList } }, select: { id: true, name: true } })
    : await prisma.branch.findMany({ where: { isActive: true }, select: { id: true, name: true } });

  for (const branch of branchesToProcess) {
    const branchWhere: Prisma.OrderWhereInput = { ...finalOrderFilter, branchId: branch.id };
    
    // Clientes en rango para esta sucursal
    const customersInBranchRange = await prisma.order.groupBy({
      by: ["customerId"],
      where: branchWhere,
      _count: true,
    });

    // Clientes últimos 7 días
    const customersLast7Branch = await prisma.order.groupBy({
      by: ["customerId"],
      where: { ...branchWhere, createdAt: { gte: sevenDaysAgo } },
      _count: true,
    });

    // Clientes últimos 30 días
    const customersLast30Branch = await prisma.order.groupBy({
      by: ["customerId"],
      where: { ...branchWhere, createdAt: { gte: thirtyDaysAgo } },
      _count: true,
    });

    // Clientes nuevos en rango
    const branchOrders = await prisma.order.findMany({
      where: branchWhere,
      select: {
        customerId: true,
        createdAt: true,
      },
      orderBy: {
        createdAt: 'asc',
      },
    });

    const branchFirstOrderMap = new Map<number, Date>();
    branchOrders.forEach(order => {
      if (!branchFirstOrderMap.has(order.customerId)) {
        branchFirstOrderMap.set(order.customerId, order.createdAt);
      }
    });

    const newInBranch = Array.from(branchFirstOrderMap.entries())
      .filter(([_, createdAt]) => {
        if (!rangeStartDate) return true;
        return createdAt >= rangeStartDate;
      })
      .length;

    branchStats.push({
      branchId: branch.id,
      branch: branch.name,
      newCustomersInRange: newInBranch,
      activeCustomersInRange: customersInBranchRange.length,
      newCustomersLast7: customersLast7Branch.length,
      newCustomersLast30: customersLast30Branch.length,
      activeCustomersLast30: customersLast30Branch.length,
    });
  }

  return {
    totalCustomers: customersInRange.length,
    newCustomersLast7: customersLast7.length,
    newCustomersLast30: customersLast30.length,
    newCustomersInRange: newCustomerIds.length,
    activeCustomersLast30: customersLast30.length,
    activeCustomersInRange: customersInRange.length,
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