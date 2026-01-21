import { useEffect, useState } from "react";
import { api } from "../api/client";
import { clearToken, getToken, setToken } from "./storage";

type User = { id: number; email: string; role: "ADMIN" | "STAFF"; branchId: number | null };

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  async function fetchMe() {
    const { data } = await api.get("/me");
    setUser(data.user);
  }

  async function login(email: string, password: string) {
    const { data } = await api.post("/auth/login", { email, password });
    setToken(data.token);
    await fetchMe();
  }

  function logout() {
    clearToken();
    setUser(null);
  }

  useEffect(() => {
    (async () => {
      try {
        if (getToken()) await fetchMe();
      } catch {
        clearToken();
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return { user, loading, login, logout };
}
