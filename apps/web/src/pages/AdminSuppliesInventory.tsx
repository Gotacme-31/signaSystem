import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Search, X } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { adminGetBranches, type Branch } from "../api/adminBranches";
import { ApiError } from "../api/http";
import {
  adjustSupply,
  createSupply,
  deactivateSupply,
  getSupplyInventory,
  getSupplyMovements,
  reactivateSupply,
  removeSupply,
  restockSupply,
  updateSupply,
  type SupplyItem,
  type SupplyMovement,
  type SupplyMovementType,
  type SupplyMutationResult,
} from "../api/suppliesInventory";
import SupplyDialog from "../components/admin/supplies/SupplyDialog";
import SupplyInventoryTable, {
  type SupplyTableAction,
} from "../components/admin/supplies/SupplyInventoryTable";
import {
  filterSupplyItems,
  isLatestSupplyRequest,
  parseOptionalThreshold,
  parsePositiveId,
  parseStockInput,
  selectSupplyBranchId,
  signedSupplyQuantity,
  supplyMutationNotice,
  type SupplyFilter,
} from "../lib/suppliesInventory";

type FormType = "CREATE" | "RESTOCK" | "REMOVE" | "ADJUST" | "EDIT" | "DEACTIVATE" | "REACTIVATE";

type FormState = {
  type: FormType;
  item: SupplyItem | null;
  name: string;
  unitLabel: string;
  quantity: string;
  threshold: string;
  reason: string;
  operationKey: string;
};

type HistoryState = {
  item: SupplyItem;
  movements: SupplyMovement[];
  nextCursor: string | null;
  loading: boolean;
  error: string | null;
};

const FILTERS: Array<{ value: SupplyFilter; label: string }> = [
  { value: "ACTIVE", label: "Activos" },
  { value: "INACTIVE", label: "Inactivos" },
  { value: "LOW", label: "Stock bajo" },
  { value: "OUT", label: "Sin stock" },
];

const inputClass = "w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-100 disabled:text-slate-500";

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof ApiError) return error.message;
  return error instanceof Error ? error.message : fallback;
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

function formTitle(form: FormState) {
  if (form.type === "CREATE") return "Nuevo suministro";
  if (form.type === "RESTOCK") return "Reponer suministro";
  if (form.type === "REMOVE") return "Retirar suministro";
  if (form.type === "ADJUST") return "Ajustar conteo físico";
  if (form.type === "EDIT") return "Editar suministro";
  if (form.type === "DEACTIVATE") return "Desactivar suministro";
  return "Reactivar suministro";
}

function movementLabel(type: SupplyMovementType) {
  if (type === "INITIAL_STOCK") return "Stock inicial";
  if (type === "RESTOCK") return "Reposición";
  if (type === "MANUAL_REMOVE") return "Retiro manual";
  return "Ajuste físico";
}

function emptyForm(type: FormType, item: SupplyItem | null = null): FormState {
  return {
    type,
    item,
    name: item?.name ?? "",
    unitLabel: item?.unitLabel ?? "",
    quantity: type === "ADJUST" && item ? String(item.currentStock) : "",
    threshold: item?.lowStockThreshold === null || item?.lowStockThreshold === undefined
      ? ""
      : String(item.lowStockThreshold),
    reason: "",
    operationKey: type === "CREATE" || type === "RESTOCK" || type === "REMOVE" || type === "ADJUST"
      ? crypto.randomUUID()
      : "",
  };
}

