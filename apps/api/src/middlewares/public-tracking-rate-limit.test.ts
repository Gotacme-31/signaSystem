import assert from "node:assert/strict";
import test from "node:test";
import type { Request, Response } from "express";
import { createPublicTrackingRateLimiter } from "./publicTrackingRateLimit";

function responseDouble() {
  const state = { status: 200, body: null as unknown };
  const response = {
    set() { return response; },
    status(value: number) { state.status = value; return response; },
    json(value: unknown) { state.body = value; return response; },
  } as unknown as Response;
  return { response, state };
}

test("public tracking rate limit is focused and returns 429 after its threshold", () => {
  const middleware = createPublicTrackingRateLimiter({ maxRequests: 2, windowMs: 60_000 });
  let nextCalls = 0;

  middleware({ ip: "203.0.113.10" } as Request, responseDouble().response, () => { nextCalls += 1; });
  middleware({ ip: "203.0.113.10" } as Request, responseDouble().response, () => { nextCalls += 1; });
  const third = responseDouble();
  middleware({ ip: "203.0.113.10" } as Request, third.response, () => { nextCalls += 1; });

  assert.equal(nextCalls, 2);
  assert.equal(third.state.status, 429);
  assert.deepEqual(third.state.body, { error: "Demasiadas solicitudes" });
});

test("the limiter keeps different req.ip values independent", () => {
  const middleware = createPublicTrackingRateLimiter({ maxRequests: 1, windowMs: 60_000 });
  let nextCalls = 0;
  const first = responseDouble();
  const second = responseDouble();

  middleware({ ip: "198.51.100.1" } as Request, first.response, () => { nextCalls += 1; });
  middleware({ ip: "198.51.100.2" } as Request, second.response, () => { nextCalls += 1; });

  assert.equal(nextCalls, 2);
  assert.equal(first.state.status, 200);
  assert.equal(second.state.status, 200);
});
