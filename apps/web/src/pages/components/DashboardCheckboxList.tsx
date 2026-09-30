import { Loader2 } from "lucide-react";
import type { ComponentType } from "react";
import {
  dashboardSelectionIncludes,
  dashboardSelectionIsAll,
  dashboardSelectionSummary,
  toggleAllDashboardSelection,
  toggleDashboardSelection,
  type DashboardSelection,
} from "../../lib/dashboardFilters";

export const DashboardCheckboxList = ({
  title,
  items,
  selected,
  onChange,
  label,
  icon: Icon,
  loading = false,
  error = null,
  onRetry,
  loadingLabel = "Cargando productos...",
  emptyLabel = "No hay opciones disponibles",
}: {
  title: string;
  items: Array<{ id: number; isActive?: boolean }>;
  selected: DashboardSelection;
  onChange: (ids: DashboardSelection) => void;
  label: (it: any) => string;
  icon?: ComponentType<{ className?: string }>;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  loadingLabel?: string;
  emptyLabel?: string;
}) => {
  const allIds = items.map((item) => item.id);
  const allSelected = dashboardSelectionIsAll(allIds, selected);
  const toggleOne = (id: number) => onChange(toggleDashboardSelection(allIds, selected, id));

  return (
    <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {Icon && <Icon className="w-4 h-4 text-gray-600" />}
          <span className="font-semibold text-gray-900">{title}</span>
          <span className="text-xs bg-gray-200 text-gray-700 px-2 py-0.5 rounded-full">
            {dashboardSelectionSummary(allIds, selected)}
          </span>
        </div>
        <button
          type="button"
          onClick={() => onChange(toggleAllDashboardSelection(allIds, selected))}
          className="text-xs text-blue-700 hover:text-blue-900 font-medium"
        >
          {allSelected ? "Deseleccionar todos" : "Seleccionar todos"}
        </button>
      </div>
      <div className="max-h-48 overflow-y-auto space-y-2 pr-1 scrollbar-thin scrollbar-thumb-gray-300">
        {loading && (
          <div className="flex items-center justify-center gap-2 py-2 text-sm text-blue-700">
            <Loader2 className="h-4 w-4 animate-spin" />
            {loadingLabel}
          </div>
        )}
        {error && (
          <div className="flex items-center justify-between gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
            <span>{error}</span>
            {onRetry && (
              <button type="button" onClick={onRetry} className="font-semibold underline">
                Reintentar
              </button>
            )}
          </div>
        )}
        {items.map((it: any) => (
          <label
            key={it.id}
            className={`flex items-center gap-2 text-sm p-2 rounded-lg cursor-pointer transition ${dashboardSelectionIncludes(selected, it.id) ? 'bg-blue-50' : 'hover:bg-gray-100'
              }`}
          >
            <input
              type="checkbox"
              checked={dashboardSelectionIncludes(selected, it.id)}
              onChange={() => toggleOne(it.id)}
              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <span className="text-gray-800">
              {label(it)}
            </span>
            {it.isActive === false && (
              <span className="text-[10px] font-medium text-amber-700">Histórico</span>
            )}
            {it.unitType && (
              <span className="text-xs text-gray-500 ml-auto">
                {it.unitType === 'METER' ? '📏' : '📦'}
              </span>
            )}
          </label>
        ))}
        {!loading && items.length === 0 && (
          <div className="text-sm text-gray-500 py-2 text-center">
            {emptyLabel}
          </div>
        )}
      </div>
    </div>
  );
};
