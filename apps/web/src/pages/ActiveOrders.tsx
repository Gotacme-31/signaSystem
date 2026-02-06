import { useEffect, useMemo, useState } from "react";
import { getActiveOrders, type ActiveOrder } from "../api/ordersActive";
import { nextOrderItemStep, deliverOrder } from "../api/activeOrders";

function stageLabel(stage: ActiveOrder["stage"]) {
  if (stage === "REGISTERED") return "Registrado";
  if (stage === "IN_PROGRESS") return "En proceso";
  if (stage === "READY") return "Listo";
  return "Entregado";
}

function stageBadgeStyle(stage: ActiveOrder["stage"]) {
  const base: React.CSSProperties = {
    fontSize: 12,
    padding: "4px 10px",
    borderRadius: 999,
    border: "1px solid #ddd",
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
  };

  if (stage === "REGISTERED") return { ...base, background: "#f7f7f7" };
  if (stage === "IN_PROGRESS") return { ...base, background: "#fff7e6", borderColor: "#ffe2b8" };
  if (stage === "READY") return { ...base, background: "#eaf7ee", borderColor: "#bfe3c8" };
  return { ...base, background: "#e9f1ff", borderColor: "#c7dcff" };
}

function money(v: any) {
  const n = Number(v ?? 0);
  return isNaN(n) ? "0.00" : n.toFixed(2);
}

function formatDate(d: string | Date) {
  const dt = typeof d === "string" ? new Date(d) : d;
  return dt.toLocaleDateString();
}

