import { Router } from "express";
import { auth, requireAdmin } from "../middlewares/auth";
import { getProductParamReportController } from "../controllers/product-param-report.controller";

const router = Router();
router.use(auth, requireAdmin);

router.get("/product-params", getProductParamReportController);

export default router;
