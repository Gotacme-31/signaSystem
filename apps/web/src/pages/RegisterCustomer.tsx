import { useState } from "react";
import { registerCustomer } from "../api/customers";

export default function RegisterCustomer() {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);

  const [result, setResult] = useState<{ customerId: number; isNew: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      setError(null);
      setResult(null);
      setLoading(true);

      const r = await registerCustomer({ name, phone });
      setResult(r);
    } catch (e: any) {
      setError(e.message ?? "Error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ padding: 16, maxWidth: 520, margin: "0 auto" }}>
      <h2>Registro de cliente</h2>
      <p style={{ marginTop: 6 }}>
        Regístrate una sola vez y te damos tu <b>número de cliente</b>.
      </p>

      <form onSubmit={onSubmit} style={{ marginTop: 14, display: "grid", gap: 10 }}>
        <label>
          Nombre
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{ width: "100%", padding: 10, marginTop: 6 }}
            placeholder="Ej. Juan Pérez"
          />
        </label>

        <label>
          Celular (10 dígitos)
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            style={{ width: "100%", padding: 10, marginTop: 6 }}
            placeholder="Ej. 55 1234 5678"
          />
        </label>

        <button disabled={loading} style={{ padding: 12 }}>
          {loading ? "Registrando..." : "Registrar"}
        </button>
      </form>

      {error && (
        <div style={{ marginTop: 12, padding: 10, border: "1px solid #f5c2c7", background: "#f8d7da" }}>
          {error}
        </div>
      )}

      {result && (
        <div style={{ marginTop: 14, padding: 14, border: "1px solid #cfe2ff", background: "#e7f1ff" }}>
          <div style={{ fontSize: 18 }}>
            Tu número de cliente es: <b>#{result.customerId}</b>
          </div>
          <div style={{ marginTop: 6 }}>
            {result.isNew ? "Cliente registrado ✅" : "Este número ya existía (actualizamos tu nombre si cambió) ✅"}
          </div>
          <div style={{ marginTop: 10, opacity: 0.8 }}>
            Guárdalo, porque con ese número podrás registrar pedidos sin volver a capturar tus datos.
          </div>
        </div>
      )}
    </div>
  );
}
