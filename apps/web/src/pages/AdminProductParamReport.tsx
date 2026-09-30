import { useEffect, useState } from "react";
import { BarChart3, Building, Calendar, Loader2, Ruler, SlidersHorizontal } from "lucide-react";
import { getDashboardBranches, getDashboardProducts, type Branch, type Product } from "../api/dashboard";
import { adminGetProduct } from "../api/adminProducts";
import { getProductParamReport, type ProductParamReport } from "../api/productParamReport";
import { ApiError } from "../api/http";
import {
  presetRange,
  type DashboardSelection,
  type RangePreset,
} from "../lib/dashboardFilters";
import { DashboardCheckboxList } from "./components/DashboardCheckboxList";

type ParamOption = {
  id: number;
  name: string;
  chargeType: "PER_METER" | "PER_PIECE";
};

type VariantOption = {
  id: number;
  name: string;
};

const inputClass =
  "w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-slate-900 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-100 disabled:text-slate-500";

const PRESETS: RangePreset[] = ["day", "week", "month", "year", "custom"];

function presetLabel(preset: RangePreset) {
  if (preset === "day") return "Hoy";
  if (preset === "week") return "Esta semana";
  if (preset === "month") return "Este mes";
  if (preset === "year") return "Este año";
  return "Personalizado";
}

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof ApiError) return error.message;
  return error instanceof Error ? error.message : fallback;
}

function unitLabel(unitType: "METER" | "PIECE" | undefined, quantity: number) {
  if (unitType === "PIECE") return quantity === 1 ? "pieza" : "piezas";
  return "metros";
}

// null = "todas" (sin filtro); [] es un estado inválido para enviar (no
// distingue de "todas" en el backend), así que antes de mandar la selección
// de sucursales se convierte a undefined cuando es null.
function selectionToBranchIds(selected: DashboardSelection): number[] | undefined {
  return selected === null ? undefined : selected;
}

// A diferencia de sucursales, [] SÍ es un estado válido para parámetros y
// tamaños (significa "no mostrar desglose"), y null ("todos") debe
// traducirse a la lista completa de ids para pedir el desglose de todos.
function selectionToExplicitIds(selected: DashboardSelection, allIds: number[]): number[] {
  return selected === null ? allIds : selected;
}

