// FILE: src/controllers/adminBranches.controller.ts

import type { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import bcrypt from "bcrypt";

// GET /admin/branches - Listar todas las sucursales
export async function adminGetBranches(req: Request, res: Response) {
  try {
    const branches = await prisma.branch.findMany({
      orderBy: { name: "asc" },
      include: {
        users: {
          select: {
            id: true,
            name: true,
            username: true,
            email: true,
            role: true,
            isActive: true,
            createdAt: true,
          },
          orderBy: { name: "asc" },
        },
      },
    });
    res.json(branches);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error al obtener sucursales" });
  }
}

// GET /admin/branches/:id - Obtener una sucursal específica
export async function adminGetBranchById(req: Request, res: Response) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "ID inválido" });
    }

    const branch = await prisma.branch.findUnique({
      where: { id },
      include: {
        users: {
          select: {
            id: true,
            name: true,
            username: true,
            email: true,
            role: true,
            isActive: true,
            createdAt: true,
          },
          orderBy: { name: "asc" },
        },
      },
    });

    if (!branch) {
      return res.status(404).json({ error: "Sucursal no encontrada" });
    }

    res.json(branch);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error al obtener sucursal" });
  }
}

// POST /admin/branches - Crear nueva sucursal con usuario administrador
export async function adminCreateBranch(req: Request, res: Response) {
  try {
    const { name, isActive, adminName, adminUsername, adminPassword } = req.body;

    // Validaciones
    if (!name?.trim()) {
      return res.status(400).json({ error: "El nombre de la sucursal es obligatorio" });
    }
    if (!adminName?.trim()) {
      return res.status(400).json({ error: "El nombre del administrador es obligatorio" });
    }
    if (!adminUsername?.trim()) {
      return res.status(400).json({ error: "El nombre de usuario es obligatorio" });
    }
    if (!adminPassword?.trim()) {
      return res.status(400).json({ error: "La contraseña es obligatoria" });
    }
    if (adminPassword.length < 6) {
      return res.status(400).json({ error: "La contraseña debe tener al menos 6 caracteres" });
    }

    // Verificar si ya existe la sucursal
    const existingBranch = await prisma.branch.findUnique({
      where: { name: name.trim() },
    });
    if (existingBranch) {
      return res.status(400).json({ error: "Ya existe una sucursal con ese nombre" });
    }

    // Verificar si ya existe el username
    const existingUser = await prisma.user.findUnique({
      where: { username: adminUsername.trim() },
    });
    if (existingUser) {
      return res.status(400).json({ error: "Ya existe un usuario con ese nombre de usuario" });
    }

    // Hashear contraseña
    const hashedPassword = await bcrypt.hash(adminPassword, 10);

    // Crear sucursal y usuario en transacción
    const result = await prisma.$transaction(async (tx) => {
      // 1. Crear sucursal
      const branch = await tx.branch.create({
        data: {
          name: name.trim(),
          isActive: isActive ?? true,
        },
      });

      // 2. Crear usuario administrador (STAFF)
      const user = await tx.user.create({
        data: {
          name: adminName.trim(),
          username: adminUsername.trim(),
          passwordHash: hashedPassword,
          role: "STAFF",
          isActive: true,
          branchId: branch.id,
        },
        select: {
          id: true,
          name: true,
          username: true,
          role: true,
        },
      });

      return { branch, user };
    });

    res.status(201).json({
      branch: result.branch,
      user: result.user,
      message: "Sucursal creada correctamente",
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error al crear sucursal" });
  }
}

// PATCH /admin/branches/:id - Actualizar sucursal
export async function adminUpdateBranch(req: Request, res: Response) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "ID inválido" });
    }

    const { name, isActive } = req.body;

    const data: any = {};
    if (name !== undefined) {
      if (!name.trim()) {
        return res.status(400).json({ error: "El nombre no puede estar vacío" });
      }
      
      const existing = await prisma.branch.findFirst({
        where: {
          name: name.trim(),
          NOT: { id },
        },
      });
      if (existing) {
        return res.status(400).json({ error: "Ya existe otra sucursal con ese nombre" });
      }
      data.name = name.trim();
    }

    if (isActive !== undefined) {
      data.isActive = isActive;
    }

    const branch = await prisma.branch.update({
      where: { id },
      data,
    });

    res.json(branch);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error al actualizar sucursal" });
  }
}

// DELETE /admin/branches/:id - Eliminar sucursal
export async function adminDeleteBranch(req: Request, res: Response) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "ID inválido" });
    }

    const usersCount = await prisma.user.count({
      where: { branchId: id },
    });

    if (usersCount > 0) {
      return res.status(400).json({ 
        error: "No se puede eliminar la sucursal porque tiene usuarios asociados. Desactívala en su lugar." 
      });
    }

    const ordersCount = await prisma.order.count({
      where: { branchId: id },
    });

    if (ordersCount > 0) {
      return res.status(400).json({ 
        error: "No se puede eliminar la sucursal porque tiene órdenes asociadas. Desactívala en su lugar." 
      });
    }

    await prisma.branch.delete({
      where: { id },
    });

    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error al eliminar sucursal" });
  }
}

