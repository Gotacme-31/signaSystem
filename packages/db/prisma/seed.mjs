import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";

const prisma = new PrismaClient();

async function main() {
  // 1) BRANCHES (si ya existen, no duplica)
  const branchNames = ["Algarin 1", "Algarin 2", "Toluca", "Guadalajara"];

  for (const name of branchNames) {
    await prisma.branch.upsert({
      where: { name },
      update: { isActive: true },
      create: { name, isActive: true },
    });
  }

  const branches = await prisma.branch.findMany({ orderBy: { id: "asc" } });

  // 2) PRODUCTS (mínimos para empezar)
  const productsData = [
    { name: "DTF TEXTIL", unitType: "METER", needsVariant: false },
    { name: "DTF UV", unitType: "METER", needsVariant: false },
    { name: "SUBLIMACION CON TELA", unitType: "METER", needsVariant: false },
    { name: "SUBLIMACION SIN TELA", unitType: "METER", needsVariant: false },
    { name: "TOALLA", unitType: "PIECE", needsVariant: true },
    { name: "FRAZADA", unitType: "PIECE", needsVariant: true },
  ];

  for (const p of productsData) {
    await prisma.product.upsert({
      where: { name: p.name },
      update: { isActive: true, unitType: p.unitType, needsVariant: p.needsVariant },
      create: { ...p, isActive: true },
    });
  }

  const products = await prisma.product.findMany({ orderBy: { id: "asc" } });

  // 3) BRANCHPRODUCTS (para que cada sucursal tenga todos los productos)
  for (const b of branches) {
    for (const p of products) {
      await prisma.branchProduct.upsert({
        where: { branchId_productId: { branchId: b.id, productId: p.id } },
        update: { isActive: true },
        create: { branchId: b.id, productId: p.id, isActive: true, price: 0 },
      });
    }
  }

  // 4) PLANTILLAS DE PROCESO (ProductProcessStep)
  const templates = {
    "DTF TEXTIL": ["DISEÑO", "IMPRESION", "LISTO"],
    "DTF UV": ["DISEÑO", "IMPRESION", "LISTO"],
    "SUBLIMACION CON TELA": ["DISEÑO", "IMPRESION", "CALANDRADO", "ACABADOS", "LISTO"],
    "SUBLIMACION SIN TELA": ["DISEÑO", "IMPRESION", "CALANDRADO", "ACABADOS", "LISTO"],
    "TOALLA": ["DISEÑO", "IMPRESION", "ACABADOS", "LISTO"],
    "FRAZADA": ["DISEÑO", "IMPRESION", "ACABADOS", "LISTO"],
  };

  for (const p of products) {
    const steps = templates[p.name];
    if (!steps?.length) continue;

    await prisma.$transaction(async (tx) => {
      await tx.productProcessStep.updateMany({
        where: { productId: p.id },
        data: { isActive: false },
      });

      for (let i = 0; i < steps.length; i++) {
        await tx.productProcessStep.create({
          data: {
            productId: p.id,
            name: steps[i],
            order: i + 1,
            isActive: true,
          },
        });
      }
    });
  }

  // 5) CUSTOMER de prueba
  await prisma.customer.upsert({
    where: { phone: "5512345678" },
    update: { name: "Cliente Prueba" },
    create: { name: "Cliente Prueba", phone: "5512345678" },
  });

  // ===== 6) ADMINISTRADOR GLOBAL =====
  // 👈 NUEVO: Crear usuario administrador si no existe
  
  const adminPassword = "Admin123!";
  const hashedPassword = await bcrypt.hash(adminPassword, 10);

  const admin = await prisma.user.upsert({
    where: { username: "admin" },
    update: {
      // Si ya existe, aseguramos que tenga los datos correctos
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

  console.log("✅ Seed listo.");
  console.log("Branches:", branches.map((b) => ({ id: b.id, name: b.name })));
  console.log("Products:", products.map((p) => ({ id: p.id, name: p.name, unitType: p.unitType })));
  console.log("Admin:", { id: admin.id, username: admin.username, email: admin.email, role: admin.role });
}

main()
  .catch((e) => {
    console.error("❌ Seed error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });