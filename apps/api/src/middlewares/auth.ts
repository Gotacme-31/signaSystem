// FILE: src/middlewares/auth.ts

import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "tu-secreto-super-seguro";

// Exportar el tipo
export interface AuthedRequest extends Request {
  auth?: {
    [x: string]: any;
    userId: number;
    username: string;
    role: string;
    branchId?: number;
  };
}

// Middleware de autenticación general
export function auth(req: AuthedRequest, res: Response, next: NextFunction) {
  try {
    const token = req.headers.authorization?.replace("Bearer ", "");

    if (!token) {
      return res.status(401).json({ error: "Token no proporcionado" });
    }

    const decoded = jwt.verify(token, JWT_SECRET) as any;
    
    req.auth = {
      userId: decoded.userId,
      username: decoded.username,
      role: decoded.role,
      branchId: decoded.branchId,
    };

    next();
  } catch (error) {
    return res.status(401).json({ error: "Token inválido" });
  }
}

// Middleware para requerir rol ADMIN
export function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!req.auth) {
    return res.status(401).json({ error: "No autenticado" });
  }

  if (req.auth.role !== "ADMIN") {
    return res.status(403).json({ error: "Se requiere rol ADMIN" });
  }

  next();
}

// Middleware para requerir STAFF (o superior)
export function requireStaff(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!req.auth) {
    return res.status(401).json({ error: "No autenticado" });
  }

  if (req.auth.role !== "STAFF" && req.auth.role !== "ADMIN") {
    return res.status(403).json({ error: "Se requiere rol STAFF o ADMIN" });
  }

  next();
}