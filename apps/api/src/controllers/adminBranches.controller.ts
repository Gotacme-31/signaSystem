// FILE: src/controllers/adminBranches.controller.ts

import type { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import {
  assertBranchHasNoInventoryHistory,
  branchHasInventoryHistory,
  BranchHasInventoryHistoryError,
  isPrismaForeignKeyError,
} from "../services/branch-inventory-delete.service";
import type { AuthedRequest } from "../middlewares/auth";
import bcrypt from "bcrypt";

const OPERATIONAL_ROLES = ["STAFF", "COUNTER", "MULTI_COUNTER"] as const;
const MAX_DEACTIVATION_ATTEMPTS = 3;

function normalizeAccessibleBranchIds(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const ids = value
    .map((item) => Number(item))
    .filter((id) => Number.isFinite(id));
  return Array.from(new Set(ids));
}

function mapUserWithAccesses<T extends { branchAccesses?: Array<{ branchId: number }> }>(user: T) {
  const { branchAccesses, ...rest } = user as T & { branchAccesses?: Array<{ branchId: number }> };
  return {
    ...rest,
    accessibleBranchIds: branchAccesses?.map((access) => access.branchId) ?? [],
  };
}

// GET /admin/branches - Listar todas las sucursales
export async function adminGetBranches(req: Request, res: Response) {
  try {
    const branches = await prisma.branch.findMany({
      orderBy: { name: "asc" },
      include: {
        users: {
          where: { isActive: true },
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

    await assertBranchHasNoInventoryHistory(prisma, id);

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
    if (error instanceof BranchHasInventoryHistoryError) {
      return res.status(error.status).json({ code: error.code, error: error.message });
    }
    if (isPrismaForeignKeyError(error)) {
      const id = Number(req.params.id);
      if (Number.isFinite(id) && await branchHasInventoryHistory(prisma, id)) {
        const inventoryError = new BranchHasInventoryHistoryError();
        return res.status(inventoryError.status).json({
          code: inventoryError.code,
          error: inventoryError.message,
        });
      }
    }
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
      where: {
        isActive: true,
        OR: [
          { branchId },
          {
            branchAccesses: {
              some: { branchId },
            },
          },
        ],
      },
      select: {
        id: true,
        name: true,
        username: true,
        email: true,
        role: true,
        isActive: true,
        createdAt: true,
        branchAccesses: {
          select: { branchId: true },
        },
      },
      orderBy: { name: "asc" },
    });

    res.json(users.map(mapUserWithAccesses));
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

    const { name, username, password, role, email, accessibleBranchIds } = req.body;

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
    if (!["STAFF", "COUNTER", "MULTI_COUNTER", "PRODUCTION"].includes(role)) {
      return res.status(400).json({ error: "Rol inválido" });
    }

    const normalizedAccessBranchIds = normalizeAccessibleBranchIds(accessibleBranchIds).filter(
      (id) => id !== branchId
    );

    if (role === "MULTI_COUNTER" && normalizedAccessBranchIds.length > 0) {
      const availableBranches = await prisma.branch.findMany({
        where: { id: { in: normalizedAccessBranchIds }, isActive: true },
        select: { id: true },
      });

      if (availableBranches.length !== normalizedAccessBranchIds.length) {
        return res.status(400).json({
          error: "Una o más sucursales de acceso no existen o están inactivas",
        });
      }
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

    const user = await prisma.$transaction(async (tx) => {
      const createdUser = await tx.user.create({
        data: {
          name: name.trim(),
          username: username.trim(),
          email: email?.trim()?.toLowerCase() || null,
          passwordHash: hashedPassword,
          role,
          isActive: true,
          branchId,
        },
      });

      if (role === "MULTI_COUNTER" && normalizedAccessBranchIds.length > 0) {
        await tx.userBranchAccess.createMany({
          data: normalizedAccessBranchIds.map((id) => ({ userId: createdUser.id, branchId: id })),
          skipDuplicates: true,
        });
      }

      return tx.user.findUniqueOrThrow({
        where: { id: createdUser.id },
        select: {
          id: true,
          name: true,
          username: true,
          email: true,
          role: true,
          isActive: true,
          createdAt: true,
          branchAccesses: {
            select: { branchId: true },
          },
        },
      });
    });

    res.status(201).json(mapUserWithAccesses(user));
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

    if (Object.prototype.hasOwnProperty.call(req.body, "isActive")) {
      return res.status(400).json({ error: "El estado del usuario no se puede modificar desde esta ruta" });
    }

    const { name, username, email, role, accessibleBranchIds } = req.body;

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
      if (!["STAFF", "COUNTER", "MULTI_COUNTER", "PRODUCTION"].includes(role)) {
        return res.status(400).json({ error: "Rol inválido" });
      }
      data.role = role;
    }

    const currentUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, branchId: true, role: true },
    });

    if (!currentUser) {
      return res.status(404).json({ error: "Usuario no encontrado" });
    }

    const nextRole = (role ?? currentUser.role) as string;
    const normalizedAccessBranchIds = normalizeAccessibleBranchIds(accessibleBranchIds).filter(
      (id) => id !== currentUser.branchId
    );

    if (nextRole === "MULTI_COUNTER" && accessibleBranchIds !== undefined) {
      if (normalizedAccessBranchIds.length > 0) {
        const availableBranches = await prisma.branch.findMany({
          where: { id: { in: normalizedAccessBranchIds }, isActive: true },
          select: { id: true },
        });

        if (availableBranches.length !== normalizedAccessBranchIds.length) {
          return res.status(400).json({
            error: "Una o más sucursales de acceso no existen o están inactivas",
          });
        }
      }
    }

    const user = await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data,
      });

      if (nextRole !== "MULTI_COUNTER") {
        await tx.userBranchAccess.deleteMany({ where: { userId } });
      } else if (accessibleBranchIds !== undefined) {
        await tx.userBranchAccess.deleteMany({ where: { userId } });
        if (normalizedAccessBranchIds.length > 0) {
          await tx.userBranchAccess.createMany({
            data: normalizedAccessBranchIds.map((id) => ({ userId, branchId: id })),
            skipDuplicates: true,
          });
        }
      }

      return tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: {
          id: true,
          name: true,
          username: true,
          email: true,
          role: true,
          isActive: true,
          createdAt: true,
          branchAccesses: {
            select: { branchId: true },
          },
        },
      });
    });

    res.json(mapUserWithAccesses(user));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error al actualizar usuario" });
  }
}

