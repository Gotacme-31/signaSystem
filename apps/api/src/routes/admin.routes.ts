import { Router } from "express";
import {
  // Productos admin
  adminGetProduct,
  adminUpdateProduct,
  adminUpdateProductRules,
  adminSetProductVariants,
  adminSetProductParams,
  adminSetProcessSteps,
  createProduct,
} from "../controllers/adminProducts.controller";

import {
  // Pricing admin
  adminListBranches,
  adminGetBranchProducts,
  adminSetBranchProductPrice,
  adminSetBranchProductQuantityPrices,
  adminSetBranchProductVariantPrices,
  adminSetBranchProductParamPrices,
  adminGetBranchProductVariantQuantityPrices,
  adminSetBranchProductVariantQuantityPrices,
} from "../controllers/adminBranchProducts.controller";

import {
  // Sucursales admin
  adminGetBranches,
  adminGetBranchById,
  adminCreateBranch,
  adminUpdateBranch,
  adminDeleteBranch,
  adminGetBranchUsers,
  adminCreateBranchUser,
  adminUpdateUser,
  adminChangeUserPassword,
} from "../controllers/adminBranches.controller";

const adminRouter = Router();

// ========== SUCURSALES ==========
adminRouter.get("/branches", adminGetBranches);
adminRouter.get("/branches/:id", adminGetBranchById);
adminRouter.post("/branches", adminCreateBranch);
adminRouter.patch("/branches/:id", adminUpdateBranch);
adminRouter.delete("/branches/:id", adminDeleteBranch);

// ========== USUARIOS DE SUCURSAL ==========
adminRouter.get("/branches/:branchId/users", adminGetBranchUsers);
adminRouter.post("/branches/:branchId/users", adminCreateBranchUser);
adminRouter.patch("/users/:userId", adminUpdateUser);
adminRouter.post("/users/:userId/change-password", adminChangeUserPassword);

// ========== PRODUCTOS ==========
adminRouter.post("/products", createProduct);
adminRouter.get("/products/:id", adminGetProduct);
adminRouter.patch("/products/:id", adminUpdateProduct);
adminRouter.put("/products/:id/rules", adminUpdateProductRules);
adminRouter.put("/products/:id/variants", adminSetProductVariants);
adminRouter.put("/products/:id/params", adminSetProductParams);
adminRouter.put("/products/:id/process-steps", adminSetProcessSteps);

// ========== PRICING ==========
adminRouter.get("/branches", adminListBranches);
adminRouter.get("/branches/:branchId/products", adminGetBranchProducts);
adminRouter.get(
  "/branches/:branchId/products/:productId/variant-quantity-prices",
  adminGetBranchProductVariantQuantityPrices
);
adminRouter.put(
  "/branches/:branchId/products/:productId/variant-quantity-prices",
  adminSetBranchProductVariantQuantityPrices
);
adminRouter.patch("/branches/:branchId/products/:productId/price", adminSetBranchProductPrice);
adminRouter.put("/branches/:branchId/products/:productId/quantity-prices", adminSetBranchProductQuantityPrices);
adminRouter.put("/branches/:branchId/products/:productId/variant-prices", adminSetBranchProductVariantPrices);
adminRouter.put("/branches/:branchId/products/:productId/param-prices", adminSetBranchProductParamPrices);

export default adminRouter;