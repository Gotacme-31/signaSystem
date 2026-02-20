import { Router } from "express";
import { auth } from "../middlewares/auth";
import {
  createOrder,
  nextStep,
  listActiveOrders,
  markDelivered,
  markReceived,
  getOrderDetails,
  listOrders,
  updateOrder,
  cancelOrder,
  deleteOrder,
  verifyBranchPassword
} from "../controllers/order.controller";

const router = Router();

// Crear nuevo pedido
router.post("/", auth, createOrder);

// Listar pedidos activos
router.get("/active", auth, listActiveOrders);

// Listar todos los pedidos (con filtros)
router.get("/", auth, listOrders);

// Obtener detalles de un pedido específico
router.get("/:id", auth, getOrderDetails);

// Actualizar un pedido (PUT completo)
router.put("/:id", auth, updateOrder);

// Cancelar un pedido (soft delete)
router.delete("/:id", auth, cancelOrder);

// Eliminar permanentemente (solo ADMIN) - Ruta específica
router.delete("/:id/permanent", auth, deleteOrder);

// Avanzar paso de producción
router.post("/order-items/:id/next-step", auth, nextStep);

// Marcar pedido como entregado
router.post("/:id/deliver", auth, markDelivered);

// Marcar pedido como recibido (para DELIVERY)
router.post("/:id/received", auth, markReceived);

router.post("/verify-branch-password", auth, verifyBranchPassword);

export default router;