// GET /admin/branches/:branchId/users - Usuarios de una sucursal
export async function adminGetBranchUsers(req: Request, res: Response) {
  try {
    const branchId = Number(req.params.branchId);
    if (!Number.isFinite(branchId)) {
      return res.status(400).json({ error: "ID de sucursal inválido" });
    }

    const users = await prisma.user.findMany({
      where: { branchId },
      select: {
        id: true,
        name: true,
        username: true,
        email: true,
        role: true,
        isActive: true,
        createdAt: true,
      },
      orderBy: { name: "asc" },
    });

    res.json(users);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error al obtener usuarios" });
  }
}

// POST /admin/branches/:branchId/users - Crear usuario en sucursal
export async function adminCreateBranchUser(req: Request, res: Response) {
  try {
    const branchId = Number(req.params.branchId);
    if (!Number.isFinite(branchId)) {
      return res.status(400).json({ error: "ID de sucursal inválido" });
    }

    const { name, username, password, role, isActive, email } = req.body;

    // Validaciones
    if (!name?.trim()) {
      return res.status(400).json({ error: "El nombre del empleado es obligatorio" });
    }
    if (!username?.trim()) {
      return res.status(400).json({ error: "El nombre de usuario es obligatorio" });
    }
    if (!password?.trim()) {
      return res.status(400).json({ error: "La contraseña es obligatoria" });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: "La contraseña debe tener al menos 6 caracteres" });
    }
    if (!["STAFF", "COUNTER", "PRODUCTION"].includes(role)) {
      return res.status(400).json({ error: "Rol inválido" });
    }

    // Verificar username único
    const existingUser = await prisma.user.findUnique({
      where: { username: username.trim() },
    });

    if (existingUser) {
      return res.status(400).json({ error: "Ya existe un usuario con ese nombre de usuario" });
    }

    // Verificar email único si se proporciona
    if (email?.trim()) {
      const existingEmail = await prisma.user.findFirst({
        where: { 
          email: email.trim().toLowerCase(),
        },
      });
      if (existingEmail) {
        return res.status(400).json({ error: "Ya existe un usuario con ese email" });
      }
    }

    // Hashear contraseña
    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        name: name.trim(),
        username: username.trim(),
        email: email?.trim()?.toLowerCase() || null,
        passwordHash: hashedPassword,
        role,
        isActive: isActive ?? true,
        branchId,
      },
      select: {
        id: true,
        name: true,
        username: true,
        email: true,
        role: true,
        isActive: true,
        createdAt: true,
      },
    });

    res.status(201).json(user);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error al crear usuario" });
  }
}

// PATCH /admin/users/:userId - Actualizar usuario
export async function adminUpdateUser(req: Request, res: Response) {
  try {
    const userId = Number(req.params.userId);
    if (!Number.isFinite(userId)) {
      return res.status(400).json({ error: "ID de usuario inválido" });
    }

    const { name, username, email, role, isActive } = req.body;

    const data: any = {};

    if (name !== undefined) {
      if (!name.trim()) {
        return res.status(400).json({ error: "El nombre no puede estar vacío" });
      }
      data.name = name.trim();
    }

    if (username !== undefined) {
      if (!username.trim()) {
        return res.status(400).json({ error: "El nombre de usuario no puede estar vacío" });
      }
      
      const existing = await prisma.user.findFirst({
        where: {
          username: username.trim(),
          NOT: { id: userId },
        },
      });
      if (existing) {
        return res.status(400).json({ error: "Ya existe otro usuario con ese nombre de usuario" });
      }
      data.username = username.trim();
    }

    if (email !== undefined) {
      if (email?.trim()) {
        const existing = await prisma.user.findFirst({
          where: {
            email: email.trim().toLowerCase(),
            NOT: { id: userId },
          },
        });
        if (existing) {
          return res.status(400).json({ error: "Ya existe otro usuario con ese email" });
        }
        data.email = email.trim().toLowerCase();
      } else {
        data.email = null;
      }
    }

    if (role !== undefined) {
      if (!["STAFF", "COUNTER", "PRODUCTION"].includes(role)) {
        return res.status(400).json({ error: "Rol inválido" });
      }
      data.role = role;
    }

    if (isActive !== undefined) {
      data.isActive = isActive;
    }

    const user = await prisma.user.update({
      where: { id: userId },
      data,
      select: {
        id: true,
        name: true,
        username: true,
        email: true,
        role: true,
        isActive: true,
        createdAt: true,
      },
    });

    res.json(user);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error al actualizar usuario" });
  }
}

// POST /admin/users/:userId/change-password - Cambiar contraseña
export async function adminChangeUserPassword(req: Request, res: Response) {
  try {
    const userId = Number(req.params.userId);
    if (!Number.isFinite(userId)) {
      return res.status(400).json({ error: "ID de usuario inválido" });
    }

    const { newPassword } = req.body;

    if (!newPassword?.trim()) {
      return res.status(400).json({ error: "La nueva contraseña es obligatoria" });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: "La contraseña debe tener al menos 6 caracteres" });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash: hashedPassword },
    });

    res.json({ success: true, message: "Contraseña actualizada correctamente" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error al cambiar contraseña" });
  }
}