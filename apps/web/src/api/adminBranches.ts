// api/adminBranches.ts

import { apiFetch } from "./http";

export type UserRole = "ADMIN" | "STAFF" | "COUNTER" | "PRODUCTION";

export type Branch = {
  id: number;
  name: string;
  isActive: boolean;
  createdAt: string;
  users?: BranchUser[];
};

export type BranchUser = {
  id: number;
  name: string;
  username: string;        // 👈 Obligatorio
  email?: string | null;    // 👈 Opcional
  role: UserRole;
  isActive: boolean;
  createdAt: string;
};

// 👈 CORREGIDO: Para crear sucursal (usamos adminName, adminUsername, adminPassword)
export type CreateBranchData = {
  name: string;
  isActive?: boolean;
  adminName: string;        // Nombre del administrador
  adminUsername: string;    // Username del administrador
  adminPassword: string;
};

export type UpdateBranchData = {
  name?: string;
  isActive?: boolean;
};

// 👈 CORREGIDO: Para crear usuario en sucursal
export type CreateUserData = {
  name: string;
  username: string;         // 👈 Ahora es obligatorio
  password: string;
  role: UserRole;
  isActive?: boolean;
  email?: string | null;    // 👈 Opcional
};

export type UpdateUserData = {
  name?: string;
  username?: string;
  role?: UserRole;
  isActive?: boolean;
  email?: string | null;
};

// API Functions (sin cambios, solo los tipos)
export async function adminGetBranches(): Promise<Branch[]> {
  return apiFetch("/admin/branches");
}

export async function adminGetBranchById(id: number): Promise<Branch> {
  return apiFetch(`/admin/branches/${id}`);
}

export async function adminCreateBranch(data: CreateBranchData): Promise<Branch> {
  return apiFetch("/admin/branches", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function adminUpdateBranch(id: number, data: UpdateBranchData): Promise<Branch> {
  return apiFetch(`/admin/branches/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function adminDeleteBranch(id: number): Promise<{ success: boolean }> {
  return apiFetch(`/admin/branches/${id}`, {
    method: "DELETE",
  });
}

export async function adminGetBranchUsers(branchId: number): Promise<BranchUser[]> {
  return apiFetch(`/admin/branches/${branchId}/users`);
}

export async function adminCreateBranchUser(branchId: number, data: CreateUserData): Promise<BranchUser> {
  return apiFetch(`/admin/branches/${branchId}/users`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function adminUpdateUser(userId: number, data: UpdateUserData): Promise<BranchUser> {
  return apiFetch(`/admin/users/${userId}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function adminChangeUserPassword(userId: number, newPassword: string): Promise<{ success: boolean }> {
  return apiFetch(`/admin/users/${userId}/change-password`, {
    method: "POST",
    body: JSON.stringify({ newPassword }),
  });
}