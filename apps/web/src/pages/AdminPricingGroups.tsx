import { useEffect, useRef, useState } from "react";
import { Archive, Edit2, Layers, Plus, Trash2, X } from "lucide-react";
import {
  archivePricingGroup,
  createPricingGroup,
  deletePricingGroup,
  getPricingGroupProducts,
  getPricingGroups,
  updatePricingGroup,
  type PricingGroup,
  type PricingGroupProductOption,
} from "../api/pricingGroups";
import { ApiError } from "../api/http";
import PricingGroupModal, {
  type PricingGroupFormPayload,
} from "./components/PricingGroupModal";

type ModalState = { mode: "create" } | { mode: "edit"; group: PricingGroup };
type RemovalState = { group: PricingGroup; action: "delete" | "archive" };

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export default function AdminPricingGroups() {
  const [groups, setGroups] = useState<PricingGroup[]>([]);
  const [products, setProducts] = useState<PricingGroupProductOption[]>([]);
  const [modal, setModal] = useState<ModalState | null>(null);
  const [removal, setRemoval] = useState<RemovalState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);
  const [removalError, setRemovalError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const loadRequestId = useRef(0);

  async function load() {
    const requestId = ++loadRequestId.current;
    setLoading(true);
    setLoadError(null);
    try {
      const [groupData, productData] = await Promise.all([
        getPricingGroups(),
        getPricingGroupProducts(),
      ]);
      if (requestId !== loadRequestId.current) return null;
      setGroups(groupData.groups);
      setProducts(productData.products);
      return groupData.groups;
    } catch (error: unknown) {
      if (requestId === loadRequestId.current) {
        setLoadError(errorMessage(error, "No se pudieron cargar los grupos"));
      }
      return null;
    } finally {
      if (requestId === loadRequestId.current) setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!removal) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !removing) setRemoval(null);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [removal, removing]);

  function openCreate() {
    setModalError(null);
    setModal({ mode: "create" });
  }

  function openEdit(group: PricingGroup) {
    setModalError(null);
    setModal({ mode: "edit", group });
  }

  async function save(payload: PricingGroupFormPayload) {
    if (!modal || saving) return;
    setSaving(true);
    setModalError(null);
    try {
      if (modal.mode === "create") await createPricingGroup(payload);
      else await updatePricingGroup(modal.group.id, payload);
    } catch (error: unknown) {
      setModalError(errorMessage(error, "No se pudo guardar el grupo"));
      setSaving(false);
      return;
    }

    const message = modal.mode === "create" ? "Grupo creado correctamente" : "Grupo actualizado correctamente";
    setSaving(false);
    setModal(null);
    setNotice(message);
    await load();
  }

  function openRemoval(group: PricingGroup) {
    setRemovalError(null);
    setRemoval({
      group,
      action: group._count.appliedOrderItems === 0 ? "delete" : "archive",
    });
  }

  async function confirmRemoval() {
    if (!removal || removing) return;
    setRemoving(true);
    setRemovalError(null);

    if (removal.action === "archive") {
      try {
        await archivePricingGroup(removal.group.id);
        setRemoval(null);
        setNotice("Grupo archivado y productos liberados");
        await load();
      } catch (error: unknown) {
        setRemovalError(errorMessage(error, "No se pudo archivar el grupo"));
      } finally {
        setRemoving(false);
      }
      return;
    }

    try {
      await deletePricingGroup(removal.group.id);
      setRemoval(null);
      setNotice("Grupo eliminado definitivamente");
      await load();
    } catch (error: unknown) {
      if (error instanceof ApiError && error.code === "PRICING_GROUP_HAS_HISTORY") {
        const refreshedGroups = await load();
        const refreshedGroup = refreshedGroups?.find((group) => group.id === removal.group.id);
        setRemoval({
          group: refreshedGroup
            ? {
                ...refreshedGroup,
                _count: {
                  appliedOrderItems: Math.max(1, refreshedGroup._count.appliedOrderItems),
                },
              }
            : {
                ...removal.group,
                _count: { appliedOrderItems: Math.max(1, removal.group._count.appliedOrderItems) },
              },
          action: "archive",
        });
        setRemovalError("El grupo recibió historial recientemente. Confirma el archivado para continuar.");
      } else {
        setRemovalError(errorMessage(error, "No se pudo eliminar el grupo"));
      }
    } finally {
      setRemoving(false);
    }
  }

  return (
    <div className="p-4 sm:p-6">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-indigo-600">Administración</p>
            <h1 className="mt-1 text-3xl font-bold text-slate-950">Grupos de precios</h1>
            <p className="mt-2 text-slate-600">Administra grupos, productos asociados y disponibilidad.</p>
          </div>
          <button onClick={openCreate} className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-3 font-semibold text-white hover:bg-indigo-700">
            <Plus className="h-5 w-5" /> Crear grupo
          </button>
        </div>

        {notice && (
          <div className="mb-5 flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-800">
            <span>{notice}</span>
            <button type="button" onClick={() => setNotice(null)} aria-label="Cerrar notificación"><X className="h-4 w-4" /></button>
          </div>
        )}
        {loadError && (
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">
            <span>{loadError}</span>
            <button type="button" onClick={() => void load()} className="font-semibold underline">Reintentar</button>
          </div>
        )}

        <div className="grid gap-4">
          {loading && groups.length === 0 ? (
            <div className="rounded-2xl bg-white p-8 text-center text-slate-500">Cargando grupos...</div>
          ) : groups.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-slate-500">
              No hay grupos de precios configurados.
            </div>
          ) : groups.map((group) => (
            <article key={group.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex min-w-0 gap-3">
                  <div className="h-fit rounded-xl bg-indigo-100 p-3"><Layers className="h-5 w-5 text-indigo-700" /></div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-xl font-bold text-slate-900">{group.name}</h2>
                      <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${group.isActive ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-700"}`}>
                        {group.isActive ? "Activo" : "Inactivo"}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-slate-500">
                      {group.unitType === "PIECE" ? "Piezas" : "Metros"} · {group.products.length} productos · {group._count.appliedOrderItems} partidas históricas
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => openEdit(group)} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 font-semibold text-slate-700 hover:bg-slate-50">
                    <Edit2 className="h-4 w-4" /> Editar
                  </button>
                  <button
                    onClick={() => openRemoval(group)}
                    className={`inline-flex items-center gap-2 rounded-lg border px-4 py-2 font-semibold ${
                      group._count.appliedOrderItems === 0
                        ? "border-red-200 text-red-700 hover:bg-red-50"
                        : "border-amber-200 text-amber-800 hover:bg-amber-50"
                    }`}
                  >
                    {group._count.appliedOrderItems === 0 ? <Trash2 className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
                    {group._count.appliedOrderItems === 0 ? "Eliminar" : "Archivar"}
                  </button>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {group.products.map((product) => (
                  <span key={product.id} className="rounded-full bg-slate-100 px-3 py-1 text-sm font-medium text-slate-700">
                    {product.name}
                  </span>
                ))}
                {group.products.length === 0 && <span className="text-sm text-slate-400">Sin productos asignados</span>}
              </div>
            </article>
          ))}
        </div>
      </div>

      {modal && (
        <PricingGroupModal
          key={modal.mode === "create" ? "create" : `edit-${modal.group.id}`}
          group={modal.mode === "edit" ? modal.group : null}
          products={products}
          saving={saving}
          error={modalError}
          onClose={() => setModal(null)}
          onSubmit={(payload) => void save(payload)}
        />
      )}

      {removal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4" onMouseDown={(event) => event.target === event.currentTarget && !removing && setRemoval(null)}>
          <div role="alertdialog" aria-modal="true" aria-labelledby="remove-group-title" className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
            <h2 id="remove-group-title" className="text-xl font-bold text-slate-950">
              {removal.action === "delete" ? `¿Eliminar ${removal.group.name}?` : `¿Archivar ${removal.group.name}?`}
            </h2>
            {removal.action === "delete" ? (
              <p className="mt-3 text-slate-600">
                Este grupo nunca fue utilizado. Se eliminará definitivamente y se liberarán {removal.group.products.length} productos.
              </p>
            ) : (
              <p className="mt-3 text-slate-600">
                Este grupo aparece en {removal.group._count.appliedOrderItems} partidas históricas. Se conservará para mantener el historial y dejará de utilizarse en precios futuros.
              </p>
            )}
            {removalError && <div role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{removalError}</div>}
            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button type="button" onClick={() => setRemoval(null)} disabled={removing} className="rounded-xl border border-slate-300 px-4 py-2.5 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void confirmRemoval()}
                disabled={removing}
                className={`rounded-xl px-4 py-2.5 font-semibold text-white disabled:opacity-50 ${removal.action === "delete" ? "bg-red-600 hover:bg-red-700" : "bg-amber-600 hover:bg-amber-700"}`}
              >
                {removing ? "Procesando..." : removal.action === "delete" ? "Eliminar definitivamente" : "Archivar grupo"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