// PATCH /admin/branches/users/:userId/deactivate - Baja lógica de usuario
export async function adminDeactivateUser(req: AuthedRequest, res: Response) {
  const userId = Number(req.params.userId);
  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ error: "ID de usuario inválido" });
  }

  const authenticatedUserId = req.auth?.userId;
  if (!authenticatedUserId) {
    return res.status(401).json({ error: "No autenticado" });
  }

  try {
    let result:
      | { status: "not-found" }
      | { status: "inactive" }
      | { status: "self" }
      | { status: "last-admin" }
      | { status: "success"; branchWithoutOperationalUsers: boolean }
      | undefined;

    for (let attempt = 1; attempt <= MAX_DEACTIVATION_ATTEMPTS; attempt += 1) {
      try {
        result = await prisma.$transaction(
          async (tx) => {
            const targetUser = await tx.user.findUnique({
              where: { id: userId },
              select: {
                id: true,
                isActive: true,
                role: true,
                branchId: true,
                branchAccesses: {
                  select: { branchId: true },
                },
              },
            });

            if (!targetUser) return { status: "not-found" as const };
            if (!targetUser.isActive) return { status: "inactive" as const };
            if (targetUser.id === authenticatedUserId) return { status: "self" as const };

            if (targetUser.role === "ADMIN") {
              const activeAdminCount = await tx.user.count({
                where: { role: "ADMIN", isActive: true },
              });

              if (activeAdminCount <= 1) return { status: "last-admin" as const };
            }

            let branchWithoutOperationalUsers = false;
            if (OPERATIONAL_ROLES.some((role) => role === targetUser.role)) {
              const branchIds = new Set<number>();
              if (targetUser.branchId) branchIds.add(targetUser.branchId);
              for (const access of targetUser.branchAccesses) branchIds.add(access.branchId);

              for (const branchId of branchIds) {
                const remainingOperationalUsers = await tx.user.count({
                  where: {
                    id: { not: targetUser.id },
                    isActive: true,
                    role: { in: [...OPERATIONAL_ROLES] },
                    OR: [
                      { branchId },
                      {
                        branchAccesses: {
                          some: { branchId },
                        },
                      },
                    ],
                  },
                });

                if (remainingOperationalUsers === 0) {
                  branchWithoutOperationalUsers = true;
                  break;
                }
              }
            }

            const updateResult = await tx.user.updateMany({
              where: { id: userId, isActive: true },
              data: { isActive: false },
            });

            if (updateResult.count !== 1) return { status: "inactive" as const };

            return {
              status: "success" as const,
              branchWithoutOperationalUsers,
            };
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
        );
        break;
      } catch (error) {
        const isWriteConflict =
          error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
        if (!isWriteConflict || attempt === MAX_DEACTIVATION_ATTEMPTS) throw error;
      }
    }

    if (!result) {
      return res.status(409).json({ error: "No se pudo completar la baja; inténtalo nuevamente" });
    }
    if (result.status === "not-found") {
      return res.status(404).json({ error: "Usuario no encontrado" });
    }
    if (result.status === "inactive") {
      return res.status(409).json({ error: "El usuario ya está inactivo" });
    }
    if (result.status === "self") {
      return res.status(409).json({ error: "No puedes eliminar tu propio usuario" });
    }
    if (result.status === "last-admin") {
      return res.status(409).json({ error: "No se puede eliminar al último ADMIN activo" });
    }

    try {
      const io = req.app.get("io");
      io?.in(`user:${userId}`).disconnectSockets(true);
    } catch (error) {
      console.error("No se pudieron desconectar los sockets del usuario retirado", {
        userId,
        error: error instanceof Error ? error.name : "UnknownError",
      });
    }

    return res.json({
      success: true,
      branchWithoutOperationalUsers: result.branchWithoutOperationalUsers,
    });
  } catch (error) {
    const isWriteConflict =
      error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
    if (isWriteConflict) {
      return res.status(409).json({ error: "No se pudo completar la baja; inténtalo nuevamente" });
    }

    console.error("Error al retirar usuario", {
      userId,
      error: error instanceof Error ? error.name : "UnknownError",
    });
    return res.status(500).json({ error: "Error al retirar usuario" });
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
