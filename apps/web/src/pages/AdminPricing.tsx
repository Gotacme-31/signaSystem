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
  createProductionBlackoutDate,
  deleteProductionBlackoutDate,
  getProductionBlackoutDates,
  getProductionConfigs,
  setProductionConfig,
  updateProductionBlackoutDate,
  type ProductionBlackoutDate,
  type ProductionTargetWindow,
} from "../api/productionScheduling";
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
import { safeDateKey } from "../lib/businessTime";

type FiltroEstado = "todos" | "activos" | "inactivos";
type BlackoutScope = "BRANCH" | "GLOBAL" | "PRODUCT";

type ProductionConfigEdit = {
  enabled: boolean;
  windows: ProductionWindowEdit[];
  quantityRules: ProductionRuleEdit[];
};

type ProductionWindowEdit = {
  id?: number | null;
  dayOfWeek: string;
  startsAt: string;
  endsAt: string;
  readyAt: string;
  capacityQty: string;
  isActive: boolean;
};

type ProductionRuleEdit = {
  id?: number | null;
  minQty: string;
  maxQty: string;
  delayBusinessDays: string;
  targetWindow: ProductionTargetWindow;
  isActive: boolean;
};

const DIAS_SEMANA = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const TARGET_WINDOWS: ProductionTargetWindow[] = ["NEXT_AVAILABLE", "FIRST_OF_DAY", "LAST_OF_DAY"];

function etiquetaVentanaObjetivo(value: ProductionTargetWindow) {
  if (value === "NEXT_AVAILABLE") return "Próxima disponible";
  if (value === "FIRST_OF_DAY") return "Primera del día";
  return "Última del día";
}

function normalizarNumero(s: string) {
  return s.trim().replace(",", ".");
}

function esNumeroValido(s: string) {
  if (!s.trim()) return false;
  const n = Number(normalizarNumero(s));
  return Number.isFinite(n);
}

function dateInputFromIso(value?: string | null) {
  if (!value) return "";
  return safeDateKey(value);
}

