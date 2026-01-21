import { Router } from "express";
import { createOrder } from "../controllers/order.controller";
// 👇 usa TU middleware real de auth:
import { auth } from "../middlewares/auth";

const router = Router();

router.post("/orders", auth, createOrder);

export default router;
