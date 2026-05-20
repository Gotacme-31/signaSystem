import { useState, useEffect, useMemo } from "react";
import { X, Save, AlertCircle, Calendar, Clock, Package, User, Phone, Trash2, Truck, Store } from "lucide-react";
import {
  getOrderById,
  updateOrder,
  deleteOrder,
  type OrderDetails,
  type PaymentMethod,
  type OrderPaymentRequest,
  type OrderStage,
  type UpdateOrderItemData,
  type ParamChargeType,
  type ShippingType,
} from "../../api/orders";
import { getBranchProducts } from "../../api/pricing";

// IDs de productos que participan en el precio por volumen
const VOLUME_PRODUCT_IDS = [2, 6];
const VOLUME_THRESHOLDS = [12, 100];

type BranchProductRow = {
  productId: number;
  isActive: boolean;
  price: number;
  halfStepSpecialPrice?: number | null;
  product: {
    id: number;
    name: string;
    unitType: "METER" | "PIECE";
    needsVariant: boolean;
    minQty: number;
    qtyStep: number;
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
    chargeType?: ParamChargeType;
  }>;
  variantQuantityPrices?: Array<{
    variantId: number;
    variantName: string;
    minQty: number;
    unitPrice: number;
    isActive: boolean;
    variantIsActive: boolean;
  }>;
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

type EditableSelectedParam = {
  id?: number;
  optionId: number;
  name: string;
  priceDelta: number;
  chargeType: ParamChargeType;
  pieceQty?: number;
};

type EditableItem = {
  id: number;
  productId: number;
  product?: any;
  productNameSnapshot?: string;
  quantity: number;
  unitPrice?: number;
  subtotal?: number;
  variantId?: number | null;
  variantRef?: { id: number; name: string } | null;
  isReady?: boolean;
  currentStepOrder?: number;
  isCustomProduct?: boolean;
  customProductName?: string;
  customUnitType?: "METER" | "PIECE";
  customUnitPrice?: number;

  options: EditableSelectedParam[];

  edited: boolean;
  originalQuantity: number;
  originalIsReady?: boolean;
  originalStepOrder?: number;
  originalVariantId?: number | null;
  originalSelectedParamsSnapshot: string;

  computedUnitPrice: number;
  computedSubtotal: number;
};

type PaymentSplit = OrderPaymentRequest;
const PAYMENT_METHODS: PaymentMethod[] = ["CASH", "TRANSFER", "CARD"];

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
  const [payments, setPayments] = useState<PaymentSplit[]>([{ method: "CASH", amount: 0 }]);
  const [shippingType, setShippingType] = useState<ShippingType>("PICKUP");
  const [hasIva, setHasIva] = useState(false);
  const [stage, setStage] = useState<OrderStage>("REGISTERED");
  const [items, setItems] = useState<EditableItem[]>([]);

  const isAdmin = userRole === "ADMIN";

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

  function normalizeChargeType(v: unknown): ParamChargeType {
    return v === "PER_PIECE" ? "PER_PIECE" : "PER_METER";
  }

  function stableSelectedParamsSnapshot(params: EditableSelectedParam[]) {
    return JSON.stringify(
      [...params]
        .map((p) => ({
          optionId: p.optionId,
          name: p.name,
          priceDelta: asNumber(p.priceDelta, 0),
          chargeType: normalizeChargeType(p.chargeType),
          pieceQty:
            normalizeChargeType(p.chargeType) === "PER_PIECE"
              ? Math.max(1, asNumber(p.pieceQty, 1))
              : undefined,
        }))
        .sort((a, b) => a.optionId - b.optionId)
    );
  }

  function getCatalogProduct(productId: number) {
    return catalog.find((p) => p.productId === productId);
  }

  function getCatalogParam(productId: number, paramId: number) {
    const row = getCatalogProduct(productId);
    if (!row?.paramPrices?.length) return null;

    return (
      row.paramPrices.find(
        (pp) => pp.paramId === paramId && pp.isActive && pp.paramIsActive
      ) ?? null
    );
  }

  function normalizeItemOptions(productId: number, rawOptions: any[]): EditableSelectedParam[] {
    const arr = Array.isArray(rawOptions) ? rawOptions : [];

    return arr.map((op: any) => {
      const optionId = asNumber(op.optionId ?? op.id, 0);
      const meta = getCatalogParam(productId, optionId);

      const chargeType: ParamChargeType =
        op.chargeType === "PER_PIECE"
          ? "PER_PIECE"
          : op.chargeType === "PER_METER"
            ? "PER_METER"
            : meta?.chargeType === "PER_PIECE"
              ? "PER_PIECE"
              : "PER_METER";

      return {
        id: op.id,
        optionId,
        name: op.name ?? meta?.paramName ?? `Parámetro ${optionId}`,
        priceDelta: asNumber(op.priceDelta ?? meta?.priceDelta, 0),
        chargeType,
        pieceQty:
          chargeType === "PER_PIECE"
            ? Math.max(1, asNumber(op.pieceQty ?? op.quantity, 1))
            : undefined
      };
    });
  }

  function getPerMeterParamsDelta(item: EditableItem): number {
    return (item.options ?? []).reduce((sum, op) => {
      if (op.chargeType !== "PER_METER") return sum;
      return sum + asNumber(op.priceDelta, 0);
    }, 0);
  }

  function getPerPieceParamsTotal(item: EditableItem): number {
    return (item.options ?? []).reduce((sum, op) => {
      if (op.chargeType !== "PER_PIECE") return sum;
      return sum + asNumber(op.priceDelta, 0) * Math.max(1, asNumber(op.pieceQty, 1));
    }, 0);
  }

  const totalVolumeQuantity = useMemo(() => {
    return items
      .filter((item) => VOLUME_PRODUCT_IDS.includes(item.productId))
      .reduce((sum, item) => sum + asNumber(item.quantity, 0), 0);
  }, [items]);

  const activeVolumeThreshold = useMemo(() => {
    const sortedThresholds = [...VOLUME_THRESHOLDS].sort((a, b) => b - a);
    for (const threshold of sortedThresholds) {
      if (totalVolumeQuantity >= threshold) {
        return threshold;
      }
    }
    return null;
  }, [totalVolumeQuantity]);

  const getVolumePriceForItem = (item: EditableItem): { price: number; threshold: number } | null => {
    if (!activeVolumeThreshold) return null;

    const product = catalog.find((p) => p.productId === item.productId);
    if (!product) return null;

    const variantId = item.variantId ?? null;

    if (variantId && product.variantQuantityMatrix?.[variantId]) {
      const matrixRows = product.variantQuantityMatrix[variantId];
      const volumePrice = matrixRows.find(
        (r) => r.minQty === activeVolumeThreshold && r.isActive
      );
      if (volumePrice) {
        return { price: volumePrice.unitPrice, threshold: activeVolumeThreshold };
      }
    }

    if (variantId && product.variantQuantityPrices?.length) {
      const volumePrice = product.variantQuantityPrices.find(
        (vqp) =>
          vqp.variantId === variantId &&
          vqp.minQty === activeVolumeThreshold &&
          vqp.isActive &&
          vqp.variantIsActive
      );
      if (volumePrice) {
        return { price: volumePrice.unitPrice, threshold: activeVolumeThreshold };
      }
    }

    if (product.quantityPrices?.length) {
      const volumePrice = product.quantityPrices.find(
        (qp) => qp.minQty === activeVolumeThreshold && qp.isActive
      );
      if (volumePrice) {
        return { price: volumePrice.unitPrice, threshold: activeVolumeThreshold };
      }
    }

    return null;
  };

  const calcUnitPriceFromCatalog = (item: EditableItem): number => {
    if (item.isCustomProduct) {
      return asNumber(item.customUnitPrice ?? item.unitPrice ?? 0, 0);
    }

    const row = catalog.find((p) => p.productId === item.productId);
    if (!row) return asNumber(item.unitPrice, 0);

    const quantity = asNumber(item.quantity, 0);
    const variantId = item.variantId ?? null;

    const half = asNumber(row.halfStepSpecialPrice, 0);
    const isHalfSpecial =
      row.product.unitType === "METER" &&
      nearlyEqual(quantity, 0.5) &&
      half > 0;

    if (isHalfSpecial) {
      return half + getPerMeterParamsDelta(item);
    }

    let basePrice = asNumber(row.price, 0);
    let usedVolumePricing = false;

    if (VOLUME_PRODUCT_IDS.includes(item.productId) && activeVolumeThreshold) {
      const volumePrice = getVolumePriceForItem(item);
      if (volumePrice) {
        basePrice = volumePrice.price;
        usedVolumePricing = true;
      }
    }

    if (!usedVolumePricing) {
      const matrixRows = variantId ? (row.variantQuantityMatrix?.[variantId] ?? []) : [];

      if (variantId && matrixRows.length) {
        const tier = matrixRows
          .filter((r) => r.isActive)
          .filter((r) => quantity >= asNumber(r.minQty))
          .sort((a, b) => asNumber(b.minQty) - asNumber(a.minQty))[0];

        if (tier) basePrice = asNumber(tier.unitPrice, basePrice);
      }

      const usedMatrix = !!(
        variantId &&
        matrixRows.some((r) => r.isActive && quantity >= asNumber(r.minQty))
      );

      if (variantId && !usedMatrix && row.variantPrices?.length) {
        const vp = row.variantPrices.find(
          (v) => v.variantId === variantId && v.isActive && v.variantIsActive
        );
        if (vp) basePrice = asNumber(vp.price, basePrice);
      }

      if (!row.product.needsVariant && row.quantityPrices?.length) {
        const tier = row.quantityPrices
          .filter((q) => q.isActive)
          .filter((q) => quantity >= asNumber(q.minQty))
          .sort((a, b) => asNumber(b.minQty) - asNumber(a.minQty))[0];

        if (tier) basePrice = asNumber(tier.unitPrice, basePrice);
      }
    }

    return basePrice + getPerMeterParamsDelta(item);
  };

  const calcItemSubtotal = (item: EditableItem): number => {
    const row = catalog.find((p) => p.productId === item.productId);
    if (!row) {
      return asNumber(
        item.subtotal,
        asNumber(item.quantity, 0) * asNumber(item.unitPrice, 0)
      );
    }

    const quantity = asNumber(item.quantity, 0);

    const half = asNumber(row.halfStepSpecialPrice, 0);
    const isHalfSpecial =
      row.product.unitType === "METER" &&
      nearlyEqual(quantity, 0.5) &&
      half > 0;

    const unit = calcUnitPriceFromCatalog(item);
    const baseTotal = isHalfSpecial ? unit : quantity * unit;

    return baseTotal + getPerPieceParamsTotal(item);
  };

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

      setDeliveryDate(ord.deliveryDate.split("T")[0]);
      setDeliveryTime(ord.deliveryTime || "");
      setNotes(ord.notes || "");
      setPaymentMethod(ord.paymentMethod as PaymentMethod);
      setPayments(
        ord.payments && ord.payments.length > 0
          ? ord.payments.map((p) => ({
              method: p.method,
              amount: asNumber(p.amount, 0),
              reference: p.reference ?? null,
            }))
          : [{ method: ord.paymentMethod as PaymentMethod, amount: asNumber(ord.total, 0) }]
      );
      setShippingType(ord.shippingType as ShippingType);
      setHasIva(!!ord.hasIva);
      setStage(ord.stage as OrderStage);

      const rows = await getBranchProducts(ord.branchId);

      const filtered = (rows ?? []).filter((r: any) => r?.isActive && r?.product?.id);
      const parsedCatalog: BranchProductRow[] = filtered.map((item: any) => ({
        ...item,
        price: asNumber(item.price),
        halfStepSpecialPrice: (() => {
          const n = asNumber(item.halfStepSpecialPrice, 0);
          return n > 0 ? n : null;
        })(),
        product: {
          ...item.product,
          minQty: asNumber(item.product?.minQty, 1),
          qtyStep: asNumber(item.product?.qtyStep, 1),
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
          chargeType: normalizeChargeType(pp.chargeType),
        })),
        variantQuantityPrices: (item.variantQuantityPrices ?? []).map((vqp: any) => ({
          variantId: asNumber(vqp.variantId),
          variantName: vqp.variantName,
          minQty: asNumber(vqp.minQty),
          unitPrice: asNumber(vqp.unitPrice),
          isActive: !!vqp.isActive,
          variantIsActive: !!vqp.variantIsActive,
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

      const mapped: EditableItem[] = ord.items.map((it: any) => {
        const options = normalizeItemOptions(it.productId, it.options ?? []);

        return {
          ...it,
          edited: false,
          originalQuantity: asNumber(it.quantity),
          originalIsReady: it.isReady,
          originalStepOrder: it.currentStepOrder,
          originalVariantId: it.variantId ?? null,
          quantity: asNumber(it.quantity),
          options,
          originalSelectedParamsSnapshot: stableSelectedParamsSnapshot(options),
          computedUnitPrice: 0,
          computedSubtotal: 0,
        };
      });

      const withComputed = mapped.map((it) => {
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

  useEffect(() => {
    if (!catalog.length) return;

    setItems((prev) =>
      prev.map((it) => {
        const normalizedOptions = normalizeItemOptions(it.productId, it.options ?? []);
        const nextItem = { ...it, options: normalizedOptions };
        const computedUnitPrice = calcUnitPriceFromCatalog(nextItem);
        const computedSubtotal = calcItemSubtotal(nextItem);

        return {
          ...nextItem,
          computedUnitPrice,
          computedSubtotal,
        };
      })
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog, activeVolumeThreshold]);

  async function handleSave() {
    if (!order) return;

    const invalidPieceOption = items.find((item) =>
      item.options.some(
        (op) =>
          op.chargeType === "PER_PIECE" &&
          (!Number.isFinite(asNumber(op.pieceQty, 0)) || asNumber(op.pieceQty, 0) <= 0)
      )
    );

    if (invalidPieceOption) {
      setError("Todos los parámetros PER_PIECE deben tener una cantidad válida mayor a 0.");
      return;
    }

    const saveAction = async () => {
      setSaving(true);
      setError(null);

      try {
        if (payments.length === 0 || payments.some((p) => asNumber(p.amount, 0) <= 0)) {
          setError("Agrega al menos un pago y usa montos mayores a 0.");
          return;
        }
        if (Math.abs(paymentDiff) > 0.01) {
          setError("El pedido debe quedar liquidado: la suma de pagos debe coincidir con el total.");
          return;
        }

        const updatedItems: UpdateOrderItemData[] = items
          .filter((item) => {
            const selectedParamsChanged =
              stableSelectedParamsSnapshot(item.options) !== item.originalSelectedParamsSnapshot;

            return (
              item.edited ||
              selectedParamsChanged ||
              asNumber(item.quantity) !== asNumber(item.originalQuantity) ||
              item.isReady !== item.originalIsReady ||
              item.currentStepOrder !== item.originalStepOrder ||
              (item.variantId ?? null) !== (item.originalVariantId ?? null)
            );
          })
          .map((item) => {
            const selectedParamsChanged =
              stableSelectedParamsSnapshot(item.options) !== item.originalSelectedParamsSnapshot;

            return {
              id: item.id,
              quantity: Number(item.quantity),
              isReady:
                item.isReady !== item.originalIsReady ? item.isReady : undefined,
              currentStepOrder:
                item.currentStepOrder !== item.originalStepOrder
                  ? item.currentStepOrder
                  : undefined,
              variantId:
                (item.variantId ?? null) !== (item.originalVariantId ?? null)
                  ? (item.variantId ?? null)
                  : undefined,
              selectedParams: selectedParamsChanged
                ? item.options.map((op) => ({
                  paramId: op.optionId,
                  chargeType: normalizeChargeType(op.chargeType),
                  pieceQty:
                    normalizeChargeType(op.chargeType) === "PER_PIECE"
                      ? Math.max(1, asNumber(op.pieceQty, 1))
                      : undefined,
                }))
                : undefined,
            };
          });

        await updateOrder(orderId, {
          deliveryDate,
          deliveryTime: deliveryTime || null,
          notes: notes || null,
          paymentMethod: payments[0]?.method ?? paymentMethod,
          payments: payments.map((p) => ({
            method: p.method,
            amount: Number(asNumber(p.amount, 0).toFixed(2)),
            reference: typeof p.reference === "string" && p.reference.trim() ? p.reference.trim() : null,
          })),
          shippingType,
          hasIva,
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
      const patched: EditableItem = { ...old, [field]: value, edited: true };

      if (field === "quantity") patched.quantity = asNumber(value, 0);

      const computedUnitPrice = catalog.length
        ? calcUnitPriceFromCatalog(patched)
        : asNumber(patched.unitPrice, 0);

      const computedSubtotal = catalog.length
        ? calcItemSubtotal(patched)
        : asNumber(patched.subtotal, 0);

      next[index] = { ...patched, computedUnitPrice, computedSubtotal };
      return next;
    });
  }

  function handlePieceParamQtyChange(itemIndex: number, optionId: number, value: any) {
    setItems((prev) => {
      const next = [...prev];
      const item = next[itemIndex];

      const options = item.options.map((op) =>
        op.optionId === optionId
          ? {
            ...op,
            pieceQty: Math.max(1, Math.floor(asNumber(value, 1))),
          }
          : op
      );

      const patched: EditableItem = {
        ...item,
        options,
        edited: true,
      };

      const computedUnitPrice = catalog.length
        ? calcUnitPriceFromCatalog(patched)
        : asNumber(patched.unitPrice, 0);

      const computedSubtotal = catalog.length
        ? calcItemSubtotal(patched)
        : asNumber(patched.subtotal, 0);

      next[itemIndex] = { ...patched, computedUnitPrice, computedSubtotal };
      return next;
    });
  }

  const computedSubtotalBeforeTax = useMemo(() => {
    return items.reduce((sum, it) => sum + asNumber(it.computedSubtotal, 0), 0);
  }, [items]);

  const computedIvaAmount = useMemo(() => {
    return hasIva ? computedSubtotalBeforeTax * 0.16 : 0;
  }, [hasIva, computedSubtotalBeforeTax]);

  const computedTotal = useMemo(() => {
    return computedSubtotalBeforeTax + computedIvaAmount;
  }, [computedSubtotalBeforeTax, computedIvaAmount]);

  const paymentTotal = useMemo(
    () => payments.reduce((sum, p) => sum + asNumber(p.amount, 0), 0),
    [payments]
  );

  const paymentDiff = useMemo(
    () => Number((computedTotal - paymentTotal).toFixed(2)),
    [computedTotal, paymentTotal]
  );

  useEffect(() => {
    if (payments.length !== 1) return;
    setPayments((prev) => {
      if (prev.length !== 1) return prev;
      const nextAmount = Number(computedTotal.toFixed(2));
      if (Math.abs(asNumber(prev[0].amount, 0) - nextAmount) <= 0.01) return prev;
      return [{ ...prev[0], amount: nextAmount }];
    });
  }, [payments.length, computedTotal]);

  const canAddMorePayments = payments.length < 3;

  function addPaymentRow() {
    setPayments((prev) => {
      if (prev.length >= 3) return prev;

      const used = new Set(prev.map((p) => p.method));
      const nextMethod = PAYMENT_METHODS.find((m) => !used.has(m));
      if (!nextMethod) return prev;

      return [...prev, { method: nextMethod, amount: 0 }];
    });
  }

  function changePaymentMethod(index: number, method: PaymentMethod) {
    setPayments((prev) => {
      const duplicate = prev.some((p, i) => i !== index && p.method === method);
      if (duplicate) return prev;
      return prev.map((p, i) => (i === index ? { ...p, method } : p));
    });
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
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

        {totalVolumeQuantity > 0 && (
          <div
            className={`m-6 rounded-2xl p-4 transition-all duration-300 ${activeVolumeThreshold
              ? "bg-gradient-to-r from-green-500 to-emerald-500 text-white shadow-lg"
              : "bg-gradient-to-r from-blue-500 to-cyan-500 text-white"
              }`}
          >
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-white/20 rounded-xl">
                  <Package className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-lg">Precio por Volumen</h3>
                  <p className="text-sm opacity-90">
                    Frazadas + Toallas: {totalVolumeQuantity} unidades totales
                  </p>
                </div>
              </div>
              <div className="flex gap-3">
                {VOLUME_THRESHOLDS.map((threshold) => (
                  <div
                    key={threshold}
                    className={`px-4 py-2 rounded-xl text-center font-medium transition-all ${activeVolumeThreshold && activeVolumeThreshold >= threshold
                      ? "bg-white text-green-600 shadow-md"
                      : "bg-white/20 text-white"
                      }`}
                  >
                    <div className="text-sm">Desde</div>
                    <div className="text-xl font-bold">{threshold}+</div>
                  </div>
                ))}
              </div>
              {activeVolumeThreshold && (
                <div className="flex items-center gap-2 bg-white/20 px-4 py-2 rounded-xl">
                  <span className="font-medium">
                    ¡Precio especial por {activeVolumeThreshold}+ unidades aplicado!
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

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

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Métodos de pago
                  </label>
                  <div className="space-y-2">
                    {payments.map((pay, idx) => (
                      <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                        <select
                          value={pay.method}
                          onChange={(e) => changePaymentMethod(idx, e.target.value as PaymentMethod)}
                          className="col-span-5 px-3 py-2 border border-gray-300 rounded-lg"
                        >
                          {PAYMENT_METHODS.map((method) => {
                            const usedByOther = payments.some((p, i) => i !== idx && p.method === method);
                            const label =
                              method === "CASH" ? "Efectivo" : method === "TRANSFER" ? "Transferencia" : "Tarjeta";
                            return (
                              <option key={method} value={method} disabled={usedByOther}>
                                {label}
                              </option>
                            );
                          })}
                        </select>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={asNumber(pay.amount, 0)}
                          onChange={(e) =>
                            setPayments((prev) =>
                              prev.map((x, i) => (i === idx ? { ...x, amount: Number(e.target.value) } : x))
                            )
                          }
                          className="col-span-5 px-3 py-2 border border-gray-300 rounded-lg"
                          disabled={payments.length === 1}
                        />
                        <button
                          type="button"
                          onClick={() => setPayments((prev) => prev.filter((_, i) => i !== idx))}
                          disabled={payments.length === 1}
                          className="col-span-2 h-10 inline-flex items-center justify-center border border-gray-300 rounded-lg disabled:opacity-40"
                          title="Quitar método"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={addPaymentRow}
                      disabled={!canAddMorePayments}
                      className="px-3 py-2 text-sm border border-gray-300 rounded-lg disabled:opacity-50"
                    >
                      Agregar método {`(${payments.length}/3)`}
                    </button>
                    <p className={`text-xs ${Math.abs(paymentDiff) <= 0.01 ? "text-green-700" : "text-amber-700"}`}>
                      {Math.abs(paymentDiff) <= 0.01
                        ? "Pago liquidado"
                        : paymentDiff > 0
                        ? `Faltan $${paymentDiff.toFixed(2)}`
                        : `Sobra $${Math.abs(paymentDiff).toFixed(2)}`}
                    </p>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Tipo de envío
                  </label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setShippingType("PICKUP")}
                      className={`flex-1 px-4 py-2 rounded-lg border transition-all flex items-center justify-center gap-2 ${shippingType === "PICKUP"
                        ? "bg-green-600 text-white border-green-600"
                        : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                        }`}
                    >
                      <Store className="w-4 h-4" />
                      Recoger
                    </button>
                    <button
                      type="button"
                      onClick={() => setShippingType("DELIVERY")}
                      className={`flex-1 px-4 py-2 rounded-lg border transition-all flex items-center justify-center gap-2 ${shippingType === "DELIVERY"
                        ? "bg-blue-600 text-white border-blue-600"
                        : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                        }`}
                    >
                      <Truck className="w-4 h-4" />
                      Envío
                    </button>
                  </div>
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
              <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                  <div>
                    <h3 className="font-semibold text-gray-900">IVA del pedido</h3>
                    <p className="text-sm text-gray-500">
                      Actívalo solo si este pedido debe incluir IVA.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => setHasIva((prev) => !prev)}
                    className={`px-5 py-2.5 rounded-xl font-semibold border transition-all ${hasIva
                        ? "bg-indigo-600 text-white border-indigo-600"
                        : "bg-white text-gray-700 border-gray-300 hover:bg-indigo-50 hover:border-indigo-300"
                      }`}
                  >
                    {hasIva ? "✓ Con IVA" : "Sin IVA"}
                  </button>
                </div>

                <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                  <div className="bg-white rounded-lg border border-gray-200 p-3">
                    <p className="text-gray-500">Subtotal</p>
                    <p className="font-bold text-gray-900">
                      ${computedSubtotalBeforeTax.toFixed(2)}
                    </p>
                  </div>

                  <div className="bg-white rounded-lg border border-gray-200 p-3">
                    <p className="text-gray-500">IVA 16%</p>
                    <p className={`font-bold ${hasIva ? "text-indigo-700" : "text-gray-400"}`}>
                      ${computedIvaAmount.toFixed(2)}
                    </p>
                  </div>

                  <div className="bg-white rounded-lg border border-gray-200 p-3">
                    <p className="text-gray-500">Total final</p>
                    <p className="font-bold text-green-700">
                      ${computedTotal.toFixed(2)}
                    </p>
                  </div>
                </div>
              </div>
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
                    const unitToShow = catalog.length
                      ? asNumber(item.computedUnitPrice, 0)
                      : asNumber(item.unitPrice, 0);

                    const subtotalToShow = catalog.length
                      ? asNumber(item.computedSubtotal, 0)
                      : asNumber(item.subtotal, 0);

                    const meterExtras = getPerMeterParamsDelta(item);
                    const pieceExtras = getPerPieceParamsTotal(item);
                    const isVolumeProduct = VOLUME_PRODUCT_IDS.includes(item.productId);
                    const isUsingVolumePrice =
                      isVolumeProduct &&
                      activeVolumeThreshold &&
                      (catalog.length ? getVolumePriceForItem(item) !== null : false);

                    return (
                      <div
                        key={item.id}
                        className={`rounded-lg p-4 border ${isUsingVolumePrice
                          ? "bg-green-50 border-green-300"
                          : "bg-gray-50 border-gray-200"
                          }`}
                      >
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex flex-col gap-1">
                            <span className="font-medium">
                              {item.isCustomProduct ? (item.customProductName ?? "Producto libre") : (item.product?.name ?? item.productNameSnapshot)}
                            </span>
                            {item.isCustomProduct && (
                              <span className="text-xs bg-purple-200 text-purple-800 px-2 py-0.5 rounded font-medium w-fit">
                                LIBRE
                              </span>
                            )}
                          </div>
                          <div className="flex gap-2">
                            {item.variantRef?.name && (
                              <span className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded-full">
                                {item.variantRef.name}
                              </span>
                            )}
                            {isUsingVolumePrice && (
                              <span className="text-xs bg-green-200 text-green-800 px-2 py-1 rounded-full">
                                Precio {activeVolumeThreshold}+
                              </span>
                            )}
                          </div>
                        </div>

                        {Array.isArray(item.options) && item.options.length > 0 && (
                          <div className="mb-3 space-y-3">
                            {item.options.map((op) => (
                              <div
                                key={op.id ?? `${op.optionId}-${idx}`}
                                className="rounded-lg border bg-white p-3"
                              >
                                <div className="flex items-center justify-between gap-3 flex-wrap">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="text-sm font-medium text-gray-800">{op.name}</span>

                                    <span className="text-xs px-2 py-1 rounded-full border bg-gray-50 text-gray-700">
                                      {op.chargeType === "PER_PIECE" ? "Por pieza" : "Por metro"}
                                    </span>

                                    <span className="text-xs text-gray-500">
                                      {asNumber(op.priceDelta, 0) >= 0 ? "+" : ""}
                                      ${asNumber(op.priceDelta, 0).toFixed(2)}
                                    </span>
                                  </div>

                                  {op.chargeType === "PER_PIECE" && (
                                    <div className="flex items-center gap-2">
                                      <label className="text-xs text-gray-500">Piezas</label>
                                      <input
                                        type="number"
                                        min={1}
                                        step={1}
                                        value={Math.max(1, asNumber(op.pieceQty, 1))}
                                        onChange={(e) =>
                                          handlePieceParamQtyChange(idx, op.optionId, e.target.value)
                                        }
                                        className="w-24 px-3 py-1 border border-gray-300 rounded-lg focus:ring-1 focus:ring-blue-500"
                                      />
                                    </div>
                                  )}
                                </div>

                                {op.chargeType === "PER_PIECE" && (
                                  <div className="mt-2 text-xs text-purple-600">
                                    Extra por pieza: $
                                    {(Math.max(1, asNumber(op.pieceQty, 1)) * asNumber(op.priceDelta, 0)).toFixed(2)}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}

                        <div className="grid grid-cols-3 gap-3">
                          <div>
                            <label className="text-xs text-gray-500">Cantidad</label>
                            <input
                              type="number"
                              step={item.product?.unitType === "METER" ? "0.5" : "1"}
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
                              className={`w-full px-3 py-1 border rounded-lg ${isUsingVolumePrice
                                ? "bg-green-100 text-green-800 border-green-200"
                                : "bg-gray-100 border-gray-300 text-gray-500"
                                } cursor-not-allowed`}
                            />
                            {isUsingVolumePrice && (
                              <p className="text-xs text-green-600 mt-1">Precio por volumen aplicado</p>
                            )}
                            <div className="mt-2 space-y-1 text-xs">
                              <p className="text-gray-600">Precio base: <span className="font-semibold text-gray-800">${(unitToShow - meterExtras).toFixed(2)}</span></p>
                              <p className="text-blue-700">Extras por metro: <span className="font-semibold">+${meterExtras.toFixed(2)}</span></p>
                              </div>
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

              {totalVolumeQuantity > 0 && (
                <div className="bg-blue-50 rounded-xl p-4 border border-blue-200">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-blue-700 font-medium">Total Frazadas + Toallas:</span>
                    <span className="text-blue-900 font-bold text-xl">{totalVolumeQuantity} unidades</span>
                  </div>
                  <div className="flex gap-2 mt-2">
                    {VOLUME_THRESHOLDS.map((threshold) => (
                      <div
                        key={threshold}
                        className={`flex-1 text-center px-2 py-1 rounded text-xs font-medium ${totalVolumeQuantity >= threshold
                          ? "bg-green-500 text-white"
                          : "bg-gray-200 text-gray-600"
                          }`}
                      >
                        {threshold}+
                      </div>
                    ))}
                  </div>
                  {activeVolumeThreshold ? (
                    <p className="text-xs text-green-600 mt-2">
                      ✓ Precio por volumen de {activeVolumeThreshold}+ unidades aplicado
                    </p>
                  ) : (
                    <p className="text-xs text-blue-600 mt-2">
                      Agrega {Math.max(0, 12 - totalVolumeQuantity)} unidades más para activar precio por volumen
                    </p>
                  )}
                </div>
              )}

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
              className={`px-6 py-2.5 rounded-lg font-semibold shadow-md hover:shadow-lg transition-all flex items-center gap-2 ${isAdmin
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
