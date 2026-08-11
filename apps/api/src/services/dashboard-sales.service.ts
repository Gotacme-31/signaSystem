import { Prisma, UnitType } from "@prisma/client";
import {
  isValidDateKey,
  nextBusinessDayStartUtc,
  startOfBusinessDayUtc,
  todayBusinessDateKey,
} from "../lib/business-time";

export const DASHBOARD_CANCELLATION_MARKER = "[Cancelado el ";

type QueryValues = Record<string, unknown>;
type DecimalInput = Prisma.Decimal | string | number;

export type DashboardNormalizedFilters = {
  startDate?: string;
  endDate?: string;
  rangeStart?: Date;
  rangeEndExclusive?: Date;
  branchIds: number[];
  productIds: number[];
  unitType?: UnitType;
  includeIva: boolean;
};

export type DashboardSalesItem = {
  id: number;
  orderId: number;
  productId: number;
  productNameSnapshot: string;
  unitTypeSnapshot: UnitType;
  isCustomProduct: boolean;
  customProductName: string | null;
  customUnitType: UnitType | null;
  quantity: DecimalInput;
  subtotal: DecimalInput;
  product: {
    id: number;
    name: string;
    unitType: UnitType;
    isActive?: boolean;
    isCustomProductTemplate?: boolean;
  } | null;
  order: {
    id: number;
    branchId: number;
    hasIva: boolean;
    subtotalBeforeTax: DecimalInput;
    ivaAmount: DecimalInput;
    total: DecimalInput;
    stage: string;
    notes: string | null;
    createdAt: Date;
  };
};

export type DashboardProductOptionSource = Pick<
  DashboardSalesItem,
  | "productId"
  | "productNameSnapshot"
  | "unitTypeSnapshot"
  | "isCustomProduct"
  | "customProductName"
  | "customUnitType"
  | "product"
> & { order: { notes: string | null } };

export type DashboardCatalogProductOptionSource = {
  id: number;
  name: string;
  unitType: UnitType;
  isActive: boolean;
  isCustomProductTemplate: boolean;
};

export class DashboardFilterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DashboardFilterError";
  }
}

function decimal(value: DecimalInput) {
  return new Prisma.Decimal(value);
}

function parseIdList(value: unknown, field: string) {
  if (value === undefined || value === null || value === "") return [];
  if (typeof value !== "string") {
    throw new DashboardFilterError(`${field} debe ser una lista de IDs separados por coma.`);
  }

  const values = value.split(",").map((part) => part.trim()).filter(Boolean);
  const ids = values.map((part) => {
    if (!/^\d+$/.test(part)) {
      throw new DashboardFilterError(`${field} contiene un ID inválido.`);
    }
    const id = Number(part);
    if (!Number.isSafeInteger(id) || id <= 0) {
      throw new DashboardFilterError(`${field} contiene un ID inválido.`);
    }
    return id;
  });

  return Array.from(new Set(ids));
}

function parseDate(value: unknown, field: string) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !isValidDateKey(value)) {
    throw new DashboardFilterError(`${field} debe tener formato YYYY-MM-DD.`);
  }
  return value;
}

function parseBoolean(value: unknown) {
  return String(value ?? "").toLowerCase() === "true" || String(value ?? "") === "1";
}

export function normalizeDashboardFilters(
  query: QueryValues,
  now = new Date()
): DashboardNormalizedFilters {
  let startDate = parseDate(query.startDate, "startDate");
  let endDate = parseDate(query.endDate, "endDate");

  if (!startDate && !endDate) {
    const today = todayBusinessDateKey(now);
    startDate = today;
    endDate = today;
  }
  if (startDate && endDate && startDate > endDate) {
    throw new DashboardFilterError("startDate no puede ser posterior a endDate.");
  }

  const rawUnitType = query.unitType;
  const unitType = rawUnitType === undefined || rawUnitType === ""
    ? undefined
    : rawUnitType === UnitType.METER || rawUnitType === UnitType.PIECE
      ? rawUnitType
      : (() => {
          throw new DashboardFilterError("unitType debe ser METER o PIECE.");
        })();

  return {
    startDate,
    endDate,
    rangeStart: startDate ? startOfBusinessDayUtc(startDate) : undefined,
    rangeEndExclusive: endDate ? nextBusinessDayStartUtc(endDate) : undefined,
    branchIds: parseIdList(query.branchIds, "branchIds"),
    productIds: parseIdList(query.productIds, "productIds"),
    unitType,
    includeIva: parseBoolean(query.includeIva),
  };
}

