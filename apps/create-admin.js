const bcrypt = require('bcrypt');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  const password = 'Admin123!';
  const hashedPassword = await bcrypt.hash(password, 10);
  
  console.log('Hash generado:', hashedPassword);
  
  // Actualizar el usuario existente
  const user = await prisma.user.update({
    where: { email: 'admin.@signa.local' },
    data: { passwordHash: hashedPassword }
  });
  
  console.log('Usuario actualizado:', user);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());