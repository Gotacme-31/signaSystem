import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";

const prisma = new PrismaClient();

async function main() {
  // ===== SOLO CREAR ADMINISTRADOR GLOBAL =====
  console.log("👤 Creando/actualizando usuario administrador...");
  
  const adminPassword = "Admin123!";
  const hashedPassword = await bcrypt.hash(adminPassword, 10);

  const admin = await prisma.user.upsert({
    where: { username: "admin" },
    update: {
      name: "Administrador",
      email: "admin@signa.local",
      passwordHash: hashedPassword,
      role: "ADMIN",
      isActive: true,
    },
    create: {
      username: "admin",
      email: "admin@signa.local",
      name: "Administrador",
      passwordHash: hashedPassword,
      role: "ADMIN",
      isActive: true,
      branchId: null, // Admin global, sin sucursal
    },
  });

  console.log("✅ Seed completado.");
  console.log("=".repeat(50));
  console.log("Usuario administrador:");
  console.log(`  Usuario: ${admin.username}`);
  console.log(`  Contraseña: ${adminPassword}`);
  console.log(`  Email: ${admin.email}`);
  console.log(`  Role: ${admin.role}`);
  console.log("=".repeat(50));
}

main()
  .catch((e) => {
    console.error("❌ Seed error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });