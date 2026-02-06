import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  adminGetProduct,
  adminUpdateProduct,
  adminSetProcessSteps,
  adminUpdateRules,
  adminSetVariants,
  adminSetParams,
  type AdminProductFull,
} from "../api/adminProducts";

type Pestaña = "basicos" | "reglas" | "tamanos" | "parametros" | "proceso";

function normalizarNumero(s: string) {
  return s.trim().replace(",", ".");
}

function esNumero(s: string) {
  if (!s.trim()) return false;
  const n = Number(normalizarNumero(s));
  return Number.isFinite(n);
}

function ChipTab({ active, onClick, children }: any) {
  return (
    <button
      onClick={onClick}
      className={`
        px-4 py-2 rounded-full font-semibold text-sm transition-all duration-200
        ${active
          ? "bg-blue-600 text-white shadow-md hover:bg-blue-700"
          : "bg-gray-50 text-gray-600 border border-gray-200 hover:border-blue-400 hover:text-blue-600 hover:bg-white"
        }
      `}
    >
      {children}
    </button>
  );
}

function Card({ title, desc, children }: any) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
      <div className="mb-6">
        <h3 className="text-xl font-bold text-gray-900">{title}</h3>
        {desc && <p className="text-sm text-gray-500 mt-2">{desc}</p>}
      </div>
      <div>{children}</div>
    </div>
  );
}

