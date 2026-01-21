import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import type { UserRole } from "@signa/db";

export type JwtPayload = {
    userId: number;
    role: UserRole;
    branchId: number | null;
  };
  
  export type AuthedRequest = Request & { auth?: JwtPayload };


export function auth(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization; // "Bearer xxx"
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing Bearer token" });
  }

  const token = header.slice("Bearer ".length);

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET!) as JwtPayload;
    req.auth = payload;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
}
export function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
    if (req.auth?.role !== "ADMIN") {
      return res.status(403).json({ error: "Admin only" });
    }
    next();
  }
