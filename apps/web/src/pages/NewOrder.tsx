import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../auth/useAuth";
import { getBranches, getBranchProducts } from "../api/pricing";
import { getCustomerById, searchCustomers } from "../api/customers";
import { createOrder } from "../api/orders";
import { uploadOrderFile } from "../api/orderFiles";
import {
  previewProductionSchedule,
  type ProductionSchedulePreviewResponse,
} from "../api/productionScheduling";
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
  Receipt,
  Layers,
  TrendingUp,
  Paperclip,
  Upload,
  X
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  businessDateDiffInDays,
  businessDayOfWeek,
  dateKeyFromBusinessInstant,
  isValidDateKey,
  isValidTimeKey,
  timeKeyFromBusinessInstant,
  todayBusinessDateKey,
  todayBusinessTimeKey,
} from "../lib/businessTime";

type Branch = { id: number; name: string; isActive: boolean };

type ParamChargeType = "PER_METER" | "PER_PIECE";

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
  variantQuantityMatrix?: Record<number, Array<{
    id?: number | null;
    minQty: string | number;
    unitPrice: string | number;
    isActive: boolean;
  }>>;
};

type SelectedParam = {
  paramId: number;
  chargeType: ParamChargeType;
  pieceQty?: number;
};

type PaymentSplit = {
  method: "CASH" | "TRANSFER" | "CARD";
  amount: number;
  reference?: string;
};

const PAYMENT_METHODS: PaymentSplit["method"][] = ["CASH", "TRANSFER", "CARD"];

type OrderItem = {
  productId: number;
  quantity: number;
  variantId?: number | null;
  selectedParams: SelectedParam[];
  unitPrice?: number;
  subtotal?: number;
  usedVolumePricing?: boolean;
  volumeThreshold?: number;
  isCustomProduct?: boolean;
  customProductName?: string;
  customUnitType?: "METER" | "PIECE";
  customUnitPrice?: number;
};

const VOLUME_PRODUCT_IDS = [2, 6];
const VOLUME_THRESHOLDS = [12, 100];
const MAX_ORDER_FILES = 10;
const ORDER_FILE_ACCEPT = ".png,.jpg,.jpeg,.pdf,.tif,.tiff,.zip,.rar,.psd,.ai,.cdr";

function formatFileSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function deliveryInputsFromDateTime(value?: string | null) {
  if (!value) return null;
  const date = dateKeyFromBusinessInstant(value);
  const time = timeKeyFromBusinessInstant(value);
  if (!date || !time) return null;

  return {
    date,
    time,
  };
}

function formatDeliveryDateTime(deliveryDate: string, deliveryTime: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(deliveryDate);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(deliveryTime);
  if (!match || !timeMatch) return `${deliveryDate} ${deliveryTime}`.trim();

  return `${match[3]}/${match[2]}/${match[1]} ${timeMatch[1]}:${timeMatch[2]}`;
}

function daysAheadFromToday(value?: string | null) {
  if (!value) return null;
  const dateKey = dateKeyFromBusinessInstant(value);
  return businessDateDiffInDays(todayBusinessDateKey(), dateKey);
}