export default function AdminSuppliesInventory() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchesLoading, setBranchesLoading] = useState(true);
  const [branchesError, setBranchesError] = useState<string | null>(null);
  const [branchesRefreshKey, setBranchesRefreshKey] = useState(0);
  const [branchId, setBranchId] = useState<number | null>(() => parsePositiveId(searchParams.get("branchId")));
  const [items, setItems] = useState<SupplyItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<SupplyFilter>("ACTIVE");
  const [form, setForm] = useState<FormState | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pendingItemId, setPendingItemId] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [history, setHistory] = useState<HistoryState | null>(null);
  const listRequestId = useRef(0);
  const historyRequestId = useRef(0);
  const historyAbort = useRef<AbortController | null>(null);
  const urlBranchId = parsePositiveId(searchParams.get("branchId"));

  const selectedBranch = branches.find((branch) => branch.id === branchId) ?? null;
  const visibleItems = useMemo(
    () => filterSupplyItems(items, query, filter),
    [filter, items, query]
  );

  useEffect(() => {
    const controller = new AbortController();
    setBranchesLoading(true);
    setBranchesError(null);
    adminGetBranches(controller.signal)
      .then((data) => {
        setBranches(data);
      })
      .catch((error: unknown) => {
        if (!isAbortError(error)) setBranchesError(errorMessage(error, "No se pudieron cargar las sucursales"));
      })
      .finally(() => {
        if (!controller.signal.aborted) setBranchesLoading(false);
      });
    return () => controller.abort();
  }, [branchesRefreshKey]);

  useEffect(() => {
    if (branchesLoading || branches.length === 0) return;
    const selected = selectSupplyBranchId(urlBranchId, branches);
    if (!selected) return;
    if (selected !== branchId) {
      historyAbort.current?.abort();
      historyRequestId.current += 1;
      listRequestId.current += 1;
      setBranchId(selected);
      setItems([]);
      setForm(null);
      setHistory(null);
      setNotice(null);
      setListError(null);
    }
    if (urlBranchId !== selected) {
      setSearchParams((current) => {
        const next = new URLSearchParams(current);
        next.set("branchId", String(selected));
        return next;
      }, { replace: true });
    }
  }, [branchId, branches, branchesLoading, setSearchParams, urlBranchId]);

  useEffect(() => {
    if (!branchId) {
      setItems([]);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    const requestId = ++listRequestId.current;
    const includeInactive = filter === "INACTIVE";
    queueMicrotask(() => {
      if (!controller.signal.aborted) {
        setLoading(true);
        setListError(null);
      }
    });
    getSupplyInventory(branchId, includeInactive, controller.signal)
      .then((response) => {
        if (!isLatestSupplyRequest(requestId, listRequestId.current)) return;
        setItems(response.supplies);
      })
      .catch((error: unknown) => {
        if (!isAbortError(error) && isLatestSupplyRequest(requestId, listRequestId.current)) {
          setItems([]);
          setListError(errorMessage(error, "No se pudo cargar el inventario de suministros"));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted && isLatestSupplyRequest(requestId, listRequestId.current)) {
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [branchId, filter, refreshKey]);

  function changeBranch(nextBranchId: number) {
    historyAbort.current?.abort();
    historyRequestId.current += 1;
    listRequestId.current += 1;
    setItems([]);
    setForm(null);
    setHistory(null);
    setNotice(null);
    setListError(null);
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set("branchId", String(nextBranchId));
      return next;
    }, { replace: true });
  }

  function openForm(type: FormType, item: SupplyItem | null = null) {
    setFormError(null);
    setForm(emptyForm(type, item));
  }

  async function loadHistory(item: SupplyItem, cursor: string | null, append: boolean) {
    historyAbort.current?.abort();
    const controller = new AbortController();
    historyAbort.current = controller;
    const requestId = ++historyRequestId.current;
    setHistory((current) => ({
      item,
      movements: append && current?.item.id === item.id ? current.movements : [],
      nextCursor: append && current?.item.id === item.id ? current.nextCursor : null,
      loading: true,
      error: null,
    }));
    try {
      const response = await getSupplyMovements(item.id, cursor, controller.signal);
      if (!isLatestSupplyRequest(requestId, historyRequestId.current)) return;
      setHistory((current) => ({
        item,
        movements: append && current?.item.id === item.id
          ? [...current.movements, ...response.movements]
          : response.movements,
        nextCursor: response.nextCursor,
        loading: false,
        error: null,
      }));
    } catch (error) {
      if (!isAbortError(error) && isLatestSupplyRequest(requestId, historyRequestId.current)) {
        setHistory((current) => current ? {
          ...current,
          loading: false,
          error: errorMessage(error, "No se pudo cargar el historial"),
        } : null);
      }
    }
  }

  function closeHistory() {
    historyAbort.current?.abort();
    historyRequestId.current += 1;
    setHistory(null);
  }

  function handleTableAction(action: SupplyTableAction, item: SupplyItem) {
    if (action === "HISTORY") {
      void loadHistory(item, null, false);
      return;
    }
    openForm(action, item);
  }

  async function submitForm() {
    if (!form || saving) return;
    setSaving(true);
    setPendingItemId(form.item?.id ?? null);
    setFormError(null);
    try {
      if (form.type === "CREATE") {
        if (!branchId) throw new Error("Selecciona una sucursal");
        if (!form.name.trim()) throw new Error("El nombre es obligatorio");
        if (!form.unitLabel.trim()) throw new Error("La presentación es obligatoria");
        const initialStock = parseStockInput(form.quantity, "Stock inicial", false);
        const lowStockThreshold = parseOptionalThreshold(form.threshold);
        await createSupply({
          branchId,
          name: form.name,
          unitLabel: form.unitLabel,
          initialStock,
          lowStockThreshold,
          operationKey: form.operationKey,
        });
        setNotice("Suministro creado correctamente.");
      } else if (form.type === "EDIT" && form.item) {
        if (!form.name.trim()) throw new Error("El nombre es obligatorio");
        if (!form.unitLabel.trim()) throw new Error("La presentación es obligatoria");
        await updateSupply(form.item.id, {
          name: form.name,
          lowStockThreshold: parseOptionalThreshold(form.threshold),
          ...(form.item.unitLabelEditable ? { unitLabel: form.unitLabel } : {}),
        });
        setNotice("Suministro actualizado correctamente.");
      } else if (form.type === "DEACTIVATE" && form.item) {
        await deactivateSupply(form.item.id);
        setNotice("Suministro desactivado; stock e historial conservados.");
      } else if (form.type === "REACTIVATE" && form.item) {
        await reactivateSupply(form.item.id);
        setNotice("Suministro reactivado con su stock anterior.");
      } else if (form.item) {
        let result: SupplyMutationResult;
        if (form.type === "RESTOCK") {
          result = await restockSupply(form.item.id, {
            quantity: parseStockInput(form.quantity, "Cantidad", true),
            reason: form.reason.trim() || null,
            operationKey: form.operationKey,
          });
        } else if (form.type === "REMOVE") {
          if (!form.reason.trim()) throw new Error("El motivo es obligatorio");
          result = await removeSupply(form.item.id, {
            quantity: parseStockInput(form.quantity, "Cantidad", true),
            reason: form.reason,
            operationKey: form.operationKey,
          });
        } else {
          if (!form.reason.trim()) throw new Error("El motivo es obligatorio");
          result = await adjustSupply(form.item.id, {
            targetStock: parseStockInput(form.quantity, "Nuevo conteo", false),
            expectedVersion: form.item.version,
            reason: form.reason,
            operationKey: form.operationKey,
          });
        }
        setNotice(supplyMutationNotice(result));
      }
      setForm(null);
      setRefreshKey((current) => current + 1);
    } catch (error) {
      setFormError(errorMessage(error, "No se pudo guardar la operación"));
    } finally {
      setSaving(false);
      setPendingItemId(null);
    }
  }

  const adjustmentTarget = form?.type === "ADJUST" && /^\d+$/.test(form.quantity.trim())
    ? Number(form.quantity)
    : null;
  const adjustmentDifference = form?.type === "ADJUST" && form.item && Number.isSafeInteger(adjustmentTarget)
    ? adjustmentTarget! - form.item.currentStock
    : null;

  return (
    <div className="min-h-[calc(100dvh-4rem)] bg-slate-50 p-4 sm:p-6">
      <div className="mx-auto max-w-7xl">
        <header className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.18em] text-indigo-600">Administración</p>
            <h1 className="mt-1 text-3xl font-black text-slate-950">Inventario de suministros</h1>
            <p className="mt-2 max-w-2xl text-slate-600">Control manual de materia prima y consumibles, independiente por sucursal.</p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <label className="min-w-64">
              <span className="mb-1 block text-sm font-semibold text-slate-700">Sucursal</span>
              <select
                value={branchId ?? ""}
                disabled={branchesLoading || saving || branches.length === 0}
                onChange={(event) => changeBranch(Number(event.target.value))}
                className={inputClass}
              >
                {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}{branch.isActive ? "" : " (inactiva)"}</option>)}
              </select>
            </label>
            <button
              type="button"
              onClick={() => openForm("CREATE")}
              disabled={!selectedBranch?.isActive || saving}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 py-3 font-bold text-white shadow-sm hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Plus className="h-5 w-5" /> Nuevo suministro
            </button>
          </div>
        </header>

        {notice && <div role="status" aria-live="polite" className="mb-4 flex items-start justify-between gap-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-800"><p>{notice}</p><button type="button" onClick={() => setNotice(null)} aria-label="Cerrar aviso"><X className="h-4 w-4" /></button></div>}
        {branchesError && <div role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-red-700"><p>{branchesError}</p><button type="button" onClick={() => setBranchesRefreshKey((current) => current + 1)} className="mt-2 font-bold underline">Reintentar</button></div>}
        {listError && <div role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-red-700"><p>{listError}</p><button type="button" onClick={() => setRefreshKey((current) => current + 1)} className="mt-2 font-bold underline">Reintentar</button></div>}
        {selectedBranch && !selectedBranch.isActive && <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-800">La sucursal está inactiva. Puedes consultar el catálogo, pero no crear ni reactivar suministros.</div>}

        <section className="mb-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <label className="relative flex-1">
              <span className="sr-only">Buscar suministros</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por nombre" className={`${inputClass} pl-10`} />
            </label>
            <div className="flex flex-wrap gap-2" aria-label="Filtros de suministros">
              {FILTERS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setFilter(option.value)}
                  aria-pressed={filter === option.value}
                  className={`rounded-lg px-3 py-2 text-sm font-semibold ${filter === option.value ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </section>

        <div aria-busy={branchesLoading || loading}>
          {branchesLoading || loading ? (
            <div role="status" aria-live="polite" className="rounded-2xl border border-slate-200 bg-white p-12 text-center text-slate-500">Cargando suministros...</div>
          ) : branchesError && branches.length === 0 ? null : branches.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center text-slate-500">No hay sucursales disponibles.</div>
          ) : visibleItems.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center"><p className="font-bold text-slate-800">No hay suministros que coincidan.</p><p className="mt-1 text-sm text-slate-500">Cambia el filtro o registra el primer suministro de esta sucursal.</p></div>
          ) : (
            <SupplyInventoryTable items={visibleItems} pendingItemId={pendingItemId} branchIsActive={selectedBranch?.isActive ?? false} onAction={handleTableAction} />
          )}
        </div>
      </div>

      {form && (
        <SupplyDialog
          title={formTitle(form)}
          description={form.item?.name ?? selectedBranch?.name}
          busy={saving}
          onClose={() => setForm(null)}
          onSubmit={() => void submitForm()}
          footer={(
            <>
              <button type="button" disabled={saving} onClick={() => setForm(null)} className="rounded-xl border border-slate-300 px-4 py-2.5 font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Cancelar</button>
              <button type="submit" disabled={saving} className={`rounded-xl px-5 py-2.5 font-bold text-white disabled:opacity-50 ${form.type === "DEACTIVATE" ? "bg-amber-600 hover:bg-amber-700" : "bg-indigo-600 hover:bg-indigo-700"}`}>{saving ? "Guardando..." : "Confirmar"}</button>
            </>
          )}
        >
          <fieldset disabled={saving} className="m-0 min-w-0 border-0 p-0">
          {(form.type === "CREATE" || form.type === "EDIT") && (
            <div className="space-y-4">
              <label className="block"><span className="mb-1 block text-sm font-bold text-slate-700">Nombre</span><input data-autofocus value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} maxLength={120} className={inputClass} /></label>
              <label className="block"><span className="mb-1 block text-sm font-bold text-slate-700">Presentación</span><input value={form.unitLabel} onChange={(event) => setForm({ ...form, unitLabel: event.target.value })} disabled={form.type === "EDIT" && !form.item?.unitLabelEditable} maxLength={40} placeholder="botella, bolsa, rollo..." className={inputClass} />{form.type === "EDIT" && !form.item?.unitLabelEditable && <p className="mt-1 text-xs text-slate-500">La presentación quedó fija al registrar el primer movimiento.</p>}</label>
              {form.type === "CREATE" && <label className="block"><span className="mb-1 block text-sm font-bold text-slate-700">Stock inicial</span><input type="number" min="0" step="1" value={form.quantity} onChange={(event) => setForm({ ...form, quantity: event.target.value })} className={inputClass} /></label>}
              <label className="block"><span className="mb-1 block text-sm font-bold text-slate-700">Stock mínimo <span className="font-normal text-slate-400">(opcional)</span></span><input type="number" min="0" step="1" value={form.threshold} onChange={(event) => setForm({ ...form, threshold: event.target.value })} className={inputClass} /></label>
            </div>
          )}

          {(form.type === "RESTOCK" || form.type === "REMOVE") && (
            <div className="space-y-4">
              <div className="rounded-xl bg-slate-100 p-4"><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Stock actual</p><p className="mt-1 text-3xl font-black text-slate-950">{form.item?.currentStock}</p></div>
              <label className="block"><span className="mb-1 block text-sm font-bold text-slate-700">Cantidad</span><input data-autofocus type="number" min="1" step="1" value={form.quantity} onChange={(event) => setForm({ ...form, quantity: event.target.value })} className={inputClass} /></label>
              <label className="block"><span className="mb-1 block text-sm font-bold text-slate-700">Motivo {form.type === "RESTOCK" && <span className="font-normal text-slate-400">(opcional)</span>}</span><textarea value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} maxLength={500} rows={3} className={inputClass} /></label>
            </div>
          )}

          {form.type === "ADJUST" && (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl bg-slate-100 p-4"><p className="text-xs font-bold uppercase text-slate-500">Stock sistema</p><p className="mt-1 text-2xl font-black">{form.item?.currentStock}</p></div>
                <div className="rounded-xl bg-indigo-50 p-4"><p className="text-xs font-bold uppercase text-indigo-600">Nuevo conteo</p><p className="mt-1 text-2xl font-black text-indigo-950">{adjustmentTarget ?? "—"}</p></div>
                <div className="rounded-xl bg-slate-950 p-4 text-white"><p className="text-xs font-bold uppercase text-slate-400">Diferencia</p><p className="mt-1 text-2xl font-black">{adjustmentDifference === null ? "—" : signedSupplyQuantity(adjustmentDifference)}</p></div>
              </div>
              <label className="block"><span className="mb-1 block text-sm font-bold text-slate-700">Stock físico actual</span><input data-autofocus type="number" min="0" step="1" value={form.quantity} onChange={(event) => setForm({ ...form, quantity: event.target.value })} className={inputClass} /></label>
              <label className="block"><span className="mb-1 block text-sm font-bold text-slate-700">Motivo</span><textarea value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} maxLength={500} rows={3} className={inputClass} /></label>
            </div>
          )}

          {form.type === "DEACTIVATE" && <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-900"><p className="font-bold">El suministro dejará de aparecer en el catálogo operativo.</p><p className="mt-1 text-sm">Se conservarán sus {form.item?.currentStock} unidades, versión e historial completo.</p></div>}
          {form.type === "REACTIVATE" && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-900"><p className="font-bold">Se recuperará el suministro en el catálogo operativo.</p><p className="mt-1 text-sm">El stock continuará exactamente en {form.item?.currentStock}.</p></div>}
          </fieldset>
          {formError && <div role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{formError}</div>}
        </SupplyDialog>
      )}

      {history && (
        <SupplyDialog title="Historial de movimientos" description={`${history.item.name} · ${history.item.unitLabel}`} onClose={closeHistory} size="lg">
          {history.error && <div role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-red-700"><p>{history.error}</p><button type="button" onClick={() => void loadHistory(history.item, history.nextCursor, history.movements.length > 0)} className="mt-2 font-bold underline">Reintentar</button></div>}
          {history.movements.length === 0 && !history.loading && !history.error ? (
            <p className="py-10 text-center text-slate-500">Este suministro todavía no tiene movimientos.</p>
          ) : (
            <div className="space-y-3">
              {history.movements.map((movement) => (
                <article key={movement.id} className="grid gap-3 rounded-xl border border-slate-200 p-4 sm:grid-cols-[1fr_auto]">
                  <div className="min-w-0"><p className="font-black text-slate-900">{movementLabel(movement.movementType)}</p><p className="mt-1 text-sm text-slate-500">{new Date(movement.createdAt).toLocaleString("es-MX")} · {movement.createdBy?.name ?? "Usuario eliminado"}</p>{movement.reason && <p className="mt-2 break-words text-sm text-slate-700">{movement.reason}</p>}</div>
                  <div className="text-left sm:text-right"><p className={`text-xl font-black ${movement.deltaQty < 0 ? "text-red-700" : "text-emerald-700"}`}>{signedSupplyQuantity(movement.deltaQty)}</p><p className="text-xs font-semibold text-slate-500">{movement.stockBefore} → {movement.stockAfter}</p></div>
                </article>
              ))}
            </div>
          )}
          {history.loading && <p role="status" aria-live="polite" className="py-6 text-center text-slate-500">Cargando movimientos...</p>}
          {history.nextCursor && !history.loading && <div className="mt-5 text-center"><button type="button" onClick={() => void loadHistory(history.item, history.nextCursor, true)} className="rounded-xl border border-slate-300 px-4 py-2.5 font-bold text-slate-700 hover:bg-slate-50">Cargar más</button></div>}
        </SupplyDialog>
      )}
    </div>
  );
}
