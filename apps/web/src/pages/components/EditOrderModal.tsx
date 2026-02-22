import { useState, useEffect, useMemo } from "react";
import { X, Save, AlertCircle, Calendar, Clock, Package, User, Phone, Trash2 } from "lucide-react";
import {
  getOrderById,
  updateOrder,
  deleteOrder,
  type OrderDetails,
  type PaymentMethod,
  type OrderStage,
  type UpdateOrderItemData,
} from "../../api/orders";

// ✅ AJUSTA ESTE PATH si tu api/pricing está en otro lado
import { getBranchProducts } from "../../api/pricing";

type BranchProductRow = {
  productId: number;
  isActive: boolean;
  price: number;

  product: {
    id: number;
    name: string;
    unitType: "METER" | "PIECE";
    needsVariant: boolean;
    minQty: number;
    qtyStep: number;
    halfStepSpecialPrice?: number | null;
  };

  quantityPrices?: Array<{
    minQty: number;
    unitPrice: number;
    isActive: boolean;
  }>;

  variantPrices?: Array<{
    variantId: number;
    variantName: string;
    price: number;
    isActive: boolean;
    variantIsActive: boolean;
  }>;

  paramPrices?: Array<{
    paramId: number;
    paramName: string;
    priceDelta: number;
    isActive: boolean;
    paramIsActive: boolean;
  }>;

  // ✅ IMPORTANTE: tiers por cantidad por tamaño (la que realmente usas)
  variantQuantityMatrix?: Record<
    number,
    Array<{
      id?: number | null;
      minQty: number;
      unitPrice: number;
      isActive: boolean;
    }>
  >;
};

interface EditOrderModalProps {
  isOpen: boolean;
  onClose: () => void;
  orderId: number;
  onSuccess: () => void;
  userRole: string;
  onVerifyPassword: (callback: () => void) => void;
}