function formatDateTimeNow() {
  const dt = new Date();
  const date = dt.toLocaleDateString();
  const time = dt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return { date, time };
}

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}
function addDays(d: Date, days: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}
function parseYMD(ymd: string) {
  // ymd = "YYYY-MM-DD"
  const [y, m, d] = ymd.split("-").map((n) => Number(n));
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

function normalizeText(s: string) {
  return (s ?? "")
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // quita acentos
    .toLowerCase()
    .trim();
}

type DeliveryFilter = "ALL" | "TODAY" | "TOMORROW" | "EXACT";

function buildWhatsText(order: ActiveOrder) {
  const lines = order.items
    .map((it) => {
      const qty = String(it.quantity);
      const unit = it.product.unitType === "METER" ? "m" : "pza";
      const sub = (it as any).subtotal ?? "";
      return `• ${it.product.name} — ${qty} ${unit}${sub !== "" ? ` — $${money(sub)}` : ""}`;
    })
    .join("\n");

  const total =
    (order as any).total ??
    order.items.reduce((acc, it) => acc + Number((it as any).subtotal ?? 0), 0);

  return (
`PEDIDO #${order.id}
Cliente: ${order.customer.name} · ${order.customer.phone}
Entrega: ${formatDate(order.deliveryDate)}${order.deliveryTime ? ` · ${order.deliveryTime}` : ""}
Pago: ${order.paymentMethod}

Productos:
${lines}

TOTAL: $${money(total)}`
  );
}

export default function ActiveOrders() {
  const [loadingOrderId, setLoadingOrderId] = useState<number | null>(null);
  const [loadingItemId, setLoadingItemId] = useState<number | null>(null);

  // 🔎 buscador (mejorado)
  const [q, setQ] = useState("");

  // ✅ filtro de entrega (hoy/mañana/exacto)
  const [deliveryFilter, setDeliveryFilter] = useState<DeliveryFilter>("ALL");
  const [exactDay, setExactDay] = useState<string>(""); // "YYYY-MM-DD"

  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<ActiveOrder[]>([]);
  const [error, setError] = useState<string | null>(null);

  // ✅ modal ticket
  const [ticketOrder, setTicketOrder] = useState<ActiveOrder | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      // Trae todos los activos y filtramos en front (para que funcione sí o sí)
      const data = await getActiveOrders({ scope: "all" } as any);
      setOrders(data.orders);
    } catch (e: any) {
      setError(e?.message ?? "Error cargando pedidos");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    let out = [...orders];

    // ✅ filtro por entrega (ignora hora)
    const today = new Date();
    if (deliveryFilter === "TODAY") {
      const a = startOfDay(today).getTime();
      const b = endOfDay(today).getTime();
      out = out.filter((o) => {
        const t = new Date(o.deliveryDate).getTime();
        return t >= a && t <= b;
      });
    }

    if (deliveryFilter === "TOMORROW") {
      const d = addDays(today, 1);
      const a = startOfDay(d).getTime();
      const b = endOfDay(d).getTime();
      out = out.filter((o) => {
        const t = new Date(o.deliveryDate).getTime();
        return t >= a && t <= b;
      });
    }

    if (deliveryFilter === "EXACT" && exactDay) {
      const d = parseYMD(exactDay);
      const a = startOfDay(d).getTime();
      const b = endOfDay(d).getTime();
      out = out.filter((o) => {
        const t = new Date(o.deliveryDate).getTime();
        return t >= a && t <= b;
      });
    }

    // 🔎 buscador mejorado (acentos, mayus, etc.)
    const t = normalizeText(q);
    if (!t) return out;

    return out.filter((o) => {
      const haystackParts: string[] = [
        `pedido ${o.id}`,
        `#${o.id}`,
        o.customer?.name ?? "",
        o.customer?.phone ?? "",
        o.branch?.name ?? "",
        o.pickupBranch?.name ?? "",
        o.items.map((it) => it.product?.name ?? "").join(" "),
      ];

      const haystack = normalizeText(haystackParts.join(" | "));
      return haystack.includes(t);
    });
  }, [orders, q, deliveryFilter, exactDay]);

  function printTicket(order: ActiveOrder) {
    const now = formatDateTimeNow();

    const total =
      (order as any).total ??
      order.items.reduce((acc, it) => acc + Number((it as any).subtotal ?? 0), 0);

    const productsHtml = order.items
      .map((it) => {
        const qty = String(it.quantity);
        const unit = it.product.unitType === "METER" ? "m" : "pza";
        const subtotal = (it as any).subtotal;
        return `<div style="margin-top:6px;">• ${it.product.name} — ${qty} ${unit}${subtotal != null ? ` <span style="float:right;">$${money(subtotal)}</span>` : ""}</div>`;
      })
      .join("");

    const html = `
      <html>
        <head><meta charset="utf-8" /><title>Ticket Pedido #${order.id}</title></head>
        <body style="font-family: Arial, sans-serif; padding: 18px;">
          <div style="text-align:center; font-weight:800; font-size:22px;">SIGNA SUBLIMACION</div>
          <div style="text-align:center; font-weight:800; font-size:18px;">DTF MAQUILA</div>
          <div style="text-align:center; font-weight:800; font-size:18px;">CENTRO MAQUILERO</div>
          <div style="text-align:center; margin:12px 0;">------------------------------------</div>

          <div><b>Fecha:</b> ${now.date}, ${now.time}</div>
          <div style="margin-top:8px;"><b>Nombre:</b> ${order.customer.name}</div>
          <div style="margin-top:4px;"><b>Teléfono:</b> ${order.customer.phone}</div>

          <div style="margin-top:18px; font-weight:800;">Productos</div>
          <div>${productsHtml}</div>

          <div style="margin-top:18px;"><b>Fecha de entrega:</b> ${formatDate(order.deliveryDate)}</div>
          <div style="margin-top:4px;"><b>Hora de entrega:</b> ${order.deliveryTime ?? "—"}</div>
          <div style="margin-top:4px;"><b>Forma de pago:</b> ${order.paymentMethod}</div>

          <div style="margin-top:18px; font-size:22px; font-weight:900; text-align:center;">
            TOTAL: $${money(total)}
          </div>

          <div style="text-align:center; margin:12px 0;">------------------------------------</div>
          <script>window.print();</script>
        </body>
      </html>
    `;

    const w = window.open("", "_blank", "width=420,height=720");
    if (!w) return;
    w.document.write(html);
    w.document.close();
  }

  function openWhats(order: ActiveOrder) {
    const text = buildWhatsText(order);
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
  }

  return (
    <div style={{ padding: 16, maxWidth: 1100, margin: "0 auto" }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          gap: 12,
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          marginBottom: 12,
        }}
      >
        <h2 style={{ margin: 0 }}>Pedidos activos</h2>

        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <input
            placeholder="Buscar: folio, cliente, teléfono, producto…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{
              minWidth: 360,
              padding: "8px 10px",
              borderRadius: 10,
              border: "1px solid #ddd",
              outline: "none",
            }}
          />

          <button
            onClick={load}
            disabled={loading}
            style={{
              padding: "8px 12px",
              borderRadius: 10,
              border: "1px solid #ddd",
              background: "#fff",
              cursor: loading ? "not-allowed" : "pointer",
            }}
          >
            {loading ? "Cargando..." : "Actualizar"}
          </button>
        </div>
      </div>

      {/* ✅ Filtro entrega (hoy/mañana/exacto) */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ fontSize: 12, opacity: 0.75 }}>Entregar:</span>

        <button
          onClick={() => setDeliveryFilter("ALL")}
          style={{
            padding: "6px 10px",
            borderRadius: 10,
            border: "1px solid #ddd",
            background: deliveryFilter === "ALL" ? "#111" : "#fff",
            color: deliveryFilter === "ALL" ? "#fff" : "#111",
          }}
        >
          Todos
        </button>

        <button
          onClick={() => setDeliveryFilter("TODAY")}
          style={{
            padding: "6px 10px",
            borderRadius: 10,
            border: "1px solid #ddd",
            background: deliveryFilter === "TODAY" ? "#111" : "#fff",
            color: deliveryFilter === "TODAY" ? "#fff" : "#111",
          }}
        >
          Hoy
        </button>

        <button
          onClick={() => setDeliveryFilter("TOMORROW")}
          style={{
            padding: "6px 10px",
            borderRadius: 10,
            border: "1px solid #ddd",
            background: deliveryFilter === "TOMORROW" ? "#111" : "#fff",
            color: deliveryFilter === "TOMORROW" ? "#fff" : "#111",
          }}
        >
          Mañana
        </button>

        <button
          onClick={() => setDeliveryFilter("EXACT")}
          style={{
            padding: "6px 10px",
            borderRadius: 10,
            border: "1px solid #ddd",
            background: deliveryFilter === "EXACT" ? "#111" : "#fff",
            color: deliveryFilter === "EXACT" ? "#fff" : "#111",
          }}
        >
          Día exacto
        </button>

        {deliveryFilter === "EXACT" && (
          <input
            type="date"
            value={exactDay}
            onChange={(e) => setExactDay(e.target.value)}
            style={{ padding: "6px 10px", borderRadius: 10, border: "1px solid #ddd" }}
          />
        )}
      </div>

      {error && (
        <div style={{ marginTop: 12, padding: 12, border: "1px solid #f5c2c7", background: "#f8d7da", borderRadius: 10 }}>
          {error}
        </div>
      )}

      {!loading && !error && filtered.length === 0 && (
        <div style={{ marginTop: 16, opacity: 0.8 }}>No hay pedidos activos para mostrar.</div>
      )}

      {/* Cards */}
      <div style={{ display: "grid", gap: 12, marginTop: 16 }}>
        {filtered.map((o) => {
          const readyCount = o.items.filter((i) => i.isReady).length;
          const totalCount = o.items.length;

          const total =
            (o as any).total ??
            o.items.reduce((acc, it) => acc + Number((it as any).subtotal ?? 0), 0);

          return (
            <div key={o.id} style={{ border: "1px solid #ddd", borderRadius: 14, padding: 14, background: "#fff" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <div style={{ fontWeight: 800, fontSize: 18 }}>Pedido #{o.id}</div>
                    <span style={stageBadgeStyle(o.stage)}>{stageLabel(o.stage)}</span>
                    <span style={{ fontSize: 12, opacity: 0.75 }}>
                      Items listos: {readyCount}/{totalCount}
                    </span>
                  </div>

                  <div style={{ marginTop: 6, opacity: 0.9 }}>
                    <div>
                      Cliente: <b>{o.customer.name}</b> · {o.customer.phone}
                    </div>
                    <div>
                      Producción: <b>{o.branch?.name ?? "—"}</b>
                      {o.pickupBranch ? (
                        <>
                          {" "}
                          · Pickup: <b>{o.pickupBranch.name}</b>
                        </>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div style={{ textAlign: "right", minWidth: 260 }}>
                  <div style={{ opacity: 0.85 }}>
                    Entrega: {new Date(o.deliveryDate).toLocaleDateString()}
                    {o.deliveryTime ? ` · ${o.deliveryTime}` : ""}
                  </div>

                  <div style={{ marginTop: 6, opacity: 0.9 }}>
                    Total: <b>${money(total)}</b>
                  </div>

                  <div style={{ marginTop: 10, display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
                    <button
                      onClick={() => setTicketOrder(o)}
                      style={{
                        padding: "8px 12px",
                        borderRadius: 10,
                        border: "1px solid #ddd",
                        background: "#fff",
                        cursor: "pointer",
                      }}
                    >
                      Ticket
                    </button>

                    {o.stage === "READY" && (
                      <button
                        disabled={loadingOrderId === o.id}
                        onClick={async () => {
                          setLoadingOrderId(o.id);
                          setError(null);
                          try {
                            await deliverOrder(o.id);
                            await load();
                          } catch (e: any) {
                            setError(e?.message ?? "Error entregando pedido");
                          } finally {
                            setLoadingOrderId(null);
                          }
                        }}
                        style={{
                          padding: "8px 12px",
                          borderRadius: 10,
                          border: "1px solid #ddd",
                          background: "#fff",
                          cursor: loadingOrderId === o.id ? "not-allowed" : "pointer",
                        }}
                      >
                        {loadingOrderId === o.id ? "..." : "Entregar"}
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
                {o.items.map((it) => {
                  const currentStepName = it.steps?.find((s) => s.order === it.currentStepOrder)?.name;

                  const unitPrice = (it as any).unitPrice;
                  const subtotal = (it as any).subtotal;

                  return (
                    <div
                      key={it.id}
                      style={{
                        border: "1px solid #eee",
                        borderRadius: 12,
                        padding: 12,
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 12,
                        alignItems: "center",
                        flexWrap: "wrap",
                        background: "#fafafa",
                      }}
                    >
                      <div style={{ minWidth: 380 }}>
                        <div style={{ fontWeight: 700 }}>
                          {it.product.name} · {String(it.quantity)} {it.product.unitType === "METER" ? "m" : "pza"}
                        </div>

                        <div style={{ marginTop: 6, opacity: 0.85 }}>
                          {it.isReady ? <span>✅ listo</span> : <span>⏳ {currentStepName ?? `paso ${it.currentStepOrder}`}</span>}
                        </div>

                        <div style={{ marginTop: 6, fontSize: 12, opacity: 0.9 }}>
                          {unitPrice != null ? <>${money(unitPrice)} c/u</> : <>—</>} ·{" "}
                          Subtotal: <b>${subtotal != null ? money(subtotal) : "—"}</b>
                        </div>
                      </div>

                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <button
                          disabled={it.isReady || loadingItemId === it.id}
                          onClick={async () => {
                            setLoadingItemId(it.id);
                            setError(null);
                            try {
                              await nextOrderItemStep(it.id);
                              await load();
                            } catch (e: any) {
                              setError(e?.message ?? "Error avanzando paso");
                            } finally {
                              setLoadingItemId(null);
                            }
                          }}
                          style={{
                            padding: "8px 12px",
                            borderRadius: 10,
                            border: "1px solid #ddd",
                            background: it.isReady ? "#f2f2f2" : "#fff",
                            cursor: it.isReady || loadingItemId === it.id ? "not-allowed" : "pointer",
                          }}
                        >
                          {it.isReady ? "Listo" : loadingItemId === it.id ? "..." : "Avanzar"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Modal Ticket */}
      {ticketOrder && (
        <div
          onClick={() => setTicketOrder(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.25)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
            zIndex: 9999,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 520,
              maxWidth: "100%",
              background: "#fff",
              borderRadius: 14,
              border: "1px solid #ddd",
              overflow: "hidden",
            }}
          >
            <div style={{ padding: 12, display: "flex", gap: 10, borderBottom: "1px solid #eee" }}>
              <button onClick={() => printTicket(ticketOrder)} style={{ padding: "8px 14px", borderRadius: 12, border: "1px solid #ddd", background: "#fff" }}>
                IMPRIMIR
              </button>
              <button onClick={() => openWhats(ticketOrder)} style={{ padding: "8px 14px", borderRadius: 12, border: "1px solid #ddd", background: "#fff" }}>
                WHATSAPP
              </button>
              <button onClick={() => setTicketOrder(null)} style={{ padding: "8px 14px", borderRadius: 12, border: "1px solid #ddd", background: "#fff" }}>
                CERRAR
              </button>
            </div>

            <div style={{ padding: 18, textAlign: "center" }}>
              <div style={{ fontWeight: 900, fontSize: 22 }}>TICKET PREVIO</div>
              <div style={{ marginTop: 8, opacity: 0.8 }}>Pedido #{ticketOrder.id}</div>
              <div style={{ marginTop: 12, opacity: 0.85 }}>
                Cliente: <b>{ticketOrder.customer.name}</b> · {ticketOrder.customer.phone}
              </div>
              <div style={{ marginTop: 8, opacity: 0.85 }}>
                Entrega: <b>{formatDate(ticketOrder.deliveryDate)}</b>{ticketOrder.deliveryTime ? ` · ${ticketOrder.deliveryTime}` : ""}
              </div>
              <div style={{ marginTop: 12, opacity: 0.9 }}>Usa IMPRIMIR o WHATSAPP arriba.</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
