// auth/useAuth.ts
import { useEffect, useState } from "react";
import { apiFetch } from "../api/http";
import { clearToken, getToken, setToken } from "./storage";

type User = { 
  id: number; 
  email: string; 
  name: string;
  role: "ADMIN" | "STAFF"; 
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

  async function login(email: string, password: string) {
    try {
      console.log('Iniciando login para:', email);
      const data = await apiFetch<{ token: string; user: User }>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
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