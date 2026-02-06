import type { QuantityPriceRow, VariantPriceRow } from "../../api/pricing";

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
      <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 12, background: "#fff" }}>
        <div style={{ fontWeight: 800, marginBottom: 6 }}>Matriz de precios por tamaño y cantidad</div>
        <div style={{ opacity: 0.75 }}>Primero configura los precios base por tamaño arriba.</div>
      </div>
    );
  }

  return (
    <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 12, background: "#fff" }}>
      <div style={{ fontWeight: 800, marginBottom: 6 }}>Matriz de precios por tamaño y cantidad</div>

      {variantes.map((variant) => {
        const filas = preciosMatriz[productId]?.[variant.variantId] || [];
        return (
          <div
            key={variant.variantId}
            style={{
              marginBottom: 24,
              padding: 12,
              border: "1px solid #f0f0f0",
              borderRadius: 8,
              background: "#fafafa",
            }}
          >
            <h4 style={{ margin: "0 0 12px 0" }}>{variant.variantName}</h4>

            <div style={{ overflowX: "auto" }}>
              <table width="100%" cellPadding={8} style={{ borderCollapse: "collapse", minWidth: 720 }}>
                <thead>
                  <tr style={{ textAlign: "left", borderBottom: "1px solid #eee", background: "#f5f5f5" }}>
                    <th style={{ width: 180 }}>Cantidad mínima</th>
                    <th style={{ width: 180 }}>Precio unitario</th>
                    <th style={{ width: 90 }}>Activo</th>
                    <th style={{ width: 120 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {filas.map((row, idx) => (
                    <tr key={`${variant.variantId}-${idx}`} style={{ borderBottom: "1px solid #f0f0f0" }}>
                      <td>
                        <input
                          value={row.minQty}
                          onChange={(e) => onChangeRow(productId, variant.variantId, idx, "minQty", e.target.value)}
                          style={{ padding: 8, width: 160, borderRadius: 10, border: "1px solid #ddd" }}
                          placeholder="1"
                        />
                      </td>
                      <td>
                        <input
                          value={row.unitPrice}
                          onChange={(e) => onChangeRow(productId, variant.variantId, idx, "unitPrice", e.target.value)}
                          style={{ padding: 8, width: 160, borderRadius: 10, border: "1px solid #ddd" }}
                          placeholder="0.00"
                        />
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          checked={row.isActive}
                          onChange={(e) => onChangeRow(productId, variant.variantId, idx, "isActive", e.target.checked)}
                        />
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <button
                          onClick={() => onRemoveRow(productId, variant.variantId, idx)}
                          style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid #ddd", background: "#fff" }}
                        >
                          Eliminar
                        </button>
                      </td>
                    </tr>
                  ))}

                  {filas.length === 0 && (
                    <tr>
                      <td colSpan={4} style={{ padding: 10, opacity: 0.75 }}>
                        No hay precios por cantidad para este tamaño.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <button
              onClick={() => onAddRow(productId, variant.variantId)}
              style={{
                marginTop: 10,
                padding: "8px 12px",
                borderRadius: 10,
                border: "1px solid #ddd",
                background: "#fff",
                fontWeight: 600,
              }}
            >
              + Agregar fila para {variant.variantName}
            </button>
          </div>
        );
      })}

      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
        <button
          onClick={() => onSave(productId)}
          disabled={guardando}
          style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid #ddd", background: "#fff", fontWeight: 800 }}
        >
          {guardando ? "Guardando..." : "Guardar matriz de precios"}
        </button>
      </div>
    </div>
  );
}
