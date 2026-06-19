import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";

const DEFAULT_TEMP_PREFIX = "upload-";

function getBaseDir(): string {
  const configured = process.env.ORDER_FILES_DIR;
  if (!configured || !configured.trim()) {
    throw new Error("ORDER_FILES_DIR no configurado. Define la ruta del volumen/directorio donde se guardan archivos de pedidos.");
  }

  return path.resolve(configured);
}

function assertInsideBase(absolutePath: string, baseDir = getBaseDir()) {
  const resolvedBase = path.resolve(baseDir);
  const resolvedPath = path.resolve(absolutePath);

  if (resolvedPath !== resolvedBase && !resolvedPath.startsWith(`${resolvedBase}${path.sep}`)) {
    throw new Error("Ruta de archivo no permitida");
  }

  return resolvedPath;
}

function sanitizeFileName(name: string): string {
  const normalized = path.basename(name || "archivo").normalize("NFKD");
  const safe = normalized
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 180);

  return safe || "archivo";
}

function safeExtension(originalName: string): string {
  const ext = path.extname(sanitizeFileName(originalName)).toLowerCase();
  if (!ext || ext.length > 12) return "";
  return ext.replace(/[^a-z0-9.]/g, "");
}

export function sanitizeOriginalName(originalName: string): string {
  return sanitizeFileName(originalName);
}

export function createStoredName(originalName: string): string {
  return `${randomUUID()}${safeExtension(originalName)}`;
}

export function getUploadTempDirSync(): string {
  const baseDir = getBaseDir();
  const tempDir = assertInsideBase(path.join(baseDir, ".tmp"), baseDir);
  fs.mkdirSync(tempDir, { recursive: true });
  return tempDir;
}

export function createTempFileName(): string {
  return `${DEFAULT_TEMP_PREFIX}${randomUUID()}.tmp`;
}

export function buildRelativePath(orderId: number, storedName: string, orderItemId?: number | null): string {
  const safeStoredName = sanitizeFileName(storedName);

  if (orderItemId) {
    return path.posix.join("orders", String(orderId), "items", String(orderItemId), safeStoredName);
  }

  return path.posix.join("orders", String(orderId), safeStoredName);
}

export function resolveAbsolutePath(relativePath: string): string {
  if (!relativePath || path.isAbsolute(relativePath)) {
    throw new Error("Ruta relativa invalida");
  }

  const normalizedRelativePath = relativePath.replace(/\\/g, "/");
  if (normalizedRelativePath.split("/").some((part) => part === "..")) {
    throw new Error("Ruta relativa no permitida");
  }

  const baseDir = getBaseDir();
  return assertInsideBase(path.resolve(baseDir, normalizedRelativePath), baseDir);
}

export async function saveUploadedTempFile(args: {
  tempPath: string;
  orderId: number;
  orderItemId?: number | null;
  originalName: string;
}) {
  const storedName = createStoredName(args.originalName);
  const relativePath = buildRelativePath(args.orderId, storedName, args.orderItemId);
  const absolutePath = resolveAbsolutePath(relativePath);

  await fs.promises.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.promises.rename(args.tempPath, absolutePath);

  return {
    storedName,
    relativePath,
  };
}

export async function deletePhysicalFile(relativePath: string): Promise<"deleted" | "missing"> {
  const absolutePath = resolveAbsolutePath(relativePath);

  try {
    await fs.promises.unlink(absolutePath);
    return "deleted";
  } catch (error: any) {
    if (error?.code === "ENOENT") return "missing";
    throw error;
  }
}

export async function fileExists(relativePath: string): Promise<boolean> {
  const absolutePath = resolveAbsolutePath(relativePath);

  try {
    const stat = await fs.promises.stat(absolutePath);
    return stat.isFile();
  } catch (error: any) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

export function createReadStream(relativePath: string) {
  const absolutePath = resolveAbsolutePath(relativePath);
  return fs.createReadStream(absolutePath);
}

export async function removeTempFile(tempPath?: string | null) {
  if (!tempPath) return;

  try {
    const baseDir = getBaseDir();
    const absolutePath = assertInsideBase(path.resolve(tempPath), baseDir);
    await fs.promises.unlink(absolutePath);
  } catch (error: any) {
    if (error?.code !== "ENOENT") {
      console.warn("No se pudo borrar archivo temporal de orden", error?.message ?? error);
    }
  }
}

export function sanitizeStorageError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? "Error desconocido");
  const baseDir = process.env.ORDER_FILES_DIR ? path.resolve(process.env.ORDER_FILES_DIR) : "";
  return baseDir ? message.split(baseDir).join("[ORDER_FILES_DIR]").slice(0, 500) : message.slice(0, 500);
}
