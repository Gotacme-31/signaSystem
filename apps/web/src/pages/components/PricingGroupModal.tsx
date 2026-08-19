import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { Check, Search, X } from "lucide-react";
import type {
  PricingGroup,
  PricingGroupProductOption,
  PricingGroupUnit,
} from "../../api/pricingGroups";
import {
  filterPricingGroupProducts,
  incompatibleProductIds,
  isProductOccupied,
  toggleProductId,
  uniqueProductIds,
} from "../../lib/pricingGroupForm";

export type PricingGroupFormPayload = {
  name: string;
  unitType: PricingGroupUnit;
  isActive: boolean;
  productIds: number[];
};

type PricingGroupModalProps = {
  group: PricingGroup | null;
  products: PricingGroupProductOption[];
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (payload: PricingGroupFormPayload) => void;
};

function initialPayload(group: PricingGroup | null): PricingGroupFormPayload {
  return group
    ? {
        name: group.name,
        unitType: group.unitType,
        isActive: group.isActive,
        productIds: group.products.map((product) => product.id),
      }
    : { name: "", unitType: "PIECE", isActive: true, productIds: [] };
}

function unitLabel(unitType: PricingGroupUnit) {
  return unitType === "PIECE" ? "Pieza" : "Metro";
}

export default function PricingGroupModal({
  group,
  products,
  saving,
  error,
  onClose,
  onSubmit,
}: PricingGroupModalProps) {
  const [initial] = useState(() => initialPayload(group));
  const [draft, setDraft] = useState<PricingGroupFormPayload>(initial);
  const [query, setQuery] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [pendingUnit, setPendingUnit] = useState<{
    unitType: PricingGroupUnit;
    incompatibleIds: number[];
  } | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  const selectedProducts = useMemo(() => {
    const selectedIds = new Set(draft.productIds);
    return products.filter((product) => selectedIds.has(product.id));
  }, [draft.productIds, products]);

  const visibleProducts = useMemo(
    () => filterPricingGroupProducts(products, draft.unitType, query),
    [draft.unitType, products, query]
  );

  const dirty = draft.name !== initial.name
    || draft.unitType !== initial.unitType
    || draft.isActive !== initial.isActive
    || uniqueProductIds(draft.productIds).sort((a, b) => a - b).join(",")
      !== uniqueProductIds(initial.productIds).sort((a, b) => a - b).join(",");

  function requestClose() {
    if (saving) return;
    if (dirty && !window.confirm("¿Descartar los cambios sin guardar?")) return;
    onClose();
  }

  const handleEscape = useEffectEvent(() => {
    if (pendingUnit) {
      setPendingUnit(null);
      return;
    }
    requestClose();
  });

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    nameRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") handleEscape();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  function selectUnit(unitType: PricingGroupUnit) {
    if (unitType === draft.unitType) return;
    const incompatibleIds = incompatibleProductIds(draft.productIds, products, unitType);
    if (incompatibleIds.length === 0) {
      setDraft((current) => ({ ...current, unitType }));
      return;
    }
    setPendingUnit({ unitType, incompatibleIds });
  }

  function confirmUnitChange() {
    if (!pendingUnit) return;
    const incompatibleIds = new Set(pendingUnit.incompatibleIds);
    setDraft((current) => ({
      ...current,
      unitType: pendingUnit.unitType,
      productIds: current.productIds.filter((id) => !incompatibleIds.has(id)),
    }));
    setPendingUnit(null);
  }

  function toggleProduct(product: PricingGroupProductOption) {
    if (isProductOccupied(product, group?.id ?? null) || saving) return;
    setDraft((current) => ({
      ...current,
      productIds: toggleProductId(current.productIds, product.id),
    }));
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;
    if (!draft.name.trim()) {
      setLocalError("Escribe un nombre para el grupo");
      return;
    }
    setLocalError(null);
    onSubmit({
      ...draft,
      name: draft.name.trim(),
      productIds: uniqueProductIds(draft.productIds),
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-3 sm:p-6"
      onMouseDown={(event) => event.target === event.currentTarget && requestClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="pricing-group-modal-title"
        className="flex max-h-[94dvh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 sm:px-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-indigo-600">
              {group ? `Grupo #${group.id}` : "Nuevo grupo"}
            </p>
            <h2 id="pricing-group-modal-title" className="mt-1 text-xl font-bold text-slate-950">
              {group ? "Editar grupo de precios" : "Crear grupo de precios"}
            </h2>
          </div>
          <button
            type="button"
            onClick={requestClose}
            disabled={saving}
            aria-label="Cerrar modal"
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <fieldset disabled={saving} className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_12rem]">
              <label>
                <span className="mb-1 block text-sm font-semibold text-slate-700">Nombre</span>
                <input
                  ref={nameRef}
                  value={draft.name}
                  onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
                  className="w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                />
              </label>
              <label>
                <span className="mb-1 block text-sm font-semibold text-slate-700">Unidad</span>
                <select
                  value={draft.unitType}
                  onChange={(event) => selectUnit(event.target.value as PricingGroupUnit)}
                  className="w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                >
                  <option value="PIECE">Pieza</option>
                  <option value="METER">Metro</option>
                </select>
              </label>
            </div>

            <label className="mt-4 flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <input
                type="checkbox"
                checked={draft.isActive}
                onChange={(event) => setDraft((current) => ({ ...current, isActive: event.target.checked }))}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600"
              />
              <span>
                <span className="block font-semibold text-slate-800">
                  {draft.isActive ? "Grupo activo" : "Grupo inactivo"}
                </span>
                <span className="mt-0.5 block text-sm text-slate-500">
                  Este control conserva el comportamiento actual del estado del grupo.
                </span>
              </span>
            </label>

            <section className="mt-6">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h3 className="font-bold text-slate-950">Productos</h3>
                  <p className="text-sm text-slate-500">
                    {draft.productIds.length} {draft.productIds.length === 1 ? "producto seleccionado" : "productos seleccionados"}
                  </p>
                </div>
                <label className="relative w-full sm:w-80">
                  <span className="sr-only">Buscar productos</span>
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Buscar por nombre o ID"
                    className="w-full rounded-xl border border-slate-300 py-2.5 pl-10 pr-4 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                  />
                </label>
              </div>

              <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
                <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Seleccionados</p>
                <div className="flex min-h-7 flex-wrap gap-2">
                  {selectedProducts.map((product) => (
                    <span key={product.id} className="inline-flex items-center gap-2 rounded-full bg-indigo-100 px-3 py-1.5 text-sm font-semibold text-indigo-900">
                      {product.name}
                      <button
                        type="button"
                        onClick={() => toggleProduct(product)}
                        aria-label={`Quitar ${product.name}`}
                        className="rounded-full p-0.5 hover:bg-indigo-200"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </span>
                  ))}
                  {selectedProducts.length === 0 && <span className="text-sm text-slate-400">Sin productos seleccionados</span>}
                </div>
              </div>

              <div className="mt-4 grid max-h-72 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
                {visibleProducts.map((product) => {
                  const occupied = isProductOccupied(product, group?.id ?? null);
                  const selected = draft.productIds.includes(product.id);
                  return (
                    <label
                      key={product.id}
                      className={`flex gap-3 rounded-xl border p-3 ${
                        occupied
                          ? "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-500"
                          : selected
                            ? "cursor-pointer border-indigo-400 bg-indigo-50 text-indigo-950"
                            : "cursor-pointer border-slate-200 bg-white text-slate-800 hover:border-slate-300"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selected}
                        disabled={occupied}
                        onChange={() => toggleProduct(product)}
                        className="mt-1 h-4 w-4 rounded border-slate-300 text-indigo-600"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-start justify-between gap-2">
                          <span className="font-semibold">{product.name}</span>
                          <span className="shrink-0 text-xs text-slate-400">#{product.id}</span>
                        </span>
                        <span className="mt-1 block text-xs">
                          {product.isActive ? "Activo" : "Inactivo"} · {unitLabel(product.unitType)}
                        </span>
                        <span className={`mt-1 block text-xs font-semibold ${occupied ? "text-amber-700" : "text-emerald-700"}`}>
                          {occupied ? `Pertenece a: ${product.pricingGroup?.name ?? "otro grupo"}` : "Disponible"}
                        </span>
                      </span>
                    </label>
                  );
                })}
                {visibleProducts.length === 0 && (
                  <div className="sm:col-span-2 rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
                    No hay productos que coincidan con la búsqueda para esta unidad.
                  </div>
                )}
              </div>
            </section>

            {(localError || error) && (
              <div role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-700">
                {localError || error}
              </div>
            )}
          </fieldset>

          <div className="flex flex-col-reverse gap-3 border-t border-slate-200 bg-white px-5 py-4 sm:flex-row sm:justify-end sm:px-6">
            <button
              type="button"
              onClick={requestClose}
              disabled={saving}
              className="rounded-xl border border-slate-300 px-5 py-2.5 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-xl bg-indigo-600 px-5 py-2.5 font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? "Guardando..." : "Guardar grupo"}
            </button>
          </div>
        </form>
      </div>

      {pendingUnit && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/60 p-4">
          <div role="alertdialog" aria-modal="true" aria-labelledby="unit-change-title" className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <h3 id="unit-change-title" className="text-lg font-bold text-slate-950">Confirmar cambio de unidad</h3>
            <p className="mt-3 text-slate-600">
              Cambiar a {unitLabel(pendingUnit.unitType)} quitará {pendingUnit.incompatibleIds.length}{" "}
              {pendingUnit.incompatibleIds.length === 1 ? "producto seleccionado" : "productos seleccionados"}.
            </p>
            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button type="button" onClick={() => setPendingUnit(null)} className="rounded-xl border border-slate-300 px-4 py-2.5 font-semibold text-slate-700 hover:bg-slate-50">
                Cancelar
              </button>
              <button type="button" onClick={confirmUnitChange} className="inline-flex items-center justify-center gap-2 rounded-xl bg-amber-600 px-4 py-2.5 font-semibold text-white hover:bg-amber-700">
                <Check className="h-4 w-4" /> Cambiar unidad
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
