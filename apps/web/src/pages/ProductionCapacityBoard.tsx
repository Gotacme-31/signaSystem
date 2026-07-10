import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Activity,
  AlertCircle,
  ArrowLeft,
  BarChart3,
  Building2,
  CalendarDays,
  ChevronDown,
  ChevronUp,
  Clock,
  Gauge,
  Layers,
  Loader2,
  Package,
  RefreshCw,
  Users,
} from "lucide-react";
import { getBranches, getBranchProducts, type Branch, type BranchProductRow } from "../api/pricing";
import {
  getProductionCapacityBoard,
  type ProductionCapacityBoardAssignment,
  type ProductionCapacityBoardResponse,
  type ProductionCapacityBoardWindow,
  type ProductionCapacityUnit,
} from "../api/productionScheduling";
import {
  BUSINESS_TIME_ZONE,
  addBusinessDays,
  businessDateDiffInDays,
  businessDayOfWeek,
  formatDateInBusinessTimeZone,
  formatDateTimeInBusinessTimeZone,
  isValidDateKey,
  todayBusinessDateKey,
} from "../lib/businessTime";

type ViewMode = "windows" | "orders";

type AssignmentWithWindow = ProductionCapacityBoardAssignment & {
  dayDate: string;
  weekday: string;
  windowId: number;
  startsAt: string;
  endsAt: string;
  readyAt: string;
  readyAtDateTime: string;
  batchId: number | null;
};

type OrderItemGroup = {
  orderItemId: number;
  orderId: number;
  orderNumber: string;
  productName: string;
  branchName: string;
  customerName: string | null;
  totalItemQuantity: number;
  totalAssigned: number;
  remaining: number;
  finalReadyAt: string | null;
  orderCreatedAt: string;
  orderStatus: string;
  source: string;
  scheduleMessage: string | null;
  assignments: AssignmentWithWindow[];
  splitWindowsCount: number;
};

const MAX_RANGE_DAYS = 45;
const RANGE_WARNING_DAYS = 14;

function parsePositiveId(value: string | null) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function safeDateParam(value: string | null, fallback: string) {
  return value && isValidDateKey(value) ? value : fallback;
}

function unitLabel(unitType?: ProductionCapacityUnit) {
  return unitType === "METER" ? "m" : "piezas";
}

function toNumber(value: string | number | null | undefined) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function formatNumber(value: string | number | null | undefined) {
  return new Intl.NumberFormat("es-MX", { maximumFractionDigits: 3 }).format(toNumber(value));
}

function formatQuantity(value: string | number | null | undefined, unitType?: ProductionCapacityUnit) {
  return `${formatNumber(value)} ${unitLabel(unitType)}`;
}

function formatPercent(value: number) {
  return `${new Intl.NumberFormat("es-MX", { maximumFractionDigits: 1 }).format(value)}%`;
}

function formatDateKey(value: string) {
  if (!isValidDateKey(value)) return value;
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

function formatTimeKey(value: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return value;
  const date = new Date(Date.UTC(2020, 0, 1, Number(match[1]), Number(match[2])));
  return new Intl.DateTimeFormat("es-MX", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "UTC",
  }).format(date);
}

function formatIsoDateTime(value?: string | null) {
  return value ? formatDateTimeInBusinessTimeZone(value) : "—";
}

function latestIso(values: Array<string | null | undefined>) {
  const dates = values
    .filter((value): value is string => !!value)
    .map((value) => new Date(value))
    .filter((date) => !Number.isNaN(date.getTime()));
  if (dates.length === 0) return null;
  return dates.reduce((latest, value) => (value > latest ? value : latest), dates[0]).toISOString();
}

function currentWeekRange() {
  const today = todayBusinessDateKey();
  const day = businessDayOfWeek(today) ?? 1;
  const diffToMonday = day === 0 ? 6 : day - 1;
  const monday = addBusinessDays(today, -diffToMonday);
  return { from: monday, to: addBusinessDays(monday, 6) };
}

