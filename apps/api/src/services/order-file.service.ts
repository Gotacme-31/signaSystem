import path from "path";
import { OrderFileStatus, OrderFileType, OrderStage, Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import type { AuthedRequest } from "../middlewares/auth";
import {
  canAccessOrderByBranches,
  getAccessibleBranchIdsForUser,
} from "../lib/branchAccess";
import {
  createReadStream,
  deletePhysicalFile,
  fileExists,
  sanitizeOriginalName,
  sanitizeStorageError,
  saveUploadedTempFile,
} from "./order-file-storage.service";

type AuthUser = NonNullable<AuthedRequest["auth"]>;
type OrderFileAction = "upload" | "list" | "download" | "delete";

export class OrderFileCleanupError extends Error {
  readonly code = "ORDER_FILE_CLEANUP_PENDING";
  readonly status = 409;

  constructor() {
    super("No se pudieron eliminar todos los archivos físicos del pedido. Revisa el error y vuelve a intentar.");
    this.name = "OrderFileCleanupError";
  }
}

const ALLOWED_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "pdf",
  "tif",
  "tiff",
  "zip",
  "rar",
  "psd",
  "ai",
  "cdr",
]);

const STRICT_MIME_BY_EXT: Record<string, Set<string>> = {
  png: new Set(["image/png"]),
  jpg: new Set(["image/jpeg"]),
  jpeg: new Set(["image/jpeg"]),
  pdf: new Set(["application/pdf"]),
  tif: new Set(["image/tiff", "image/tif"]),
  tiff: new Set(["image/tiff", "image/tif"]),
  zip: new Set(["application/zip", "application/x-zip-compressed", "multipart/x-zip"]),
  rar: new Set(["application/vnd.rar", "application/x-rar-compressed", "application/octet-stream"]),
};

const BLOCKED_MIME_TYPES = new Set([
  "application/x-msdownload",
  "application/x-dosexec",
  "application/x-sh",
  "text/html",
]);

function parsePositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

function maxFileSizeBytes() {
  return parsePositiveInt(process.env.ORDER_FILE_MAX_MB, 300) * 1024 * 1024;
}

function maxFilesPerOrder() {
  return parsePositiveInt(process.env.ORDER_FILE_MAX_FILES_PER_ORDER, 10);
}

function deleteMaxAttempts() {
  return parsePositiveInt(process.env.ORDER_FILE_DELETE_MAX_ATTEMPTS, 5);
}

function retentionHours() {
  const parsed = Number(process.env.ORDER_FILE_RETENTION_HOURS ?? "0");
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return parsed;
}

function getExtension(originalName: string) {
  return path.extname(sanitizeOriginalName(originalName)).replace(/^\./, "").toLowerCase();
}

function validateUploadFile(input: { originalName: string; mimeType: string; sizeBytes: number }) {
  if (input.sizeBytes <= 0) {
    throw new Error("El archivo esta vacio");
  }

  if (input.sizeBytes > maxFileSizeBytes()) {
    throw new Error(`El archivo excede el limite de ${parsePositiveInt(process.env.ORDER_FILE_MAX_MB, 300)} MB`);
  }

  const ext = getExtension(input.originalName);
  if (!ext || !ALLOWED_EXTENSIONS.has(ext)) {
    throw new Error("Extension de archivo no permitida");
  }

  const normalizedMime = (input.mimeType || "application/octet-stream").toLowerCase();
  if (BLOCKED_MIME_TYPES.has(normalizedMime)) {
    throw new Error("Tipo de archivo no permitido");
  }

  const strictMime = STRICT_MIME_BY_EXT[ext];
  if (strictMime && !strictMime.has(normalizedMime) && normalizedMime !== "application/octet-stream") {
    throw new Error("El tipo MIME no coincide con la extension del archivo");
  }
}

function safeOrderFile(file: any) {
  return {
    id: file.id,
    orderId: file.orderId,
    orderItemId: file.orderItemId,
    originalName: file.originalName,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes,
    type: file.type,
    status: file.status,
    uploadedAt: file.uploadedAt,
    uploadedById: file.uploadedById,
    downloadedAt: file.downloadedAt,
    downloadedById: file.downloadedById,
    deletedAt: file.deletedAt,
  };
}

function canUseRoleForAction(role: string, action: OrderFileAction) {
  if (action === "upload") {
    return ["ADMIN", "STAFF", "COUNTER", "MULTI_COUNTER"].includes(role);
  }

  if (action === "delete") {
    return ["ADMIN", "STAFF"].includes(role);
  }

  return ["ADMIN", "STAFF", "COUNTER", "MULTI_COUNTER", "PRODUCTION"].includes(role);
}

