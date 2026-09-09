import {
  addBusinessDays,
  safeDateKey,
  todayBusinessDateKey,
} from "./businessTime";

export type ActiveOrdersDeliveryFilter = "ALL" | "TODAY" | "TOMORROW" | "EXACT";

type SearchableActiveOrder = {
  id: number;
  deliveryDate?: string | Date | null;
  notes?: string | null;
  customer?: { name?: string | null; phone?: string | null } | null;
  branch?: { name?: string | null } | null;
  pickupBranch?: { name?: string | null } | null;
  items?: Array<{
    product?: { name?: string | null } | null;
  }>;
};

export function normalizeActiveOrderSearch(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function filterActiveOrders<T extends SearchableActiveOrder>(
  orders: readonly T[],
  filters: {
    query: string;
    deliveryFilter: ActiveOrdersDeliveryFilter;
    exactDay: string;
  }
) {
  let filtered = [...orders];
  const today = todayBusinessDateKey();

  if (filters.deliveryFilter === "TODAY") {
    filtered = filtered.filter((order) => safeDateKey(order.deliveryDate) === today);
  } else if (filters.deliveryFilter === "TOMORROW") {
    const tomorrow = addBusinessDays(today, 1);
    filtered = filtered.filter((order) => safeDateKey(order.deliveryDate) === tomorrow);
  } else if (filters.deliveryFilter === "EXACT" && filters.exactDay) {
    filtered = filtered.filter((order) => safeDateKey(order.deliveryDate) === filters.exactDay);
  }

  const query = normalizeActiveOrderSearch(filters.query);
  if (!query) return filtered;

  return filtered.filter((order) => {
    const haystack = normalizeActiveOrderSearch([
      `pedido ${order.id}`,
      `#${order.id}`,
      order.customer?.name,
      order.customer?.phone,
      order.branch?.name,
      order.pickupBranch?.name,
      order.items?.map((item) => item.product?.name ?? "").join(" "),
      order.notes,
    ].join(" | "));

    return haystack.includes(query);
  });
}

export function clampActiveOrdersPage(currentPage: number, totalPages: number) {
  return Math.min(Math.max(1, currentPage), Math.max(1, totalPages));
}

export function isLatestActiveOrdersRequest(requestId: number, latestRequestId: number) {
  return requestId === latestRequestId;
}

export function removeDeliveredOrder<T extends { id: number }>(orders: readonly T[], orderId: number) {
  return orders.filter((order) => order.id !== orderId);
}

export type ActiveOrderSocketMutation<T> = {
  version: number;
  orderId: number;
  apply: (order: T) => T;
};

export function reconcileActiveOrdersResponse<T extends { id: number }>(args: {
  fetchedOrders: readonly T[];
  currentOrders: readonly T[];
  socketOrderVersions: ReadonlyMap<number, number>;
  socketMutations?: readonly ActiveOrderSocketMutation<T>[];
  socketVersionAtRequestStart: number;
  removedOrderIds: ReadonlySet<number>;
  sortOrder: "asc" | "desc";
}) {
  const currentById = new Map(args.currentOrders.map((order) => [order.id, order]));
  const fetchedIds = new Set<number>();
  const merged: T[] = [];

  for (const fetched of args.fetchedOrders) {
    if (args.removedOrderIds.has(fetched.id)) continue;
    fetchedIds.add(fetched.id);
    const changedAfterRequest =
      (args.socketOrderVersions.get(fetched.id) ?? 0) > args.socketVersionAtRequestStart;
    if (!changedAfterRequest) {
      merged.push(fetched);
      continue;
    }

    const current = currentById.get(fetched.id);
    const patched = (args.socketMutations ?? [])
      .filter((mutation) =>
        mutation.orderId === fetched.id &&
        mutation.version > args.socketVersionAtRequestStart
      )
      .reduce((order, mutation) => mutation.apply(order), fetched);
    merged.push(current ?? patched);
  }

  for (const current of args.currentOrders) {
    if (fetchedIds.has(current.id) || args.removedOrderIds.has(current.id)) continue;
    const changedAfterRequest =
      (args.socketOrderVersions.get(current.id) ?? 0) > args.socketVersionAtRequestStart;
    if (changedAfterRequest) merged.push(current);
  }

  return merged.sort((left, right) =>
    args.sortOrder === "desc" ? right.id - left.id : left.id - right.id
  );
}
