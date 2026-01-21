import { useEffect, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../auth/useAuth";

type Product = { id: number; name: string; unitType: string; needsVariant: boolean };

export default function Products() {
  const { user, logout } = useAuth();
  const [all, setAll] = useState<Product[]>([]);
  const [mine, setMine] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [p1, p2] = await Promise.all([
          api.get("/products"),
          api.get("/branch-products/my"),
        ]);
        setAll(p1.data.products);
        setMine(p2.data.products);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <div style={{ padding: 20 }}>Cargando productos...</div>;

  return (
    <div style={{ padding: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h2>Productos</h2>
          <div style={{ fontSize: 14 }}>
            Usuario: {user?.email} — Rol: {user?.role} — BranchId: {String(user?.branchId)}
          </div>
        </div>
        <button onClick={logout}>Salir</button>
      </div>

      <h3>Mis productos habilitados</h3>
      <ul>
        {mine.map((p) => (
          <li key={p.id}>
            {p.name} ({p.unitType}) {p.needsVariant ? "— variante" : ""}
          </li>
        ))}
      </ul>

      <h3>Todos los productos (catálogo)</h3>
      <ul>
        {all.map((p) => (
          <li key={p.id}>
            {p.name} ({p.unitType}) {p.needsVariant ? "— variante" : ""}
          </li>
        ))}
      </ul>
    </div>
  );
}