export function withDashboardDateRange(
  filters: DashboardNormalizedFilters,
  startDate: string,
  endDate: string
): DashboardNormalizedFilters {
  return {
    ...filters,
    startDate,
    endDate,
    rangeStart: startOfBusinessDayUtc(startDate),
    rangeEndExclusive: nextBusinessDayStartUtc(endDate),
  };
}

export function dashboardValidOrderWhere(
  filters: DashboardNormalizedFilters
): Prisma.OrderWhereInput {
  const where: Prisma.OrderWhereInput = {
    OR: [
      { notes: null },
      { notes: { not: { contains: DASHBOARD_CANCELLATION_MARKER } } },
    ],
  };

  if (filters.rangeStart || filters.rangeEndExclusive) {
    where.createdAt = {
      ...(filters.rangeStart ? { gte: filters.rangeStart } : {}),
      ...(filters.rangeEndExclusive ? { lt: filters.rangeEndExclusive } : {}),
    };
  }
  if (filters.branchIds.length > 0) {
    where.branchId = { in: filters.branchIds };
  }
  return where;
}

export function dashboardSalesItemWhere(
  filters: DashboardNormalizedFilters,
  orderWhere = dashboardValidOrderWhere(filters)
): Prisma.OrderItemWhereInput {
  return {
    ...(filters.productIds.length > 0 ? { productId: { in: filters.productIds } } : {}),
    ...(filters.unitType ? { unitTypeSnapshot: filters.unitType } : {}),
    order: orderWhere,
  };
}

export function isDashboardCancelled(notes: string | null | undefined) {
  return notes?.includes(DASHBOARD_CANCELLATION_MARKER) ?? false;
}

export function matchesDashboardFilters(
  item: DashboardSalesItem,
  filters: DashboardNormalizedFilters
) {
  if (isDashboardCancelled(item.order.notes)) return false;
  if (filters.rangeStart && item.order.createdAt < filters.rangeStart) return false;
  if (filters.rangeEndExclusive && item.order.createdAt >= filters.rangeEndExclusive) return false;
  if (filters.branchIds.length > 0 && !filters.branchIds.includes(item.order.branchId)) return false;
  if (filters.productIds.length > 0 && !filters.productIds.includes(item.productId)) return false;
  if (filters.unitType && item.unitTypeSnapshot !== filters.unitType) return false;
  return true;
}

export function filterDashboardSalesItems<T extends DashboardSalesItem>(
  items: readonly T[],
  filters: DashboardNormalizedFilters
) {
  return items.filter((item) => matchesDashboardFilters(item, filters));
}

function productIdentity(item: DashboardProductOptionSource) {
  const isCustomTemplate = item.isCustomProduct || item.product?.isCustomProductTemplate === true;
  return {
    productId: item.productId,
    product: isCustomTemplate
      ? "Producto Libre"
      : item.product?.name ?? item.productNameSnapshot,
    unitType: item.isCustomProduct
      ? item.customUnitType ?? item.unitTypeSnapshot
      : item.unitTypeSnapshot,
    isActive: item.product?.isActive ?? false,
  };
}

export function buildDashboardProductOptions(
  activeProducts: readonly DashboardCatalogProductOptionSource[],
  items: readonly DashboardProductOptionSource[]
) {
  const byProductId = new Map<number, ReturnType<typeof productIdentity>>();
  for (const product of activeProducts) {
    byProductId.set(product.id, {
      productId: product.id,
      product: product.isCustomProductTemplate ? "Producto Libre" : product.name,
      unitType: product.unitType,
      isActive: product.isActive,
    });
  }
  for (const item of items) {
    if (isDashboardCancelled(item.order.notes)) continue;
    if (!byProductId.has(item.productId)) {
      byProductId.set(item.productId, productIdentity(item));
    }
  }
  return Array.from(byProductId.values()).sort((a, b) => {
    const nameCompare = a.product.localeCompare(b.product, "es");
    return nameCompare !== 0 ? nameCompare : a.productId - b.productId;
  });
}

