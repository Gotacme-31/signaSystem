import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { 
  Lock, 
  Mail, 
  LogIn, 
  Building,
  Shield,
  AlertCircle,
  Eye,
  EyeOff
} from "lucide-react";

export default function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const location = useLocation();

  const from = (location.state as any)?.from?.pathname as string | undefined;

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

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
                <p className="text-blue-100 text-sm">Ingresa tus credenciales para continuar</p>
              </div>
            </div>
          </div>

          {/* Card Content */}
          <div className="p-6 md:p-8">
            <form onSubmit={onSubmit} className="space-y-6">
              {/* Email Input */}
              <div className="space-y-2">
                <label className="block">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center">
                      <Mail className="w-4 h-4 text-blue-600" />
                    </div>
                    <span className="font-medium text-gray-700">Correo electrónico</span>
                  </div>
                  <input
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="correo@empresa.com"
                    className="w-full px-4 py-3.5 bg-gray-50 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:bg-white transition-all duration-200 placeholder:text-gray-400"
                    autoComplete="email"
                    type="email"
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
                      className="w-full pl-12 pr-12 py-3.5 bg-gray-50 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:bg-white transition-all duration-200 placeholder:text-gray-400"
                      autoComplete="current-password"
                    />
                    <div className="absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-400">
                      <Lock className="w-4 h-4" />
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-4 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                    >
                      {showPassword ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
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
                disabled={loading}
                className={`
                  w-full py-4 px-6 rounded-xl font-semibold text-lg transition-all duration-300
                  flex items-center justify-center gap-3
                  ${loading
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
              <span>Tus credenciales están protegidas y encriptadas</span>
            </div>
          </div>
        </div>

        {/* Additional Info */}
        <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-white/80 backdrop-blur-sm p-4 rounded-xl border border-gray-200 shadow-sm">
            <div className="text-blue-600 font-bold text-lg mb-2">🔐 Seguro</div>
            <p className="text-sm text-gray-600">Autenticación segura con encriptación</p>
          </div>
          <div className="bg-white/80 backdrop-blur-sm p-4 rounded-xl border border-gray-200 shadow-sm">
            <div className="text-blue-600 font-bold text-lg mb-2">⚡ Rápido</div>
            <p className="text-sm text-gray-600">Acceso instantáneo al sistema</p>
          </div>
          <div className="bg-white/80 backdrop-blur-sm p-4 rounded-xl border border-gray-200 shadow-sm">
            <div className="text-blue-600 font-bold text-lg mb-2">🏢 Empresarial</div>
            <p className="text-sm text-gray-600">Diseñado para gestión profesional</p>
          </div>
        </div>

        {/* Copyright */}
        <div className="mt-8 text-center">
          <p className="text-sm text-gray-500">
            © {new Date().getFullYear()} Signa System. Todos los derechos reservados.
          </p>
        </div>
      </div>
    </div>
  );
}