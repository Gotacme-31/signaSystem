import { useState, useEffect } from "react";
import { X, Save, AlertCircle, Calendar, Clock, Package, User, Phone, Trash2 } from "lucide-react";
import { 
  getOrderById, 
  updateOrder, 
  deleteOrder, 
  type OrderDetails,
  type PaymentMethod,
  type OrderStage,
  type UpdateOrderItemData
} from "../../api/orders";

interface EditOrderModalProps {
  isOpen: boolean;
  onClose: () => void;
  orderId: number;
  onSuccess: () => void;
  userRole: string;
  onVerifyPassword: (callback: () => void) => void;
}

export default function EditOrderModal({ 
  isOpen, 
  onClose, 
  orderId, 
  onSuccess,
  userRole,
  onVerifyPassword
}: EditOrderModalProps) {
  const [order, setOrder] = useState<OrderDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Form state - con tipos específicos
  const [deliveryDate, setDeliveryDate] = useState("");
  const [deliveryTime, setDeliveryTime] = useState("");
  const [notes, setNotes] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("CASH");
  const [stage, setStage] = useState<OrderStage>("REGISTERED");
  const [items, setItems] = useState<any[]>([]);

  const isAdmin = userRole === "ADMIN";

  useEffect(() => {
    if (isOpen && orderId) {
      loadOrder();
    }
  }, [isOpen, orderId]);

  async function loadOrder() {
    setLoading(true);
    setError(null);
    try {
      const data = await getOrderById(orderId);
      setOrder(data.order);
      
      // Inicializar formulario con casteo de tipos
      setDeliveryDate(data.order.deliveryDate.split('T')[0]);
      setDeliveryTime(data.order.deliveryTime || "");
      setNotes(data.order.notes || "");
      setPaymentMethod(data.order.paymentMethod as PaymentMethod);
      setStage(data.order.stage as OrderStage);
      setItems(data.order.items.map((it: any) => ({
        ...it,
        edited: false,
        originalQuantity: it.quantity,
        originalIsReady: it.isReady,
        originalStepOrder: it.currentStepOrder
      })));
    } catch (err: any) {
      setError(err?.message || "Error al cargar pedido");
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    if (!order) return;

    const saveAction = async () => {
      setSaving(true);
      setError(null);
      try {
        // Preparar los items actualizados (solo los que cambiaron)
        const updatedItems: UpdateOrderItemData[] = items
          .filter(item => item.edited)
          .map(item => ({
            id: item.id,
            quantity: parseFloat(item.quantity),
            // NO incluimos unitPrice porque se recalcula automáticamente en el backend
            isReady: item.isReady !== item.originalIsReady ? item.isReady : undefined,
            currentStepOrder: item.currentStepOrder !== item.originalStepOrder ? item.currentStepOrder : undefined,
            variantId: item.variantId
          }));

        await updateOrder(orderId, {
          deliveryDate,
          deliveryTime: deliveryTime || null,
          notes: notes || null,
          paymentMethod,
          stage,
          items: updatedItems.length > 0 ? updatedItems : undefined
        });
        onSuccess();
        onClose();
      } catch (err: any) {
        setError(err?.message || "Error al guardar cambios");
      } finally {
        setSaving(false);
      }
    };

    // Si no es admin, verificar contraseña
    if (!isAdmin) {
      onVerifyPassword(saveAction);
    } else {
      await saveAction();
    }
  }

  async function handleDelete() {
    if (!order) return;

    setSaving(true);
    setError(null);
    try {
      await deleteOrder(orderId);
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err?.message || "Error al eliminar pedido");
    } finally {
      setSaving(false);
    }
  }

  function handleItemChange(index: number, field: string, value: any) {
    const newItems = [...items];
    newItems[index] = { ...newItems[index], [field]: value, edited: true };
    setItems(newItems);
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className={`p-6 border-b ${isAdmin ? 'bg-purple-50' : 'bg-blue-50'}`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`p-3 rounded-xl ${isAdmin ? 'bg-purple-100' : 'bg-blue-100'}`}>
                <Package className={`w-6 h-6 ${isAdmin ? 'text-purple-600' : 'text-blue-600'}`} />
              </div>
              <div>
                <h2 className="text-2xl font-bold text-gray-900">
                  Editar Pedido #{orderId}
                </h2>
                <p className="text-sm text-gray-600 mt-1">
                  {isAdmin 
                    ? "Modo administrador - cambios sin verificación" 
                    : "Verifica tu contraseña para guardar cambios"}
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

        {/* Contenido */}
        <div className="p-6">
          {loading ? (
            <div className="flex justify-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
            </div>
          ) : error ? (
            <div className="p-4 bg-red-50 border border-red-200 rounded-xl">
              <div className="flex items-center gap-3">
                <AlertCircle className="w-5 h-5 text-red-600" />
                <p className="text-red-700">{error}</p>
              </div>
            </div>
          ) : order ? (
            <div className="space-y-6">
              {/* Información del cliente */}
              <div className="bg-gray-50 rounded-xl p-4">
                <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                  <User className="w-4 h-4" />
                  Cliente
                </h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-gray-500">Nombre</p>
                    <p className="font-medium">{order.customer.name}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Teléfono</p>
                    <p className="font-medium flex items-center gap-1">
                      <Phone className="w-3 h-3" />
                      {order.customer.phone}
                    </p>
                  </div>
                </div>
              </div>

              {/* Fechas */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    <Calendar className="w-4 h-4 inline mr-2" />
                    Fecha de entrega
                  </label>
                  <input
                    type="date"
                    value={deliveryDate}
                    onChange={(e) => setDeliveryDate(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    <Clock className="w-4 h-4 inline mr-2" />
                    Hora de entrega
                  </label>
                  <input
                    type="time"
                    value={deliveryTime}
                    onChange={(e) => setDeliveryTime(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
              </div>

              {/* Método de pago y etapa */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Método de pago
                  </label>
                  <select
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="CASH">Efectivo</option>
                    <option value="TRANSFER">Transferencia</option>
                    <option value="CARD">Tarjeta</option>
                  </select>
                </div>
              </div>

              {/* Notas */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Notas
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="Notas adicionales..."
                />
              </div>

              {/* Items del pedido */}
              <div>
                <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                  <Package className="w-4 h-4" />
                  Productos
                </h3>
                <div className="space-y-3">
                  {items.map((item, idx) => (
                    <div key={item.id} className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                      <div className="flex items-start justify-between mb-2">
                        <span className="font-medium">{item.product.name}</span>
                        {item.variantRef && (
                          <span className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded-full">
                            {item.variantRef.name}
                          </span>
                        )}
                      </div>
                      <div className="grid grid-cols-3 gap-3">
                        <div>
                          <label className="text-xs text-gray-500">Cantidad</label>
                          <input
                            type="number"
                            step="0.5"
                            value={item.quantity}
                            onChange={(e) => handleItemChange(idx, 'quantity', e.target.value)}
                            className="w-full px-3 py-1 border border-gray-300 rounded-lg focus:ring-1 focus:ring-blue-500"
                          />
                        </div>
                        <div>
                          <label className="text-xs text-gray-500">Precio unit.</label>
                          <input
                            type="number"
                            step="0.01"
                            value={item.unitPrice}
                            disabled // 👈 DESHABILITADO - No se puede editar manualmente
                            className="w-full px-3 py-1 bg-gray-100 border border-gray-300 rounded-lg text-gray-500 cursor-not-allowed"
                          />
                          <p className="text-xs text-gray-400 mt-1">Se calcula automáticamente</p>
                        </div>
                        <div>
                          <label className="text-xs text-gray-500">Subtotal</label>
                          <input
                            type="number"
                            value={(item.quantity * item.unitPrice).toFixed(2)}
                            disabled
                            className="w-full px-3 py-1 bg-gray-100 border border-gray-300 rounded-lg text-gray-500"
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Botón de eliminar para admin */}
              {isAdmin && (
                <div className="pt-4 border-t border-gray-200">
                  {!showDeleteConfirm ? (
                    <button
                      onClick={() => setShowDeleteConfirm(true)}
                      className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg flex items-center gap-2"
                    >
                      <Trash2 className="w-4 h-4" />
                      Eliminar Pedido
                    </button>
                  ) : (
                    <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                      <p className="text-red-700 mb-3 font-medium">¿Estás seguro de eliminar este pedido?</p>
                      <p className="text-sm text-red-600 mb-4">Esta acción no se puede deshacer.</p>
                      <div className="flex gap-3">
                        <button
                          onClick={() => setShowDeleteConfirm(false)}
                          className="px-4 py-2 bg-white hover:bg-gray-50 text-gray-800 rounded-lg border border-gray-300"
                        >
                          Cancelar
                        </button>
                        <button
                          onClick={handleDelete}
                          disabled={saving}
                          className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg flex items-center gap-2"
                        >
                          {saving ? (
                            <>
                              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                              Eliminando...
                            </>
                          ) : (
                            "Sí, eliminar"
                          )}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : null}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-gray-200 bg-gray-50">
          <div className="flex justify-end gap-3">
            <button
              onClick={onClose}
              className="px-6 py-2.5 bg-white hover:bg-gray-50 text-gray-800 font-semibold rounded-lg border border-gray-300 transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={handleSave}
              disabled={saving || loading}
              className={`px-6 py-2.5 rounded-lg font-semibold shadow-md hover:shadow-lg transition-all flex items-center gap-2 ${
                isAdmin
                  ? 'bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white'
                  : 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white'
              } disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              {saving ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                  Guardando...
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  Guardar Cambios
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}