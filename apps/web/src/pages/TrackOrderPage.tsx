import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Check, CircleAlert, Clock3, Loader2, RefreshCw } from "lucide-react";
import { ApiError } from "../api/http";
import {
  getPublicOrderTracking,
  type PublicTrackingOrder,
} from "../api/publicTracking";
import {
  formatTrackingDate,
  getTrackingTimeline,
  PublicTrackingRequestCoordinator,
} from "../lib/trackOrder";

function isNotFound(error: unknown) {
  return error instanceof ApiError && error.status === 404;
}

function mainStatusLabel(order: PublicTrackingOrder) {
  if (order.publicStatus === "DELIVERED") return "Pedido entregado";
  if (order.publicStatus === "SHIPPED") return "Pedido enviado";
  if (order.publicStatus === "READY_FOR_PICKUP") return "Listo para entrega";
  if (order.publicStatus === "READY_FOR_SHIPPING") return "Listo para envío";
  if (order.publicStatus === "IN_PRODUCTION") return "En producción";
  return "Pedido registrado";
}

function mainStatusDescription(order: PublicTrackingOrder) {
  if (order.publicStatus === "DELIVERED") return "Tu pedido ha sido entregado.";
  if (order.publicStatus === "SHIPPED") return "Tu pedido ha sido enviado.";
  if (order.publicStatus === "READY_FOR_PICKUP") return "Tu pedido está listo para entrega.";
  if (order.publicStatus === "READY_FOR_SHIPPING") return "Tu pedido está listo para envío.";
  if (order.publicStatus === "IN_PRODUCTION") return "Estamos trabajando en tu pedido.";
  return "Recibimos tu pedido y ya está en nuestra agenda.";
}

