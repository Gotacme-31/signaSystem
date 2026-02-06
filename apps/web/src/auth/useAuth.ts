import { useEffect, useState } from "react";
import { apiFetch } from "../api/http"; // <-- usa tu apiFetch
import { clearToken, getToken, setToken } from "./storage";

type User = { id: number; email: string; role: "ADMIN" | "STAFF"; branchId: number | null };

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  async function fetchMe() {
    try {
      const data = await apiFetch<{ user: User }>("/me");
      setUser(data.user);
      return data.user;
    } catch (e) {
      clearToken();
      setUser(null);
      throw e;
    }
  }

  async function login(email: string, password: string) {
    const data = await apiFetch<{ token: string; user: User }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });

    setToken(data.token);

    // ahora /me ya debe entrar con Bearer
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
        // fetchMe ya limpia token/user
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return { user, loading, login, logout };
}
