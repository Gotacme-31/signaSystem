import { apiFetch } from "./http";
import {
  buildDashboardSearchParams,
  type DashboardQueryFilters,
} from "../lib/dashboardFilters";

export type DashboardFilters = DashboardQueryFilters;

export interface AdvancedFilters {
  startDate?: string;
  endDate?: string;
  branchIds?: number[];
  groupBy: "day" | "week" | "month" | "year";
  metric: "revenue" | "orders" | "quantity";
}

export interface Branch {
  id: number;
  name: string;
  isActive: boolean;
}

export interface Product {
  id: number;
  name: string;
  unitType: "METER" | "PIECE";
  isActive: boolean;
}

export interface DashboardResponse {
  stats: {
    totalOrders: number;
    totalRevenue: number;
    subtotalRevenue: number;
    ivaRevenue: number;
    ordersWithIva: number;
    ordersWithoutIva: number;
    ivaRateApplied: number;
    avgOrderValue: number;
    ordersByStage: Record<string, number>;
    metricsByUnitType: {
      meters: number;
      pieces: number;
    };
  };

  quick: {
    today: {
      revenue: number;
      quantity: number;
      date: string;
    };
    week: {
      revenue: number;
      quantity: number;
      from: string;
      to: string;
    };
  };

  topProducts: Array<{
    productId: number;
    product: string;
    unitType: "METER" | "PIECE";
    quantity: number;
    revenue: number;
  }>;

  ordersByBranch: Array<{
    branchId: number;
    branch: string;
    orders: number;
    revenue: number;
  }>;

  paymentMethods: Array<{
    method: string;
    count: number;
    revenue: number;
  }>;

  customers: {
    totalCustomers: number;
    newCustomersLast7: number;
    newCustomersLast30: number;
    newCustomersInRange: number;
    activeCustomersLast30: number;
    activeCustomersInRange: number;
    byBranch: Array<{
      branchId: number;
      branch: string;
      newCustomersInRange: number;
      activeCustomersInRange: number;
      newCustomersLast7: number;
      newCustomersLast30: number;
      activeCustomersLast30: number;
    }>;
  };

  recentOrders: Array<{
    id: number;
    stage: string;
    shippingType: string;
    paymentMethod: string;
    total: number;
    deliveryDate: string;
    deliveryTime?: string;
    customer: {
      id: number;
      name: string;
      phone: string;
    };
    branch: {
      id: number;
      name: string;
    };
    pickupBranch: {
      id: number;
      name: string;
    };
    items: Array<any>;
    createdAt: string;
    updatedAt: string;
  }>;
}

export async function getDashboardData(filters?: DashboardFilters): Promise<DashboardResponse> {
  const params = buildDashboardSearchParams(filters);
  const queryString = params.toString();
  return apiFetch(`/api/dashboard/stats${queryString ? `?${queryString}` : ""}`);
}

export async function getDashboardBranches(): Promise<Branch[]> {
  return apiFetch("/api/dashboard/branches");
}

export async function getDashboardProducts(
  filters?: DashboardFilters,
  options: { signal?: AbortSignal } = {}
): Promise<Product[]> {
  const params = buildDashboardSearchParams(filters, {
    includeProductIds: false,
    includeIva: false,
  });
  const queryString = params.toString();
  return apiFetch(`/api/dashboard/products${queryString ? `?${queryString}` : ""}`, {
    signal: options.signal,
  });
}

export async function getAdvancedMetrics(filters: AdvancedFilters): Promise<any> {
  const params = new URLSearchParams();

  if (filters.startDate) params.set("startDate", filters.startDate);
  if (filters.endDate) params.set("endDate", filters.endDate);
  if (filters.branchIds?.length) params.set("branchIds", filters.branchIds.join(","));

  params.set("groupBy", filters.groupBy);
  params.set("metric", filters.metric);

  return apiFetch(`/api/dashboard/advanced?${params.toString()}`);
}
