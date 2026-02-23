// src/auth/AuthContext.tsx
import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../api/http";
import { clearToken, getToken, setToken } from "./storage";

export type User = {
  id: number;
  email?: string | null;
  username: string;
  name: string;
  role: "ADMIN" | "STAFF" | "COUNTER" | "PRODUCTION";
  branchId: number | null;
  branchName: string | null;
};

type AuthContextValue = {
  user: User | null;
  loading: boolean;
  token: string | null;
  login: (username: string, password: string) => Promise<User>; // 👈 devuelve user
  logout: () => void;
  refreshMe: () => Promise<User | null>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setTokenState] = useState<string | null>(() => getToken());
  const [loading, setLoading] = useState(true);

  async function refreshMe(): Promise<User | null> {
    const t = getToken();
    setTokenState(t);

    if (!t) {
      setUser(null);
      return null;
    }

    try {
      const data = await apiFetch<{ user: User }>("/me");
      setUser(data.user);
      return data.user;
    } catch (e) {
      clearToken();
      setTokenState(null);
      setUser(null);
      return null;
    }
  }

  async function login(username: string, password: string): Promise<User> {
    const data = await apiFetch<{ token: string; user: User }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });

    setToken(data.token);
    setTokenState(data.token);

    // Si tu /auth/login ya trae user, úsalo directo:
    setUser(data.user);
    return data.user;

    // Si prefieres siempre validar contra /me, cambia por:
    // setToken(data.token);
    // setTokenState(data.token);
    // const me = await refreshMe();
    // if (!me) throw new Error("No se pudo cargar el usuario");
    // return me;
  }

  function logout() {
    clearToken();
    setTokenState(null);
    setUser(null);
  }

  useEffect(() => {
    (async () => {
      try {
        await refreshMe();
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, loading, token, login, logout, refreshMe }),
    [user, loading, token]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth debe usarse dentro de <AuthProvider>");
  return ctx;
}