function statusConfig(window: ProductionCapacityBoardWindow) {
  const overCapacity = toNumber(window.overCapacity) > 0;
  if (overCapacity) {
    return { label: "Sobrecapacidad", className: "bg-red-100 text-red-800 border-red-200" };
  }
  if (window.status === "INACTIVE") {
    return { label: "Inactiva", className: "bg-gray-100 text-gray-700 border-gray-200" };
  }
  if (window.status === "EXPIRED") {
    return { label: "Vencida", className: "bg-gray-100 text-gray-700 border-gray-200" };
  }
  if (window.status === "FULL") {
    return { label: "Llena", className: "bg-red-50 text-red-700 border-red-200" };
  }
  if (window.status === "PARTIAL") {
    return { label: "Parcial", className: "bg-amber-50 text-amber-800 border-amber-200" };
  }
  return { label: "Disponible", className: "bg-emerald-50 text-emerald-700 border-emerald-200" };
}

function progressClass(window: ProductionCapacityBoardWindow) {
  if (!window.active || window.expired) return "bg-gray-400";
  if (toNumber(window.overCapacity) > 0) return "bg-red-600";
  if (window.occupancyPercent >= 100) return "bg-red-500";
  if (window.occupancyPercent >= 80) return "bg-amber-500";
  if (window.occupancyPercent > 0) return "bg-emerald-500";
  return "bg-gray-300";
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  tone = "blue",
}: {
  icon: typeof Gauge;
  label: string;
  value: string;
  tone?: "blue" | "green" | "amber" | "red" | "gray" | "indigo";
}) {
  const toneClass = {
    blue: "from-blue-50 to-indigo-50 text-blue-700 border-blue-100",
    green: "from-emerald-50 to-green-50 text-emerald-700 border-emerald-100",
    amber: "from-amber-50 to-orange-50 text-amber-800 border-amber-100",
    red: "from-red-50 to-rose-50 text-red-700 border-red-100",
    gray: "from-gray-50 to-slate-50 text-gray-700 border-gray-200",
    indigo: "from-indigo-50 to-violet-50 text-indigo-700 border-indigo-100",
  }[tone];

  return (
    <div className={`rounded-2xl border bg-gradient-to-br p-4 shadow-sm ${toneClass}`}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide opacity-75">{label}</p>
          <p className="mt-2 text-2xl font-bold text-gray-900">{value}</p>
        </div>
        <div className="rounded-xl bg-white/80 p-3 shadow-sm">
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  );
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-10 text-center">
      <Package className="mx-auto h-10 w-10 text-gray-300" />
      <h3 className="mt-3 text-lg font-bold text-gray-900">{title}</h3>
      <p className="mt-1 text-sm text-gray-500">{description}</p>
    </div>
  );
}

