import { useMemo, useState } from "react";
import { registerCustomer } from "../api/customers";
import { 
  UserPlus, 
  Copy, 
  Check, 
  Trash2,
  AlertCircle,
  Info,
  Phone,
  User
} from "lucide-react"; // Opcional: iconos

function onlyDigits(s: string) {
  return (s ?? "").replace(/\D/g, "");
}

function formatPhonePretty(digits: string) {
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
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-4 md:p-6">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="mb-8 text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-600 rounded-2xl mb-4 shadow-lg">
            <UserPlus className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl md:text-4xl font-bold text-gray-900 mb-3">
            Registro de Cliente
          </h1>
          <p className="text-lg text-gray-600 max-w-2xl mx-auto">
            Regístrate una sola vez y recibe tu <span className="font-semibold text-blue-600">número de cliente</span> para futuros pedidos.
          </p>
        </div>

        <div className="bg-white rounded-2xl shadow-xl border border-gray-200 overflow-hidden">
          {/* Card Header */}
          <div className="px-6 py-5 border-b border-gray-100 bg-gradient-to-r from-blue-50 to-indigo-50">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold text-gray-900">Nuevo Cliente</h2>
                <p className="text-sm text-gray-600 mt-1">
                  Completa tus datos para registrarte en el sistema
                </p>
              </div>
              <button
                type="button"
                onClick={resetForm}
                className="inline-flex items-center gap-2 px-4 py-2.5 bg-white hover:bg-gray-50 text-gray-700 font-medium rounded-lg border border-gray-300 shadow-sm hover:shadow transition-all duration-200"
              >
                <Trash2 className="w-4 h-4" />
                Limpiar Formulario
              </button>
            </div>
          </div>

          {/* Form Content */}
          <div className="p-6 md:p-8">
            <form onSubmit={onSubmit} className="space-y-6">
              {/* Name Field */}
              <div className="space-y-2">
                <label className="block">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center">
                      <User className="w-4 h-4 text-blue-600" />
                    </div>
                    <span className="font-medium text-gray-700">Nombre completo</span>
                  </div>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full px-4 py-3.5 bg-gray-50 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:bg-white transition-all duration-200 placeholder:text-gray-400"
                    placeholder="Ej. Juan Pérez García"
                    autoComplete="name"
                  />
                  {nameClean && (
                    <div className="text-xs text-gray-500 mt-2 flex items-center gap-1">
                      <span className="font-medium">{nameClean.length}</span> caracteres
                    </div>
                  )}
                </label>
              </div>

              {/* Phone Field */}
              <div className="space-y-2">
                <label className="block">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-8 h-8 rounded-lg bg-green-100 flex items-center justify-center">
                      <Phone className="w-4 h-4 text-green-600" />
                    </div>
                    <span className="font-medium text-gray-700">Número de celular</span>
                  </div>
                  <div className="relative">
                    <div className="absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-400">
                      🇲🇽 +52
                    </div>
                    <input
                      value={formatPhonePretty(phoneRaw)}
                      onChange={(e) => setPhoneRaw(e.target.value)}
                      className="w-full pl-20 pr-4 py-3.5 bg-gray-50 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:bg-white transition-all duration-200 placeholder:text-gray-400"
                      placeholder="55 1234 5678"
                      inputMode="numeric"
                      autoComplete="tel"
                    />
                  </div>
                  <div className="flex items-center justify-between mt-2">
                    <div className="text-xs text-gray-500 flex items-center gap-1">
                      <div className={`w-2 h-2 rounded-full ${phoneDigits.length === 10 ? 'bg-green-500' : 'bg-gray-300'}`}></div>
                      {phoneDigits.length}/10 dígitos
                    </div>
                    <div className="text-xs text-gray-400">
                      Formato: 55 1234 5678
                    </div>
                  </div>
                </label>
              </div>

              {/* Validation Hint */}
              {validation && !error && (
                <div className="flex items-center gap-3 p-4 bg-yellow-50 border border-yellow-200 rounded-xl">
                  <AlertCircle className="w-5 h-5 text-yellow-600 flex-shrink-0" />
                  <span className="text-sm text-yellow-700">{validation}</span>
                </div>
              )}

              {/* Submit Button */}
              <button
                type="submit"
                disabled={loading || !!validation}
                className={`
                  w-full py-4 px-6 rounded-xl font-semibold text-lg transition-all duration-300
                  flex items-center justify-center gap-3
                  ${loading || validation
                    ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                    : 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white shadow-lg hover:shadow-xl transform hover:-translate-y-0.5'
                  }
                `}
              >
                {loading ? (
                  <>
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                    Procesando registro...
                  </>
                ) : (
                  <>
                    <UserPlus className="w-5 h-5" />
                    Registrar Cliente
                  </>
                )}
              </button>
            </form>

            {/* Error Display */}
            {error && (
              <div className="mt-6 p-4 bg-red-50 border border-red-200 rounded-xl animate-pulse">
                <div className="flex items-center gap-3">
                  <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0" />
                  <div>
                    <p className="font-medium text-red-700">Error de registro</p>
                    <p className="text-sm text-red-600 mt-1">{error}</p>
                  </div>
                </div>
              </div>
            )}

            {/* Result Display */}
            {result && (
              <div className="mt-6 animate-in fade-in slide-in-from-bottom-5 duration-500">
                <div className="bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200 rounded-2xl p-6 shadow-lg">
                  <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-6">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-4">
                        <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center">
                          <Check className="w-6 h-6 text-green-600" />
                        </div>
                        <div>
                          <h3 className="text-xl font-bold text-gray-900">
                            ¡Registro exitoso!
                          </h3>
                          <p className="text-green-600 font-medium">
                            {result.isNew 
                              ? "Nuevo cliente registrado ✅" 
                              : "Cliente existente actualizado ✅"
                            }
                          </p>
                        </div>
                      </div>

                      <div className="space-y-4">
                        <div className="bg-white p-5 rounded-xl border border-green-100">
                          <p className="text-sm text-gray-500 mb-2">Tu número de cliente es:</p>
                          <div className="flex items-baseline gap-3">
                            <span className="text-4xl md:text-5xl font-black text-gray-900 tracking-tight">
                              #{result.customerId}
                            </span>
                            <span className="px-3 py-1 bg-green-100 text-green-800 text-sm font-semibold rounded-full">
                              ID Único
                            </span>
                          </div>
                        </div>

                        <div className="flex items-start gap-3 p-4 bg-blue-50 rounded-xl">
                          <Info className="w-5 h-5 text-blue-500 mt-0.5 flex-shrink-0" />
                          <p className="text-sm text-gray-600">
                            <span className="font-semibold">Guarda este número:</span> con él podrás registrar pedidos 
                            sin volver a capturar tus datos. Es tu identificación permanente en el sistema.
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="lg:w-48 flex flex-col gap-3">
                      <button
                        onClick={copyCustomerId}
                        className={`
                          flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl font-semibold
                          transition-all duration-200 border
                          ${copied
                            ? 'bg-green-100 border-green-300 text-green-800'
                            : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50 hover:shadow'
                          }
                        `}
                      >
                        {copied ? (
                          <>
                            <Check className="w-4 h-4" />
                            Copiado
                          </>
                        ) : (
                          <>
                            <Copy className="w-4 h-4" />
                            Copiar ID
                          </>
                        )}
                      </button>

                      <a
                        href="/new-order"
                        className="flex items-center justify-center gap-2 px-6 py-3.5 bg-gray-900 hover:bg-black text-white rounded-xl font-semibold transition-all duration-200 hover:shadow-lg"
                      >
                        Nuevo Pedido
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                        </svg>
                      </a>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Footer Tips */}
          <div className="px-6 py-4 bg-gray-50 border-t border-gray-100">
            <div className="flex items-center justify-center gap-2 text-sm text-gray-500">
              <Info className="w-4 h-4" />
              <span>Tip: Puedes pegar el celular con espacios o guiones, el sistema lo limpia automáticamente.</span>
            </div>
          </div>
        </div>

        {/* Additional Info */}
        <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
            <div className="text-blue-600 font-bold text-lg mb-2">📱 Único registro</div>
            <p className="text-sm text-gray-600">Regístrate solo una vez. Tu número de cliente es permanente.</p>
          </div>
          <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
            <div className="text-blue-600 font-bold text-lg mb-2">⚡ Acceso rápido</div>
            <p className="text-sm text-gray-600">Usa tu ID para hacer pedidos sin reingresar datos.</p>
          </div>
          <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
            <div className="text-blue-600 font-bold text-lg mb-2">🔒 Seguridad</div>
            <p className="text-sm text-gray-600">Tus datos están protegidos y solo tú conoces tu ID.</p>
          </div>
        </div>
      </div>
    </div>
  );
}