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
import dashboardRoutes from "./routes/dashboard";
import { setupSocket } from "./socket";
import http from "http";
import { startOrderFileCleanupJob } from "./jobs/order-file-cleanup.job";

const app = express();
const server = http.createServer(app);

// Configurar Socket.IO
const io = setupSocket(server);

// Hacer io accesible en los controladores
app.set("io", io);

// CORS
const allowedOrigins = (process.env.CORS_ORIGIN ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: allowedOrigins.length > 0 ? allowedOrigins : true,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    exposedHeaders: ["Content-Disposition"],
  })
);

app.options("*", cors());
app.use(express.json());

// Rutas
app.use("/auth", authRoutes);
app.use("/me", meRoutes);
app.use("/products", productsRoutes);
app.use(catalogRoutes);
app.use(customerRoutes);
app.use("/orders", orderRoutes);
app.use("/pricing", branchPricingRoutes);
app.use("/admin", adminRouter);
app.use("/api/dashboard", dashboardRoutes);

// Health
app.get("/health", async (_req, res) => {
  try {
    const users = await prisma.user.count();
    res.json({ ok: true, db: true, users });
  } catch (error: any) {
    res.status(503).json({
      ok: false,
      db: false,
      error: error?.message ?? "Database unavailable",
    });
  }
});

app.get("/__whoami", (_req, res) =>
  res.json({ ok: true, version: "NEW-ROUTES-2026-01-26" })
);

const PORT = Number(process.env.PORT || 3001);

async function startServer() {
  try {
    const dbUrl = process.env.DATABASE_URL ?? "";

    await prisma.$connect();
    console.log("✅ Prisma conectado");

    server.listen(PORT, () => {
      console.log(`🚀 API corriendo en ${PORT}`);
      console.log(`🔌 Socket.IO listo ${PORT}`);
    });
    startOrderFileCleanupJob();
  } catch (err) {
    console.error("❌ Error conectando Prisma:", err);
    process.exit(1);
  }
}

startServer();

process.on("SIGINT", async () => {
  await prisma.$disconnect();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await prisma.$disconnect();
  process.exit(0);
});
