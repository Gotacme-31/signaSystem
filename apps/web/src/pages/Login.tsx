import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../auth/useAuth";

export default function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const location = useLocation();

  const from = (location.state as any)?.from?.pathname as string | undefined;

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(email, password);
      nav(from ?? "/orders", { replace: true });
    } catch (err: any) {
      const msg =
        err?.response?.data?.message ??
        err?.response?.data?.error ??
        err?.message ??
        "Error al iniciar sesión";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 20 }}>
      <div style={{ width: "100%", maxWidth: 420, border: "1px solid #eee", borderRadius: 16, padding: 18, background: "#fff" }}>
        <h1 style={{ margin: 0 }}>Signa</h1>
        <div style={{ marginTop: 6, opacity: 0.75, fontSize: 13 }}>Inicia sesión para continuar</div>

        <form onSubmit={onSubmit} style={{ marginTop: 16, display: "grid", gap: 10 }}>
          <label style={{ fontSize: 13, opacity: 0.85 }}>
            Email
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="correo@empresa.com"
              style={{ width: "100%", padding: 10, marginTop: 6, borderRadius: 10, border: "1px solid #ddd" }}
              autoComplete="email"
            />
          </label>

          <label style={{ fontSize: 13, opacity: 0.85 }}>
            Password
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              type="password"
              style={{ width: "100%", padding: 10, marginTop: 6, borderRadius: 10, border: "1px solid #ddd" }}
              autoComplete="current-password"
            />
          </label>

          <button
            disabled={loading}
            style={{
              marginTop: 6,
              padding: 12,
              borderRadius: 10,
              border: "1px solid #ddd",
              background: "#fff",
              cursor: loading ? "not-allowed" : "pointer",
              fontWeight: 700,
            }}
          >
            {loading ? "Entrando..." : "Entrar"}
          </button>

          {error && (
            <div style={{ padding: 10, border: "1px solid #f5c2c7", background: "#f8d7da", borderRadius: 10 }}>
              {error}
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
