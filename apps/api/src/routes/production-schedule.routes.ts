import { Router } from "express";
import { auth } from "../middlewares/auth";
import { previewProductionScheduleForOrder } from "../controllers/production-scheduling.controller";

const router = Router();

router.post("/preview", auth, previewProductionScheduleForOrder);

export default router;
