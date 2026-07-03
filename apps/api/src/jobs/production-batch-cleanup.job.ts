import { prisma } from "../lib/prisma";

const DEFAULT_INTERVAL_MS = 10 * 60 * 1000;

let started = false;
let running = false;

export async function cleanupExpiredProductionBatches() {
  const result = await prisma.productionBatch.deleteMany({
    where: {
      readyAt: { lte: new Date() },
    },
  });

  console.log(`Production batch cleanup deleted ${result.count} expired batches.`);
  return result.count;
}

export function startProductionBatchCleanupJob() {
  if (started) return;
  started = true;

  const run = async () => {
    if (running) return;
    running = true;
    try {
      await cleanupExpiredProductionBatches();
    } catch (error: any) {
      console.error("Error en cleanup de batches de producción:", error?.message ?? error);
    } finally {
      running = false;
    }
  };

  void run();
  setInterval(run, DEFAULT_INTERVAL_MS).unref?.();
}
