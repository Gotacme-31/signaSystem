import { useEffect, useMemo, useState } from "react";
import { type Branch, type BranchProductRow, getBranches, getBranchProducts, setBranchProductPrice } from "../api/pricing";

export default function AdminPricing() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState<number | null>(null);

  const [rows, setRows] = useState<BranchProductRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [savingMap, setSavingMap] = useState<Record<number, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  // “edits” por productId
  const [priceEdits, setPriceEdits] = useState<Record<number, string>>({});
  const [activeEdits, setActiveEdits] = useState<Record<number, boolean>>({});

  useEffect(() => {
    (async () => {
      try {
        setError(null);
        const b = await getBranches();
        setBranches(b);
        if (b.length && branchId === null) setBranchId(b[0].id);
      } catch (e: any) {
        setError(e.message ?? "Error cargando sucursales");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (branchId === null) return;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await getBranchProducts(branchId);
        setRows(data);

        // inicializa edits
        const p: Record<number, string> = {};
        const a: Record<number, boolean> = {};
        for (const r of data) {
          p[r.productId] = r.price;
          a[r.productId] = r.isActive;
        }
        setPriceEdits(p);
        setActiveEdits(a);
      } catch (e: any) {
        setError(e.message ?? "Error cargando productos");
      } finally {
        setLoading(false);
      }
    })();
  }, [branchId]);

  const hasChanges = useMemo(() => {
    const original = new Map(rows.map((r) => [r.productId, r]));
    for (const r of rows) {
      const priceNow = priceEdits[r.productId];
      const activeNow = activeEdits[r.productId];
      if (priceNow !== r.price || activeNow !== r.isActive) return true;
    }
    // por si hay mismatch raro
    for (const [pid] of Object.entries(priceEdits)) {
      if (!original.has(Number(pid))) return true;
    }
    return false;
  }, [rows, priceEdits, activeEdits]);

  async function saveOne(productId: number) {
    if (branchId === null) return;
    try {
      setSavingMap((m) => ({ ...m, [productId]: true }));
      setError(null);

      const price = priceEdits[productId];
      const isActive = activeEdits[productId];

      await setBranchProductPrice(branchId, productId, price, isActive);

      // refresca lista para que quede sincronizado
      const data = await getBranchProducts(branchId);
      setRows(data);

      const p: Record<number, string> = {};
      const a: Record<number, boolean> = {};
      for (const r of data) {
        p[r.productId] = r.price;
        a[r.productId] = r.isActive;
      }
      setPriceEdits(p);
      setActiveEdits(a);
    } catch (e: any) {
      setError(e.message ?? "Error guardando");
    } finally {
      setSavingMap((m) => ({ ...m, [productId]: false }));
    }
  }

  async function saveAll() {
    if (branchId === null) return;
    try {
      setError(null);
      // guardamos uno por uno (simple y claro)
      for (const r of rows) {
        const changed = priceEdits[r.productId] !== r.price || activeEdits[r.productId] !== r.isActive;
        if (!changed) continue;
        await setBranchProductPrice(branchId, r.productId, priceEdits[r.productId], activeEdits[r.productId]);
      }
      // refresca
      const data = await getBranchProducts(branchId);
      setRows(data);

      const p: Record<number, string> = {};
      const a: Record<number, boolean> = {};
      for (const r of data) {
        p[r.productId] = r.price;
        a[r.productId] = r.isActive;
      }
      setPriceEdits(p);
      setActiveEdits(a);
    } catch (e: any) {
      setError(e.message ?? "Error guardando");
    }
  }

  return (
    <div style={{ padding: 16, maxWidth: 980, margin: "0 auto" }}>
      <h2>Admin · Precios por sucursal</h2>

      <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 12 }}>
        <label>Sucursal:</label>
        <select
          value={branchId ?? ""}
          onChange={(e) => setBranchId(Number(e.target.value))}
          style={{ padding: 8, minWidth: 220 }}
        >
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name} {b.isActive ? "" : "(inactiva)"}
            </option>
          ))}
        </select>

        <button onClick={saveAll} disabled={!hasChanges || loading} style={{ padding: "8px 12px" }}>
          Guardar cambios
        </button>
      </div>

      {error && (
        <div style={{ marginTop: 12, padding: 10, border: "1px solid #f5c2c7", background: "#f8d7da" }}>
          {error}
        </div>
      )}

      <div style={{ marginTop: 16 }}>
        {loading ? (
          <p>Cargando…</p>
        ) : (
          <table width="100%" cellPadding={10} style={{ borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
                <th>Producto</th>
                <th>Unidad</th>
                <th>Variante</th>
                <th>Activo</th>
                <th>Precio</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const saving = !!savingMap[r.productId];
                const changed = priceEdits[r.productId] !== r.price || activeEdits[r.productId] !== r.isActive;

                return (
                  <tr key={r.productId} style={{ borderBottom: "1px solid #eee" }}>
                    <td>{r.product.name}</td>
                    <td>{r.product.unitType}</td>
                    <td>{r.product.needsVariant ? "Sí" : "No"}</td>
                    <td>
                      <input
                        type="checkbox"
                        checked={!!activeEdits[r.productId]}
                        onChange={(e) =>
                          setActiveEdits((m) => ({ ...m, [r.productId]: e.target.checked }))
                        }
                      />
                    </td>
                    <td>
                      <input
                        value={priceEdits[r.productId] ?? ""}
                        onChange={(e) => setPriceEdits((m) => ({ ...m, [r.productId]: e.target.value }))}
                        style={{ padding: 6, width: 120 }}
                        placeholder="100.00"
                      />
                    </td>
                    <td>
                      <button
                        onClick={() => saveOne(r.productId)}
                        disabled={!changed || saving}
                        style={{ padding: "6px 10px" }}
                      >
                        {saving ? "Guardando…" : "Guardar"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
