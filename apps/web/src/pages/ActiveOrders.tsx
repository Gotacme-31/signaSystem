import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getActiveOrders, type ActiveOrder } from "../api/ordersActive";
import { nextOrderItemStep, deliverOrder } from "../api/activeOrders";
import { useAuth } from "../auth/useAuth";
import EditOrderModal from "./components/EditOrderModal";
import PasswordVerifyModal from "./components/PasswordVerifyModal";
import { User } from "lucide-react";
import { useOrderEvents } from "../hooks/useSocket";
import { useSocket } from "../contexts/SocketContext";

// (Las funciones auxiliares anteriores se mantienen igual...)
function stageLabel(stage: ActiveOrder["stage"]) {
  if (stage === "REGISTERED") return "Registrado";
  if (stage === "IN_PROGRESS") return "En proceso";
  if (stage === "READY") return "Listo";
  return "Entregado";
}

function stageBadgeStyle(stage: ActiveOrder["stage"]) {
  const base = "text-xs px-3 py-1 rounded-full border inline-flex items-center gap-1.5";

  if (stage === "REGISTERED") return `${base} bg-gray-100 border-gray-300 text-gray-700`;
  if (stage === "IN_PROGRESS") return `${base} bg-yellow-50 border-yellow-200 text-yellow-700`;
  if (stage === "READY") return `${base} bg-green-50 border-green-200 text-green-700`;
  return `${base} bg-blue-50 border-blue-200 text-blue-700`;
}

function getDeliveryStatus(deliveryDate: string, deliveryTime?: string): "ontime" | "today" | "overdue" | "upcoming" {
  const now = new Date();
  const delivery = new Date(deliveryDate);

  if (deliveryTime) {
    const [hours, minutes] = deliveryTime.split(":").map(Number);
    delivery.setHours(hours, minutes, 0, 0);
  } else {
    delivery.setHours(23, 59, 59, 999);
  }

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);

  const startOfTomorrow = new Date();
  startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);
  startOfTomorrow.setHours(0, 0, 0, 0);

  if (delivery < now) {
    return "overdue";
  } else if (delivery >= startOfToday && delivery <= endOfToday) {
    return "today";
  } else if (delivery >= startOfTomorrow && delivery < new Date(startOfTomorrow.getTime() + 24 * 60 * 60 * 1000)) {
    return "upcoming";
  }

  return "upcoming";
}

function deliveryBadgeStyle(status: ReturnType<typeof getDeliveryStatus>) {
  const base = "text-xs px-3 py-1 rounded-full border inline-flex items-center gap-1.5";

  switch (status) {
    case "overdue":
      return `${base} bg-red-50 border-red-200 text-red-700`;
    case "today":
      return `${base} bg-orange-50 border-orange-200 text-orange-700`;
    case "upcoming":
      return `${base} bg-blue-50 border-blue-200 text-blue-700`;
    default:
      return `${base} bg-gray-50 border-gray-200 text-gray-700`;
  }
}

function deliveryLabel(status: ReturnType<typeof getDeliveryStatus>) {
  switch (status) {
    case "overdue":
      return "Atrasado";
    case "today":
      return "Hoy";
    case "upcoming":
      return "Próximo";
    default:
      return "Programado";
  }
}

function money(v: any) {
  const n = Number(v ?? 0);
  return isNaN(n) ? "0.00" : n.toFixed(2);
}

