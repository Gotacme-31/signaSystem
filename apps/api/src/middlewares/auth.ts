// middlewares/auth.ts
import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma';

export interface AuthUser {
  userId: number; // Cambia 'id' a 'userId' para coincidir con tu código
  email: string;
  name: string;
  role: 'ADMIN' | 'STAFF';
  branchId: number | null;
}

export interface AuthedRequest extends Request {
  auth?: AuthUser;
}

export async function auth(req: AuthedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No autorizado - Token requerido' });
  }

  const token = authHeader.substring(7); // Remove "Bearer "

  try {
    // Verificar el token JWT
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      console.error('JWT_SECRET no está configurado');
      return res.status(500).json({ error: 'Error de configuración del servidor' });
    }

    const decoded = jwt.verify(token, secret) as {
      userId: number;
      email: string;
      role: 'ADMIN' | 'STAFF';
      branchId: number | null;
    };

    console.log('Token decodificado:', decoded);

    // Obtener usuario desde la base de datos para verificar que aún existe
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        branchId: true,
        isActive: true,
        branch: {
          select: {
            id: true,
            name: true,
            isActive: true
          }
        }
      }
    });

    if (!user) {
      console.log('Usuario no encontrado en DB:', decoded.userId);
      return res.status(401).json({ error: 'Usuario no encontrado' });
    }

    if (!user.isActive) {
      console.log('Usuario inactivo:', user.id);
      return res.status(401).json({ error: 'Usuario inactivo' });
    }

    // Verificar que la sucursal esté activa si el usuario tiene sucursal
    if (user.branchId && (!user.branch || !user.branch.isActive)) {
      console.log('Sucursal inactiva:', user.branchId);
      return res.status(403).json({ error: 'Sucursal asignada no está activa' });
    }

    // Establecer la información de autenticación
    req.auth = {
      userId: user.id, // Usa 'userId' en lugar de 'id'
      email: user.email,
      name: user.name,
      role: user.role,
      branchId: user.branchId
    };

    console.log('Usuario autenticado:', req.auth);
    next();
  } catch (error: any) {
    console.error('Error de autenticación:', error.message);
    
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Token inválido' });
    }
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expirado' });
    }
    
    return res.status(401).json({ error: 'Error de autenticación' });
  }
}

// Middleware para requerir rol de ADMIN
export function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!req.auth) {
    return res.status(401).json({ error: 'No autorizado' });
  }

  if (req.auth.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Acceso denegado. Se requiere rol de administrador' });
  }

  next();
}