// routes/order.routes.ts
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
  cancelOrder
} from "../controllers/order.controller";

const router = Router();

// Crear nuevo pedido
router.post("/", auth, createOrder);
router.get("/active", auth, listActiveOrders);
router.get("/", auth, listOrders);
router.get("/:id", auth, getOrderDetails);
router.put("/:id", auth, updateOrder);
router.delete("/:id", auth, cancelOrder);
router.post("/order-items/:id/next-step", auth, nextStep);
router.post("/:id/deliver", auth, markDelivered);
router.post("/:id/received", auth, markReceived);

// ✅ Asegúrate de que esta línea esté así:
export default router;