export default function NewOrder() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";

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
  const [orderFiles, setOrderFiles] = useState<File[]>([]);
  const [schedulePreview, setSchedulePreview] = useState<ProductionSchedulePreviewResponse | null>(null);
  const [schedulePreviewLoading, setSchedulePreviewLoading] = useState(false);
  const [schedulePreviewError, setSchedulePreviewError] = useState<string | null>(null);

  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [deliveryDate, setDeliveryDate] = useState(() => todayBusinessDateKey());
  const [deliveryTime, setDeliveryTime] = useState("18:00");
  const [deliveryManuallyEdited, setDeliveryManuallyEdited] = useState(false);
  const [showTimeDropdown, setShowTimeDropdown] = useState(false);
  const [shippingType, setShippingType] = useState<"PICKUP" | "DELIVERY">("PICKUP");
  const [payments, setPayments] = useState<PaymentSplit[]>([{ method: "TRANSFER", amount: 0 }]);
  const [hasIva, setHasIva] = useState(false);
  const [notes, setNotes] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Array<{ id: number; name: string; phone: string }>>([]);
  const [showResults, setShowResults] = useState(false);
  const [searching, setSearching] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const schedulePreviewRequestRef = useRef(0);

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
          variantName: "",
          minQty: asNumber(r?.minQty, 0),
          unitPrice: asNumber(r?.unitPrice, 0),
          isActive: !!r?.isActive,
          variantIsActive: true,
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
    if (v && typeof v === "object" && typeof (v as any).toString === "function") {
      const n = Number((v as any).toString());
      return Number.isFinite(n) ? n : fallback;
    }
    return fallback;
  }

  const totalVolumeQuantity = useMemo(() => {
    return items
      .filter(item => VOLUME_PRODUCT_IDS.includes(item.productId))
      .reduce((sum, item) => sum + item.quantity, 0);
  }, [items]);

  const activeVolumeThreshold = useMemo(() => {
    const sortedThresholds = [...VOLUME_THRESHOLDS].sort((a, b) => b - a);
    for (const threshold of sortedThresholds) {
      if (totalVolumeQuantity >= threshold) return threshold;
    }
    return null;
  }, [totalVolumeQuantity]);

  const getVolumePriceForItem = (item: OrderItem): { price: number; threshold: number } | null => {
    if (!activeVolumeThreshold) return null;

    const product = catalog.find(p => p.productId === item.productId);
    if (!product) return null;

    if (item.variantId && product.variantQuantityPrices?.length) {
      const volumePrice = product.variantQuantityPrices.find(
        vqp =>
          vqp.variantId === item.variantId &&
          vqp.minQty === activeVolumeThreshold &&
          vqp.isActive &&
          vqp.variantIsActive
      );
      if (volumePrice) {
        return { price: volumePrice.unitPrice, threshold: activeVolumeThreshold };
      }
    } else if (product.quantityPrices?.length) {
      const volumePrice = product.quantityPrices.find(
        qp => qp.minQty === activeVolumeThreshold && qp.isActive
      );
      if (volumePrice) {
        return { price: volumePrice.unitPrice, threshold: activeVolumeThreshold };
      }
    }

    return null;
  };

  const timeOptions = useMemo(() => {
    const options = [];
    for (let hour = 8; hour <= 20; hour++) {
      for (let minute = 0; minute < 60; minute += 30) {
        const hh = hour.toString().padStart(2, "0");
        const mm = minute.toString().padStart(2, "0");
        const time24 = `${hh}:${mm}`;

        let hour12 = hour === 12 ? 12 : hour % 12;
        if (hour12 === 0) hour12 = 12;
        const ampm = hour >= 12 ? "p.m." : "a.m.";
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

    const [hours, minutes] = time24.split(":").map(Number);
    if (isNaN(hours) || isNaN(minutes)) return time24;

    let hour12 = hours === 12 ? 12 : hours % 12;
    if (hour12 === 0) hour12 = 12;
    const ampm = hours >= 12 ? "p.m." : "a.m.";
    return `${hour12}:${minutes.toString().padStart(2, "0")} ${ampm}`;
  };

  function validateDateTime(dateString: string, timeString: string): string | null {
    if (!dateString) return "La fecha es requerida";
    if (!timeString) return "La hora es requerida";
    if (!isValidDateKey(dateString)) return "La fecha es inválida";
    if (!isValidTimeKey(timeString)) return "La hora es inválida";

    if (businessDayOfWeek(dateString) === 0) return "Los domingos no hay servicio";

    const todayKey = todayBusinessDateKey();
    const nowTimeKey = todayBusinessTimeKey();
    if (dateString < todayKey || (dateString === todayKey && timeString < nowTimeKey)) {
      return "La fecha/hora seleccionada ya pasó";
    }

    return null;
  }

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
    const handleClickOutside = (event: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setShowResults(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

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
              chargeType: (pp.chargeType === "PER_PIECE" ? "PER_PIECE" : "PER_METER") as ParamChargeType,
            })) ?? [];

          const flatFromMatrix = flattenVariantQtyMatrix(
            item.variantQuantityMatrix,
            asNumber
          );

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

          const flatFromArray =
            item.variantQuantityPrices?.map((vqp: any) => ({
              variantId: vqp.variantId,
              variantName: vqp.variantName ?? "",
              minQty: asNumber(vqp.minQty),
              unitPrice: asNumber(vqp.unitPrice),
              isActive: !!vqp.isActive,
              variantIsActive: !!vqp.variantIsActive,
            })) ?? [];

          const finalVariantQuantityPrices =
            flatFromArray.length > 0 ? flatFromArray : flatFromMatrix;

          return {
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

  const performSearch = async (query: string) => {
    if (!query.trim()) {
      setSearchResults([]);
      setShowResults(false);
      return;
    }

    setSearching(true);
    try {
      const results = await searchCustomers(query);
      setSearchResults(results);
      setShowResults(results.length > 0);
    } catch (error) {
      console.error("Error searching customers:", error);
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  };

  const handleSearchInput = (value: string) => {
    setSearchQuery(value);

    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    searchTimeoutRef.current = setTimeout(() => {
      performSearch(value);
    }, 300);
  };

  const selectCustomer = (customer: { id: number; name: string; phone: string }) => {
    setCustomer(customer);
    setSearchQuery(customer.name);
    setShowResults(false);
    setCustomerErr(null);
  };

  function getProductRow(productId: number) {
    return catalog.find(p => p.productId === productId);
  }

  function getParamMeta(productId: number, paramId: number) {
    const row = getProductRow(productId);
    if (!row?.paramPrices?.length) return null;

    return row.paramPrices.find(
      pp => pp.paramId === paramId && pp.isActive && pp.paramIsActive
    ) ?? null;
  }

  function getSelectedParam(item: OrderItem, paramId: number) {
    return item.selectedParams.find(p => p.paramId === paramId) ?? null;
  }

  function getMeterParamsDelta(item: OrderItem): number {
    const row = getProductRow(item.productId);
    if (!row?.paramPrices?.length) return 0;

    return item.selectedParams.reduce((sum, selected) => {
      const meta = row.paramPrices!.find(
        pp =>
          pp.paramId === selected.paramId &&
          pp.isActive &&
          pp.paramIsActive &&
          (pp.chargeType ?? "PER_METER") === "PER_METER"
      );
      if (!meta) return sum;
      return sum + asNumber(meta.priceDelta, 0);
    }, 0);
  }

  function getPieceParamsTotal(item: OrderItem): number {
    const row = getProductRow(item.productId);
    if (!row?.paramPrices?.length) return 0;

    return item.selectedParams.reduce((sum, selected) => {
      const meta = row.paramPrices!.find(
        pp =>
          pp.paramId === selected.paramId &&
          pp.isActive &&
          pp.paramIsActive &&
          (pp.chargeType ?? "PER_METER") === "PER_PIECE"
      );
      if (!meta) return sum;

      const qty = Math.max(0, asNumber(selected.pieceQty, 0));
      return sum + qty * asNumber(meta.priceDelta, 0);
    }, 0);
  }

  const calculateUnitPrice = (item: OrderItem): number => {
    const row = catalog.find(p => p.productId === item.productId);
    if (!row) return 0;

    const quantity = asNumber(item.quantity, 0);
    const variantId = item.variantId ?? null;

    const half = asNumber(row.halfStepSpecialPrice, 0);
    const isHalfSpecial =
      row.product.unitType === "METER" &&
      nearlyEqual(quantity, 0.5) &&
      half > 0;

    if (isHalfSpecial) {
      return half + getMeterParamsDelta(item);
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
      if (variantId && row.variantQuantityPrices?.length) {
        const tier = row.variantQuantityPrices
          .filter(v => v.variantId === variantId && v.isActive && v.variantIsActive)
          .filter(v => quantity >= asNumber(v.minQty))
          .sort((a, b) => asNumber(b.minQty) - asNumber(a.minQty))[0];

        if (tier) basePrice = asNumber(tier.unitPrice, basePrice);
      }

      const usedMatrix = variantId
        ? row.variantQuantityPrices?.some(v =>
          v.variantId === variantId &&
          v.isActive &&
          v.variantIsActive &&
          quantity >= asNumber(v.minQty)
        )
        : false;

      if (variantId && !usedMatrix && row.variantPrices?.length) {
        const vp = row.variantPrices.find(v => v.variantId === variantId && v.isActive && v.variantIsActive);
        if (vp) basePrice = asNumber(vp.price, basePrice);
      }

      if (!row.product.needsVariant && row.quantityPrices?.length) {
        const tier = row.quantityPrices
          .filter(q => q.isActive)
          .filter(q => quantity >= asNumber(q.minQty))
          .sort((a, b) => asNumber(b.minQty) - asNumber(a.minQty))[0];

        if (tier) basePrice = asNumber(tier.unitPrice, basePrice);
      }
    }

    return basePrice + getMeterParamsDelta(item);
  };

  const calculateItemTotal = (item: OrderItem): number => {
    if (item.isCustomProduct) {
      const qty = asNumber(item.quantity, 0);
      const price = asNumber(item.customUnitPrice, 0);
      return qty * price;
    }

    const row = catalog.find(p => p.productId === item.productId);
    if (!row) return 0;

    const quantity = asNumber(item.quantity, 0);
    const half = asNumber(row.halfStepSpecialPrice, 0);

    const isHalfSpecial =
      row.product.unitType === "METER" &&
      nearlyEqual(quantity, 0.5) &&
      half > 0;

    const unitPrice = calculateUnitPrice(item);
    const baseTotal = isHalfSpecial ? unitPrice : quantity * unitPrice;
    const pieceParamsTotal = getPieceParamsTotal(item);

    return baseTotal + pieceParamsTotal;
  };

  useEffect(() => {
    if (catalog.length === 0) return;

    setItems(prev =>
      prev.map(item => {
        const unitPrice = calculateUnitPrice(item);
        const subtotal = calculateItemTotal(item);
        const volumePriceInfo = VOLUME_PRODUCT_IDS.includes(item.productId) ? getVolumePriceForItem(item) : null;

        return {
          ...item,
          unitPrice,
          subtotal,
          usedVolumePricing: !!volumePriceInfo,
          volumeThreshold: volumePriceInfo?.threshold
        };
      })
    );
  }, [catalog, activeVolumeThreshold]);

  const subtotalBeforeTax = useMemo(() => {
    return items.reduce((sum, item) => sum + (item.subtotal || 0), 0);
  }, [items]);

  const ivaAmount = useMemo(() => {
    return hasIva ? subtotalBeforeTax * 0.16 : 0;
  }, [hasIva, subtotalBeforeTax]);

  const total = useMemo(() => {
    return subtotalBeforeTax + ivaAmount;
  }, [subtotalBeforeTax, ivaAmount]);

  const paymentTotal = useMemo(
    () => payments.reduce((sum, p) => sum + (Number.isFinite(p.amount) ? p.amount : 0), 0),
    [payments]
  );

  const paymentDiff = useMemo(() => Number((total - paymentTotal).toFixed(2)), [total, paymentTotal]);

  const paymentsAreValid = useMemo(() => {
    if (payments.length === 0) return false;
    const allPositive = payments.every((p) => Number.isFinite(p.amount) && p.amount > 0);
    return allPositive && Math.abs(paymentDiff) <= 0.01;
  }, [payments, paymentDiff]);

  const canAddMorePayments = payments.length < 3;

  const schedulePreviewRequestPayload = useMemo(() => {
    const previewItems = items
      .filter((item) => !item.isCustomProduct && item.productId > 0)
      .map((item) => ({
        productId: item.productId,
        quantity: asNumber(item.quantity, 0),
      }))
      .filter((item) => Number.isFinite(item.quantity) && item.quantity > 0);

    return JSON.stringify(previewItems);
  }, [items]);

  const schedulePreviewDaysAhead = useMemo(
    () => daysAheadFromToday(schedulePreview?.estimatedReadyAt),
    [schedulePreview?.estimatedReadyAt]
  );

  const showScheduleWindowHint = schedulePreviewDaysAhead !== null && schedulePreviewDaysAhead >= 5;
  const hasAutomaticDelivery = !!schedulePreview?.estimatedReadyAt;
  const deliveryDateLocked = hasAutomaticDelivery && !isAdmin;

  function applyPreviewDelivery(estimatedReadyAt?: string | null) {
    const inputs = deliveryInputsFromDateTime(estimatedReadyAt);
    if (!inputs) return;
    setDeliveryDate(inputs.date);
    setDeliveryTime(inputs.time);
  }

  function handleDeliveryDateChange(value: string) {
    if (deliveryDateLocked) return;
    setDeliveryDate(value);
    setDeliveryManuallyEdited(true);
  }

  function handleDeliveryTimeChange(value: string) {
    if (deliveryDateLocked) return;
    setDeliveryTime(value);
    setDeliveryManuallyEdited(true);
  }

  function useAutomaticDeliveryDate() {
    applyPreviewDelivery(schedulePreview?.estimatedReadyAt);
    setDeliveryManuallyEdited(false);
  }

  function addPaymentRow() {
    setPayments((prev) => {
      if (prev.length >= 3) return prev;
      const used = new Set(prev.map((p) => p.method));
      const nextMethod = PAYMENT_METHODS.find((m) => !used.has(m));
      if (!nextMethod) return prev;
      return [...prev, { method: nextMethod, amount: 0 }];
    });
  }

  function changePaymentMethod(index: number, method: PaymentSplit["method"]) {
    setPayments((prev) => {
      const duplicate = prev.some((p, i) => i !== index && p.method === method);
      if (duplicate) return prev;
      return prev.map((p, i) => (i === index ? { ...p, method } : p));
    });
  }

  useEffect(() => {
    if (payments.length !== 1) return;
    setPayments((prev) => {
      if (prev.length !== 1) return prev;
      const nextAmount = Number(total.toFixed(2));
      if (Math.abs((prev[0].amount ?? 0) - nextAmount) <= 0.01) return prev;
      return [{ ...prev[0], amount: nextAmount }];
    });
  }, [payments.length, total]);

  useEffect(() => {
    const previewItems = JSON.parse(schedulePreviewRequestPayload) as Array<{
      productId: number;
      quantity: number;
    }>;

    schedulePreviewRequestRef.current += 1;
    const requestId = schedulePreviewRequestRef.current;

    if (!branchId || previewItems.length === 0) {
      setSchedulePreview(null);
      setSchedulePreviewLoading(false);
      setSchedulePreviewError(null);
      return;
    }

    setSchedulePreviewLoading(true);
    setSchedulePreviewError(null);

    const timeout = setTimeout(() => {
      previewProductionSchedule(branchId, previewItems)
        .then((result) => {
          if (schedulePreviewRequestRef.current !== requestId) return;
          setSchedulePreview(result);
          if (result.estimatedReadyAt && (!deliveryManuallyEdited || !isAdmin)) {
            applyPreviewDelivery(result.estimatedReadyAt);
            if (!isAdmin) setDeliveryManuallyEdited(false);
          }
        })
        .catch((error: any) => {
          if (schedulePreviewRequestRef.current !== requestId) return;
          setSchedulePreview(null);
          setSchedulePreviewError(error?.message ?? "No se pudo calcular la entrega estimada");
        })
        .finally(() => {
          if (schedulePreviewRequestRef.current !== requestId) return;
          setSchedulePreviewLoading(false);
        });
    }, 500);

    return () => clearTimeout(timeout);
  }, [branchId, schedulePreviewRequestPayload, deliveryManuallyEdited, isAdmin]);

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

    setItems(prev => [...prev, { ...newItem, unitPrice, subtotal }]);
  }

  function addCustomItem() {
    const newItem: OrderItem = {
      productId: -1,
      quantity: 1,
      variantId: null,
      selectedParams: [],
      isCustomProduct: true,
      customProductName: "",
      customUnitType: "PIECE",
      customUnitPrice: 0,
    };

    setItems(prev => [...prev, { ...newItem, unitPrice: 0, subtotal: 0 }]);
  }

  function normalizeSelectedParamsForProduct(productId: number, selectedParams: SelectedParam[]) {
    const row = getProductRow(productId);
    if (!row?.paramPrices?.length) return [];

    const validParamIds = new Set(
      row.paramPrices
        .filter(pp => pp.isActive && pp.paramIsActive)
        .map(pp => pp.paramId)
    );

    return selectedParams.filter(sp => validParamIds.has(sp.paramId));
  }

function updateItem(idx: number, patch: Partial<OrderItem>) {
    setItems(prev =>
      prev.map((it, i) => {
        if (i !== idx) return it;

        const updatedItem: OrderItem = {
          ...it,
          ...patch,
        };

        if (it.isCustomProduct && patch.isCustomProduct !== false) {
          const unitPrice = asNumber(patch.customUnitPrice ?? it.customUnitPrice, 0);
          const subtotal = asNumber(patch.quantity ?? it.quantity, 0) * unitPrice;
          return {
            ...updatedItem,
            unitPrice,
            subtotal,
            usedVolumePricing: false,
          };
        }

        if (patch.productId && patch.productId !== it.productId) {
          const newRow = getProductRow(patch.productId);
          updatedItem.variantId = null;
          updatedItem.selectedParams = [];
          updatedItem.quantity = newRow?.product.minQty || 1;
        } else {
          updatedItem.selectedParams = normalizeSelectedParamsForProduct(
            updatedItem.productId,
            updatedItem.selectedParams
          );
        }

        const unitPrice = calculateUnitPrice(updatedItem);
        const subtotal = calculateItemTotal(updatedItem);
        const volumePriceInfo = VOLUME_PRODUCT_IDS.includes(updatedItem.productId)
          ? getVolumePriceForItem(updatedItem)
          : null;

        return {
          ...updatedItem,
          unitPrice,
          subtotal,
          usedVolumePricing: !!volumePriceInfo,
          volumeThreshold: volumePriceInfo?.threshold
        };
      })
    );
  }

  function toggleParam(itemIdx: number, paramId: number) {
    setItems(prev =>
      prev.map((item, idx) => {
        if (idx !== itemIdx) return item;

        const meta = getParamMeta(item.productId, paramId);
        if (!meta) return item;

        const existing = item.selectedParams.find(p => p.paramId === paramId);

        const selectedParams = existing
          ? item.selectedParams.filter(p => p.paramId !== paramId)
          : [
            ...item.selectedParams,
            {
              paramId,
              chargeType: meta.chargeType ?? "PER_METER",
              pieceQty: (meta.chargeType ?? "PER_METER") === "PER_PIECE" ? 1 : undefined,
            },
          ];

        const updatedItem = { ...item, selectedParams };
        const unitPrice = calculateUnitPrice(updatedItem);
        const subtotal = calculateItemTotal(updatedItem);

        return {
          ...updatedItem,
          unitPrice,
          subtotal,
        };
      })
    );
  }

  function updateParamPieceQty(itemIdx: number, paramId: number, pieceQty: number) {
    setItems(prev =>
      prev.map((item, idx) => {
        if (idx !== itemIdx) return item;

        const selectedParams = item.selectedParams.map(p =>
          p.paramId === paramId
            ? { ...p, pieceQty: Math.max(1, Math.floor(asNumber(pieceQty, 1))) }
            : p
        );

        const updatedItem = { ...item, selectedParams };
        const unitPrice = calculateUnitPrice(updatedItem);
        const subtotal = calculateItemTotal(updatedItem);

        return {
          ...updatedItem,
          unitPrice,
          subtotal,
        };
      })
    );
  }

  function removeItem(idx: number) {
    setItems(prev => prev.filter((_, i) => i !== idx));
  }

  function getAvailableVariants(productId: number) {
    const product = catalog.find(p => p.productId === productId);
    if (!product) return [];

    const variantMap = new Map<number, any>();

    if (product.variantPrices?.length) {
      product.variantPrices.forEach(vp => {
        if (vp.isActive && vp.variantIsActive) {
          variantMap.set(vp.variantId, {
            id: vp.variantId,
            name: vp.variantName,
            price: vp.price,
            source: "base"
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
              source: "matrix"
            });
          }
        }
      });
    }

    return Array.from(variantMap.values()).sort((a, b) => a.name.localeCompare(b.name));
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

    const qty = asNumber(quantity, NaN);
    if (!Number.isFinite(qty) || qty <= 0) return "Cantidad inválida";

    const minQty = asNumber(row.product.minQty, 1);
    const qtyStep = asNumber(row.product.qtyStep, 1);

    const halfSpecialEnabled =
      row.product.unitType === "METER" &&
      !!row.halfStepSpecialPrice &&
      asNumber(row.halfStepSpecialPrice) > 0;

    if (!halfSpecialEnabled || !nearlyEqual(qty, 0.5)) {
      if (qty < minQty) {
        return `La cantidad mínima es ${minQty}`;
      }

      if (qtyStep > 0) {
        const steps = (qty - minQty) / qtyStep;
        const nearest = Math.round(steps);
        if (Math.abs(steps - nearest) > 1e-3) {
          return `Debe ser múltiplo de ${qtyStep} a partir de ${minQty}`;
        }
      }
    }

    if (row.product.needsVariant && !variantId) {
      return "Debe seleccionar un tamaño";
    }

    return null;
  }

  function validatePieceParams(item: OrderItem): string | null {
    for (const sp of item.selectedParams) {
      if (sp.chargeType === "PER_PIECE") {
        const qty = asNumber(sp.pieceQty, 0);
        const meta = getParamMeta(item.productId, sp.paramId);
        if (!meta) continue;

        if (!Number.isFinite(qty) || qty <= 0) {
          return `El parámetro "${meta.paramName}" debe tener una cantidad de piezas válida`;
        }
      }
    }
    return null;
  }

  function addSelectedFiles(files: FileList | null) {
    const selected = Array.from(files ?? []);
    if (selected.length === 0) return;

    setOrderFiles(prev => {
      const next = [...prev, ...selected].slice(0, MAX_ORDER_FILES);
      if (prev.length + selected.length > MAX_ORDER_FILES) {
        setErr(`Solo puedes adjuntar hasta ${MAX_ORDER_FILES} archivos por pedido`);
      }
      return next;
    });
  }

  function removeSelectedFile(index: number) {
    setOrderFiles(prev => prev.filter((_, i) => i !== index));
  }

  function resetOrderForm() {
    setItems([]);
    setNotes("");
    setCustomer(null);
    setCustomerNumber("");
    setSearchQuery("");
    setOrderFiles([]);
    setPayments([{ method: "CASH", amount: 0 }]);
    setSchedulePreview(null);
    setSchedulePreviewError(null);
    setSchedulePreviewLoading(false);
    setDeliveryManuallyEdited(false);
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

    if (!paymentsAreValid) {
      setErr("El pedido debe quedar liquidado: verifica el desglose de pagos");
      return;
    }

    for (let i = 0; i < items.length; i++) {
      const item = items[i];

      if (item.isCustomProduct) {
        if (!item.customProductName || !item.customProductName.trim()) {
          setErr(`Item ${i + 1}: El nombre del producto libre es requerido`);
          return;
        }
        if (!item.customUnitPrice || item.customUnitPrice <= 0) {
          setErr(`Item ${i + 1}: El precio del producto libre debe ser mayor a 0`);
          return;
        }
        if (!item.customUnitType) {
          setErr(`Item ${i + 1}: Selecciona el tipo de unidad (metro o pieza)`);
          return;
        }
        continue;
      }

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

      const paramError = validatePieceParams(item);
      if (paramError) {
        setErr(`Item ${i + 1}: ${paramError}`);
        return;
      }
    }

    try {
      setSaving(true);

      const payload = {
        customerId: customer.id,
        pickupBranchId: pickupBranchId ?? branchId,
        branchId,
        shippingType,
        paymentMethod: payments[0]?.method ?? "CASH",
        payments: payments.map((p) => ({
          method: p.method,
          amount: Number(p.amount.toFixed(2)),
          reference: p.reference?.trim() ? p.reference.trim() : null,
        })),
        deliveryDate,
        deliveryTime: deliveryTime || null,
        deliveryScheduleSource: deliveryManuallyEdited ? "MANUAL" : "AUTO",
        notes: notes || null,
        hasIva,
        items: items.map(it => {
          if (it.isCustomProduct) {
            return {
              productId: -1,
              quantity: it.quantity.toString(),
              variantId: null,
              selectedParams: [],
              isCustomProduct: true,
              customProductName: it.customProductName ?? "",
              customUnitType: it.customUnitType ?? "PIECE",
              customUnitPrice: it.customUnitPrice ?? 0,
            };
          }
          return {
            productId: it.productId,
            quantity: it.quantity.toString(),
            variantId: it.variantId || null,
            paramIds: it.selectedParams.map(p => p.paramId),
            selectedParams: it.selectedParams.map(p => ({
              paramId: p.paramId,
              chargeType: p.chargeType,
              pieceQty: p.chargeType === "PER_PIECE" ? asNumber(p.pieceQty, 1) : undefined,
            })),
          };
        }),
      };

      const filesToUpload = [...orderFiles];
      const r = await createOrder(payload as any);

      const uploadFailures: string[] = [];
      for (const file of filesToUpload) {
        try {
          await uploadOrderFile(r.orderId, file);
        } catch (error: any) {
          uploadFailures.push(`${file.name}: ${error?.message ?? "Error desconocido"}`);
        }
      }

      resetOrderForm();

      if (uploadFailures.length > 0) {
        setMsg(`Pedido #${r.orderId} creado. Total: $${Number(r.total).toFixed(2)}`);
        setErr(`Pedido creado, pero no se pudieron subir algunos archivos. ${uploadFailures.join(" | ")}`);
        return;
      }

      setMsg(`Pedido #${r.orderId} creado ✅ Total: $${Number(r.total).toFixed(2)}`);
      navigate("/orders");
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
      document.addEventListener("click", handleClickOutside);
      return () => {
        document.removeEventListener("click", handleClickOutside);
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
              onClick={() => navigate('/orders')}
              className="inline-flex items-center gap-2 px-5 py-3 bg-gradient-to-r from-gray-600 to-gray-700 hover:from-gray-700 hover:to-gray-800 text-white font-semibold rounded-xl transition-all duration-200 shadow-sm hover:shadow"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              Volver a Pedidos Activos
            </button>
          </div>
        </div>

        {/* Banner de Precio por Volumen */}
        {totalVolumeQuantity > 0 && (
          <div className={`mb-6 rounded-2xl p-4 transition-all duration-300 ${activeVolumeThreshold
            ? 'bg-gradient-to-r from-green-500 to-emerald-500 text-white shadow-lg'
            : 'bg-gradient-to-r from-blue-500 to-cyan-500 text-white'
            }`}>
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-white/20 rounded-xl">
                  <Layers className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="font-bold text-lg">Precio por Volumen Activado</h3>
                  <p className="text-sm opacity-90">
                    Frazadas + Toallas: {totalVolumeQuantity} unidades totales
                  </p>
                </div>
              </div>
              <div className="flex gap-3">
                {VOLUME_THRESHOLDS.map(threshold => (
                  <div
                    key={threshold}
                    className={`px-4 py-2 rounded-xl text-center font-medium transition-all ${activeVolumeThreshold && activeVolumeThreshold >= threshold
                      ? 'bg-white text-green-600 shadow-md'
                      : 'bg-white/20 text-white'
                      }`}
                  >
                    <div className="text-sm">Desde</div>
                    <div className="text-xl font-bold">{threshold}+</div>
                  </div>
                ))}
              </div>
              {activeVolumeThreshold && (
                <div className="flex items-center gap-2 bg-white/20 px-4 py-2 rounded-xl">
                  <TrendingUp className="w-5 h-5" />
                  <span className="font-medium">
                    ¡Precio especial por {activeVolumeThreshold}+ unidades aplicado!
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

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
          {/* Left Column */}
          <div className="lg:col-span-2 space-y-6">
            {/* Customer Section */}
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2 bg-gradient-to-r from-blue-100 to-cyan-100 rounded-lg">
                  <User className="w-5 h-5 text-blue-600" />
                </div>
                <h2 className="text-xl font-bold text-gray-900">Información del Cliente</h2>
              </div>

              <div className="relative" ref={searchRef}>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Buscar cliente por nombre, teléfono o número
                </label>
                <div className="relative">
                  <div className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400">
                    <Search className="w-4 h-4" />
                  </div>
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => handleSearchInput(e.target.value)}
                    onFocus={() => {
                      if (searchResults.length > 0 && searchQuery.trim()) {
                        setShowResults(true);
                      }
                    }}
                    placeholder="Ejemplo: Juan, 5512345678, o #123"
                    className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200"
                  />
                  {searching && (
                    <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
                    </div>
                  )}
                </div>

                {showResults && (
                  <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg max-h-64 overflow-y-auto">
                    {searchResults.length > 0 ? (
                      <div className="py-2">
                        {searchResults.map((result) => (
                          <button
                            key={result.id}
                            onClick={() => selectCustomer(result)}
                            className="w-full px-4 py-3 text-left hover:bg-gray-50 transition-colors border-b border-gray-100 last:border-0"
                          >
                            <div className="flex justify-between items-center">
                              <div>
                                <p className="font-medium text-gray-900">{result.name}</p>
                                <p className="text-sm text-gray-500">{result.phone}</p>
                              </div>
                              <span className="text-xs text-gray-400 bg-gray-100 px-2 py-1 rounded-full">
                                #{result.id}
                              </span>
                            </div>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="px-4 py-8 text-center text-gray-500">
                        No se encontraron clientes
                      </div>
                    )}
                  </div>
                )}
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
                <button
                  onClick={addCustomItem}
                  className="inline-flex items-center gap-2 px-5 py-3 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white font-semibold rounded-xl transition-all duration-200 shadow-sm hover:shadow"
                >
                  <Plus className="w-4 h-4" />
                  Producto Libre
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
                      if (!it.isCustomProduct && !product) {
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

                      if (it.isCustomProduct) {
                        const unitPrice = asNumber(it.customUnitPrice, 0);
                        const itemTotal = asNumber(it.quantity, 0) * unitPrice;
                        return (
                          <div key={idx} className="border rounded-xl p-6 bg-purple-50 border-purple-200">
                            <div className="flex items-start justify-between mb-4">
                              <div className="flex items-center gap-2">
                                <div className="px-2 py-1 bg-purple-200 text-purple-800 rounded text-xs font-bold">
                                  LIBRE
                                </div>
                                <span className="text-sm text-purple-600">Producto libre — sin pasos de producción</span>
                              </div>
                              <button
                                onClick={() => removeItem(idx)}
                                className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white font-medium rounded-lg transition-colors"
                              >
                                Eliminar
                              </button>
                            </div>

                            <div className="flex flex-col lg:flex-row lg:items-start gap-6">
                              <div className="flex-1 space-y-4">
                                <div>
                                  <label className="block text-sm font-medium text-gray-700 mb-2">
                                    Nombre del producto <span className="text-red-500">*</span>
                                  </label>
                                  <input
                                    type="text"
                                    value={it.customProductName ?? ""}
                                    onChange={(e) => updateItem(idx, { customProductName: e.target.value })}
                                    placeholder="Ej: Lonas para evento, banners, etc."
                                    className="w-full px-4 py-3 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 transition-all duration-200"
                                  />
                                </div>

                                <div className="flex flex-col sm:flex-row gap-4">
                                  <div className="flex-1">
                                    <label className="block text-sm font-medium text-gray-700 mb-2">
                                      Tipo de unidad <span className="text-red-500">*</span>
                                    </label>
                                    <div className="flex gap-3">
                                      <button
                                        type="button"
                                        onClick={() => updateItem(idx, { customUnitType: "PIECE" })}
                                        className={`flex-1 px-4 py-3 rounded-lg border font-medium transition-all ${
                                          it.customUnitType === "PIECE"
                                            ? "bg-purple-600 text-white border-purple-600"
                                            : "bg-white text-gray-700 border-gray-300 hover:border-purple-400"
                                        }`}
                                      >
                                        Pieza
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => updateItem(idx, { customUnitType: "METER" })}
                                        className={`flex-1 px-4 py-3 rounded-lg border font-medium transition-all ${
                                          it.customUnitType === "METER"
                                            ? "bg-purple-600 text-white border-purple-600"
                                            : "bg-white text-gray-700 border-gray-300 hover:border-purple-400"
                                        }`}
                                      >
                                        Metro
                                      </button>
                                    </div>
                                  </div>

                                  <div className="flex-1">
                                    <label className="block text-sm font-medium text-gray-700 mb-2">
                                      Precio por {(it.customUnitType ?? "PIECE").toLowerCase()} <span className="text-red-500">*</span>
                                    </label>
                                    <div className="relative">
                                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 font-medium">$</span>
                                      <input
                                        type="number"
                                        min={0.01}
                                        step="0.01"
                                        value={it.customUnitPrice ?? ""}
                                        onChange={(e) => updateItem(idx, { customUnitPrice: asNumber(e.target.value, 0) })}
                                        className="w-full pl-8 pr-4 py-3 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 transition-all duration-200"
                                        placeholder="0.00"
                                      />
                                    </div>
                                  </div>

                                  <div className="flex-1">
                                    <label className="block text-sm font-medium text-gray-700 mb-2">
                                      Cantidad
                                    </label>
                                    <div className="relative">
                                      <input
                                        type="number"
                                        min={0.5}
                                        step={0.5}
                                        value={it.quantity}
                                        onChange={(e) => updateItem(idx, { quantity: asNumber(e.target.value, 1) })}
                                        className="w-full pl-4 pr-12 py-3 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 transition-all duration-200"
                                      />
                                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 font-medium">
                                        {(it.customUnitType ?? "PIECE").toLowerCase()}s
                                      </span>
                                    </div>
                                  </div>
                                </div>
                              </div>

                              <div className="lg:w-48 space-y-4">
                                <div className="bg-white p-4 rounded-lg border border-purple-200">
                                  <div className="text-center mb-3">
                                    <p className="text-xs text-gray-500 mb-1">Precio unitario</p>
                                    <p className="text-xl font-bold text-gray-900">
                                      ${unitPrice.toFixed(2)}
                                    </p>
                                    <p className="text-xs text-gray-400">/ {(it.customUnitType ?? "PIECE").toLowerCase()}</p>
                                  </div>
                                  <div className="text-center pt-3 border-t border-gray-100">
                                    <p className="text-xs text-gray-500 mb-1">Total item</p>
                                    <p className="text-2xl font-bold text-purple-600">
                                      ${itemTotal.toFixed(2)}
                                    </p>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      }

                      const unitPrice = calculateUnitPrice(it);
                      const itemTotal = calculateItemTotal(it);
                      const pieceParamsTotal = getPieceParamsTotal(it);
                      const quantityError = validateQuantity(it.productId, it.quantity, it.variantId);
                      const availableVariants = getAvailableVariants(it.productId);
                      const availableQtyPrices = getAvailableQuantityPrices(it);
                      const halfSpecialEnabled =
                        it.isCustomProduct
                          ? false
                          : !!product && product.product.unitType === "METER" &&
                          !!product.halfStepSpecialPrice &&
                          asNumber(product.halfStepSpecialPrice) > 0;

                      const isVolumeProduct = VOLUME_PRODUCT_IDS.includes(it.productId);

                      return (
                        <div
                          key={idx}
                          className={`border rounded-xl p-6 transition-colors ${isVolumeProduct && it.usedVolumePricing
                            ? 'bg-green-50 border-green-300'
                            : 'bg-gray-50 border-gray-200 hover:border-gray-300'
                            }`}
                        >
                          {isVolumeProduct && it.usedVolumePricing && (
                            <div className="mb-4 flex justify-end">
                              <div className="inline-flex items-center gap-2 px-3 py-1 bg-green-200 text-green-800 rounded-full text-xs font-medium">
                                <TrendingUp className="w-3 h-3" />
                                Precio por volumen ({it.volumeThreshold}+ unidades)
                              </div>
                            </div>
                          )}

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
                                      {VOLUME_PRODUCT_IDS.includes(r.productId) && " 📦 (precio por volumen)"}
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
                                      min={halfSpecialEnabled ? 0.5 : asNumber(product && product.product.minQty, 1)}
                                      step={halfSpecialEnabled ? "any" : asNumber(product && product.product.qtyStep, 1)}
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
                                      {product?.product.unitType.toLowerCase()}s
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
                                      {availableQtyPrices.map((qp) => (
                                        <span
                                          key={qp.minQty}
                                          className={`px-2 py-1 text-xs font-medium rounded border ${activeVolumeThreshold === qp.minQty && isVolumeProduct
                                            ? 'bg-green-500 text-white border-green-600'
                                            : 'bg-white text-blue-700 border-blue-200'
                                            }`}
                                        >
                                          {qp.label}
                                        </span>
                                      ))}
                                    </div>
                                  </div>
                                )}

                                {/* Special Price 0.5m */}
                                {product && product.product.unitType === "METER" && product.halfStepSpecialPrice && (
                                  <div className="mt-2 flex items-center gap-2 text-sm text-green-600">
                                    <div className="w-1.5 h-1.5 rounded-full bg-green-600"></div>
                                    Precio especial 0.5m: ${asNumber(product.halfStepSpecialPrice).toFixed(2)} (fijo)
                                  </div>
                                )}
                              </div>

                              {/* Variants */}
                              {(product?.product.needsVariant || availableVariants.length > 0) && (
                                <div>
                                  <label className="block text-sm font-medium text-gray-700 mb-2">
                                    Tamaño {product?.product.needsVariant && (
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

                                    {!product?.product.needsVariant && (
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
                              {product?.paramPrices && product.paramPrices.length > 0 && (
                                <div>
                                  <label className="block text-sm font-medium text-gray-700 mb-2">
                                    Parámetros adicionales
                                  </label>
                                  <div className="space-y-3">
                                    {product.paramPrices
                                      .filter(p => p.paramIsActive)
                                      .map((param) => {
                                        const selected = getSelectedParam(it, param.paramId);
                                        const isPiece = (param.chargeType ?? "PER_METER") === "PER_PIECE";

                                        return (
                                          <div
                                            key={param.paramId}
                                            className="p-3 bg-white border border-gray-200 rounded-lg"
                                          >
                                            <div className="flex items-center justify-between gap-4">
                                              <label className="flex items-center gap-3 cursor-pointer">
                                                <input
                                                  type="checkbox"
                                                  checked={!!selected}
                                                  onChange={() => toggleParam(idx, param.paramId)}
                                                />
                                                <div>
                                                  <p className="font-medium text-gray-900">{param.paramName}</p>
                                                  <p className="text-sm text-gray-500">
                                                    +${asNumber(param.priceDelta).toFixed(2)}{" "}
                                                    / {isPiece ? "pieza" : "unidad"}
                                                  </p>
                                                </div>
                                              </label>

                                              <span
                                                className={`text-xs px-2 py-1 rounded-full ${isPiece
                                                  ? "bg-purple-100 text-purple-700"
                                                  : "bg-blue-100 text-blue-700"
                                                  }`}
                                              >
                                                {isPiece ? "Por pieza" : "Por metro"}
                                              </span>
                                            </div>

                                            {selected && isPiece && (
                                              <div className="mt-3">
                                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                                  Número de piezas
                                                </label>
                                                <input
                                                  type="number"
                                                  min={1}
                                                  step={1}
                                                  value={selected.pieceQty ?? 1}
                                                  onChange={(e) =>
                                                    updateParamPieceQty(
                                                      idx,
                                                      param.paramId,
                                                      asNumber(e.target.value, 1)
                                                    )
                                                  }
                                                  className="w-40 px-4 py-2 bg-white border border-gray-300 rounded-lg"
                                                />
                                                <p className="mt-2 text-xs text-gray-500">
                                                  Extra: $
                                                  {(asNumber(selected.pieceQty, 1) * asNumber(param.priceDelta, 0)).toFixed(2)}
                                                </p>
                                              </div>
                                            )}
                                          </div>
                                        );
                                      })}
                                  </div>
                                </div>
                              )}
                            </div>

                            {/* Right Column - Price Info & Actions */}
                            <div className="lg:w-48 space-y-4">
                              <div className="bg-white p-4 rounded-lg border border-gray-200">
                                <div className="text-center mb-3">
                                  <p className="text-xs text-gray-500 mb-1">Precio unitario</p>
                                  <p className={`text-xl font-bold ${it.usedVolumePricing ? 'text-green-600' : 'text-gray-900'}`}>
                                    ${unitPrice.toFixed(2)}
                                  </p>
                                  {it.usedVolumePricing && (
                                    <p className="text-xs text-green-600 mt-1">(precio por volumen)</p>
                                  )}
                                </div>
                                {pieceParamsTotal > 0 && (
                                  <div className="text-center mb-2">
                                    <p className="text-xs text-gray-500">Extras por pieza</p>
                                    <p className="text-sm font-semibold text-green-600">+${pieceParamsTotal.toFixed(2)}</p>
                                  </div>
                                )}
                                <div className="text-center pt-3 border-t border-gray-100">
                                  <p className="text-xs text-gray-500 mb-1">Total item</p>
                                  <p className="text-2xl font-bold text-green-600">
                                    ${itemTotal.toFixed(2)}
                                  </p>
                                </div>
                              </div>

                              <button
                                onClick={() => removeItem(idx)}
                                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white font-medium rounded-lg transition-colors"
                              >
                                <Trash2 className="w-4 h-4" />
                                Eliminar
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
                        onChange={(e) => handleDeliveryDateChange(e.target.value)}
                        disabled={deliveryDateLocked}
                        className={`
                          w-full px-4 py-3 border rounded-lg transition-all duration-200
                          ${deliveryDateLocked
                            ? 'border-gray-200 bg-gray-100 text-gray-500 cursor-not-allowed'
                            : dateTimeError
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
                          if (deliveryDateLocked) return;
                          setShowTimeDropdown(!showTimeDropdown);
                        }}
                        className={`
                          w-full px-4 py-3 border rounded-lg cursor-pointer transition-all duration-200
                          flex items-center justify-between
                          ${deliveryDateLocked
                            ? 'border-gray-200 bg-gray-100 text-gray-500 cursor-not-allowed'
                            : dateTimeError
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
                                handleDeliveryTimeChange(option.value);
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
                      {deliveryDateLocked && (
                        <p className="mt-1 text-xs text-gray-500">
                          La fecha automática solo puede modificarla un administrador.
                        </p>
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
                    <label className="block text-sm font-medium text-gray-700">Métodos de Pago</label>
                  </div>
                  <div className="space-y-2">
                    {payments.map((pay, index) => (
                      <div key={index} className="grid grid-cols-12 gap-2 p-2 border border-gray-200 rounded-lg items-center">
                        <select
                          value={pay.method}
                          onChange={(e) => changePaymentMethod(index, e.target.value as PaymentSplit["method"])}
                          className="col-span-5 px-2 py-2 border border-gray-300 rounded-lg"
                        >
                          {PAYMENT_METHODS.map((method) => {
                            const usedByOther = payments.some((p, i) => i !== index && p.method === method);
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
                          value={pay.amount}
                          onChange={(e) =>
                            setPayments((prev) =>
                              prev.map((x, i) => (i === index ? { ...x, amount: Number(e.target.value) } : x))
                            )
                          }
                          className="col-span-5 px-2 py-2 border border-gray-300 rounded-lg"
                          placeholder="Monto"
                          disabled={payments.length === 1}
                        />
                        <button
                          type="button"
                          onClick={() => setPayments((prev) => prev.filter((_, i) => i !== index))}
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
                      className="px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
                    >
                      Agregar método {`(${payments.length}/3)`}
                    </button>
                    <div className={`text-sm ${Math.abs(paymentDiff) <= 0.01 ? "text-green-700" : "text-amber-700"}`}>
                      {Math.abs(paymentDiff) <= 0.01
                        ? "Pago liquidado"
                        : paymentDiff > 0
                        ? `Faltan $${paymentDiff.toFixed(2)}`
                        : `Sobra $${Math.abs(paymentDiff).toFixed(2)}`}
                    </div>
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

            {/* Order Files */}
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2 bg-gradient-to-r from-blue-100 to-indigo-100 rounded-lg">
                  <Paperclip className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-gray-900">Archivos del Pedido</h2>
                  <p className="text-sm text-gray-500">Opcional. Se suben despues de crear el pedido.</p>
                </div>
              </div>

              <label className="flex flex-col items-center justify-center gap-3 border-2 border-dashed border-gray-300 rounded-xl p-5 bg-gray-50 hover:bg-blue-50 hover:border-blue-300 transition-colors cursor-pointer text-center">
                <Upload className="w-8 h-8 text-blue-600" />
                <div>
                  <p className="font-semibold text-gray-800">Seleccionar archivos</p>
                  <p className="text-xs text-gray-500 mt-1">PDF, imagenes, ZIP/RAR, PSD, AI o CDR. Maximo {MAX_ORDER_FILES} archivos.</p>
                </div>
                <input
                  type="file"
                  multiple
                  accept={ORDER_FILE_ACCEPT}
                  className="hidden"
                  onChange={(event) => {
                    addSelectedFiles(event.target.files);
                    event.target.value = "";
                  }}
                />
              </label>

              {orderFiles.length > 0 && (
                <div className="mt-4 space-y-2">
                  {orderFiles.map((file, index) => (
                    <div key={`${file.name}-${file.lastModified}-${index}`} className="flex items-center justify-between gap-3 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-800 truncate">{file.name}</p>
                        <p className="text-xs text-gray-500">{formatFileSize(file.size)}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeSelectedFile(index)}
                        className="shrink-0 p-1.5 rounded-full text-gray-500 hover:text-red-600 hover:bg-red-50 transition-colors"
                        aria-label={`Quitar ${file.name}`}
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Order Summary */}
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 sticky top-6">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2 bg-gradient-to-r from-green-100 to-emerald-100 rounded-lg">
                  <Receipt className="w-5 h-5 text-green-600" />
                </div>
                <h2 className="text-xl font-bold text-gray-900">Resumen del Pedido</h2>
              </div>

              {totalVolumeQuantity > 0 && (
                <div className="mb-6 p-4 bg-blue-50 rounded-lg border border-blue-200">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-blue-700 font-medium">Total Frazadas + Toallas:</span>
                    <span className="text-blue-900 font-bold text-xl">{totalVolumeQuantity} unidades</span>
                  </div>
                  <div className="flex gap-2 mt-2">
                    {VOLUME_THRESHOLDS.map(threshold => (
                      <div
                        key={threshold}
                        className={`flex-1 text-center px-2 py-1 rounded text-xs font-medium ${totalVolumeQuantity >= threshold
                          ? 'bg-green-500 text-white'
                          : 'bg-gray-200 text-gray-600'
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
                      Agrega {12 - totalVolumeQuantity} unidades más para activar precio por volumen
                    </p>
                  )}
                </div>
              )}

              <div className="mb-6 p-4 bg-gray-50 rounded-lg space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-gray-700">Productos</span>
                  <span className="font-bold text-gray-900">{items.length}</span>
                </div>

                <div className="flex justify-between items-center">
                  <span className="text-gray-700">Subtotal</span>
                  <span className="font-bold text-gray-900">
                    ${subtotalBeforeTax.toFixed(2)}
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => setHasIva(prev => !prev)}
                  className={`w-full px-4 py-3 rounded-xl font-semibold border transition-all ${hasIva
                      ? "bg-indigo-600 text-white border-indigo-600"
                      : "bg-white text-gray-700 border-gray-300 hover:border-indigo-400 hover:bg-indigo-50"
                    }`}
                >
                  {hasIva ? "✓ IVA agregado" : "Agregar IVA"}
                </button>

                {hasIva && (
                  <div className="flex justify-between items-center">
                    <span className="text-gray-700">IVA 16%</span>
                    <span className="font-bold text-indigo-600">
                      +${ivaAmount.toFixed(2)}
                    </span>
                  </div>
                )}

                <div className="pt-3 border-t border-gray-200 flex justify-between items-center">
                  <span className="text-gray-700 font-semibold">Total</span>
                  <span className="text-2xl font-bold text-green-600">
                    ${total.toFixed(2)}
                  </span>
                </div>
              </div>

              {(schedulePreviewLoading || schedulePreview?.estimatedReadyAt || schedulePreviewError || deliveryManuallyEdited) && (
                <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-lg">
                  <div className="flex items-start gap-3">
                    <Calendar className="w-5 h-5 text-amber-600 mt-0.5" />
                    <div className="flex-1 space-y-3">
                      <div>
                        <p className="text-sm font-semibold text-amber-900">
                          {schedulePreviewLoading && !schedulePreview?.estimatedReadyAt
                            ? "Calculando entrega estimada..."
                            : `Entrega estimada: ${formatDeliveryDateTime(deliveryDate, deliveryTime)}`}
                        </p>
                        {schedulePreviewLoading && schedulePreview && (
                          <p className="text-xs text-amber-700 mt-1">Actualizando estimación...</p>
                        )}
                        {deliveryManuallyEdited && (
                          <p className="text-xs text-amber-700 mt-1">Fecha modificada manualmente</p>
                        )}
                        {schedulePreviewError && (
                          <p className="text-xs text-red-700 mt-1">{schedulePreviewError}</p>
                        )}
                      </div>

                      {deliveryManuallyEdited && schedulePreview?.estimatedReadyAt && (
                        <button
                          type="button"
                          onClick={useAutomaticDeliveryDate}
                          className="text-xs font-semibold text-amber-900 underline underline-offset-2 hover:text-amber-700"
                        >
                          Usar cálculo automático
                        </button>
                      )}

                      {showScheduleWindowHint && (
                        <p className="text-xs text-amber-800 bg-white/70 border border-amber-200 rounded-lg px-3 py-2">
                          La estimación depende de las ventanas configuradas. Si faltan días como miércoles, jueves o viernes, no se contarán como días de producción.
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )}

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

              <button
                onClick={saveOrder}
                disabled={saving || !customer || items.length === 0 || !!dateTimeError || !paymentsAreValid}
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

              <div className="mt-6 pt-6 border-t border-gray-200 space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Entrega:</span>
                  <span className="font-medium text-gray-900">{formatDeliveryDateTime(deliveryDate, deliveryTime)}</span>
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
                    {payments
                      .map((p) => `${p.method === "CASH" ? "Efectivo" : p.method === "TRANSFER" ? "Transferencia" : "Tarjeta"} $${p.amount.toFixed(2)}`)
                      .join(" | ")}
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
