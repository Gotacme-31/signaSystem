// routes/me.ts
import { Router } from "express";
import { prisma } from "../lib/prisma";
import { auth, type AuthedRequest } from "../middlewares/auth";

const router = Router();

router.get("/", auth, async (req: AuthedRequest, res) => {
  try {
    console.log('Endpoint /me llamado, auth:', req.auth);
    
    if (!req.auth) {
      return res.status(401).json({ error: "No autorizado" });
    }

    const userId = req.auth.userId;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { 
        id: true, 
        email: true, 
        name: true,
        role: true, 
        branchId: true,
        branch: {
          select: {
            id: true,
            name: true
          }
        }
      },
    });

    if (!user) {
      return res.status(404).json({ error: "Usuario no encontrado" });
    }

    res.json({ 
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        branchId: user.branchId,
        branchName: user.branch?.name || null
      }
    });
  } catch (error: any) {
    console.error('Error en endpoint /me:', error);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

export default router;