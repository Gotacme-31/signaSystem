import { Router } from "express";
import { auth, requireAdmin } from "../middlewares/auth";
import {
  listBranches,
  listBranchProducts,
  setBranchProductPrice,
  setBranchProductQuantityPrices,
  setBranchProductVariantPrices,
} from "../controllers/branchPricing.controller";

const router = Router();

// Listas para Admin · Precios por sucursal
router.get("/admin/branches", auth, requireAdmin, listBranches);
router.get("/admin/branches/:branchId/products", auth, requireAdmin, listBranchProducts);

// Precio base + activo
router.put("/admin/branches/:branchId/products/:productId", auth, requireAdmin, setBranchProductPrice);

// NUEVO: precios por cantidad (minQty → unitPrice)
router.put(
  "/admin/branches/:branchId/products/:productId/quantity-prices",
  auth,
  requireAdmin,
  setBranchProductQuantityPrices
);

// Precio por tamaño/variante
router.put(
  "/admin/branches/:branchId/products/:productId/variants",
  auth,
  requireAdmin,
  setBranchProductVariantPrices
);

export default router;
