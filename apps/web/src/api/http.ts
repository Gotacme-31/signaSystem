const API_BASE = (import.meta.env.VITE_API_URL ?? "http://localhost:3001").replace(/\/$/, "");

import { getToken } from "../auth/storage";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly details?: unknown
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function headersToObject(h?: HeadersInit): Record<string, string> {
  if (!h) return {};
  if (h instanceof Headers) return Object.fromEntries(h.entries());
  if (Array.isArray(h)) return Object.fromEntries(h);
  return h as Record<string, string>;
}

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const extra = headersToObject(options.headers);

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...extra,
    },
  });

  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    let code: string | undefined;
    let details: unknown;
    try {
      const data = await res.json();
      msg = data?.error ?? data?.message ?? msg;
      code = data?.code;
      details = data;
    } catch {
      // Keep the HTTP fallback when the response body is not JSON.
    }
    throw new ApiError(msg, res.status, code, details);
  }

  return res.json() as Promise<T>;
}
