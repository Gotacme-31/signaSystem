import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth/useAuth";
import { getCustomerById } from "../api/customers";
import { createOrder } from "../api/orders";
import { getBranches, getBranchProducts, type BranchProductRow, type QuantityPriceRow, type VariantPriceRow, type ParamPriceRow } from "../api/pricing";
type Branch = { id: number; name: string; isActive: boolean };

interface OrderItem {
  productId: number;
  quantity: string;
  variantId?: number | null;
  selectedParams: number[]; // IDs de parámetros seleccionados
}

export default function NewOrder() {
  const { user } = useAuth();

  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState<number | null>(null);
  const [pickupBranchId, setPickupBranchId] = useState<number | null>(null);

  const [catalog, setCatalog] = useState<BranchProductRow[]>([]);
  const [loadingCatalog, setLoadingCatalog] = useState(false);

  const [customerNumber, setCustomerNumber] = useState("");
  const [customer, setCustomer] = useState<{ id: number; name: string; phone: string } | null>(null);
  const [customerErr, setCustomerErr] = useState<string | null>(null);
  const [lookingUp, setLookingUp] = useState(false);

  const [items, setItems] = useState<OrderItem[]>([]);
  const [saving, setSaving] = useState(false);

  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [deliveryDate, setDeliveryDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [deliveryTime, setDeliveryTime] = useState("18:00");
  const [shippingType, setShippingType] = useState<"PICKUP" | "DELIVERY">("PICKUP");
  const [paymentMethod, setPaymentMethod] = useState<"CASH" | "TRANSFER" | "CARD">("CASH");
  const [notes, setNotes] = useState("");

  // 1) Branch fijo del usuario + cargar sucursales
  useEffect(() => {
    if (!user) return;

    if (!user.branchId) {
      setErr("Tu usuario no tiene sucursal asignada.");
      return;
    }

    setBranchId(user.branchId);

    (async () => {
      const b = await getBranches();
      setBranches(b.filter((x) => x.isActive));
    })().catch((e) => setErr(e.message));
  }, [user]);

  // 2) pickupBranchId por defecto = branchId del usuario
  useEffect(() => {
    if (branchId && pickupBranchId == null) setPickupBranchId(branchId);
  }, [branchId, pickupBranchId]);

  // 3) Cargar catálogo de la sucursal que REGISTRA
  useEffect(() => {
    if (!branchId) return;

    (async () => {
      setLoadingCatalog(true);
      setErr(null);
      try {
        const rows = await getBranchProducts(branchId);
        // Filtrar productos activos
        const filtered = rows.filter((r) => r.isActive && r.product);
        console.log("Catálogo cargado:", filtered); // Debug
        setCatalog(filtered);
      } catch (e: any) {
        console.error("Error cargando catálogo:", e);
        setErr(e.message ?? "Error cargando catálogo");
      } finally {
        setLoadingCatalog(false);
      }
    })();
  }, [branchId]);

  // Función para obtener producto del catálogo
  const getProduct = (productId: number): BranchProductRow | undefined => {
    return catalog.find(p => p.productId === productId);
  };

  // Función para calcular el precio unitario de un item
  const calculateUnitPrice = (item: OrderItem): number => {
    const product = getProduct(item.productId);
    if (!product) return 0;

    const quantity = parseFloat(item.quantity) || 0;

    // 1. Buscar precio por cantidad (quantityPrices)
    const quantityPrice = product.quantityPrices
      .filter((qp: QuantityPriceRow) => qp.isActive && parseFloat(qp.minQty) <= quantity)
      .sort((a, b) => parseFloat(b.minQty) - parseFloat(a.minQty))[0];

    let basePrice = parseFloat(product.price);
    
    if (quantityPrice) {
      // Usar precio por cantidad
      basePrice = parseFloat(quantityPrice.unitPrice);
    }

    // 2. Añadir ajuste por variante (tamaño)
    if (item.variantId) {
      const variantPrice = product.variantPrices.find((vp: VariantPriceRow) => 
        vp.variantId === item.variantId && vp.isActive
      );
      if (variantPrice) {
        basePrice = parseFloat(variantPrice.price);
      }
    }

    // 3. Añadir ajustes por parámetros
    let paramAdjustment = 0;
    if (item.selectedParams && item.selectedParams.length > 0) {
      paramAdjustment = product.paramPrices
        .filter((pp: ParamPriceRow) => item.selectedParams.includes(pp.paramId) && pp.isActive)
        .reduce((sum, pp) => sum + parseFloat(pp.priceDelta), 0);
    }

    return basePrice + paramAdjustment;
  };

  // Calcular total por item
  const calculateItemTotal = (item: OrderItem): number => {
    const quantity = parseFloat(item.quantity) || 0;
    const unitPrice = calculateUnitPrice(item);
    return quantity * unitPrice;
  };

  // Calcular total general
  const total = useMemo(() => {
    return items.reduce((sum, item) => sum + calculateItemTotal(item), 0);
  }, [items, catalog]);

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
    
    setItems((prev) => [...prev, { 
      productId: first.productId, 
      quantity: "1",
      variantId: null,
      selectedParams: []
    }]);
  }

  function updateItem(idx: number, patch: Partial<OrderItem>) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }

  function removeItem(idx: number) {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }

  // Toggle parámetro
  function toggleParam(itemIdx: number, paramId: number) {
    const item = items[itemIdx];
    if (!item) return;

    const newSelectedParams = item.selectedParams.includes(paramId)
      ? item.selectedParams.filter(id => id !== paramId)
      : [...item.selectedParams, paramId];

    updateItem(itemIdx, { selectedParams: newSelectedParams });
  }

  // Validar cantidad básica
  function validateQuantity(quantity: string): string | null {
    const qty = parseFloat(quantity);
    if (isNaN(qty) || qty <= 0) return "Cantidad inválida";
    return null;
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

    // Validar todas las cantidades
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const error = validateQuantity(item.quantity);
      if (error) {
        setErr(`Item ${i + 1}: ${error}`);
        return;
      }
    }

    try {
      setSaving(true);

      const isoDeliveryDate = new Date(
        `${deliveryDate}T${deliveryTime || "00:00"}:00`
      ).toISOString();

      const payload = {
        customerId: customer.id,
        pickupBranchId: pickupBranchId ?? branchId,
        branchId: branchId,
        shippingType: shippingType,
        paymentMethod: paymentMethod,
        deliveryDate: isoDeliveryDate,
        deliveryTime: deliveryTime || null,
        notes: notes || null,
        items: items.map((it) => ({
          productId: it.productId,
          quantity: it.quantity,
          variantId: it.variantId || null,
          paramIds: it.selectedParams || []
        })),
      };

      console.log("Enviando pedido:", payload); // Debug
      const r = await createOrder(payload as any);
      setMsg(`Pedido #${r.orderId} creado ✅ Total: $${r.total}`);
      setItems([]);
      setNotes("");
    } catch (e: any) {
      console.error("Error creando pedido:", e);
      setErr(e.message ?? "Error creando pedido");
    } finally {
      setSaving(false);
    }
  }

  if (!user) {
    return <div>Cargando usuario...</div>;
  }

  const registerBranchName =
    branches.find((b) => b.id === branchId)?.name ?? (branchId ? `Sucursal #${branchId}` : "");

  return (
    <div style={{ padding: 16, maxWidth: 1200, margin: "0 auto" }}>
      <h2>Nueva Orden</h2>

      {err && (
        <div style={{ marginTop: 10, padding: 10, background: "#f8d7da", border: "1px solid #f5c2c7", borderRadius: 8 }}>
          {err}
        </div>
      )}
      {msg && (
        <div style={{ marginTop: 10, padding: 10, background: "#d1e7dd", border: "1px solid #badbcc", borderRadius: 8 }}>
          {msg}
        </div>
      )}

      {/* Información básica */}
      <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        <div style={{ padding: 12, border: "1px solid #ddd", borderRadius: 8 }}>
          <h3>Sucursales</h3>
          <div style={{ marginTop: 8 }}>
            <label style={{ display: "block", marginBottom: 4 }}>Registrado por:</label>
            <div style={{ padding: 8, background: "#f8f9fa", borderRadius: 4 }}>
              <b>{registerBranchName}</b> (tu sucursal)
            </div>
          </div>
          <div style={{ marginTop: 12 }}>
            <label style={{ display: "block", marginBottom: 4 }}>Se recoge en:</label>
            <select
              value={pickupBranchId ?? ""}
              onChange={(e) => setPickupBranchId(Number(e.target.value))}
              style={{ padding: 8, width: "100%", borderRadius: 4 }}
            >
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div style={{ padding: 12, border: "1px solid #ddd", borderRadius: 8 }}>
          <h3>Entrega</h3>
          <div style={{ display: "grid", gap: 8 }}>
            <div>
              <label style={{ display: "block", marginBottom: 4 }}>Fecha:</label>
              <input 
                type="date" 
                value={deliveryDate} 
                onChange={(e) => setDeliveryDate(e.target.value)}
                style={{ padding: 8, width: "100%", borderRadius: 4 }}
              />
            </div>
            <div>
              <label style={{ display: "block", marginBottom: 4 }}>Hora:</label>
              <input 
                type="time" 
                value={deliveryTime} 
                onChange={(e) => setDeliveryTime(e.target.value)}
                style={{ padding: 8, width: "100%", borderRadius: 4 }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Cliente */}
      <div style={{ marginTop: 16, padding: 12, border: "1px solid #ddd", borderRadius: 8 }}>
        <h3>Cliente</h3>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <input
            value={customerNumber}
            onChange={(e) => setCustomerNumber(e.target.value)}
            placeholder="Número de cliente (ej. 3)"
            style={{ padding: 10, width: 260, borderRadius: 4 }}
          />
          <button 
            onClick={lookupCustomer} 
            disabled={lookingUp} 
            style={{ padding: "10px 12px", borderRadius: 4 }}
          >
            {lookingUp ? "Buscando..." : "Buscar"}
          </button>
        </div>

        {customerErr && (
          <div style={{ marginTop: 8, color: "#b02a37", fontSize: 14 }}>
            {customerErr}
          </div>
        )}

        {customer && (
          <div style={{ marginTop: 10, padding: 8, background: "#e7f5ff", borderRadius: 4 }}>
            <b>Cliente #{customer.id}</b> — {customer.name} — {customer.phone}
          </div>
        )}
      </div>

      {/* Método de envío y pago */}
      <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        <div style={{ padding: 12, border: "1px solid #ddd", borderRadius: 8 }}>
          <h3>Envío</h3>
          <div style={{ display: "flex", gap: 12 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <input
                type="radio"
                checked={shippingType === "PICKUP"}
                onChange={() => setShippingType("PICKUP")}
              />
              Recoge en sucursal
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <input
                type="radio"
                checked={shippingType === "DELIVERY"}
                onChange={() => setShippingType("DELIVERY")}
              />
              Delivery
            </label>
          </div>
        </div>

        <div style={{ padding: 12, border: "1px solid #ddd", borderRadius: 8 }}>
          <h3>Pago</h3>
          <div style={{ display: "flex", gap: 12 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <input
                type="radio"
                checked={paymentMethod === "CASH"}
                onChange={() => setPaymentMethod("CASH")}
              />
              Efectivo
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <input
                type="radio"
                checked={paymentMethod === "TRANSFER"}
                onChange={() => setPaymentMethod("TRANSFER")}
              />
              Transferencia
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <input
                type="radio"
                checked={paymentMethod === "CARD"}
                onChange={() => setPaymentMethod("CARD")}
              />
              Tarjeta
            </label>
          </div>
        </div>
      </div>

      {/* Notas */}
      <div style={{ marginTop: 16 }}>
        <label style={{ display: "block", marginBottom: 4 }}>Notas adicionales:</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Instrucciones especiales, detalles del pedido, etc."
          style={{ width: "100%", padding: 8, borderRadius: 4, minHeight: 60 }}
        />
      </div>

      {/* Productos */}
      <div style={{ marginTop: 24, padding: 16, border: "1px solid #ddd", borderRadius: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0 }}>Productos</h3>
          <button 
            onClick={addItem} 
            disabled={!catalog.length} 
            style={{ padding: "8px 12px", borderRadius: 4 }}
          >
            + Agregar producto
          </button>
        </div>

        {loadingCatalog ? (
          <p style={{ marginTop: 12 }}>Cargando catálogo...</p>
        ) : catalog.length === 0 ? (
          <div style={{ marginTop: 20, padding: 20, textAlign: "center", color: "#6c757d" }}>
            No hay productos disponibles en esta sucursal.
          </div>
        ) : (
          <>
            <div style={{ marginTop: 16, display: "grid", gap: 12 }}>
              {items.map((it, idx) => {
                const product = getProduct(it.productId);
                if (!product) return null;
                
                const unitPrice = calculateUnitPrice(it);
                const itemTotal = calculateItemTotal(it);
                const quantityError = validateQuantity(it.quantity);

                return (
                  <div
                    key={idx}
                    style={{
                      padding: 16,
                      border: "1px solid #eee",
                      borderRadius: 8,
                      background: "#fafafa"
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                      <div style={{ flex: 1 }}>
                        {/* Selector de producto */}
                        <div style={{ marginBottom: 12 }}>
                          <label style={{ display: "block", marginBottom: 4, fontWeight: 600 }}>
                            Producto:
                          </label>
                          <select
                            value={it.productId}
                            onChange={(e) => updateItem(idx, { 
                              productId: Number(e.target.value),
                              variantId: null, // Resetear variante al cambiar producto
                              selectedParams: [] // Resetear parámetros
                            })}
                            style={{ padding: 8, width: "100%", maxWidth: 400, borderRadius: 4 }}
                          >
                            {catalog.map((r) => (
                              <option key={r.productId} value={r.productId}>
                                {r.product.name} — ${r.price} / {r.product.unitType.toLowerCase()}
                                {r.product.needsVariant && " (con tamaños)"}
                              </option>
                            ))}
                          </select>
                        </div>

                        {/* Cantidad */}
                        <div style={{ marginBottom: 12 }}>
                          <label style={{ display: "block", marginBottom: 4, fontWeight: 600 }}>
                            Cantidad:
                          </label>
                          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                            <input
                              type="number"
                              min="0.01"
                              step="0.01"
                              value={it.quantity}
                              onChange={(e) => updateItem(idx, { quantity: e.target.value })}
                              style={{ 
                                padding: 8, 
                                width: 120,
                                borderRadius: 4,
                                border: quantityError ? "1px solid #dc3545" : "1px solid #ddd"
                              }}
                              placeholder="Cantidad"
                            />
                            <span>{product.product.unitType.toLowerCase()}s</span>
                            {quantityError && (
                              <span style={{ color: "#dc3545", fontSize: 12 }}>
                                {quantityError}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Tamaños/Variantes (si el producto usa) */}
                        {product.product.needsVariant && product.variantPrices.length > 0 && (
                          <div style={{ marginBottom: 12 }}>
                            <label style={{ display: "block", marginBottom: 4, fontWeight: 600 }}>
                              Tamaño:
                            </label>
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                              {product.variantPrices
                                .filter((v: VariantPriceRow) => v.variantIsActive)
                                .map((variant: VariantPriceRow) => (
                                  <label 
                                    key={variant.variantId}
                                    style={{
                                      padding: "6px 12px",
                                      border: it.variantId === variant.variantId 
                                        ? "2px solid #0d6efd" 
                                        : "1px solid #ddd",
                                      borderRadius: 4,
                                      background: it.variantId === variant.variantId ? "#e7f1ff" : "#fff",
                                      cursor: "pointer",
                                      display: "flex",
                                      alignItems: "center",
                                      gap: 6
                                    }}
                                  >
                                    <input
                                      type="radio"
                                      name={`variant-${idx}`}
                                      checked={it.variantId === variant.variantId}
                                      onChange={() => updateItem(idx, { variantId: variant.variantId })}
                                      style={{ display: "none" }}
                                    />
                                    {variant.variantName} (+${variant.price})
                                  </label>
                                ))}
                              <label 
                                style={{
                                  padding: "6px 12px",
                                  border: it.variantId === null 
                                    ? "2px solid #0d6efd" 
                                    : "1px solid #ddd",
                                  borderRadius: 4,
                                  background: it.variantId === null ? "#e7f1ff" : "#fff",
                                  cursor: "pointer"
                                }}
                              >
                                <input
                                  type="radio"
                                  name={`variant-${idx}`}
                                  checked={it.variantId === null}
                                  onChange={() => updateItem(idx, { variantId: null })}
                                  style={{ display: "none" }}
                                />
                                Sin tamaño
                              </label>
                            </div>
                          </div>
                        )}

                        {/* Parámetros */}
                        {product.paramPrices.length > 0 && (
                          <div style={{ marginBottom: 12 }}>
                            <label style={{ display: "block", marginBottom: 4, fontWeight: 600 }}>
                              Parámetros (opcionales):
                            </label>
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                              {product.paramPrices
                                .filter((p: ParamPriceRow) => p.paramIsActive)
                                .map((param: ParamPriceRow) => {
                                  const isSelected = it.selectedParams.includes(param.paramId);
                                  const priceDelta = parseFloat(param.priceDelta);
                                  return (
                                    <label 
                                      key={param.paramId}
                                      style={{
                                        padding: "6px 12px",
                                        border: isSelected 
                                          ? "2px solid #198754" 
                                          : "1px solid #ddd",
                                        borderRadius: 4,
                                        background: isSelected ? "#d1e7dd" : "#fff",
                                        cursor: "pointer",
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 6
                                      }}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={isSelected}
                                        onChange={() => toggleParam(idx, param.paramId)}
                                        style={{ display: "none" }}
                                      />
                                      {param.paramName} 
                                      {priceDelta !== 0 && (
                                        <span style={{ color: priceDelta > 0 ? "#198754" : "#dc3545" }}>
                                          ({priceDelta > 0 ? '+' : ''}{priceDelta})
                                        </span>
                                      )}
                                    </label>
                                  );
                                })}
                            </div>
                          </div>
                        )}

                        {/* Precios por cantidad disponibles */}
                        {product.quantityPrices.length > 0 && (
                          <div style={{ marginTop: 8, fontSize: 12, color: "#6c757d" }}>
                            <span>Precios por cantidad: </span>
                            {product.quantityPrices
                              .filter((qp: QuantityPriceRow) => qp.isActive)
                              .map((qp: QuantityPriceRow, i: number) => (
                                <span key={qp.minQty}>
                                  {i > 0 && ', '}
                                  ≥{qp.minQty} = ${qp.unitPrice}
                                </span>
                              ))}
                          </div>
                        )}
                      </div>

                      {/* Información de precio */}
                      <div style={{ minWidth: 180, textAlign: "right" }}>
                        <div style={{ fontSize: 14, color: "#6c757d" }}>
                          Precio unitario:
                        </div>
                        <div style={{ fontSize: 20, fontWeight: 700 }}>
                          ${unitPrice.toFixed(2)}
                        </div>
                        <div style={{ fontSize: 14, color: "#6c757d", marginTop: 4 }}>
                          Total item:
                        </div>
                        <div style={{ fontSize: 18, fontWeight: 600, color: "#198754" }}>
                          ${itemTotal.toFixed(2)}
                        </div>
                        <button 
                          onClick={() => removeItem(idx)}
                          style={{ 
                            marginTop: 12, 
                            padding: "6px 12px", 
                            borderRadius: 4,
                            background: "#dc3545",
                            color: "white",
                            border: "none",
                            cursor: "pointer"
                          }}
                        >
                          Eliminar
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {items.length === 0 && (
              <div style={{ marginTop: 20, padding: 20, textAlign: "center", color: "#6c757d" }}>
                No hay productos agregados. Haz clic en "Agregar producto" para comenzar.
              </div>
            )}

            {/* Total */}
            {items.length > 0 && (
              <div style={{ 
                marginTop: 24, 
                padding: 20, 
                background: "#f8f9fa", 
                borderRadius: 8,
                border: "1px solid #dee2e6"
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontSize: 14, color: "#6c757d" }}>Total estimado:</div>
                    <div style={{ fontSize: 32, fontWeight: 800, color: "#198754" }}>
                      ${total.toFixed(2)}
                    </div>
                    <div style={{ fontSize: 12, color: "#6c757d", marginTop: 4 }}>
                      {items.length} {items.length === 1 ? 'producto' : 'productos'} en el pedido
                    </div>
                  </div>
                  <button 
                    onClick={saveOrder} 
                    disabled={saving || !customer || items.length === 0}
                    style={{ 
                      padding: "12px 24px", 
                      fontSize: 16,
                      background: saving ? "#6c757d" : "#198754",
                      color: "white",
                      border: "none",
                      borderRadius: 8,
                      cursor: saving ? "not-allowed" : "pointer"
                    }}
                  >
                    {saving ? "Creando pedido..." : "Crear pedido"}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}