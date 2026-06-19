import { getToken } from "../auth/storage";

const API_BASE = (import.meta.env.VITE_API_URL ?? "http://localhost:3001").replace(/\/$/, "");

export type OrderFileStatus = "ACTIVE" | "PENDING_DELETE" | "DELETED" | "DELETE_FAILED";
export type OrderFileType = "ORIGINAL" | "PREPARED" | "OTHER";

export type OrderFileMetadata = {
  id: number;
  orderId: number;
  orderItemId?: number | null;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  type: OrderFileType;
  status: OrderFileStatus;
  uploadedAt: string;
  uploadedById?: number | null;
  downloadedAt?: string | null;
  downloadedById?: number | null;
  deletedAt?: string | null;
};

function authHeaders(): HeadersInit {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function readError(res: Response) {
  try {
    const data = await res.json();
    return data?.error ?? data?.message ?? `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

function filenameFromContentDisposition(header: string | null) {
  if (!header) return null;

  const encodedMatch = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (encodedMatch?.[1]) {
    try {
      return decodeURIComponent(encodedMatch[1]);
    } catch {
      return encodedMatch[1];
    }
  }

  const fallbackMatch = /filename="?([^";]+)"?/i.exec(header);
  return fallbackMatch?.[1] ?? null;
}

export async function uploadOrderFile(orderId: number, file: File, orderItemId?: number | null) {
  const form = new FormData();
  form.append("file", file);
  if (orderItemId) form.append("orderItemId", String(orderItemId));

  const res = await fetch(`${API_BASE}/orders/${orderId}/files`, {
    method: "POST",
    headers: authHeaders(),
    body: form,
  });

  if (!res.ok) throw new Error(await readError(res));
  return res.json() as Promise<OrderFileMetadata>;
}

export async function getOrderFiles(orderId: number) {
  const res = await fetch(`${API_BASE}/orders/${orderId}/files`, {
    headers: authHeaders(),
  });

  if (!res.ok) throw new Error(await readError(res));
  return res.json() as Promise<OrderFileMetadata[]>;
}

export async function downloadOrderFile(orderId: number, fileId: number, fallbackName?: string) {
  const res = await fetch(`${API_BASE}/orders/${orderId}/files/${fileId}/download`, {
    headers: authHeaders(),
  });

  if (!res.ok) throw new Error(await readError(res));

  const blob = await res.blob();
  const filename = filenameFromContentDisposition(res.headers.get("Content-Disposition")) ?? fallbackName ?? `archivo-${fileId}`;

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export async function deleteOrderFile(orderId: number, fileId: number) {
  const res = await fetch(`${API_BASE}/orders/${orderId}/files/${fileId}`, {
    method: "DELETE",
    headers: authHeaders(),
  });

  if (!res.ok) throw new Error(await readError(res));
  return res.json() as Promise<OrderFileMetadata>;
}
