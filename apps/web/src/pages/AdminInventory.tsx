import { useEffect, useMemo, useRef, useState } from "react";
import { ArchiveRestore, History, Minus, PackagePlus, Search, SlidersHorizontal, X } from "lucide-react";
import { getBranches, type Branch } from "../api/pricing";
import {
  activateInventory,
  adjustInventory,
  deactivateInventory,
  getAdminInventory,
  getInventoryMovements,
  initializeInventoryVariant,
  reactivateInventory,
  removeInventory,
  restockInventory,
  type AdminInventoryBalance,
  type AdminInventoryRow,
  type InventoryMovement,
  type InventoryTrackingMode,
} from "../api/inventory";
import { filterInventoryRows, isLatestInventoryRequest, signedQuantity, type InventoryFilter } from "../lib/inventory";

type ActionType = "ACTIVATE" | "REACTIVATE" | "RESTOCK" | "REMOVE" | "ADJUST" | "INITIALIZE";
type VariantDraft = { variantId: number; name: string; isActive: boolean; stock: string; threshold: string };
type ActionState = {
  type: ActionType;
  row: AdminInventoryRow;
  balance: AdminInventoryBalance | null;
  trackingMode: InventoryTrackingMode;
  quantity: string;
  threshold: string;
  reason: string;
  operationKey: string;
  variantQuery: string;
  variants: VariantDraft[];
};

const FILTERS: Array<{ value: InventoryFilter; label: string }> = [
  { value: "ALL", label: "Todos" },
  { value: "CONTROLLED", label: "Controlados" },
  { value: "UNCONTROLLED", label: "No controlados" },
  { value: "LOW", label: "Stock bajo" },
  { value: "OUT", label: "Sin stock" },
];

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function actionTitle(type: ActionType) {
  if (type === "ACTIVATE") return "Activar inventario";
  if (type === "REACTIVATE") return "Reactivar con conteo físico";
  if (type === "RESTOCK") return "Agregar stock";
  if (type === "REMOVE") return "Retirar stock";
  if (type === "INITIALIZE") return "Inicializar tamaño";
  return "Ajustar a conteo físico";
}

function statusLabel(status: "AVAILABLE" | "LOW" | "OUT") {
  return status === "OUT" ? "Sin stock" : status === "LOW" ? "Stock bajo" : "Disponible";
}

function statusClass(status: "AVAILABLE" | "LOW" | "OUT") {
  return status === "OUT"
    ? "bg-red-100 text-red-800"
    : status === "LOW"
      ? "bg-amber-100 text-amber-800"
      : "bg-emerald-100 text-emerald-800";
}

function variantDrafts(row: AdminInventoryRow) {
  const balances = new Map(
    (row.inventory?.balances ?? []).flatMap((balance) => balance.variantId ? [[balance.variantId, balance] as const] : [])
  );
  const variants = new Map(row.product.variants.map((variant) => [variant.id, variant]));
  for (const balance of row.inventory?.balances ?? []) {
    if (balance.variant) variants.set(balance.variant.id, balance.variant);
  }
  return [...variants.values()]
    .filter((variant) => variant.isActive || balances.has(variant.id))
    .sort((a, b) => a.order - b.order || a.id - b.id)
    .map((variant) => {
      const balance = balances.get(variant.id);
      return {
        variantId: variant.id,
        name: variant.name,
        isActive: variant.isActive,
        stock: balance ? String(balance.currentStock) : "",
        threshold: balance?.lowStockThreshold === null || balance?.lowStockThreshold === undefined
          ? ""
          : String(balance.lowStockThreshold),
      };
    });
}