function formatDateLabel(value?: string | null) {
  const input = dateInputFromIso(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input);
  if (!match) return "—";
  return `${match[3]}/${match[2]}/${match[1]}`;
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
  const [halfStepSpecialPriceEdit, setHalfStepSpecialPriceEdit] = useState<Record<number, string>>({});
  const [activoEdit, setActivoEdit] = useState<Record<number, boolean>>({});

  const [preciosCantidadEdit, setPreciosCantidadEdit] = useState<Record<number, QuantityPriceRow[]>>({});
  const [preciosVarianteEdit, setPreciosVarianteEdit] = useState<Record<number, VariantPriceRow[]>>({});
  const [preciosParamEdit, setPreciosParamEdit] = useState<Record<number, ParamPriceRow[]>>({});
  const [preciosMatrizEdit, setPreciosMatrizEdit] = useState<
    Record<number, Record<number, QuantityPriceRow[]>>
  >({});
  const [produccionEdit, setProduccionEdit] = useState<Record<number, ProductionConfigEdit>>({});
  const [blackoutDates, setBlackoutDates] = useState<ProductionBlackoutDate[]>([]);
  const [blackoutForm, setBlackoutForm] = useState<{
    scope: BlackoutScope;
    date: string;
    productId: string;
    reason: string;
    isActive: boolean;
  }>({ scope: "BRANCH", date: "", productId: "", reason: "", isActive: true });

  const [abierto, setAbierto] = useState<Record<number, boolean>>({});

  async function cargarSucursales() {
    try {
      setError(null);
      const data = await getBranches();
      setSucursales(data);
      const primera = data.find((x) => x.isActive) ?? data[0];

      const desired = branchIdFromQuery ? Number(branchIdFromQuery) : null;
      if (desired && Number.isFinite(desired) && data.some((b) => b.id === desired)) {
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

      const [data, productionData, blackoutData] = await Promise.all([
        getBranchProducts(bid),
        getProductionConfigs(bid),
        getProductionBlackoutDates({ branchId: bid }),
      ]);
      setFilas(data);
      setBlackoutDates(blackoutData.rows);

      const p: Record<number, string> = {};
      const hs: Record<number, string> = {};
      const a: Record<number, boolean> = {};
      const qc: Record<number, QuantityPriceRow[]> = {};
      const vp: Record<number, VariantPriceRow[]> = {};
      const pp: Record<number, ParamPriceRow[]> = {};
      const pm: Record<number, Record<number, QuantityPriceRow[]>> = {};
      const prod: Record<number, ProductionConfigEdit> = {};
      const productionByProductId = new Map(
        productionData.rows.map((row) => [row.productId, row.config])
      );

      for (const r of data) {
        const pid = r.productId;
        const productionConfig = productionByProductId.get(pid);
        p[pid] = String(r.price ?? "0");
        hs[pid] = r.halfStepSpecialPrice != null ? String(r.halfStepSpecialPrice) : "";
        a[pid] = !!r.isActive;
        prod[pid] = {
          enabled: !!productionConfig?.enabled,
          windows: (productionConfig?.windows ?? []).map((window) => ({
            id: window.id ?? null,
            dayOfWeek: String(window.dayOfWeek),
            startsAt: window.startsAt,
            endsAt: window.endsAt,
            readyAt: window.readyAt,
            capacityQty: String(window.capacityQty ?? "0"),
            isActive: !!window.isActive,
          })),
          quantityRules: (productionConfig?.quantityRules ?? []).map((rule) => ({
            id: rule.id ?? null,
            minQty: String(rule.minQty ?? "0"),
            maxQty: rule.maxQty == null ? "" : String(rule.maxQty),
            delayBusinessDays: String(rule.delayBusinessDays ?? 0),
            targetWindow: rule.targetWindow ?? "NEXT_AVAILABLE",
            isActive: !!rule.isActive,
          })),
        };

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
      setHalfStepSpecialPriceEdit(hs);
      setActivoEdit(a);
      setPreciosCantidadEdit(qc);
      setPreciosVarianteEdit(vp);
      setPreciosParamEdit(pp);
      setPreciosMatrizEdit(pm);
      setProduccionEdit(prod);

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
    const half = halfStepSpecialPriceEdit[productId] ?? "";

    if (!esNumeroValido(price)) {
      setError("El precio base debe ser un número válido.");
      return;
    }

    if (half.trim() !== "") {
      if (!esNumeroValido(half)) {
        setError("El precio especial 0.5 debe ser un número válido.");
        return;
      }
      if (Number(normalizarNumero(half)) < 0) {
        setError("El precio especial 0.5 no puede ser negativo.");
        return;
      }
    }

    setGuardando(true);
    setError(null);
    try {
      await setBranchProductPrice(
        sucursalId,
        productId,
        normalizarNumero(price),
        !!activoEdit[productId],
        half.trim() === "" ? null : normalizarNumero(half)
      );
      await cargarProductosDeSucursal(sucursalId);
    } catch (e: any) {
      setError(e?.message ?? "Error guardando precio base");
    } finally {
      setGuardando(false);
    }
  }

  function cambiarProduccion(
    productId: number,
    field: keyof ProductionConfigEdit,
    value: string | boolean
  ) {
    setProduccionEdit((prev) => {
      const current = prev[productId] ?? defaultProductionEdit(productId);

      return {
        ...prev,
        [productId]: {
          ...current,
          [field]: value,
        },
      };
    });
  }

  function defaultProductionEdit(productId: number): ProductionConfigEdit {
    return {
      enabled: false,
      windows: [],
      quantityRules: [],
    };
  }

  function agregarVentana(productId: number) {
    setProduccionEdit((prev) => {
      const current = prev[productId] ?? defaultProductionEdit(productId);
      return {
        ...prev,
        [productId]: {
          ...current,
          windows: [
            ...current.windows,
            {
              dayOfWeek: "1",
              startsAt: "09:00",
              endsAt: "12:00",
              readyAt: "12:00",
              capacityQty: "0",
              isActive: true,
            },
          ],
        },
      };
    });
  }

  function cambiarVentana(
    productId: number,
    index: number,
    field: keyof ProductionWindowEdit,
    value: string | boolean
  ) {
    setProduccionEdit((prev) => {
      const current = prev[productId] ?? defaultProductionEdit(productId);
      const windows = [...current.windows];
      windows[index] = { ...windows[index], [field]: value };
      return { ...prev, [productId]: { ...current, windows } };
    });
  }

  function eliminarVentana(productId: number, index: number) {
    setProduccionEdit((prev) => {
      const current = prev[productId] ?? defaultProductionEdit(productId);
      return {
        ...prev,
        [productId]: {
          ...current,
          windows: current.windows.filter((_, i) => i !== index),
        },
      };
    });
  }

  function copiarLunesAViernes(productId: number) {
    const current = produccionEdit[productId] ?? defaultProductionEdit(productId);
    const mondayWindows = current.windows.filter((window) => Number(window.dayOfWeek) === 1);

    if (mondayWindows.length === 0) {
      setError("Para copiar lunes a viernes, primero agrega al menos una ventana de lunes.");
      return;
    }

    setError(null);
    setProduccionEdit((prev) => {
      const latest = prev[productId] ?? defaultProductionEdit(productId);
      const latestMondayWindows = latest.windows.filter((window) => Number(window.dayOfWeek) === 1);
      if (latestMondayWindows.length === 0) return prev;

      const targetDays = new Set([2, 3, 4, 5]);
      const keptWindows = latest.windows.filter((window) => !targetDays.has(Number(window.dayOfWeek)));
      const copiedWindows = Array.from(targetDays).flatMap((dayOfWeek) =>
        latestMondayWindows.map((window) => ({
          ...window,
          id: null,
          dayOfWeek: String(dayOfWeek),
        }))
      );

      const windows = [...keptWindows, ...copiedWindows].sort((a, b) => {
        const dayCompare = Number(a.dayOfWeek) - Number(b.dayOfWeek);
        if (dayCompare !== 0) return dayCompare;
        if (a.startsAt !== b.startsAt) return a.startsAt.localeCompare(b.startsAt);
        return a.readyAt.localeCompare(b.readyAt);
      });

      return {
        ...prev,
        [productId]: {
          ...latest,
          windows,
        },
      };
    });
  }

  function agregarReglaProduccion(productId: number) {
    setProduccionEdit((prev) => {
      const current = prev[productId] ?? defaultProductionEdit(productId);
      return {
        ...prev,
        [productId]: {
          ...current,
          quantityRules: [
            ...current.quantityRules,
            {
              minQty: "0",
              maxQty: "",
              delayBusinessDays: "0",
              targetWindow: "NEXT_AVAILABLE",
              isActive: true,
            },
          ],
        },
      };
    });
  }

  function cambiarReglaProduccion(
    productId: number,
    index: number,
    field: keyof ProductionRuleEdit,
    value: string | boolean
  ) {
    setProduccionEdit((prev) => {
      const current = prev[productId] ?? defaultProductionEdit(productId);
      const quantityRules = [...current.quantityRules];
      quantityRules[index] = { ...quantityRules[index], [field]: value };
      return { ...prev, [productId]: { ...current, quantityRules } };
    });
  }

  function eliminarReglaProduccion(productId: number, index: number) {
    setProduccionEdit((prev) => {
      const current = prev[productId] ?? defaultProductionEdit(productId);
      return {
        ...prev,
        [productId]: {
          ...current,
          quantityRules: current.quantityRules.filter((_, i) => i !== index),
        },
      };
    });
  }

  async function guardarProduccion(productId: number) {
    if (sucursalId === null) return;

    const row = produccionEdit[productId] ?? defaultProductionEdit(productId);

    for (const window of row.windows) {
      const dayOfWeek = Number(window.dayOfWeek);
      if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
        setError("En ventanas: dia de semana debe estar entre 0 y 6.");
        return;
      }
      if (!/^\d{2}:\d{2}$/.test(window.startsAt) || !/^\d{2}:\d{2}$/.test(window.endsAt) || !/^\d{2}:\d{2}$/.test(window.readyAt)) {
        setError("En ventanas: las horas deben tener formato HH:mm.");
        return;
      }
      if (window.startsAt >= window.endsAt) {
        setError("En ventanas: hora inicio debe ser menor que hora fin.");
        return;
      }
      if (!esNumeroValido(window.capacityQty) || Number(normalizarNumero(window.capacityQty)) <= 0) {
        setError("En ventanas: capacidad debe ser mayor a 0.");
        return;
      }
    }

    for (const rule of row.quantityRules) {
      const delayBusinessDays = Number(rule.delayBusinessDays);
      if (!esNumeroValido(rule.minQty) || Number(normalizarNumero(rule.minQty)) < 0) {
        setError("En reglas: cantidad mínima debe ser número mayor o igual a 0.");
        return;
      }
      if (rule.maxQty.trim() !== "") {
        if (!esNumeroValido(rule.maxQty)) {
          setError("En reglas: cantidad máxima debe ser número o vacío.");
          return;
        }
        if (Number(normalizarNumero(rule.maxQty)) <= Number(normalizarNumero(rule.minQty))) {
          setError("En reglas: cantidad máxima debe ser mayor que cantidad mínima.");
          return;
        }
      }
      if (!Number.isInteger(delayBusinessDays) || delayBusinessDays < 0 || delayBusinessDays > 365) {
        setError("En reglas: días hábiles de atraso debe estar entre 0 y 365.");
        return;
      }
    }

    setGuardando(true);
    setError(null);
    try {
      await setProductionConfig(sucursalId, productId, {
        enabled: row.enabled,
        windows: row.windows.map((window) => ({
          id: window.id ?? null,
          dayOfWeek: Number(window.dayOfWeek),
          startsAt: window.startsAt,
          endsAt: window.endsAt,
          readyAt: window.readyAt,
          capacityQty: normalizarNumero(window.capacityQty),
          isActive: window.isActive,
        })),
        quantityRules: row.quantityRules.map((rule) => ({
          id: rule.id ?? null,
          minQty: normalizarNumero(rule.minQty),
          maxQty: rule.maxQty.trim() === "" ? null : normalizarNumero(rule.maxQty),
          delayBusinessDays: Number(rule.delayBusinessDays),
          targetWindow: rule.targetWindow,
          isActive: rule.isActive,
        })),
      });
      await cargarProductosDeSucursal(sucursalId);
    } catch (e: any) {
      setError(e?.message ?? "Error guardando configuración de producción");
    } finally {
      setGuardando(false);
    }
  }

  async function recargarInhabiles(branchId: number) {
    const data = await getProductionBlackoutDates({ branchId });
    setBlackoutDates(data.rows);
  }

  async function agregarInhabilProduccion() {
    if (sucursalId === null) return;
    if (!blackoutForm.date) {
      setError("Selecciona una fecha inhábil de producción.");
      return;
    }

    const productId = blackoutForm.scope === "PRODUCT" ? Number(blackoutForm.productId) : null;
    if (blackoutForm.scope === "PRODUCT" && (productId === null || !Number.isInteger(productId) || productId <= 0)) {
      setError("Selecciona un producto para el día inhábil por producto.");
      return;
    }

    setGuardando(true);
    setError(null);
    try {
      await createProductionBlackoutDate({
        branchId: blackoutForm.scope === "GLOBAL" ? null : sucursalId,
        productId,
        date: blackoutForm.date,
        reason: blackoutForm.reason.trim() ? blackoutForm.reason.trim() : null,
        isActive: blackoutForm.isActive,
      });
      setBlackoutForm({ scope: "BRANCH", date: "", productId: "", reason: "", isActive: true });
      await recargarInhabiles(sucursalId);
    } catch (e: any) {
      setError(e?.message ?? "Error guardando día inhábil");
    } finally {
      setGuardando(false);
    }
  }

  async function cambiarEstadoInhabil(row: ProductionBlackoutDate, isActive: boolean) {
    if (sucursalId === null) return;
    setGuardando(true);
    setError(null);
    try {
      await updateProductionBlackoutDate(row.id, { isActive });
      await recargarInhabiles(sucursalId);
    } catch (e: any) {
      setError(e?.message ?? "Error actualizando día inhábil");
    } finally {
      setGuardando(false);
    }
  }

  async function eliminarInhabil(row: ProductionBlackoutDate) {
    if (sucursalId === null) return;
    setGuardando(true);
    setError(null);
    try {
      await deleteProductionBlackoutDate(row.id);
      await recargarInhabiles(sucursalId);
    } catch (e: any) {
      setError(e?.message ?? "Error eliminando día inhábil");
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
                Gestiona precios base, precio especial de 0.5 por sucursal, precios por cantidad, precios por tamaño y matriz de precios por tamaño/cantidad para cada sucursal.
              </p>
            </div>
            <button
              onClick={() => nav('/orders')}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-gray-600 to-gray-700 hover:from-gray-700 hover:to-gray-800 text-white font-semibold rounded-xl transition-all duration-200 shadow-sm hover:shadow"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              Volver a Pedidos Activos
            </button>
          </div>

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
                    onChange={(e) => setFiltroEstado(e.target.value as FiltroEstado)}
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

        <div className="bg-white rounded-2xl border border-amber-200 shadow-sm p-6 mb-6">
          <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4 mb-5">
            <div className="flex items-start gap-3">
              <div className="p-2 bg-gradient-to-r from-amber-100 to-orange-100 rounded-lg">
                <Settings className="w-5 h-5 text-amber-700" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-gray-900">Días inhábiles de producción</h2>
                <p className="text-sm text-gray-500">
                  Un día inhábil se salta en el cálculo automático aunque existan ventanas configuradas.
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-5 gap-3 mb-5">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Fecha</label>
              <input
                type="date"
                value={blackoutForm.date}
                onChange={(e) => setBlackoutForm((prev) => ({ ...prev, date: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Alcance</label>
              <select
                value={blackoutForm.scope}
                onChange={(e) => setBlackoutForm((prev) => ({ ...prev, scope: e.target.value as BlackoutScope, productId: "" }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              >
                <option value="BRANCH">Sucursal actual</option>
                <option value="PRODUCT">Producto de sucursal</option>
                <option value="GLOBAL">Global</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Producto opcional</label>
              <select
                value={blackoutForm.productId}
                onChange={(e) => setBlackoutForm((prev) => ({ ...prev, productId: e.target.value }))}
                disabled={blackoutForm.scope !== "PRODUCT"}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg disabled:bg-gray-100 disabled:text-gray-500"
              >
                <option value="">Selecciona producto</option>
                {filas.map((row) => (
                  <option key={row.productId} value={row.productId}>
                    {row.product.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Motivo</label>
              <input
                value={blackoutForm.reason}
                onChange={(e) => setBlackoutForm((prev) => ({ ...prev, reason: e.target.value }))}
                placeholder="Feriado, mantenimiento..."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              />
            </div>

            <div className="flex items-end gap-3">
              <label className="flex items-center gap-2 text-sm text-gray-700 pb-2">
                <input
                  type="checkbox"
                  checked={blackoutForm.isActive}
                  onChange={(e) => setBlackoutForm((prev) => ({ ...prev, isActive: e.target.checked }))}
                  className="w-4 h-4 text-amber-600 border-gray-300 rounded"
                />
                Activo
              </label>
              <button
                type="button"
                onClick={agregarInhabilProduccion}
                disabled={guardando || !sucursalId}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-semibold disabled:opacity-50"
              >
                Agregar
              </button>
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-gray-200">
            <table className="w-full min-w-[760px]">
              <thead className="bg-gray-50">
                <tr>
                  <th className="py-3 px-3 text-left text-xs font-semibold text-gray-600">Fecha</th>
                  <th className="py-3 px-3 text-left text-xs font-semibold text-gray-600">Alcance</th>
                  <th className="py-3 px-3 text-left text-xs font-semibold text-gray-600">Motivo</th>
                  <th className="py-3 px-3 text-left text-xs font-semibold text-gray-600">Activo</th>
                  <th className="py-3 px-3 text-right text-xs font-semibold text-gray-600">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {blackoutDates.map((row) => (
                  <tr key={row.id}>
                    <td className="py-2 px-3 text-sm font-medium text-gray-900">{formatDateLabel(row.date)}</td>
                    <td className="py-2 px-3 text-sm text-gray-700">
                      {row.product
                        ? `${row.branch?.name ?? "Sucursal"} / ${row.product.name}`
                        : row.branch
                          ? row.branch.name
                          : "Global"}
                    </td>
                    <td className="py-2 px-3 text-sm text-gray-600">{row.reason || "—"}</td>
                    <td className="py-2 px-3">
                      <input
                        type="checkbox"
                        checked={row.isActive}
                        onChange={(e) => cambiarEstadoInhabil(row, e.target.checked)}
                        className="w-4 h-4 text-amber-600 border-gray-300 rounded"
                      />
                    </td>
                    <td className="py-2 px-3 text-right">
                      <button
                        type="button"
                        onClick={() => eliminarInhabil(row)}
                        className="px-3 py-1.5 bg-red-100 hover:bg-red-200 text-red-700 rounded-lg text-sm font-medium"
                      >
                        Eliminar
                      </button>
                    </td>
                  </tr>
                ))}
                {blackoutDates.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-gray-500">No hay días inhábiles configurados.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 shadow-lg overflow-hidden">
          {cargando ? (
            <div className="p-12 text-center">
              <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
              <p className="mt-4 text-gray-600">Cargando productos...</p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1180px]">
                  <thead>
                    <tr className="bg-gradient-to-r from-gray-50 to-gray-100 border-b border-gray-200">
                      <th className="py-4 px-6 text-left text-sm font-semibold text-gray-700">Producto</th>
                      <th className="py-4 px-6 text-left text-sm font-semibold text-gray-700">Unidad</th>
                      <th className="py-4 px-6 text-left text-sm font-semibold text-gray-700">Tamaños</th>
                      <th className="py-4 px-6 text-left text-sm font-semibold text-gray-700">Activo</th>
                      <th className="py-4 px-6 text-left text-sm font-semibold text-gray-700">Precio Base</th>
                      <th className="py-4 px-6 text-left text-sm font-semibold text-gray-700">Precio especial 0.5</th>
                      <th className="py-4 px-6 text-right text-sm font-semibold text-gray-700">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filasFiltradas.map((r) => {
                      const pid = r.productId;
                      const abiertoAhora = !!abierto[pid];
                      const tieneTamaños = r.product.needsVariant;
                      const productionConfig = produccionEdit[pid] ?? defaultProductionEdit(pid);

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
                            <td className="py-4 px-6">
                              {r.product.unitType === "METER" ? (
                                <div className="relative">
                                  <div className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400">$</div>
                                  <input
                                    value={halfStepSpecialPriceEdit[pid] ?? ""}
                                    onChange={(e) =>
                                      setHalfStepSpecialPriceEdit((m) => ({ ...m, [pid]: e.target.value }))
                                    }
                                    className="pl-8 pr-4 py-2 w-36 bg-gray-50 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200"
                                    placeholder="Vacío = sin especial"
                                  />
                                </div>
                              ) : (
                                <span className="text-sm text-gray-400">No aplica</span>
                              )}
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
                              <td colSpan={7} className="bg-gray-50 p-6 border-t border-gray-200">
                                <div className="space-y-6">
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

                                  <div className="bg-white rounded-xl border border-amber-200 p-6 shadow-sm">
                                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between mb-5">
                                      <div className="flex items-center gap-3">
                                        <div className="p-2 bg-gradient-to-r from-amber-100 to-orange-100 rounded-lg">
                                          <Settings className="w-5 h-5 text-amber-700" />
                                        </div>
                                        <div>
                                          <h3 className="font-bold text-lg text-gray-900">Producción y entrega estimada</h3>
                                          <p className="text-sm text-gray-500">
                                            Configura ventanas reales de capacidad y reglas especiales por cantidad. Los productos no se dividen automáticamente.
                                          </p>
                                        </div>
                                      </div>
                                      <button
                                        onClick={() => guardarProduccion(pid)}
                                        disabled={guardando}
                                        className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-700 hover:to-orange-700 text-white font-semibold rounded-lg transition-all duration-200 shadow-sm hover:shadow"
                                      >
                                        {guardando ? (
                                          <>
                                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                                            Guardando...
                                          </>
                                        ) : (
                                          <>
                                            <Save className="w-4 h-4" />
                                            Guardar producción
                                          </>
                                        )}
                                      </button>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                                      <label className="flex items-center gap-3 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2">
                                        <input
                                          type="checkbox"
                                          checked={productionConfig.enabled}
                                          onChange={(e) => cambiarProduccion(pid, "enabled", e.target.checked)}
                                          className="w-4 h-4 text-amber-600 border-gray-300 rounded focus:ring-amber-500"
                                        />
                                        <span className="text-sm font-semibold text-gray-700">Activar cálculo automático</span>
                                      </label>

                                      <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-600">
                                        Si una cantidad no cae en ninguna regla, se agenda en el próximo espacio disponible.
                                      </div>
                                    </div>

                                    <div className="space-y-6">
                                      <div className="rounded-xl border border-gray-200 overflow-hidden">
                                        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 bg-gray-50 px-4 py-3 border-b border-gray-200">
                                          <div>
                                            <h4 className="font-bold text-gray-900">Ventanas de producción</h4>
                                            <p className="text-xs text-gray-500">Capacidad por ventana dentro del día.</p>
                                          </div>
                                          <div className="flex flex-wrap gap-2">
                                            <button
                                              onClick={() => copiarLunesAViernes(pid)}
                                              className="px-4 py-2 bg-amber-100 hover:bg-amber-200 text-amber-900 rounded-lg border border-amber-200 font-medium"
                                            >
                                              Copiar lunes a viernes
                                            </button>
                                            <button
                                              onClick={() => agregarVentana(pid)}
                                              className="px-4 py-2 bg-white hover:bg-gray-100 text-gray-800 rounded-lg border border-gray-300 font-medium"
                                            >
                                              + Agregar ventana
                                            </button>
                                          </div>
                                        </div>
                                        <div className="overflow-x-auto">
                                          <table className="w-full min-w-[860px]">
                                            <thead className="bg-white">
                                              <tr>
                                                <th className="py-3 px-3 text-left text-xs font-semibold text-gray-600">Día</th>
                                                <th className="py-3 px-3 text-left text-xs font-semibold text-gray-600">Inicio</th>
                                                <th className="py-3 px-3 text-left text-xs font-semibold text-gray-600">Fin</th>
                                                <th className="py-3 px-3 text-left text-xs font-semibold text-gray-600">Listo / salida</th>
                                                <th className="py-3 px-3 text-left text-xs font-semibold text-gray-600">Capacidad</th>
                                                <th className="py-3 px-3 text-left text-xs font-semibold text-gray-600">Activa</th>
                                                <th className="py-3 px-3 text-right text-xs font-semibold text-gray-600">Acciones</th>
                                              </tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-100">
                                              {productionConfig.windows.map((window, idx) => (
                                                <tr key={window.id ?? idx}>
                                                  <td className="py-2 px-3">
                                                    <select
                                                      value={window.dayOfWeek}
                                                      onChange={(e) => cambiarVentana(pid, idx, "dayOfWeek", e.target.value)}
                                                      className="w-full px-2 py-2 border border-gray-300 rounded-lg"
                                                    >
                                                      {DIAS_SEMANA.map((dia, diaIdx) => (
                                                        <option key={diaIdx} value={String(diaIdx)}>{diaIdx} - {dia}</option>
                                                      ))}
                                                    </select>
                                                  </td>
                                                  <td className="py-2 px-3">
                                                    <input type="time" value={window.startsAt} onChange={(e) => cambiarVentana(pid, idx, "startsAt", e.target.value)} className="w-full px-2 py-2 border border-gray-300 rounded-lg" />
                                                  </td>
                                                  <td className="py-2 px-3">
                                                    <input type="time" value={window.endsAt} onChange={(e) => cambiarVentana(pid, idx, "endsAt", e.target.value)} className="w-full px-2 py-2 border border-gray-300 rounded-lg" />
                                                  </td>
                                                  <td className="py-2 px-3">
                                                    <input type="time" value={window.readyAt} onChange={(e) => cambiarVentana(pid, idx, "readyAt", e.target.value)} className="w-full px-2 py-2 border border-gray-300 rounded-lg" />
                                                  </td>
                                                  <td className="py-2 px-3">
                                                    <input value={window.capacityQty} onChange={(e) => cambiarVentana(pid, idx, "capacityQty", e.target.value)} className="w-full px-2 py-2 border border-gray-300 rounded-lg" placeholder="400" />
                                                  </td>
                                                  <td className="py-2 px-3">
                                                    <input type="checkbox" checked={window.isActive} onChange={(e) => cambiarVentana(pid, idx, "isActive", e.target.checked)} className="w-4 h-4 text-amber-600 border-gray-300 rounded" />
                                                  </td>
                                                  <td className="py-2 px-3 text-right">
                                                    <button onClick={() => eliminarVentana(pid, idx)} className="px-3 py-1.5 bg-red-100 hover:bg-red-200 text-red-700 rounded-lg text-sm font-medium">
                                                      Eliminar
                                                    </button>
                                                  </td>
                                                </tr>
                                              ))}
                                               {productionConfig.windows.length === 0 && (
                                                <tr>
                                                  <td colSpan={7} className="py-6 text-center text-gray-500">No hay ventanas configuradas.</td>
                                                </tr>
                                              )}
                                            </tbody>
                                          </table>
                                        </div>
                                      </div>

                                      <div className="rounded-xl border border-gray-200 overflow-hidden">
                                        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 bg-gray-50 px-4 py-3 border-b border-gray-200">
                                          <div>
                                            <h4 className="font-bold text-gray-900">Reglas especiales por cantidad</h4>
                                            <p className="text-xs text-gray-500">Si una cantidad no cae en ninguna regla, se agenda en el próximo espacio disponible.</p>
                                          </div>
                                          <button
                                            onClick={() => agregarReglaProduccion(pid)}
                                            className="px-4 py-2 bg-white hover:bg-gray-100 text-gray-800 rounded-lg border border-gray-300 font-medium"
                                          >
                                            + Agregar regla
                                          </button>
                                        </div>
                                        <div className="overflow-x-auto">
                                          <table className="w-full min-w-[860px]">
                                            <thead className="bg-white">
                                              <tr>
                                                <th className="py-3 px-3 text-left text-xs font-semibold text-gray-600">Cantidad mínima</th>
                                                <th className="py-3 px-3 text-left text-xs font-semibold text-gray-600">Cantidad máxima</th>
                                                <th className="py-3 px-3 text-left text-xs font-semibold text-gray-600">Retraso en días hábiles</th>
                                                <th className="py-3 px-3 text-left text-xs font-semibold text-gray-600">Ventana preferida</th>
                                                <th className="py-3 px-3 text-left text-xs font-semibold text-gray-600">Activa</th>
                                                <th className="py-3 px-3 text-right text-xs font-semibold text-gray-600">Acciones</th>
                                              </tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-100">
                                              {productionConfig.quantityRules.map((rule, idx) => (
                                                <tr key={rule.id ?? idx}>
                                                  <td className="py-2 px-3">
                                                    <input value={rule.minQty} onChange={(e) => cambiarReglaProduccion(pid, idx, "minQty", e.target.value)} className="w-full px-2 py-2 border border-gray-300 rounded-lg" placeholder="0" />
                                                  </td>
                                                  <td className="py-2 px-3">
                                                    <input value={rule.maxQty} onChange={(e) => cambiarReglaProduccion(pid, idx, "maxQty", e.target.value)} className="w-full px-2 py-2 border border-gray-300 rounded-lg" placeholder="Vacío = sin máximo" />
                                                  </td>
                                                  <td className="py-2 px-3">
                                                    <input type="number" min="0" max="365" value={rule.delayBusinessDays} onChange={(e) => cambiarReglaProduccion(pid, idx, "delayBusinessDays", e.target.value)} className="w-full px-2 py-2 border border-gray-300 rounded-lg" />
                                                  </td>
                                                  <td className="py-2 px-3">
                                                    <select value={rule.targetWindow} onChange={(e) => cambiarReglaProduccion(pid, idx, "targetWindow", e.target.value as ProductionTargetWindow)} className="w-full px-2 py-2 border border-gray-300 rounded-lg">
                                                      {TARGET_WINDOWS.map((target) => (
                                                        <option key={target} value={target}>{etiquetaVentanaObjetivo(target)}</option>
                                                      ))}
                                                    </select>
                                                  </td>
                                                  <td className="py-2 px-3">
                                                    <input type="checkbox" checked={rule.isActive} onChange={(e) => cambiarReglaProduccion(pid, idx, "isActive", e.target.checked)} className="w-4 h-4 text-amber-600 border-gray-300 rounded" />
                                                  </td>
                                                  <td className="py-2 px-3 text-right">
                                                    <button onClick={() => eliminarReglaProduccion(pid, idx)} className="px-3 py-1.5 bg-red-100 hover:bg-red-200 text-red-700 rounded-lg text-sm font-medium">
                                                      Eliminar
                                                    </button>
                                                  </td>
                                                </tr>
                                              ))}
                                              {productionConfig.quantityRules.length === 0 && (
                                                <tr>
                                                  <td colSpan={6} className="py-6 text-center text-gray-500">No hay reglas configuradas.</td>
                                                </tr>
                                              )}
                                            </tbody>
                                          </table>
                                        </div>
                                      </div>
                                    </div>
                                  </div>

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
                        <td colSpan={7} className="py-16 text-center">
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

              <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border-t border-gray-200 p-4">
                <div className="flex items-center gap-3">
                  <Info className="w-5 h-5 text-blue-600 flex-shrink-0" />
                  <div>
                    <p className="text-sm text-gray-700 font-medium">Consejo:</p>
                    <p className="text-sm text-gray-600">
                      El campo "Precio especial 0.5" es por sucursal. Si lo dejas vacío, no se guardará valor especial.
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