async function getOrderForAccess(orderId: number) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      branchId: true,
      pickupBranchId: true,
      stage: true,
    },
  });

  if (!order) throw new Error("Pedido no encontrado");
  return order;
}

async function assertOrderAccess(authUser: AuthUser, orderId: number, action: OrderFileAction) {
  if (!canUseRoleForAction(authUser.role, action)) {
    throw new Error("No autorizado para esta accion");
  }

  const order = await getOrderForAccess(orderId);
  if (authUser.role === "ADMIN") return order;

  const accessibleBranchIds = await getAccessibleBranchIdsForUser(authUser);
  if (accessibleBranchIds.length === 0) {
    throw new Error("Usuario sin sucursal asignada");
  }

  if (authUser.role === "COUNTER" || authUser.role === "MULTI_COUNTER") {
    if (!accessibleBranchIds.includes(order.branchId)) {
      throw new Error("No autorizado para este pedido");
    }
    return order;
  }

  if (authUser.role === "PRODUCTION") {
    if (order.stage === OrderStage.DELIVERED) {
      throw new Error("No autorizado para archivos de pedidos entregados");
    }

    if (!canAccessOrderByBranches(authUser.role, accessibleBranchIds, order.branchId, order.pickupBranchId)) {
      throw new Error("No autorizado para este pedido");
    }
    return order;
  }

  if (!canAccessOrderByBranches(authUser.role, accessibleBranchIds, order.branchId, order.pickupBranchId)) {
    throw new Error("No autorizado para este pedido");
  }

  return order;
}

async function assertOrderItem(orderId: number, orderItemId?: number | null) {
  if (!orderItemId) return;

  const item = await prisma.orderItem.findFirst({
    where: { id: orderItemId, orderId },
    select: { id: true },
  });

  if (!item) {
    throw new Error("El producto indicado no pertenece al pedido");
  }
}

async function handleDeleteAttempt(file: { id: number; relativePath: string; deleteAttempts: number }) {
  try {
    await deletePhysicalFile(file.relativePath);
    return prisma.orderFile.update({
      where: { id: file.id },
      data: {
        status: OrderFileStatus.DELETED,
        deletedAt: new Date(),
        deleteAfter: null,
        lastDeleteError: null,
      },
    });
  } catch (error) {
    return prisma.orderFile.update({
      where: { id: file.id },
      data: {
        status: OrderFileStatus.DELETE_FAILED,
        deleteAttempts: { increment: 1 },
        lastDeleteError: sanitizeStorageError(error),
      },
    });
  }
}

export async function uploadOrderFile(args: {
  authUser: AuthUser;
  orderId: number;
  orderItemId?: number | null;
  tempPath: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  type?: OrderFileType;
}) {
  await assertOrderAccess(args.authUser, args.orderId, "upload");
  await assertOrderItem(args.orderId, args.orderItemId);

  validateUploadFile({
    originalName: args.originalName,
    mimeType: args.mimeType,
    sizeBytes: args.sizeBytes,
  });

  const saved = await saveUploadedTempFile({
    tempPath: args.tempPath,
    orderId: args.orderId,
    orderItemId: args.orderItemId,
    originalName: args.originalName,
  });

  try {
    const file = await prisma.$transaction(async (tx) => {
      const orders = await tx.$queryRaw<Array<{ id: number }>>`
        SELECT "id"
        FROM "Order"
        WHERE "id" = ${args.orderId}
        FOR UPDATE
      `;
      if (orders.length !== 1) {
        throw new Error("Pedido no encontrado");
      }
      const activeCount = await tx.orderFile.count({
        where: { orderId: args.orderId, status: OrderFileStatus.ACTIVE },
      });
      if (activeCount >= maxFilesPerOrder()) {
        throw new Error(`El pedido ya tiene el maximo de ${maxFilesPerOrder()} archivos activos`);
      }
      return tx.orderFile.create({
        data: {
          orderId: args.orderId,
          orderItemId: args.orderItemId ?? null,
          type: args.type ?? OrderFileType.ORIGINAL,
          originalName: sanitizeOriginalName(args.originalName),
          storedName: saved.storedName,
          relativePath: saved.relativePath,
          mimeType: args.mimeType || "application/octet-stream",
          sizeBytes: args.sizeBytes,
          uploadedById: args.authUser.userId,
        },
      });
    });

    return safeOrderFile(file);
  } catch (error) {
    await deletePhysicalFile(saved.relativePath).catch(() => undefined);
    throw error;
  }
}

