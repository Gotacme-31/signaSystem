import { randomBytes } from "node:crypto";
import { Prisma, PrismaClient, OrderStage, ShippingType } from "@prisma/client";
import { CANCELLATION_MARKER, isCanceledOrderNotes } from "./order-cancellation.service";

export type PublicTrackingStatus =
  | "REGISTERED"
  | "IN_PRODUCTION"
  | "READY_FOR_PICKUP"
  | "READY_FOR_SHIPPING"
  | "SHIPPED"
  | "DELIVERED";

export type PublicTrackingOrder = {
  shippingType: ShippingType | "PICKUP" | "DELIVERY";
  stage: OrderStage | "REGISTERED" | "IN_PROGRESS" | "READY" | "DELIVERED";
};

export const PUBLIC_TRACKING_TOKEN_MAX_ATTEMPTS = 5;

export function generatePublicTrackingToken() {
  return randomBytes(32).toString("base64url");
}

export function derivePublicTrackingStatus(order: PublicTrackingOrder): PublicTrackingStatus {
  const shippingType = String(order.shippingType);
  const stage = String(order.stage);

  if (shippingType === "DELIVERY") {
    if (stage === "REGISTERED") return "REGISTERED";
    if (stage === "IN_PROGRESS") return "IN_PRODUCTION";
    if (stage === "READY") return "READY_FOR_SHIPPING";
    return "SHIPPED";
  }

  if (stage === "IN_PROGRESS") return "IN_PRODUCTION";
  if (stage === "READY") return "READY_FOR_PICKUP";
  if (stage === "DELIVERED") return "DELIVERED";
  return "REGISTERED";
}

export function isPublicTrackingTokenUniqueViolation(error: unknown) {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
    return false;
  }

  const target = error.meta?.target;
  return Array.isArray(target)
    ? target.includes("publicTrackingToken")
    : target === "publicTrackingToken" || target === "Order_publicTrackingToken_key";
}

export class PublicTrackingConfigurationError extends Error {
  constructor() {
    super("PUBLIC_WEB_URL debe configurarse con una URL HTTPS pública en producción");
    this.name = "PublicTrackingConfigurationError";
  }
}

function normalizePublicWebUrl(value: string, environment = process.env.NODE_ENV) {
  const normalized = value.trim().replace(/\/+$/, "");
  let parsed: URL;

  try {
    parsed = new URL(normalized);
  } catch {
    throw new PublicTrackingConfigurationError();
  }

  const isLoopback = parsed.hostname === "localhost"
    || parsed.hostname === "::1"
    || parsed.hostname === "[::1]"
    || /^127(?:\.\d{1,3}){3}$/.test(parsed.hostname);
  const isProduction = environment === "production";
  const validProtocol = isProduction
    ? parsed.protocol === "https:" && !isLoopback
    : parsed.protocol === "https:" || (parsed.protocol === "http:" && isLoopback);

  if (!validProtocol) {
    throw new PublicTrackingConfigurationError();
  }

  return normalized;
}

export function resolvePublicWebUrl(
  requestOrigin?: string | null,
  environment = process.env.NODE_ENV,
  configuredValue = process.env.PUBLIC_WEB_URL
) {
  const configuredUrl = configuredValue?.trim();
  if (configuredUrl) return normalizePublicWebUrl(configuredUrl, environment);
  if (environment === "production") throw new PublicTrackingConfigurationError();

  return normalizePublicWebUrl(
    requestOrigin?.trim() || "http://localhost:5173",
    environment
  );
}

export function buildTrackingUrl(token: string, baseUrl?: string | null, environment = process.env.NODE_ENV) {
  const normalizedBaseUrl = baseUrl === undefined || baseUrl === null
    ? resolvePublicWebUrl(undefined, environment)
    : normalizePublicWebUrl(baseUrl, environment);
  return `${normalizedBaseUrl}/track/${encodeURIComponent(token)}`;
}

export function buildOrderTrackingResponse(
  orderId: number,
  token: string,
  baseUrl?: string | null,
  environment = process.env.NODE_ENV
) {
  return {
    orderId,
    trackingUrl: buildTrackingUrl(token, baseUrl, environment),
  };
}

type TrackingOrderDelegate = {
  findUnique: (args: any) => Promise<{
    id: number;
    notes: string | null;
    publicTrackingToken: string | null;
    publicTrackingTokenCreatedAt: Date | null;
  } | null>;
  updateMany: (args: any) => Promise<{ count: number }>;
};

export class PublicTrackingTokenError extends Error {
  constructor() {
    super("No se pudo generar el enlace de seguimiento");
    this.name = "PublicTrackingTokenError";
  }
}

export async function ensurePublicTrackingToken(
  client: { order: TrackingOrderDelegate },
  orderId: number,
  maxAttempts = PUBLIC_TRACKING_TOKEN_MAX_ATTEMPTS
) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const existing = await client.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        notes: true,
        publicTrackingToken: true,
        publicTrackingTokenCreatedAt: true,
      },
    });

    if (!existing || isCanceledOrderNotes(existing.notes)) return null;
    if (existing.publicTrackingToken) {
      return {
        token: existing.publicTrackingToken,
        createdAt: existing.publicTrackingTokenCreatedAt,
      };
    }

    const token = generatePublicTrackingToken();
    const createdAt = new Date();

    try {
      const claimed = await client.order.updateMany({
        where: {
          id: orderId,
          publicTrackingToken: null,
          OR: [
            { notes: null },
            { notes: { not: { contains: CANCELLATION_MARKER } } },
          ],
        },
        data: {
          publicTrackingToken: token,
          publicTrackingTokenCreatedAt: createdAt,
        },
      });

      if (claimed.count === 1) return { token, createdAt };
    } catch (error) {
      if (!isPublicTrackingTokenUniqueViolation(error)) throw error;
    }
  }

  throw new PublicTrackingTokenError();
}

export async function regeneratePublicTrackingToken(
  client: PrismaClient,
  orderId: number,
  maxAttempts = PUBLIC_TRACKING_TOKEN_MAX_ATTEMPTS
) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await client.$transaction(async (tx) => {
        const existing = await tx.order.findUnique({
          where: { id: orderId },
          select: { id: true, notes: true },
        });

        if (!existing || isCanceledOrderNotes(existing.notes)) return null;

        return tx.order.update({
          where: { id: orderId },
          data: {
            publicTrackingToken: generatePublicTrackingToken(),
            publicTrackingTokenCreatedAt: new Date(),
          },
          select: {
            id: true,
            publicTrackingToken: true,
            publicTrackingTokenCreatedAt: true,
          },
        });
      });
    } catch (error) {
      if (!isPublicTrackingTokenUniqueViolation(error)) throw error;
    }
  }

  throw new PublicTrackingTokenError();
}