export default function EditOrderModal({
  isOpen,
  onClose,
  orderId,
  onSuccess,
  userRole,
  onVerifyPassword,
}: EditOrderModalProps) {
  const [order, setOrder] = useState<OrderDetails | null>(null);
  const [catalog, setCatalog] = useState<BranchProductRow[]>([]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Form state
  const [deliveryDate, setDeliveryDate] = useState("");
  const [deliveryTime, setDeliveryTime] = useState("");
  const [notes, setNotes] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("CASH");
  const [stage, setStage] = useState<OrderStage>("REGISTERED");
  const [items, setItems] = useState<any[]>([]);

  const isAdmin = userRole === "ADMIN";

  // -------------------- utils --------------------
  function nearlyEqual(a: number, b: number, eps = 1e-6) {
    return Math.abs(a - b) < eps;
  }

  function asNumber(v: unknown, fallback = 0): number {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string") {
      const n = Number(v);
      return Number.isFinite(n) ? n : fallback;
    }
    if (v && typeof v === "object" && typeof (v as any).toString === "function") {
      const n = Number((v as any).toString());
      return Number.isFinite(n) ? n : fallback;
    }
    return fallback;
  }

  // -------------------- pricing calc (igual a NewOrder, usando variantQuantityMatrix) --------------------
  const calcUnitPriceFromCatalog = (item: any): number => {
    const row = catalog.find((p) => p.productId === item.productId);
    if (!row) return asNumber(item.unitPrice, 0); // fallback a lo guardado

    const quantity = asNumber(item.quantity, 0);
    const variantId = item.variantId ?? null;

    // 0.5 especial fijo
    const half = asNumber(row.product.halfStepSpecialPrice, 0);
    const isHalfSpecial =
      row.product.unitType === "METER" &&
      nearlyEqual(quantity, 0.5) &&
      half > 0;

    if (isHalfSpecial) return half;

    let basePrice = asNumber(row.price, 0);

    // 1) matriz variante+cantidad (PRIORIDAD 1)
    const matrixRows = variantId ? (row.variantQuantityMatrix?.[variantId] ?? []) : [];
    if (variantId && matrixRows.length) {
      const tier = matrixRows
        .filter((r) => r.isActive)
        .filter((r) => quantity >= asNumber(r.minQty))
        .sort((a, b) => asNumber(b.minQty) - asNumber(a.minQty))[0];

      if (tier) basePrice = asNumber(tier.unitPrice, basePrice);
    }

    const usedMatrix = !!(variantId && matrixRows.some((r) => r.isActive && quantity >= asNumber(r.minQty)));

    // 2) precio base por variante (si NO aplicó matriz)
    if (variantId && !usedMatrix && row.variantPrices?.length) {
      const vp = row.variantPrices.find(
        (v) => v.variantId === variantId && v.isActive && v.variantIsActive
      );
      if (vp) basePrice = asNumber(vp.price, basePrice);
    }

    // 3) tiers por cantidad SOLO si NO requiere tamaño
    if (!row.product.needsVariant && row.quantityPrices?.length) {
      const tier = row.quantityPrices
        .filter((q) => q.isActive)
        .filter((q) => quantity >= asNumber(q.minQty))
        .sort((a, b) => asNumber(b.minQty) - asNumber(a.minQty))[0];

      if (tier) basePrice = asNumber(tier.unitPrice, basePrice);
    }

    // params por unidad:
    // En Edit, tus params ya vienen en item.options con priceDelta (snapshot).
    // Si prefieres recalcular desde pricing actual, aquí podrías mapear optionId -> paramPrices.
    const optionDelta =
      Array.isArray(item.options)
        ? item.options.reduce((sum: number, op: any) => sum + asNumber(op.priceDelta, 0), 0)
        : 0;

    return basePrice + optionDelta;
  };

  const calcItemSubtotal = (item: any): number => {
    const row = catalog.find((p) => p.productId === item.productId);
    if (!row) return asNumber(item.subtotal, asNumber(item.quantity, 0) * asNumber(item.unitPrice, 0));

    const quantity = asNumber(item.quantity, 0);

    const half = asNumber(row.product.halfStepSpecialPrice, 0);
    const isHalfSpecial =
      row.product.unitType === "METER" &&
      nearlyEqual(quantity, 0.5) &&
      half > 0;

    if (isHalfSpecial) return half; // fijo, NO multiplica

    const unit = calcUnitPriceFromCatalog(item);
    return quantity * unit;
  };

  // -------------------- load order + pricing --------------------
  useEffect(() => {
    if (isOpen && orderId) loadOrderAndPricing();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, orderId]);

  async function loadOrderAndPricing() {
    setLoading(true);
    setError(null);

    try {
      const data = await getOrderById(orderId);
      const ord = data.order;
      setOrder(ord);

      // init form
      setDeliveryDate(ord.deliveryDate.split("T")[0]);
      setDeliveryTime(ord.deliveryTime || "");
      setNotes(ord.notes || "");
      setPaymentMethod(ord.paymentMethod as PaymentMethod);
      setStage(ord.stage as OrderStage);

      // cargar pricing por sucursal del pedido
      const rows = await getBranchProducts(ord.branchId);

      const filtered = (rows ?? []).filter((r: any) => r?.isActive && r?.product?.id);
      const parsedCatalog: BranchProductRow[] = filtered.map((item: any) => ({
        ...item,
        price: asNumber(item.price),
        product: {
          ...item.product,
          minQty: asNumber(item.product?.minQty, 1),
          qtyStep: asNumber(item.product?.qtyStep, 1),
          halfStepSpecialPrice: (() => {
            const n = asNumber(item.product?.halfStepSpecialPrice, 0);
            return n > 0 ? n : null;
          })(),
        },
        quantityPrices: (item.quantityPrices ?? []).map((qp: any) => ({
          minQty: asNumber(qp.minQty),
          unitPrice: asNumber(qp.unitPrice),
          isActive: !!qp.isActive,
        })),
        variantPrices: (item.variantPrices ?? []).map((vp: any) => ({
          variantId: asNumber(vp.variantId),
          variantName: vp.variantName,
          price: asNumber(vp.price),
          isActive: !!vp.isActive,
          variantIsActive: !!vp.variantIsActive,
        })),
        paramPrices: (item.paramPrices ?? []).map((pp: any) => ({
          paramId: asNumber(pp.paramId),
          paramName: pp.paramName,
          priceDelta: asNumber(pp.priceDelta),
          isActive: !!pp.isActive,
          paramIsActive: !!pp.paramIsActive,
        })),
        variantQuantityMatrix: item.variantQuantityMatrix
          ? Object.fromEntries(
              Object.entries(item.variantQuantityMatrix).map(([vid, arr]: any) => [
                Number(vid),
                (arr ?? []).map((r: any) => ({
                  id: r.id ?? null,
                  minQty: asNumber(r.minQty),
                  unitPrice: asNumber(r.unitPrice),
                  isActive: !!r.isActive,
                })),
              ])
            )
          : {},
      }));

      setCatalog(parsedCatalog);

      // items del pedido (marcar originales)
      const mapped = ord.items.map((it: any) => ({
        ...it,
        // para detectar cambios
        edited: false,
        originalQuantity: asNumber(it.quantity),
        originalIsReady: it.isReady,
        originalStepOrder: it.currentStepOrder,
        originalVariantId: it.variantId ?? null,

        // asegurar number
        quantity: asNumber(it.quantity),

        // ✅ mostrar el cálculo correcto (front)
        computedUnitPrice: 0,
        computedSubtotal: 0,
      }));

      // calcula con catálogo (si ya está)
      const withComputed = mapped.map((it: any) => {
        const computedUnitPrice = calcUnitPriceFromCatalog(it);
        const computedSubtotal = calcItemSubtotal(it);
        return { ...it, computedUnitPrice, computedSubtotal };
      });

      setItems(withComputed);
    } catch (err: any) {
      setError(err?.message || "Error al cargar pedido");
    } finally {
      setLoading(false);
    }
  }

  // si cambia catálogo o items (por edición), recalcula computed*
  useEffect(() => {
    if (!catalog.length) return;
    setItems((prev) =>
      prev.map((it: any) => {
        const computedUnitPrice = calcUnitPriceFromCatalog(it);
        const computedSubtotal = calcItemSubtotal(it);
        return { ...it, computedUnitPrice, computedSubtotal };
      })
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog]);

  // -------------------- save / delete --------------------
  async function handleSave() {
    if (!order) return;

    const saveAction = async () => {
      setSaving(true);
      setError(null);

      try {
        const updatedItems: UpdateOrderItemData[] = items
          .filter((item: any) => item.edited)
          .map((item: any) => ({
            id: item.id,
            quantity: Number(item.quantity),
            // ❌ NO mandamos unitPrice (backend recalcula)
            isReady: item.isReady !== item.originalIsReady ? item.isReady : undefined,
            currentStepOrder:
              item.currentStepOrder !== item.originalStepOrder ? item.currentStepOrder : undefined,
            variantId: (item.variantId ?? null) !== (item.originalVariantId ?? null) ? (item.variantId ?? null) : undefined,
          }));

        await updateOrder(orderId, {
          deliveryDate,
          deliveryTime: deliveryTime || null,
          notes: notes || null,
          paymentMethod,
          stage,
          items: updatedItems.length > 0 ? updatedItems : undefined,
        });

        onSuccess();
        onClose();
      } catch (err: any) {
        setError(err?.message || "Error al guardar cambios");
      } finally {
        setSaving(false);
      }
    };

    if (!isAdmin) onVerifyPassword(saveAction);
    else await saveAction();
  }

  async function handleDelete() {
    if (!order) return;

    setSaving(true);
    setError(null);
    try {
      await deleteOrder(orderId);
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err?.message || "Error al eliminar pedido");
    } finally {
      setSaving(false);
    }
  }

  function handleItemChange(index: number, field: string, value: any) {
    setItems((prev) => {
      const next = [...prev];
      const old = next[index];
      const patched = { ...old, [field]: value, edited: true };

      // normaliza quantity a number cuando cambian cantidad
      if (field === "quantity") patched.quantity = asNumber(value, 0);

      // recalcula computed
      const computedUnitPrice = catalog.length ? calcUnitPriceFromCatalog(patched) : asNumber(patched.unitPrice, 0);
      const computedSubtotal = catalog.length ? calcItemSubtotal(patched) : asNumber(patched.subtotal, 0);

      next[index] = { ...patched, computedUnitPrice, computedSubtotal };
      return next;
    });
  }

  // Totales visuales (solo UI)
  const computedTotal = useMemo(() => {
    return items.reduce((sum: number, it: any) => sum + asNumber(it.computedSubtotal, 0), 0);
  }, [items]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className={`p-6 border-b ${isAdmin ? "bg-purple-50" : "bg-blue-50"}`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`p-3 rounded-xl ${isAdmin ? "bg-purple-100" : "bg-blue-100"}`}>
                <Package className={`w-6 h-6 ${isAdmin ? "text-purple-600" : "text-blue-600"}`} />
              </div>
              <div>
                <h2 className="text-2xl font-bold text-gray-900">Editar Pedido #{orderId}</h2>
                <p className="text-sm text-gray-600 mt-1">
                  {isAdmin ? "Modo administrador - cambios sin verificación" : "Verifica tu contraseña para guardar cambios"}
                </p>
                {catalog.length > 0 && (
                  <p className="text-xs text-gray-500 mt-1">
                    Cálculo estimado (front): <span className="font-semibold">${computedTotal.toFixed(2)}</span>
                  </p>
                )}
              </div>
            </div>

            <button onClick={onClose} className="p-2 hover:bg-white/50 rounded-lg transition-colors">
              <X className="w-5 h-5 text-gray-500" />
            </button>
          </div>
        </div>

        {/* Contenido */}
        <div className="p-6">
          {loading ? (
            <div className="flex justify-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
            </div>
          ) : error ? (
            <div className="p-4 bg-red-50 border border-red-200 rounded-xl">
              <div className="flex items-center gap-3">
                <AlertCircle className="w-5 h-5 text-red-600" />
                <p className="text-red-700">{error}</p>
              </div>
            </div>
          ) : order ? (
            <div className="space-y-6">
              {/* Información del cliente */}
              <div className="bg-gray-50 rounded-xl p-4">
                <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                  <User className="w-4 h-4" />
                  Cliente
                </h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-gray-500">Nombre</p>
                    <p className="font-medium">{order.customer.name}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Teléfono</p>
                    <p className="font-medium flex items-center gap-1">
                      <Phone className="w-3 h-3" />
                      {order.customer.phone}
                    </p>
                  </div>
                </div>
              </div>

              {/* Fechas */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    <Calendar className="w-4 h-4 inline mr-2" />
                    Fecha de entrega
                  </label>
                  <input
                    type="date"
                    value={deliveryDate}
                    onChange={(e) => setDeliveryDate(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    <Clock className="w-4 h-4 inline mr-2" />
                    Hora de entrega
                  </label>
                  <input
                    type="time"
                    value={deliveryTime}
                    onChange={(e) => setDeliveryTime(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
              </div>

              {/* Método de pago y etapa */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Método de pago</label>
                  <select
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="CASH">Efectivo</option>
                    <option value="TRANSFER">Transferencia</option>
                    <option value="CARD">Tarjeta</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Etapa</label>
                  <select
                    value={stage}
                    onChange={(e) => setStage(e.target.value as OrderStage)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="REGISTERED">Registrado</option>
                    <option value="IN_PROGRESS">En proceso</option>
                    <option value="READY">Listo</option>
                    <option value="DELIVERED">Entregado</option>
                  </select>
                </div>
              </div>

              {/* Notas */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Notas</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="Notas adicionales..."
                />
              </div>

              {/* Items */}
              <div>
                <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                  <Package className="w-4 h-4" />
                  Productos
                </h3>

                {!catalog.length && (
                  <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-800 mb-3">
                    No pude cargar el catálogo de pricing; se mostrará el precio guardado del pedido.
                  </div>
                )}

                <div className="space-y-3">
                  {items.map((item, idx) => {
                    const unitToShow = catalog.length ? asNumber(item.computedUnitPrice, 0) : asNumber(item.unitPrice, 0);
                    const subtotalToShow = catalog.length ? asNumber(item.computedSubtotal, 0) : asNumber(item.subtotal, 0);

                    return (
                      <div key={item.id} className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                        <div className="flex items-start justify-between mb-2">
                          <span className="font-medium">{item.product?.name ?? item.productNameSnapshot}</span>
                          {item.variantRef?.name && (
                            <span className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded-full">
                              {item.variantRef.name}
                            </span>
                          )}
                        </div>

                        {/* opciones/params */}
                        {Array.isArray(item.options) && item.options.length > 0 && (
                          <div className="mb-3 flex flex-wrap gap-2">
                            {item.options.map((op: any) => (
                              <span
                                key={op.id ?? `${op.name}-${idx}`}
                                className="text-xs px-2 py-1 rounded-full border bg-white text-gray-700"
                              >
                                {op.name}
                                {asNumber(op.priceDelta, 0) !== 0 && (
                                  <span className="ml-1 text-gray-500">
                                    ({asNumber(op.priceDelta, 0) >= 0 ? "+" : ""}
                                    ${asNumber(op.priceDelta, 0).toFixed(2)})
                                  </span>
                                )}
                              </span>
                            ))}
                          </div>
                        )}

                        <div className="grid grid-cols-3 gap-3">
                          <div>
                            <label className="text-xs text-gray-500">Cantidad</label>
                            <input
                              type="number"
                              step="0.5"
                              value={item.quantity}
                              onChange={(e) => handleItemChange(idx, "quantity", e.target.value)}
                              className="w-full px-3 py-1 border border-gray-300 rounded-lg focus:ring-1 focus:ring-blue-500"
                            />
                          </div>

                          <div>
                            <label className="text-xs text-gray-500">Precio unit.</label>
                            <input
                              type="number"
                              step="0.01"
                              value={unitToShow.toFixed(2)}
                              disabled
                              className="w-full px-3 py-1 bg-gray-100 border border-gray-300 rounded-lg text-gray-500 cursor-not-allowed"
                            />
                            <p className="text-xs text-gray-400 mt-1">Se calcula automáticamente</p>
                          </div>

                          <div>
                            <label className="text-xs text-gray-500">Subtotal</label>
                            <input
                              type="number"
                              value={subtotalToShow.toFixed(2)}
                              disabled
                              className="w-full px-3 py-1 bg-gray-100 border border-gray-300 rounded-lg text-gray-500"
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Delete admin */}
              {isAdmin && (
                <div className="pt-4 border-t border-gray-200">
                  {!showDeleteConfirm ? (
                    <button
                      onClick={() => setShowDeleteConfirm(true)}
                      className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg flex items-center gap-2"
                    >
                      <Trash2 className="w-4 h-4" />
                      Eliminar Pedido
                    </button>
                  ) : (
                    <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                      <p className="text-red-700 mb-3 font-medium">¿Estás seguro de eliminar este pedido?</p>
                      <p className="text-sm text-red-600 mb-4">Esta acción no se puede deshacer.</p>
                      <div className="flex gap-3">
                        <button
                          onClick={() => setShowDeleteConfirm(false)}
                          className="px-4 py-2 bg-white hover:bg-gray-50 text-gray-800 rounded-lg border border-gray-300"
                        >
                          Cancelar
                        </button>
                        <button
                          onClick={handleDelete}
                          disabled={saving}
                          className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg flex items-center gap-2"
                        >
                          {saving ? (
                            <>
                              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                              Eliminando...
                            </>
                          ) : (
                            "Sí, eliminar"
                          )}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : null}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-gray-200 bg-gray-50">
          <div className="flex justify-end gap-3">
            <button
              onClick={onClose}
              className="px-6 py-2.5 bg-white hover:bg-gray-50 text-gray-800 font-semibold rounded-lg border border-gray-300 transition-colors"
            >
              Cancelar
            </button>

            <button
              onClick={handleSave}
              disabled={saving || loading}
              className={`px-6 py-2.5 rounded-lg font-semibold shadow-md hover:shadow-lg transition-all flex items-center gap-2 ${
                isAdmin
                  ? "bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white"
                  : "bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white"
              } disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              {saving ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                  Guardando...
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  Guardar Cambios
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}