export async function listOrderFiles(authUser: AuthUser, orderId: number) {
  await assertOrderAccess(authUser, orderId, "list");

  const files = await prisma.orderFile.findMany({
    where: { orderId },
    orderBy: [{ uploadedAt: "desc" }, { id: "desc" }],
  });

  return files.map(safeOrderFile);
}

export async function getOrderFileDownload(authUser: AuthUser, orderId: number, fileId: number) {
  await assertOrderAccess(authUser, orderId, "download");

  const file = await prisma.orderFile.findFirst({
    where: { id: fileId, orderId },
  });

  if (!file) throw new Error("Archivo no encontrado");
  if (file.status !== OrderFileStatus.ACTIVE) {
    throw new Error("El archivo no esta disponible para descarga");
  }

  const exists = await fileExists(file.relativePath);
  if (!exists) {
    throw new Error("El archivo fisico no existe");
  }

  await prisma.orderFile.update({
    where: { id: file.id },
    data: {
      downloadedAt: new Date(),
      downloadedById: authUser.userId,
    },
  });

  return {
    stream: createReadStream(file.relativePath),
    originalName: file.originalName,
    mimeType: file.mimeType || "application/octet-stream",
    sizeBytes: file.sizeBytes,
  };
}

export async function deleteOrderFile(authUser: AuthUser, orderId: number, fileId: number) {
  await assertOrderAccess(authUser, orderId, "delete");

  const file = await prisma.orderFile.findFirst({
    where: { id: fileId, orderId },
  });

  if (!file) throw new Error("Archivo no encontrado");
  if (file.status === OrderFileStatus.DELETED) return safeOrderFile(file);

  const updated = await handleDeleteAttempt(file);
  if (updated.status === OrderFileStatus.DELETE_FAILED) {
    throw new Error("No se pudo borrar el archivo fisico");
  }

  return safeOrderFile(updated);
}

export async function cleanupOrderFilesForDeliveredOrder(orderId: number) {
  const files = await prisma.orderFile.findMany({
    where: { orderId, status: OrderFileStatus.ACTIVE },
    select: { id: true, relativePath: true, deleteAttempts: true },
  });

  if (files.length === 0) return;

  const hours = retentionHours();
  if (hours > 0) {
    const deleteAfter = new Date(Date.now() + hours * 60 * 60 * 1000);
    await prisma.orderFile.updateMany({
      where: { id: { in: files.map((file) => file.id) } },
      data: { status: OrderFileStatus.PENDING_DELETE, deleteAfter },
    });
    return;
  }

  for (const file of files) {
    await handleDeleteAttempt(file).catch((error) => {
      console.error("Error limpiando archivo de pedido entregado:", sanitizeStorageError(error));
    });
  }
}

export async function retryPendingOrderFileDeletes(limit = 50) {
  const now = new Date();
  const files = await prisma.orderFile.findMany({
    where: {
      status: { in: [OrderFileStatus.PENDING_DELETE, OrderFileStatus.DELETE_FAILED] },
      deleteAttempts: { lt: deleteMaxAttempts() },
      OR: [{ deleteAfter: null }, { deleteAfter: { lte: now } }],
    },
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    take: limit,
    select: { id: true, relativePath: true, deleteAttempts: true },
  });

  for (const file of files) {
    await handleDeleteAttempt(file).catch((error) => {
      console.error("Error reintentando borrado de archivo:", sanitizeStorageError(error));
    });
  }
}

export async function cleanupOrderFilesForHardDelete(
  tx: Prisma.TransactionClient,
  orderId: number
) {
  const files = await tx.orderFile.findMany({
    where: {
      orderId,
      status: { not: OrderFileStatus.DELETED },
    },
    select: { id: true, relativePath: true, deleteAttempts: true },
    orderBy: { id: "asc" },
  });

  let failedCount = 0;
  for (const file of files) {
    try {
      await deletePhysicalFile(file.relativePath);
      await tx.orderFile.update({
        where: { id: file.id },
        data: {
          status: OrderFileStatus.DELETED,
          deletedAt: new Date(),
          deleteAfter: null,
          lastDeleteError: null,
        },
      });
    } catch (error) {
      failedCount += 1;
      await tx.orderFile.update({
        where: { id: file.id },
        data: {
          status: OrderFileStatus.DELETE_FAILED,
          deleteAttempts: { increment: 1 },
          lastDeleteError: sanitizeStorageError(error),
        },
      });
    }
  }
  return { failedCount, processedCount: files.length };
}

export async function getOrderFileRouting(orderId: number) {
  return prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, branchId: true, pickupBranchId: true },
  });
}

export function toOrderFileType(value: unknown): OrderFileType {
  if (value === OrderFileType.PREPARED || value === OrderFileType.OTHER) return value;
  return OrderFileType.ORIGINAL;
}
