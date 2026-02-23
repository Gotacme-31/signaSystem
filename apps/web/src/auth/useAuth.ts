// src/auth/useAuth.ts
export { useAuth } from "./AuthContext";
export type { User } from "./AuthContext";

// (si aquí también tenías verifyPassword, déjalo igual abajo)
import { apiFetch } from "../api/http";

export async function verifyBranchUserPassword(userId: number, password: string): Promise<{ success: boolean }> {
  return apiFetch("/auth/verify-password", {
    method: "POST",
    body: JSON.stringify({ userId, password }),
  });
}

export async function verifyBranchPassword(branchId: number, password: string): Promise<{ success: boolean }> {
  return apiFetch("/auth/verify-branch-password", {
    method: "POST",
    body: JSON.stringify({ branchId, password }),
  });
}

export async function verifyManagerPassword(branchId: number, password: string): Promise<{
  success: boolean;
  managerName: string;
}> {
  return apiFetch("/auth/verify-manager-password", {
    method: "POST",
    body: JSON.stringify({ branchId, password }),
  });
}