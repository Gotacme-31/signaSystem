import { Router } from "express";
import {
  // Productos admin
  adminGetProduct,
  adminUpdateProduct,
  adminUpdateProductRules,
  adminSetProductVariants,
  adminSetProductParams,
  adminSetProcessSteps,
} from "../controllers/adminProducts.controller";

import {
  // Pricing admin
  adminListBranches,
  adminGetBranchProducts,
  adminSetBranchProductPrice,
  adminSetBranchProductQuantityPrices,
  adminSetBranchProductVariantPrices,
  adminSetBranchProductParamPrices,
} from "../controllers/adminBranchProducts.controller";

const adminRouter = Router();

// ========== PRODUCTOS ==========
// GET /admin/products/:id
adminRouter.get("/products/:id", adminGetProduct);

// PATCH /admin/products/:id (actualizar datos básicos)
adminRouter.patch("/products/:id", adminUpdateProduct);

// PUT /admin/products/:id/rules (reglas de cantidad)
adminRouter.put("/products/:id/rules", adminUpdateProductRules);

// PUT /admin/products/:id/variants (tamaños)
adminRouter.put("/products/:id/variants", adminSetProductVariants);

// PUT /admin/products/:id/params (parámetros)
adminRouter.put("/products/:id/params", adminSetProductParams);

// PUT /admin/products/:id/process-steps (pasos de proceso)
adminRouter.put("/products/:id/process-steps", adminSetProcessSteps);

// ========== PRICING ==========
// GET /admin/branches (lista sucursales)
adminRouter.get("/branches", adminListBranches);

// GET /admin/branches/:branchId/products (productos con precios)
adminRouter.get("/branches/:branchId/products", adminGetBranchProducts);

// PATCH /admin/branches/:branchId/products/:productId/price (precio base)
adminRouter.patch("/branches/:branchId/products/:productId/price", adminSetBranchProductPrice);

// PUT /admin/branches/:branchId/products/:productId/quantity-prices (precios por cantidad)
adminRouter.put("/branches/:branchId/products/:productId/quantity-prices", adminSetBranchProductQuantityPrices);

// PUT /admin/branches/:branchId/products/:productId/variant-prices (precios por tamaño)
adminRouter.put("/branches/:branchId/products/:productId/variant-prices", adminSetBranchProductVariantPrices);

// PUT /admin/branches/:branchId/products/:productId/param-prices (precios por parámetros)
adminRouter.put("/branches/:branchId/products/:productId/param-prices", adminSetBranchProductParamPrices);

export default adminRouter;