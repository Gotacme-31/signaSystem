import { Router } from "express";
import { createCustomer, getCustomerById, searchCustomers } from "../controllers/customer.controller";

const router = Router();

router.post("/customers", createCustomer);
router.get("/customers/search", searchCustomers);
router.get("/customers/:id", getCustomerById);
export default router;
