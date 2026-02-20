// routes/auth.ts
import { Router } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma";
import { auth, AuthedRequest } from "../middlewares/auth";

const router = Router();

router.post("/login", async (req, res) => {
  try {
    // 👈 CAMBIADO: ahora espera 'username' en lugar de 'email'
    const { username, password } = req.body as { username?: string; password?: string };

    if (!username || !password) {
      return res.status(400).json({ message: "Falta usuario o contraseña" });
    }

    // 👈 BUSCAR POR USERNAME O EMAIL
    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { username: username.trim() },
          { email: username.trim().toLowerCase() }
        ]
      },
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
      return res.status(401).json({ message: "Credenciales inválidas" });
    }

    // Verificar que el usuario esté activo
    if (!user.isActive) {
      return res.status(401).json({ message: "Usuario inactivo" });
    }

    // Verificar que la sucursal esté activa si el usuario tiene sucursal
    if (user.branchId && (!user.branch || !user.branch.isActive)) {
      return res.status(403).json({ message: "Sucursal asignada no está activa" });
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
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
        userId: user.id,
        username: user.username, // 👈 AGREGAR USERNAME
        email: user.email,
        name: user.name,
        role: user.role, 
        branchId: user.branchId ?? null 
      },
      secret,
      { expiresIn: "7d" }
    );

    res.json({
      token,
      user: { 
        id: user.id, 
        email: user.email,
        username: user.username, // 👈 INCLUIR USERNAME
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
// Verificar contraseña de usuario de sucursal (para edición)
router.post("/verify-password", auth, async (req: AuthedRequest, res) => {
  try {
    const { userId, password } = req.body;

    if (!userId || !password) {
      return res.status(400).json({ error: "Faltan datos" });
    }

    // Solo STAFF o COUNTER pueden verificar (no ADMIN)
    if (req.auth?.role === "ADMIN") {
      return res.json({ success: true }); // Admin no necesita verificación
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { passwordHash: true, branchId: true }
    });

    if (!user) {
      return res.status(404).json({ error: "Usuario no encontrado" });
    }

    // Verificar que sea de la misma sucursal
    if (user.branchId !== req.auth?.branchId) {
      return res.status(403).json({ error: "No autorizado" });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: "Contraseña incorrecta" });
    }

    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error en el servidor" });
  }
});
// Verificar contraseña del gerente (STAFF) de la sucursal
router.post("/verify-manager-password", auth, async (req: AuthedRequest, res) => {
  try {
    const { branchId, password } = req.body;

    if (!branchId || !password) {
      return res.status(400).json({ error: "Faltan datos" });
    }

    // Si es ADMIN, no necesita verificación
    if (req.auth?.role === "ADMIN") {
      return res.json({ 
        success: true, 
        managerName: "Administrador" 
      });
    }

    // Buscar un usuario STAFF activo de esa sucursal (el gerente)
    const manager = await prisma.user.findFirst({
      where: {
        branchId: branchId,
        role: "STAFF", // 👈 Solo STAFF, no COUNTER
        isActive: true,
      },
      select: {
        passwordHash: true,
        name: true,
      },
    });

    if (!manager) {
      return res.status(404).json({ 
        error: "No hay un gerente (STAFF) activo en esta sucursal" 
      });
    }

    const valid = await bcrypt.compare(password, manager.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: "Contraseña incorrecta" });
    }

    res.json({ 
      success: true,
      managerName: manager.name 
    });
  } catch (error) {
    console.error("Error en verify-manager-password:", error);
    res.status(500).json({ error: "Error en el servidor" });
  }
});
export default router;