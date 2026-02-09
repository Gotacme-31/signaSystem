// routes/auth.ts
import { Router } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma";

const router = Router();

router.post("/login", async (req, res) => {
  try {
    console.log("Intento de login recibido:", req.body);
    
    const { email, password } = req.body as { email?: string; password?: string };

    if (!email || !password) {
      return res.status(400).json({ message: "Falta email o password" });
    }

    const user = await prisma.user.findUnique({ 
      where: { email },
      include: {
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
      console.log("Usuario no encontrado:", email);
      return res.status(401).json({ message: "Credenciales inválidas" });
    }

    // Verificar que el usuario esté activo
    if (!user.isActive) {
      console.log("Usuario inactivo:", user.id);
      return res.status(401).json({ message: "Usuario inactivo" });
    }

    // Verificar que la sucursal esté activa si el usuario tiene sucursal
    if (user.branchId && (!user.branch || !user.branch.isActive)) {
      console.log("Sucursal asignada no está activa:", user.branchId);
      return res.status(403).json({ message: "Sucursal asignada no está activa" });
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      console.log("Contraseña incorrecta para:", email);
      return res.status(401).json({ message: "Credenciales inválidas" });
    }

    const secret = process.env.JWT_SECRET;
    if (!secret) {
      console.error("JWT_SECRET no configurado");
      return res.status(500).json({ message: "Error de configuración del servidor" });
    }

    // Crear token con userId (no id)
    const token = jwt.sign(
      { 
        userId: user.id, // Usa 'userId' aquí
        email: user.email,
        name: user.name,
        role: user.role, 
        branchId: user.branchId ?? null 
      },
      secret,
      { expiresIn: "7d" }
    );

    console.log("Login exitoso para:", user.email);
    
    res.json({
      token,
      user: { 
        id: user.id, 
        email: user.email, 
        name: user.name,
        role: user.role, 
        branchId: user.branchId,
        branchName: user.branch?.name || null
      },
    });
  } catch (error: any) {
    console.error("Error en login:", error);
    res.status(500).json({ 
      message: "Error interno del servidor",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Ruta de prueba para verificar la configuración
router.get("/test-config", async (req, res) => {
  try {
    const secret = process.env.JWT_SECRET;
    const userCount = await prisma.user.count();
    
    res.json({
      jwtSecretConfigured: !!secret,
      userCount,
      environment: process.env.NODE_ENV,
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    console.error("Error en test-config:", error);
    res.status(500).json({ error: error.message });
  }
});

export default router;