export default function AdminInventory() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState<number | null>(null);
  const [rows, setRows] = useState<AdminInventoryRow[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<InventoryFilter>("ALL");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [action, setAction] = useState<ActionState | null>(null);
  const [detailRow, setDetailRow] = useState<AdminInventoryRow | null>(null);
  const [historyTitle, setHistoryTitle] = useState<string | null>(null);
  const [movements, setMovements] = useState<InventoryMovement[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const loadRequestId = useRef(0);
  const selectedBranchIdRef = useRef<number | null>(null);

  async function loadInventory(selectedBranchId: number) {
    const requestId = ++loadRequestId.current;
    setLoading(true);
    setError(null);
    try {
      const response = await getAdminInventory(selectedBranchId);
      if (!isLatestInventoryRequest(requestId, loadRequestId.current)) return;
      setRows(response.inventory);
      setDetailRow((current) => current
        ? response.inventory.find((row) => row.branchProductId === current.branchProductId) ?? null
        : null);
    } catch (loadError) {
      if (isLatestInventoryRequest(requestId, loadRequestId.current)) {
        setRows([]);
        setError(errorMessage(loadError, "No se pudo cargar el inventario"));
      }
    } finally {
      if (isLatestInventoryRequest(requestId, loadRequestId.current)) setLoading(false);
    }
  }

  useEffect(() => {
    void getBranches()
      .then((data) => {
        setBranches(data);
        const firstActive = data.find((branch) => branch.isActive) ?? data[0];
        selectedBranchIdRef.current = firstActive?.id ?? null;
        setBranchId(firstActive?.id ?? null);
      })
      .catch((loadError) => {
        setError(errorMessage(loadError, "No se pudieron cargar las sucursales"));
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    if (branchId) void loadInventory(branchId);
  }, [branchId]);

  const visibleRows = useMemo(
    () => filterInventoryRows(rows, query, filter),
    [filter, query, rows]
  );

  function baseAction(type: ActionType, row: AdminInventoryRow): ActionState {
    const recommendedMode: InventoryTrackingMode = row.product.variants.some((variant) => variant.isActive)
      ? "VARIANT"
      : "PRODUCT";
    return {
      type,
      row,
      balance: null,
      trackingMode: row.inventory?.trackingMode ?? recommendedMode,
      quantity: "",
      threshold: "",
      reason: "",
      operationKey: crypto.randomUUID(),
      variantQuery: "",
      variants: variantDrafts(row),
    };
  }

  function openActivation(row: AdminInventoryRow) {
    setError(null);
    setAction(baseAction("ACTIVATE", row));
  }

  function openReactivation(row: AdminInventoryRow) {
    const next = baseAction("REACTIVATE", row);
    const productBalance = row.inventory?.balances.find((balance) => balance.variantId === null);
    setError(null);
    setAction({
      ...next,
      quantity: productBalance ? String(productBalance.currentStock) : "",
      threshold: productBalance?.lowStockThreshold === null || productBalance?.lowStockThreshold === undefined
        ? ""
        : String(productBalance.lowStockThreshold),
    });
  }

  function openBalanceAction(type: "RESTOCK" | "REMOVE" | "ADJUST", row: AdminInventoryRow, balance: AdminInventoryBalance) {
    setError(null);
    setAction({
      ...baseAction(type, row),
      balance,
      trackingMode: row.inventory!.trackingMode,
      quantity: type === "ADJUST" ? String(balance.currentStock) : "",
      threshold: balance.lowStockThreshold === null ? "" : String(balance.lowStockThreshold),
    });
  }

  function openInitialize(row: AdminInventoryRow, variantId: number) {
    const next = baseAction("INITIALIZE", row);
    setError(null);
    setAction({
      ...next,
      variants: next.variants.filter((variant) => variant.variantId === variantId),
    });
  }

  function parsedVariantInputs(current: ActionState) {
    return current.variants.map((variant) => {
      if (!variant.stock.trim()) throw new Error(`Captura el stock de ${variant.name}`);
      const stock = Number(variant.stock);
      const threshold = variant.threshold.trim() ? Number(variant.threshold) : null;
      if (!Number.isSafeInteger(stock) || stock < 0) throw new Error(`Stock inválido para ${variant.name}`);
      if (threshold !== null && (!Number.isSafeInteger(threshold) || threshold < 0)) {
        throw new Error(`Umbral inválido para ${variant.name}`);
      }
      return { variantId: variant.variantId, stock, lowStockThreshold: threshold };
    });
  }

  async function submitAction() {
    if (!action || saving) return;
    setSaving(true);
    setError(null);
    const operationBranchId = branchId;
    try {
      if (action.type === "ACTIVATE") {
        if (action.trackingMode === "VARIANT") {
          await activateInventory({
            branchProductId: action.row.branchProductId,
            trackingMode: "VARIANT",
            variants: parsedVariantInputs(action).filter((variant) =>
              action.row.product.variants.find((candidate) => candidate.id === variant.variantId)?.isActive
            ),
            operationKey: action.operationKey,
          });
        } else {
          const initialStock = Number(action.quantity);
          const threshold = action.threshold.trim() ? Number(action.threshold) : null;
          if (!action.quantity.trim() || !Number.isSafeInteger(initialStock) || initialStock < 0) throw new Error("Captura un stock inicial entero");
          await activateInventory({
            branchProductId: action.row.branchProductId,
            trackingMode: "PRODUCT",
            initialStock,
            lowStockThreshold: threshold,
            operationKey: action.operationKey,
          });
        }
      } else if (action.type === "REACTIVATE") {
        if (action.trackingMode === "VARIANT") {
          await reactivateInventory(action.row.inventory!.configId, {
            trackingMode: "VARIANT",
            variants: parsedVariantInputs(action),
            operationKey: action.operationKey,
          });
        } else {
          const physicalStock = Number(action.quantity);
          const threshold = action.threshold.trim() ? Number(action.threshold) : null;
          if (!action.quantity.trim() || !Number.isSafeInteger(physicalStock) || physicalStock < 0) throw new Error("Captura un conteo físico entero");
          await reactivateInventory(action.row.inventory!.configId, {
            trackingMode: "PRODUCT",
            physicalStock,
            lowStockThreshold: threshold,
            operationKey: action.operationKey,
          });
        }
      } else if (action.type === "INITIALIZE") {
        const variant = parsedVariantInputs(action)[0];
        await initializeInventoryVariant(action.row.inventory!.configId, variant.variantId, {
          initialStock: variant.stock,
          lowStockThreshold: variant.lowStockThreshold,
          operationKey: action.operationKey,
        });
      } else {
        if (!action.balance || !action.quantity.trim()) throw new Error("Captura una cantidad");
        const quantity = Number(action.quantity);
        if (!Number.isSafeInteger(quantity) || quantity < (action.type === "ADJUST" ? 0 : 1)) throw new Error("Cantidad inválida");
        if ((action.type === "REMOVE" || action.type === "ADJUST") && !action.reason.trim()) throw new Error("El motivo es obligatorio");
        if (action.type === "RESTOCK") {
          await restockInventory(action.balance.balanceId, { quantity, reason: action.reason.trim() || null, operationKey: action.operationKey });
        } else if (action.type === "REMOVE") {
          await removeInventory(action.balance.balanceId, { quantity, reason: action.reason, operationKey: action.operationKey });
        } else {
          await adjustInventory(action.balance.balanceId, { targetStock: quantity, reason: action.reason, operationKey: action.operationKey });
        }
      }
      setAction(null);
      setNotice("Inventario actualizado correctamente");
      if (operationBranchId && selectedBranchIdRef.current === operationBranchId) await loadInventory(operationBranchId);
    } catch (saveError) {
      setError(errorMessage(saveError, "No se pudo actualizar el inventario"));
    } finally {
      setSaving(false);
    }
  }

  async function disable(row: AdminInventoryRow) {
    if (!row.inventory || !window.confirm(`¿Desactivar inventario para ${row.product.name}?`)) return;
    setSaving(true);
    setError(null);
    const operationBranchId = branchId;
    try {
      await deactivateInventory(row.inventory.configId);
      setNotice("Inventario desactivado; balances e historial conservados");
      if (operationBranchId && selectedBranchIdRef.current === operationBranchId) await loadInventory(operationBranchId);
    } catch (saveError) {
      setError(errorMessage(saveError, "No se pudo desactivar el inventario"));
    } finally {
      setSaving(false);
    }
  }

  async function openHistory(row: AdminInventoryRow, balance?: AdminInventoryBalance) {
    if (!row.inventory) return;
    const selectedBalances = balance ? [balance] : row.inventory.balances;
    setHistoryTitle(balance?.variant ? `${row.product.name} · ${balance.variant.name}` : row.product.name);
    setMovements([]);
    setHistoryLoading(true);
    setError(null);
    try {
      const responses = await Promise.all(selectedBalances.map((candidate) => getInventoryMovements(candidate.balanceId)));
      setMovements(responses.flatMap((response) => response.movements).sort(
        (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
      ));
    } catch (loadError) {
      setError(errorMessage(loadError, "No se pudo cargar el historial"));
    } finally {
      setHistoryLoading(false);
    }
  }

  const actionVariants = action?.variants.filter((variant) =>
    variant.name.toLocaleLowerCase("es").includes(action.variantQuery.trim().toLocaleLowerCase("es"))
  ) ?? [];

  return (
    <div className="p-4 sm:p-6">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div><p className="text-sm font-bold uppercase tracking-[0.18em] text-indigo-600">Administración</p><h1 className="mt-1 text-3xl font-black text-slate-950">Inventario</h1><p className="mt-2 text-slate-600">Existencias por producto o tamaño, independientes por sucursal.</p></div>
          <label className="min-w-64"><span className="mb-1 block text-sm font-semibold text-slate-700">Sucursal</span><select value={branchId ?? ""} disabled={saving} onChange={(event) => { selectedBranchIdRef.current = Number(event.target.value); setRows([]); setDetailRow(null); setBranchId(Number(event.target.value)); }} className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3">{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}{branch.isActive ? "" : " (inactiva)"}</option>)}</select></label>
        </div>
        {notice && <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-800">{notice}</div>}
        {error && <div role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">{error}</div>}
        <div className="mb-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex flex-col gap-3 lg:flex-row lg:items-center"><label className="relative flex-1"><span className="sr-only">Buscar inventario</span><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por nombre o ID" className="w-full rounded-xl border border-slate-300 py-2.5 pl-10 pr-4" /></label><div className="flex flex-wrap gap-2">{FILTERS.map((option) => <button key={option.value} type="button" onClick={() => setFilter(option.value)} aria-pressed={filter === option.value} className={`rounded-lg px-3 py-2 text-sm font-semibold ${filter === option.value ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}>{option.label}</button>)}</div></div></div>
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="overflow-x-auto"><table className="min-w-full divide-y divide-slate-200"><thead className="bg-slate-50 text-left text-xs font-bold uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-3">Producto</th><th className="px-5 py-3">Control</th><th className="px-5 py-3">Stock total</th><th className="px-5 py-3">Estado</th><th className="px-5 py-3">Último movimiento</th><th className="px-5 py-3 text-right">Acciones</th></tr></thead><tbody className="divide-y divide-slate-100">
          {visibleRows.map((row) => {
            const inventory = row.inventory;
            const productBalance = inventory?.balances.find((balance) => balance.variantId === null);
            return <tr key={row.branchProductId} className="text-slate-800">
              <td className="px-5 py-4"><p className="font-bold">{row.product.name}</p><p className="text-xs text-slate-400">#{row.product.id}</p></td>
              <td className="px-5 py-4 text-sm font-semibold">{inventory?.trackingMode === "VARIANT" ? "Por tamaño" : inventory ? "Por producto" : "—"}</td>
              <td className="px-5 py-4 text-lg font-black">{inventory ? inventory.currentStock : "—"}</td>
              <td className="px-5 py-4">{!inventory ? <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600">No controlado</span> : !inventory.enabled ? <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-800">Desactivado</span> : <><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${statusClass(inventory.status)}`}>{statusLabel(inventory.status)}</span>{inventory.trackingMode === "VARIANT" && inventory.lowVariantCount > 0 && <p className="mt-1 text-xs text-amber-700">{inventory.lowVariantCount} tamaño(s) con stock bajo</p>}</>}</td>
              <td className="px-5 py-4 text-sm text-slate-500">{inventory?.lastMovement ? `${inventory.lastMovement.movementType} · ${new Date(inventory.lastMovement.createdAt).toLocaleDateString("es-MX")}` : "—"}</td>
              <td className="px-5 py-4"><div className="flex flex-wrap justify-end gap-2">
                {!inventory && <button type="button" onClick={() => openActivation(row)} disabled={saving || !Number.isInteger(Number(row.product.minQty)) || !Number.isInteger(Number(row.product.qtyStep))} className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40">Activar</button>}
                {inventory && !inventory.enabled && <button type="button" onClick={() => openReactivation(row)} disabled={saving} className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40"><ArchiveRestore className="h-4 w-4" /> Reactivar</button>}
                {inventory?.enabled && inventory.trackingMode === "PRODUCT" && productBalance && <><button type="button" onClick={() => openBalanceAction("RESTOCK", row, productBalance)} className="rounded-lg border border-emerald-200 px-3 py-2 text-sm font-semibold text-emerald-700"><PackagePlus className="inline h-4 w-4" /> Agregar</button><button type="button" onClick={() => openBalanceAction("REMOVE", row, productBalance)} className="rounded-lg border border-red-200 px-3 py-2 text-sm font-semibold text-red-700"><Minus className="inline h-4 w-4" /> Retirar</button><button type="button" onClick={() => openBalanceAction("ADJUST", row, productBalance)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold"><SlidersHorizontal className="inline h-4 w-4" /> Ajustar</button></>}
                {inventory?.trackingMode === "VARIANT" && <button type="button" onClick={() => setDetailRow(row)} className="rounded-lg border border-indigo-200 px-3 py-2 text-sm font-semibold text-indigo-700">Ver tamaños</button>}
                {inventory?.enabled && <button type="button" onClick={() => void disable(row)} className="rounded-lg border border-amber-200 px-3 py-2 text-sm font-semibold text-amber-800">Desactivar</button>}
                {inventory && <button type="button" onClick={() => void openHistory(row)} className="rounded-lg border border-slate-300 p-2 text-slate-600" aria-label={`Ver historial de ${row.product.name}`}><History className="h-4 w-4" /></button>}
              </div></td>
            </tr>;
          })}
        </tbody></table></div>{!loading && visibleRows.length === 0 && <div className="p-10 text-center text-slate-500">No hay productos que coincidan.</div>}{loading && <div className="p-10 text-center text-slate-500">Cargando inventario...</div>}</div>
      </div>

      {detailRow?.inventory?.trackingMode === "VARIANT" && <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/60 p-3 sm:p-6"><div role="dialog" aria-modal="true" aria-labelledby="variant-detail-title" className="flex max-h-[92dvh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"><div className="flex items-start justify-between border-b p-5"><div><h2 id="variant-detail-title" className="text-xl font-black">{detailRow.product.name}</h2><p className="text-sm text-slate-500">Stock total derivado: {detailRow.inventory.currentStock}</p></div><button type="button" onClick={() => setDetailRow(null)} aria-label="Cerrar"><X className="h-5 w-5" /></button></div><div className="overflow-y-auto p-5"><div className="space-y-3">{detailRow.inventory.balances.map((balance) => <article key={balance.balanceId} className={`rounded-xl border p-4 ${balance.variant?.isActive === false ? "bg-slate-50 opacity-70" : "bg-white"}`}><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-bold">{balance.variant?.name ?? `Variante #${balance.variantId}`}</p><p className="text-sm text-slate-500">Stock {balance.currentStock} · Umbral {balance.lowStockThreshold ?? "—"} · {balance.variant?.isActive === false ? "Inactivo" : statusLabel(balance.status)}</p></div><div className="flex flex-wrap gap-2">{detailRow.inventory!.enabled && balance.variant?.isActive !== false && <><button type="button" onClick={() => openBalanceAction("RESTOCK", detailRow, balance)} className="rounded-lg border px-3 py-2 text-sm">Agregar</button><button type="button" onClick={() => openBalanceAction("REMOVE", detailRow, balance)} className="rounded-lg border px-3 py-2 text-sm">Retirar</button><button type="button" onClick={() => openBalanceAction("ADJUST", detailRow, balance)} className="rounded-lg border px-3 py-2 text-sm">Ajustar</button></>}<button type="button" onClick={() => void openHistory(detailRow, balance)} className="rounded-lg border p-2"><History className="h-4 w-4" /></button></div></div></article>)}{detailRow.inventory.uninitializedVariants.map((variant) => <article key={variant.id} className="rounded-xl border border-dashed border-amber-300 bg-amber-50 p-4"><div className="flex items-center justify-between gap-3"><div><p className="font-bold">{variant.name}</p><p className="text-sm text-amber-800">Inventario sin inicializar</p></div>{detailRow.inventory!.enabled && <button type="button" onClick={() => openInitialize(detailRow, variant.id)} className="rounded-lg bg-amber-600 px-3 py-2 text-sm font-semibold text-white">Inicializar tamaño</button>}</div></article>)}</div></div></div></div>}

      {action && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-3 sm:p-6"><div role="dialog" aria-modal="true" aria-labelledby="inventory-action-title" className="flex max-h-[94dvh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"><div className="flex items-start justify-between border-b p-5"><div><h2 id="inventory-action-title" className="text-xl font-black">{actionTitle(action.type)}</h2><p className="text-sm text-slate-500">{action.row.product.name}{action.balance?.variant ? ` · ${action.balance.variant.name}` : ""}</p></div><button type="button" onClick={() => setAction(null)} disabled={saving} aria-label="Cerrar"><X className="h-5 w-5" /></button></div><div className="overflow-y-auto p-5">
        {action.type === "ACTIVATE" && action.row.product.variants.some((variant) => variant.isActive) && <fieldset className="mb-5"><legend className="mb-2 text-sm font-bold">Control de inventario</legend><div className="grid gap-2 sm:grid-cols-2"><label className="rounded-xl border p-3"><input type="radio" checked={action.trackingMode === "PRODUCT"} onChange={() => setAction({ ...action, trackingMode: "PRODUCT" })} /> <span className="font-semibold">Por producto</span></label><label className="rounded-xl border border-indigo-300 bg-indigo-50 p-3"><input type="radio" checked={action.trackingMode === "VARIANT"} onChange={() => setAction({ ...action, trackingMode: "VARIANT" })} /> <span className="font-semibold">Por tamaño / variante</span><span className="ml-2 text-xs text-indigo-700">Recomendado</span></label></div></fieldset>}
        {(action.type === "ACTIVATE" || action.type === "REACTIVATE") && action.trackingMode === "VARIANT" || action.type === "INITIALIZE" ? <div><label className="relative mb-4 block"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input value={action.variantQuery} onChange={(event) => setAction({ ...action, variantQuery: event.target.value })} placeholder="Buscar tamaño" className="w-full rounded-xl border py-2.5 pl-10 pr-4" /></label><div className="max-h-[55dvh] space-y-3 overflow-y-auto pr-1">{actionVariants.map((variant) => <div key={variant.variantId} className={`rounded-xl border p-4 ${variant.isActive ? "bg-white" : "bg-slate-50"}`}><p className="mb-3 font-bold">{variant.name}{variant.isActive ? "" : " · Inactivo"}</p><div className="grid gap-3 sm:grid-cols-2"><label><span className="mb-1 block text-xs font-semibold">Stock físico</span><input type="number" min="0" step="1" value={variant.stock} onChange={(event) => setAction({ ...action, variants: action.variants.map((candidate) => candidate.variantId === variant.variantId ? { ...candidate, stock: event.target.value } : candidate) })} className="w-full rounded-lg border px-3 py-2" /></label><label><span className="mb-1 block text-xs font-semibold">Umbral (opcional)</span><input type="number" min="0" step="1" value={variant.threshold} onChange={(event) => setAction({ ...action, variants: action.variants.map((candidate) => candidate.variantId === variant.variantId ? { ...candidate, threshold: event.target.value } : candidate) })} className="w-full rounded-lg border px-3 py-2" /></label></div></div>)}</div></div> : <><label className="block"><span className="mb-1 block text-sm font-semibold">{action.type === "ACTIVATE" ? "Stock físico inicial" : action.type === "REACTIVATE" || action.type === "ADJUST" ? "Conteo físico final" : "Cantidad"}</span><input type="number" min="0" step="1" value={action.quantity} onChange={(event) => setAction({ ...action, quantity: event.target.value })} className="w-full rounded-xl border px-4 py-3" /></label>{(action.type === "ACTIVATE" || action.type === "REACTIVATE") && <label className="mt-4 block"><span className="mb-1 block text-sm font-semibold">Umbral de stock bajo</span><input type="number" min="0" step="1" value={action.threshold} onChange={(event) => setAction({ ...action, threshold: event.target.value })} className="w-full rounded-xl border px-4 py-3" /></label>}</>}
        {(action.type === "RESTOCK" || action.type === "REMOVE" || action.type === "ADJUST") && <label className="mt-4 block"><span className="mb-1 block text-sm font-semibold">Motivo {action.type === "RESTOCK" ? "(opcional)" : ""}</span><textarea value={action.reason} onChange={(event) => setAction({ ...action, reason: event.target.value })} rows={3} className="w-full rounded-xl border px-4 py-3" /></label>}{error && <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}</div><div className="flex justify-end gap-3 border-t p-4"><button type="button" onClick={() => setAction(null)} disabled={saving} className="rounded-xl border px-4 py-2.5 font-semibold">Cancelar</button><button type="button" onClick={() => void submitAction()} disabled={saving} className="rounded-xl bg-indigo-600 px-4 py-2.5 font-semibold text-white disabled:opacity-50">{saving ? "Guardando..." : "Confirmar"}</button></div></div></div>}

      {historyTitle && <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/60 p-4"><div role="dialog" aria-modal="true" aria-labelledby="inventory-history-title" className="max-h-[90dvh] w-full max-w-3xl overflow-hidden rounded-2xl bg-white shadow-2xl"><div className="flex items-start justify-between border-b p-5"><div><h2 id="inventory-history-title" className="text-xl font-black">Historial de movimientos</h2><p className="text-sm text-slate-500">{historyTitle}</p></div><button type="button" onClick={() => setHistoryTitle(null)}><X className="h-5 w-5" /></button></div><div className="max-h-[70dvh] overflow-y-auto p-5">{historyLoading ? <p className="text-center text-slate-500">Cargando...</p> : movements.length === 0 ? <p className="text-center text-slate-500">Sin movimientos.</p> : <div className="space-y-3">{movements.map((movement) => <article key={movement.id} className="grid gap-2 rounded-xl border p-4 sm:grid-cols-[1fr_auto]"><div><p className="font-bold">{movement.movementType}{movement.orderId ? ` · Pedido #${movement.orderId}` : ""}</p><p className="text-sm text-slate-500">{new Date(movement.createdAt).toLocaleString("es-MX")} · {movement.createdBy?.name ?? "Sistema"}</p>{movement.reason && <p className="text-sm">{movement.reason}</p>}</div><div className="text-right"><p className={`text-lg font-black ${movement.deltaQty < 0 ? "text-red-700" : "text-emerald-700"}`}>{signedQuantity(movement.deltaQty)}</p><p className="text-xs text-slate-500">{movement.stockBefore} → {movement.stockAfter}</p></div></article>)}</div>}</div></div></div>}
    </div>
  );
}
