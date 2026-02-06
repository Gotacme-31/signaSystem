import type { QuantityPriceRow, VariantPriceRow } from "../../api/pricing";
import { Plus, Trash2, DollarSign, Minus, CheckCircle } from "lucide-react";

type Props = {
  productId: number;
  variantes: VariantPriceRow[];
  preciosMatriz: Record<number, Record<number, QuantityPriceRow[]>>;
  guardando: boolean;
  onAddRow: (productId: number, variantId: number) => void;
  onRemoveRow: (productId: number, variantId: number, index: number) => void;
  onChangeRow: (
    productId: number,
    variantId: number,
    index: number,
    field: keyof QuantityPriceRow,
    value: string | boolean
  ) => void;
  onSave: (productId: number) => void;
};

export default function MatrizPreciosTamañoCantidad({
  productId,
  variantes,
  preciosMatriz,
  guardando,
  onAddRow,
  onRemoveRow,
  onChangeRow,
  onSave,
}: Props) {
  if (variantes.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-gradient-to-r from-orange-100 to-amber-100 rounded-lg">
            <DollarSign className="w-5 h-5 text-orange-600" />
          </div>
          <div>
            <h3 className="font-bold text-lg text-gray-900">Matriz de Precios por Tamaño y Cantidad</h3>
            <p className="text-sm text-gray-500">Define precios específicos por tamaño y cantidad</p>
          </div>
        </div>
        <div className="text-center py-8 text-gray-500">
          <div className="flex flex-col items-center gap-2">
            <DollarSign className="w-8 h-8 text-gray-300" />
            <p>Primero configura los precios base por tamaño arriba.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
      <div className="flex items-center gap-3 mb-6">
        <div className="p-2 bg-gradient-to-r from-orange-100 to-amber-100 rounded-lg">
          <DollarSign className="w-5 h-5 text-orange-600" />
        </div>
        <div>
          <h3 className="font-bold text-lg text-gray-900">Matriz de Precios por Tamaño y Cantidad</h3>
          <p className="text-sm text-gray-500">Define precios específicos para cada combinación de tamaño y cantidad</p>
        </div>
      </div>

      {variantes.map((variant) => {
        const filas = preciosMatriz[productId]?.[variant.variantId] || [];
        return (
          <div
            key={variant.variantId}
            className="mb-6 p-5 bg-gradient-to-r from-gray-50 to-gray-100 rounded-xl border border-gray-200"
          >
            <div className="flex items-center justify-between mb-4">
              <div>
                <h4 className="font-bold text-lg text-gray-900 flex items-center gap-2">
                  {variant.variantName}
                  {variant.variantIsActive === false && (
                    <span className="px-2 py-0.5 bg-gray-200 text-gray-700 text-xs font-medium rounded">
                      Inactivo
                    </span>
                  )}
                </h4>
                <p className="text-sm text-gray-500">Precios específicos para este tamaño</p>
              </div>
              <button
                onClick={() => onAddRow(productId, variant.variantId)}
                className="inline-flex items-center gap-2 px-4 py-2 bg-white hover:bg-gray-50 text-gray-700 font-medium rounded-lg border border-gray-300 shadow-sm hover:shadow transition-all duration-200"
                disabled={variant.variantIsActive === false}
              >
                <Plus className="w-4 h-4" />
                Agregar Fila
              </button>
            </div>

            <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
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
                  {filas.map((row, idx) => (
                    <tr key={`${variant.variantId}-${idx}`} className="hover:bg-gray-50">
                      <td className="py-3 px-4">
                        <input
                          value={row.minQty}
                          onChange={(e) => onChangeRow(productId, variant.variantId, idx, "minQty", e.target.value)}
                          className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200"
                          placeholder="1"
                        />
                      </td>
                      <td className="py-3 px-4">
                        <div className="relative">
                          <div className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400">$</div>
                          <input
                            value={row.unitPrice}
                            onChange={(e) => onChangeRow(productId, variant.variantId, idx, "unitPrice", e.target.value)}
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
                            onChange={(e) => onChangeRow(productId, variant.variantId, idx, "isActive", e.target.checked)}
                            className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                          />
                          <span className="ml-2 text-sm text-gray-700">Activo</span>
                        </label>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <button
                          onClick={() => onRemoveRow(productId, variant.variantId, idx)}
                          className="inline-flex items-center gap-1 px-3 py-1.5 bg-red-100 hover:bg-red-200 text-red-700 font-medium rounded-lg transition-colors text-sm"
                        >
                          <Trash2 className="w-3 h-3" />
                          Eliminar
                        </button>
                      </td>
                    </tr>
                  ))}

                  {filas.length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-6 px-4 text-center text-gray-500">
                        <div className="flex flex-col items-center gap-2">
                          <Minus className="w-6 h-6 text-gray-300" />
                          <p>No hay precios por cantidad para este tamaño</p>
                          <p className="text-sm">Usa el botón "Agregar Fila" para comenzar</p>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}

      <div className="flex justify-end mt-6 pt-6 border-t border-gray-200">
        <button
          onClick={() => onSave(productId)}
          disabled={guardando}
          className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-700 hover:to-amber-700 text-white font-semibold rounded-xl transition-all duration-200 shadow-lg hover:shadow-xl"
        >
          {guardando ? (
            <>
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
              Guardando...
            </>
          ) : (
            <>
              <CheckCircle className="w-5 h-5" />
              Guardar Matriz de Precios
            </>
          )}
        </button>
      </div>
    </div>
  );
}