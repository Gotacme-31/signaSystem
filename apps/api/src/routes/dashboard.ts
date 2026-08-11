import { Router } from "express";
import { auth, requireAdmin } from "../middlewares/auth";
import {
  getDashboardStats,
  getBranchesList,
  getProductsList,
} from "../controllers/dashboard.controller";

const router = Router();
router.use(auth, requireAdmin);

router.get("/stats", getDashboardStats);
router.get("/branches", getBranchesList);
router.get("/products", getProductsList);

export default router;