export default function AdminProductParamReport() {
  const [products, setProducts] = useState<Product[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [filtersError, setFiltersError] = useState<string | null>(null);

  const [productId, setProductId] = useState<string>("");
  const [branchSelection, setBranchSelection] = useState<DashboardSelection>(null);

  const [preset, setPreset] = useState<RangePreset>("custom");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const [paramOptions, setParamOptions] = useState<ParamOption[]>([]);
  const [variantOptions, setVariantOptions] = useState<VariantOption[]>([]);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [paramSelection, setParamSelection] = useState<DashboardSelection>([]);
  const [variantSelection, setVariantSelection] = useState<DashboardSelection>([]);

  const [report, setReport] = useState<ProductParamReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [productsData, branchesData] = await Promise.all([
          getDashboardProducts(),
          getDashboardBranches(),
        ]);
        setProducts(productsData);
        setBranches(branchesData);
      } catch (e) {
        setFiltersError(errorMessage(e, "Error cargando productos y sucursales"));
      }
    })();
  }, []);

  useEffect(() => {
    setParamSelection([]);
    setVariantSelection([]);
    setParamOptions([]);
    setVariantOptions([]);
    setReport(null);

    if (!productId) return;

    let cancelled = false;
    setDetailsLoading(true);
    (async () => {
      try {
        const { product } = await adminGetProduct(Number(productId));
        if (cancelled) return;
        setParamOptions(
          (product.params ?? [])
            .filter((param) => param.isActive)
            .map((param) => ({ id: param.id, name: param.name, chargeType: param.chargeType }))
        );
        setVariantOptions(
          (product.variants ?? [])
            .filter((variant) => variant.isActive)
            .map((variant) => ({ id: variant.id, name: variant.name }))
        );
      } catch (e) {
        if (!cancelled) setError(errorMessage(e, "Error cargando detalles del producto"));
      } finally {
        if (!cancelled) setDetailsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [productId]);

  function applyPreset(next: RangePreset) {
    setPreset(next);
    if (next === "custom") return;
    const range = presetRange(next);
    setDateFrom(range.startDate);
    setDateTo(range.endDate);
  }

  const branchSelectionInvalid = branchSelection !== null && branchSelection.length === 0 && branches.length > 0;

  async function handleGenerate() {
    if (!productId || branchSelectionInvalid) return;

    setLoading(true);
    setError(null);
    try {
      const data = await getProductParamReport({
        productId: Number(productId),
        branchIds: selectionToBranchIds(branchSelection),
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        paramIds: selectionToExplicitIds(paramSelection, paramOptions.map((p) => p.id)),
        variantIds: selectionToExplicitIds(variantSelection, variantOptions.map((v) => v.id)),
      });
      setReport(data);
    } catch (e) {
      setError(errorMessage(e, "Error generando el reporte"));
      setReport(null);
    } finally {
      setLoading(false);
    }
  }

  const selectedProduct = products.find((product) => product.id === Number(productId));

  return (
    <div className="min-h-[calc(100dvh-4rem)] bg-slate-50 p-4 sm:p-6">
      <div className="mx-auto max-w-5xl">
        <header className="mb-6">
          <p className="text-sm font-bold uppercase tracking-[0.18em] text-indigo-600">Reportes</p>
          <h1 className="mt-1 flex items-center gap-2 text-3xl font-black text-slate-950">
            <BarChart3 className="h-7 w-7 text-indigo-600" />
            Reporte por producto y parámetro
          </h1>
          <p className="mt-2 max-w-2xl text-slate-600">
            Consulta la cantidad total vendida de un producto, filtrando por sucursales, fechas,
            parámetros y tamaños.
          </p>
        </header>

        {filtersError && (
          <div role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">
            {filtersError}
          </div>
        )}

        <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <label className="mb-4 block">
            <span className="mb-1 block text-sm font-semibold text-slate-700">Producto</span>
            <select
              value={productId}
              onChange={(event) => setProductId(event.target.value)}
              className={inputClass}
            >
              <option value="">Selecciona un producto</option>
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name}
                </option>
              ))}
            </select>
          </label>

          {/* Presets de fecha */}
          <div className="mb-3 flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => applyPreset(p)}
                className={`rounded-xl border px-4 py-2 text-sm font-medium transition-all ${
                  preset === p
                    ? "border-transparent bg-indigo-600 text-white shadow-sm"
                    : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                }`}
              >
                {presetLabel(p)}
              </button>
            ))}
          </div>

          <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-2">
            <label>
              <span className="mb-1 block text-sm font-semibold text-slate-700">
                <Calendar className="mr-1 inline h-4 w-4 text-slate-500" />
                Desde
              </span>
              <input
                type="date"
                value={dateFrom}
                onChange={(event) => {
                  setPreset("custom");
                  setDateFrom(event.target.value);
                }}
                className={inputClass}
              />
            </label>

            <label>
              <span className="mb-1 block text-sm font-semibold text-slate-700">
                <Calendar className="mr-1 inline h-4 w-4 text-slate-500" />
                Hasta
              </span>
              <input
                type="date"
                value={dateTo}
                onChange={(event) => {
                  setPreset("custom");
                  setDateTo(event.target.value);
                }}
                className={inputClass}
              />
            </label>
          </div>

          <div className="mb-4">
            <DashboardCheckboxList
              title="Sucursales"
              items={branches}
              selected={branchSelection}
              onChange={setBranchSelection}
              label={(b: Branch) => b.name}
              icon={Building}
              emptyLabel="No hay sucursales disponibles"
              loadingLabel="Cargando sucursales..."
            />
            {branchSelectionInvalid && (
              <p className="mt-2 text-sm font-medium text-red-700">
                Selecciona al menos una sucursal o usa "Seleccionar todos".
              </p>
            )}
          </div>

          {!productId && (
            <p className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-500">
              Selecciona un producto para ver sus parámetros y tamaños.
            </p>
          )}

          {productId && (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <DashboardCheckboxList
                title="Parámetros"
                items={paramOptions}
                selected={paramSelection}
                onChange={setParamSelection}
                label={(p: ParamOption) => p.name}
                icon={SlidersHorizontal}
                loading={detailsLoading}
                loadingLabel="Cargando parámetros..."
                emptyLabel="Este producto no tiene parámetros activos configurados."
              />
              <DashboardCheckboxList
                title="Tamaño"
                items={variantOptions}
                selected={variantSelection}
                onChange={setVariantSelection}
                label={(v: VariantOption) => v.name}
                icon={Ruler}
                loading={detailsLoading}
                loadingLabel="Cargando tamaños..."
                emptyLabel="Este producto no tiene tamaños activos configurados."
              />
            </div>
          )}

          <button
            type="button"
            onClick={() => void handleGenerate()}
            disabled={!productId || loading || branchSelectionInvalid}
            className="mt-5 inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 py-3 font-bold text-white shadow-sm hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            Generar reporte
          </button>
        </section>

        {error && (
          <div role="alert" className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">
            {error}
          </div>
        )}

        {report && (
          <section className="space-y-6">
            <div className="rounded-2xl border border-indigo-100 bg-indigo-50 p-6">
              <p className="text-sm font-bold uppercase tracking-[0.16em] text-indigo-700">
                {report.productName} · {report.branchLabel}
              </p>
              <p className="mt-2 text-4xl font-black text-indigo-950">
                {report.totalQuantity.toLocaleString("es-MX", { maximumFractionDigits: 3 })}{" "}
                <span className="text-xl font-bold text-indigo-700">
                  {unitLabel(report.unitType, report.totalQuantity)}
                </span>
              </p>
              <p className="mt-1 text-sm text-indigo-800">
                {report.dateFrom || report.dateTo
                  ? `Del ${report.dateFrom ?? "el inicio"} al ${report.dateTo ?? "hoy"}`
                  : "Todo el histórico"}
              </p>
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              {report.byParam.length > 0 && (
                <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                  <div className="border-b border-slate-100 bg-slate-50 px-4 py-3">
                    <p className="font-semibold text-slate-900">Por parámetro</p>
                  </div>
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 text-slate-600">
                      <tr>
                        <th className="px-4 py-3 font-semibold">Parámetro</th>
                        <th className="px-4 py-3 font-semibold">Tipo de cargo</th>
                        <th className="px-4 py-3 text-right font-semibold">Cantidad</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {report.byParam.map((row) => (
                        <tr key={row.paramId}>
                          <td className="px-4 py-3 font-medium text-slate-900">{row.paramName}</td>
                          <td className="px-4 py-3 text-slate-600">
                            {row.chargeType === "PER_METER" ? "Por metro" : "Por pieza"}
                          </td>
                          <td className="px-4 py-3 text-right font-semibold text-slate-900">
                            {row.quantity.toLocaleString("es-MX", { maximumFractionDigits: 3 })}{" "}
                            {unitLabel(report.unitType, row.quantity)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {report.byVariant.length > 0 && (
                <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                  <div className="border-b border-slate-100 bg-slate-50 px-4 py-3">
                    <p className="font-semibold text-slate-900">Por tamaño</p>
                  </div>
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 text-slate-600">
                      <tr>
                        <th className="px-4 py-3 font-semibold">Tamaño</th>
                        <th className="px-4 py-3 text-right font-semibold">Cantidad</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {report.byVariant.map((row) => (
                        <tr key={row.variantId}>
                          <td className="px-4 py-3 font-medium text-slate-900">{row.variantName}</td>
                          <td className="px-4 py-3 text-right font-semibold text-slate-900">
                            {row.quantity.toLocaleString("es-MX", { maximumFractionDigits: 3 })}{" "}
                            {unitLabel(report.unitType, row.quantity)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>
        )}

        {!selectedProduct && !report && (
          <p className="text-sm text-slate-500">Elige un producto y presiona "Generar reporte" para ver resultados.</p>
        )}
      </div>
    </div>
  );
}
