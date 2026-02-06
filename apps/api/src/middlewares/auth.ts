// middlewares/auth.ts
import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface AuthUser {
  id: number;
  email: string;
  name: string;
  role: 'ADMIN' | 'STAFF';
  branchId?: number;
}

export interface AuthedRequest extends Request {
  auth?: AuthUser;
}

// Middleware de autenticación básica
export function auth(req: AuthedRequest, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'No autorizado' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as AuthUser;
    req.auth = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Token inválido' });
  }
}

// ✅ Agrega este middleware para requerir rol de ADMIN
export function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!req.auth) {
    return res.status(401).json({ error: 'No autorizado' });
  }

  if (req.auth.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Acceso denegado. Se requiere rol de administrador' });
  }

  next();
}

// ✅ Middleware opcional: requerir ADMIN o STAFF de una sucursal específica
export function requireBranchAccess(branchIdParamName = 'branchId') {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.auth) {
      return res.status(401).json({ error: 'No autorizado' });
    }

    // Los ADMIN pueden acceder a todo
    if (req.auth.role === 'ADMIN') {
      return next();
    }

    // Para STAFF, verificar que estén accediendo a su sucursal
    const branchId = parseInt(req.params[branchIdParamName] as string);
    
    if (isNaN(branchId) || req.auth.branchId !== branchId) {
      return res.status(403).json({ 
        error: 'Acceso denegado. Solo puedes acceder a tu propia sucursal' 
      });
    }

    next();
  };
}