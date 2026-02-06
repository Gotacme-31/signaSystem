import { Router } from "express";
import { auth, requireAdmin } from "../middlewares/auth";
import {
    listBranches,
    listBranchProducts,
    setBranchProductPrice,
    setBranchProductQuantityPrices,
    setBranchProductVariantPrices,
    getBranchProductVariantQuantityMatrix,
    setBranchProductVariantQuantityMatrix,
} from "../controllers/branchPricing.controller";
import { setBranchProductParamPrices } from "../controllers/branchPricing.controller";

const router = Router();

router.get("/branches", auth, requireAdmin, listBranches);
router.get("/branch/:branchId/products", auth, requireAdmin, listBranchProducts);
router.get("/branch/:branchId/product/:productId/variant-quantity-prices", auth, requireAdmin, getBranchProductVariantQuantityMatrix);

router.put("/branch/:branchId/products/:productId", auth, requireAdmin, setBranchProductPrice);
router.put("/branch/:branchId/products/:productId/quantity-prices", auth, requireAdmin, setBranchProductQuantityPrices);
router.put("/branch/:branchId/products/:productId/variants", auth, requireAdmin, setBranchProductVariantPrices);
router.put(
    "/branch/:branchId/products/:productId/param-prices",
    auth,
    requireAdmin,
    setBranchProductParamPrices
);
router.post("/branch/:branchId/product/:productId/variant-quantity-prices", auth, requireAdmin, setBranchProductVariantQuantityMatrix);

export default router;  