export default function AdminProductEdit() {
  const nav = useNavigate();
  const { id } = useParams();
  const [sp] = useSearchParams();

  const productId = Number(id);
  const fromPricing = sp.get("fromPricing") === "1";
  const branchId = sp.get("branchId");
  const productIdFromQuery = sp.get("productId");

  const [tab, setTab] = useState<Pestaña>("basicos");
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [product, setProduct] = useState<AdminProductFull | null>(null);

  // Básicos
  const [name, setName] = useState("");
  const [unitType, setUnitType] = useState<"METER" | "PIECE">("PIECE");
  const [needsVariant, setNeedsVariant] = useState(false);
  const [isActive, setIsActive] = useState(true);

  // Reglas cantidad
  const [minQty, setMinQty] = useState("1");
  const [qtyStep, setQtyStep] = useState("1");
  const [halfSpecial, setHalfSpecial] = useState<string>("");

  // Tamaños
  const [variants, setVariants] = useState<Array<{ name: string; isActive: boolean }>>([]);

  // Parámetros catálogo
  const [paramsList, setParamsList] = useState<Array<{ name: string; isActive: boolean }>>([]);

  // Proceso
  const [steps, setSteps] = useState<string[]>([]);
  const [newStep, setNewStep] = useState("");

  async function load() {
    if (!Number.isFinite(productId)) {
      setError("ID inválido");
      setCargando(false);
      return;
    }

    setCargando(true);
    setError(null);
    try {
      const { product } = await adminGetProduct(productId);
      setProduct(product);

      setName(product.name);
      setUnitType(product.unitType);
      setNeedsVariant(product.needsVariant);
      setIsActive(product.isActive);

      setMinQty(String(product.minQty ?? "1"));
      setQtyStep(String(product.qtyStep ?? "1"));
      setHalfSpecial(product.halfStepSpecialPrice ?? "");

      setVariants((product.variants ?? []).map((v) => ({ name: v.name, isActive: v.isActive })));

      setParamsList((product.params ?? []).map((p) => ({ name: p.name, isActive: !!p.isActive })));

      setSteps((product.processSteps ?? []).slice().sort((a, b) => a.order - b.order).map((x) => x.name));
    } catch (e: any) {
      setError(e?.message ?? "Error cargando producto");
    } finally {
      setCargando(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId]);

  const hayCambiosBasicos = useMemo(() => {
    if (!product) return false;
    return (
      name.trim() !== product.name ||
      unitType !== product.unitType ||
      needsVariant !== product.needsVariant ||
      isActive !== product.isActive
    );
  }, [product, name, unitType, needsVariant, isActive]);

  async function guardarBasicos() {
    if (!product) return;
    setGuardando(true);
    setError(null);
    try {
      await adminUpdateProduct(product.id, {
        name: name.trim(),
        unitType,
        needsVariant,
        isActive,
      });
      await load();
    } catch (e: any) {
      setError(e?.message ?? "Error guardando básicos");
    } finally {
      setGuardando(false);
    }
  }

  async function guardarReglas() {
    if (!product) return;

    if (!esNumero(minQty) || Number(normalizarNumero(minQty)) <= 0)
      return setError("Cantidad mínima del producto debe ser número > 0.");
    if (!esNumero(qtyStep) || Number(normalizarNumero(qtyStep)) <= 0)
      return setError("Paso de cantidad debe ser número > 0.");
    if (halfSpecial.trim() && (!esNumero(halfSpecial) || Number(normalizarNumero(halfSpecial)) < 0)) {
      return setError("Precio especial 0.5 debe ser número >= 0 o dejarse vacío.");
    }

    setGuardando(true);
    setError(null);
    try {
      await adminUpdateRules(product.id, {
        minQty: normalizarNumero(minQty),
        qtyStep: normalizarNumero(qtyStep),
        halfStepSpecialPrice: halfSpecial.trim() ? normalizarNumero(halfSpecial) : null,
      });
      await load();
    } catch (e: any) {
      setError(e?.message ?? "Error guardando reglas");
    } finally {
      setGuardando(false);
    }
  }

  async function guardarTamanos() {
    if (!product) return;
    if (!needsVariant) return setError("Activa 'Usa tamaños' en Básicos para poder guardar tamaños.");

    const cleaned = variants.map((v) => ({ ...v, name: v.name.trim() })).filter((v) => v.name);
    if (cleaned.length === 0) return setError("Agrega al menos 1 tamaño.");

    const seen = new Set<string>();
    for (const v of cleaned) {
      const key = v.name.toUpperCase();
      if (seen.has(key)) return setError(`Tamaño duplicado: ${v.name}`);
      seen.add(key);
    }

    setGuardando(true);
    setError(null);
    try {
      await adminSetVariants(
        product.id,
        cleaned.map((v, idx) => ({ name: v.name, isActive: v.isActive, order: idx }))
      );
      await load();
    } catch (e: any) {
      setError(e?.message ?? "Error guardando tamaños");
    } finally {
      setGuardando(false);
    }
  }

  async function guardarParametros() {
    if (!product) return;

    const cleaned = paramsList.map((p) => ({ ...p, name: p.name.trim() })).filter((p) => p.name);
    if (cleaned.length === 0) return setError("Agrega al menos 1 parámetro (o deja vacío y no guardes).");

    const seen = new Set<string>();
    for (const p of cleaned) {
      const key = p.name.toUpperCase();
      if (seen.has(key)) return setError(`Parámetro duplicado: ${p.name}`);
      seen.add(key);
    }

    setGuardando(true);
    setError(null);
    try {
      await adminSetParams(
        product.id,
        cleaned.map((p, idx) => ({ name: p.name, isActive: !!p.isActive, order: idx }))
      );
      await load();
    } catch (e: any) {
      setError(e?.message ?? "Error guardando parámetros");
    } finally {
      setGuardando(false);
    }
  }

  async function guardarProceso() {
    if (!product) return;
    const cleaned = steps.map((s) => s.trim()).filter(Boolean);
    if (cleaned.length === 0) return setError("Agrega al menos 1 paso.");

    setGuardando(true);
    setError(null);
    try {
      await adminSetProcessSteps(product.id, cleaned);
      await load();
    } catch (e: any) {
      setError(e?.message ?? "Error guardando proceso");
    } finally {
      setGuardando(false);
    }
  }

  // Helpers UI
  function addVariant() {
    setVariants((prev) => [...prev, { name: "", isActive: true }]);
  }
  function removeVariant(i: number) {
    setVariants((prev) => prev.filter((_, idx) => idx !== i));
  }
  function moveVariant(i: number, dir: -1 | 1) {
    setVariants((prev) => {
      const next = prev.slice();
      const j = i + dir;
      if (j < 0 || j >= next.length) return prev;
      const tmp = next[i];
      next[i] = next[j];
      next[j] = tmp;
      return next;
    });
  }

  function addParam() {
    setParamsList((prev) => [...prev, { name: "Nuevo parámetro", isActive: true }]);
  }
  function removeParam(i: number) {
    setParamsList((prev) => prev.filter((_, idx) => idx !== i));
  }
  function moveParam(i: number, dir: -1 | 1) {
    setParamsList((prev) => {
      const next = prev.slice();
      const j = i + dir;
      if (j < 0 || j >= next.length) return prev;
      const tmp = next[i];
      next[i] = next[j];
      next[j] = tmp;
      return next;
    });
  }

  function addStep() {
    const s = newStep.trim();
    if (!s) return;
    setSteps((prev) => [...prev, s]);
    setNewStep("");
  }
  function removeStep(i: number) {
    setSteps((prev) => prev.filter((_, idx) => idx !== i));
  }
  function moveStep(i: number, dir: -1 | 1) {
    setSteps((prev) => {
      const next = prev.slice();
      const j = i + dir;
      if (j < 0 || j >= next.length) return prev;
      const tmp = next[i];
      next[i] = next[j];
      next[j] = tmp;
      return next;
    });
  }

  function volver() {
    if (fromPricing && branchId) {
      nav(`/admin/pricing?branchId=${branchId}&productId=${productIdFromQuery ?? productId}`);
      return;
    }
    nav("/admin/products");
  }

  function irAPricing() {
    const b = branchId ?? "1";
    nav(`/admin/pricing?branchId=${b}&productId=${productId}`);
  }

  if (cargando) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          <p className="mt-4 text-gray-600">Cargando producto...</p>
        </div>
      </div>
    );
  }

  if (!product) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="bg-white rounded-lg border border-gray-200 p-6 max-w-md mx-auto">
          <div className="text-red-600 mb-4">
            {error || "Producto no encontrado"}
          </div>
          <button
            onClick={volver}
            className="w-full bg-gray-100 hover:bg-gray-200 text-gray-800 font-semibold py-2 px-4 rounded-lg transition-colors"
          >
            Volver
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-6 max-w-6xl">
        {/* Header */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 mb-6">
          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
            <div>
              <div className="text-sm text-gray-500 mb-1">Administrador · Editar producto</div>
              <div className="flex flex-col md:flex-row md:items-baseline gap-2 md:gap-4 flex-wrap">
                <h1 className="text-2xl md:text-3xl font-bold text-gray-900">
                  #{product.id} — {product.name}
                </h1>
                <span className="text-sm text-gray-500">
                  Configura tamaños y parámetros. Los precios se asignan por sucursal en Pricing.
                </span>
              </div>
            </div>
            
            <div className="flex flex-wrap gap-3">
              <button
                onClick={irAPricing}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-colors shadow-sm hover:shadow"
              >
                Ir a Precios por sucursal →
              </button>
              
              <button
                onClick={volver}
                className="px-4 py-2 bg-white hover:bg-gray-50 text-gray-800 font-semibold rounded-lg border border-gray-300 transition-colors"
              >
                ← Volver
              </button>
            </div>
          </div>
        </div>

        {/* Error Display */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
            <div className="flex items-center gap-2 text-red-700">
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
              </svg>
              <span>{error}</span>
            </div>
          </div>
        )}

        {/* Tabs Navigation */}
        <div className="flex flex-wrap gap-2 mb-6">
          <ChipTab active={tab === "basicos"} onClick={() => setTab("basicos")}>
            Básicos
          </ChipTab>
          <ChipTab active={tab === "reglas"} onClick={() => setTab("reglas")}>
            Reglas
          </ChipTab>
          <ChipTab active={tab === "tamanos"} onClick={() => setTab("tamanos")}>
            Tamaños
          </ChipTab>
          <ChipTab active={tab === "parametros"} onClick={() => setTab("parametros")}>
            Parámetros
          </ChipTab>
          <ChipTab active={tab === "proceso"} onClick={() => setTab("proceso")}>
            Proceso
          </ChipTab>
        </div>

        {/* Tab Content */}
        <div className="space-y-6">
          {tab === "basicos" && (
            <Card title="Datos básicos" desc="Unidad, tamaños y estado del producto.">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Nombre
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="Nombre del producto"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Unidad
                  </label>
                  <select
                    value={unitType}
                    onChange={(e) => setUnitType(e.target.value as any)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="PIECE">PIEZA</option>
                    <option value="METER">METRO</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Estado
                  </label>
                  <div className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      checked={isActive}
                      onChange={(e) => setIsActive(e.target.checked)}
                      className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                    />
                    <span className="text-gray-700">Activo</span>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Usa tamaños
                  </label>
                  <div className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      checked={needsVariant}
                      onChange={(e) => setNeedsVariant(e.target.checked)}
                      className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                    />
                    <span className="text-gray-700">Sí</span>
                  </div>
                  <p className="text-xs text-gray-500 mt-2">
                    Si activas esto, podrás crear tamaños. El precio por tamaño se asigna por sucursal.
                  </p>
                </div>
              </div>

              <div className="flex justify-end">
                <button
                  onClick={guardarBasicos}
                  disabled={!hayCambiosBasicos || guardando}
                  className={`
                    px-4 py-2 rounded-lg font-semibold transition-colors
                    ${!hayCambiosBasicos || guardando
                      ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                      : "bg-green-600 hover:bg-green-700 text-white shadow-sm hover:shadow"
                    }
                  `}
                >
                  {guardando ? (
                    <span className="flex items-center gap-2">
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                      Guardando...
                    </span>
                  ) : (
                    "Guardar básicos"
                  )}
                </button>
              </div>
            </Card>
          )}

          {tab === "reglas" && (
            <Card title="Reglas de cantidad" desc="Controla mínimos e incrementos permitidos.">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Cantidad mínima
                  </label>
                  <input
                    type="text"
                    value={minQty}
                    onChange={(e) => setMinQty(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder={unitType === "METER" ? "0.5" : "1"}
                  />
                  <p className="text-xs text-gray-500 mt-1">Mínimo permitido por pedido</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Paso permitido
                  </label>
                  <input
                    type="text"
                    value={qtyStep}
                    onChange={(e) => setQtyStep(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder={unitType === "METER" ? "0.5" : "1"}
                  />
                  <p className="text-xs text-gray-500 mt-1">Incremento de cantidad permitido</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Precio especial 0.5
                  </label>
                  <input
                    type="text"
                    value={halfSpecial}
                    onChange={(e) => setHalfSpecial(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="Dejar vacío si no aplica"
                  />
                  <p className="text-xs text-gray-500 mt-1">Precio especial cuando cantidad = 0.5 (opcional)</p>
                </div>
              </div>

              <div className="flex justify-end">
                <button
                  onClick={guardarReglas}
                  disabled={guardando}
                  className={`
                    px-4 py-2 rounded-lg font-semibold transition-colors
                    ${guardando
                      ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                      : "bg-green-600 hover:bg-green-700 text-white shadow-sm hover:shadow"
                    }
                  `}
                >
                  {guardando ? (
                    <span className="flex items-center gap-2">
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                      Guardando...
                    </span>
                  ) : (
                    "Guardar reglas"
                  )}
                </button>
              </div>
            </Card>
          )}

          {tab === "tamanos" && (
            <Card title="Tamaños del producto" desc="Agrega nombres. El precio por tamaño se asigna en Pricing.">
              {!needsVariant ? (
                <div className="text-center py-8">
                  <div className="text-gray-400 mb-3">
                    <svg className="w-12 h-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                  <h4 className="text-lg font-medium text-gray-700 mb-2">Sin tamaños configurados</h4>
                  <p className="text-gray-500 mb-4">Ve a la pestaña "Básicos" y activa "Usa tamaños" para habilitar esta sección.</p>
                  <button
                    onClick={() => setTab("basicos")}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-colors"
                  >
                    Ir a Básicos
                  </button>
                </div>
              ) : (
                <>
                  <div className="flex flex-wrap gap-3 mb-6">
                    <button
                      onClick={addVariant}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-colors shadow-sm hover:shadow"
                    >
                      + Agregar tamaño
                    </button>

                    <button
                      onClick={guardarTamanos}
                      disabled={guardando}
                      className={`
                        px-4 py-2 rounded-lg font-semibold transition-colors
                        ${guardando
                          ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                          : "bg-green-600 hover:bg-green-700 text-white shadow-sm hover:shadow"
                        }
                      `}
                    >
                      {guardando ? (
                        <span className="flex items-center gap-2">
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                          Guardando...
                        </span>
                      ) : (
                        "Guardar tamaños"
                      )}
                    </button>
                  </div>

                  <div className="space-y-3">
                    {variants.map((v, idx) => (
                      <div
                        key={idx}
                        className="bg-gray-50 border border-gray-200 rounded-lg p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                      >
                        <div className="flex items-center gap-4">
                          <div className="w-8 h-8 rounded-full border border-gray-300 bg-white flex items-center justify-center font-bold text-gray-700">
                            {idx + 1}
                          </div>
                          
                          <input
                            value={v.name}
                            onChange={(e) => setVariants((prev) => prev.map((x, i) => (i === idx ? { ...x, name: e.target.value } : x)))}
                            className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 min-w-[200px]"
                            placeholder='Ej. "CH", "A3", "10x15"'
                          />
                          
                          <label className="flex items-center gap-2 text-sm text-gray-700">
                            <input
                              type="checkbox"
                              checked={v.isActive}
                              onChange={(e) => setVariants((prev) => prev.map((x, i) => (i === idx ? { ...x, isActive: e.target.checked } : x)))}
                              className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                            />
                            Activo
                          </label>
                        </div>

                        <div className="flex gap-2">
                          <button
                            onClick={() => moveVariant(idx, -1)}
                            disabled={idx === 0}
                            className={`
                              w-8 h-8 rounded-lg border flex items-center justify-center
                              ${idx === 0
                                ? "border-gray-200 text-gray-300 cursor-not-allowed"
                                : "border-gray-300 text-gray-700 hover:bg-gray-100"
                              }
                            `}
                            title="Mover arriba"
                          >
                            ↑
                          </button>
                          <button
                            onClick={() => moveVariant(idx, 1)}
                            disabled={idx === variants.length - 1}
                            className={`
                              w-8 h-8 rounded-lg border flex items-center justify-center
                              ${idx === variants.length - 1
                                ? "border-gray-200 text-gray-300 cursor-not-allowed"
                                : "border-gray-300 text-gray-700 hover:bg-gray-100"
                              }
                            `}
                            title="Mover abajo"
                          >
                            ↓
                          </button>
                          <button
                            onClick={() => removeVariant(idx)}
                            className="w-8 h-8 rounded-lg border border-red-300 text-red-600 hover:bg-red-50 flex items-center justify-center"
                            title="Eliminar"
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    ))}

                    {variants.length === 0 && (
                      <div className="text-center py-8 text-gray-500">
                        <p>Aún no has agregado tamaños. Usa el botón "Agregar tamaño" para comenzar.</p>
                      </div>
                    )}
                  </div>
                </>
              )}
            </Card>
          )}

          {tab === "parametros" && (
            <Card
              title="Parámetros (catálogo)"
              desc="Aquí solo defines la lista. El ajuste de precio se define por sucursal en Pricing."
            >
              <div className="flex flex-wrap gap-3 mb-6">
                <button
                  onClick={addParam}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-colors shadow-sm hover:shadow"
                >
                  + Agregar parámetro
                </button>

                <button
                  onClick={guardarParametros}
                  disabled={guardando}
                  className={`
                    px-4 py-2 rounded-lg font-semibold transition-colors
                    ${guardando
                      ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                      : "bg-green-600 hover:bg-green-700 text-white shadow-sm hover:shadow"
                    }
                  `}
                >
                  {guardando ? (
                    <span className="flex items-center gap-2">
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                      Guardando...
                    </span>
                  ) : (
                    "Guardar parámetros"
                  )}
                </button>
              </div>

              <div className="space-y-3">
                {paramsList.map((p, idx) => (
                  <div
                    key={idx}
                    className="bg-gray-50 border border-gray-200 rounded-lg p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-8 h-8 rounded-full border border-gray-300 bg-white flex items-center justify-center font-bold text-gray-700">
                        {idx + 1}
                      </div>
                      
                      <input
                        value={p.name}
                        onChange={(e) => setParamsList((prev) => prev.map((x, i) => (i === idx ? { ...x, name: e.target.value } : x)))}
                        className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 min-w-[250px]"
                        placeholder='Ej. "Brillo", "Fondo blanco", "Urgente"'
                      />
                      
                      <label className="flex items-center gap-2 text-sm text-gray-700">
                        <input
                          type="checkbox"
                          checked={p.isActive}
                          onChange={(e) => setParamsList((prev) => prev.map((x, i) => (i === idx ? { ...x, isActive: e.target.checked } : x)))}
                          className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                        />
                        Activo
                      </label>
                    </div>

                    <div className="flex gap-2">
                      <button
                        onClick={() => moveParam(idx, -1)}
                        disabled={idx === 0}
                        className={`
                          w-8 h-8 rounded-lg border flex items-center justify-center
                          ${idx === 0
                            ? "border-gray-200 text-gray-300 cursor-not-allowed"
                            : "border-gray-300 text-gray-700 hover:bg-gray-100"
                          }
                        `}
                        title="Mover arriba"
                      >
                        ↑
                      </button>
                      <button
                        onClick={() => moveParam(idx, 1)}
                        disabled={idx === paramsList.length - 1}
                        className={`
                          w-8 h-8 rounded-lg border flex items-center justify-center
                          ${idx === paramsList.length - 1
                            ? "border-gray-200 text-gray-300 cursor-not-allowed"
                            : "border-gray-300 text-gray-700 hover:bg-gray-100"
                          }
                        `}
                        title="Mover abajo"
                      >
                        ↓
                      </button>
                      <button
                        onClick={() => removeParam(idx)}
                        className="w-8 h-8 rounded-lg border border-red-300 text-red-600 hover:bg-red-50 flex items-center justify-center"
                        title="Eliminar"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))}

                {paramsList.length === 0 && (
                  <div className="text-center py-8 text-gray-500">
                    <p>Aún no has agregado parámetros. Agrega el primero usando el botón superior.</p>
                  </div>
                )}
              </div>
            </Card>
          )}

          {tab === "proceso" && (
            <Card title="Proceso del producto" desc="Pasos de producción (ordenables).">
              <div className="flex flex-col sm:flex-row gap-3 mb-6">
                <input
                  value={newStep}
                  onChange={(e) => setNewStep(e.target.value)}
                  placeholder='Ej. "IMPRESION"'
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  onKeyPress={(e) => e.key === "Enter" && addStep()}
                />
                <div className="flex gap-3">
                  <button
                    onClick={addStep}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-colors whitespace-nowrap"
                  >
                    + Agregar paso
                  </button>
                  <button
                    onClick={guardarProceso}
                    disabled={guardando}
                    className={`
                      px-4 py-2 rounded-lg font-semibold transition-colors whitespace-nowrap
                      ${guardando
                        ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                        : "bg-green-600 hover:bg-green-700 text-white shadow-sm hover:shadow"
                      }
                    `}
                  >
                    {guardando ? (
                      <span className="flex items-center gap-2">
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                        Guardando...
                      </span>
                    ) : (
                      "Guardar proceso"
                    )}
                  </button>
                </div>
              </div>

              <div className="space-y-3">
                {steps.map((s, idx) => (
                  <div
                    key={`${s}-${idx}`}
                    className="bg-gray-50 border border-gray-200 rounded-lg p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-8 h-8 rounded-full border border-gray-300 bg-white flex items-center justify-center font-bold text-gray-700">
                        {idx + 1}
                      </div>
                      <div className="font-semibold text-gray-800">{s}</div>
                    </div>

                    <div className="flex gap-2">
                      <button
                        onClick={() => moveStep(idx, -1)}
                        disabled={idx === 0}
                        className={`
                          w-8 h-8 rounded-lg border flex items-center justify-center
                          ${idx === 0
                            ? "border-gray-200 text-gray-300 cursor-not-allowed"
                            : "border-gray-300 text-gray-700 hover:bg-gray-100"
                          }
                        `}
                        title="Mover arriba"
                      >
                        ↑
                      </button>
                      <button
                        onClick={() => moveStep(idx, 1)}
                        disabled={idx === steps.length - 1}
                        className={`
                          w-8 h-8 rounded-lg border flex items-center justify-center
                          ${idx === steps.length - 1
                            ? "border-gray-200 text-gray-300 cursor-not-allowed"
                            : "border-gray-300 text-gray-700 hover:bg-gray-100"
                          }
                        `}
                        title="Mover abajo"
                      >
                        ↓
                      </button>
                      <button
                        onClick={() => removeStep(idx)}
                        className="w-8 h-8 rounded-lg border border-red-300 text-red-600 hover:bg-red-50 flex items-center justify-center"
                        title="Quitar"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
                {steps.length === 0 && (
                  <div className="text-center py-8 text-gray-500">
                    <p>Agrega pasos para este producto usando el campo de texto superior.</p>
                  </div>
                )}
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}