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

        // Cargar matriz de precios
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

  // Funciones CORREGIDAS para manejar la matriz de precios
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

  // FUNCIÓN CORREGIDA - Maneja cambios en inputs de matriz
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

    // Validaciones
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
      console.log('Enviando matriz de precios:', { sucursalId, productId, matriz });
      await setBranchProductVariantQuantityMatrix(sucursalId, productId, matriz);
      console.log('Matriz guardada exitosamente');

      // Recargar datos
      await cargarProductosDeSucursal(sucursalId);
    } catch (e: any) {
      console.error('Error guardando matriz:', e);
      setError(e?.message ?? "Error guardando matriz de precios");
    } finally {
      setGuardando(false);
    }
  }

  // Funciones existentes - CORREGIDAS
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

  // FUNCIÓN CORREGIDA - Cambiar fila cantidad
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

  // FUNCIÓN CORREGIDA - Cambiar precio variante
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

  // FUNCIÓN CORREGIDA - Cambiar precio parámetro
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
    <div style={{ padding: 16, maxWidth: 1200, margin: "0 auto" }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h2 style={{ margin: 0 }}>Administrador · Precios por sucursal</h2>
          <div style={{ marginTop: 6, opacity: 0.75, fontSize: 13 }}>
            Precio base, precios por cantidad, precios por tamaño y matriz de precios por tamaño/cantidad.
          </div>
        </div>
      </div>

      <div style={{ marginTop: 14, display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
        <label style={{ fontSize: 13, opacity: 0.85 }}>Sucursal:</label>
        <select
          value={sucursalId ?? ""}
          onChange={(e) => setSucursalId(Number(e.target.value))}
          style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #ddd", minWidth: 260 }}
        >
          {sucursales.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name} {b.isActive ? "" : "(inactiva)"}
            </option>
          ))}
        </select>

        <select
          value={filtroEstado}
          onChange={(e) => setFiltroEstado(e.target.value as any)}
          style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #ddd" }}
        >
          <option value="todos">Todos</option>
          <option value="activos">Activos</option>
          <option value="inactivos">Inactivos</option>
        </select>

        <input
          placeholder="Buscar por id, nombre o unidad..."
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #ddd", minWidth: 260, flex: "1 1 260px" }}
        />

        <button
          onClick={() => sucursalId !== null && cargarProductosDeSucursal(sucursalId)}
          disabled={cargando}
          style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid #ddd", background: "#fff" }}
        >
          {cargando ? "Cargando..." : "Actualizar"}
        </button>
      </div>

      {error && (
        <div style={{ marginTop: 12, padding: 12, border: "1px solid #f5c2c7", background: "#f8d7da", borderRadius: 10 }}>
          {error}
        </div>
      )}

      <div style={{ marginTop: 16 }}>
        {cargando ? (
          <div style={{ padding: 12 }}>Cargando...</div>
        ) : (
          <div style={{ border: "1px solid #eee", borderRadius: 14, overflow: "hidden", background: "#fff" }}>
            <div style={{ overflowX: "auto" }}>
              <table width="100%" cellPadding={10} style={{ borderCollapse: "collapse", minWidth: 980 }}>
                <thead>
                  <tr style={{ textAlign: "left", borderBottom: "1px solid #eee", background: "#fafafa" }}>
                    <th>Producto</th>
                    <th>Unidad</th>
                    <th>Usa tamaños</th>
                    <th>Activo</th>
                    <th>Precio base</th>
                    <th style={{ textAlign: "right" }}>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {filasFiltradas.map((r) => {
                    const pid = r.productId;
                    const abiertoAhora = !!abierto[pid];
                    const tieneTamaños = r.product.needsVariant;

                    return (
                      <Fragment key={pid}>
                        <tr style={{ borderBottom: "1px solid #f0f0f0" }}>
                          <td style={{ fontWeight: 700 }}>{r.product.name}</td>
                          <td style={{ opacity: 0.85 }}>{r.product.unitType}</td>
                          <td style={{ opacity: 0.85 }}>{tieneTamaños ? "Sí" : "No"}</td>
                          <td>
                            <input
                              type="checkbox"
                              checked={!!activoEdit[pid]}
                              onChange={(e) => setActivoEdit((m) => ({ ...m, [pid]: e.target.checked }))}
                            />
                          </td>
                          <td>
                            <input
                              value={precioBaseEdit[pid] ?? ""}
                              onChange={(e) => setPrecioBaseEdit((m) => ({ ...m, [pid]: e.target.value }))}
                              style={{ padding: 8, width: 140, borderRadius: 10, border: "1px solid #ddd" }}
                              placeholder="0.00"
                            />
                          </td>
                          <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                            <button
                              onClick={() => guardarPrecioBase(pid)}
                              disabled={guardando}
                              style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid #ddd", background: "#fff" }}
                            >
                              Guardar precio base
                            </button>{" "}
                            <button
                              onClick={() => irAEditarProducto(pid)}
                              style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid #ddd", background: "#fff", marginLeft: 8 }}
                            >
                              Editar producto
                            </button>{" "}
                            <button
                              onClick={() => setAbierto((m) => ({ ...m, [pid]: !abiertoAhora }))}
                              style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid #ddd", background: "#fff", marginLeft: 8 }}
                            >
                              {abiertoAhora ? "Ocultar" : "Editar precios avanzados"}
                            </button>
                          </td>
                        </tr>

                        {abiertoAhora && (
                          <tr>
                            <td colSpan={6} style={{ background: "#fcfcfc" }}>
                              <div style={{ display: "grid", gap: 14 }}>
                                {/* Matriz de precios por tamaño y cantidad (solo para productos con tamaños) */}
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
                                  <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 12, background: "#fff" }}>
                                    <div style={{ fontWeight: 800, marginBottom: 6 }}>Precios por cantidad</div>

                                    <div style={{ overflowX: "auto" }}>
                                      <table width="100%" cellPadding={8} style={{ borderCollapse: "collapse", minWidth: 720 }}>
                                        <thead>
                                          <tr style={{ textAlign: "left", borderBottom: "1px solid #eee", background: "#fafafa" }}>
                                            <th style={{ width: 180 }}>Cantidad mínima</th>
                                            <th style={{ width: 180 }}>Precio unitario</th>
                                            <th style={{ width: 90 }}>Activo</th>
                                            <th style={{ width: 120 }}></th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {(preciosCantidadEdit[pid] ?? []).map((row, idx) => (
                                            <tr key={idx} style={{ borderBottom: "1px solid #f0f0f0" }}>
                                              <td>
                                                <input
                                                  value={row.minQty}
                                                  onChange={(e) => cambiarFilaCantidad(pid, idx, 'minQty', e.target.value)}
                                                  style={{ padding: 8, width: 160, borderRadius: 10, border: "1px solid #ddd" }}
                                                  placeholder={r.product.unitType === "METER" ? "0.5" : "1"}
                                                />
                                              </td>
                                              <td>
                                                <input
                                                  value={row.unitPrice}
                                                  onChange={(e) => cambiarFilaCantidad(pid, idx, 'unitPrice', e.target.value)}
                                                  style={{ padding: 8, width: 160, borderRadius: 10, border: "1px solid #ddd" }}
                                                  placeholder="0.00"
                                                />
                                              </td>
                                              <td>
                                                <input
                                                  type="checkbox"
                                                  checked={row.isActive}
                                                  onChange={(e) => cambiarFilaCantidad(pid, idx, 'isActive', e.target.checked)}
                                                />
                                              </td>
                                              <td style={{ textAlign: "right" }}>
                                                <button
                                                  onClick={() => eliminarFilaCantidad(pid, idx)}
                                                  style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid #ddd", background: "#fff" }}
                                                >
                                                  Eliminar
                                                </button>
                                              </td>
                                            </tr>
                                          ))}

                                          {(preciosCantidadEdit[pid] ?? []).length === 0 && (
                                            <tr>
                                              <td colSpan={4} style={{ padding: 10, opacity: 0.75 }}>
                                                No hay precios por cantidad. Se usará el precio base.
                                              </td>
                                            </tr>
                                          )}
                                        </tbody>
                                      </table>
                                    </div>

                                    <div style={{ display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "space-between", marginTop: 10 }}>
                                      <button
                                        onClick={() => agregarFilaCantidad(pid)}
                                        style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid #ddd", background: "#fff", fontWeight: 800 }}
                                      >
                                        + Agregar fila
                                      </button>
                                      <button
                                        onClick={() => guardarPreciosCantidad(pid)}
                                        disabled={guardando}
                                        style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid #ddd", background: "#fff", fontWeight: 800 }}
                                      >
                                        Guardar precios por cantidad
                                      </button>
                                    </div>
                                  </div>
                                )}

                                {/* Precios por tamaño (precios base por tamaño) */}
                                {tieneTamaños && (
                                  <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 12, background: "#fff" }}>
                                    <div style={{ fontWeight: 800, marginBottom: 6 }}>
                                      Precios base por tamaño
                                    </div>

                                    {((preciosVarianteEdit[pid] ?? []).length === 0) ? (
                                      <div style={{ opacity: 0.75 }}>
                                        {r.product.variants && r.product.variants.length > 0
                                          ? "Este producto tiene tamaños en catálogo, pero no aparecen aquí."
                                          : "Este producto no tiene tamaños creados. (Ve a 'Editar producto')"}
                                      </div>
                                    ) : (
                                      <>
                                        <div style={{ display: "grid", gap: 8 }}>
                                          {(preciosVarianteEdit[pid] ?? []).map((v) => (
                                            <div
                                              key={v.variantId}
                                              style={{
                                                display: "flex",
                                                flexWrap: "wrap",
                                                gap: 10,
                                                alignItems: "center",
                                                justifyContent: "space-between",
                                                border: "1px solid #eee",
                                                borderRadius: 12,
                                                padding: 10,
                                                background: v.variantIsActive === false ? "#f8f9fa" : "#fafafa",
                                                opacity: v.variantIsActive === false ? 0.7 : 1,
                                              }}
                                            >
                                              <div style={{ minWidth: 160, fontWeight: 700 }}>
                                                {v.variantName} {v.variantIsActive === false && "(inactivo en catálogo)"}
                                              </div>

                                              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                                                <label style={{ fontSize: 13, opacity: 0.85 }}>
                                                  Precio base:
                                                  <input
                                                    value={v.price ?? ""}
                                                    onChange={(e) => cambiarPrecioVariante(pid, v.variantId, 'price', e.target.value)}
                                                    style={{ marginLeft: 8, padding: 8, width: 150, borderRadius: 10, border: "1px solid #ddd" }}
                                                    placeholder="0.00"
                                                    disabled={v.variantIsActive === false}
                                                  />
                                                </label>

                                                <label style={{ fontSize: 13, opacity: 0.85, display: "flex", gap: 8, alignItems: "center" }}>
                                                  <input
                                                    type="checkbox"
                                                    checked={v.isActive}
                                                    onChange={(e) => cambiarPrecioVariante(pid, v.variantId, 'isActive', e.target.checked)}
                                                    disabled={v.variantIsActive === false}
                                                  />
                                                  Activo en sucursal
                                                </label>
                                              </div>
                                            </div>
                                          ))}
                                        </div>

                                        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
                                          <button
                                            onClick={() => guardarPreciosVariante(pid)}
                                            disabled={guardando}
                                            style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid #ddd", background: "#fff", fontWeight: 800 }}
                                          >
                                            {guardando ? "Guardando..." : "Guardar precios base por tamaño"}
                                          </button>
                                        </div>
                                      </>
                                    )}
                                  </div>
                                )}

                                {/* Precios por parámetros */}
                                <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 12, background: "#fff" }}>
                                  <div style={{ fontWeight: 800, marginBottom: 6 }}>Precios por parámetros</div>

                                  {((preciosParamEdit[pid] ?? []).length === 0) ? (
                                    <div style={{ opacity: 0.75 }}>
                                      {r.product.params && r.product.params.length > 0
                                        ? "Este producto tiene parámetros en catálogo, pero no aparecen aquí."
                                        : "Este producto aún no tiene parámetros. (Ve a 'Editar producto')"}
                                    </div>
                                  ) : (
                                    <>
                                      <div style={{ display: "grid", gap: 8 }}>
                                        {(preciosParamEdit[pid] ?? []).map((p) => (
                                          <div
                                            key={p.paramId}
                                            style={{
                                              display: "flex",
                                              flexWrap: "wrap",
                                              gap: 10,
                                              alignItems: "center",
                                              justifyContent: "space-between",
                                              border: "1px solid #eee",
                                              borderRadius: 12,
                                              padding: 10,
                                              background: p.paramIsActive === false ? "#f8f9fa" : "#fafafa",
                                              opacity: p.paramIsActive === false ? 0.7 : 1,
                                            }}
                                          >
                                            <div style={{ minWidth: 200, fontWeight: 700 }}>
                                              {p.paramName} {p.paramIsActive === false && "(inactivo en catálogo)"}
                                            </div>

                                            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                                              <label style={{ fontSize: 13, opacity: 0.85 }}>
                                                Ajuste:
                                                <input
                                                  value={p.priceDelta ?? ""}
                                                  onChange={(e) => cambiarPrecioParam(pid, p.paramId, 'priceDelta', e.target.value)}
                                                  style={{ marginLeft: 8, padding: 8, width: 150, borderRadius: 10, border: "1px solid #ddd" }}
                                                  placeholder="0 (puede ser negativo)"
                                                  disabled={p.paramIsActive === false}
                                                />
                                              </label>

                                              <label style={{ fontSize: 13, opacity: 0.85, display: "flex", gap: 8, alignItems: "center" }}>
                                                <input
                                                  type="checkbox"
                                                  checked={p.isActive}
                                                  onChange={(e) => cambiarPrecioParam(pid, p.paramId, 'isActive', e.target.checked)}
                                                  disabled={p.paramIsActive === false}
                                                />
                                                Activo en sucursal
                                              </label>
                                            </div>
                                          </div>
                                        ))}
                                      </div>

                                      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
                                        <button
                                          onClick={() => guardarPreciosParams(pid)}
                                          disabled={guardando}
                                          style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid #ddd", background: "#fff", fontWeight: 800 }}
                                        >
                                          {guardando ? "Guardando..." : "Guardar precios de parámetros"}
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
                      <td colSpan={6} style={{ padding: 16, opacity: 0.75 }}>
                        No hay productos que coincidan con tu filtro.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div style={{ padding: 12, borderTop: "1px solid #eee", fontSize: 13, opacity: 0.8 }}>
              <b>Consejo:</b> Para productos con tamaños, usa la "Matriz de precios". Para productos sin tamaños, usa "Precios por cantidad".
            </div>
          </div>
        )}
      </div>
    </div>
  );
}