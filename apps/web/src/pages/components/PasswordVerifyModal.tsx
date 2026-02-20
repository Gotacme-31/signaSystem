import { useState } from "react";
import { Key, X, AlertCircle, Eye, EyeOff, CheckCircle } from "lucide-react";
import { verifyManagerPassword } from "../../auth/useAuth";

interface PasswordVerifyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  branchId: number;
  branchName: string;
}

export default function PasswordVerifyModal({ 
  isOpen, 
  onClose, 
  onSuccess, 
  branchId,
  branchName 
}: PasswordVerifyModalProps) {
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [managerName, setManagerName] = useState<string | null>(null);

  if (!isOpen) return null;

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setManagerName(null);

    try {
      const result = await verifyManagerPassword(branchId, password);
      setManagerName(result.managerName);
      setTimeout(() => {
        onSuccess();
        onClose();
        setPassword("");
      }, 1500);
    } catch (err: any) {
      setError(err?.message || "Contraseña incorrecta");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-[60]">
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full">
        <div className="p-6 border-b border-gray-200 bg-yellow-50">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-3 rounded-xl bg-yellow-100">
                <Key className="w-6 h-6 text-yellow-600" />
              </div>
              <div>
                <h2 className="text-2xl font-bold text-gray-900">Autorización Requerida</h2>
                <p className="text-sm text-gray-600 mt-1">
                  Ingresa la contraseña del gerente
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-white/50 rounded-lg transition-colors"
            >
              <X className="w-5 h-5 text-gray-500" />
            </button>
          </div>
        </div>

        <form onSubmit={handleVerify} className="p-6">
          <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <p className="text-sm text-blue-800">
              <span className="font-medium">Sucursal:</span> {branchName}
            </p>
            <p className="text-xs text-blue-600 mt-1">
              Solo el gerente (STAFF) puede autorizar ediciones
            </p>
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Contraseña del gerente <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-500 focus:border-yellow-500 pr-12"
                placeholder="••••••••"
                autoFocus
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
          </div>

          {managerName && (
            <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-xl">
              <div className="flex items-center gap-3">
                <CheckCircle className="w-5 h-5 text-green-600" />
                <p className="text-green-700">
                  Autorizado por: <span className="font-semibold">{managerName}</span>
                </p>
              </div>
            </div>
          )}

          {error && (
            <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-xl">
              <div className="flex items-center gap-3">
                <AlertCircle className="w-5 h-5 text-red-600" />
                <p className="text-red-700">{error}</p>
              </div>
            </div>
          )}

          <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-gray-200">
            <button
              type="button"
              onClick={onClose}
              className="px-6 py-2.5 bg-white hover:bg-gray-50 text-gray-800 font-semibold rounded-lg border border-gray-300 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={loading || !password}
              className="px-6 py-2.5 bg-gradient-to-r from-yellow-600 to-amber-600 hover:from-yellow-700 hover:to-amber-700 text-white font-semibold rounded-lg shadow-md hover:shadow-lg transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                  Verificando...
                </>
              ) : (
                <>
                  <CheckCircle className="w-4 h-4" />
                  Autorizar
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}