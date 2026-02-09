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
  setBranchProductParamPrices,
} from "../controllers/branchPricing.controller";
import type { AuthedRequest } from "../middlewares/auth";

const router = Router();

/** ✅ STAFF/ADMIN: listar sucursales activas (para "Se recoge en") */
router.get("/branches", auth, async (req: AuthedRequest, res, next) => {
  try {
    // si quieres: cualquiera logueado puede ver sucursales activas
    return listBranches(req, res);
  } catch (e) {
    next(e);
  }
});

/** ✅ STAFF/ADMIN: catálogo de SU sucursal; ADMIN puede ver cualquiera */
router.get("/branch/:branchId/products", auth, async (req: AuthedRequest, res, next) => {
  try {
    const branchId = Number(req.params.branchId);
    if (!Number.isFinite(branchId)) return res.status(400).json({ error: "branchId inválido" });

    // STAFF solo puede pedir su misma sucursal
    if (req.auth?.role !== "ADMIN") {
      if (!req.auth?.branchId) return res.status(400).json({ error: "Usuario sin branchId" });
      if (req.auth.branchId !== branchId) {
        return res.status(403).json({ error: "No autorizado para esta sucursal" });
      }
    }

    return listBranchProducts(req, res);
  } catch (e) {
    next(e);
  }
});

/** ✅ ADMIN ONLY: todo lo que edita precios */
router.get("/branch/:branchId/product/:productId/variant-quantity-prices", auth, requireAdmin, getBranchProductVariantQuantityMatrix);

router.put("/branch/:branchId/products/:productId", auth, requireAdmin, setBranchProductPrice);
router.put("/branch/:branchId/products/:productId/quantity-prices", auth, requireAdmin, setBranchProductQuantityPrices);
router.put("/branch/:branchId/products/:productId/variants", auth, requireAdmin, setBranchProductVariantPrices);
router.put("/branch/:branchId/products/:productId/param-prices", auth, requireAdmin, setBranchProductParamPrices);
router.post("/branch/:branchId/product/:productId/variant-quantity-prices", auth, requireAdmin, setBranchProductVariantQuantityMatrix);

export default router;
