// FILE: src/pages/Login.tsx

import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import {
  Lock,
  LogIn,
  Building,
  Shield,
  AlertCircle,
  Eye,
  EyeOff,
  User
} from "lucide-react";

export default function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const location = useLocation();
  const state = location.state as any;
  const from =
    state?.from?.pathname ??
    (typeof state?.from === "string" ? state.from : undefined);
  const [username, setUsername] = useState(""); // 👈 Cambiado de email
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(username, password); // 👈 Pasamos username
      const fallback = "/orders"; // o decide por rol si tu useAuth te lo da
      nav(from ?? fallback, { replace: true });
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
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-2xl shadow-xl mb-4">
            <Building className="w-10 h-10 text-white" />
          </div>
          <h1 className="text-4xl font-bold text-gray-900 mb-2">Signa System</h1>
          <p className="text-gray-600">Sistema de gestión de pedidos</p>
        </div>

        {/* Login Card */}
        <div className="bg-white rounded-2xl shadow-xl border border-gray-200 overflow-hidden">
          {/* Card Header */}
          <div className="bg-gradient-to-r from-blue-600 to-indigo-600 p-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-white/20 rounded-lg backdrop-blur-sm">
                <Lock className="w-5 h-5 text-white" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-white">Inicio de Sesión</h2>
                <p className="text-blue-100 text-sm">Ingresa tu usuario y contraseña</p>
              </div>
            </div>
          </div>

          {/* Card Content */}
          <div className="p-6 md:p-8">
            <form onSubmit={onSubmit} className="space-y-6">
              {/* Username Input */}
              <div className="space-y-2">
                <label className="block">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center">
                      <User className="w-4 h-4 text-blue-600" />
                    </div>
                    <span className="font-medium text-gray-700">Nombre de usuario</span>
                  </div>
                  <input
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="ej. juan.perez"
                    className="w-full px-4 py-3.5 bg-gray-50 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:bg-white transition-all duration-200 placeholder:text-gray-400"
                    autoComplete="username"
                    autoFocus
                  />
                </label>
              </div>

              {/* Password Input */}
              <div className="space-y-2">
                <label className="block">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center">
                      <Shield className="w-4 h-4 text-blue-600" />
                    </div>
                    <span className="font-medium text-gray-700">Contraseña</span>
                  </div>
                  <div className="relative">
                    <input
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      type={showPassword ? "text" : "password"}
                      className="w-full pl-4 pr-12 py-3.5 bg-gray-50 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:bg-white transition-all duration-200 placeholder:text-gray-400"
                      autoComplete="current-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-4 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                    >
                      {showPassword ? (
                        <EyeOff className="w-5 h-5" />
                      ) : (
                        <Eye className="w-5 h-5" />
                      )}
                    </button>
                  </div>
                </label>
              </div>

              {/* Error Display */}
              {error && (
                <div className="animate-in fade-in slide-in-from-top-3 duration-300">
                  <div className="p-4 bg-red-50 border border-red-200 rounded-xl">
                    <div className="flex items-center gap-3">
                      <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0" />
                      <div>
                        <p className="font-medium text-red-700">Error de autenticación</p>
                        <p className="text-red-600 text-sm mt-1">{error}</p>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Submit Button */}
              <button
                type="submit"
                disabled={loading || !username || !password}
                className={`
                  w-full py-4 px-6 rounded-xl font-semibold text-lg transition-all duration-300
                  flex items-center justify-center gap-3
                  ${loading || !username || !password
                    ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                    : 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white shadow-lg hover:shadow-xl transform hover:-translate-y-0.5'
                  }
                `}
              >
                {loading ? (
                  <>
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                    Verificando...
                  </>
                ) : (
                  <>
                    <LogIn className="w-5 h-5" />
                    Iniciar Sesión
                  </>
                )}
              </button>
            </form>
          </div>

          {/* Card Footer */}
          <div className="px-6 py-4 bg-gray-50 border-t border-gray-200">
            <div className="flex items-center justify-center gap-2 text-sm text-gray-500">
              <Shield className="w-4 h-4" />
              <span>Usa tu nombre de usuario asignado</span>
            </div>
          </div>
        </div>

        {/* Additional Info */}
        <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-white/80 backdrop-blur-sm p-4 rounded-xl border border-gray-200 shadow-sm">
            <div className="text-blue-600 font-bold text-lg mb-2">👤 Mostrador</div>
            <p className="text-sm text-gray-600">Registra pedidos y atiende clientes</p>
          </div>
          <div className="bg-white/80 backdrop-blur-sm p-4 rounded-xl border border-gray-200 shadow-sm">
            <div className="text-blue-600 font-bold text-lg mb-2">⚙️ Producción</div>
            <p className="text-sm text-gray-600">Gestiona la fabricación</p>
          </div>
          <div className="bg-white/80 backdrop-blur-sm p-4 rounded-xl border border-gray-200 shadow-sm">
            <div className="text-blue-600 font-bold text-lg mb-2">👑 Staff</div>
            <p className="text-sm text-gray-600">Administra la sucursal</p>
          </div>
        </div>
      </div>
    </div>
  );
}