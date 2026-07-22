// FILE: src/middlewares/auth.ts

import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma";

const JWT_SECRET = process.env.JWT_SECRET || "tu-secreto-super-seguro";

// Exportar el tipo
export interface AuthedRequest extends Request {
  auth?: {
    [x: string]: any;
    userId: number;
    username: string;
    role: string;
    branchId?: number;
    accessibleBranchIds?: number[];
  };
}

// Middleware de autenticación general
export async function auth(req: AuthedRequest, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.replace("Bearer ", "");

  if (!token) {
    return res.status(401).json({ error: "Token no proporcionado" });
  }

  let decoded: jwt.JwtPayload;
  try {
    const verified = jwt.verify(token, JWT_SECRET);
    if (typeof verified === "string") {
      return res.status(401).json({ error: "Token inválido" });
    }
    decoded = verified;
  } catch (error) {
    return res.status(401).json({ error: "Token inválido" });
  }

  const userId = Number(decoded.userId);
  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(401).json({ error: "Token inválido" });
  }

  try {
    const currentUser = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        role: true,
        branchId: true,
        isActive: true,
        branchAccesses: {
          select: { branchId: true },
        },
      },
    });

    if (!currentUser?.isActive) {
      return res.status(401).json({ error: "No autorizado" });
    }

    req.auth = {
      userId: currentUser.id,
      username: currentUser.username,
      role: currentUser.role,
      branchId: currentUser.branchId ?? undefined,
      accessibleBranchIds: currentUser.branchAccesses.map((access) => access.branchId),
    };

    next();
  } catch (error) {
    console.error("Error al consultar el usuario autenticado", {
      error: error instanceof Error ? error.name : "UnknownError",
    });
    return res.status(500).json({ error: "Error interno del servidor" });
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