function formatDate(d: string | Date) {
  const dt = typeof d === "string" ? new Date(d) : d;
  return dt.toLocaleDateString("es-MX", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function formatDateTimeNow() {
  const dt = new Date();
  const date = dt.toLocaleDateString("es-MX", { day: "2-digit", month: "2-digit", year: "numeric" });
  const time = dt.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
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
  const [y, m, d] = ymd.split("-").map((n) => Number(n));
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

function normalizeText(s: string) {
  return (s ?? "")
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

type DeliveryFilter = "ALL" | "TODAY" | "TOMORROW" | "EXACT";

function buildWhatsText(order: any) {
  const lines = order.items
    .map((it: any) => {
      const qty = String(it.quantity);
      const unit = it.product.unitType === "METER" ? "m" : "pza";
      const sub = it.subtotal ?? "";

      let paramsText = "";
      if (it.options && it.options.length > 0) {
        const params = it.options.map((opt: any) => opt.name).join(", ");
        paramsText = ` (${params})`;
      }

      return `• ${it.product.name}${paramsText} — ${qty} ${unit}${sub !== "" ? ` — $${money(sub)}` : ""}`;
    })
    .join("\n");

  const total = order.total ?? order.items.reduce((acc: number, it: any) => acc + Number(it.subtotal ?? 0), 0);

  let notesText = "";
  if (order.notes) {
    notesText = `\nNotas: ${order.notes}\n`;
  }

  return (
    `PEDIDO #${order.id}
Cliente: ${order.customer.name} · ${order.customer.phone}
Entrega: ${formatDate(order.deliveryDate)}${order.deliveryTime ? ` · ${order.deliveryTime}` : ""}
Pago: ${order.paymentMethod}
${notesText}
Productos:
${lines}

TOTAL: $${money(total)}`
  );
}
function printTicket(order: any) {
  // Helpers locales (para que sea 100% copy/paste)
  const money2 = (v: any) => {
    const n = Number(v ?? 0);
    return isNaN(n) ? "0.00" : n.toFixed(2);
  };

  const clamp = (s: any, n: number) => {
    const str = String(s ?? "");
    return str.length > n ? str.slice(0, n - 1) + "…" : str;
  };

  const formatDateLocal = (d: string | Date) => {
    const dt = typeof d === "string" ? new Date(d) : d;
    return dt.toLocaleDateString("es-MX", { day: "2-digit", month: "2-digit", year: "numeric" });
  };

  const total =
    order.total ??
    order.items.reduce((acc: number, it: any) => acc + Number(it.subtotal ?? 0), 0);

  // ✅ Tamaño que pediste
  const W_MM = 48;
  const H_MM = 210;

  // ✅ Ajustes para que quepa en 48mm sin que se vaya a 2 páginas
  const FONT_PX = 9; // 8-10
  const HEADER_PX = 11;

  const now = new Date();
  const nowDate = formatDateLocal(now);
  const nowTime = now.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });

  // Productos EXACTO como el modal (• Nombre — qty unit)
  // Solo recortamos por ancho (48mm es angosto)
  const productsHtml = (order.items ?? [])
    .map((it: any) => {
      const qty = String(it.quantity);
      const unit = it.product?.unitType === "METER" ? "m" : "pza";
      const name = clamp(it.product?.name ?? "Producto", 26);
      return `<div class="line">• ${name} — ${qty} ${unit}</div>`;
    })
    .join("");

  // Leyendas EXACTO como el modal
  const footerHtml = `
    <div class="footLine">---</div>
    <div class="footLine">REVISA TU MATERIAL A LA ENTREGA, SALIDA LA MERCANCIA</div>
    <div class="footLine">NO HAY CAMBIOS NI DEVOLUCIONES AL SOLICITAR EL TRABAJO</div>
    <div class="footLine">ACEPTAS LOS TERMINOS Y CONDICIONES DE LOS SERVICIOS,</div>
    <div class="footLine">PUEDES CONSULTARLOS EN www.signasublimacion.com</div>
    <div class="footLine bold" style="margin-top:2mm;">GRACIAS POR TU COMPRA</div>
  `;
  const html = `
  <html>
    <head>
      <meta charset="utf-8" />
      <style>
        @page {
          size: ${W_MM}mm ${H_MM}mm;
          margin: 0;
        }
        * { box-sizing: border-box; }

        html, body {
          width: ${W_MM}mm;
          height: ${H_MM}mm;
          margin: 0;
          padding: 0;
          overflow: hidden;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
          font-size: ${FONT_PX}px;
          line-height: 1.2;
        }

        .ticket {
          width: ${W_MM}mm;
          height: ${H_MM}mm;
          padding: 5mm 3mm;
          overflow: hidden;
        }

        .center { text-align: center; }
        .bold { font-weight: 700; }

        .dashBottom {
          border-bottom: 1px dashed #555;
          padding-bottom: 3mm;
          margin-bottom: 3mm;
        }
        .dashTop {
          border-top: 1px dashed #555;
          padding-top: 3mm;
          margin-top: 3mm;
        }

        .title {
          font-size: ${HEADER_PX}px;
          font-weight: 700;
          margin-bottom: 1mm;
        }

        .subTitle {
          font-size: ${FONT_PX}px;
          margin-bottom: 0.5mm;
        }

        .sectionTitle {
          font-weight: 700;
          font-size: ${HEADER_PX}px;
          margin-bottom: 2mm;
        }

        .line { margin-bottom: 1mm; }

        .kv { margin-bottom: 1mm; }
        .kv b { font-weight: 700; }

        .total {
          text-align: center;
          font-weight: 700;
          font-size: 16px;
          margin: 4mm 0 5mm 0;
        }

        .footer {
          text-align: center;
          font-size: 8px;
          line-height: 1.2;
        }

        .footLine { margin-bottom: 0.8mm; }

        /* ✅ Truco: evita saltos raros */
        .noBreak { break-inside: avoid; page-break-inside: avoid; }
      </style>
    </head>
    <body>
      <div class="ticket">
        <div class="center title">SIGNA SUBLIMACION</div>

        <div class="center dashBottom noBreak">
          <div class="subTitle">Fecha: ${nowDate}, ${nowTime}</div>
          <div class="bold subTitle">Nombre: ${clamp(order.customer?.name ?? "—", 28)}</div>
          <div class="subTitle">${clamp(order.customer?.phone ?? "—", 20)}</div>
        </div>

        <div class="noBreak">
          <div class="sectionTitle">Productos</div>
          ${productsHtml || `<div class="line">• (Sin productos)</div>`}
        </div>

        <div class="dashTop noBreak">
          <div class="kv"><b>Fecha de entrega:</b> ${formatDateLocal(order.deliveryDate)}</div>
          <div class="kv"><b>Hora de entrega:</b> ${order.deliveryTime || "—"}</div>
          <div class="kv"><b>Forma de pago:</b> ${String(order.paymentMethod ?? "—")}</div>
        </div>

        <div class="total noBreak">
          TOTAL: $${money2(total)}
        </div>

        <div class="footer dashTop noBreak">
          ${footerHtml}
        </div>
      </div>

      <script>
        // ✅ Imprime una sola vez (evita dobles prints raros)
        (function(){
          let printed = false;
          const doPrint = () => {
            if (printed) return;
            printed = true;
            window.focus();
            window.print();
            // NO cierres súper rápido: algunos drivers térmicos "parten" o duplican
            setTimeout(() => window.close(), 1200);
          };
          window.addEventListener('load', () => setTimeout(doPrint, 60));
        })();
      </script>
    </body>
  </html>
  `;

  const w = window.open("", "_blank", "width=360,height=740,scrollbars=no,resizable=no");
  if (!w) return;
  w.document.open();
  w.document.write(html);
  w.document.close();
}

export default function ActiveOrders() {

  const navigate = useNavigate();
  const { user, logout } = useAuth();

  const [loadingOrderId, setLoadingOrderId] = useState<number | null>(null);
  const [loadingItemId, setLoadingItemId] = useState<number | null>(null);
  const [q, setQ] = useState("");
  const [deliveryFilter, setDeliveryFilter] = useState<DeliveryFilter>("ALL");
  const [exactDay, setExactDay] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ticketOrder, setTicketOrder] = useState<any | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);
  const [sortOrder, setSortOrder] = useState<"desc" | "asc">("desc");
  // Estados para edición
  const [editingOrderId, setEditingOrderId] = useState<number | null>(null);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [pendingEditAction, setPendingEditAction] = useState<(() => void) | null>(null);
  const [editingBranchId, setEditingBranchId] = useState<number | null>(null);
  const [editingBranchName, setEditingBranchName] = useState("");
  const [notification, setNotification] = useState<string | null>(null);
  const { isConnected } = useSocket();

  // Verificar si el usuario es  administrador
  const isAdmin = user?.role === "ADMIN";
  const isStaff = user?.role === "STAFF";
  function handleVerifyPassword(callback: () => void) {
    setPendingEditAction(() => callback);
    setShowPasswordModal(true);
  }

  // Envuelve la función load en useCallback
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getActiveOrders({ scope: "all" } as any);
      const sortedOrders = [...data.orders].sort((a, b) => {
        if (sortOrder === "desc") {
          return new Date(b.deliveryDate).getTime() - new Date(a.deliveryDate).getTime() || b.id - a.id;
        } else {
          return new Date(a.deliveryDate).getTime() - new Date(b.deliveryDate).getTime() || a.id - b.id;
        }
      });
      setOrders(sortedOrders);
    } catch (e: any) {
      setError(e?.message ?? "Error cargando pedidos");
    } finally {
      setLoading(false);
    }
  }, [sortOrder]); // Dependencias

  useEffect(() => {
    load();
  }, [load]);
  // En ActiveOrders.tsx, después de los otros useEffects:
  useEffect(() => {
    // Si el usuario está logueado pero el socket no está conectado después de 2 segundos,
    // forzar una recarga suave (opcional - puedes quitarlo si no quieres)
    if (user && !isConnected) {
      const timer = setTimeout(() => {
        load(); // Recargar datos por si acaso
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [user, isConnected, load]);
  const filtered = useMemo(() => {
    let out = [...orders];

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
        o.items.map((it: any) => it.product?.name ?? "").join(" "),
        o.notes ?? "",
      ];

      const haystack = normalizeText(haystackParts.join(" | "));
      return haystack.includes(t);
    });
  }, [orders, q, deliveryFilter, exactDay]);

  const totalPages = Math.ceil(filtered.length / itemsPerPage);
  const paginatedOrders = filtered.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  async function copyTicketText(order: any) {
    const text = buildWhatsText(order); // reutilizamos tu builder (ya trae todo lo importante)

    try {
      await navigator.clipboard.writeText(text);
      // Si quieres notificación global:
      // setNotification("📋 Ticket copiado");
    } catch {
      // Fallback para Safari / permisos raros
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.top = "-9999px";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      // setNotification("📋 Ticket copiado");
    }
  }
  const handleLogout = () => {
    logout();
    navigate("/login");
  };
  // Usar los eventos de socket
  useOrderEvents({
    onOrderCreated: (newOrder) => {
      setOrders(prev => {
        // Verificar si el pedido ya existe (por si acaso)
        if (prev.some(o => o.id === newOrder.id)) return prev;

        const updated = [newOrder, ...prev];
        // Ordenar según el orden actual
        return updated.sort((a, b) =>
          sortOrder === "desc"
            ? new Date(b.deliveryDate).getTime() - new Date(a.deliveryDate).getTime()
            : new Date(a.deliveryDate).getTime() - new Date(b.deliveryDate).getTime()
        );
      });
      setNotification(`🆕 Nuevo pedido #${newOrder.id} de ${newOrder.customer.name}`);
      setTimeout(() => setNotification(null), 3000);
    },
    onOrderUpdated: (updatedOrder) => {
      setOrders(prev => prev.map(o => {
        if (o.id !== updatedOrder?.id) return o;

        const merged: any = { ...o, ...updatedOrder };

        // Si el payload trae items pero vienen incompletos, NO los uses
        const incomingItems = Array.isArray(updatedOrder.items) ? updatedOrder.items : null;
        const looksIncomplete =
          incomingItems?.some((it: any) => !it?.product || !it?.steps);

        if (incomingItems && looksIncomplete) {
          merged.items = o.items; // conserva los completos
        }

        // Preserva creator si no viene
        if (!merged.creator && o.creator) merged.creator = o.creator;

        return merged;
      }));
    },

    onOrderDeleted: (orderId) => {
      setOrders(prev => prev.filter(o => o.id !== orderId));
      setNotification(`🗑️ Pedido #${orderId} eliminado`);
      setTimeout(() => setNotification(null), 2000);
    },

    onOrderStatusChanged: ({ orderId, stage }) => {
      setOrders(prev => prev.map(o =>
        o.id === orderId ? { ...o, stage } : o
      ));
    },

    onItemStepAdvanced: ({ itemId, orderId, step }) => {

      setOrders(prev => prev.map(o => {
        if (o.id !== orderId) return o;

        // Actualizar el item específico
        const updatedItems = o.items.map((it: any) => {
          if (it.id === itemId) {
            // Determinar si el item ahora está listo (si el paso actual es el último)
            const totalSteps = it.steps?.length || 0;
            const isReady = step >= totalSteps; // o la lógica que uses para determinar "listo"

            return {
              ...it,
              currentStepOrder: step,
              isReady: isReady // 👈 Actualizar isReady
            };
          }
          return it;
        });

        // Recalcular el estado del pedido (si todos los items están listos)
        const allReady = updatedItems.every((it: any) => it.isReady);

        return {
          ...o,
          items: updatedItems,
          stage: allReady ? "READY" : o.stage // Actualizar etapa si es necesario
        };
      }));
    },

    onOrderDelivered: (orderId) => {
      setOrders(prev => prev.map(o =>
        o.id === orderId ? { ...o, stage: "DELIVERED" } : o
      ));
      setNotification(`✅ Pedido #${orderId} entregado`);
      setTimeout(() => setNotification(null), 2000);
    },
  });
  return (
    <div className="min-h-screen bg-gray-50 p-4 md:p-6 lg:p-8">
      {/* Header con navegación */}
      <div className="bg-white rounded-2xl shadow-md p-6 mb-8 mx-auto max-w-7xl">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-800">Pedidos Activos</h1>
            {user && (
              <div className="text-sm text-gray-600 mt-2">
                <span className="font-medium">{user.name}</span> • {user.role} • {user.branchName || "Sin sucursal"}
                {isAdmin && (
                  <span className="ml-2 px-2 py-0.5 bg-purple-100 text-purple-800 text-xs font-semibold rounded-full">
                    Administrador
                  </span>
                )}
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-3">
            {/* Botones para STAFF */}
            {(isStaff || user?.role === "COUNTER") && (
              <>
                <button
                  onClick={() => navigate("/register")}
                  className="px-5 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2 shadow-sm"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                  </svg>
                  Registrar Cliente
                </button>

                <button
                  onClick={() => navigate("/orders/new")}
                  className="px-5 py-2.5 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors flex items-center gap-2 shadow-sm"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                  </svg>
                  Nueva Orden
                </button>
              </>
            )}

            {/* Botones para ADMIN */}
            {isAdmin && (
              <>
                <button
                  onClick={() => navigate("/admin/pricing")}
                  className="px-5 py-2.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors flex items-center gap-2 shadow-sm"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                  </svg>
                  Administrar Productos
                </button>

                <button
                  onClick={() => navigate("/admin/dashboard")}
                  className="px-5 py-2.5 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors flex items-center gap-2 shadow-sm"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                  Dashboard
                </button>

                <button
                  onClick={() => navigate("/admin/branches")}
                  className="px-5 py-2.5 bg-pink-600 text-white rounded-lg hover:bg-pink-700 transition-colors flex items-center gap-2 shadow-sm"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                  </svg>
                  Administrar Personal
                </button>
              </>
            )}

            {/* Botón de cerrar sesión para todos */}
            <button
              onClick={handleLogout}
              className="px-5 py-2.5 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors flex items-center gap-2 shadow-sm"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              Cerrar Sesión
            </button>
          </div>
        </div>
      </div>

      {/* Controles de búsqueda y filtros */}
      <div className="bg-white rounded-2xl shadow-md p-6 mb-8 mx-auto max-w-7xl">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1">
            <input
              type="text"
              placeholder="Buscar: folio, cliente, teléfono, producto, notas..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="w-full px-5 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-colors"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={load}
              disabled={loading}
              className="px-5 py-3 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 shadow-sm"
            >
              {loading ? (
                <>
                  <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                  </svg>
                  Cargando...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Actualizar
                </>
              )}
            </button>

            <button
              onClick={() => setSortOrder(sortOrder === "desc" ? "asc" : "desc")}
              className="px-5 py-3 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors flex items-center gap-2 shadow-sm"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={sortOrder === "desc" ? "M3 4h13M3 8h9M3 12h9m5-8v16m0-8l4 4m-4-4l-4 4" : "M3 4h13M3 8h9M3 12h9m5-8v16m0-8l4-4m-4 4l-4-4"} />
              </svg>
              {sortOrder === "desc" ? "Más recientes" : "Más antiguos"}
            </button>
          </div>
        </div>

        {/* Filtros de entrega */}
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium text-gray-700">Entregar:</span>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setDeliveryFilter("ALL")}
              className={`px-4 py-2 rounded-lg border transition-colors ${deliveryFilter === "ALL"
                ? "bg-gray-800 text-white border-gray-800 shadow-sm"
                : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                }`}
            >
              Todos
            </button>

            <button
              onClick={() => setDeliveryFilter("TODAY")}
              className={`px-4 py-2 rounded-lg border transition-colors ${deliveryFilter === "TODAY"
                ? "bg-blue-600 text-white border-blue-600 shadow-sm"
                : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                }`}
            >
              Hoy
            </button>

            <button
              onClick={() => setDeliveryFilter("TOMORROW")}
              className={`px-4 py-2 rounded-lg border transition-colors ${deliveryFilter === "TOMORROW"
                ? "bg-green-600 text-white border-green-600 shadow-sm"
                : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                }`}
            >
              Mañana
            </button>

            <button
              onClick={() => setDeliveryFilter("EXACT")}
              className={`px-4 py-2 rounded-lg border transition-colors ${deliveryFilter === "EXACT"
                ? "bg-purple-600 text-white border-purple-600 shadow-sm"
                : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                }`}
            >
              Día exacto
            </button>
          </div>

          {deliveryFilter === "EXACT" && (
            <input
              type="date"
              value={exactDay}
              onChange={(e) => setExactDay(e.target.value)}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 outline-none"
            />
          )}
        </div>

        {/* Controles de paginación */}
        <div className="mt-6 flex flex-wrap items-center justify-between pt-4 border-t border-gray-100">
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-600">Mostrar:</span>
            <select
              value={itemsPerPage}
              onChange={(e) => {
                setItemsPerPage(Number(e.target.value));
                setCurrentPage(1);
              }}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            >
              <option value="5">5</option>
              <option value="10">10</option>
              <option value="20">20</option>
              <option value="50">50</option>
            </select>
            <span className="text-sm text-gray-600">pedidos por página</span>
          </div>

          <div className="text-sm text-gray-600 bg-gray-50 px-4 py-2 rounded-lg">
            Mostrando <span className="font-semibold">{((currentPage - 1) * itemsPerPage) + 1}</span> - <span className="font-semibold">{Math.min(currentPage * itemsPerPage, filtered.length)}</span> de <span className="font-semibold">{filtered.length}</span> pedidos
          </div>
        </div>
      </div>

      {/* Mensajes de error */}
      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 mx-auto max-w-7xl">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            {error}
          </div>
        </div>
      )}

      {/* Sin resultados */}
      {!loading && !error && filtered.length === 0 && (
        <div className="text-center py-16 bg-white rounded-2xl shadow-md mx-auto max-w-7xl">
          <div className="text-gray-300 text-8xl mb-6">📦</div>
          <h3 className="text-2xl font-semibold text-gray-600 mb-3">No hay pedidos activos</h3>
          <p className="text-gray-500 mb-6">Crea una nueva orden o ajusta los filtros de búsqueda.</p>
          {isStaff && (
            <button
              onClick={() => navigate("/orders/new")}
              className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors inline-flex items-center gap-2"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
              </svg>
              Crear Nueva Orden
            </button>
          )}
        </div>
      )}

      {/* Lista de pedidos */}
      <div className="space-y-6 mx-auto max-w-7xl">
        {paginatedOrders.map((o) => {
          const readyCount = o.items.filter((i: any) => i.isReady).length;
          const totalCount = o.items.length;
          const total = o.total ?? o.items.reduce((acc: number, it: any) => acc + Number(it.subtotal ?? 0), 0);
          const deliveryStatus = getDeliveryStatus(o.deliveryDate, o.deliveryTime);
          const isDelivery = o.shippingType === "DELIVERY";
          const isPickup = o.shippingType === "PICKUP";
          const shipStage = o.shippingStage; // "SHIPPED" | "RECEIVED" | null

          return (
            <div key={o.id} className="bg-white rounded-2xl shadow-md overflow-hidden hover:shadow-lg transition-shadow duration-200">
              {/* Header del pedido con colores según estado */}
              <div className={`p-6 border-l-4 ${deliveryStatus === "overdue" ? "border-l-red-500 bg-red-50" :
                deliveryStatus === "today" ? "border-l-orange-500 bg-orange-50" :
                  "border-l-blue-500 bg-blue-50"
                }`}>

                <div className="flex flex-col lg:flex-row justify-between gap-6">
                  <div className="space-y-4 flex-1">
                    <div className="flex flex-wrap items-center gap-3">
                      <h2 className="text-2xl font-bold text-gray-800">Pedido #{o.id}</h2>
                      <span className={stageBadgeStyle(o.stage)}>
                        <span className={`w-2 h-2 rounded-full ${o.stage === "REGISTERED" ? "bg-gray-500" :
                          o.stage === "IN_PROGRESS" ? "bg-yellow-500" :
                            o.stage === "READY" ? "bg-green-500" :
                              "bg-blue-500"
                          }`}></span>
                        {stageLabel(o.stage)}
                      </span>
                      {isDelivery ? (
                        <span className="text-xs px-3 py-1 rounded-full border bg-indigo-50 border-indigo-200 text-indigo-700">
                          🚚 Envío {shipStage === "RECEIVED" ? "(Recibido)" : "(Pendiente/En tránsito)"}
                        </span>
                      ) : (
                        <span className="text-xs px-3 py-1 rounded-full border bg-gray-50 border-gray-200 text-gray-700">
                          🏬 Recoger en sucursal
                        </span>
                      )}

                      <span className={deliveryBadgeStyle(deliveryStatus)}>
                        <span className={`w-2 h-2 rounded-full ${deliveryStatus === "overdue" ? "bg-red-500" :
                          deliveryStatus === "today" ? "bg-orange-500" :
                            "bg-blue-500"
                          }`}></span>
                        {deliveryLabel(deliveryStatus)}
                      </span>

                      <span className="text-sm text-gray-600 bg-white px-3 py-1 rounded-full border">
                        📦 Items listos: {readyCount}/{totalCount}
                      </span>
                    </div>

                    <div className="space-y-3">
                      <div className="text-gray-700">
                        <span className="font-semibold">👤 Cliente:</span> {o.customer?.name || 'Cliente desconocido'} · <span className="text-blue-600">{o.customer?.phone || 'Sin teléfono'}</span>
                      </div>
                      <div className="text-gray-700">
                        <span className="font-semibold">🏭 Producción:</span> {o.branch?.name ?? "—"}
                        {o.pickupBranch && !isDelivery && (
                          <> · <span className="font-semibold">📍 Pickup:</span> {o.pickupBranch.name}</>
                        )}
                      </div>
                      {/* Después de la información de producción */}
                      {o?.creator ? (
                        <div className="bg-gray-50 p-3 rounded-lg border border-gray-200 mt-3">
                          <div className="flex items-center gap-2">
                            <div className={`p-1.5 rounded-full ${o.creator.role === 'COUNTER' ? 'bg-green-100' :
                              o.creator.role === 'STAFF' ? 'bg-blue-100' :
                                o.creator.role === 'PRODUCTION' ? 'bg-orange-100' : 'bg-purple-100'
                              }`}>
                              <User className={`w-3 h-3 ${o.creator.role === 'COUNTER' ? 'text-green-700' :
                                o.creator.role === 'STAFF' ? 'text-blue-700' :
                                  o.creator.role === 'PRODUCTION' ? 'text-orange-700' : 'text-purple-700'
                                }`} />
                            </div>
                            <div className="text-xs">
                              <p className="text-gray-500">Registrado por:</p>
                              <p className="font-medium text-gray-800">
                                {o.creator?.name || 'Desconocido'}
                                <span className="ml-2 text-gray-500 font-normal">
                                  ({o.creator?.role === 'COUNTER' ? 'Mostrador' :
                                    o.creator?.role === 'STAFF' ? 'Staff' :
                                      o.creator?.role === 'PRODUCTION' ? 'Producción' : 'Admin'})
                                </span>
                              </p>
                            </div>
                          </div>
                        </div>
                      ) : null}
                      {o.notes && (
                        <div className="text-gray-700 bg-yellow-50 p-4 rounded-xl border border-yellow-100">
                          <span className="font-semibold">📝 Notas:</span> {o.notes}
                        </div>
                      )}
                    </div>

                  </div>

                  <div className="lg:text-right space-y-4 min-w-[280px]">
                    <div className="space-y-2 bg-white p-4 rounded-xl border border-gray-100 shadow-sm">
                      <div className="text-gray-700">
                        <span className="font-semibold">📅 Entrega:</span> {formatDate(o.deliveryDate)}
                        {o.deliveryTime && <span className="ml-2 font-medium">· {o.deliveryTime}</span>}
                      </div>
                      <div className="text-gray-700">
                        <span className="font-semibold">💰 Pago:</span> {o.paymentMethod}
                      </div>
                      <div className="text-xl font-bold text-gray-900 pt-2 border-t border-gray-100">
                        Total: <span className="text-blue-700">${money(total)}</span>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-3 justify-end">
                      {/* Botón de Ticket - visible para todos EXCEPTO PRODUCTION */}
                      {user?.role !== "PRODUCTION" && (
                        <button
                          onClick={() => setTicketOrder(o)}
                          className="px-4 py-2.5 bg-gray-800 text-white rounded-lg hover:bg-gray-900 transition-colors flex items-center gap-2 shadow-sm"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                          </svg>
                          Ticket
                        </button>
                      )}
                      {/* Botones de edición según rol */}
                      {(isStaff || isAdmin || user?.role === "COUNTER") && (
                        <button
                          onClick={() => {
                            setEditingOrderId(o.id);
                            setEditingBranchId(o.branchId);
                            setEditingBranchName(o.branch.name);
                          }}
                          className="px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2 shadow-sm"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                          Editar
                        </button>
                      )}

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
                          className="px-4 py-2.5 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors flex items-center gap-2 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {loadingOrderId === o.id ? (
                            <>
                              <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                              </svg>
                              {o.shippingType === "DELIVERY" ? "Preparando envío..." : "Entregando..."}
                            </>
                          ) : (
                            <>
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                              </svg>
                              {o.shippingType === "DELIVERY" ? "Listo para envío" : "Entregar Pedido"}
                            </>
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Items del pedido */}
              <div className="p-6 space-y-4">
                {o.items.map((it: any) => {
                  const currentStepName = it.steps?.find((s: any) => s.order === it.currentStepOrder)?.name;
                  const unitPrice = it.unitPrice;
                  const subtotal = it.subtotal;

                  return (
                    <div key={it.id} className={`bg-gray-50 rounded-xl p-5 border ${it.isReady ? "border-green-200" : "border-gray-200"
                      }`}>
                      <div className="flex flex-col lg:flex-row justify-between gap-6">
                        <div className="space-y-3 flex-1">
                          <div className="flex flex-wrap items-start gap-3">
                            <h3 className="font-semibold text-gray-800 text-lg">
                              {it.product.name} · {String(it.quantity)} {it.product.unitType === "METER" ? "m" : "pza"}
                            </h3>
                            {it.variantRef && (
                              <span className="text-sm bg-blue-100 text-blue-800 px-3 py-1.5 rounded-full font-medium">
                                {it.variantRef.name}
                              </span>
                            )}
                          </div>

                          {it.options && it.options.length > 0 && (
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm text-gray-600 font-medium">Parámetros:</span>
                              {it.options.map((opt: any, idx: number) => (
                                <span key={idx} className="text-sm bg-purple-100 text-purple-800 px-3 py-1 rounded-full">
                                  {opt.name} {opt.priceDelta ? `(+$${money(opt.priceDelta)})` : ""}
                                </span>
                              ))}
                            </div>
                          )}

                          <div className="flex flex-wrap items-center gap-6 text-sm">
                            <div>
                              {it.isReady ? (
                                <span className="flex items-center gap-2 text-green-600 font-medium">
                                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                  </svg>
                                  Listo
                                </span>
                              ) : (
                                <span className="flex items-center gap-2 text-yellow-600 font-medium">
                                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                  </svg>
                                  {currentStepName ?? `Paso ${it.currentStepOrder}`}
                                </span>
                              )}
                            </div>

                            <div className="text-gray-700">
                              {unitPrice != null && (
                                <span className="font-medium">${money(unitPrice)} c/u</span>
                              )}
                              {subtotal != null && (
                                <span className="ml-3 font-bold text-gray-900">
                                  Subtotal: ${money(subtotal)}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center">
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
                            className={`px-5 py-2.5 rounded-xl border transition-colors flex items-center gap-2 ${it.isReady
                              ? "bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed"
                              : "bg-blue-600 text-white border-blue-600 hover:bg-blue-700 shadow-sm"
                              } ${loadingItemId === it.id ? "opacity-50 cursor-not-allowed" : ""}`}
                          >
                            {it.isReady ? (
                              <>
                                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                </svg>
                                Listo
                              </>
                            ) : loadingItemId === it.id ? (
                              <>
                                <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                                </svg>
                                Procesando...
                              </>
                            ) : (
                              <>
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                                </svg>
                                Avanzar Paso
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

            </div>

          );
        })}
      </div>

      {/* Paginación */}
      {totalPages > 1 && (
        <div className="mt-10 flex justify-center mx-auto max-w-7xl">
          <nav className="flex items-center gap-3">
            <button
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="px-5 py-2.5 bg-white border border-gray-300 rounded-xl hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 shadow-sm"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Anterior
            </button>

            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              let pageNum;
              if (totalPages <= 5) {
                pageNum = i + 1;
              } else if (currentPage <= 3) {
                pageNum = i + 1;
              } else if (currentPage >= totalPages - 2) {
                pageNum = totalPages - 4 + i;
              } else {
                pageNum = currentPage - 2 + i;
              }

              return (
                <button
                  key={pageNum}
                  onClick={() => setCurrentPage(pageNum)}
                  className={`px-5 py-2.5 rounded-xl transition-colors ${currentPage === pageNum
                    ? "bg-blue-600 text-white shadow-sm"
                    : "bg-white border border-gray-300 text-gray-700 hover:bg-gray-50"
                    }`}
                >
                  {pageNum}
                </button>
              );
            })}

            <button
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="px-5 py-2.5 bg-white border border-gray-300 rounded-xl hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 shadow-sm"
            >
              Siguiente
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </nav>
        </div>
      )}
      {/* Modal de edición */}
      <EditOrderModal
        isOpen={editingOrderId !== null}
        onClose={() => {
          setEditingOrderId(null);
          setEditingBranchId(null);
          setEditingBranchName("");
        }}
        orderId={editingOrderId!}
        onSuccess={load}
        userRole={user?.role || ""}
        onVerifyPassword={(callback) => {
          setPendingEditAction(() => callback);
          setShowPasswordModal(true);
        }}
      />

      {/* Modal de verificación de contraseña */}

      <PasswordVerifyModal
        isOpen={showPasswordModal}
        onClose={() => {
          setShowPasswordModal(false);
          setPendingEditAction(null);
          setEditingBranchId(null);
          setEditingBranchName("");
        }}
        onSuccess={() => {
          if (pendingEditAction) {
            pendingEditAction();
          }
        }}
        branchId={editingBranchId || 0}
        branchName={editingBranchName}
      />
      {/* Modal para ticket - DISEÑO COMO EN LA IMAGEN */}
      {ticketOrder && (
        <div
          onClick={() => setTicketOrder(null)}
          className="fixed inset-0 bg-black bg-opacity-25 flex items-center justify-center p-4 z-50"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-xl border border-gray-300 overflow-hidden w-full max-w-sm"
          >
            {/* Botones superiores */}
            <div className="p-3 flex gap-2 border-b border-gray-200">
              <button
                onClick={() => {
                  printTicket(ticketOrder);
                  setTicketOrder(null);
                }}
                className="px-4 py-2 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 transition-colors flex-1"
              >
                IMPRIMIR
              </button>
              <button
                onClick={async () => {
                  await copyTicketText(ticketOrder);
                  setNotification("📋 Ticket copiado");
                  setTimeout(() => setNotification(null), 2000);
                  setTicketOrder(null);
                }}
                className="px-4 py-2 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 transition-colors flex-1"
              >
                COPIAR
              </button>
              <button
                onClick={() => setTicketOrder(null)}
                className="px-4 py-2 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 transition-colors flex-1"
              >
                CERRAR
              </button>
            </div>

            {/* Ticket preview - DISEÑO COMO EN LA IMAGEN */}
            <div className="p-6 font-mono text-sm">
              <div className="text-center font-bold text-base mb-1">SIGNA SUBLIMACION</div>

              <div className="text-center border-b border-dashed border-gray-400 pb-3 mb-3">
                <div className="mb-1">Fecha: {formatDate(new Date())}, {new Date().toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })}</div>
                <div className="font-semibold">Nombre: {ticketOrder.customer.name}</div>
                <div>{ticketOrder.customer.phone}</div>
              </div>

              <div className="mb-4">
                <div className="font-bold text-base mb-2">Productos</div>
                {ticketOrder.items.map((it: any) => {
                  const qty = String(it.quantity);
                  const unit = it.product.unitType === "METER" ? "m" : "pza";

                  return (
                    <div key={it.id} className="mb-1">
                      • {it.product.name} — {qty} {unit}
                    </div>
                  );
                })}
              </div>

              <div className="border-t border-dashed border-gray-400 pt-3 mb-4">
                <div className="mb-1"><span className="font-semibold">Fecha de entrega:</span> {formatDate(ticketOrder.deliveryDate)}</div>
                <div className="mb-1"><span className="font-semibold">Hora de entrega:</span> {ticketOrder.deliveryTime || "—"}</div>
                <div className="mb-1"><span className="font-semibold">Forma de pago:</span> {ticketOrder.paymentMethod}</div>
              </div>

              <div className="text-center font-bold text-xl mb-6">
                TOTAL: ${money(
                  ticketOrder.total ?? ticketOrder.items.reduce((acc: number, it: any) => acc + Number(it.subtotal ?? 0), 0)
                )}
              </div>

              <div className="text-center border-t border-dashed border-gray-400 pt-4 text-xs">
                <div className="mb-1">---</div>
                <div>REVISA TU MATERIAL A LA ENTREGA, SALIDA LA MERCANCIA</div>
                <div>NO HAY CAMBIOS NI DEVOLUCIONES AL SOLICITAR EL TRABAJO</div>
                <div>ACEPTAS LOS TERMINOS Y CONDICIONES DE LOS SERVICIOS,</div>
                <div>PUEDES CONSULTARLOS EN www.signasublimacion.com</div>
                <div className="font-bold mt-2">GRACIAS POR TU COMPRA</div>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Indicador de conexión */}
      {!isConnected && (
        <div className="fixed bottom-4 right-4 bg-yellow-100 border border-yellow-300 text-yellow-800 px-4 py-2 rounded-lg shadow-lg flex items-center gap-2 z-50">
          <div className="w-2 h-2 bg-yellow-500 rounded-full animate-pulse"></div>
          <span>Reconectando...</span>
        </div>
      )}

      {/* Notificaciones */}
      {notification && (
        <div className="fixed top-4 right-4 bg-blue-600 text-white px-4 py-3 rounded-lg shadow-lg z-50 animate-in slide-in-from-top-5 fade-in">
          {notification}
        </div>
      )}
    </div>
  );
}