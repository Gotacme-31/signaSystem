import { Router } from "express";
import { createCustomer, getCustomerById } from "../controllers/customer.controller";

const router = Router();

router.post("/customers", createCustomer);
router.get("/customers/:id", getCustomerById);

export default router;