export default function ProductionCapacityBoard() {
  const navigate = useNavigate();
  const [sp] = useSearchParams();
  const today = todayBusinessDateKey();

  const [branches, setBranches] = useState<Branch[]>([]);
  const [products, setProducts] = useState<BranchProductRow[]>([]);
  const [branchId, setBranchId] = useState<number | null>(() => parsePositiveId(sp.get("branchId")));
  const [productId, setProductId] = useState<number | null>(() => parsePositiveId(sp.get("productId")));
  const [from, setFrom] = useState(() => safeDateParam(sp.get("from"), today));
  const [to, setTo] = useState(() => safeDateParam(sp.get("to"), addBusinessDays(today, 7)));
  const [board, setBoard] = useState<ProductionCapacityBoardResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [viewMode, setViewMode] = useState<ViewMode>("windows");
  const [expandedWindows, setExpandedWindows] = useState<Record<string, boolean>>({});
  const [expandedSplits, setExpandedSplits] = useState<Record<string, boolean>>({});

  const selectedProduct = products.find((row) => row.productId === productId)?.product ?? board?.product ?? null;
  const rangeDays = businessDateDiffInDays(from, to);
  const validationError = useMemo(() => {
    if (!branchId) return "Selecciona una sucursal.";
    if (!productId) return "Selecciona un producto.";
    if (!isValidDateKey(from)) return "La fecha inicial no es válida.";
    if (!isValidDateKey(to)) return "La fecha final no es válida.";
    if (rangeDays === null) return "El rango de fechas no es válido.";
    if (rangeDays < 0) return "La fecha final debe ser igual o posterior a la inicial.";
    if (rangeDays > MAX_RANGE_DAYS) return `El rango máximo permitido es de ${MAX_RANGE_DAYS} días.`;
    return null;
  }, [branchId, productId, from, to, rangeDays]);
  const rangeWarning = rangeDays !== null && rangeDays > RANGE_WARNING_DAYS
    ? `Rango amplio: se consultarán ${rangeDays + 1} días. Puede tardar más de lo normal.`
    : null;

  useEffect(() => {
    let cancelled = false;
    getBranches()
      .then((data) => {
        if (cancelled) return;
        setBranches(data);
        setBranchId((current) => {
          if (current && data.some((branch) => branch.id === current)) return current;
          return data.find((branch) => branch.isActive)?.id ?? data[0]?.id ?? null;
        });
      })
      .catch((err: unknown) => setError(errorMessage(err, "Error cargando sucursales")));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!branchId) {
      return;
    }

    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setLoadingProducts(true);
    });
    getBranchProducts(branchId)
      .then((data) => {
        if (cancelled) return;
        setProducts(data);
        setProductId((current) => {
          if (current && data.some((row) => row.productId === current)) return current;
          return data[0]?.productId ?? null;
        });
      })
      .catch((err: unknown) => setError(errorMessage(err, "Error cargando productos")))
      .finally(() => {
        if (!cancelled) setLoadingProducts(false);
      });

    return () => {
      cancelled = true;
    };
  }, [branchId]);

  useEffect(() => {
    if (!branchId || !productId || validationError) return;

    const query = new URLSearchParams({
      branchId: String(branchId),
      productId: String(productId),
      from,
      to,
    });
    navigate(`/admin/production-capacity?${query.toString()}`, { replace: true });
  }, [branchId, productId, from, to, validationError, navigate]);

  useEffect(() => {
    if (!branchId || !productId || validationError) return;

    const controller = new AbortController();
    queueMicrotask(() => {
      if (controller.signal.aborted) return;
      setLoading(true);
      setError(null);
    });
    getProductionCapacityBoard({ branchId, productId, from, to }, controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return;
        setBoard(data);
        setLastUpdated(new Date());
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setBoard(null);
        setError(errorMessage(err, "Error cargando tablero de capacidad"));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [branchId, productId, from, to, refreshKey, validationError]);

  const assignmentGroups = useMemo<OrderItemGroup[]>(() => {
    if (!board) return [];

    const map = new Map<number, AssignmentWithWindow[]>();
    for (const day of board.days) {
      for (const window of day.windows) {
        for (const assignment of window.assignments) {
          const current = map.get(assignment.orderItemId) ?? [];
          current.push({
            ...assignment,
            dayDate: day.date,
            weekday: day.weekday,
            windowId: window.windowId,
            startsAt: window.startsAt,
            endsAt: window.endsAt,
            readyAt: window.readyAt,
            readyAtDateTime: window.readyAtDateTime,
            batchId: window.batchId,
          });
          map.set(assignment.orderItemId, current);
        }
      }
    }

    return Array.from(map.entries())
      .map(([orderItemId, assignments]) => {
        const first = assignments[0];
        const totalItemQuantity = toNumber(first.totalItemQuantity);
        const totalAssigned = assignments.reduce((sum, assignment) => sum + toNumber(assignment.quantityAssigned), 0);
        const uniqueWindows = new Set(assignments.map((assignment) => `${assignment.dayDate}:${assignment.windowId}`));
        return {
          orderItemId,
          orderId: first.orderId,
          orderNumber: first.orderNumber,
          productName: first.productName,
          branchName: first.branch.name,
          customerName: first.customer?.name ?? null,
          totalItemQuantity,
          totalAssigned,
          remaining: totalItemQuantity - totalAssigned,
          finalReadyAt: latestIso(assignments.map((assignment) => assignment.windowReadyAt ?? assignment.finalReadyAt)),
          orderCreatedAt: first.orderCreatedAt,
          orderStatus: first.orderStatus,
          source: first.productionScheduleSource || first.source,
          scheduleMessage: first.productionScheduleMessage || first.orderProductionScheduleMessage,
          assignments: assignments.sort((a, b) => `${a.dayDate} ${a.readyAt}`.localeCompare(`${b.dayDate} ${b.readyAt}`)),
          splitWindowsCount: uniqueWindows.size,
        };
      })
      .sort((a, b) => {
        const readyA = a.finalReadyAt ? new Date(a.finalReadyAt).getTime() : 0;
        const readyB = b.finalReadyAt ? new Date(b.finalReadyAt).getTime() : 0;
        if (readyA !== readyB) return readyA - readyB;
        return a.orderId - b.orderId;
      });
  }, [board]);

  const splitByOrderItemId = useMemo(() => {
    const map = new Map<number, OrderItemGroup>();
    for (const group of assignmentGroups) {
      if (group.splitWindowsCount > 1) map.set(group.orderItemId, group);
    }
    return map;
  }, [assignmentGroups]);

  const hasWindows = !!board?.days.some((day) => day.windows.length > 0);
  const hasAssignments = !!board?.days.some((day) => day.windows.some((window) => window.assignments.length > 0));

  function openPricing() {
    const query = new URLSearchParams();
    if (branchId) query.set("branchId", String(branchId));
    if (productId) query.set("productId", String(productId));
    query.set("section", "production");
    navigate(`/admin/pricing?${query.toString()}`);
  }

  function setTodayRange() {
    const nextToday = todayBusinessDateKey();
    setFrom(nextToday);
    setTo(nextToday);
  }

  function setWeekRange() {
    const range = currentWeekRange();
    setFrom(range.from);
    setTo(range.to);
  }

  function toggleWindow(key: string) {
    setExpandedWindows((current) => ({ ...current, [key]: !current[key] }));
  }

  function toggleSplit(key: string) {
    setExpandedSplits((current) => ({ ...current, [key]: !current[key] }));
  }

  return (
    <div className="min-h-screen overflow-x-hidden bg-gradient-to-br from-gray-50 via-white to-blue-50 px-3 py-4 sm:px-4 lg:px-6">
      <div className="mx-auto w-full max-w-[1800px] space-y-6">
        <header className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-3">
                <div className="rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-600 p-3 text-white shadow-lg">
                  <BarChart3 className="h-6 w-6" />
                </div>
                <div>
                  <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">Capacidad de producción</h1>
                  <p className="mt-1 text-sm text-gray-500">
                    Ocupación por ventana usando asignaciones activas de producción.
                  </p>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2 text-sm">
                <span className="inline-flex items-center gap-2 rounded-full border border-blue-100 bg-blue-50 px-3 py-1 font-medium text-blue-800">
                  <Package className="h-4 w-4" />
                  {board?.product.name ?? selectedProduct?.name ?? "Producto sin seleccionar"}
                </span>
                <span className="inline-flex items-center gap-2 rounded-full border border-indigo-100 bg-indigo-50 px-3 py-1 font-medium text-indigo-800">
                  <Building2 className="h-4 w-4" />
                  {board?.branch.name ?? branches.find((branch) => branch.id === branchId)?.name ?? "Sucursal sin seleccionar"}
                </span>
                <span className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-gray-50 px-3 py-1 font-medium text-gray-700">
                  <Clock className="h-4 w-4" />
                  Zona: {board?.range.timezone ?? BUSINESS_TIME_ZONE}
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={openPricing}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-gray-300 bg-white px-4 py-2.5 font-semibold text-gray-800 shadow-sm transition hover:bg-gray-50"
            >
              <ArrowLeft className="h-4 w-4" />
              Volver a precios
            </button>
          </div>
        </header>

        <section className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="mb-4 flex items-center gap-2">
            <CalendarDays className="h-5 w-5 text-blue-600" />
            <h2 className="text-lg font-bold text-gray-900">Filtros</h2>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-6">
            <label className="block xl:col-span-2">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">Sucursal</span>
              <select
                value={branchId ?? ""}
                onChange={(event) => setBranchId(Number(event.target.value) || null)}
                className="w-full rounded-xl border border-gray-300 bg-gray-50 px-3 py-2.5 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Selecciona sucursal</option>
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name} {branch.isActive ? "" : "(inactiva)"}
                  </option>
                ))}
              </select>
            </label>

            <label className="block xl:col-span-2">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">Producto</span>
              <select
                value={productId ?? ""}
                onChange={(event) => setProductId(Number(event.target.value) || null)}
                disabled={!branchId || loadingProducts}
                className="w-full rounded-xl border border-gray-300 bg-gray-50 px-3 py-2.5 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
              >
                <option value="">Selecciona producto</option>
                {products.map((row) => (
                  <option key={row.productId} value={row.productId}>
                    {row.product.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">Fecha inicial</span>
              <input
                type="date"
                value={from}
                onChange={(event) => setFrom(event.target.value)}
                className="w-full rounded-xl border border-gray-300 bg-gray-50 px-3 py-2.5 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">Fecha final</span>
              <input
                type="date"
                value={to}
                onChange={(event) => setTo(event.target.value)}
                className="w-full rounded-xl border border-gray-300 bg-gray-50 px-3 py-2.5 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
              />
            </label>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={setTodayRange}
              className="rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
            >
              Hoy
            </button>
            <button
              type="button"
              onClick={setWeekRange}
              className="rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
            >
              Esta semana
            </button>
            <button
              type="button"
              onClick={() => setRefreshKey((value) => value + 1)}
              disabled={loading || !!validationError}
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:from-blue-700 hover:to-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Actualizar
            </button>
            <span className="text-sm text-gray-500">
              Última actualización: {lastUpdated ? formatDateInBusinessTimeZone(lastUpdated) + " " + lastUpdated.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" }) : "—"}
            </span>
          </div>

          {rangeWarning && !validationError && (
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              {rangeWarning}
            </div>
          )}
          {validationError && (
            <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
              {validationError}
            </div>
          )}
        </section>

        {error && (
          <section className="rounded-2xl border border-red-200 bg-red-50 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-600" />
                <div>
                  <p className="font-bold text-red-800">No se pudo cargar el tablero</p>
                  <p className="text-sm text-red-700">{error}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setRefreshKey((value) => value + 1)}
                className="rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"
              >
                Reintentar
              </button>
            </div>
          </section>
        )}

        {loading && !board && (
          <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, index) => (
              <div key={index} className="h-28 animate-pulse rounded-2xl border border-gray-200 bg-white shadow-sm" />
            ))}
          </section>
        )}

        {board && (
          <>
            {!board.config.exists && (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                Este producto no tiene cálculo automático configurado para esta sucursal.
              </div>
            )}
            {board.config.exists && !board.config.enabled && (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                El cálculo automático está desactivado. Las ventanas se muestran solo para diagnóstico.
              </div>
            )}

            <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <SummaryCard icon={Gauge} label="Capacidad total" value={formatQuantity(board.totals.capacity, board.product.unitType)} />
              <SummaryCard icon={Activity} label="Capacidad utilizada" value={formatQuantity(board.totals.assigned, board.product.unitType)} tone="indigo" />
              <SummaryCard icon={Layers} label="Capacidad disponible" value={formatQuantity(board.totals.available, board.product.unitType)} tone={toNumber(board.totals.available) < 0 ? "red" : "green"} />
              <SummaryCard icon={BarChart3} label="Ocupación" value={formatPercent(board.totals.occupancyPercent)} tone={board.totals.occupancyPercent >= 100 ? "red" : board.totals.occupancyPercent >= 80 ? "amber" : "blue"} />
              <SummaryCard icon={Users} label="Pedidos" value={String(board.totals.ordersCount)} tone="gray" />
              <SummaryCard icon={Package} label="Asignaciones" value={String(board.totals.assignmentsCount)} tone="gray" />
              <SummaryCard icon={AlertCircle} label="Ventanas llenas" value={String(board.totals.fullWindowsCount)} tone={board.totals.fullWindowsCount > 0 ? "amber" : "gray"} />
              <SummaryCard icon={Clock} label="Ventanas vencidas" value={String(board.totals.expiredWindowsCount)} tone="gray" />
            </section>

            {board.totals.overCapacityWindowsCount > 0 && (
              <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-800">
                Hay {board.totals.overCapacityWindowsCount} ventana(s) con sobrecapacidad. Revisa los detalles para ver el excedente.
              </div>
            )}

            <section className="rounded-3xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <h2 className="text-lg font-bold text-gray-900">Detalle de ocupación</h2>
                  <p className="text-sm text-gray-500">
                    Rango: {formatDateKey(board.range.from)} a {formatDateKey(board.range.to)}.
                  </p>
                </div>
                <div className="inline-flex rounded-xl border border-gray-200 bg-gray-50 p-1">
                  <button
                    type="button"
                    onClick={() => setViewMode("windows")}
                    className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${viewMode === "windows" ? "bg-white text-blue-700 shadow-sm" : "text-gray-600 hover:text-gray-900"}`}
                  >
                    Por ventanas
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode("orders")}
                    className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${viewMode === "orders" ? "bg-white text-blue-700 shadow-sm" : "text-gray-600 hover:text-gray-900"}`}
                  >
                    Por pedidos
                  </button>
                </div>
              </div>
            </section>

            {!hasWindows && (
              <EmptyState
                title="No hay ventanas en el rango seleccionado"
                description="Configura ventanas de producción para este producto y sucursal, o cambia el rango de fechas."
              />
            )}

            {hasWindows && !hasAssignments && (
              <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4 text-sm text-blue-800">
                Hay ventanas configuradas, pero no hay pedidos asignados en este rango.
              </div>
            )}

            {hasWindows && viewMode === "windows" && (
              <section className="space-y-5">
                {board.days.map((day) => (
                  <div key={day.date} className="overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-sm">
                    <div className="border-b border-gray-100 bg-gradient-to-r from-gray-50 to-blue-50 px-5 py-4">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                        <div>
                          <h3 className="text-lg font-bold text-gray-900">
                            {day.weekday} {formatDateKey(day.date)}
                          </h3>
                          <p className="text-sm text-gray-500">
                            {day.windows.length} ventanas · {day.assignmentsCount} asignaciones · {day.ordersCount} pedidos
                          </p>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                          <span className="rounded-xl bg-white px-3 py-2 font-semibold text-gray-700 shadow-sm">Cap: {formatQuantity(day.capacity, board.product.unitType)}</span>
                          <span className="rounded-xl bg-white px-3 py-2 font-semibold text-gray-700 shadow-sm">Usado: {formatQuantity(day.assigned, board.product.unitType)}</span>
                          <span className="rounded-xl bg-white px-3 py-2 font-semibold text-gray-700 shadow-sm">Disp: {formatQuantity(day.available, board.product.unitType)}</span>
                          <span className="rounded-xl bg-white px-3 py-2 font-semibold text-gray-700 shadow-sm">{formatPercent(day.occupancyPercent)}</span>
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-4 p-4 xl:grid-cols-2 2xl:grid-cols-3">
                      {day.windows.map((window) => {
                        const key = `${day.date}:${window.windowId}`;
                        const expanded = !!expandedWindows[key];
                        const status = statusConfig(window);
                        const overCapacity = toNumber(window.overCapacity);

                        return (
                          <article key={key} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                              <div>
                                <h4 className="text-base font-bold text-gray-900">
                                  {formatTimeKey(window.startsAt)} – {formatTimeKey(window.endsAt)}
                                </h4>
                                <p className="mt-1 text-sm text-gray-500">Listo: {formatTimeKey(window.readyAt)}</p>
                              </div>
                              <span className={`inline-flex w-fit items-center rounded-full border px-3 py-1 text-xs font-bold ${status.className}`}>
                                {status.label}
                              </span>
                            </div>

                            <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                              <div className="rounded-xl bg-gray-50 p-3">
                                <p className="text-xs font-semibold uppercase text-gray-500">Capacidad</p>
                                <p className="font-bold text-gray-900">{formatQuantity(window.capacity, board.product.unitType)}</p>
                              </div>
                              <div className="rounded-xl bg-gray-50 p-3">
                                <p className="text-xs font-semibold uppercase text-gray-500">Usado</p>
                                <p className="font-bold text-gray-900">{formatQuantity(window.assigned, board.product.unitType)}</p>
                              </div>
                              <div className="rounded-xl bg-gray-50 p-3">
                                <p className="text-xs font-semibold uppercase text-gray-500">Disponible</p>
                                <p className={`font-bold ${toNumber(window.available) < 0 ? "text-red-700" : "text-gray-900"}`}>{formatQuantity(window.available, board.product.unitType)}</p>
                              </div>
                              <div className="rounded-xl bg-gray-50 p-3">
                                <p className="text-xs font-semibold uppercase text-gray-500">Ocupación</p>
                                <p className="font-bold text-gray-900">{formatPercent(window.occupancyPercent)}</p>
                              </div>
                            </div>

                            <div className="mt-4">
                              <div className="h-3 overflow-hidden rounded-full bg-gray-100">
                                <div
                                  className={`h-full rounded-full transition-all ${progressClass(window)}`}
                                  style={{ width: `${Math.min(Math.max(window.occupancyPercent, 0), 100)}%` }}
                                />
                              </div>
                              <div className="mt-2 flex flex-wrap gap-2 text-xs text-gray-500">
                                <span>Ventana ID: {window.windowId}</span>
                                <span>Batch ID: {window.batchId ?? "—"}</span>
                                {window.fromBatchOnly && <span>Solo desde batch histórico</span>}
                              </div>
                            </div>

                            {overCapacity > 0 && (
                              <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-bold text-red-800">
                                Sobrecapacidad: +{formatQuantity(window.overCapacity, board.product.unitType)}
                              </div>
                            )}

                            <button
                              type="button"
                              onClick={() => toggleWindow(key)}
                              className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                            >
                              {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                              {expanded ? "Ocultar pedidos" : `Ver pedidos (${window.assignments.length})`}
                            </button>

                            {expanded && (
                              <div className="mt-4 space-y-3">
                                {window.assignments.length === 0 ? (
                                  <div className="rounded-xl border border-dashed border-gray-300 p-4 text-center text-sm text-gray-500">
                                    Sin pedidos asignados en esta ventana.
                                  </div>
                                ) : (
                                  window.assignments.map((assignment) => {
                                    const split = splitByOrderItemId.get(assignment.orderItemId);
                                    const splitKey = `${key}:${assignment.orderItemId}`;
                                    const splitExpanded = !!expandedSplits[splitKey];

                                    return (
                                      <div key={assignment.batchItemId} className="rounded-xl border border-gray-200 bg-gray-50 p-3">
                                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                                          <div>
                                            <p className="font-bold text-gray-900">Pedido {assignment.orderNumber}</p>
                                            <p className="text-sm text-gray-600">{assignment.productName}</p>
                                          </div>
                                          <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-gray-700 shadow-sm">
                                            {assignment.source}
                                          </span>
                                        </div>
                                        <div className="mt-3 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                                          <p><span className="font-semibold">orderId:</span> {assignment.orderId}</p>
                                          <p><span className="font-semibold">orderItemId:</span> {assignment.orderItemId}</p>
                                          <p><span className="font-semibold">batchItemId:</span> {assignment.batchItemId}</p>
                                          <p><span className="font-semibold">Estado pedido:</span> {assignment.orderStatus}</p>
                                          <p><span className="font-semibold">Estado batch item:</span> {assignment.batchItemStatus}</p>
                                          <p><span className="font-semibold">Sucursal:</span> {assignment.branch.name}</p>
                                          <p><span className="font-semibold">Cantidad total:</span> {formatQuantity(assignment.totalItemQuantity, board.product.unitType)}</p>
                                          <p><span className="font-semibold">Asignado aquí:</span> {formatQuantity(assignment.quantityAssigned, board.product.unitType)}</p>
                                          <p><span className="font-semibold">Registrado:</span> {formatIsoDateTime(assignment.orderCreatedAt)}</p>
                                          <p><span className="font-semibold">Final estimado:</span> {formatIsoDateTime(assignment.finalReadyAt)}</p>
                                          {assignment.customer && <p><span className="font-semibold">Cliente:</span> {assignment.customer.name}</p>}
                                        </div>

                                        {split && (
                                          <div className="mt-3 rounded-xl border border-indigo-100 bg-indigo-50 p-3">
                                            <button
                                              type="button"
                                              onClick={() => toggleSplit(splitKey)}
                                              className="flex w-full items-center justify-between gap-3 text-left text-sm font-bold text-indigo-800"
                                            >
                                              <span>Dividido en {split.splitWindowsCount} ventanas</span>
                                              {splitExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                                            </button>
                                            {splitExpanded && (
                                              <div className="mt-3 space-y-2 text-sm text-indigo-900">
                                                {split.assignments.map((part) => (
                                                  <div key={part.batchItemId} className="rounded-lg bg-white/80 px-3 py-2">
                                                    {formatDateKey(part.dayDate)} · salida {formatTimeKey(part.readyAt)} · ventana #{part.windowId} · {formatQuantity(part.quantityAssigned, board.product.unitType)}
                                                  </div>
                                                ))}
                                                <div className="font-semibold">
                                                  Total asignado: {formatQuantity(split.totalAssigned, board.product.unitType)} · Restante: {formatQuantity(split.remaining, board.product.unitType)} · Final: {formatIsoDateTime(split.finalReadyAt)}
                                                </div>
                                              </div>
                                            )}
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })
                                )}
                              </div>
                            )}
                          </article>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </section>
            )}

            {hasWindows && viewMode === "orders" && (
              <section className="space-y-4">
                {assignmentGroups.length === 0 ? (
                  <EmptyState
                    title="No hay pedidos asignados"
                    description="Las ventanas existen, pero no tienen ProductionBatchItem activo en el rango seleccionado."
                  />
                ) : (
                  assignmentGroups.map((group) => {
                    const expanded = !!expandedSplits[`order:${group.orderItemId}`];
                    return (
                      <article key={group.orderItemId} className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
                        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="text-lg font-bold text-gray-900">Pedido {group.orderNumber}</h3>
                              {group.splitWindowsCount > 1 && (
                                <span className="rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs font-bold text-indigo-800">
                                  Dividido en {group.splitWindowsCount} ventanas
                                </span>
                              )}
                            </div>
                            <p className="mt-1 text-sm text-gray-600">{group.productName}</p>
                            <p className="mt-1 text-xs text-gray-500">
                              orderId {group.orderId} · orderItemId {group.orderItemId} · {group.branchName}
                              {group.customerName ? ` · Cliente: ${group.customerName}` : ""}
                            </p>
                          </div>
                          <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4 xl:min-w-[560px]">
                            <span className="rounded-xl bg-gray-50 px-3 py-2"><strong>Total:</strong> {formatQuantity(group.totalItemQuantity, board.product.unitType)}</span>
                            <span className="rounded-xl bg-gray-50 px-3 py-2"><strong>Asignado:</strong> {formatQuantity(group.totalAssigned, board.product.unitType)}</span>
                            <span className={`rounded-xl px-3 py-2 ${group.remaining > 0 ? "bg-amber-50 text-amber-800" : "bg-gray-50"}`}><strong>Restante:</strong> {formatQuantity(group.remaining, board.product.unitType)}</span>
                            <span className="rounded-xl bg-gray-50 px-3 py-2"><strong>Final:</strong> {formatIsoDateTime(group.finalReadyAt)}</span>
                          </div>
                        </div>

                        <div className="mt-4 grid grid-cols-1 gap-3 text-sm md:grid-cols-3">
                          <p className="rounded-xl bg-gray-50 px-3 py-2"><span className="font-semibold">Estado:</span> {group.orderStatus}</p>
                          <p className="rounded-xl bg-gray-50 px-3 py-2"><span className="font-semibold">Fuente:</span> {group.source}</p>
                          <p className="rounded-xl bg-gray-50 px-3 py-2"><span className="font-semibold">Fecha objetivo:</span> {formatIsoDateTime(group.finalReadyAt)}</p>
                        </div>
                        {group.scheduleMessage && (
                          <p className="mt-3 rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-sm text-blue-800">
                            Regla/mensaje aplicado: {group.scheduleMessage}
                          </p>
                        )}

                        <button
                          type="button"
                          onClick={() => toggleSplit(`order:${group.orderItemId}`)}
                          className="mt-4 inline-flex items-center gap-2 rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                        >
                          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                          {expanded ? "Ocultar ventanas" : "Ver ventanas utilizadas"}
                        </button>

                        {expanded && (
                          <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3">
                            {group.assignments.map((assignment) => (
                              <div key={assignment.batchItemId} className="rounded-2xl border border-gray-200 bg-gray-50 p-4 text-sm">
                                <p className="font-bold text-gray-900">{assignment.weekday} {formatDateKey(assignment.dayDate)}</p>
                                <p className="mt-1 text-gray-600">
                                  Ventana #{assignment.windowId}: {formatTimeKey(assignment.startsAt)} – {formatTimeKey(assignment.endsAt)} · salida {formatTimeKey(assignment.readyAt)}
                                </p>
                                <p className="mt-2 font-semibold text-gray-900">
                                  Asignado: {formatQuantity(assignment.quantityAssigned, board.product.unitType)}
                                </p>
                                <p className="text-xs text-gray-500">batchItemId {assignment.batchItemId} · batchId {assignment.batchId ?? "—"}</p>
                              </div>
                            ))}
                          </div>
                        )}
                      </article>
                    );
                  })
                )}
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