export default function TrackOrderPage() {
  const { token = "" } = useParams<{ token: string }>();
  const [stateToken, setStateToken] = useState(token);
  const [order, setOrder] = useState<PublicTrackingOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [temporaryError, setTemporaryError] = useState(false);
  const orderRef = useRef<PublicTrackingOrder | null>(null);
  const requestCoordinatorRef = useRef<PublicTrackingRequestCoordinator | null>(null);
  if (!requestCoordinatorRef.current) {
    requestCoordinatorRef.current = new PublicTrackingRequestCoordinator();
  }
  const requestCoordinator = requestCoordinatorRef.current;
  requestCoordinator.selectToken(token);

  const load = useCallback(async () => {
    if (!token) {
      setLoading(false);
      setNotFound(true);
      return;
    }
    const request = requestCoordinator.begin(token);
    if (!request) return;

    setRefreshing(true);
    try {
      const nextOrder = await getPublicOrderTracking(token);
      if (!requestCoordinator.isCurrent(request)) return;
      orderRef.current = nextOrder;
      setOrder(nextOrder);
      setNotFound(false);
      setTemporaryError(false);
    } catch (error) {
      if (!requestCoordinator.isCurrent(request)) return;
      if (isNotFound(error)) {
        orderRef.current = null;
        setOrder(null);
        setNotFound(true);
      } else if (orderRef.current) {
        setTemporaryError(true);
      } else {
        setNotFound(true);
      }
    } finally {
      if (requestCoordinator.finish(request)) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [requestCoordinator, token]);

  useEffect(() => {
    setStateToken(token);
    orderRef.current = null;
    setOrder(null);
    setLoading(true);
    setNotFound(false);
    setTemporaryError(false);
    void load();
  }, [load, token]);

  useEffect(() => {
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    const interval = window.setInterval(refreshWhenVisible, 60_000);
    document.addEventListener("visibilitychange", refreshWhenVisible);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [load]);

  if (stateToken !== token || loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
        <div className="flex flex-col items-center gap-4 text-center" role="status" aria-live="polite">
          <Loader2 className="h-8 w-8 animate-spin text-indigo-600" aria-hidden="true" />
          <p className="text-sm font-medium text-slate-600">Consultando el estado de tu pedido...</p>
        </div>
      </main>
    );
  }

  if (notFound || !order) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
        <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm sm:p-8" aria-labelledby="tracking-error-title">
          <CircleAlert className="mx-auto h-10 w-10 text-slate-400" aria-hidden="true" />
          <h1 id="tracking-error-title" className="mt-4 text-2xl font-bold text-slate-900">Pedido no encontrado</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">El enlace no es válido o ya no está disponible.</p>
        </section>
      </main>
    );
  }

  const timeline = getTrackingTimeline(order.shippingType);
  const currentIndex = timeline.findIndex((step) => step.status === order.publicStatus);
  const estimatedReadyAt = formatTrackingDate(order.estimatedReadyAt);
  const isFinal = order.publicStatus === "DELIVERED" || order.publicStatus === "SHIPPED";

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900 sm:py-12">
      <div className="mx-auto w-full max-w-2xl">
        <header className="mb-6 text-center sm:mb-8">
          <p className="text-sm font-black uppercase tracking-[0.25em] text-indigo-600">SIGNA</p>
          <h1 className="mt-3 text-2xl font-bold tracking-tight sm:text-3xl">Seguimiento de pedido</h1>
        </header>

        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" aria-labelledby="tracking-order-title">
          <div className="border-b border-slate-100 p-5 sm:p-7">
            <p className="text-sm font-medium text-slate-500">Número de pedido</p>
            <h2 id="tracking-order-title" className="mt-1 text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">
              #{order.orderNumber}
            </h2>

            <div className="mt-6 rounded-xl border border-indigo-100 bg-indigo-50 p-4 sm:p-5" aria-live="polite">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-indigo-700">Estado actual</p>
              <p className="mt-2 text-xl font-bold text-indigo-950 sm:text-2xl">{mainStatusLabel(order)}</p>
              <p className="mt-1 text-sm leading-6 text-indigo-900">{mainStatusDescription(order)}</p>
            </div>
          </div>

          <div className="p-5 sm:p-7">
            <h3 className="text-base font-bold text-slate-950">Progreso del pedido</h3>
            <ol className="mt-6" aria-label="Progreso del pedido">
              {timeline.map((step, index) => {
                const completed = index <= currentIndex;
                const current = index === currentIndex;
                const finalStep = index === timeline.length - 1;

                return (
                  <li key={step.status} className="relative flex gap-4 pb-7 last:pb-0">
                    {!finalStep && (
                      <span
                        className={`absolute left-[15px] top-8 h-[calc(100%-1.5rem)] w-px ${index < currentIndex ? "bg-emerald-500" : "bg-slate-200"}`}
                        aria-hidden="true"
                      />
                    )}
                    <span
                      className={`relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 ${completed ? "border-emerald-500 bg-emerald-500 text-white" : "border-slate-300 bg-white text-slate-400"}`}
                      aria-hidden="true"
                    >
                      {completed ? <Check className="h-4 w-4" strokeWidth={3} /> : <span className="h-2 w-2 rounded-full bg-current" />}
                    </span>
                    <div className="min-w-0 pt-1">
                      <p className={`break-words text-sm font-semibold ${current ? "text-slate-950" : completed ? "text-slate-700" : "text-slate-400"}`}>
                        {step.label}
                        {current && <span className="ml-2 inline-block rounded-full bg-indigo-100 px-2 py-0.5 align-middle text-xs font-bold text-indigo-700">Actual</span>}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        {completed ? (current ? "Estado actual" : "Completado") : "Pendiente"}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ol>

            {!isFinal && (
              <div className="mt-7 flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
                <Clock3 className="mt-0.5 h-5 w-5 shrink-0 text-indigo-600" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="text-sm font-bold text-slate-800">Fecha estimada</p>
                  <p className="mt-1 break-words text-sm text-slate-600">{estimatedReadyAt ?? "Fecha estimada no disponible"}</p>
                </div>
              </div>
            )}

            {isFinal && (
              <div className="mt-7 rounded-xl border border-emerald-200 bg-emerald-50 p-4" role="status">
                <p className="font-bold text-emerald-900">✓ {mainStatusLabel(order)}</p>
                <p className="mt-1 text-sm text-emerald-800">{mainStatusDescription(order)}</p>
              </div>
            )}

            {temporaryError && (
              <p className="mt-5 text-sm text-amber-700" role="status">No pudimos actualizar el estado. Conservamos la última información disponible.</p>
            )}

            <button
              type="button"
              onClick={() => void load()}
              disabled={refreshing}
              className="mt-7 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-indigo-600 bg-indigo-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} aria-hidden="true" />
              {refreshing ? "Actualizando..." : "Actualizar estado"}
            </button>
          </div>
        </section>

        <p className="mt-6 text-center text-xs leading-5 text-slate-500">La información se actualiza automáticamente mientras esta página esté visible.</p>
      </div>
    </main>
  );
}
