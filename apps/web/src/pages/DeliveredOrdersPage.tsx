import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, Search, RefreshCw, Trash2 } from "lucide-react";
import { useAuth } from "../auth/useAuth";
import {
  deleteDeliveredOrderPermanent,
  getDeliveredOrders,
  type DeliveredOrder,
} from "../api/deliveredOrders";

function money(v: any) {
  const n = Number(v ?? 0);
  return isNaN(n) ? "0.00" : n.toFixed(2);
}

function formatDate(d: string | Date) {
  const dt = typeof d === "string" ? new Date(d) : d;
  return dt.toLocaleDateString("es-MX", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function formatDateTime(d?: string | null) {
  if (!d) return "-";
  const dt = new Date(d);
  return dt.toLocaleString("es-MX", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function DeliveredOrdersPage() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [orders, setOrders] = useState<DeliveredOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);

  const isAdmin = user?.role === "ADMIN";
  const hasQuery = q.trim().length > 0;

  const load = useCallback(async (searchText: string) => {
    const term = searchText.trim();

    if (!term) {
      setOrders([]);
      setError(null);
      setLoading(false);
      setCurrentPage(1);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const data = await getDeliveredOrders({ q: term });
      setOrders(data.orders ?? []);
      setCurrentPage(1);
    } catch (e: any) {
      setOrders([]);
      setError(e?.message ?? "Error cargando pedidos entregados");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!user) return;

    if (!isAdmin) {
      navigate("/admindashboard");
      return;
    }

    const timeout = window.setTimeout(() => {
      void load(q);
    }, 350);

    return () => window.clearTimeout(timeout);
  }, [user, isAdmin, navigate, q, load]);

  useEffect(() => {
    setCurrentPage(1);
  }, [itemsPerPage]);

  const totalPages = Math.max(1, Math.ceil(orders.length / itemsPerPage));

  const paginatedOrders = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    const end = currentPage * itemsPerPage;
    return orders.slice(start, end);
  }, [orders, currentPage, itemsPerPage]);

  const goToPage = (page: number) => {
    setCurrentPage(Math.min(Math.max(page, 1), totalPages));
  };

  const pageNumbers = useMemo(() => {
    const pages: number[] = [];
    const start = Math.max(1, currentPage - 2);
    const end = Math.min(totalPages, currentPage + 2);

    for (let i = start; i <= end; i++) pages.push(i);
    return pages;
  }, [currentPage, totalPages]);

  const handleDelete = async (id: number) => {
    const ok = window.confirm(
      `¿Borrar permanentemente el pedido #${id}? Esta acción no se puede deshacer.`
    );
    if (!ok) return;

    setDeletingId(id);
    setError(null);

    try {
      await deleteDeliveredOrderPermanent(id);
      setOrders((prev) => prev.filter((o) => o.id !== id));
    } catch (e: any) {
      setError(e?.message ?? "Error eliminando pedido");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-4 md:p-6 lg:p-8">
      <div className="bg-white rounded-2xl shadow-md p-6 mb-8 mx-auto max-w-7xl">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-800">Pedidos entregados</h1>
            <p className="text-sm text-gray-600 mt-2">
              Busca pedidos entregados y elimínalos permanentemente.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              onClick={() => void load(q)}
              disabled={!hasQuery}
              className="px-5 py-2.5 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors flex items-center gap-2 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
              Actualizar
            </button>

            <button
              onClick={() => navigate("/orders")}
              className="px-5 py-2.5 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors flex items-center gap-2 shadow-sm"
            >
              Volver
            </button>
          </div>
        </div>

        <div className="mt-6 flex flex-col md:flex-row gap-4">
          <div className="flex-1 relative">
            <Search className="w-4 h-4 text-gray-400 absolute left-4 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Buscar folio, cliente, teléfono, sucursal, producto, notas..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="w-full pl-11 pr-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-colors"
            />
          </div>
        </div>

        <div className="mt-6 flex flex-col md:flex-row items-center justify-between gap-4 pt-4 border-t border-gray-100">
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-600">Mostrar</span>
            <select
              value={itemsPerPage}
              onChange={(e) => setItemsPerPage(Number(e.target.value))}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            >
              <option value={5}>5</option>
              <option value={10}>10</option>
              <option value={20}>20</option>
              <option value={50}>50</option>
            </select>
            <span className="text-sm text-gray-600">pedidos por página</span>
          </div>

          <div className="text-sm text-gray-600 bg-gray-50 px-4 py-2 rounded-lg">
            {hasQuery ? (
              <>
                Mostrando{" "}
                <span className="font-semibold">
                  {orders.length === 0 ? 0 : (currentPage - 1) * itemsPerPage + 1}
                </span>
                {" - "}
                <span className="font-semibold">
                  {Math.min(currentPage * itemsPerPage, orders.length)}
                </span>{" "}
                de <span className="font-semibold">{orders.length}</span> pedidos
              </>
            ) : (
              <>Escribe algo en el buscador para ver resultados</>
            )}
          </div>
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 mx-auto max-w-7xl">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5" />
            {error}
          </div>
        </div>
      )}

      {!hasQuery ? (
        <div className="text-center py-16 bg-white rounded-2xl shadow-md mx-auto max-w-7xl">
          <div className="text-gray-300 text-8xl mb-6">🔎</div>
          <h3 className="text-2xl font-semibold text-gray-600 mb-3">
            Empieza a escribir para buscar pedidos
          </h3>
          <p className="text-gray-500 mb-6">
            La lista permanecerá vacía hasta que escribas algo en el buscador.
          </p>
        </div>
      ) : loading ? (
        <div className="text-center py-16 bg-white rounded-2xl shadow-md mx-auto max-w-7xl">
          <div className="text-gray-300 text-8xl mb-6">⌛</div>
          <h3 className="text-2xl font-semibold text-gray-600 mb-3">
            Buscando pedidos entregados...
          </h3>
        </div>
      ) : orders.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-2xl shadow-md mx-auto max-w-7xl">
          <div className="text-gray-300 text-8xl mb-6">📦</div>
          <h3 className="text-2xl font-semibold text-gray-600 mb-3">
            No se encontraron pedidos
          </h3>
          <p className="text-gray-500 mb-6">
            Intenta con otro término de búsqueda.
          </p>
        </div>
      ) : (
        <>
          <div className="space-y-6 mx-auto max-w-7xl">
            {paginatedOrders.map((o) => {
              const total =
                o.total ?? o.items.reduce((acc, it) => acc + Number(it.subtotal ?? 0), 0);

              return (
                <div key={o.id} className="bg-white rounded-2xl shadow-md overflow-hidden">
                  <div className="p-6 border-l-4 border-l-blue-500 bg-blue-50">
                    <div className="flex flex-col lg:flex-row justify-between gap-6">
                      <div className="space-y-4 flex-1">
                        <div className="flex flex-wrap items-center gap-3">
                          <h2 className="text-2xl font-bold text-gray-800">
                            Pedido #{o.id}
                          </h2>
                          <span className="text-xs px-3 py-1 rounded-full border bg-blue-50 border-blue-200 text-blue-700">
                            Entregado
                          </span>
                          <span className="text-xs px-3 py-1 rounded-full border bg-gray-50 border-gray-200 text-gray-700">
                            {o.shippingType === "DELIVERY" ? "Envío" : "Recoger"}
                          </span>
                        </div>

                        <div className="text-sm text-gray-700">
                          <div className="mb-1">
                            <span className="font-semibold">Cliente:</span>{" "}
                            {o.customer?.name}{" "}
                            <span className="text-blue-600">{o.customer?.phone}</span>
                          </div>
                          <div className="mb-1">
                            <span className="font-semibold">Sucursal:</span>{" "}
                            {o.branch?.name}
                          </div>
                          {o.pickupBranch?.name && (
                            <div className="mb-1">
                              <span className="font-semibold">Pickup:</span>{" "}
                              {o.pickupBranch.name}
                            </div>
                          )}
                        </div>

                        {o.notes && (
                          <div className="text-gray-700 bg-yellow-50 p-4 rounded-xl border border-yellow-100">
                            <span className="font-semibold">Notas:</span> {o.notes}
                          </div>
                        )}

                        <div className="p-6 space-y-4">
                          {o.items.map((it) => (
                            <div
                              key={it.id}
                              className="bg-gray-50 rounded-xl p-5 border border-gray-200"
                            >
                              <div className="flex flex-col lg:flex-row justify-between gap-4">
                                <div className="space-y-2 flex-1">
                                  <h3 className="font-semibold text-gray-800 text-lg">
                                    {it.isCustomProduct ? (it.customProductName ?? "Producto libre") : (it.product?.name ?? it.productNameSnapshot)}{" "}
                                    <span className="ml-2 text-gray-500 font-normal">
                                      x {String(it.quantity)}
                                    </span>
                                    {it.isCustomProduct && (
                                      <span className="ml-2 text-xs bg-purple-200 text-purple-800 px-2 py-0.5 rounded font-medium">
                                        LIBRE
                                      </span>
                                    )}
                                  </h3>

                                  <div className="flex flex-wrap items-center gap-6 text-sm">
                                    <span className="text-gray-600">
                                      <span className="font-semibold">Unidad:</span>{" "}
                                      {it.isCustomProduct ? (it.customUnitType ?? it.unitTypeSnapshot) : (it.product?.unitType ?? it.unitTypeSnapshot)}
                                    </span>
                                  </div>
                                </div>

                                <div className="lg:text-right space-y-2 min-w-[180px]">
                                  <div className="text-xl font-bold text-gray-900 pt-2 border-t border-gray-100">
                                    Subtotal{" "}
                                    <span className="text-blue-700">
                                      ${money(it.subtotal)}
                                    </span>
                                  </div>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="lg:text-right space-y-4 min-w-[280px]">
                        <div className="space-y-2 bg-white p-4 rounded-xl border border-gray-100 shadow-sm">
                          <div className="text-gray-700">
                            <span className="font-semibold">Entrega:</span>{" "}
                            {formatDate(o.deliveryDate)}
                            {o.deliveryTime ? ` ${o.deliveryTime}` : ""}
                          </div>
                          <div className="text-gray-700">
                            <span className="font-semibold">Entregado:</span>{" "}
                            {formatDateTime(o.deliveredAt)}
                          </div>
                          <div className="text-gray-700">
                            <span className="font-semibold">Pago:</span>{" "}
                            {o.paymentMethod}
                          </div>
                          <div className="text-xl font-bold text-gray-900 pt-2 border-t border-gray-100">
                            Total{" "}
                            <span className="text-blue-700">${money(total)}</span>
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-3 justify-end">
                          <button
                            onClick={() => handleDelete(o.id)}
                            disabled={deletingId === o.id}
                            className="px-4 py-2.5 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors flex items-center gap-2 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            <Trash2 className="w-4 h-4" />
                            {deletingId === o.id ? "Borrando..." : "Borrar"}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mx-auto max-w-7xl mt-8 bg-white rounded-2xl shadow-md p-4 flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="text-sm text-gray-600">
              Mostrando {Math.min((currentPage - 1) * itemsPerPage + 1, orders.length)}-
              {Math.min(currentPage * itemsPerPage, orders.length)} de {orders.length}
            </div>

            <div className="flex items-center gap-2 flex-wrap justify-center">
              <button
                onClick={() => goToPage(currentPage - 1)}
                disabled={currentPage === 1}
                className="px-3 py-2 rounded-lg border border-gray-300 bg-white text-gray-700 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-50"
              >
                Anterior
              </button>

              {pageNumbers[0] > 1 && (
                <>
                  <button
                    onClick={() => goToPage(1)}
                    className="px-3 py-2 rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                  >
                    1
                  </button>
                  {pageNumbers[0] > 2 && <span className="px-2 text-gray-400">…</span>}
                </>
              )}

              {pageNumbers.map((page) => (
                <button
                  key={page}
                  onClick={() => goToPage(page)}
                  className={`px-3 py-2 rounded-lg border transition-colors ${
                    page === currentPage
                      ? "bg-purple-600 text-white border-purple-600"
                      : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                  }`}
                >
                  {page}
                </button>
              ))}

              {pageNumbers[pageNumbers.length - 1] < totalPages && (
                <>
                  {pageNumbers[pageNumbers.length - 1] < totalPages - 1 && (
                    <span className="px-2 text-gray-400">…</span>
                  )}
                  <button
                    onClick={() => goToPage(totalPages)}
                    className="px-3 py-2 rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                  >
                    {totalPages}
                  </button>
                </>
              )}

              <button
                onClick={() => goToPage(currentPage + 1)}
                disabled={currentPage === totalPages}
                className="px-3 py-2 rounded-lg border border-gray-300 bg-white text-gray-700 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-50"
              >
                Siguiente
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}