import { Router } from "express";
import { setBranchProductPrice } from "../controllers/branchProduct.controller";

const router = Router();

// PUT /admin/branches/:branchId/products/:productId/price
router.put("/admin/branches/:branchId/products/:productId/price", setBranchProductPrice);

export default router;
