import React, { useEffect, useState } from "react";
import {
  getDashboardData,
  getDashboardBranches,
  getDashboardProducts,
  type DashboardFilters,
  type Branch,
  type Product,
} from "../api/dashboard";
import { useAuth } from "../auth/useAuth";
import {
  BarChart3,
  Filter,
  Calendar,
  Loader2,
  RefreshCw,
  Users,
  DollarSign,
  ShoppingBag,
  Building,
  Package,
  TrendingUp,
  Clock,
  CheckCircle,
  CreditCard,
  Layers,
  Grid3x3,
  PieChart,
} from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  PieChart as RePieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  Legend,
} from "recharts";
import { useNavigate } from 'react-router-dom';

type RangePreset = "day" | "week" | "month" | "year" | "custom";
type TopMetric = "revenue" | "quantity";

// Colores para gráficas
const COLORS = ["#3B82F6", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6", "#EC4899", "#6366F1", "#14B8A6"];
const MetricSwitch = ({
  value,
  onChange,
}: {
  value: TopMetric;
  onChange: (v: TopMetric) => void;
}) => (
  <div className="inline-flex rounded-xl border border-gray-200 bg-gray-50 p-1">
    <button
      type="button"
      onClick={() => onChange("revenue")}
      className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${value === "revenue"
        ? "bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-sm"
        : "text-gray-600 hover:text-gray-900"
        }`}
    >
      Ingresos
    </button>
    <button
      type="button"
      onClick={() => onChange("quantity")}
      className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${value === "quantity"
        ? "bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-sm"
        : "text-gray-600 hover:text-gray-900"
        }`}
    >
      Cantidad
    </button>
  </div>
);

