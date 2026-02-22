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
import { setupSocket } from "./socket";
import http from "http";

const app = express();

const server = http.createServer(app);

// Configurar Socket.IO
const io = setupSocket(server);

// Hacer io accesible en los controladores
app.set("io", io);

// CORS (local + producción por env)
const allowedOrigins = (process.env.CORS_ORIGIN ?? "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.options("*", cors());

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


const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`🚀 API corriendo en ${PORT}`);
  console.log(`🔌 Socket.IO listo ${PORT}`);
});
