import { Prisma, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Precio default para arrancar (luego lo editas en Admin)
const DEFAULT_PRICE = new Prisma.Decimal("100.00");

async function main() {
  // 1) Trae sucursales y productos existentes
  const branches = await prisma.branch.findMany({ select: { id: true, name: true } });
  const products = await prisma.product.findMany({ select: { id: true, name: true } });

  if (branches.length === 0) {
    throw new Error(
      "No hay sucursales (Branch). Crea al menos 1 sucursal antes de correr el seed."
    );
  }

  if (products.length === 0) {
    throw new Error(
      "No hay productos (Product). Crea al menos 1 producto antes de correr el seed."
    );
  }

  // 2) Crea todos los BranchProduct faltantes con precio default
  const data: Prisma.BranchProductCreateManyInput[] = [];

  for (const b of branches) {
    for (const p of products) {
      data.push({
        branchId: b.id,
        productId: p.id,
        isActive: true,
        price: DEFAULT_PRICE,
      });
    }
  }

  // Crea los que no existan (gracias al @@unique([branchId, productId]))
  const created = await prisma.branchProduct.createMany({
    data,
    skipDuplicates: true,
  });

  // 3) Si ya existían pero su price quedó en 0, lo ponemos al default (opcional, útil al inicio)
  const updatedZeros = await prisma.branchProduct.updateMany({
    where: { price: { equals: new Prisma.Decimal("0") } },
    data: { price: DEFAULT_PRICE },
  });

  console.log("Branches:", branches.length, "Products:", products.length);
  console.log("BranchProduct creados:", created.count);
  console.log("BranchProduct actualizados (price 0 -> default):", updatedZeros.count);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
