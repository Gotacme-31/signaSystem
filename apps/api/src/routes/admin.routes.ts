import { Router } from "express";
import { auth, requireAdmin } from "../middlewares/auth";
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
  adminDeactivateUser,
} from "../controllers/adminBranches.controller";
import {
  adminCreateProductionBlackoutDate,
  adminDeleteProductionBlackoutDate,
  adminGetProductionCapacityBoard,
  adminListProductionBlackoutDates,
  adminListProductionBatches,
  adminListProductionConfigs,
  adminRecalculateOrderSchedule,
  adminUpdateProductionBlackoutDate,
  adminUpsertProductionConfig,
} from "../controllers/production-scheduling.controller";
import {
  archivePricingGroup,
  createPricingGroup,
  deletePricingGroup,
  listPricingGroupProducts,
  listPricingGroups,
  updatePricingGroup,
} from "../controllers/pricingGroups.controller";

const adminRouter = Router();

adminRouter.use(auth, requireAdmin);

// ========== SUCURSALES ==========
adminRouter.get("/branches", adminGetBranches);
adminRouter.get("/branches/:id", adminGetBranchById);
adminRouter.post("/branches", adminCreateBranch);
adminRouter.patch("/branches/:id", adminUpdateBranch);
adminRouter.delete("/branches/:id", adminDeleteBranch);

// ========== USUARIOS DE SUCURSAL ==========
adminRouter.get("/branches/:branchId/users", adminGetBranchUsers);
adminRouter.post("/branches/:branchId/users", adminCreateBranchUser);
adminRouter.patch("/branches/users/:userId/deactivate", adminDeactivateUser);
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
adminRouter.get("/pricing-groups", listPricingGroups);
adminRouter.get("/pricing-groups/products", listPricingGroupProducts);
adminRouter.post("/pricing-groups", createPricingGroup);
adminRouter.patch("/pricing-groups/:id", updatePricingGroup);
adminRouter.delete("/pricing-groups/:id", deletePricingGroup);
adminRouter.post("/pricing-groups/:id/archive", archivePricingGroup);
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

// ========== PRODUCTION SCHEDULING (ADMIN ONLY) ==========
adminRouter.get(
  "/branches/:branchId/production-configs",
  auth,
  requireAdmin,
  adminListProductionConfigs
);
adminRouter.put(
  "/branches/:branchId/products/:productId/production-config",
  auth,
  requireAdmin,
  adminUpsertProductionConfig
);
adminRouter.get("/production-batches", auth, requireAdmin, adminListProductionBatches);
adminRouter.get("/production/capacity-board", auth, requireAdmin, adminGetProductionCapacityBoard);
adminRouter.get("/production-blackout-dates", auth, requireAdmin, adminListProductionBlackoutDates);
adminRouter.post("/production-blackout-dates", auth, requireAdmin, adminCreateProductionBlackoutDate);
adminRouter.patch("/production-blackout-dates/:id", auth, requireAdmin, adminUpdateProductionBlackoutDate);
adminRouter.delete("/production-blackout-dates/:id", auth, requireAdmin, adminDeleteProductionBlackoutDate);
adminRouter.post(
  "/orders/:orderId/recalculate-production-schedule",
  auth,
  requireAdmin,
  adminRecalculateOrderSchedule
);

export default adminRouter;
