import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import {
  buildOrderTrackingResponse,
  buildTrackingUrl,
  derivePublicTrackingStatus,
  ensurePublicTrackingToken,
  generatePublicTrackingToken,
  PublicTrackingConfigurationError,
  resolvePublicWebUrl,
} from "./public-tracking.service";

test("tracking tokens have 256 bits of URL-safe randomness and are not derived from order IDs", () => {
  const first = generatePublicTrackingToken();
  const second = generatePublicTrackingToken();

  assert.match(first, /^[A-Za-z0-9_-]{43}$/);
  assert.match(second, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(first, second);
  assert.doesNotMatch(first, /31275/);
});

test("lazy token generation retries a public-token unique collision", async () => {
  let updateAttempts = 0;
  const collision = new Prisma.PrismaClientKnownRequestError("Unique constraint", {
    code: "P2002",
    clientVersion: "5.22.0",
    meta: { target: ["publicTrackingToken"] },
  });

  const client = {
    order: {
      findUnique: async () => ({
        id: 31275,
        notes: null,
        publicTrackingToken: null,
        publicTrackingTokenCreatedAt: null,
      }),
      updateMany: async () => {
        updateAttempts += 1;
        if (updateAttempts === 1) throw collision;
        return { count: 1 };
      },
    },
  };

  const link = await ensurePublicTrackingToken(client, 31275);

  assert.ok(link);
  assert.equal(updateAttempts, 2);
  assert.match(link.token, /^[A-Za-z0-9_-]{43}$/);
});

test("existing token is returned without regeneration and canceled orders are rejected", async () => {
  let updateAttempts = 0;
  const client = {
    order: {
      findUnique: async () => ({
        id: 12,
        notes: null,
        publicTrackingToken: "existing-token",
        publicTrackingTokenCreatedAt: new Date("2026-09-09T12:00:00.000Z"),
      }),
      updateMany: async () => {
        updateAttempts += 1;
        return { count: 1 };
      },
    },
  };

  const existing = await ensurePublicTrackingToken(client, 12);
  assert.equal(existing?.token, "existing-token");
  assert.equal(updateAttempts, 0);

  const canceled = await ensurePublicTrackingToken({
    order: {
      findUnique: async () => ({
        id: 12,
        notes: "[Cancelado el 2026-09-09]",
        publicTrackingToken: null,
        publicTrackingTokenCreatedAt: null,
      }),
      updateMany: async () => ({ count: 1 }),
    },
  }, 12);
  assert.equal(canceled, null);
});

test("tracking lookup returns the requested order token when newer orders exist", async () => {
  const rows = new Map([
    [100, {
      id: 100,
      notes: null,
      publicTrackingToken: "token-a",
      publicTrackingTokenCreatedAt: new Date("2026-09-09T10:00:00.000Z"),
    }],
    [101, {
      id: 101,
      notes: null,
      publicTrackingToken: "token-b",
      publicTrackingTokenCreatedAt: new Date("2026-09-09T11:00:00.000Z"),
    }],
    [102, {
      id: 102,
      notes: null,
      publicTrackingToken: "token-c",
      publicTrackingTokenCreatedAt: new Date("2026-09-09T12:00:00.000Z"),
    }],
  ]);
  const lookedUpIds: number[] = [];

  const link = await ensurePublicTrackingToken({
    order: {
      findUnique: async ({ where }: any) => {
        lookedUpIds.push(where.id);
        return rows.get(where.id) ?? null;
      },
      updateMany: async () => {
        throw new Error("existing tokens must not be updated");
      },
    },
  }, 100);

  assert.equal(link?.token, "token-a");
  assert.deepEqual(lookedUpIds, [100]);
});

test("lazy generation persists a token only on the requested historical order", async () => {
  const rows = new Map([
    [100, {
      id: 100,
      notes: null,
      publicTrackingToken: null as string | null,
      publicTrackingTokenCreatedAt: null as Date | null,
    }],
    [101, {
      id: 101,
      notes: null,
      publicTrackingToken: "token-b",
      publicTrackingTokenCreatedAt: new Date("2026-09-09T11:00:00.000Z"),
    }],
    [102, {
      id: 102,
      notes: null,
      publicTrackingToken: "token-c",
      publicTrackingTokenCreatedAt: new Date("2026-09-09T12:00:00.000Z"),
    }],
  ]);
  const lookedUpIds: number[] = [];
  const updatedIds: number[] = [];

  const link = await ensurePublicTrackingToken({
    order: {
      findUnique: async ({ where }: any) => {
        lookedUpIds.push(where.id);
        return rows.get(where.id) ?? null;
      },
      updateMany: async ({ where, data }: any) => {
        updatedIds.push(where.id);
        const row = rows.get(where.id);
        if (!row || row.publicTrackingToken !== null) return { count: 0 };
        row.publicTrackingToken = data.publicTrackingToken;
        row.publicTrackingTokenCreatedAt = data.publicTrackingTokenCreatedAt;
        return { count: 1 };
      },
    },
  }, 100);

  assert.ok(link);
  assert.deepEqual(lookedUpIds, [100]);
  assert.deepEqual(updatedIds, [100]);
  assert.equal(rows.get(100)?.publicTrackingToken, link.token);
  assert.equal(rows.get(101)?.publicTrackingToken, "token-b");
  assert.equal(rows.get(102)?.publicTrackingToken, "token-c");
});

test("public status maps pickup and delivery without using delivery receipt state", () => {
  assert.equal(derivePublicTrackingStatus({ shippingType: "PICKUP", stage: "REGISTERED" }), "REGISTERED");
  assert.equal(derivePublicTrackingStatus({ shippingType: "PICKUP", stage: "IN_PROGRESS" }), "IN_PRODUCTION");
  assert.equal(derivePublicTrackingStatus({ shippingType: "PICKUP", stage: "READY" }), "READY_FOR_PICKUP");
  assert.equal(derivePublicTrackingStatus({ shippingType: "PICKUP", stage: "DELIVERED" }), "DELIVERED");
  assert.equal(derivePublicTrackingStatus({ shippingType: "DELIVERY", stage: "REGISTERED" }), "REGISTERED");
  assert.equal(derivePublicTrackingStatus({ shippingType: "DELIVERY", stage: "IN_PROGRESS" }), "IN_PRODUCTION");
  assert.equal(derivePublicTrackingStatus({ shippingType: "DELIVERY", stage: "READY" }), "READY_FOR_SHIPPING");
  assert.equal(derivePublicTrackingStatus({ shippingType: "DELIVERY", stage: "DELIVERED" }), "SHIPPED");
  assert.equal(
    derivePublicTrackingStatus({ shippingType: "DELIVERY", stage: "DELIVERED", shippingStage: "RECEIVED" } as never),
    "SHIPPED"
  );
});

test("tracking URL construction is centralized and does not use order IDs", () => {
  assert.equal(
    buildTrackingUrl("token_abc", "https://signa.example.com/"),
    "https://signa.example.com/track/token_abc"
  );
  assert.equal(
    buildTrackingUrl("token_abc", undefined, "development"),
    "http://localhost:5173/track/token_abc"
  );
});

test("authenticated tracking response explicitly associates the requested order and URL", () => {
  assert.deepEqual(
    buildOrderTrackingResponse(100, "token-a", "https://signa.example.com", "production"),
    {
      orderId: 100,
      trackingUrl: "https://signa.example.com/track/token-a",
    }
  );
});

test("development permits loopback HTTP and valid HTTPS URLs", () => {
  assert.equal(
    resolvePublicWebUrl(undefined, "development", "http://localhost:5173"),
    "http://localhost:5173"
  );
  assert.equal(
    resolvePublicWebUrl(undefined, "development", "http://127.0.0.1"),
    "http://127.0.0.1"
  );
  assert.equal(
    resolvePublicWebUrl(undefined, "development", "http://[::1]:5173"),
    "http://[::1]:5173"
  );
  assert.equal(
    resolvePublicWebUrl(undefined, "development", "https://signa.example.com///"),
    "https://signa.example.com"
  );
  assert.equal(
    buildTrackingUrl("token_abc", "http://localhost:5173/", "development"),
    "http://localhost:5173/track/token_abc"
  );
});

test("production permits only configured public HTTPS URLs", () => {
  assert.throws(
    () => resolvePublicWebUrl(undefined, "production", ""),
    (error: unknown) => error instanceof PublicTrackingConfigurationError
  );
  assert.throws(
    () => buildTrackingUrl("token_abc", "http://signa.example.com", "production"),
    (error: unknown) => error instanceof PublicTrackingConfigurationError
  );
  assert.throws(
    () => buildTrackingUrl("token_abc", "http://localhost:5173", "production"),
    (error: unknown) => error instanceof PublicTrackingConfigurationError
  );
  assert.throws(
    () => buildTrackingUrl("token_abc", "https://localhost:5173", "production"),
    (error: unknown) => error instanceof PublicTrackingConfigurationError
  );
  assert.throws(
    () => buildTrackingUrl("token_abc", "http://127.0.0.1:5173", "production"),
    (error: unknown) => error instanceof PublicTrackingConfigurationError
  );
  assert.throws(
    () => buildTrackingUrl("token_abc", "https://[::1]:5173", "production"),
    (error: unknown) => error instanceof PublicTrackingConfigurationError
  );
  assert.equal(
    buildTrackingUrl("token_abc", "https://signa.example.com///", "production"),
    "https://signa.example.com/track/token_abc"
  );
});
