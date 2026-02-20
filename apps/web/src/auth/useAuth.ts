// auth/useAuth.ts
import { useEffect, useState } from "react";
import { apiFetch } from "../api/http";
import { clearToken, getToken, setToken } from "./storage";

// Actualizar el tipo User con los nuevos roles y username
export type User = { 
  id: number; 
  email?: string | null;  // Opcional
  username: string;       // 👈 Agregar username
  name: string;
  role: "ADMIN" | "STAFF" | "COUNTER" | "PRODUCTION"; // 👈 Agregar nuevos roles
  branchId: number | null;
  branchName: string | null;
};

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  async function fetchMe() {
    try {
      const data = await apiFetch<{ user: User }>("/me");
      console.log('Usuario obtenido de /me:', data.user);
      setUser(data.user);
      return data.user;
    } catch (e: any) {
      console.error('Error en fetchMe:', e);
      clearToken();
      setUser(null);
      throw e;
    }
  }

  // 👈 ACTUALIZADO: ahora recibe username en lugar de email
  async function login(username: string, password: string) {
    try {
      console.log('Iniciando login para:', username);
      const data = await apiFetch<{ token: string; user: User }>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password }), // 👈 Cambiado a username
      });

      console.log('Login exitoso, token recibido');
      setToken(data.token);

      // Obtener información completa del usuario
      await fetchMe();
    } catch (e: any) {
      console.error('Error en login:', e);
      throw e;
    }
  }

  function logout() {
    console.log('Cerrando sesión');
    clearToken();
    setUser(null);
  }

  useEffect(() => {
    (async () => {
      try {
        const token = getToken();
        console.log('Token en storage:', token ? 'Presente' : 'Ausente');
        
        if (token) {
          await fetchMe();
        }
      } catch (e: any) {
        console.error('Error al cargar usuario:', e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return { user, loading, login, logout };
}

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
