import {
  Archive,
  ArchiveRestore,
  History,
  Minus,
  PackagePlus,
  Pencil,
  SlidersHorizontal,
} from "lucide-react";
import type { SupplyItem, SupplyStatus } from "../../../api/suppliesInventory";
import { supplyStatusLabel, titleCaseUnit } from "../../../lib/suppliesInventory";

export type SupplyTableAction =
  | "RESTOCK"
  | "REMOVE"
  | "ADJUST"
  | "HISTORY"
  | "EDIT"
  | "DEACTIVATE"
  | "REACTIVATE";

type SupplyInventoryTableProps = {
  items: SupplyItem[];
  pendingItemId: number | null;
  branchIsActive: boolean;
  onAction: (action: SupplyTableAction, item: SupplyItem) => void;
};

function statusClass(status: SupplyStatus) {
  if (status === "INACTIVE") return "bg-slate-200 text-slate-700";
  if (status === "OUT") return "bg-red-100 text-red-800";
  if (status === "LOW") return "bg-amber-100 text-amber-800";
  return "bg-emerald-100 text-emerald-800";
}

function StatusBadge({ status }: { status: SupplyStatus }) {
  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${statusClass(status)}`}>
      {supplyStatusLabel(status)}
    </span>
  );
}

function Actions({
  item,
  disabled,
  branchIsActive,
  onAction,
}: {
  item: SupplyItem;
  disabled: boolean;
  branchIsActive: boolean;
  onAction: SupplyInventoryTableProps["onAction"];
}) {
  const base = "inline-flex items-center gap-1 rounded-lg border px-2.5 py-2 text-xs font-bold transition disabled:cursor-not-allowed disabled:opacity-40";
  if (!item.isActive) {
    return (
      <>
        <button type="button" disabled={disabled || !branchIsActive} onClick={() => onAction("REACTIVATE", item)} className={`${base} border-emerald-200 text-emerald-700 hover:bg-emerald-50`}><ArchiveRestore className="h-3.5 w-3.5" /> Reactivar</button>
        <button type="button" disabled={disabled} onClick={() => onAction("EDIT", item)} className={`${base} border-slate-300 text-slate-700 hover:bg-slate-50`}><Pencil className="h-3.5 w-3.5" /> Editar</button>
        <button type="button" disabled={disabled} onClick={() => onAction("HISTORY", item)} className={`${base} border-slate-300 text-slate-700 hover:bg-slate-50`}><History className="h-3.5 w-3.5" /> Historial</button>
      </>
    );
  }
  return (
    <>
      <button type="button" disabled={disabled} onClick={() => onAction("RESTOCK", item)} className={`${base} border-emerald-200 text-emerald-700 hover:bg-emerald-50`}><PackagePlus className="h-3.5 w-3.5" /> Reponer</button>
      <button type="button" disabled={disabled} onClick={() => onAction("REMOVE", item)} className={`${base} border-red-200 text-red-700 hover:bg-red-50`}><Minus className="h-3.5 w-3.5" /> Retirar</button>
      <button type="button" disabled={disabled} onClick={() => onAction("ADJUST", item)} className={`${base} border-indigo-200 text-indigo-700 hover:bg-indigo-50`}><SlidersHorizontal className="h-3.5 w-3.5" /> Ajustar</button>
      <button type="button" disabled={disabled} onClick={() => onAction("HISTORY", item)} className={`${base} border-slate-300 text-slate-700 hover:bg-slate-50`}><History className="h-3.5 w-3.5" /> Historial</button>
      <button type="button" disabled={disabled} onClick={() => onAction("EDIT", item)} className={`${base} border-slate-300 text-slate-700 hover:bg-slate-50`}><Pencil className="h-3.5 w-3.5" /> Editar</button>
      <button type="button" disabled={disabled} onClick={() => onAction("DEACTIVATE", item)} className={`${base} border-amber-200 text-amber-800 hover:bg-amber-50`}><Archive className="h-3.5 w-3.5" /> Desactivar</button>
    </>
  );
}

export default function SupplyInventoryTable({ items, pendingItemId, branchIsActive, onAction }: SupplyInventoryTableProps) {
  return (
    <>
      <div className="hidden overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm md:block">
        <div className="overflow-x-auto">
          <table className="min-w-[980px] w-full divide-y divide-slate-200">
            <thead className="bg-slate-50 text-left text-xs font-bold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-3">Suministro</th>
                <th className="px-5 py-3">Presentación</th>
                <th className="px-5 py-3">Stock</th>
                <th className="px-5 py-3">Mínimo</th>
                <th className="px-5 py-3">Estado</th>
                <th className="px-5 py-3 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((item) => (
                <tr key={item.id} className={item.isActive ? "text-slate-800" : "bg-slate-50 text-slate-500"}>
                  <td className="px-5 py-4"><p className="break-words font-bold">{item.name}</p><p className="text-xs text-slate-400">#{item.id}</p></td>
                  <td className="break-words px-5 py-4 font-semibold">{titleCaseUnit(item.unitLabel)}</td>
                  <td className="px-5 py-4 text-xl font-black tabular-nums">{item.currentStock}</td>
                  <td className="px-5 py-4 tabular-nums">{item.lowStockThreshold ?? "—"}</td>
                  <td className="px-5 py-4"><StatusBadge status={item.status} /></td>
                  <td className="px-5 py-4"><div className="flex flex-wrap justify-end gap-2"><Actions item={item} disabled={pendingItemId === item.id} branchIsActive={branchIsActive} onAction={onAction} /></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="space-y-3 md:hidden">
        {items.map((item) => (
          <article key={item.id} className={`rounded-2xl border p-4 shadow-sm ${item.isActive ? "border-slate-200 bg-white" : "border-slate-200 bg-slate-100"}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0"><h2 className="break-words font-black text-slate-950">{item.name}</h2><p className="mt-1 break-words text-sm text-slate-500">{titleCaseUnit(item.unitLabel)} · mínimo {item.lowStockThreshold ?? "—"}</p></div>
              <StatusBadge status={item.status} />
            </div>
            <p className="mt-4 text-3xl font-black tabular-nums text-slate-950">{item.currentStock}</p>
            <p className="text-xs font-bold uppercase tracking-wide text-slate-400">En existencia</p>
            <div className="mt-4 flex flex-wrap gap-2"><Actions item={item} disabled={pendingItemId === item.id} branchIsActive={branchIsActive} onAction={onAction} /></div>
          </article>
        ))}
      </div>
    </>
  );
}
