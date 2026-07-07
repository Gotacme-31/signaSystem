// ActiveOrders.tsx - Versión con pedidos desplegables y colores mejorados

import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getActiveOrders, type ActiveOrder } from "../api/ordersActive";
import { nextOrderItemStep, deliverOrder } from "../api/activeOrders";
import {
  deleteOrderFile,
  downloadOrderFile,
  getOrderFiles,
  uploadOrderFile,
  type OrderFileMetadata,
} from "../api/orderFiles";
import { useAuth } from "../auth/useAuth";
import EditOrderModal from "./components/EditOrderModal";
import PasswordVerifyModal from "./components/PasswordVerifyModal";
import { PackageCheck, User, ChevronDown, ChevronUp, Clock, Paperclip, Upload, Download, Trash2, Loader2 } from "lucide-react";
import { useOrderEvents } from "../hooks/useSocket";
import { useSocket } from "../contexts/SocketContext";
import {
  addBusinessDays,
  formatDateInBusinessTimeZone,
  formatTimeInBusinessTimeZone,
  safeDateKey,
  safeTimeKey,
  todayBusinessDateKey,
  todayBusinessTimeKey,
} from "../lib/businessTime";

// Función para obtener el color del producto según su estado
function getItemStatusStyle(item: any) {
  if (item.isReady) {
    return {
      bg: "bg-green-100",
      border: "border-green-400",
      text: "text-green-800",
      badge: "bg-green-500",
      label: "✅ Terminado"
    };
  }

  // Si tiene currentStepOrder > 1 o está en proceso
  if (item.currentStepOrder > 1 || (item.steps?.length > 0 && item.currentStepOrder > 1)) {
    return {
      bg: "bg-blue-100",
      border: "border-blue-400",
      text: "text-blue-800",
      badge: "bg-blue-500",
      label: "🔧 En producción"
    };
  }

  // Registrado (paso 1 o sin avance)
  return {
    bg: "bg-yellow-50",
    border: "border-yellow-300",
    text: "text-yellow-800",
    badge: "bg-yellow-500",
    label: "📝 Registrado"
  };
}

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
  const deliveryKey = safeDateKey(deliveryDate);
  if (!deliveryKey) return "upcoming";

  const todayKey = todayBusinessDateKey();
  const deliveryTimeKey = safeTimeKey(deliveryTime) || "23:59";
  const nowTimeKey = todayBusinessTimeKey();

  if (deliveryKey < todayKey || (deliveryKey === todayKey && deliveryTimeKey < nowTimeKey)) {
    return "overdue";
  } else if (deliveryKey === todayKey) {
    return "today";
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

function formatFileSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function fileStatusLabel(status: OrderFileMetadata["status"]) {
  if (status === "ACTIVE") return "Activo";
  if (status === "PENDING_DELETE") return "Pendiente de borrar";
  if (status === "DELETED") return "Archivo eliminado";
  return "Error al eliminar archivo";
}

function formatDate(d: string | Date) {
  return formatDateInBusinessTimeZone(d);
}

function formatTime(d: string | Date) {
  return formatTimeInBusinessTimeZone(d);
}

function formatDateTime(d: string | Date) {
  return `${formatDate(d)} · ${formatTime(d)}`;
}

function formatOrderDelivery(order: Pick<ActiveOrder, "deliveryDate" | "deliveryTime" | "estimatedReadyAt">) {
  if (order.deliveryDate) {
    return `${formatDate(order.deliveryDate)} ${order.deliveryTime ?? (order.estimatedReadyAt ? formatTime(order.estimatedReadyAt) : "")}`.trim();
  }

  return order.estimatedReadyAt ? formatDateTime(order.estimatedReadyAt) : "Sin fecha";
}

function formatDateTimeNow() {
  const dt = new Date();
  const date = formatDate(dt);
  const time = formatTime(dt);
  return { date, time };
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

      let productDisplayName = it.isCustomProduct ? (it.customProductName ?? "Producto libre") : (it.product?.name ?? "Desconocido");
      return `• ${productDisplayName}${paramsText} — ${qty} ${unit}${sub !== "" ? ` — $${money(sub)}` : ""}`;
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
Entrega: ${formatOrderDelivery(order)}
Pago: ${order.paymentMethod}
${notesText}
Productos:
${lines}

TOTAL: $${money(total)}`
  );
}

function printTicket(order: any) {
  const money2 = (v: any) => {
    const n = Number(v ?? 0);
    return isNaN(n) ? "0.00" : n.toFixed(2);
  };

  const clamp = (s: any, n: number) => {
    const str = String(s ?? "");
    return str.length > n ? str.slice(0, n - 1) + "…" : str;
  };

  const formatDateLocal = (d: string | Date) => {
    return formatDate(d);
  };

  const total =
    order.total ??
    order.items.reduce((acc: number, it: any) => acc + Number(it.subtotal ?? 0), 0);

  const W_MM = 48;
  const H_MM = 210;
  const FONT_PX = 9;
  const HEADER_PX = 11;

  const now = new Date();
  const nowDate = formatDateLocal(now);
  const nowTime = formatTime(now);

  // Productos con tamaño y parámetros
  const productsHtml = (order.items ?? [])
    .map((it: any) => {
      const qty = String(it.quantity);
      const unit = it.product?.unitType === "METER" ? "m" : "pza";
      let name = clamp(it.product?.name ?? "Producto", 24);

      // Agregar talla/variante si existe
      if (it.variantRef?.name) {
        name = `${name} (${it.variantRef.name})`;
      }

      // Agregar parámetros/opciones si existen
      let paramsText = "";
      if (it.options && it.options.length > 0) {
        const params = it.options.map((opt: any) => opt.name).join(", ");
        paramsText = ` [${clamp(params, 20)}]`;
      }

      return `<div class="line">• ${name}${paramsText} — ${qty} ${unit}</div>`;
    })
    .join("");

  const branchName = clamp(order.branch?.name ?? "SIGNA SUBLIMACION", 28);

  // Notas del pedido (si existen)
  const notesHtml = order.notes ? `
  <div class="dashTop noBreak">
    <div class="kv"><b>Notas:</b> ${String(order.notes ?? "").replace(/\n/g, "<br />")}</div>
  </div>
` : "";

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
          overflow-y: auto;
          overflow-x: hidden;
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

        .line { 
          margin-bottom: 1mm;
          word-break: break-word;
        }

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
        .noBreak { break-inside: avoid; page-break-inside: avoid; }
      </style>
    </head>
    <body>
      <div class="ticket">
        <div class="center title">${branchName}</div>

        <div class="center dashBottom noBreak">
          <div class="subTitle">Fecha: ${nowDate}, ${nowTime}</div>
          <div class="bold subTitle">Nombre: ${clamp(order.customer?.name ?? "—", 28)}</div>
          <div class="subTitle">${clamp(order.customer?.phone ?? "—", 20)}</div>
        </div>

        <div class="noBreak">
          <div class="sectionTitle">Productos</div>
          ${productsHtml || `<div class="line">• (Sin productos)</div>`}
        </div>

        ${notesHtml}

        <div class="dashTop noBreak">
          <div class="kv"><b>Entrega:</b> ${formatOrderDelivery(order)}</div>
          <div class="kv"><b>Forma de pago:</b> ${String(order.paymentMethod ?? "—")}</div>
        </div>

                <div class="dashTop noBreak">
          ${order.hasIva ? `
            <div class="kv" style="display:flex;justify-content:space-between;">
              <span><b>Subtotal:</b></span>
              <span>$${money2(order.subtotalBeforeTax)}</span>
            </div>

            <div class="kv" style="display:flex;justify-content:space-between;">
              <span><b>IVA (16%):</b></span>
              <span>$${money2(order.ivaAmount)}</span>
            </div>
          ` : ""}

          <div class="total noBreak">
            TOTAL: $${money2(total)}
          </div>
        </div>

        <div class="footer dashTop noBreak">
          ${footerHtml}
        </div>
      </div>

      <script>
        (function(){
          let printed = false;
          const doPrint = () => {
            if (printed) return;
            printed = true;
            window.focus();
            window.print();
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
  const [expandedOrders, setExpandedOrders] = useState<Set<number>>(new Set());
  const [orderFilesByOrderId, setOrderFilesByOrderId] = useState<Record<number, OrderFileMetadata[]>>({});
  const [loadingFilesOrderId, setLoadingFilesOrderId] = useState<number | null>(null);
  const [uploadingOrderId, setUploadingOrderId] = useState<number | null>(null);
  const [downloadingFileId, setDownloadingFileId] = useState<number | null>(null);
  const [deletingFileId, setDeletingFileId] = useState<number | null>(null);

  // Estados para edición
  const [editingOrderId, setEditingOrderId] = useState<number | null>(null);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [pendingEditAction, setPendingEditAction] = useState<(() => void) | null>(null);
  const [editingBranchId, setEditingBranchId] = useState<number | null>(null);
  const [editingBranchName, setEditingBranchName] = useState("");
  const [notification, setNotification] = useState<string | null>(null);
  const { isConnected } = useSocket();

  // Verificar roles
  const isAdmin = user?.role === "ADMIN";
  const isStaff = user?.role === "STAFF";
  const isProduction = user?.role === "PRODUCTION";
  const isCounterLike = user?.role === "COUNTER" || user?.role === "MULTI_COUNTER";
  const canUploadFiles = isAdmin || isStaff || isCounterLike;
  const canDeleteFiles = isAdmin || isStaff;

  const syncOrderFileSummary = useCallback((orderId: number, files: OrderFileMetadata[]) => {
    setOrders(prev => prev.map((order) => {
      if (order.id !== orderId) return order;
      return {
        ...order,
        files: files
          .filter((file) => file.status === "ACTIVE")
          .map((file) => ({ id: file.id, orderItemId: file.orderItemId ?? null, status: file.status })),
      };
    }));
  }, []);

  const loadOrderFiles = useCallback(async (orderId: number) => {
    setLoadingFilesOrderId(orderId);
    try {
      const files = await getOrderFiles(orderId);
      setOrderFilesByOrderId(prev => ({ ...prev, [orderId]: files }));
      syncOrderFileSummary(orderId, files);
    } catch (e: any) {
      setError(e?.message ?? "Error cargando archivos del pedido");
    } finally {
      setLoadingFilesOrderId(null);
    }
  }, [syncOrderFileSummary]);

  const toggleOrderExpand = (orderId: number) => {
    setExpandedOrders(prev => {
      const newSet = new Set(prev);
      if (newSet.has(orderId)) {
        newSet.delete(orderId);
      } else {
        newSet.add(orderId);
        void loadOrderFiles(orderId);
      }
      return newSet;
    });
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getActiveOrders({
        scope: "all" as any,
        sortOrder: sortOrder
      });
      setOrders(data.orders);
    } catch (e: any) {
      setError(e?.message ?? "Error cargando pedidos");
    } finally {
      setLoading(false);
    }
  }, [sortOrder]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (user && !isConnected) {
      const timer = setTimeout(() => {
        load();
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [user, isConnected, load]);

  const filtered = useMemo(() => {
    let out = [...orders];

    const today = todayBusinessDateKey();
    if (deliveryFilter === "TODAY") {
      out = out.filter((o) => safeDateKey(o.deliveryDate) === today);
    }

    if (deliveryFilter === "TOMORROW") {
      const tomorrow = addBusinessDays(today, 1);
      out = out.filter((o) => safeDateKey(o.deliveryDate) === tomorrow);
    }

    if (deliveryFilter === "EXACT" && exactDay) {
      out = out.filter((o) => safeDateKey(o.deliveryDate) === exactDay);
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
    const text = buildWhatsText(order);

    try {
      await navigator.clipboard.writeText(text);
    } catch {
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
    }
  }

  async function handleUploadFile(orderId: number, file?: File | null) {
    if (!file) return;

    setUploadingOrderId(orderId);
    setError(null);
    try {
      await uploadOrderFile(orderId, file);
      await loadOrderFiles(orderId);
      setNotification(`Archivo agregado al pedido #${orderId}`);
      setTimeout(() => setNotification(null), 2500);
    } catch (e: any) {
      setError(e?.message ?? "Error subiendo archivo");
    } finally {
      setUploadingOrderId(null);
    }
  }

  async function handleDownloadFile(orderId: number, fileId: number, originalName?: string) {
    setDownloadingFileId(fileId);
    setError(null);
    try {
      await downloadOrderFile(orderId, fileId, originalName);
      await loadOrderFiles(orderId);
    } catch (e: any) {
      setError(e?.message ?? "Error descargando archivo");
    } finally {
      setDownloadingFileId(null);
    }
  }

  async function handleDeleteFile(orderId: number, fileId: number) {
    setDeletingFileId(fileId);
    setError(null);
    try {
      await deleteOrderFile(orderId, fileId);
      await loadOrderFiles(orderId);
      setNotification(`Archivo eliminado del pedido #${orderId}`);
      setTimeout(() => setNotification(null), 2500);
    } catch (e: any) {
      setError(e?.message ?? "Error eliminando archivo");
    } finally {
      setDeletingFileId(null);
    }
  }

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  useOrderEvents({
    onOrderCreated: (newOrder) => {
      setOrders(prev => {
        if (prev.some(o => o.id === newOrder.id)) return prev;
        const updated = [newOrder, ...prev];
        return updated.sort((a, b) =>
          sortOrder === "desc"
            ? b.id - a.id
            : a.id - b.id
        );
      });
      setNotification(`🆕 Nuevo pedido #${newOrder.id} de ${newOrder.customer.name}`);
      setTimeout(() => setNotification(null), 3000);
    },
    onOrderUpdated: (updatedOrder) => {
      setOrders(prev => prev.map(o => {
        if (o.id !== updatedOrder?.id) return o;
        const merged: any = { ...o, ...updatedOrder };
        const incomingItems = Array.isArray(updatedOrder.items) ? updatedOrder.items : null;
        const looksIncomplete =
          incomingItems?.some((it: any) => !it?.product || !it?.steps);
        if (incomingItems && looksIncomplete) {
          merged.items = o.items;
        }
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
        const updatedItems = o.items.map((it: any) => {
          if (it.id === itemId) {
            const totalSteps = it.steps?.length || 0;
            const isReady = step >= totalSteps;
            return {
              ...it,
              currentStepOrder: step,
              isReady: isReady
            };
          }
          return it;
        });
        const allReady = updatedItems.every((it: any) => it.isReady);
        return {
          ...o,
          items: updatedItems,
          stage: allReady ? "READY" : o.stage
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
    onOrderFilesChanged: ({ orderId }) => {
      void loadOrderFiles(orderId);
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
                {isProduction && (
                  <span className="ml-2 px-2 py-0.5 bg-orange-100 text-orange-800 text-xs font-semibold rounded-full">
                    Producción
                  </span>
                )}
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3 justify-start md:justify-end">
            {(isStaff || isCounterLike) && (
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

            {isAdmin && (
              <>
                <button
                  onClick={() => navigate("/admin/pedidos-entregados")}
                  className="px-5 py-2.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors flex items-center gap-2 shadow-sm whitespace-nowrap"
                >
                  <PackageCheck className="w-5 h-5" />
                  Pedidos entregados
                </button>
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
          </div>
        </div>

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

      {!loading && !error && filtered.length === 0 && (
        <div className="text-center py-16 bg-white rounded-2xl shadow-md mx-auto max-w-7xl">
          <div className="text-gray-300 text-8xl mb-6">📦</div>
          <h3 className="text-2xl font-semibold text-gray-600 mb-3">No hay pedidos activos</h3>
          <p className="text-gray-500 mb-6">Crea una nueva orden o ajusta los filtros de búsqueda.</p>
          {(isStaff || isCounterLike) && (
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

      {/* Lista de pedidos - Versión desplegable */}
      <div className="space-y-4 mx-auto max-w-7xl">
        {paginatedOrders.map((o) => {
          const readyCount = o.items.filter((i: any) => i.isReady).length;
          const totalCount = o.items.length;
          const total = o.total ?? o.items.reduce((acc: number, it: any) => acc + Number(it.subtotal ?? 0), 0);
          const deliveryStatus = getDeliveryStatus(o.deliveryDate, o.deliveryTime);
          const isDelivery = o.shippingType === "DELIVERY";
          const isExpanded = expandedOrders.has(o.id);
          const registrationTime = o.createdAt ? formatTime(o.createdAt) : null;
          const activeFileCount = (o.files ?? []).filter((file: any) => file.status === "ACTIVE").length;
          const orderFiles = orderFilesByOrderId[o.id] ?? [];

          return (
            <div key={o.id} className="bg-white rounded-2xl shadow-md overflow-hidden hover:shadow-lg transition-shadow duration-200">
              {/* Header compacto del pedido - SIEMPRE VISIBLE */}
              <div
                className={`p-4 cursor-pointer transition-colors ${isExpanded ? "border-b border-gray-100" : ""}`}
                onClick={() => toggleOrderExpand(o.id)}
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  {/* Lado izquierdo - info principal */}
                  <div className="flex flex-wrap items-center gap-3 flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h2 className="text-xl font-bold text-gray-800">#{o.id}</h2>
                      <span className={stageBadgeStyle(o.stage)}>
                        <span className={`w-2 h-2 rounded-full ${o.stage === "REGISTERED" ? "bg-gray-500" :
                          o.stage === "IN_PROGRESS" ? "bg-yellow-500" :
                            o.stage === "READY" ? "bg-green-500" : "bg-blue-500"
                          }`}></span>
                        {stageLabel(o.stage)}
                      </span>
                      {!isProduction && (
                        <span
                          className={`text-xs px-3 py-1 rounded-full border inline-flex items-center gap-1.5 ${o.hasIva
                            ? "bg-indigo-50 border-indigo-200 text-indigo-700"
                            : "bg-gray-50 border-gray-200 text-gray-500"
                            }`}
                        >
                          {o.hasIva ? "IVA incluido" : "Sin IVA"}
                        </span>
                      )}
                      {activeFileCount > 0 && (
                        <span className="text-xs px-3 py-1 rounded-full border inline-flex items-center gap-1.5 bg-emerald-50 border-emerald-200 text-emerald-700">
                          <Paperclip className="w-3 h-3" />
                          Con archivo{activeFileCount > 1 ? ` (${activeFileCount})` : ""}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2 text-gray-600">
                      <User className="w-4 h-4" />
                      <span className="font-medium truncate max-w-[150px]">{o.customer?.name || 'Cliente'}</span>
                    </div>

                    {registrationTime && (
                      <div className="flex items-center gap-1 text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded-full">
                        <Clock className="w-3 h-3" />
                        <span>{registrationTime}</span>
                      </div>
                    )}

                    <div className="text-sm text-gray-600">
                      📦 {readyCount}/{totalCount}
                    </div>
                  </div>

                  {/* Lado derecho - estado entrega y acciones */}
                  <div className="flex items-center gap-3">
                    <span className={deliveryBadgeStyle(deliveryStatus)}>
                      {deliveryLabel(deliveryStatus)}
                    </span>

                    {!isProduction && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setTicketOrder(o);
                        }}
                        className="px-3 py-1.5 bg-gray-800 text-white text-sm rounded-lg hover:bg-gray-900 transition-colors"
                      >
                        Ticket
                      </button>
                    )}

                    {!isProduction && (isStaff || isAdmin || isCounterLike) && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingOrderId(o.id);
                          setEditingBranchId(o.branchId);
                          setEditingBranchName(o.branch.name);
                        }}
                        className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors"
                      >
                        Editar
                      </button>
                    )}

                    {o.stage === "READY" && (
                      <button
                        disabled={loadingOrderId === o.id}
                        onClick={async (e) => {
                          e.stopPropagation();
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
                        className="px-3 py-1.5 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50"
                      >
                        {loadingOrderId === o.id ? "..." : (o.shippingType === "DELIVERY" ? "Enviar" : "Entregar")}
                      </button>
                    )}

                    <button className="p-1 hover:bg-gray-100 rounded-full transition-colors">
                      {isExpanded ? <ChevronUp className="w-5 h-5 text-gray-500" /> : <ChevronDown className="w-5 h-5 text-gray-500" />}
                    </button>
                  </div>
                </div>
              </div>

              {/* Contenido expandido - DETALLES COMPLETOS */}
              {isExpanded && (
                <div className="p-5 pt-0 space-y-5 animate-in slide-in-from-top-2 duration-200">
                  {/* Detalles adicionales del pedido */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t border-gray-100">
                    <div className="space-y-2">
                      <div className="text-sm">
                        <span className="font-semibold">📞 Teléfono:</span> {o.customer?.phone || 'Sin teléfono'}
                      </div>
                      <div className="text-sm">
                        <span className="font-semibold">🏭 Producción:</span> {o.branch?.name ?? "—"}
                      </div>
                      <div className="text-sm">
                        <span className="font-semibold">📅 Entrega:</span> {formatOrderDelivery(o)}
                      </div>
                      {o.pickupBranch && !isDelivery && (
                        <div className="text-sm">
                          <span className="font-semibold">📍 Recoger en:</span> {o.pickupBranch.name}
                        </div>
                      )}
                    </div>

                    <div className="space-y-2">
                      {!isProduction && (
                        <>
                          <div className="text-sm">
                            <span className="font-semibold">💰 Pago:</span> {o.paymentMethod}
                          </div>
                          <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 space-y-1">
                            {o.hasIva && (
                              <>
                                <div className="text-sm flex justify-between">
                                  <span className="text-gray-600">Subtotal:</span>
                                  <span className="font-semibold">${money(o.subtotalBeforeTax)}</span>
                                </div>

                                <div className="text-sm flex justify-between">
                                  <span className="text-gray-600">IVA:</span>
                                  <span className="font-semibold text-indigo-700">
                                    +${money(o.ivaAmount)}
                                  </span>
                                </div>
                              </>
                            )}

                            <div className="text-lg font-bold flex justify-between">
                              <span>Total:</span>
                              <span className="text-blue-700">${money(total)}</span>
                            </div>

                            <div className="text-xs">
                              <span
                                className={`inline-flex px-2 py-0.5 rounded-full border ${o.hasIva
                                  ? "bg-indigo-50 border-indigo-200 text-indigo-700"
                                  : "bg-gray-50 border-gray-200 text-gray-500"
                                  }`}
                              >
                                {o.hasIva ? "Con IVA" : "Sin IVA"}
                              </span>
                            </div>
                          </div>
                        </>
                      )}
                      {isDelivery && (
                        <div className="text-sm">
                          <span className="font-semibold">🚚 Estado envío:</span> {o.shippingStage === "RECEIVED" ? "Recibido" : "Pendiente/En tránsito"}
                        </div>
                      )}
                    </div>
                  </div>

                  {o.creator && (
                    <div className="bg-gray-50 p-3 rounded-xl border border-gray-200">
                      <div className="flex items-center gap-2">
                        <div className={`p-1.5 rounded-full ${o.creator.role === 'COUNTER' || o.creator.role === 'MULTI_COUNTER' ? 'bg-green-100' :
                          o.creator.role === 'STAFF' ? 'bg-blue-100' :
                            o.creator.role === 'PRODUCTION' ? 'bg-orange-100' : 'bg-purple-100'
                          }`}>
                          <User className={`w-3 h-3 ${o.creator.role === 'COUNTER' || o.creator.role === 'MULTI_COUNTER' ? 'text-green-700' :
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
                                o.creator?.role === 'MULTI_COUNTER' ? 'Mostrador Multi' :
                                o.creator?.role === 'STAFF' ? 'Staff' :
                                  o.creator?.role === 'PRODUCTION' ? 'Producción' : 'Admin'})
                            </span>
                          </p>
                        </div>
                      </div>
                    </div>
                  )}

                  {o.notes && (
                    <div className="text-gray-700 bg-yellow-50 p-4 rounded-xl border border-yellow-100">
                      <span className="font-semibold">📝 Notas:</span> {o.notes}
                    </div>
                  )}

                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <Paperclip className="w-5 h-5 text-slate-600" />
                        <div>
                          <h3 className="font-semibold text-gray-800">Archivos del pedido</h3>
                          <p className="text-xs text-gray-500">Disponibles para producción mientras el pedido esté activo.</p>
                        </div>
                      </div>

                      {canUploadFiles && (
                        <label className={`inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium cursor-pointer transition-colors ${uploadingOrderId === o.id
                          ? "bg-gray-200 text-gray-500 cursor-not-allowed"
                          : "bg-blue-600 text-white hover:bg-blue-700"
                          }`}
                        >
                          {uploadingOrderId === o.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                          {uploadingOrderId === o.id ? "Subiendo..." : "Subir archivo"}
                          <input
                            type="file"
                            className="hidden"
                            disabled={uploadingOrderId === o.id}
                            onChange={async (event) => {
                              const selected = event.target.files?.[0];
                              await handleUploadFile(o.id, selected);
                              event.target.value = "";
                            }}
                          />
                        </label>
                      )}
                    </div>

                    {loadingFilesOrderId === o.id ? (
                      <div className="flex items-center gap-2 text-sm text-gray-500">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Cargando archivos...
                      </div>
                    ) : orderFiles.length === 0 ? (
                      <div className="text-sm text-gray-500 bg-white border border-dashed border-slate-300 rounded-lg p-3">
                        Este pedido no tiene archivos cargados.
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {orderFiles.map((file) => {
                          const isActiveFile = file.status === "ACTIVE";
                          const isDeleting = deletingFileId === file.id;
                          const isDownloading = downloadingFileId === file.id;

                          return (
                            <div key={file.id} className="bg-white border border-slate-200 rounded-lg p-3 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="font-medium text-gray-800 truncate max-w-full">{file.originalName}</span>
                                  <span className={`text-xs px-2 py-0.5 rounded-full border ${isActiveFile
                                    ? "bg-green-50 border-green-200 text-green-700"
                                    : file.status === "DELETED"
                                      ? "bg-gray-50 border-gray-200 text-gray-500"
                                      : "bg-red-50 border-red-200 text-red-700"
                                    }`}
                                  >
                                    {fileStatusLabel(file.status)}
                                  </span>
                                </div>
                                <div className="text-xs text-gray-500 mt-1">
                                  {formatFileSize(file.sizeBytes)} · Subido {formatDate(file.uploadedAt)}
                                  {file.downloadedAt ? ` · Descargado ${formatDate(file.downloadedAt)}` : ""}
                                </div>
                              </div>

                              <div className="flex flex-wrap items-center gap-2">
                                <button
                                  type="button"
                                  disabled={!isActiveFile || isDownloading}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void handleDownloadFile(o.id, file.id, file.originalName);
                                  }}
                                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-300 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                  {isDownloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                                  Descargar
                                </button>

                                {canDeleteFiles && (
                                  <button
                                    type="button"
                                    disabled={!isActiveFile || isDeleting}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      void handleDeleteFile(o.id, file.id);
                                    }}
                                    className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-red-200 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed"
                                  >
                                    {isDeleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                                    Eliminar
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Items del pedido con colores mejorados */}
                  <div className="space-y-3">
                    <h3 className="font-semibold text-gray-700 text-lg">Productos</h3>
                    {o.items.map((it: any) => {
                      const itemStyle = getItemStatusStyle(it);

                      return (
                        <div key={it.id} className={`rounded-xl p-4 border-2 ${itemStyle.bg} ${itemStyle.border}`}>
                          <div className="flex flex-col lg:flex-row justify-between gap-4">
                            <div className="space-y-2 flex-1">
                              <div className="flex flex-wrap items-start gap-3">
                                <h4 className="font-semibold text-gray-800 text-base">
                                  {it.isCustomProduct ? (it.customProductName ?? "Producto libre") : (it.product?.name ?? "Desconocido")}
                                </h4>
                                {it.isCustomProduct && (
                                  <span className="text-xs bg-purple-200 text-purple-800 px-2 py-1 rounded font-medium">
                                    LIBRE
                                  </span>
                                )}
                                <span className={`text-sm font-bold px-3 py-1 rounded-full ${itemStyle.bg} ${itemStyle.text} border ${itemStyle.border}`}>
                                  {itemStyle.label}
                                </span>
                                <span className="text-sm bg-white px-3 py-1 rounded-full border border-gray-300">
                                  {String(it.quantity)} {it.isCustomProduct ? (it.customUnitType === "METER" ? "m" : "pza") : (it.product.unitType === "METER" ? "m" : "pza")}
                                </span>
                                {it.variantRef && (
                                  <span className="text-sm bg-blue-100 text-blue-800 px-3 py-1 rounded-full">
                                    {it.variantRef.name}
                                  </span>
                                )}
                              </div>

                              {it.options && it.options.length > 0 && (
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="text-sm text-gray-600">Parámetros:</span>
                                  {it.options.map((opt: any, idx: number) => (
                                    <span key={idx} className="text-sm bg-purple-100 text-purple-800 px-3 py-1 rounded-full">
                                      {opt.name}
                                      {!isProduction && opt.priceDelta ? `(+$${money(opt.priceDelta)})` : ""}
                                    </span>
                                  ))}
                                </div>
                              )}

                              <div className="flex flex-wrap items-center gap-4 text-sm">
                                {!it.isReady && (
                                  <div className="flex items-center gap-2">
                                    <div className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: itemStyle.badge.replace('bg-', '').replace('-500', '') }}></div>
                                    <span className={itemStyle.text}>
                                      {(() => {
                                        const currentStep = it.steps?.find((s: any) => s.order === it.currentStepOrder);
                                        if (currentStep) return currentStep.name;
                                        return `Paso ${it.currentStepOrder}`;
                                      })()}
                                    </span>
                                  </div>
                                )}

                                {!isProduction && it.unitPrice != null && (
                                  <div className="text-gray-700">
                                    <span className="font-medium">${money(it.unitPrice)} c/u</span>
                                    {it.subtotal != null && (
                                      <span className="ml-2 font-bold text-gray-900">
                                        Subtotal: ${money(it.subtotal)}
                                      </span>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>

                            <div className="flex items-center">
                              <button
                                disabled={it.isReady || loadingItemId === it.id}
                                onClick={async (e) => {
                                  e.stopPropagation();
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
                                className={`px-4 py-2 rounded-xl border transition-colors flex items-center gap-2 ${it.isReady
                                  ? "bg-green-500 text-white border-green-600 cursor-not-allowed opacity-70"
                                  : "bg-blue-600 text-white border-blue-600 hover:bg-blue-700 shadow-sm"
                                  } ${loadingItemId === it.id ? "opacity-50 cursor-not-allowed" : ""}`}
                              >
                                {it.isReady ? (
                                  <>
                                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                    </svg>
                                    Terminado
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
                                    Avanzar
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
              )}
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

      {/* Modales */}
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

      {/* Modal de ticket */}
      {/* Modal de ticket - VERSIÓN ACTUALIZADA con notas y tamaños */}
      {ticketOrder && !isProduction && (
        <div
          onClick={() => setTicketOrder(null)}
          className="fixed inset-0 bg-black bg-opacity-25 flex items-center justify-center p-4 z-50"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-xl border border-gray-300 overflow-hidden w-full max-w-sm max-h-[90vh] flex flex-col"
          >
            <div className="p-3 flex gap-2 border-b border-gray-200 shrink-0">
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

            {/* Ticket preview con scroll */}
            <div className="p-6 font-mono text-sm overflow-y-auto flex-1">
              <div className="text-center font-bold text-base mb-1">
                {ticketOrder.branch?.name ?? "SIGNA SUBLIMACION"}
              </div>
              <div className="text-center border-b border-dashed border-gray-400 pb-3 mb-3">
                <div className="mb-1">Fecha: {formatDate(new Date())}, {formatTime(new Date())}</div>
                <div className="font-semibold">Nombre: {ticketOrder.customer.name}</div>
                <div>{ticketOrder.customer.phone}</div>
              </div>

              <div className="mb-4">
                <div className="font-bold text-base mb-2">Productos</div>
                {ticketOrder.items.map((it: any) => {
                  let productName = it.isCustomProduct ? (it.customProductName ?? "Producto libre") : (it.product?.name ?? "Desconocido");

                  // Agregar talla/variante si existe
                  if (!it.isCustomProduct && it.variantRef?.name) {
                    productName = `${productName} (${it.variantRef.name})`;
                  }

                  const unit = it.isCustomProduct
                    ? (it.customUnitType === "METER" ? "m" : "pza")
                    : (it.product?.unitType === "METER" ? "m" : "pza");

                  // Agregar parámetros/opciones si existen
                  let paramsText = "";
                  if (it.options && it.options.length > 0) {
                    const params = it.options.map((opt: any) => opt.name).join(", ");
                    paramsText = ` [${params}]`;
                  }

                  return (
                    <div key={it.id} className="mb-1">
                      • {productName}{paramsText} — {it.quantity} {unit}
                    </div>
                  );
                })}
              </div>

              {ticketOrder.notes && (
                <div className="border-t border-dashed border-gray-400 pt-3 mb-4">
                  <div className="mb-1 whitespace-pre-wrap break-words">
                    <span className="font-semibold">Notas:</span> {ticketOrder.notes}
                  </div>
                </div>
              )}

              <div className="border-t border-dashed border-gray-400 pt-3 mb-4">
                <div className="mb-1"><span className="font-semibold">Entrega:</span> {formatOrderDelivery(ticketOrder)}</div>
                <div className="mb-1"><span className="font-semibold">Forma de pago:</span> {ticketOrder.paymentMethod}</div>
              </div>

              <div className="border-t border-dashed border-gray-400 pt-3 mb-6">
                {ticketOrder.hasIva && (
                  <>
                    <div className="flex justify-between text-sm mb-1">
                      <span>Subtotal:</span>
                      <span>${money(ticketOrder.subtotalBeforeTax)}</span>
                    </div>
                    <div className="flex justify-between text-sm mb-2">
                      <span>IVA:</span>
                      <span>+${money(ticketOrder.ivaAmount)}</span>
                    </div>
                  </>
                )}

                <div className="text-center font-bold text-xl">
                  TOTAL: ${money(
                    ticketOrder.total ?? ticketOrder.items.reduce((acc: number, it: any) => acc + Number(it.subtotal ?? 0), 0)
                  )}
                </div>
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
