import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth/useAuth";
import { getBranches, getBranchProducts } from "../api/pricing";
import { getCustomerById } from "../api/customers";
import { createOrder } from "../api/orders";
import {
  ShoppingCart,
  User,
  Building,
  Calendar,
  Truck,
  CreditCard,
  Package,
  Plus,
  Trash2,
  Search,
  CheckCircle,
  AlertCircle,
  ChevronDown,
  Save,
  Info,
  Shield,
  Receipt
} from "lucide-react";
import { useNavigate } from "react-router-dom";

type Branch = { id: number; name: string; isActive: boolean };

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
  variantQuantityPrices?: Array<{
    variantId: number;
    variantName: string;
    minQty: number;
    unitPrice: number;
    isActive: boolean;
    variantIsActive: boolean;
  }>;
  variantQuantityMatrix?: Record<number, Array<{
    id?: number | null;
    minQty: string | number;
    unitPrice: string | number;
    isActive: boolean;
  }>>;
};

type OrderItem = {
  productId: number;
  quantity: number;
  variantId?: number | null;
  selectedParams: number[];
  unitPrice?: number;
  subtotal?: number;
};

export default function NewOrder() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState<number | null>(null);
  const [pickupBranchId, setPickupBranchId] = useState<number | null>(null);

  const [catalog, setCatalog] = useState<BranchProductRow[]>([]);
  const [loadingCatalog, setLoadingCatalog] = useState(false);

  const [customerNumber, setCustomerNumber] = useState("");
  const [customer, setCustomer] = useState<{ id: number; name: string; phone: string } | null>(null);
  const [customerErr, setCustomerErr] = useState<string | null>(null);
  const [lookingUp, setLookingUp] = useState(false);

  const [items, setItems] = useState<OrderItem[]>([]);
  const [saving, setSaving] = useState(false);

  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [deliveryDate, setDeliveryDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [deliveryTime, setDeliveryTime] = useState("18:00");
  const [showTimeDropdown, setShowTimeDropdown] = useState(false);
  const [shippingType, setShippingType] = useState<"PICKUP" | "DELIVERY">("PICKUP");
  const [paymentMethod, setPaymentMethod] = useState<"CASH" | "TRANSFER" | "CARD">("CASH");
  const [notes, setNotes] = useState("");

  // === UTILIDADES ===
  function nearlyEqual(a: number, b: number, eps = 1e-6) {
    return Math.abs(a - b) < eps;
  }
  function flattenVariantQtyMatrix(
    matrix: any,
    asNumber: (v: unknown, fallback?: number) => number
  ): Array<{
    variantId: number;
    variantName: string;
    minQty: number;
    unitPrice: number;
    isActive: boolean;
    variantIsActive: boolean;
  }> {
    if (!matrix || typeof matrix !== "object") return [];

    const out: Array<{
      variantId: number;
      variantName: string;
      minQty: number;
      unitPrice: number;
      isActive: boolean;
      variantIsActive: boolean;
    }> = [];

    for (const [variantIdStr, rows] of Object.entries(matrix)) {
      const variantId = Number(variantIdStr);
      if (!Number.isFinite(variantId)) continue;

      const arr = Array.isArray(rows) ? rows : [];
      for (const r of arr as any[]) {
        out.push({
          variantId,
          variantName: "", // lo llenamos con meta después si se puede
          minQty: asNumber(r?.minQty, 0),
          unitPrice: asNumber(r?.unitPrice, 0),
          isActive: !!r?.isActive,
          variantIsActive: true, // lo llenamos con meta después si se puede
        });
      }
    }

    return out;
  }
  function asNumber(v: unknown, fallback = 0): number {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string") {
      const n = Number(v);
      return Number.isFinite(n) ? n : fallback;
    }
    // Prisma.Decimal u objetos
    if (v && typeof v === "object" && typeof (v as any).toString === "function") {
      const n = Number((v as any).toString());
      return Number.isFinite(n) ? n : fallback;
    }
    return fallback;
  }


  // Generar opciones de hora
  const timeOptions = useMemo(() => {
    const options = [];
    for (let hour = 8; hour <= 20; hour++) {
      for (let minute = 0; minute < 60; minute += 30) {
        const hh = hour.toString().padStart(2, '0');
        const mm = minute.toString().padStart(2, '0');
        const time24 = `${hh}:${mm}`;

        let hour12 = hour === 12 ? 12 : hour % 12;
        if (hour12 === 0) hour12 = 12;
        const ampm = hour >= 12 ? 'p.m.' : 'a.m.';
        const displayTime = `${hour12}:${mm} ${ampm}`;

        options.push({
          value: time24,
          label: displayTime,
          hour24: hour,
          minute24: minute
        });
      }
    }
    return options;
  }, []);

  const getDisplayTime = (time24: string) => {
    if (!time24) return "Seleccionar hora";

    const [hours, minutes] = time24.split(':').map(Number);
    if (isNaN(hours) || isNaN(minutes)) return time24;

    let hour12 = hours === 12 ? 12 : hours % 12;
    if (hour12 === 0) hour12 = 12;
    const ampm = hours >= 12 ? 'p.m.' : 'a.m.';
    return `${hour12}:${minutes.toString().padStart(2, '0')} ${ampm}`;
  };

  // === VALIDACIONES ===
  function validateDateTime(dateString: string, timeString: string): string | null {
    if (!dateString) return "La fecha es requerida";
    if (!timeString) return "La hora es requerida";

    const selectedDateOnly = new Date(`${dateString}T00:00:00`);
    if (selectedDateOnly.getDay() === 0) return "Los domingos no hay servicio";

    const now = new Date();

    const [hh, mm] = timeString.split(":").map(Number);
    const selected = new Date(`${dateString}T00:00:00`);
    selected.setHours(hh, mm, 0, 0);

    if (selected.getTime() < now.getTime()) {
      return "La fecha/hora seleccionada ya pasó";
    }

    return null;
  }

  // === EFECTOS ===
  useEffect(() => {
    if (!user) return;

    if (!user.branchId) {
      setErr("Tu usuario no tiene sucursal asignada.");
      return;
    }

    setBranchId(user.branchId);

    (async () => {
      const b = await getBranches();
      setBranches(b.filter((x: any) => x.isActive));
    })().catch((e) => setErr(e.message));
  }, [user]);

  useEffect(() => {
    if (branchId && pickupBranchId == null) setPickupBranchId(branchId);
  }, [branchId, pickupBranchId]);

  useEffect(() => {
    if (!branchId) return;

    (async () => {
      setLoadingCatalog(true);
      setErr(null);

      try {
        const rows = await getBranchProducts(branchId);

        const filtered = rows.filter(
          (r: any) => r.isActive && r.product && r.product.id
        ) as any[];

        const parsedCatalog: BranchProductRow[] = filtered.map((item: any) => {
          // 1) Normaliza arrays existentes
          const quantityPrices =
            item.quantityPrices?.map((qp: any) => ({
              minQty: asNumber(qp.minQty),
              unitPrice: asNumber(qp.unitPrice),
              isActive: !!qp.isActive,
            })) ?? [];

          const variantPrices =
            item.variantPrices?.map((vp: any) => ({
              variantId: vp.variantId,
              variantName: vp.variantName,
              price: asNumber(vp.price),
              isActive: !!vp.isActive,
              variantIsActive: !!vp.variantIsActive,
            })) ?? [];

          const paramPrices =
            item.paramPrices?.map((pp: any) => ({
              paramId: pp.paramId,
              paramName: pp.paramName,
              priceDelta: asNumber(pp.priceDelta),
              isActive: !!pp.isActive,
              paramIsActive: !!pp.paramIsActive,
            })) ?? [];

          // 2) Flatten de la matriz (SI existe)
          const flatFromMatrix = flattenVariantQtyMatrix(
            item.variantQuantityMatrix,
            asNumber
          );

          // 3) “Enriquecer” flat con nombre/activo de variante si se puede
          const meta = new Map<number, { name: string; isActive: boolean }>();
          for (const vp of variantPrices) {
            meta.set(vp.variantId, {
              name: vp.variantName,
              isActive: vp.variantIsActive,
            });
          }

          for (const f of flatFromMatrix) {
            const m = meta.get(f.variantId);
            if (m) {
              f.variantName = m.name;
              f.variantIsActive = m.isActive;
            }
          }

          // 4) Si tu backend A VECES manda variantQuantityPrices plano, lo respetamos
          const flatFromArray =
            item.variantQuantityPrices?.map((vqp: any) => ({
              variantId: vqp.variantId,
              variantName: vqp.variantName ?? "",
              minQty: asNumber(vqp.minQty),
              unitPrice: asNumber(vqp.unitPrice),
              isActive: !!vqp.isActive,
              variantIsActive: !!vqp.variantIsActive,
            })) ?? [];

          // 5) Usa primero el que venga con datos:
          const finalVariantQuantityPrices =
            flatFromArray.length > 0 ? flatFromArray : flatFromMatrix;

          return {
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
            quantityPrices,
            variantPrices,
            paramPrices,
            variantQuantityMatrix: item.variantQuantityMatrix,
            variantQuantityPrices: finalVariantQuantityPrices,
          };
        });

        setCatalog(parsedCatalog);
      } catch (e: any) {
        setErr(e.message ?? "Error cargando catálogo");
      } finally {
        setLoadingCatalog(false);
      }
    })();
  }, [branchId]);

  const calculateUnitPrice = (item: OrderItem): number => {
    const row = catalog.find(p => p.productId === item.productId);
    if (!row) return 0;

    const quantity = asNumber(item.quantity, 0);
    const variantId = item.variantId ?? null;

    const half = asNumber(row.product.halfStepSpecialPrice, 0);
    const isHalfSpecial =
      row.product.unitType === "METER" &&
      nearlyEqual(quantity, 0.5) &&
      half > 0;

    if (isHalfSpecial) return half; // fijo

    // ---------- BASE PRICE (prioridad correcta) ----------
    let basePrice = asNumber(row.price, 0);

    // 1) matriz variante+cantidad
    if (variantId && row.variantQuantityPrices?.length) {
      const tier = row.variantQuantityPrices
        .filter(v => v.variantId === variantId && v.isActive && v.variantIsActive)
        .filter(v => quantity >= asNumber(v.minQty))
        .sort((a, b) => asNumber(b.minQty) - asNumber(a.minQty))[0];

      if (tier) basePrice = asNumber(tier.unitPrice, basePrice);
    }

    // 2) precio base por variante (solo si NO aplicó matriz)
    const usedMatrix = variantId
      ? row.variantQuantityPrices?.some(v =>
        v.variantId === variantId &&
        v.isActive && v.variantIsActive &&
        quantity >= asNumber(v.minQty)
      )
      : false;

    if (variantId && !usedMatrix && row.variantPrices?.length) {
      const vp = row.variantPrices.find(v => v.variantId === variantId && v.isActive && v.variantIsActive);
      if (vp) basePrice = asNumber(vp.price, basePrice);
    }

    // 3) tiers por cantidad SOLO si el producto NO requiere tamaño
    if (!row.product.needsVariant && row.quantityPrices?.length) {
      const tier = row.quantityPrices
        .filter(q => q.isActive)
        .filter(q => quantity >= asNumber(q.minQty))
        .sort((a, b) => asNumber(b.minQty) - asNumber(a.minQty))[0];

      if (tier) basePrice = asNumber(tier.unitPrice, basePrice);
    }

    // params (por unidad)
    let paramDelta = 0;
    if (item.selectedParams?.length && row.paramPrices?.length) {
      paramDelta = row.paramPrices
        .filter(pp => item.selectedParams.includes(pp.paramId) && pp.isActive && pp.paramIsActive)
        .reduce((sum, pp) => sum + asNumber(pp.priceDelta), 0);
    }

    return basePrice + paramDelta;
  };


  const calculateItemTotal = (item: OrderItem): number => {
    const row = catalog.find(p => p.productId === item.productId);
    if (!row) return 0;

    const quantity = asNumber(item.quantity, 0);
    const half = asNumber(row.product.halfStepSpecialPrice, 0);

    const isHalfSpecial =
      row.product.unitType === "METER" &&
      nearlyEqual(quantity, 0.5) &&
      half > 0;

    if (isHalfSpecial) {
      // ✅ precio fijo (no se multiplica)
      return half;
    }

    const unitPrice = calculateUnitPrice(item);
    return quantity * unitPrice;
  };

  useEffect(() => {
    if (catalog.length === 0) return;

    setItems(prev =>
      prev.map(item => {
        const unitPrice = calculateUnitPrice(item);
        const subtotal = calculateItemTotal(item);

        return {
          ...item,
          unitPrice,
          subtotal
        };
      })
    );
  }, [catalog]);

  const total = useMemo(() => {
    return items.reduce((sum, item) => sum + (item.subtotal || 0), 0);
  }, [items]);

  // === FUNCIONES ===
  async function lookupCustomer() {
    setCustomer(null);
    setCustomerErr(null);
    setMsg(null);

    const id = Number(customerNumber);
    if (!Number.isFinite(id) || id <= 0) {
      setCustomerErr("Número de cliente inválido");
      return;
    }

    try {
      setLookingUp(true);
      const c = await getCustomerById(id);
      setCustomer(c);
    } catch (e: any) {
      setCustomerErr(e.message ?? "Cliente no existe");
    } finally {
      setLookingUp(false);
    }
  }

  function addItem() {
    if (catalog.length === 0) return;

    const first = catalog[0];
    const newItem: OrderItem = {
      productId: first.productId,
      quantity: first.product.minQty || 1,
      variantId: null,
      selectedParams: [],
    };

    const unitPrice = calculateUnitPrice(newItem);
    const subtotal = calculateItemTotal(newItem);

    setItems((prev) => [...prev, { ...newItem, unitPrice, subtotal }]);
  }

  function updateItem(idx: number, patch: Partial<OrderItem>) {
    setItems((prev) => prev.map((it, i) => {
      if (i === idx) {
        const updatedItem = { ...it, ...patch };
        const unitPrice = calculateUnitPrice(updatedItem);
        const subtotal = calculateItemTotal(updatedItem);

        return {
          ...updatedItem,
          unitPrice,
          subtotal
        };
      }
      return it;
    }));
  }

  function toggleParam(itemIdx: number, paramId: number) {
    setItems((prev) => prev.map((item, idx) => {
      if (idx === itemIdx) {
        const selectedParams = item.selectedParams.includes(paramId)
          ? item.selectedParams.filter(id => id !== paramId)
          : [...item.selectedParams, paramId];

        const updatedItem = { ...item, selectedParams };
        const unitPrice = calculateUnitPrice(updatedItem);
        const subtotal = calculateItemTotal(updatedItem);

        return {
          ...updatedItem,
          unitPrice,
          subtotal
        };
      }
      return item;
    }));
  }

  function removeItem(idx: number) {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }

  function getAvailableVariants(productId: number) {
    const product = catalog.find(p => p.productId === productId);
    if (!product) {
      return [];
    }

    const variantMap = new Map<number, any>();

    if (product.variantPrices?.length) {
      product.variantPrices.forEach(vp => {
        if (vp.isActive && vp.variantIsActive) {
          variantMap.set(vp.variantId, {
            id: vp.variantId,
            name: vp.variantName,
            price: vp.price,
            source: 'base'
          });
        }
      });
    }

    if (product.variantQuantityPrices?.length) {
      product.variantQuantityPrices.forEach(vqp => {
        if (vqp.isActive && vqp.variantIsActive) {
          if (!variantMap.has(vqp.variantId)) {
            variantMap.set(vqp.variantId, {
              id: vqp.variantId,
              name: vqp.variantName,
              price: null,
              source: 'matrix'
            });
          }
        }
      });
    }

    const result = Array.from(variantMap.values()).sort((a, b) => a.name.localeCompare(b.name));
    return result;
  }

  function getAvailableQuantityPrices(item: OrderItem) {
    const product = catalog.find(p => p.productId === item.productId);
    if (!product) return [];

    if (item.variantId && product.variantQuantityPrices?.length) {
      return product.variantQuantityPrices
        .filter(vqp => vqp.variantId === item.variantId && vqp.isActive && vqp.variantIsActive)
        .map(vqp => ({
          minQty: vqp.minQty,
          unitPrice: vqp.unitPrice,
          label: `≥${vqp.minQty} = $${vqp.unitPrice.toFixed(2)}`
        }))
        .sort((a, b) => a.minQty - b.minQty);
    } else if (product.quantityPrices?.length) {
      return product.quantityPrices
        .filter(qp => qp.isActive)
        .map(qp => ({
          minQty: qp.minQty,
          unitPrice: qp.unitPrice,
          label: `≥${qp.minQty} = $${qp.unitPrice.toFixed(2)}`
        }))
        .sort((a, b) => a.minQty - b.minQty);
    }

    return [];
  }
  function validateQuantity(
    productId: number,
    quantity: number,
    variantId?: number | null
  ): string | null {
    const row = catalog.find((p) => p.productId === productId);
    if (!row) return "Producto no encontrado";

    // Convierte number | string | Decimal-like -> number
    const toNum = (v: any, fallback: number) => {
      if (typeof v === "number" && Number.isFinite(v)) return v;
      if (typeof v === "string") {
        const n = Number(v);
        return Number.isFinite(n) ? n : fallback;
      }
      // Prisma.Decimal u objetos con toString()
      if (v && typeof v === "object" && typeof v.toString === "function") {
        const n = Number(v.toString());
        return Number.isFinite(n) ? n : fallback;
      }
      return fallback;
    };

    const qty = toNum(quantity, NaN);
    if (!Number.isFinite(qty) || qty <= 0) return "Cantidad inválida";

    const unitType = row.product.unitType; // "METER" | "PIECE"
    const minQty = toNum(row.product.minQty, 1);
    const qtyStep = toNum(row.product.qtyStep, 1);

    const halfSpecial = toNum(row.product.halfStepSpecialPrice, 0);
    const eps = 1e-6;

    const isHalfSpecial =
      unitType === "METER" &&
      halfSpecial > 0 &&
      Math.abs(qty - 0.5) < eps;

    // ✅ 0.5 especial: se permite aunque minQty/step no cuadren
    if (isHalfSpecial) {
      if (row.product.needsVariant && !variantId) return "Debe seleccionar un tamaño";
      return null;
    }

    // ✅ PIECE: solo enteros
    if (unitType === "PIECE" && Math.abs(qty - Math.round(qty)) > eps) {
      return "Debe ser un número entero";
    }

    // Mínimo normal
    if (qty + eps < minQty) {
      return `Mínimo ${minQty} ${unitType.toLowerCase()}s`;
    }

    // Step normal (sin fallas por flotantes)
    if (qtyStep > 0) {
      const steps = (qty - minQty) / qtyStep;
      const nearest = Math.round(steps);
      if (Math.abs(steps - nearest) > 1e-3) {
        return `Debe ser múltiplo de ${qtyStep} a partir de ${minQty}`;
      }
    }

    if (row.product.needsVariant && !variantId) {
      return "Debe seleccionar un tamaño";
    }

    return null;
  }


  async function saveOrder() {
    if (!branchId) return;

    setErr(null);
    setMsg(null);

    if (!customer) {
      setErr("Primero busca un cliente por número");
      return;
    }

    const dateTimeError = validateDateTime(deliveryDate, deliveryTime);
    if (dateTimeError) {
      setErr(`Entrega inválida: ${dateTimeError}`);
      return;
    }

    if (!items.length) {
      setErr("Agrega al menos un producto");
      return;
    }

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const product = catalog.find(p => p.productId === item.productId);

      if (!product) {
        setErr(`Item ${i + 1}: Producto no encontrado`);
        return;
      }

      if (product.product.needsVariant && !item.variantId) {
        setErr(`Item ${i + 1}: "${product.product.name}" requiere seleccionar un tamaño`);
        return;
      }

      const error = validateQuantity(item.productId, item.quantity, item.variantId);
      if (error) {
        setErr(`Item ${i + 1}: ${error}`);
        return;
      }
    }

    try {
      setSaving(true);

      const isoDeliveryDate = new Date(
        `${deliveryDate}T${deliveryTime || "18:00"}:00`
      ).toISOString();

      const payload = {
        customerId: customer.id,
        pickupBranchId: pickupBranchId ?? branchId,
        branchId: branchId,
        shippingType: shippingType,
        paymentMethod: paymentMethod,
        deliveryDate: isoDeliveryDate,
        deliveryTime: deliveryTime || null,
        notes: notes || null,
        items: items.map((it) => ({
          productId: it.productId,
          quantity: it.quantity.toString(),
          variantId: it.variantId || null,
          paramIds: it.selectedParams || []
        })),
      };

      const r = await createOrder(payload as any);
      setMsg(`Pedido #${r.orderId} creado ✅ Total: $${Number(r.total).toFixed(2)}`);
      navigate('/orders');
      setItems([]);
      setNotes("");
      setCustomer(null);
      setCustomerNumber("");
    } catch (e: any) {
      setErr(e.message ?? "Error creando pedido");
    } finally {
      setSaving(false);
    }
  }

  const registerBranchName =
    branches.find((b) => b.id === branchId)?.name ?? (branchId ? `Sucursal #${branchId}` : "");

  const dateTimeError = validateDateTime(deliveryDate, deliveryTime);

  useEffect(() => {
    const handleClickOutside = () => {
      setShowTimeDropdown(false);
    };

    if (showTimeDropdown) {
      document.addEventListener('click', handleClickOutside);
      return () => {
        document.removeEventListener('click', handleClickOutside);
      };
    }
  }, [showTimeDropdown]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-4 md:p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <div className="p-3 bg-gradient-to-r from-blue-600 to-indigo-600 rounded-2xl shadow-lg">
                  <ShoppingCart className="w-6 h-6 text-white" />
                </div>
                <h1 className="text-3xl font-bold text-gray-900">Nuevo Pedido</h1>
              </div>
              <p className="text-gray-600 max-w-3xl">
                Crea un nuevo pedido para el cliente. Selecciona productos, configura opciones y confirma la orden.
              </p>
            </div>
            <button
              onClick={() => navigate('/  orders')}
              className="inline-flex items-center gap-2 px-5 py-3 bg-gradient-to-r from-gray-600 to-gray-700 hover:from-gray-700 hover:to-gray-800 text-white font-semibold rounded-xl transition-all duration-200 shadow-sm hover:shadow"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              Volver a Pedidos Activos
            </button>
          </div>
        </div>

        {/* Messages */}
        {err && (
          <div className="mb-6 animate-in fade-in slide-in-from-top-3 duration-300">
            <div className="bg-red-50 border border-red-200 rounded-2xl p-4">
              <div className="flex items-center gap-3">
                <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0" />
                <div className="flex-1">
                  <p className="font-medium text-red-700">Error</p>
                  <p className="text-red-600 text-sm mt-1">{err}</p>
                </div>
                <button
                  onClick={() => setErr(null)}
                  className="text-red-500 hover:text-red-700"
                >
                  ✕
                </button>
              </div>
            </div>
          </div>
        )}

        {msg && (
          <div className="mb-6 animate-in fade-in slide-in-from-top-3 duration-300">
            <div className="bg-green-50 border border-green-200 rounded-2xl p-4">
              <div className="flex items-center gap-3">
                <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0" />
                <div className="flex-1">
                  <p className="font-medium text-green-700">¡Éxito!</p>
                  <p className="text-green-600 text-sm mt-1">{msg}</p>
                </div>
                <button
                  onClick={() => setMsg(null)}
                  className="text-green-500 hover:text-green-700"
                >
                  ✕
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Main Content */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column - Información general */}
          <div className="lg:col-span-2 space-y-6">
            {/* Customer Section */}
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2 bg-gradient-to-r from-blue-100 to-cyan-100 rounded-lg">
                  <User className="w-5 h-5 text-blue-600" />
                </div>
                <h2 className="text-xl font-bold text-gray-900">Información del Cliente</h2>
              </div>

              <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center">
                <div className="flex-1">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Número de Cliente
                  </label>
                  <div className="relative">
                    <div className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400">
                      #
                    </div>
                    <input
                      value={customerNumber}
                      onChange={(e) => setCustomerNumber(e.target.value)}
                      placeholder="Ejemplo: 3"
                      className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200"
                    />
                  </div>
                </div>
                <button
                  onClick={lookupCustomer}
                  disabled={lookingUp}
                  className="inline-flex items-center gap-2 px-5 py-3 bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-700 hover:to-cyan-700 text-white font-semibold rounded-xl transition-all duration-200 shadow-sm hover:shadow"
                >
                  {lookingUp ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                      Buscando...
                    </>
                  ) : (
                    <>
                      <Search className="w-4 h-4" />
                      Buscar Cliente
                    </>
                  )}
                </button>
              </div>

              {customerErr && (
                <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-red-600 text-sm">{customerErr}</p>
                </div>
              )}

              {customer && (
                <div className="mt-4 p-4 bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200 rounded-xl">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-green-100 rounded-lg">
                      <CheckCircle className="w-5 h-5 text-green-600" />
                    </div>
                    <div>
                      <h3 className="font-bold text-gray-900">Cliente #{customer.id}</h3>
                      <p className="text-gray-700">{customer.name} — {customer.phone}</p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Products Section */}
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-gradient-to-r from-orange-100 to-amber-100 rounded-lg">
                    <Package className="w-5 h-5 text-orange-600" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-gray-900">Productos del Pedido</h2>
                    <p className="text-sm text-gray-500">Agrega y configura los productos</p>
                  </div>
                </div>
                <button
                  onClick={addItem}
                  disabled={!catalog.length || loadingCatalog}
                  className="inline-flex items-center gap-2 px-5 py-3 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white font-semibold rounded-xl transition-all duration-200 shadow-sm hover:shadow disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Plus className="w-4 h-4" />
                  Agregar Producto
                </button>
              </div>

              {loadingCatalog ? (
                <div className="text-center py-12">
                  <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
                  <p className="mt-4 text-gray-600">Cargando catálogo...</p>
                </div>
              ) : (
                <>
                  <div className="space-y-4">
                    {items.map((it, idx) => {
                      const product = catalog.find(p => p.productId === it.productId);
                      if (!product) {
                        return (
                          <div key={idx} className="p-4 bg-red-50 border border-red-200 rounded-xl">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-3">
                                <AlertCircle className="w-5 h-5 text-red-600" />
                                <div>
                                  <p className="font-medium text-red-700">Producto no encontrado</p>
                                  <p className="text-sm text-red-600">ID: {it.productId}</p>
                                </div>
                              </div>
                              <button
                                onClick={() => removeItem(idx)}
                                className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white font-medium rounded-lg transition-colors"
                              >
                                Eliminar
                              </button>
                            </div>
                          </div>
                        );
                      }

                      const unitPrice = calculateUnitPrice(it);
                      const itemTotal = calculateItemTotal(it);
                      const quantityError = validateQuantity(it.productId, it.quantity, it.variantId);
                      const availableVariants = getAvailableVariants(it.productId);
                      const availableQtyPrices = getAvailableQuantityPrices(it);
                      const halfSpecialEnabled =
                        product.product.unitType === "METER" &&
                        !!product.product.halfStepSpecialPrice &&
                        asNumber(product.product.halfStepSpecialPrice) > 0;
                      return (
                        <div
                          key={idx}
                          className="bg-gray-50 border border-gray-200 rounded-xl p-6 hover:border-gray-300 transition-colors"
                        >
                          <div className="flex flex-col lg:flex-row lg:items-start gap-6">
                            {/* Left Column - Product Info */}
                            <div className="flex-1 space-y-4">
                              {/* Product Selector */}
                              <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                  Producto
                                </label>
                                <select
                                  value={it.productId}
                                  onChange={(e) => updateItem(idx, {
                                    productId: Number(e.target.value),
                                    variantId: null,
                                    selectedParams: []
                                  })}
                                  className="w-full px-4 py-3 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200"
                                >
                                  {catalog.map((r) => (
                                    <option key={r.productId} value={r.productId}>
                                      {r.product.name} — ${asNumber(r.price).toFixed(2)} / {r.product.unitType.toLowerCase()}
                                      {r.product.needsVariant && " (con tamaños)"}
                                    </option>
                                  ))}
                                </select>
                              </div>

                              {/* Quantity Input */}
                              <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                  Cantidad
                                </label>
                                <div className="flex items-center gap-3">
                                  <div className="relative">
                                    <input
                                      type="number"
                                      min={halfSpecialEnabled ? 0.5 : asNumber(product.product.minQty, 1)}
                                      step={halfSpecialEnabled ? "any" : asNumber(product.product.qtyStep, 1)}
                                      value={it.quantity}
                                      onChange={(e) => updateItem(idx, { quantity: Number(e.target.value) })}
                                      className={`
    pl-4 pr-12 py-3 border rounded-lg transition-all duration-200
    ${quantityError
                                          ? "border-red-300 focus:ring-2 focus:ring-red-500 focus:border-red-500"
                                          : "border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                        }
  `}
                                    />
                                    <span className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-500 font-medium">
                                      {product.product.unitType.toLowerCase()}s
                                    </span>
                                  </div>
                                </div>

                                {quantityError && (
                                  <p className="mt-2 text-sm text-red-600">{quantityError}</p>
                                )}

                                {/* Price Tiers */}
                                {availableQtyPrices.length > 0 && (
                                  <div className="mt-3 p-3 bg-blue-50 rounded-lg">
                                    <p className="text-xs text-blue-700 font-medium mb-1">Precios por cantidad:</p>
                                    <div className="flex flex-wrap gap-2">
                                      {availableQtyPrices.map((qp, i) => (
                                        <span
                                          key={qp.minQty}
                                          className="px-2 py-1 bg-white text-blue-700 text-xs font-medium rounded border border-blue-200"
                                        >
                                          {qp.label}
                                        </span>
                                      ))}
                                    </div>
                                  </div>
                                )}

                                {/* Special Price 0.5m */}
                                {product.product.unitType === "METER" && product.product.halfStepSpecialPrice && (
                                  <div className="mt-2 flex items-center gap-2 text-sm text-green-600">
                                    <div className="w-1.5 h-1.5 rounded-full bg-green-600"></div>
                                    Precio especial 0.5m: ${asNumber(product.product.halfStepSpecialPrice).toFixed(2)} (fijo)
                                  </div>
                                )}
                              </div>

                              {/* Variants */}
                              {(product.product.needsVariant || availableVariants.length > 0) && (
                                <div>
                                  <label className="block text-sm font-medium text-gray-700 mb-2">
                                    Tamaño {product.product.needsVariant && (
                                      <span className="text-red-600">* requerido</span>
                                    )}
                                  </label>
                                  <div className="flex flex-wrap gap-2">
                                    {availableVariants.map((variant) => (
                                      <button
                                        key={variant.id}
                                        onClick={() => updateItem(idx, { variantId: variant.id })}
                                        className={`
                                          px-4 py-2 rounded-lg border transition-all duration-200
                                          ${it.variantId === variant.id
                                            ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                                            : 'bg-white text-gray-700 border-gray-300 hover:border-blue-400 hover:bg-blue-50'
                                          }
                                        `}
                                      >
                                        <div className="flex items-center gap-2">
                                          <span>{variant.name}</span>
                                          {variant.price !== null && variant.price > 0 && (
                                            <span className="text-xs font-medium">
                                              (+${variant.price.toFixed(2)})
                                            </span>
                                          )}
                                          {variant.source === 'matrix' && (
                                            <span className="text-xs opacity-75">(varía)</span>
                                          )}
                                        </div>
                                      </button>
                                    ))}

                                    {!product.product.needsVariant && (
                                      <button
                                        onClick={() => updateItem(idx, { variantId: null })}
                                        className={`
                                          px-4 py-2 rounded-lg border transition-all duration-200
                                          ${it.variantId === null
                                            ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                                            : 'bg-white text-gray-700 border-gray-300 hover:border-blue-400 hover:bg-blue-50'
                                          }
                                        `}
                                      >
                                        Sin tamaño
                                      </button>
                                    )}
                                  </div>
                                </div>
                              )}

                              {/* Parameters */}
                              {product.paramPrices && product.paramPrices.length > 0 && (
                                <div>
                                  <label className="block text-sm font-medium text-gray-700 mb-2">
                                    Parámetros adicionales
                                  </label>
                                  <div className="flex flex-wrap gap-2">
                                    {product.paramPrices
                                      .filter(p => p.paramIsActive)
                                      .map((param) => {
                                        const isSelected = it.selectedParams.includes(param.paramId);
                                        const priceDelta = param.priceDelta;

                                        return (
                                          <button
                                            key={param.paramId}
                                            onClick={() => toggleParam(idx, param.paramId)}
                                            className={`
                                              px-3 py-1.5 rounded-lg border transition-all duration-200 flex items-center gap-2
                                              ${isSelected
                                                ? priceDelta >= 0
                                                  ? 'bg-green-100 text-green-800 border-green-300'
                                                  : 'bg-red-100 text-red-800 border-red-300'
                                                : 'bg-white text-gray-700 border-gray-300 hover:border-gray-400'
                                              }
                                            `}
                                          >
                                            {param.paramName}
                                            {priceDelta !== 0 && (
                                              <span className={`text-xs font-medium ${priceDelta > 0 ? 'text-green-700' : 'text-red-700'
                                                }`}>
                                                ({priceDelta > 0 ? '+' : ''}${priceDelta.toFixed(2)})
                                              </span>
                                            )}
                                          </button>
                                        );
                                      })}
                                  </div>
                                </div>
                              )}
                            </div>

                            {/* Right Column - Price Info & Actions */}
                            <div className="lg:w-48 space-y-4">
                              {/* Price Display */}
                              <div className="bg-white p-4 rounded-lg border border-gray-200">
                                <div className="text-center mb-3">
                                  <p className="text-xs text-gray-500 mb-1">Precio unitario</p>
                                  <p className="text-xl font-bold text-gray-900">
                                    ${asNumber(unitPrice).toFixed(2)}
                                  </p>
                                </div>
                                <div className="text-center pt-3 border-t border-gray-100">
                                  <p className="text-xs text-gray-500 mb-1">Total item</p>
                                  <p className="text-2xl font-bold text-green-600">
                                    ${asNumber(itemTotal).toFixed(2)}
                                  </p>
                                </div>
                              </div>

                              {/* Remove Button */}
                              <button
                                onClick={() => removeItem(idx)}
                                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white font-medium rounded-lg transition-colors"
                              >
                                <Trash2 className="w-4 h-4" />
                                Eliminar Producto
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {items.length === 0 && (
                    <div className="text-center py-12">
                      <div className="inline-flex items-center justify-center w-16 h-16 bg-gray-100 rounded-2xl mb-4">
                        <Package className="w-8 h-8 text-gray-400" />
                      </div>
                      <h3 className="text-lg font-medium text-gray-700 mb-2">No hay productos agregados</h3>
                      <p className="text-gray-500 mb-4">Agrega productos usando el botón superior</p>
                    </div>
                  )}
                </>
              )}
            </div>
            {/* Delivery & Pickup Section */}
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2 bg-gradient-to-r from-purple-100 to-indigo-100 rounded-lg">
                  <Truck className="w-5 h-5 text-purple-600" />
                </div>
                <h2 className="text-xl font-bold text-gray-900">Entrega y Recolección</h2>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Branches */}
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <Building className="w-4 h-4 text-gray-500" />
                    <label className="block text-sm font-medium text-gray-700">Sucursales</label>
                  </div>
                  <div className="space-y-3">
                    <div className="p-3 bg-gray-50 rounded-lg">
                      <p className="text-xs text-gray-500">Registrado por:</p>
                      <p className="font-semibold text-gray-900">{registerBranchName}</p>
                      <p className="text-xs text-gray-400">(tu sucursal)</p>
                    </div>

                    <div>
                      <p className="text-sm text-gray-700 mb-2">Se recoge en:</p>
                      <select
                        value={pickupBranchId ?? ""}
                        onChange={(e) => setPickupBranchId(Number(e.target.value))}
                        className="w-full px-4 py-3 bg-gray-50 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200"
                      >
                        {branches.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>

                {/* Date & Time */}
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <Calendar className="w-4 h-4 text-gray-500" />
                    <label className="block text-sm font-medium text-gray-700">Fecha y Hora</label>
                  </div>
                  <div className="space-y-3">
                    <div>
                      <input
                        type="date"
                        value={deliveryDate}
                        onChange={(e) => setDeliveryDate(e.target.value)}
                        className={`
                          w-full px-4 py-3 border rounded-lg transition-all duration-200
                          ${dateTimeError
                            ? 'border-red-300 focus:ring-2 focus:ring-red-500 focus:border-red-500'
                            : 'border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500'
                          }
                        `}
                      />
                    </div>

                    <div className="relative">
                      <div
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowTimeDropdown(!showTimeDropdown);
                        }}
                        className={`
                          w-full px-4 py-3 border rounded-lg cursor-pointer transition-all duration-200
                          flex items-center justify-between
                          ${dateTimeError
                            ? 'border-red-300 bg-red-50'
                            : 'border-gray-300 bg-gray-50 hover:bg-white'
                          }
                        `}
                      >
                        <span className={dateTimeError ? 'text-red-700' : 'text-gray-700'}>
                          {getDisplayTime(deliveryTime)}
                        </span>
                        <ChevronDown className={`w-4 h-4 transition-transform ${showTimeDropdown ? 'rotate-180' : ''}`} />
                      </div>

                      {showTimeDropdown && (
                        <div
                          className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-y-auto"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {timeOptions.map((option) => (
                            <div
                              key={option.value}
                              onClick={() => {
                                setDeliveryTime(option.value);
                                setShowTimeDropdown(false);
                              }}
                              className={`
                                px-4 py-3 cursor-pointer transition-colors flex justify-between items-center
                                ${deliveryTime === option.value
                                  ? 'bg-blue-50 text-blue-700'
                                  : 'hover:bg-gray-50 text-gray-700'
                                }
                              `}
                            >
                              <span>{option.label}</span>
                              <span className="text-xs text-gray-500">{option.value}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {dateTimeError && (
                        <p className="mt-1 text-xs text-red-600">{dateTimeError}</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Shipping & Payment */}
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Shipping Method */}
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <Truck className="w-4 h-4 text-gray-500" />
                    <label className="block text-sm font-medium text-gray-700">Método de Envío</label>
                  </div>
                  <div className="space-y-2">
                    <label className="flex items-center gap-3 p-3 border border-gray-300 rounded-lg cursor-pointer hover:border-blue-400 transition-colors">
                      <input
                        type="radio"
                        checked={shippingType === "PICKUP"}
                        onChange={() => setShippingType("PICKUP")}
                        className="w-4 h-4 text-blue-600 border-gray-300"
                      />
                      <div>
                        <span className="font-medium">Recoge en sucursal</span>
                        <p className="text-xs text-gray-500 mt-1">El cliente pasa por el pedido</p>
                      </div>
                    </label>

                    <label className="flex items-center gap-3 p-3 border border-gray-300 rounded-lg cursor-pointer hover:border-blue-400 transition-colors">
                      <input
                        type="radio"
                        checked={shippingType === "DELIVERY"}
                        onChange={() => setShippingType("DELIVERY")}
                        className="w-4 h-4 text-blue-600 border-gray-300"
                      />
                      <div>
                        <span className="font-medium">Delivery</span>
                        <p className="text-xs text-gray-500 mt-1">Envío a domicilio</p>
                      </div>
                    </label>
                  </div>
                </div>

                {/* Payment Method */}
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <CreditCard className="w-4 h-4 text-gray-500" />
                    <label className="block text-sm font-medium text-gray-700">Método de Pago</label>
                  </div>
                  <div className="space-y-2">
                    <label className="flex items-center gap-3 p-3 border border-gray-300 rounded-lg cursor-pointer hover:border-blue-400 transition-colors">
                      <input
                        type="radio"
                        checked={paymentMethod === "CASH"}
                        onChange={() => setPaymentMethod("CASH")}
                        className="w-4 h-4 text-blue-600 border-gray-300"
                      />
                      <span className="font-medium">Efectivo</span>
                    </label>

                    <label className="flex items-center gap-3 p-3 border border-gray-300 rounded-lg cursor-pointer hover:border-blue-400 transition-colors">
                      <input
                        type="radio"
                        checked={paymentMethod === "TRANSFER"}
                        onChange={() => setPaymentMethod("TRANSFER")}
                        className="w-4 h-4 text-blue-600 border-gray-300"
                      />
                      <span className="font-medium">Transferencia</span>
                    </label>

                    <label className="flex items-center gap-3 p-3 border border-gray-300 rounded-lg cursor-pointer hover:border-blue-400 transition-colors">
                      <input
                        type="radio"
                        checked={paymentMethod === "CARD"}
                        onChange={() => setPaymentMethod("CARD")}
                        className="w-4 h-4 text-blue-600 border-gray-300"
                      />
                      <span className="font-medium">Tarjeta</span>
                    </label>
                  </div>
                </div>
              </div>
            </div>

          </div>

          {/* Right Column - Summary & Actions */}
          <div className="space-y-6">
            {/* Notes Section */}
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2 bg-gradient-to-r from-gray-100 to-gray-200 rounded-lg">
                  <Info className="w-5 h-5 text-gray-600" />
                </div>
                <h2 className="text-xl font-bold text-gray-900">Notas Adicionales</h2>
              </div>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Instrucciones especiales, detalles del pedido, etc."
                className="w-full h-32 px-4 py-3 bg-gray-50 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200 resize-none"
              />
            </div>

            {/* Order Summary */}
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 sticky top-6">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2 bg-gradient-to-r from-green-100 to-emerald-100 rounded-lg">
                  <Receipt className="w-5 h-5 text-green-600" />
                </div>
                <h2 className="text-xl font-bold text-gray-900">Resumen del Pedido</h2>
              </div>

              {/* Items Count */}
              <div className="mb-6 p-4 bg-gray-50 rounded-lg">
                <div className="flex justify-between items-center">
                  <span className="text-gray-700">Productos</span>
                  <span className="font-bold text-gray-900">{items.length}</span>
                </div>
                <div className="mt-2 flex justify-between items-center">
                  <span className="text-gray-700">Precio estimado</span>
                  <span className="text-2xl font-bold text-green-600">${total.toFixed(2)}</span>
                </div>
              </div>

              {/* Validation Messages */}
              {(!customer || items.length === 0 || dateTimeError) && (
                <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                  <div className="flex items-start gap-3">
                    <Shield className="w-5 h-5 text-yellow-600 mt-0.5" />
                    <div className="space-y-2">
                      <p className="text-sm font-medium text-yellow-800">Para continuar:</p>
                      <ul className="text-sm text-yellow-700 space-y-1">
                        {!customer && <li>• Buscar un cliente válido</li>}
                        {items.length === 0 && <li>• Agregar al menos un producto</li>}
                        {dateTimeError && <li>• Corregir fecha/hora de entrega</li>}
                      </ul>
                    </div>
                  </div>
                </div>
              )}

              {/* Create Order Button */}
              <button
                onClick={saveOrder}
                disabled={saving || !customer || items.length === 0 || !!dateTimeError}
                className={`
                  w-full py-4 px-6 rounded-xl font-semibold text-lg transition-all duration-300
                  flex items-center justify-center gap-3
                  ${saving || !customer || items.length === 0 || dateTimeError
                    ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                    : 'bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white shadow-lg hover:shadow-xl transform hover:-translate-y-0.5'
                  }
                `}
              >
                {saving ? (
                  <>
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                    Creando Pedido...
                  </>
                ) : (
                  <>
                    <Save className="w-5 h-5" />
                    Crear Pedido
                  </>
                )}
              </button>

              {/* Order Details */}
              <div className="mt-6 pt-6 border-t border-gray-200 space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Fecha entrega:</span>
                  <span className="font-medium text-gray-900">{deliveryDate}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Hora entrega:</span>
                  <span className="font-medium text-gray-900">{getDisplayTime(deliveryTime)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Envío:</span>
                  <span className="font-medium text-gray-900">
                    {shippingType === "PICKUP" ? "Recoge" : "Delivery"}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Pago:</span>
                  <span className="font-medium text-gray-900">
                    {paymentMethod === "CASH" ? "Efectivo" :
                      paymentMethod === "TRANSFER" ? "Transferencia" : "Tarjeta"}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}