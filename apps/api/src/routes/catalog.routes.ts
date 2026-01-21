import { Router } from "express";
import { listBranches, listBranchProducts } from "../controllers/catalog.controller";

const router = Router();

router.get("/branches", listBranches);
router.get("/branches/:branchId/products", listBranchProducts);

export default router;
