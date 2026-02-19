// AdminPricing.tsx
import { Fragment, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  type Branch,
  type BranchProductRow,
  type QuantityPriceRow,
  type VariantPriceRow,
  type ParamPriceRow,
  getBranches,
  getBranchProducts,
  setBranchProductPrice,
  setBranchProductQuantityPrices,
  setBranchProductVariantPrices,
  setBranchProductParamPrices,
  setBranchProductVariantQuantityMatrix,
} from "../api/pricing";
import MatrizPreciosTamañoCantidad from "./components/MatrizPreciosTamañoCantidad";
import {
  Building,
  Search,
  Filter,
  RefreshCw,
  Save,
  Edit2,
  ChevronDown,
  ChevronUp,
  DollarSign,
  Package,
  Settings,
  CheckCircle,
  AlertCircle,
  Info
} from "lucide-react";

type FiltroEstado = "todos" | "activos" | "inactivos";

function normalizarNumero(s: string) {
  return s.trim().replace(",", ".");
}

function esNumeroValido(s: string) {
  if (!s.trim()) return false;
  const n = Number(normalizarNumero(s));
  return Number.isFinite(n);
}

export default function AdminPricing() {
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const branchIdFromQuery = sp.get("branchId");
  const productIdFromQuery = sp.get("productId");

  const [sucursales, setSucursales] = useState<Branch[]>([]);
  const [sucursalId, setSucursalId] = useState<number | null>(null);

  const [filas, setFilas] = useState<BranchProductRow[]>([]);
  const [cargando, setCargando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [busqueda, setBusqueda] = useState("");
  const [filtroEstado, setFiltroEstado] = useState<FiltroEstado>("todos");

  const [precioBaseEdit, setPrecioBaseEdit] = useState<Record<number, string>>({});
  const [activoEdit, setActivoEdit] = useState<Record<number, boolean>>({});

  const [preciosCantidadEdit, setPreciosCantidadEdit] = useState<Record<number, QuantityPriceRow[]>>({});
  const [preciosVarianteEdit, setPreciosVarianteEdit] = useState<Record<number, VariantPriceRow[]>>({});
  const [preciosParamEdit, setPreciosParamEdit] = useState<Record<number, ParamPriceRow[]>>({});
  const [preciosMatrizEdit, setPreciosMatrizEdit] = useState<
    Record<number, Record<number, QuantityPriceRow[]>>
  >({});

  const [abierto, setAbierto] = useState<Record<number, boolean>>({});

  async function cargarSucursales() {
    try {
      setError(null);
      const data = await getBranches();
      setSucursales(data);
      const primera = data.find((x: { isActive: any; }) => x.isActive) ?? data[0];

      const desired = branchIdFromQuery ? Number(branchIdFromQuery) : null;
      if (desired && Number.isFinite(desired) && data.some((b: { id: number; }) => b.id === desired)) {
        setSucursalId(desired);
      } else if (primera && sucursalId === null) {
        setSucursalId(primera.id);
      }
    } catch (e: any) {
      setError(e?.message ?? "Error cargando sucursales");
    }
  }

  async function cargarProductosDeSucursal(bid: number) {
    try {
      setCargando(true);
      setError(null);

      const data = await getBranchProducts(bid);
      setFilas(data);

      const p: Record<number, string> = {};
      const a: Record<number, boolean> = {};
      const qc: Record<number, QuantityPriceRow[]> = {};
      const vp: Record<number, VariantPriceRow[]> = {};
      const pp: Record<number, ParamPriceRow[]> = {};
      const pm: Record<number, Record<number, QuantityPriceRow[]>> = {};

      for (const r of data) {
        const pid = r.productId;
        p[pid] = String(r.price ?? "0");
        a[pid] = !!r.isActive;

        qc[pid] = (r.quantityPrices ?? []).map((x) => ({
          id: x.id,
          minQty: String(x.minQty),
          unitPrice: String(x.unitPrice),
          isActive: !!x.isActive,
        }));

        vp[pid] = (r.variantPrices ?? []).map((x) => ({
          id: x.id ?? undefined,
          variantId: x.variantId,
          variantName: x.variantName,
          price: String(x.price ?? "0"),
          isActive: !!x.isActive,
          variantIsActive: x.variantIsActive,
        }));

        pp[pid] = (r.paramPrices ?? []).map((x) => ({
          id: x.id ?? undefined,
          paramId: x.paramId,
          paramName: x.paramName,
          priceDelta: String(x.priceDelta ?? "0"),
          isActive: !!x.isActive,
          paramIsActive: x.paramIsActive,
        }));

        pm[pid] = r.variantQuantityMatrix || {};
      }

      setPrecioBaseEdit(p);
      setActivoEdit(a);
      setPreciosCantidadEdit(qc);
      setPreciosVarianteEdit(vp);
      setPreciosParamEdit(pp);
      setPreciosMatrizEdit(pm);

      const pidQ = productIdFromQuery ? Number(productIdFromQuery) : null;
      if (pidQ && Number.isFinite(pidQ)) {
        setAbierto((m) => ({ ...m, [pidQ]: true }));
      }
    } catch (e: any) {
      setError(e?.message ?? "Error cargando productos");
    } finally {
      setCargando(false);
    }
  }

  useEffect(() => {
    cargarSucursales();
  }, []);

  useEffect(() => {
    if (sucursalId === null) return;
    cargarProductosDeSucursal(sucursalId);
  }, [sucursalId]);

  const filasFiltradas = useMemo(() => {
    const t = busqueda.trim().toLowerCase();

    return filas.filter((r) => {
      const activo = !!activoEdit[r.productId];
      if (filtroEstado === "activos" && !activo) return false;
      if (filtroEstado === "inactivos" && activo) return false;

      if (!t) return true;

      const porId = String(r.productId).includes(t);
      const porNombre = r.product.name.toLowerCase().includes(t);
      const porUnidad = r.product.unitType.toLowerCase().includes(t);
      return porId || porNombre || porUnidad;
    });
  }, [filas, busqueda, filtroEstado, activoEdit]);

  function agregarFilaMatriz(productId: number, variantId: number) {
    setPreciosMatrizEdit((prev) => {
      const productoPrev = prev[productId] || {};
      const variantePrev = productoPrev[variantId] || [];

      return {
        ...prev,
        [productId]: {
          ...productoPrev,
          [variantId]: [...variantePrev, { minQty: "1", unitPrice: "0", isActive: true }],
        },
      };
    });
  }

  function eliminarFilaMatriz(productId: number, variantId: number, index: number) {
    setPreciosMatrizEdit((prev) => {
      const productoPrev = prev[productId] || {};
      const variantePrev = productoPrev[variantId] || [];

      return {
        ...prev,
        [productId]: {
          ...productoPrev,
          [variantId]: variantePrev.filter((_, i) => i !== index),
        },
      };
    });
  }

  function cambiarFilaMatriz(
    productId: number,
    variantId: number,
    index: number,
    field: keyof QuantityPriceRow,
    value: string | boolean
  ) {
    setPreciosMatrizEdit((prev) => {
      const productoPrev = prev[productId] || {};
      const variantePrev = productoPrev[variantId] || [];
      const next = [...variantePrev];

      next[index] = {
        ...next[index],
        [field]: value
      };

      return {
        ...prev,
        [productId]: {
          ...productoPrev,
          [variantId]: next,
        },
      };
    });
  }

  async function guardarMatrizPrecios(productId: number) {
    if (sucursalId === null) return;
    const matriz = preciosMatrizEdit[productId] || {};

    for (const [variantIdStr, filas] of Object.entries(matriz)) {
      const variantId = parseInt(variantIdStr);

      for (const fila of filas) {
        if (!esNumeroValido(fila.minQty)) {
          setError(`En variante ${variantId}: 'Cantidad mínima' debe ser número.`);
          return;
        }
        if (!esNumeroValido(fila.unitPrice)) {
          setError(`En variante ${variantId}: 'Precio unitario' debe ser número.`);
          return;
        }
        if (Number(normalizarNumero(fila.minQty)) <= 0) {
          setError(`En variante ${variantId}: la cantidad mínima debe ser > 0.`);
          return;
        }
        if (Number(normalizarNumero(fila.unitPrice)) < 0) {
          setError(`En variante ${variantId}: el precio no puede ser negativo.`);
          return;
        }
      }
    }

    setGuardando(true);
    setError(null);
    try {
      await setBranchProductVariantQuantityMatrix(sucursalId, productId, matriz);
      await cargarProductosDeSucursal(sucursalId);
    } catch (e: any) {
      setError(e?.message ?? "Error guardando matriz de precios");
    } finally {
      setGuardando(false);
    }
  }

  async function guardarPrecioBase(productId: number) {
    if (sucursalId === null) return;
    const price = precioBaseEdit[productId] ?? "";
    if (!esNumeroValido(price)) {
      setError("El precio base debe ser un número válido.");
      return;
    }

    setGuardando(true);
    setError(null);
    try {
      await setBranchProductPrice(sucursalId, productId, normalizarNumero(price), !!activoEdit[productId]);
      await cargarProductosDeSucursal(sucursalId);
    } catch (e: any) {
      setError(e?.message ?? "Error guardando precio base");
    } finally {
      setGuardando(false);
    }
  }

  function cambiarFilaCantidad(
    productId: number,
    index: number,
    field: keyof QuantityPriceRow,
    value: string | boolean
  ) {
    setPreciosCantidadEdit((m) => {
      const prev = m[productId] ?? [];
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return { ...m, [productId]: next };
    });
  }

  function cambiarPrecioVariante(
    productId: number,
    variantId: number,
    field: keyof VariantPriceRow,
    value: string | boolean
  ) {
    setPreciosVarianteEdit((m) => {
      const prev = m[productId] ?? [];
      const next = prev.map((v) =>
        v.variantId === variantId ? { ...v, [field]: value } : v
      );
      return { ...m, [productId]: next };
    });
  }

  function cambiarPrecioParam(
    productId: number,
    paramId: number,
    field: keyof ParamPriceRow,
    value: string | boolean
  ) {
    setPreciosParamEdit((m) => {
      const prev = m[productId] ?? [];
      const next = prev.map((p) =>
        p.paramId === paramId ? { ...p, [field]: value } : p
      );
      return { ...m, [productId]: next };
    });
  }

  async function guardarPreciosCantidad(productId: number) {
    if (sucursalId === null) return;
    const rows = preciosCantidadEdit[productId] ?? [];

    for (const r of rows) {
      if (!esNumeroValido(r.minQty)) return setError("En precios por cantidad: 'Cantidad mínima' debe ser número.");
      if (!esNumeroValido(r.unitPrice)) return setError("En precios por cantidad: 'Precio unitario' debe ser número.");
      if (Number(normalizarNumero(r.minQty)) <= 0) return setError("En precios por cantidad: la cantidad mínima debe ser > 0.");
      if (Number(normalizarNumero(r.unitPrice)) < 0) return setError("En precios por cantidad: el precio no puede ser negativo.");
    }

    const seen = new Set<string>();
    for (const r of rows) {
      const key = Number(normalizarNumero(r.minQty)).toFixed(3);
      if (seen.has(key)) return setError(`Cantidad mínima duplicada: ${key}`);
      seen.add(key);
    }

    setGuardando(true);
    setError(null);
    try {
      await setBranchProductQuantityPrices(
        sucursalId,
        productId,
        rows.map((r) => ({
          minQty: normalizarNumero(r.minQty),
          unitPrice: normalizarNumero(r.unitPrice),
          isActive: !!r.isActive,
        }))
      );
      await cargarProductosDeSucursal(sucursalId);
    } catch (e: any) {
      setError(e?.message ?? "Error guardando precios por cantidad");
    } finally {
      setGuardando(false);
    }
  }

  async function guardarPreciosVariante(productId: number) {
    if (sucursalId === null) return;
    const rows = preciosVarianteEdit[productId] ?? [];

    for (const r of rows) {
      const v = (r.price ?? "").trim();
      if (v && !esNumeroValido(v)) return setError("En precios por tamaño: el precio debe ser número.");
      if (v && Number(normalizarNumero(v)) < 0) return setError("En precios por tamaño: el precio no puede ser negativo.");
    }

    setGuardando(true);
    setError(null);
    try {
      await setBranchProductVariantPrices(
        sucursalId,
        productId,
        rows.map((r) => ({
          variantId: r.variantId,
          price: normalizarNumero((r.price ?? "").trim() || "0"),
          isActive: !!r.isActive,
        }))
      );
      await cargarProductosDeSucursal(sucursalId);
    } catch (e: any) {
      setError(e?.message ?? "Error guardando precios por tamaño");
    } finally {
      setGuardando(false);
    }
  }

  async function guardarPreciosParams(productId: number) {
    if (sucursalId === null) return;
    const rows = preciosParamEdit[productId] ?? [];

    for (const r of rows) {
      const v = (r.priceDelta ?? "").trim();
      if (!v) return setError("En parámetros: el ajuste no puede ir vacío (usa 0 si no aplica).");
      if (!esNumeroValido(v)) return setError("En parámetros: el ajuste debe ser número (puede ser negativo).");
    }

    setGuardando(true);
    setError(null);
    try {
      await setBranchProductParamPrices(
        sucursalId,
        productId,
        rows.map((r) => ({
          paramId: r.paramId,
          priceDelta: normalizarNumero((r.priceDelta ?? "").trim() || "0"),
          isActive: !!r.isActive,
        }))
      );
      await cargarProductosDeSucursal(sucursalId);
    } catch (e: any) {
      setError(e?.message ?? "Error guardando precios de parámetros");
    } finally {
      setGuardando(false);
    }
  }

  function agregarFilaCantidad(productId: number) {
    setPreciosCantidadEdit((m) => {
      const prev = m[productId] ?? [];
      return {
        ...m,
        [productId]: [...prev, { minQty: "1", unitPrice: "0", isActive: true }],
      };
    });
  }

  function eliminarFilaCantidad(productId: number, index: number) {
    setPreciosCantidadEdit((m) => {
      const prev = m[productId] ?? [];
      return { ...m, [productId]: prev.filter((_, i) => i !== index) };
    });
  }

  function irAEditarProducto(pid: number) {
    if (!sucursalId) return;
    nav(`/admin/products/${pid}?fromPricing=1&branchId=${sucursalId}&productId=${pid}`);
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-4 md:p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <div className="p-3 bg-gradient-to-r from-blue-600 to-indigo-600 rounded-2xl shadow-lg">
                  <DollarSign className="w-6 h-6 text-white" />
                </div>
                <h1 className="text-3xl font-bold text-gray-900">Administrador de Precios</h1>
              </div>
              <p className="text-gray-600 max-w-3xl">
                Gestiona precios base, precios por cantidad, precios por tamaño y matriz de precios por tamaño/cantidad para cada sucursal.
              </p>
            </div>
          </div>

          {/* Controls */}
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 mb-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <Building className="w-5 h-5 text-blue-600" />
                  <label className="block text-sm font-medium text-gray-700">Sucursal:</label>
                </div>
                <select
                  value={sucursalId ?? ""}
                  onChange={(e) => setSucursalId(Number(e.target.value))}
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200"
                >
                  {sucursales.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name} {b.isActive ? "" : "(inactiva)"}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <div className="flex items-center gap-3 mb-2">
                    <Filter className="w-5 h-5 text-gray-600" />
                    <label className="block text-sm font-medium text-gray-700">Estado:</label>
                  </div>
                  <select
                    value={filtroEstado}
                    onChange={(e) => setFiltroEstado(e.target.value as any)}
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200"
                  >
                    <option value="todos">Todos los productos</option>
                    <option value="activos">Solo activos</option>
                    <option value="inactivos">Solo inactivos</option>
                  </select>
                </div>

                <div>
                  <div className="flex items-center gap-3 mb-2">
                    <Search className="w-5 h-5 text-gray-600" />
                    <label className="block text-sm font-medium text-gray-700">Buscar:</label>
                  </div>
                  <input
                    placeholder="ID, nombre o unidad..."
                    value={busqueda}
                    onChange={(e) => setBusqueda(e.target.value)}
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200 placeholder:text-gray-400"
                  />
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-4 mt-6">
              <button
                onClick={() => sucursalId !== null && cargarProductosDeSucursal(sucursalId)}
                disabled={cargando}
                className="inline-flex items-center gap-2 px-5 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-semibold rounded-xl transition-all duration-200 shadow-sm hover:shadow"
              >
                {cargando ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                    Cargando...
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-4 h-4" />
                    Actualizar productos
                  </>
                )}
              </button>
              <button
                onClick={() => nav("/admin/products/new")}
                disabled={cargando}
                className="inline-flex items-center gap-2 px-5 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-semibold rounded-xl transition-all duration-200 shadow-sm hover:shadow"
              >
                + Nuevo producto
              </button>
            </div>
            
          </div>
        </div>

        {/* Error Display */}
        {error && (
          <div className="mb-6 animate-in fade-in slide-in-from-top-3 duration-300">
            <div className="bg-red-50 border border-red-200 rounded-2xl p-4">
              <div className="flex items-center gap-3">
                <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0" />
                <div className="flex-1">
                  <p className="font-medium text-red-700">Error</p>
                  <p className="text-red-600 text-sm mt-1">{error}</p>
                </div>
                <button
                  onClick={() => setError(null)}
                  className="text-red-500 hover:text-red-700"
                >
                  ✕
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Products Table */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-lg overflow-hidden">
          {cargando ? (
            <div className="p-12 text-center">
              <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
              <p className="mt-4 text-gray-600">Cargando productos...</p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1024px]">
                  <thead>
                    <tr className="bg-gradient-to-r from-gray-50 to-gray-100 border-b border-gray-200">
                      <th className="py-4 px-6 text-left text-sm font-semibold text-gray-700">Producto</th>
                      <th className="py-4 px-6 text-left text-sm font-semibold text-gray-700">Unidad</th>
                      <th className="py-4 px-6 text-left text-sm font-semibold text-gray-700">Tamaños</th>
                      <th className="py-4 px-6 text-left text-sm font-semibold text-gray-700">Activo</th>
                      <th className="py-4 px-6 text-left text-sm font-semibold text-gray-700">Precio Base</th>
                      <th className="py-4 px-6 text-right text-sm font-semibold text-gray-700">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filasFiltradas.map((r) => {
                      const pid = r.productId;
                      const abiertoAhora = !!abierto[pid];
                      const tieneTamaños = r.product.needsVariant;

                      return (
                        <Fragment key={pid}>
                          <tr className="hover:bg-gray-50 transition-colors">
                            <td className="py-4 px-6">
                              <div>
                                <div className="font-bold text-gray-900">{r.product.name}</div>
                                <div className="text-xs text-gray-500 mt-1">ID: #{r.productId}</div>
                              </div>
                            </td>
                            <td className="py-4 px-6">
                              <span className="inline-flex items-center gap-2 px-3 py-1 bg-blue-100 text-blue-800 text-sm font-medium rounded-full">
                                <Package className="w-3 h-3" />
                                {r.product.unitType}
                              </span>
                            </td>
                            <td className="py-4 px-6">
                              {tieneTamaños ? (
                                <span className="inline-flex items-center gap-1 px-3 py-1 bg-green-100 text-green-800 text-sm font-medium rounded-full">
                                  <CheckCircle className="w-3 h-3" />
                                  Sí ({r.product.variants?.length || 0})
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-3 py-1 bg-gray-100 text-gray-800 text-sm font-medium rounded-full">
                                  No
                                </span>
                              )}
                            </td>
                            <td className="py-4 px-6">
                              <label className="inline-flex items-center cursor-pointer">
                                <div className="relative">
                                  <input
                                    type="checkbox"
                                    checked={!!activoEdit[pid]}
                                    onChange={(e) => setActivoEdit((m) => ({ ...m, [pid]: e.target.checked }))}
                                    className="sr-only"
                                  />
                                  <div className={`
                                    w-12 h-6 rounded-full transition-all duration-200
                                    ${!!activoEdit[pid] ? 'bg-green-500' : 'bg-gray-300'}
                                  `}>
                                    <div className={`
                                      absolute top-1 w-4 h-4 bg-white rounded-full transition-all duration-200
                                      ${!!activoEdit[pid] ? 'left-7' : 'left-1'}
                                    `}></div>
                                  </div>
                                </div>
                                <span className="ml-3 text-sm text-gray-700">
                                  {!!activoEdit[pid] ? 'Activo' : 'Inactivo'}
                                </span>
                              </label>
                            </td>
                            <td className="py-4 px-6">
                              <div className="relative">
                                <div className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400">$</div>
                                <input
                                  value={precioBaseEdit[pid] ?? ""}
                                  onChange={(e) => setPrecioBaseEdit((m) => ({ ...m, [pid]: e.target.value }))}
                                  className="pl-8 pr-4 py-2 w-32 bg-gray-50 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200"
                                  placeholder="0.00"
                                />
                              </div>
                            </td>
                            <td className="py-4 px-6 text-right">
                              <div className="flex items-center justify-end gap-2">
                                <button
                                  onClick={() => guardarPrecioBase(pid)}
                                  disabled={guardando}
                                  className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white font-medium rounded-lg transition-all duration-200 shadow-sm hover:shadow"
                                >
                                  <Save className="w-4 h-4" />
                                  Guardar
                                </button>
                                <button
                                  onClick={() => irAEditarProducto(pid)}
                                  className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-all duration-200 shadow-sm hover:shadow"
                                >
                                  <Edit2 className="w-4 h-4" />
                                  Editar
                                </button>
                                <button
                                  onClick={() => setAbierto((m) => ({ ...m, [pid]: !abiertoAhora }))}
                                  className="inline-flex items-center gap-2 px-4 py-2 bg-gray-900 hover:bg-black text-white font-medium rounded-lg transition-all duration-200 shadow-sm hover:shadow"
                                >
                                  <Settings className="w-4 h-4" />
                                  {abiertoAhora ? (
                                    <>
                                      <ChevronUp className="w-4 h-4" />
                                      Ocultar
                                    </>
                                  ) : (
                                    <>
                                      <ChevronDown className="w-4 h-4" />
                                      Precios Avanzados
                                    </>
                                  )}
                                </button>
                              </div>
                            </td>
                          </tr>

                          {abiertoAhora && (
                            <tr>
                              <td colSpan={6} className="bg-gray-50 p-6 border-t border-gray-200">
                                <div className="space-y-6">
                                  {/* Matriz de precios por tamaño y cantidad */}
                                  {tieneTamaños ? (
                                    <MatrizPreciosTamañoCantidad
                                      productId={pid}
                                      variantes={preciosVarianteEdit[pid] || []}
                                      preciosMatriz={preciosMatrizEdit}
                                      guardando={guardando}
                                      onAddRow={agregarFilaMatriz}
                                      onRemoveRow={eliminarFilaMatriz}
                                      onChangeRow={cambiarFilaMatriz}
                                      onSave={guardarMatrizPrecios}
                                    />
                                  ) : (
                                    /* Precios por cantidad (solo para productos SIN tamaños) */
                                    <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
                                      <div className="flex items-center gap-3 mb-4">
                                        <div className="p-2 bg-gradient-to-r from-purple-100 to-indigo-100 rounded-lg">
                                          <DollarSign className="w-5 h-5 text-purple-600" />
                                        </div>
                                        <div>
                                          <h3 className="font-bold text-lg text-gray-900">Precios por Cantidad</h3>
                                          <p className="text-sm text-gray-500">Define precios basados en cantidad para productos sin tamaños</p>
                                        </div>
                                      </div>

                                      <div className="overflow-x-auto rounded-lg border border-gray-200">
                                        <table className="w-full min-w-[600px]">
                                          <thead className="bg-gray-50">
                                            <tr>
                                              <th className="py-3 px-4 text-left text-sm font-semibold text-gray-700">Cantidad Mínima</th>
                                              <th className="py-3 px-4 text-left text-sm font-semibold text-gray-700">Precio Unitario</th>
                                              <th className="py-3 px-4 text-left text-sm font-semibold text-gray-700">Activo</th>
                                              <th className="py-3 px-4 text-right text-sm font-semibold text-gray-700">Acciones</th>
                                            </tr>
                                          </thead>
                                          <tbody className="divide-y divide-gray-200">
                                            {(preciosCantidadEdit[pid] ?? []).map((row, idx) => (
                                              <tr key={idx} className="hover:bg-gray-50">
                                                <td className="py-3 px-4">
                                                  <input
                                                    value={row.minQty}
                                                    onChange={(e) => cambiarFilaCantidad(pid, idx, 'minQty', e.target.value)}
                                                    className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200"
                                                    placeholder={r.product.unitType === "METER" ? "0.5" : "1"}
                                                  />
                                                </td>
                                                <td className="py-3 px-4">
                                                  <div className="relative">
                                                    <div className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400">$</div>
                                                    <input
                                                      value={row.unitPrice}
                                                      onChange={(e) => cambiarFilaCantidad(pid, idx, 'unitPrice', e.target.value)}
                                                      className="pl-8 pr-3 py-2 w-full bg-gray-50 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200"
                                                      placeholder="0.00"
                                                    />
                                                  </div>
                                                </td>
                                                <td className="py-3 px-4">
                                                  <label className="inline-flex items-center">
                                                    <input
                                                      type="checkbox"
                                                      checked={row.isActive}
                                                      onChange={(e) => cambiarFilaCantidad(pid, idx, 'isActive', e.target.checked)}
                                                      className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                                                    />
                                                    <span className="ml-2 text-sm text-gray-700">Activo</span>
                                                  </label>
                                                </td>
                                                <td className="py-3 px-4 text-right">
                                                  <button
                                                    onClick={() => eliminarFilaCantidad(pid, idx)}
                                                    className="px-3 py-1.5 bg-red-100 hover:bg-red-200 text-red-700 font-medium rounded-lg transition-colors text-sm"
                                                  >
                                                    Eliminar
                                                  </button>
                                                </td>
                                              </tr>
                                            ))}

                                            {(preciosCantidadEdit[pid] ?? []).length === 0 && (
                                              <tr>
                                                <td colSpan={4} className="py-8 px-4 text-center text-gray-500">
                                                  <div className="flex flex-col items-center gap-2">
                                                    <DollarSign className="w-8 h-8 text-gray-300" />
                                                    <p>No hay precios por cantidad configurados</p>
                                                    <p className="text-sm">Se usará el precio base para todas las cantidades</p>
                                                  </div>
                                                </td>
                                              </tr>
                                            )}
                                          </tbody>
                                        </table>
                                      </div>

                                      <div className="flex flex-wrap justify-between items-center gap-4 mt-6">
                                        <button
                                          onClick={() => agregarFilaCantidad(pid)}
                                          className="inline-flex items-center gap-2 px-4 py-2.5 bg-white hover:bg-gray-50 text-gray-700 font-medium rounded-lg border border-gray-300 shadow-sm hover:shadow transition-all duration-200"
                                        >
                                          + Agregar Fila
                                        </button>
                                        <button
                                          onClick={() => guardarPreciosCantidad(pid)}
                                          disabled={guardando}
                                          className="inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white font-semibold rounded-lg transition-all duration-200 shadow-sm hover:shadow"
                                        >
                                          {guardando ? (
                                            <>
                                              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                                              Guardando...
                                            </>
                                          ) : (
                                            <>
                                              <Save className="w-4 h-4" />
                                              Guardar Precios por Cantidad
                                            </>
                                          )}
                                        </button>
                                      </div>
                                    </div>
                                  )}

                                  {/* Precios por tamaño (precios base por tamaño) */}
                                  {tieneTamaños && (
                                    <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
                                      <div className="flex items-center gap-3 mb-4">
                                        <div className="p-2 bg-gradient-to-r from-blue-100 to-cyan-100 rounded-lg">
                                          <Package className="w-5 h-5 text-blue-600" />
                                        </div>
                                        <div>
                                          <h3 className="font-bold text-lg text-gray-900">Precios Base por Tamaño</h3>
                                          <p className="text-sm text-gray-500">Define precios base para cada tamaño disponible</p>
                                        </div>
                                      </div>

                                      {((preciosVarianteEdit[pid] ?? []).length === 0) ? (
                                        <div className="text-center py-8 text-gray-500">
                                          <div className="flex flex-col items-center gap-2">
                                            <Package className="w-8 h-8 text-gray-300" />
                                            <p>Este producto tiene tamaños en catálogo, pero no aparecen aquí.</p>
                                            <p className="text-sm">Configura los tamaños en "Editar producto" primero</p>
                                          </div>
                                        </div>
                                      ) : (
                                        <>
                                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                            {(preciosVarianteEdit[pid] ?? []).map((v) => (
                                              <div
                                                key={v.variantId}
                                                className={`p-4 rounded-xl border transition-all duration-200 ${v.variantIsActive === false
                                                    ? 'bg-gray-50 border-gray-300 opacity-70'
                                                    : 'bg-white border-gray-200 hover:border-blue-300 hover:shadow-sm'
                                                  }`}
                                              >
                                                <div className="flex justify-between items-start mb-3">
                                                  <div>
                                                    <h4 className="font-bold text-gray-900">{v.variantName}</h4>
                                                    {v.variantIsActive === false && (
                                                      <span className="inline-block mt-1 px-2 py-0.5 bg-gray-200 text-gray-700 text-xs font-medium rounded">
                                                        Inactivo en catálogo
                                                      </span>
                                                    )}
                                                  </div>
                                                  <label className="inline-flex items-center">
                                                    <input
                                                      type="checkbox"
                                                      checked={v.isActive}
                                                      onChange={(e) => cambiarPrecioVariante(pid, v.variantId, 'isActive', e.target.checked)}
                                                      disabled={v.variantIsActive === false}
                                                      className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                                                    />
                                                    <span className="ml-2 text-sm text-gray-700">Activo</span>
                                                  </label>
                                                </div>
                                                <div className="relative">
                                                  <div className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400">$</div>
                                                  <input
                                                    value={v.price ?? ""}
                                                    onChange={(e) => cambiarPrecioVariante(pid, v.variantId, 'price', e.target.value)}
                                                    className="w-full pl-10 pr-4 py-2 bg-gray-50 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200"
                                                    placeholder="0.00"
                                                    disabled={v.variantIsActive === false}
                                                  />
                                                </div>
                                              </div>
                                            ))}
                                          </div>

                                          <div className="flex justify-end mt-6">
                                            <button
                                              onClick={() => guardarPreciosVariante(pid)}
                                              disabled={guardando}
                                              className="inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-700 hover:to-cyan-700 text-white font-semibold rounded-lg transition-all duration-200 shadow-sm hover:shadow"
                                            >
                                              {guardando ? (
                                                <>
                                                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                                                  Guardando...
                                                </>
                                              ) : (
                                                <>
                                                  <Save className="w-4 h-4" />
                                                  Guardar Precios por Tamaño
                                                </>
                                              )}
                                            </button>
                                          </div>
                                        </>
                                      )}
                                    </div>
                                  )}

                                  {/* Precios por parámetros */}
                                  <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
                                    <div className="flex items-center gap-3 mb-4">
                                      <div className="p-2 bg-gradient-to-r from-green-100 to-emerald-100 rounded-lg">
                                        <Settings className="w-5 h-5 text-green-600" />
                                      </div>
                                      <div>
                                        <h3 className="font-bold text-lg text-gray-900">Precios por Parámetros</h3>
                                        <p className="text-sm text-gray-500">Ajustes de precio adicionales para parámetros específicos</p>
                                      </div>
                                    </div>

                                    {((preciosParamEdit[pid] ?? []).length === 0) ? (
                                      <div className="text-center py-8 text-gray-500">
                                        <div className="flex flex-col items-center gap-2">
                                          <Settings className="w-8 h-8 text-gray-300" />
                                          <p>Este producto aún no tiene parámetros configurados.</p>
                                          <p className="text-sm">Configura parámetros en "Editar producto" primero</p>
                                        </div>
                                      </div>
                                    ) : (
                                      <>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                          {(preciosParamEdit[pid] ?? []).map((p) => (
                                            <div
                                              key={p.paramId}
                                              className={`p-4 rounded-xl border transition-all duration-200 ${p.paramIsActive === false
                                                  ? 'bg-gray-50 border-gray-300 opacity-70'
                                                  : 'bg-white border-gray-200 hover:border-green-300 hover:shadow-sm'
                                                }`}
                                            >
                                              <div className="flex justify-between items-start mb-3">
                                                <div>
                                                  <h4 className="font-bold text-gray-900">{p.paramName}</h4>
                                                  {p.paramIsActive === false && (
                                                    <span className="inline-block mt-1 px-2 py-0.5 bg-gray-200 text-gray-700 text-xs font-medium rounded">
                                                      Inactivo en catálogo
                                                    </span>
                                                  )}
                                                </div>
                                                <label className="inline-flex items-center">
                                                  <input
                                                    type="checkbox"
                                                    checked={p.isActive}
                                                    onChange={(e) => cambiarPrecioParam(pid, p.paramId, 'isActive', e.target.checked)}
                                                    disabled={p.paramIsActive === false}
                                                    className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                                                  />
                                                  <span className="ml-2 text-sm text-gray-700">Activo</span>
                                                </label>
                                              </div>
                                              <div className="relative">
                                                <div className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400">
                                                  {Number(p.priceDelta) >= 0 ? '+' : '-'}
                                                </div>
                                                <input
                                                  value={p.priceDelta ?? ""}
                                                  onChange={(e) => cambiarPrecioParam(pid, p.paramId, 'priceDelta', e.target.value)}
                                                  className="w-full pl-8 pr-4 py-2 bg-gray-50 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200"
                                                  placeholder="0 (puede ser negativo)"
                                                  disabled={p.paramIsActive === false}
                                                />
                                              </div>
                                            </div>
                                          ))}
                                        </div>

                                        <div className="flex justify-end mt-6">
                                          <button
                                            onClick={() => guardarPreciosParams(pid)}
                                            disabled={guardando}
                                            className="inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white font-semibold rounded-lg transition-all duration-200 shadow-sm hover:shadow"
                                          >
                                            {guardando ? (
                                              <>
                                                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                                                Guardando...
                                              </>
                                            ) : (
                                              <>
                                                <Save className="w-4 h-4" />
                                                Guardar Precios por Parámetro
                                              </>
                                            )}
                                          </button>
                                        </div>
                                      </>
                                    )}
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}

                    {filasFiltradas.length === 0 && (
                      <tr>
                        <td colSpan={6} className="py-16 text-center">
                          <div className="flex flex-col items-center gap-3">
                            <Package className="w-12 h-12 text-gray-300" />
                            <p className="text-gray-500">No hay productos que coincidan con tu filtro</p>
                            <button
                              onClick={() => {
                                setBusqueda("");
                                setFiltroEstado("todos");
                              }}
                              className="px-4 py-2 text-sm text-blue-600 hover:text-blue-800 font-medium"
                            >
                              Limpiar filtros
                            </button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Footer */}
              <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border-t border-gray-200 p-4">
                <div className="flex items-center gap-3">
                  <Info className="w-5 h-5 text-blue-600 flex-shrink-0" />
                  <div>
                    <p className="text-sm text-gray-700 font-medium">Consejo:</p>
                    <p className="text-sm text-gray-600">
                      Para productos con tamaños, usa la "Matriz de precios". Para productos sin tamaños, usa "Precios por cantidad".
                    </p>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}