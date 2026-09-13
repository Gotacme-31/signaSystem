import { Router } from "express";
import { getPublicOrderTracking } from "../controllers/public-tracking.controller";
import { publicTrackingRateLimit } from "../middlewares/publicTrackingRateLimit";

const router = Router();

router.get("/track/:token", publicTrackingRateLimit, getPublicOrderTracking);

export default router;
