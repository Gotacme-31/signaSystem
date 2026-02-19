import "dotenv/config";
import express from "express";
import cors from "cors";
import authRoutes from "./routes/auth";
import meRoutes from "./routes/me";
import productsRoutes from "./routes/products";
import catalogRoutes from "./routes/catalog.routes";
import customerRoutes from "./routes/customer.routes";
import orderRoutes from "./routes/order.routes";
import { prisma } from "./lib/prisma";
import adminRouter from "./routes/admin.routes";
import branchPricingRoutes from "./routes/branchPricing.routes";
import dashboardRoutes from './routes/dashboard'
const app = express();

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      
      const allowedPorts = [3000, 3001, 3002, 5173, 5174, 5175, 8080, 8081];
      const ok = allowedPorts.some(port => 
        origin.startsWith(`http://localhost:${port}`) ||
        origin.startsWith(`http://127.0.0.1:${port}`)
      );
      
      cb(ok ? null : new Error("Not allowed by CORS"), ok);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);
app.options(/.*/, cors());


app.use(express.json());
// Rutas públicas
app.use("/auth", authRoutes);
app.use("/me", meRoutes);
app.use("/products", productsRoutes);
app.use(catalogRoutes);
app.use(customerRoutes);
app.use("/orders", orderRoutes);
app.use("/pricing", branchPricingRoutes);

// ✅ TODAS las rutas de Admin en un solo lugar
app.use("/admin", adminRouter);
app.use('/api/dashboard', dashboardRoutes);
// Health

// Health
app.get("/health", async (_req, res) => {
  const users = await prisma.user.count();
  res.json({ ok: true, users });
});
app.get("/__whoami", (_req, res) => res.json({ ok: true, version: "NEW-ROUTES-2026-01-26" }));

app.listen(3001, () => {
  console.log("API corriendo en http://localhost:3001");
});
