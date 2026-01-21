import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth/useAuth";
import { getBranches, getBranchProducts } from "../api/pricing";
import { getCustomerById } from "../api/customers";
import { createOrder } from "../api/orders";

type Branch = { id: number; name: string; isActive: boolean };
type BranchProductRow = {
  branchId: number;
  productId: number;
  isActive: boolean;
  price: string;
  product: { id: number; name: string; unitType: string; needsVariant: boolean; isActive: boolean };
};

type ItemRow = { productId: number; quantity: string; productionStep: string };

export default function NewOrder() {
  const { user } = useAuth();

  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState<number | null>(null); // sucursal que REGISTRA (fija del usuario)
  const [pickupBranchId, setPickupBranchId] = useState<number | null>(null); // sucursal donde se RECOGE (select)

  const [catalog, setCatalog] = useState<BranchProductRow[]>([]);
  const [loadingCatalog, setLoadingCatalog] = useState(false);

  const [customerNumber, setCustomerNumber] = useState("");
  const [customer, setCustomer] = useState<{ id: number; name: string; phone: string } | null>(null);
  const [customerErr, setCustomerErr] = useState<string | null>(null);
  const [lookingUp, setLookingUp] = useState(false);

  const [items, setItems] = useState<ItemRow[]>([]);
  const [saving, setSaving] = useState(false);

  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // 1) Branch fijo del usuario + cargar lista de sucursales (para el select de recolección)
  useEffect(() => {
    if (!user) return;

    if (!user.branchId) {
      setErr("Tu usuario no tiene sucursal asignada.");
      return;
    }

    setBranchId(user.branchId);

    (async () => {
      const b = await getBranches();
      setBranches(b.filter((x: any) => x.isActive));
    })().catch((e) => setErr(e.message));
  }, [user]);

  // 2) pickupBranchId por defecto = branchId del usuario
  useEffect(() => {
    if (branchId && pickupBranchId == null) setPickupBranchId(branchId);
  }, [branchId, pickupBranchId]);

  // 3) Cargar catálogo de la sucursal que REGISTRA (branchId del usuario)
  useEffect(() => {
    if (!branchId) return;

    (async () => {
      setLoadingCatalog(true);
      setErr(null);
      try {
        const rows = (await getBranchProducts(branchId)) as BranchProductRow[];
        setCatalog(rows.filter((r) => r.isActive && r.product.isActive));
      } catch (e: any) {
        setErr(e.message ?? "Error cargando catálogo");
      } finally {
        setLoadingCatalog(false);
      }
    })();
  }, [branchId]);

  const priceByProductId = useMemo(() => {
    const m = new Map<number, number>();
    for (const r of catalog) m.set(r.productId, Number(r.price));
    return m;
  }, [catalog]);

  const total = useMemo(() => {
    let t = 0;
    for (const it of items) {
      const p = priceByProductId.get(it.productId) ?? 0;
      const q = Number(it.quantity || 0);
      t += p * (isNaN(q) ? 0 : q);
    }
    return t;
  }, [items, priceByProductId]);

  async function lookupCustomer() {
    setCustomer(null);
    setCustomerErr(null);
    setMsg(null);

    const id = Number(customerNumber);
    if (!Number.isFinite(id) || id <= 0) {
      setCustomerErr("Número de cliente inválido");
      return;
    }

    try {
      setLookingUp(true);
      const c = await getCustomerById(id);
      setCustomer(c);
    } catch (e: any) {
      setCustomerErr(e.message ?? "Cliente no existe");
    } finally {
      setLookingUp(false);
    }
  }

  function addItem() {
    const first = catalog[0];
    if (!first) return;
    setItems((prev) => [...prev, { productId: first.productId, quantity: "1", productionStep: "IMPRESION" }]);
  }

  function updateItem(idx: number, patch: Partial<ItemRow>) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }

  function removeItem(idx: number) {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }

  async function saveOrder() {
    if (!branchId) return;

    setErr(null);
    setMsg(null);

    if (!customer) {
      setErr("Primero busca un cliente por número");
      return;
    }
    if (!items.length) {
      setErr("Agrega al menos un producto");
      return;
    }

    try {
      setSaving(true);

      const payload = {
        // branchId ya NO lo mandamos (backend lo toma del usuario)
        customerId: customer.id,
        pickupBranchId: pickupBranchId ?? branchId, // ✅ select
        shippingType: "PICKUP" as const,
        paymentMethod: "CASH" as const,
        deliveryDate: new Date().toISOString(),
        items: items.map((it) => ({
          productId: it.productId,
          quantity: it.quantity,
          productionStep: it.productionStep,
        })),
      };

      const r = await createOrder(payload as any);
      setMsg(`Pedido #${r.orderId} creado ✅ Total: $${r.total}`);
      setItems([]);
    } catch (e: any) {
      setErr(e.message ?? "Error creando pedido");
    } finally {
      setSaving(false);
    }
  }

  const registerBranchName =
    branches.find((b) => b.id === branchId)?.name ?? (branchId ? `Sucursal #${branchId}` : "");

  return (
    <div style={{ padding: 16, maxWidth: 980, margin: "0 auto" }}>
      <h2>Nueva Orden (STAFF)</h2>

      {err && (
        <div style={{ marginTop: 10, padding: 10, background: "#f8d7da", border: "1px solid #f5c2c7" }}>
          {err}
        </div>
      )}
      {msg && (
        <div style={{ marginTop: 10, padding: 10, background: "#d1e7dd", border: "1px solid #badbcc" }}>
          {msg}
        </div>
      )}

      {/* Sucursal que registra: fija */}
      <div style={{ display: "flex", gap: 12, marginTop: 12, alignItems: "center" }}>
        <label>Sucursal que registra:</label>
        <div style={{ padding: 8 }}>
          <b>{registerBranchName}</b>
        </div>
      </div>

      {/* Sucursal de recolección: select (default = la del usuario) */}
      <div style={{ display: "flex", gap: 12, marginTop: 12, alignItems: "center" }}>
        <label>Se recoge en:</label>
        <select
          value={pickupBranchId ?? ""}
          onChange={(e) => setPickupBranchId(Number(e.target.value))}
          style={{ padding: 8, minWidth: 220 }}
        >
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </div>

      <div style={{ marginTop: 16, padding: 12, border: "1px solid #ddd" }}>
        <h3>Cliente</h3>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <input
            value={customerNumber}
            onChange={(e) => setCustomerNumber(e.target.value)}
            placeholder="Número de cliente (ej. 3)"
            style={{ padding: 10, width: 260 }}
          />
          <button onClick={lookupCustomer} disabled={lookingUp} style={{ padding: "10px 12px" }}>
            {lookingUp ? "Buscando..." : "Buscar"}
          </button>
        </div>

        {customerErr && <div style={{ marginTop: 8, color: "#b02a37" }}>{customerErr}</div>}

        {customer && (
          <div style={{ marginTop: 10 }}>
            <b>Cliente #{customer.id}</b> — {customer.name} — {customer.phone}
          </div>
        )}
      </div>

      <div style={{ marginTop: 16, padding: 12, border: "1px solid #ddd" }}>
        <h3>Productos</h3>

        {loadingCatalog ? (
          <p>Cargando catálogo...</p>
        ) : (
          <>
            <button onClick={addItem} disabled={!catalog.length} style={{ padding: "8px 10px" }}>
              + Agregar producto
            </button>

            <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
              {items.map((it, idx) => (
                <div
                  key={idx}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "2fr 1fr 1fr 120px",
                    gap: 10,
                    alignItems: "center",
                  }}
                >
                  <select
                    value={it.productId}
                    onChange={(e) => updateItem(idx, { productId: Number(e.target.value) })}
                    style={{ padding: 8 }}
                  >
                    {catalog.map((r) => (
                      <option key={r.productId} value={r.productId}>
                        {r.product.name} — ${r.price} / {r.product.unitType}
                      </option>
                    ))}
                  </select>

                  <input
                    value={it.quantity}
                    onChange={(e) => updateItem(idx, { quantity: e.target.value })}
                    style={{ padding: 8 }}
                    placeholder="Cantidad"
                  />

                  <input
                    value={it.productionStep}
                    onChange={(e) => updateItem(idx, { productionStep: e.target.value })}
                    style={{ padding: 8 }}
                    placeholder="Paso (ej. IMPRESION)"
                  />

                  <button onClick={() => removeItem(idx)} style={{ padding: "8px 10px" }}>
                    Quitar
                  </button>
                </div>
              ))}
            </div>
          </>
        )}

        <div style={{ marginTop: 14, fontSize: 18 }}>
          Total estimado: <b>${total.toFixed(2)}</b>
        </div>

        <button onClick={saveOrder} disabled={saving} style={{ marginTop: 12, padding: "10px 12px" }}>
          {saving ? "Guardando..." : "Crear pedido"}
        </button>
      </div>
    </div>
  );
}
