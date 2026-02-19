import { Router } from "express";
import { auth } from "../middlewares/auth";
import {
  getDashboardStats,
  getBranchesList,
  getProductsList,
} from "../controllers/dashboard.controller";

const router = Router();
router.use(auth);

router.get("/stats", getDashboardStats);
router.get("/branches", getBranchesList);
router.get("/products", getProductsList);

export default router;
