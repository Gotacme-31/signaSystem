import type { NextFunction, Request, Response } from "express";

type RateLimitOptions = {
  maxRequests?: number;
  windowMs?: number;
};

export function createPublicTrackingRateLimiter({
  maxRequests = 60,
  windowMs = 60_000,
}: RateLimitOptions = {}) {
  const requestsByIp = new Map<string, number[]>();

  return function publicTrackingRateLimit(req: Request, res: Response, next: NextFunction) {
    res.set("Cache-Control", "no-store");

    const now = Date.now();
    const key = req.ip || "unknown";
    const recentRequests = (requestsByIp.get(key) ?? []).filter((timestamp) => now - timestamp < windowMs);

    if (recentRequests.length >= maxRequests) {
      res.set("Retry-After", String(Math.ceil(windowMs / 1000)));
      return res.status(429).json({ error: "Demasiadas solicitudes" });
    }

    recentRequests.push(now);
    requestsByIp.set(key, recentRequests);
    if (requestsByIp.size > 10_000) {
      for (const [ip, timestamps] of requestsByIp) {
        if (timestamps.every((timestamp) => now - timestamp >= windowMs)) requestsByIp.delete(ip);
      }
    }

    return next();
  };
}

export const publicTrackingRateLimit = createPublicTrackingRateLimiter();
