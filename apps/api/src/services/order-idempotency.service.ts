import { createHash } from "node:crypto";

export class OrderIdempotencyError extends Error {
  constructor(readonly code: string, message: string, readonly status: number) {
    super(message);
    this.name = "OrderIdempotencyError";
  }
}

function stableSerialize(value: unknown): string {
  if (value === undefined) return "null";
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${stableSerialize(child)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function orderRequestHash(value: unknown) {
  return createHash("sha256").update(stableSerialize(value)).digest("hex");
}

export function normalizeClientRequestId(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.trim().length < 8 || value.trim().length > 100) {
    throw new OrderIdempotencyError("INVALID_CLIENT_REQUEST_ID", "clientRequestId inválido", 400);
  }
  return value.trim();
}
