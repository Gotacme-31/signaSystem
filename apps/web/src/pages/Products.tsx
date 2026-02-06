import { useEffect, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../auth/useAuth";

type Product = { id: number; name: string; unitType: string; needsVariant: boolean; isActive?: boolean };

export default function Products() {
  const { user, logout } = useAuth();
  const [all, setAll] = useState<Product[]>([]);
  const [mine, setMine] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setErr(null);
        const [p1, p2] = await Promise.all([
          api.get("/products?includeInactive=1"),
          api.get("/branch-products/my"),
        ]);
        setAll(p1.data.products ?? []);
        setMine(p2.data.products ?? []);
      } catch (e: any) {
        setErr(e?.message ?? "Error cargando");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <div style={{ padding: 20 }}>Cargando productos...</div>;

  return (
    <div style={{ padding: 20, maxWidth: 980, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h2 style={{ margin: 0 }}>Debug · Productos</h2>
          <div style={{ fontSize: 13, marginTop: 6, opacity: 0.75 }}>
            Usuario: {user?.email} — Rol: {user?.role} — BranchId: {String(user?.branchId)}
          </div>
        </div>

        <button
          onClick={logout}
          style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid #ddd", background: "#fff" }}
        >
          Salir
        </button>
      </div>

      {err && (
        <div style={{ marginTop: 12, padding: 12, border: "1px solid #f5c2c7", background: "#f8d7da", borderRadius: 10 }}>
          {err}
        </div>
      )}

      <div style={{ marginTop: 16, display: "grid", gap: 14 }}>
        <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 12 }}>
          <h3 style={{ marginTop: 0 }}>Mis productos habilitados</h3>
          <ul style={{ margin: 0 }}>
            {mine.map((p) => (
              <li key={p.id}>
                {p.name} ({p.unitType}) {p.needsVariant ? "— variante" : ""}
              </li>
            ))}
          </ul>
          {mine.length === 0 && <div style={{ opacity: 0.75 }}>No hay productos habilitados para esta sucursal.</div>}
        </div>

        <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 12 }}>
          <h3 style={{ marginTop: 0 }}>Todos los productos (catálogo)</h3>
          <ul style={{ margin: 0 }}>
            {all.map((p) => (
              <li key={p.id} style={{ opacity: p.isActive === false ? 0.5 : 1 }}>
                {p.name} ({p.unitType}) {p.needsVariant ? "— variante" : ""}{" "}
                {p.isActive === false ? "— inactivo" : ""}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