export function aggregateDashboardSales(
  items: readonly DashboardSalesItem[],
  includeIva: boolean
) {
  let subtotalRevenue = new Prisma.Decimal(0);
  let ivaRevenue = new Prisma.Decimal(0);
  let totalRevenue = new Prisma.Decimal(0);
  let meters = new Prisma.Decimal(0);
  let pieces = new Prisma.Decimal(0);
  const orderIds = new Set<number>();
  const ordersWithIva = new Set<number>();
  const orderStages = new Map<number, string>();
  const orderRevenueById = new Map<number, Prisma.Decimal>();
  const orderTotalById = new Map<number, Prisma.Decimal>();
  const products = new Map<number, {
    productId: number;
    product: string;
    unitType: UnitType;
    quantity: Prisma.Decimal;
    revenue: Prisma.Decimal;
  }>();
  const branches = new Map<number, {
    branchId: number;
    orderIds: Set<number>;
    revenue: Prisma.Decimal;
  }>();

  for (const item of items) {
    if (isDashboardCancelled(item.order.notes)) continue;

    const quantity = decimal(item.quantity);
    const subtotal = decimal(item.subtotal);
    const orderSubtotal = decimal(item.order.subtotalBeforeTax);
    const iva = item.order.hasIva && orderSubtotal.gt(0)
      ? decimal(item.order.ivaAmount).mul(subtotal).div(orderSubtotal)
      : new Prisma.Decimal(0);
    const revenue = includeIva ? subtotal.add(iva) : subtotal;
    const identity = productIdentity(item);

    subtotalRevenue = subtotalRevenue.add(subtotal);
    ivaRevenue = ivaRevenue.add(iva);
    totalRevenue = totalRevenue.add(revenue);
    orderIds.add(item.orderId);
    orderStages.set(item.orderId, item.order.stage);
    if (item.order.hasIva) ordersWithIva.add(item.orderId);
    orderRevenueById.set(
      item.orderId,
      (orderRevenueById.get(item.orderId) ?? new Prisma.Decimal(0)).add(revenue)
    );
    orderTotalById.set(item.orderId, decimal(item.order.total));

    if (identity.unitType === UnitType.METER) meters = meters.add(quantity);
    else pieces = pieces.add(quantity);

    const product = products.get(item.productId) ?? {
      productId: item.productId,
      product: identity.product,
      unitType: identity.unitType,
      quantity: new Prisma.Decimal(0),
      revenue: new Prisma.Decimal(0),
    };
    product.quantity = product.quantity.add(quantity);
    product.revenue = product.revenue.add(revenue);
    products.set(item.productId, product);

    const branch = branches.get(item.order.branchId) ?? {
      branchId: item.order.branchId,
      orderIds: new Set<number>(),
      revenue: new Prisma.Decimal(0),
    };
    branch.orderIds.add(item.orderId);
    branch.revenue = branch.revenue.add(revenue);
    branches.set(item.order.branchId, branch);
  }

  const ordersByStage: Record<string, number> = {};
  for (const stage of orderStages.values()) {
    ordersByStage[stage] = (ordersByStage[stage] ?? 0) + 1;
  }

  return {
    totalOrders: orderIds.size,
    subtotalRevenue: subtotalRevenue.toNumber(),
    ivaRevenue: ivaRevenue.toNumber(),
    totalRevenue: totalRevenue.toNumber(),
    ordersWithIva: ordersWithIva.size,
    ordersWithoutIva: Math.max(0, orderIds.size - ordersWithIva.size),
    metricsByUnitType: { meters: meters.toNumber(), pieces: pieces.toNumber() },
    ordersByStage,
    orderIds: Array.from(orderIds),
    orderRevenueById: new Map(
      Array.from(orderRevenueById, ([orderId, revenue]) => [orderId, revenue.toNumber()])
    ),
    orderTotalById: new Map(
      Array.from(orderTotalById, ([orderId, total]) => [orderId, total.toNumber()])
    ),
    topProducts: Array.from(products.values()).map((product) => ({
      ...product,
      quantity: product.quantity.toNumber(),
      revenue: product.revenue.toNumber(),
    })),
    ordersByBranch: Array.from(branches.values()).map((branch) => ({
      branchId: branch.branchId,
      orders: branch.orderIds.size,
      revenue: branch.revenue.toNumber(),
    })),
  };
}
