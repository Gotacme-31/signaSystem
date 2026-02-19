import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { adminCreateProduct } from "../api/adminProducts";
import {
  Package,
  Save,
  X,
  AlertCircle,
  Info,
  Ruler,
  Hash,
  DollarSign,
  CheckCircle,
  Eye,
  EyeOff,
  Layers,
  Grid3x3,
  Tag,
  Settings,
  ArrowRight
} from "lucide-react";

function normalizarNumero(s: string) {
  return s.trim().replace(",", ".");
}

function esNumero(s: string) {
  if (!s.trim()) return false;
  const n = Number(normalizarNumero(s));
  return Number.isFinite(n);
}

export default function AdminProductNew() {
  const nav = useNavigate();
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Básicos
  const [name, setName] = useState("");
  const [unitType, setUnitType] = useState<"METER" | "PIECE">("PIECE");
  const [needsVariant, setNeedsVariant] = useState(false);
  const [isActive, setIsActive] = useState(true);

  // Reglas cantidad
  const [minQty, setMinQty] = useState("1");
  const [qtyStep, setQtyStep] = useState("1");
  const [halfSpecial, setHalfSpecial] = useState<string>("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    // Validaciones
    if (!name.trim()) {
      setError("El nombre es obligatorio");
      return;
    }

    if (!esNumero(minQty) || Number(normalizarNumero(minQty)) <= 0) {
      setError("Cantidad mínima debe ser número > 0");
      return;
    }

    if (!esNumero(qtyStep) || Number(normalizarNumero(qtyStep)) <= 0) {
      setError("Paso de cantidad debe ser número > 0");
      return;
    }

    if (halfSpecial.trim() && (!esNumero(halfSpecial) || Number(normalizarNumero(halfSpecial)) < 0)) {
      setError("Precio especial 0.5 debe ser número >= 0 o vacío");
      return;
    }

    setGuardando(true);
    setError(null);

    try {
      const result = await adminCreateProduct({
        name: name.trim(),
        unitType,
        needsVariant,
        isActive,
        minQty: normalizarNumero(minQty),
        qtyStep: normalizarNumero(qtyStep),
        halfStepSpecialPrice: halfSpecial.trim() ? normalizarNumero(halfSpecial) : null,
      });

      // Redirigir a la edición del producto recién creado
      nav(`/admin/products/${result.id}/edit?fromPricing=0`);
    } catch (e: any) {
      setError(e?.message || "Error al crear producto");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-4 md:p-6">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-8 text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-r from-blue-600 to-indigo-600 rounded-2xl mb-4 shadow-lg">
            <Package className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl md:text-4xl font-bold text-gray-900 mb-3">
            Nuevo Producto
          </h1>
          <p className="text-lg text-gray-600 max-w-2xl mx-auto">
            Configura los datos básicos y reglas de cantidad. Después podrás agregar{" "}
            <span className="font-semibold text-blue-600">tamaños, parámetros y pasos de proceso</span>.
          </p>
        </div>

        {/* Main Card */}
        <div className="bg-white rounded-2xl shadow-xl border border-gray-200 overflow-hidden">
          {/* Card Header */}
          <div className="px-6 py-5 border-b border-gray-100 bg-gradient-to-r from-blue-50 to-indigo-50">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-white rounded-lg shadow-sm">
                  <Settings className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-gray-900">Configuración del Producto</h2>
                  <p className="text-sm text-gray-600 mt-1">
                    Completa la información básica del nuevo producto
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => nav("/admin/products")}
                className="inline-flex items-center gap-2 px-4 py-2.5 bg-white hover:bg-gray-50 text-gray-700 font-medium rounded-lg border border-gray-300 shadow-sm hover:shadow transition-all duration-200"
              >
                <X className="w-4 h-4" />
                Cancelar
              </button>
            </div>
          </div>

          {/* Form Content */}
          <div className="p-6 md:p-8">
            <form onSubmit={handleSubmit} className="space-y-8">
              {/* Error Display */}
              {error && (
                <div className="animate-in fade-in slide-in-from-top-3 duration-300">
                  <div className="p-4 bg-red-50 border border-red-200 rounded-xl">
                    <div className="flex items-center gap-3">
                      <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0" />
                      <div>
                        <p className="font-medium text-red-700">Error de validación</p>
                        <p className="text-red-600 text-sm mt-1">{error}</p>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Sección: Datos básicos */}
              <div className="space-y-4">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center">
                    <Tag className="w-5 h-5 text-blue-600" />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900">Datos básicos</h3>
                    <p className="text-sm text-gray-500">Información principal del producto</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="block">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="font-medium text-gray-700">Nombre del producto</span>
                        <span className="text-red-500">*</span>
                      </div>
                      <input
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className="w-full px-4 py-3.5 bg-gray-50 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:bg-white transition-all duration-200 placeholder:text-gray-400"
                        placeholder="Ej. CAMISETA SUBLIMADA"
                        autoFocus
                        required
                      />
                      {name && (
                        <div className="text-xs text-gray-500 mt-2 flex items-center gap-1">
                          <span className="font-medium">{name.length}</span> caracteres
                        </div>
                      )}
                    </label>
                  </div>

                  <div className="space-y-2">
                    <label className="block">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="font-medium text-gray-700">Unidad</span>
                        <span className="text-red-500">*</span>
                      </div>
                      <select
                        value={unitType}
                        onChange={(e) => setUnitType(e.target.value as any)}
                        className="w-full px-4 py-3.5 bg-gray-50 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:bg-white transition-all duration-200"
                      >
                        <option value="PIECE">📦 PIEZA (unidades)</option>
                        <option value="METER">📏 METRO (metros lineales)</option>
                      </select>
                    </label>
                  </div>

                  <div className="space-y-2">
                    <label className="block">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="font-medium text-gray-700">Estado</span>
                      </div>
                      <div className="flex items-center gap-4 p-3 bg-gray-50 border border-gray-300 rounded-xl">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="radio"
                            checked={isActive}
                            onChange={() => setIsActive(true)}
                            className="w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500"
                          />
                          <span className="flex items-center gap-1 text-gray-700">
                            <CheckCircle className="w-4 h-4 text-green-600" />
                            Activo
                          </span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="radio"
                            checked={!isActive}
                            onChange={() => setIsActive(false)}
                            className="w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500"
                          />
                          <span className="flex items-center gap-1 text-gray-700">
                            <EyeOff className="w-4 h-4 text-gray-500" />
                            Inactivo
                          </span>
                        </label>
                      </div>
                    </label>
                  </div>

                  <div className="space-y-2">
                    <label className="block">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="font-medium text-gray-700">¿Usa tamaños?</span>
                      </div>
                      <div className="flex items-center gap-4 p-3 bg-gray-50 border border-gray-300 rounded-xl">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="radio"
                            checked={needsVariant}
                            onChange={() => setNeedsVariant(true)}
                            className="w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500"
                          />
                          <span className="text-gray-700">Sí</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="radio"
                            checked={!needsVariant}
                            onChange={() => setNeedsVariant(false)}
                            className="w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500"
                          />
                          <span className="text-gray-700">No</span>
                        </label>
                      </div>
                      <p className="text-xs text-gray-500 mt-2">
                        Si activas esto, podrás crear tamaños después (CH, M, G, etc.)
                      </p>
                    </label>
                  </div>
                </div>
              </div>

              {/* Sección: Reglas de cantidad */}
              <div className="space-y-4 pt-6 border-t border-gray-200">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-xl bg-green-100 flex items-center justify-center">
                    <Layers className="w-5 h-5 text-green-600" />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900">Reglas de cantidad</h3>
                    <p className="text-sm text-gray-500">Controla mínimos e incrementos permitidos</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="space-y-2">
                    <label className="block">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="font-medium text-gray-700">Cantidad mínima</span>
                        <span className="text-red-500">*</span>
                      </div>
                      <div className="relative">
                        <div className="absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-400">
                          <Hash className="w-4 h-4" />
                        </div>
                        <input
                          type="text"
                          value={minQty}
                          onChange={(e) => setMinQty(e.target.value)}
                          className="w-full pl-12 pr-4 py-3.5 bg-gray-50 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:bg-white transition-all duration-200"
                          placeholder={unitType === "METER" ? "0.5" : "1"}
                        />
                      </div>
                      <p className="text-xs text-gray-500 mt-2">Mínimo permitido por pedido</p>
                    </label>
                  </div>

                  <div className="space-y-2">
                    <label className="block">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="font-medium text-gray-700">Paso permitido</span>
                        <span className="text-red-500">*</span>
                      </div>
                      <div className="relative">
                        <div className="absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-400">
                          <Grid3x3 className="w-4 h-4" />
                        </div>
                        <input
                          type="text"
                          value={qtyStep}
                          onChange={(e) => setQtyStep(e.target.value)}
                          className="w-full pl-12 pr-4 py-3.5 bg-gray-50 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:bg-white transition-all duration-200"
                          placeholder={unitType === "METER" ? "0.5" : "1"}
                        />
                      </div>
                      <p className="text-xs text-gray-500 mt-2">Incremento de cantidad permitido</p>
                    </label>
                  </div>

                  <div className="space-y-2">
                    <label className="block">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="font-medium text-gray-700">Precio especial 0.5</span>
                      </div>
                      <div className="relative">
                        <div className="absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-400">
                          <DollarSign className="w-4 h-4" />
                        </div>
                        <input
                          type="text"
                          value={halfSpecial}
                          onChange={(e) => setHalfSpecial(e.target.value)}
                          className="w-full pl-12 pr-4 py-3.5 bg-gray-50 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:bg-white transition-all duration-200"
                          placeholder="Opcional"
                        />
                      </div>
                      <p className="text-xs text-gray-500 mt-2">
                        Precio especial cuando cantidad = 0.5 (solo metros)
                      </p>
                    </label>
                  </div>
                </div>
              </div>

              {/* Nota informativa */}
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-5">
                <div className="flex items-start gap-4">
                  <div className="flex-shrink-0">
                    <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
                      <Info className="w-5 h-5 text-blue-600" />
                    </div>
                  </div>
                  <div className="flex-1">
                    <p className="font-semibold text-blue-800 mb-2">¿Qué sigue después de crear el producto?</p>
                    <ul className="text-sm text-blue-700 space-y-2">
                      <li className="flex items-center gap-2">
                        <ArrowRight className="w-4 h-4" />
                        Agregar tamaños (CH, M, G, etc.) si el producto los requiere
                      </li>
                      <li className="flex items-center gap-2">
                        <ArrowRight className="w-4 h-4" />
                        Configurar parámetros de catálogo (color, material, etc.)
                      </li>
                      <li className="flex items-center gap-2">
                        <ArrowRight className="w-4 h-4" />
                        Definir pasos de proceso de producción
                      </li>
                      <li className="flex items-center gap-2">
                        <ArrowRight className="w-4 h-4" />
                        Asignar precios por sucursal en la sección "Pricing"
                      </li>
                    </ul>
                  </div>
                </div>
              </div>

              {/* Botones */}
              <div className="flex justify-end gap-3 pt-6 border-t border-gray-200">
                <button
                  type="button"
                  onClick={() => nav("/admin/products")}
                  className="px-6 py-3.5 bg-white hover:bg-gray-50 text-gray-800 font-semibold rounded-xl border border-gray-300 transition-all duration-200 hover:shadow-md flex items-center gap-2"
                >
                  <X className="w-4 h-4" />
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={guardando}
                  className={`
                    px-8 py-3.5 rounded-xl font-semibold transition-all duration-300
                    flex items-center gap-2
                    ${guardando
                      ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                      : 'bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white shadow-lg hover:shadow-xl transform hover:-translate-y-0.5'
                    }
                  `}
                >
                  {guardando ? (
                    <>
                      <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                      Creando producto...
                    </>
                  ) : (
                    <>
                      <Save className="w-5 h-5" />
                      Crear Producto
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>

          {/* Card Footer */}
          <div className="px-6 py-4 bg-gray-50 border-t border-gray-200">
            <div className="flex items-center justify-center gap-2 text-sm text-gray-500">
              <Package className="w-4 h-4" />
              <span>Los productos creados estarán disponibles en todas las sucursales</span>
            </div>
          </div>
        </div>

        {/* Additional Info Cards */}
        <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-white/80 backdrop-blur-sm p-5 rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow">
            <div className="text-blue-600 font-bold text-lg mb-3 flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center">
                <Tag className="w-4 h-4 text-blue-600" />
              </div>
              Datos básicos
            </div>
            <p className="text-sm text-gray-600">Define nombre, unidad y si el producto maneja tallas o variantes.</p>
          </div>
          <div className="bg-white/80 backdrop-blur-sm p-5 rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow">
            <div className="text-green-600 font-bold text-lg mb-3 flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-green-100 flex items-center justify-center">
                <Layers className="w-4 h-4 text-green-600" />
              </div>
              Reglas de cantidad
            </div>
            <p className="text-sm text-gray-600">Controla cantidades mínimas y pasos de incremento permitidos.</p>
          </div>
          <div className="bg-white/80 backdrop-blur-sm p-5 rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow">
            <div className="text-purple-600 font-bold text-lg mb-3 flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-purple-100 flex items-center justify-center">
                <Settings className="w-4 h-4 text-purple-600" />
              </div>
              Configuración avanzada
            </div>
            <p className="text-sm text-gray-600">Después podrás agregar tamaños, parámetros y pasos de proceso.</p>
          </div>
        </div>
      </div>
    </div>
  );
}