const TopProductsChart = ({
  items,
  formatMoney,
}: {
  items: Array<{ productId: number; product: string; revenue: number; quantity: number; unitType: string }>;
  formatMoney: (n: number) => string;
}) => {
  const [metric, setMetric] = useState<TopMetric>("revenue");

  const top = (items || []).slice(0, 10).map((p) => ({
    name: p.product.length > 20 ? p.product.substring(0, 20) + "..." : p.product,
    fullName: p.product,
    revenue: p.revenue || 0,
    quantity: p.quantity || 0,
    unitType: p.unitType,
  }));

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    const row = payload[0]?.payload;
    return (
      <div className="bg-white border border-gray-200 shadow-lg rounded-xl p-4 text-sm">
        <div className="font-semibold text-gray-900 mb-2">{row.fullName}</div>
        <div className="text-gray-700 space-y-1">
          <div className="flex items-center gap-2">
            <DollarSign className="w-4 h-4 text-green-600" />
            <span>Ingresos: <span className="font-semibold">{formatMoney(row.revenue)}</span></span>
          </div>
          <div className="flex items-center gap-2">
            <Package className="w-4 h-4 text-blue-600" />
            <span>Cantidad: <span className="font-semibold">{row.quantity}</span> <span className="text-gray-500">({row.unitType})</span></span>
          </div>
        </div>
      </div>
    );
  };

  const yTick = (v: any) => (metric === "revenue" ? formatMoney(Number(v)) : Number(v).toLocaleString("es-MX"));

  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 mb-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Top 10 Productos</h3>
          <p className="text-sm text-gray-500">{metric === "revenue" ? "Por ingresos" : "Por cantidad vendida"}</p>
        </div>
        <MetricSwitch value={metric} onChange={setMetric} />
      </div>

      {top.length === 0 ? (
        <div className="h-80 flex items-center justify-center text-gray-500">
          Sin datos para este filtro
        </div>
      ) : (
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={top} margin={{ top: 10, right: 20, bottom: 60, left: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis
                dataKey="name"
                interval={0}
                angle={-35}
                textAnchor="end"
                height={70}
                tick={{ fontSize: 12, fill: "#6B7280" }}
              />
              <YAxis
                tickFormatter={yTick}
                tick={{ fontSize: 12, fill: "#6B7280" }}
                width={90}
              />
              <Tooltip content={<CustomTooltip />} />
              <Bar
                dataKey={metric}
                radius={[8, 8, 0, 0]}
                fill="url(#colorGradient)"
              />
              <defs>
                <linearGradient id="colorGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#3B82F6" stopOpacity={1} />
                  <stop offset="100%" stopColor="#8B5CF6" stopOpacity={1} />
                </linearGradient>
              </defs>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
};
const PaymentMethodChart = ({
  data,
  formatMoney,
}: {
  data: Array<{ method: string; count: number; revenue: number }>;
  formatMoney: (n: number) => string;
}) => {
  const methods = data.map((item) => ({
    name: item.method === "CASH" ? "Efectivo" :
      item.method === "TRANSFER" ? "Transferencia" :
        item.method === "CARD" ? "Tarjeta" : item.method,
    value: item.revenue,
    count: item.count,
  }));

  const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    const data = payload[0].payload;
    return (
      <div className="bg-white border border-gray-200 shadow-lg rounded-xl p-3 text-sm">
        <div className="font-semibold text-gray-900">{data.name}</div>
        <div className="text-gray-700 mt-1">
          <div>{formatMoney(data.value)}</div>
          <div className="text-xs text-gray-500">{data.count} pedidos</div>
        </div>
      </div>
    );
  };

  // Calcular el total para los porcentajes
  const total = methods.reduce((sum, item) => sum + item.value, 0);

  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
      <div className="flex items-center gap-2 mb-4">
        <div className="p-2 bg-purple-100 rounded-lg">
          <CreditCard className="w-5 h-5 text-purple-700" />
        </div>
        <h3 className="text-lg font-semibold text-gray-900">Métodos de Pago</h3>
      </div>

      {methods.length === 0 ? (
        <div className="h-48 flex items-center justify-center text-gray-500">
          Sin datos
        </div>
      ) : (
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <RePieChart>
              <Pie
                data={methods}
                cx="50%"
                cy="50%"
                innerRadius={40}
                outerRadius={70}
                paddingAngle={2}
                dataKey="value"
                label={({ name, percent }) => {
                  // Asegurar que percent sea un número y calcular el porcentaje
                  const percentage = percent ? (percent * 100).toFixed(0) : '0';
                  return `${name} ${percentage}%`;
                }}
                labelLine={false}
              >
                {methods.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip content={<CustomTooltip />} />
            </RePieChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="mt-4 space-y-2">
        {methods.map((method, index) => {
          const percentage = total > 0 ? ((method.value / total) * 100).toFixed(1) : '0';
          return (
            <div key={method.name} className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS[index % COLORS.length] }} />
                <span className="text-gray-700">{method.name}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-gray-500">{percentage}%</span>
                <span className="font-medium text-gray-900">{formatMoney(method.value)}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
const iso = (d: Date) => d.toISOString().split("T")[0];

function presetRange(p: Exclude<RangePreset, "custom">) {
  const end = new Date();
  const start = new Date();

  if (p === "day") {
    start.setHours(0, 0, 0, 0);
  }
  if (p === "week") {
    const day = end.getDay();
    const diff = day === 0 ? 6 : day - 1;
    start.setDate(end.getDate() - diff);
  }
  if (p === "month") {
    start.setDate(1);
  }
  if (p === "year") {
    start.setMonth(0, 1);
  }

  return { startDate: iso(start), endDate: iso(end) };
}

type StatTone = "green" | "blue" | "purple" | "orange" | "indigo" | "red" | "pink" | "teal";

const toneStyles = {
  green: { bg: "bg-green-100", text: "text-green-700", icon: "text-green-600", light: "bg-green-50" },
  blue: { bg: "bg-blue-100", text: "text-blue-700", icon: "text-blue-600", light: "bg-blue-50" },
  purple: { bg: "bg-purple-100", text: "text-purple-700", icon: "text-purple-600", light: "bg-purple-50" },
  orange: { bg: "bg-orange-100", text: "text-orange-700", icon: "text-orange-600", light: "bg-orange-50" },
  indigo: { bg: "bg-indigo-100", text: "text-indigo-700", icon: "text-indigo-600", light: "bg-indigo-50" },
  red: { bg: "bg-red-100", text: "text-red-700", icon: "text-red-600", light: "bg-red-50" },
  pink: { bg: "bg-pink-100", text: "text-pink-700", icon: "text-pink-600", light: "bg-pink-50" },
  teal: { bg: "bg-teal-100", text: "text-teal-700", icon: "text-teal-600", light: "bg-teal-50" },
};

const Stat = ({
  title,
  value,
  icon: Icon,
  tone: t,
  sub,
  trend,
}: {
  title: string;
  value: string | number;
  icon: any;
  tone: StatTone;
  sub?: string;
  trend?: { value: number; label: string };
}) => {
  const style = toneStyles[t];

  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between">
        <div className={`p-3 rounded-xl ${style.bg}`}>
          <Icon className={`w-6 h-6 ${style.text}`} />
        </div>
        {trend && (
          <div className={`text-xs font-medium px-2 py-1 rounded-full ${trend.value >= 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
            {trend.value > 0 ? '+' : ''}{trend.value}%
          </div>
        )}
      </div>
      <div className="mt-4">
        <div className="text-3xl font-bold text-gray-900">{value}</div>
        <div className="text-sm font-medium text-gray-600 mt-1">{title}</div>
        {sub && <div className="text-xs text-gray-500 mt-2">{sub}</div>}
      </div>
    </div>
  );
};

const CheckboxList = ({
  title,
  items,
  selected,
  onChange,
  label,
  icon: Icon,
}: {
  title: string;
  items: Array<{ id: number; isActive?: boolean }>;
  selected: number[];
  onChange: (ids: number[]) => void;
  label: (it: any) => string;
  icon?: any;
}) => {
  const allIds = items.filter(i => i.isActive !== false).map((i) => i.id);
  const allSelected = allIds.length > 0 && allIds.every(id => selected.includes(id));

  const toggleAll = () => onChange(allSelected ? [] : allIds);
  const toggleOne = (id: number) =>
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);

  return (
    <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {Icon && <Icon className="w-4 h-4 text-gray-600" />}
          <span className="font-semibold text-gray-900">{title}</span>
          <span className="text-xs bg-gray-200 text-gray-700 px-2 py-0.5 rounded-full">
            {selected.length}/{items.length}
          </span>
        </div>
        <button
          type="button"
          onClick={toggleAll}
          className="text-xs text-blue-700 hover:text-blue-900 font-medium"
        >
          {allSelected ? "Quitar todos" : "Seleccionar todos"}
        </button>
      </div>
      <div className="max-h-48 overflow-y-auto space-y-2 pr-1 scrollbar-thin scrollbar-thumb-gray-300">
        {items.map((it: any) => (
          <label
            key={it.id}
            className={`flex items-center gap-2 text-sm p-2 rounded-lg cursor-pointer transition ${selected.includes(it.id) ? 'bg-blue-50' : 'hover:bg-gray-100'
              }`}
          >
            <input
              type="checkbox"
              checked={selected.includes(it.id)}
              onChange={() => toggleOne(it.id)}
              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <span className={it.isActive === false ? 'text-gray-400 line-through' : 'text-gray-800'}>
              {label(it)}
            </span>
            {it.unitType && (
              <span className="text-xs text-gray-500 ml-auto">
                {it.unitType === 'METER' ? '📏' : '📦'}
              </span>
            )}
          </label>
        ))}
        {items.length === 0 && (
          <div className="text-sm text-gray-500 py-2 text-center">
            No hay opciones disponibles
          </div>
        )}
      </div>
    </div>
  );
};

const DashboardPage: React.FC = () => {

  const navigate = useNavigate();
  const { user } = useAuth();

  const [branches, setBranches] = useState<Branch[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [data, setData] = useState<any>(null);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [preset, setPreset] = useState<RangePreset>("week");
  const [filters, setFilters] = useState<DashboardFilters>(() => {
    const r = presetRange("week");
    return { ...r, branchIds: [], productIds: [] };
  });

  const money = (n: number) =>
    new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(n);

  const numberFormat = (n: number) => new Intl.NumberFormat("es-MX").format(n);

  async function loadData(f: DashboardFilters) {
    const [b, p, d] = await Promise.all([
      getDashboardBranches(),
      getDashboardProducts(),
      getDashboardData(f),
    ]);
    setBranches(b);
    setProducts(p);
    setData(d);
  }

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        await loadData(filters);
      } catch (e: any) {
        setError(e?.message || "Error cargando dashboard");
        console.error(e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const applyFilters = async () => {
    setRefreshing(true);
    setError(null);
    try {
      const d = await getDashboardData(filters);
      setData(d);
    } catch (e: any) {
      setError(e?.message || "Error aplicando filtros");
    } finally {
      setRefreshing(false);
    }
  };

  const setPresetRange = (p: RangePreset) => {
    setPreset(p);
    if (p === "custom") return;
    const r = presetRange(p);
    setFilters((prev) => ({ ...prev, ...r }));
  };

  if (loading && !data) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center">
        <div className="text-center">
          <div className="relative">
            <div className="w-20 h-20 border-4 border-gray-200 border-t-blue-600 rounded-full animate-spin"></div>
          </div>
          <p className="text-gray-600 mt-4">Cargando dashboard...</p>
        </div>
      </div>
    );
  }

  const customers = data?.customers;
  const quick = data?.quick;

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-4 md:p-6">
      
      <div className="max-w-7xl mx-auto space-y-6">
        
        {/* Header */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-gradient-to-r from-blue-600 to-indigo-600 rounded-2xl shadow-lg">
                <BarChart3 className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">Dashboard Administrativo</h1>
                <p className="text-sm text-gray-600">
                  {new Date().toLocaleDateString('es-MX', {
                    weekday: 'long',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                  })}
                </p>
              </div>
            </div>
           
            <div className="flex items-center gap-3">
              <div className="text-right">
                <p className="text-sm text-gray-600">Bienvenido,</p>
                <p className="font-medium text-gray-900">{user?.name}</p>
              </div>
              <button
                onClick={applyFilters}
                disabled={refreshing}
                className="px-4 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-xl hover:from-blue-700 hover:to-indigo-700 flex items-center gap-2 disabled:opacity-50 shadow-sm transition-all"
              >
                {refreshing ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <RefreshCw className="w-4 h-4" />
                )}
                Actualizar
              </button>
            </div>
          </div>

          {/* Quick Stats */}
          {quick && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6 pt-6 border-t border-gray-100">
              <div className="text-center">
                <p className="text-xs text-gray-500">Hoy</p>
                <p className="text-xl font-bold text-gray-900">{money(quick.today.revenue)}</p>
                <p className="text-xs text-gray-500">{quick.today.quantity} unidades</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-gray-500">Semana</p>
                <p className="text-xl font-bold text-gray-900">{money(quick.week.revenue)}</p>
                <p className="text-xs text-gray-500">{quick.week.quantity} unidades</p>
              </div>
              <div className="text-center col-span-2 md:col-span-1">
                <p className="text-xs text-gray-500">Semana</p>
                <p className="text-sm text-gray-700">
                  {new Date(quick.week.from).toLocaleDateString()} - {new Date(quick.week.to).toLocaleDateString()}
                </p>
              </div>
              
            </div>
            
          )}
          
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-sm text-red-700 flex items-center gap-2">
            <div className="w-1 h-8 bg-red-500 rounded-full"></div>
            {error}
          </div>
        )}
  
        {/* Filtros */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-2 bg-blue-100 rounded-lg">
              <Filter className="w-5 h-5 text-blue-700" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Filtros</h3>
              <p className="text-sm text-gray-500">Selecciona el período, sucursales y productos</p>
            </div>
          </div>

          {/* Presets */}
          <div className="flex flex-wrap gap-2 mb-6">
            {(["day", "week", "month", "year", "custom"] as RangePreset[]).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPresetRange(p)}
                className={`px-4 py-2 rounded-xl border text-sm font-medium transition-all ${preset === p
                  ? "bg-gradient-to-r from-blue-600 to-indigo-600 text-white border-transparent shadow-md"
                  : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50 hover:border-gray-400"
                  }`}
              >
                {p === "day" ? "Hoy" :
                  p === "week" ? "Esta semana" :
                    p === "month" ? "Este mes" :
                      p === "year" ? "Este año" : "Personalizado"}
              </button>
            ))}
          </div>

          {/* Fechas */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                <Calendar className="w-4 h-4 inline mr-2 text-gray-500" />
                Fecha inicio
              </label>
              <input
                type="date"
                value={filters.startDate || ""}
                onChange={(e) => {
                  setPreset("custom");
                  setFilters((prev) => ({ ...prev, startDate: e.target.value }));
                }}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                <Calendar className="w-4 h-4 inline mr-2 text-gray-500" />
                Fecha fin
              </label>
              <input
                type="date"
                value={filters.endDate || ""}
                onChange={(e) => {
                  setPreset("custom");
                  setFilters((prev) => ({ ...prev, endDate: e.target.value }));
                }}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>

          {/* Checkboxes */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
            <CheckboxList
              title="Sucursales"
              items={branches}
              selected={filters.branchIds || []}
              onChange={(ids) => setFilters((prev) => ({ ...prev, branchIds: ids }))}
              label={(b: Branch) => b.name}
              icon={Building}
            />
            <CheckboxList
              title="Productos"
              items={products}
              selected={filters.productIds || []}
              onChange={(ids) => setFilters((prev) => ({ ...prev, productIds: ids }))}
              label={(p: Product) => `${p.name}`}
              icon={Package}
            />
          </div>

          <div className="flex justify-end">
            <button
              onClick={applyFilters}
              disabled={refreshing}
              className="px-6 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-medium rounded-xl disabled:opacity-50 flex items-center gap-2 shadow-md transition-all"
            >
              {refreshing ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Aplicar filtros
            </button>
          </div>
        </div>

        {/* Cards principales */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          <Stat
            title="Ingresos totales"
            value={money(data?.stats.totalRevenue || 0)}
            icon={DollarSign}
            tone="green"
            sub="En el período seleccionado"
          />
          <Stat
            title="Pedidos"
            value={numberFormat(data?.stats.totalOrders || 0)}
            icon={ShoppingBag}
            tone="blue"
            sub={`Promedio: ${money(data?.stats.avgOrderValue || 0)}`}
          />
          <Stat
            title="Clientes nuevos"
            value={numberFormat(customers?.newCustomersInRange || 0)}
            icon={Users}
            tone="purple"
            sub={`Últimos 7 días: ${customers?.newCustomersLast7 || 0}`}
          />
          <Stat
            title="Clientes activos"
            value={numberFormat(customers?.activeCustomersInRange || 0)}
            icon={Users}
            tone="orange"
            sub={`30 días: ${customers?.activeCustomersLast30 || 0}`}
          />
        </div>

        {/* Métricas por unidad */}
        <div className="grid grid-cols-2 gap-6">
          <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-2xl border border-blue-100 p-6">
            <div className="flex items-center gap-3 mb-2">
              <Layers className="w-5 h-5 text-blue-700" />
              <span className="text-sm font-medium text-blue-700">Metros vendidos</span>
            </div>
            <div className="text-3xl font-bold text-gray-900">
              {numberFormat(data?.stats.metricsByUnitType?.meters || 0)} m
            </div>
          </div>
          <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-2xl border border-green-100 p-6">
            <div className="flex items-center gap-3 mb-2">
              <Grid3x3 className="w-5 h-5 text-green-700" />
              <span className="text-sm font-medium text-green-700">Piezas vendidas</span>
            </div>
            <div className="text-3xl font-bold text-gray-900">
              {numberFormat(data?.stats.metricsByUnitType?.pieces || 0)} pz
            </div>
          </div>
        </div>

        {/* Gráfica Top productos */}
        <TopProductsChart items={data?.topProducts || []} formatMoney={money} />

        {/* Segunda fila de gráficas */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Métodos de pago */}
          <PaymentMethodChart data={data?.paymentMethods || []} formatMoney={money} />

          {/* Ingresos por sucursal */}
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
            <div className="flex items-center gap-2 mb-4">
              <div className="p-2 bg-indigo-100 rounded-lg">
                <Building className="w-5 h-5 text-indigo-700" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900">Ingresos por Sucursal</h3>
            </div>

            <div className="space-y-3 max-h-80 overflow-y-auto pr-2 scrollbar-thin">
              {(data?.ordersByBranch || [])
                .sort((a: any, b: any) => b.revenue - a.revenue)
                .map((b: any, index: number) => (
                  <div
                    key={b.branchId}
                    className="flex items-center justify-between p-3 rounded-xl bg-gradient-to-r from-gray-50 to-white border border-gray-100 hover:shadow-sm transition"
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-1 h-8 rounded-full bg-${COLORS[index % COLORS.length].toLowerCase()}`}></div>
                      <div>
                        <div className="font-medium text-gray-900">{b.branch}</div>
                        <div className="text-xs text-gray-500">{b.orders} pedidos</div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-bold text-gray-900">{money(b.revenue)}</div>
                      <div className="text-xs text-gray-500">
                        {((b.revenue / (data?.stats.totalRevenue || 1)) * 100).toFixed(1)}%
                      </div>
                    </div>
                  </div>
                ))}
              {(!data?.ordersByBranch || data.ordersByBranch.length === 0) && (
                <div className="text-center text-gray-500 py-8">
                  Sin datos para mostrar
                </div>
              )}
            </div>
          </div>
        </div>
        {/* Footer */}
        <div className="text-xs text-gray-500 flex items-center justify-end gap-4">
          <span className="flex items-center gap-1">
            <RefreshCw className="w-3 h-3" />
            Última actualización: {new Date().toLocaleTimeString("es-MX")}
          </span>
        </div>
      </div>
    </div>
  );
};

export default DashboardPage;