import { useMemo, useState } from "react";
import { registerCustomer } from "../api/customers";

function onlyDigits(s: string) {
  return (s ?? "").replace(/\D/g, "");
}

function formatPhonePretty(digits: string) {
  // muestra bonito mientras escribe (no afecta lo que mandamos)
  const d = onlyDigits(digits).slice(0, 10);
  if (d.length <= 2) return d;
  if (d.length <= 6) return `${d.slice(0, 2)} ${d.slice(2)}`;
  return `${d.slice(0, 2)} ${d.slice(2, 6)} ${d.slice(6)}`;
}

export default function RegisterCustomer() {
  const [name, setName] = useState("");
  const [phoneRaw, setPhoneRaw] = useState("");
  const [loading, setLoading] = useState(false);

  const [result, setResult] = useState<{ customerId: number; isNew: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const phoneDigits = useMemo(() => onlyDigits(phoneRaw).slice(0, 10), [phoneRaw]);

  const nameClean = useMemo(() => name.trim().replace(/\s+/g, " "), [name]);

  const validation = useMemo(() => {
    if (!nameClean) return "Escribe el nombre.";
    if (nameClean.length < 3) return "El nombre está muy corto.";
    if (!phoneDigits) return "Escribe el celular.";
    if (phoneDigits.length !== 10) return "El celular debe tener 10 dígitos.";
    return null;
  }, [nameClean, phoneDigits]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (validation) {
      setError(validation);
      return;
    }

    try {
      setError(null);
      setResult(null);
      setCopied(false);
      setLoading(true);

      const r = await registerCustomer({ name: nameClean, phone: phoneDigits });
      setResult(r);
    } catch (e: any) {
      setError(e?.message ?? "Error registrando cliente");
    } finally {
      setLoading(false);
    }
  }

  async function copyCustomerId() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(String(result.customerId));
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      // fallback suave
      setCopied(false);
    }
  }

  function resetForm() {
    setName("");
    setPhoneRaw("");
    setResult(null);
    setError(null);
    setCopied(false);
  }

  return (
    <div style={{ padding: 16, maxWidth: 560, margin: "0 auto" }}>
      <div
        style={{
          border: "1px solid #e6e6e6",
          borderRadius: 14,
          padding: 16,
          background: "#fff",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <h2 style={{ margin: 0 }}>Registro de cliente</h2>
            <p style={{ marginTop: 6, opacity: 0.85 }}>
              Regístrate una sola vez y te damos tu <b>número de cliente</b>.
            </p>
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
            <button
              type="button"
              onClick={resetForm}
              style={{
                padding: "8px 12px",
                borderRadius: 10,
                border: "1px solid #ddd",
                background: "#fff",
                cursor: "pointer",
              }}
            >
              Limpiar
            </button>
          </div>
        </div>

        <form onSubmit={onSubmit} style={{ marginTop: 14, display: "grid", gap: 12 }}>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: 13, opacity: 0.85 }}>Nombre</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={{
                padding: 12,
                borderRadius: 12,
                border: "1px solid #ddd",
                outline: "none",
              }}
              placeholder="Ej. Juan Pérez"
              autoComplete="name"
            />
          </label>

          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: 13, opacity: 0.85 }}>Celular (10 dígitos)</span>
            <input
              value={formatPhonePretty(phoneRaw)}
              onChange={(e) => setPhoneRaw(e.target.value)}
              style={{
                padding: 12,
                borderRadius: 12,
                border: "1px solid #ddd",
                outline: "none",
              }}
              placeholder="Ej. 55 1234 5678"
              inputMode="numeric"
              autoComplete="tel"
            />
            <div style={{ fontSize: 12, opacity: 0.7 }}>
              {phoneDigits.length}/10 dígitos
            </div>
          </label>

          <button
            disabled={loading || !!validation}
            style={{
              padding: 12,
              borderRadius: 12,
              border: "1px solid #ddd",
              background: loading || validation ? "#f2f2f2" : "#111",
              color: loading || validation ? "#777" : "#fff",
              cursor: loading || validation ? "not-allowed" : "pointer",
              fontWeight: 700,
            }}
          >
            {loading ? "Registrando..." : "Registrar"}
          </button>

          {/* Hint de validación */}
          {validation && !error && (
            <div style={{ fontSize: 12, opacity: 0.75 }}>
              {validation}
            </div>
          )}
        </form>

        {error && (
          <div
            style={{
              marginTop: 12,
              padding: 12,
              border: "1px solid #f5c2c7",
              background: "#f8d7da",
              borderRadius: 12,
            }}
          >
            {error}
          </div>
        )}

        {result && (
          <div
            style={{
              marginTop: 14,
              padding: 14,
              border: "1px solid #cfe2ff",
              background: "#e7f1ff",
              borderRadius: 14,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 800 }}>
                  Tu número de cliente es: <span style={{ fontSize: 22 }}>#{result.customerId}</span>
                </div>

                <div style={{ marginTop: 6, opacity: 0.85 }}>
                  {result.isNew
                    ? "Cliente registrado ✅"
                    : "Este número ya existía (actualizamos tu nombre si cambió) ✅"}
                </div>

                <div style={{ marginTop: 10, fontSize: 12, opacity: 0.75 }}>
                  Guárdalo: con ese número podrás registrar pedidos sin volver a capturar tus datos.
                </div>
              </div>

              <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                <button
                  type="button"
                  onClick={copyCustomerId}
                  style={{
                    padding: "8px 12px",
                    borderRadius: 10,
                    border: "1px solid #ddd",
                    background: "#fff",
                    cursor: "pointer",
                    fontWeight: 700,
                  }}
                >
                  {copied ? "Copiado ✅" : "Copiar #"}
                </button>

                {/* Opcional: si tienes ruta a /new-order o similar */}
                {/* <a
                  href="/new-order"
                  style={{
                    padding: "8px 12px",
                    borderRadius: 10,
                    border: "1px solid #ddd",
                    background: "#fff",
                    cursor: "pointer",
                    fontWeight: 700,
                    textDecoration: "none",
                    color: "#111",
                    display: "inline-flex",
                    alignItems: "center",
                  }}
                >
                  Nuevo pedido →
                </a> */}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Mini footer */}
      <div style={{ marginTop: 10, fontSize: 12, opacity: 0.7, textAlign: "center" }}>
        Tip: puedes pegar el celular con espacios o guiones, el sistema lo limpia automáticamente.
      </div>
    </div>
  );
}
