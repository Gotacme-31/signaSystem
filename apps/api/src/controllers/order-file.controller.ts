import type { NextFunction, Response } from "express";
import multer from "multer";
import type { AuthedRequest } from "../middlewares/auth";
import {
  createTempFileName,
  getUploadTempDirSync,
  removeTempFile,
  sanitizeOriginalName,
} from "../services/order-file-storage.service";
import {
  deleteOrderFile,
  getOrderFileDownload,
  getOrderFileRouting,
  listOrderFiles,
  toOrderFileType,
  uploadOrderFile,
} from "../services/order-file.service";
import { orderEvents } from "../socket/handlers/orders";

function parseId(param: string | string[] | undefined): number | null {
  if (!param) return null;
  const str = Array.isArray(param) ? param[0] : param;
  const num = parseInt(str, 10);
  return Number.isFinite(num) ? num : null;
}

function maxFileSizeBytes() {
  const maxMb = Number(process.env.ORDER_FILE_MAX_MB ?? "300");
  return (Number.isFinite(maxMb) && maxMb > 0 ? maxMb : 300) * 1024 * 1024;
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      try {
        cb(null, getUploadTempDirSync());
      } catch (error: any) {
        cb(error, "");
      }
    },
    filename: (_req, _file, cb) => cb(null, createTempFileName()),
  }),
  limits: {
    fileSize: maxFileSizeBytes(),
    files: 1,
  },
});

export function orderFileUploadMiddleware(req: AuthedRequest, res: Response, next: NextFunction) {
  upload.single("file")(req, res, (error: any) => {
    if (!error) return next();

    if (error instanceof multer.MulterError) {
      if (error.code === "LIMIT_FILE_SIZE") {
        return res.status(413).json({ error: "El archivo excede el limite permitido" });
      }
      return res.status(400).json({ error: error.message });
    }

    return res.status(400).json({ error: error?.message ?? "Error recibiendo archivo" });
  });
}

async function emitFilesChanged(req: AuthedRequest, orderId: number) {
  const routing = await getOrderFileRouting(orderId);
  if (!routing) return;

  const io = req.app.get("io");
  if (!io) return;

  orderEvents(io).orderFilesChanged(orderId, routing.branchId, routing.pickupBranchId ?? undefined);
}

function contentDispositionAttachment(originalName: string) {
  const sanitized = sanitizeOriginalName(originalName);
  const asciiFallback = sanitized.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "_");
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(sanitized)}`;
}

export async function uploadOrderFileController(req: AuthedRequest, res: Response) {
  const authUser = req.auth;
  const orderId = parseId(req.params.orderId);
  const orderItemId = req.body?.orderItemId ? parseId(String(req.body.orderItemId)) : null;
  const file = req.file;

  try {
    if (!authUser) return res.status(401).json({ error: "No autorizado" });
    if (!orderId) return res.status(400).json({ error: "orderId invalido" });
    if (!file) return res.status(400).json({ error: "Archivo requerido" });

    const result = await uploadOrderFile({
      authUser,
      orderId,
      orderItemId,
      tempPath: file.path,
      originalName: file.originalname,
      mimeType: file.mimetype,
      sizeBytes: file.size,
      type: toOrderFileType(req.body?.type),
    });

    await emitFilesChanged(req, orderId).catch(() => undefined);
    return res.status(201).json(result);
  } catch (error: any) {
    await removeTempFile(file?.path);
    return res.status(400).json({ error: error?.message ?? "Error subiendo archivo" });
  }
}

export async function listOrderFilesController(req: AuthedRequest, res: Response) {
  const authUser = req.auth;
  const orderId = parseId(req.params.orderId);

  try {
    if (!authUser) return res.status(401).json({ error: "No autorizado" });
    if (!orderId) return res.status(400).json({ error: "orderId invalido" });

    const files = await listOrderFiles(authUser, orderId);
    return res.json(files);
  } catch (error: any) {
    return res.status(400).json({ error: error?.message ?? "Error listando archivos" });
  }
}

export async function downloadOrderFileController(req: AuthedRequest, res: Response) {
  const authUser = req.auth;
  const orderId = parseId(req.params.orderId);
  const fileId = parseId(req.params.fileId);

  try {
    if (!authUser) return res.status(401).json({ error: "No autorizado" });
    if (!orderId || !fileId) return res.status(400).json({ error: "Parametros invalidos" });

    const file = await getOrderFileDownload(authUser, orderId, fileId);
    res.setHeader("Content-Type", file.mimeType);
    res.setHeader("Content-Length", String(file.sizeBytes));
    res.setHeader("Content-Disposition", contentDispositionAttachment(file.originalName));

    file.stream.on("error", () => {
      if (!res.headersSent) res.status(500).json({ error: "Error descargando archivo" });
      else res.destroy();
    });

    return file.stream.pipe(res);
  } catch (error: any) {
    return res.status(400).json({ error: error?.message ?? "Error descargando archivo" });
  }
}

export async function deleteOrderFileController(req: AuthedRequest, res: Response) {
  const authUser = req.auth;
  const orderId = parseId(req.params.orderId);
  const fileId = parseId(req.params.fileId);

  try {
    if (!authUser) return res.status(401).json({ error: "No autorizado" });
    if (!orderId || !fileId) return res.status(400).json({ error: "Parametros invalidos" });

    const file = await deleteOrderFile(authUser, orderId, fileId);
    await emitFilesChanged(req, orderId).catch(() => undefined);
    return res.json(file);
  } catch (error: any) {
    return res.status(400).json({ error: error?.message ?? "Error borrando archivo" });
  }
}
