import { retryPendingOrderFileDeletes } from "../services/order-file.service";

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;

let started = false;

export function startOrderFileCleanupJob() {
  if (started) return;
  started = true;

  const run = async () => {
    try {
      await retryPendingOrderFileDeletes();
    } catch (error: any) {
      console.error("Error en cleanup de archivos de pedidos:", error?.message ?? error);
    }
  };

  setTimeout(run, 30 * 1000).unref?.();
  setInterval(run, DEFAULT_INTERVAL_MS).unref?.();
}
