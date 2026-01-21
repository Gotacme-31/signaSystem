import "dotenv/config";
import express from "express";
import cors from "cors";
import authRoutes from "./routes/auth";
import meRoutes from "./routes/me";
import productRoutes from "./routes/products";
import branchProductsRoutes from "./routes/branchProducts";
import branchProductRoutes from "./routes/branchProduct.routes";
import orderRoutes from "./routes/order.routes";
import catalogRoutes from "./routes/catalog.routes";
import customerRoutes from "./routes/customer.routes";

import { prisma } from "./lib/prisma";

const app = express();

// 1) CORS (ANTES de todo)
app.use(
  cors({
    origin: ["http://localhost:5173", "http://127.0.0.1:5173"],
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);
app.options(/.*/, cors());

// 2) JSON
app.use(express.json());

// 3) Rutas
app.use("/auth", authRoutes);
app.use("/me", meRoutes);
app.use("/products", productRoutes);
app.use("/branch-products", branchProductsRoutes);

// Las nuevas
app.use(catalogRoutes);       // /branches, /branches/:id/products
app.use(branchProductRoutes); // /admin/branches/:branchId/products/:productId/price
app.use(orderRoutes);         // /orders
app.use(customerRoutes);

// 4) Health
app.get("/health", async (_req, res) => {
  const users = await prisma.user.count();
  res.json({ ok: true, users });
});

app.listen(3001, () => {
  console.log("API corriendo en http://localhost:3001");
});
