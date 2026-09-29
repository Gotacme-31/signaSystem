-- CreateTable
CREATE TABLE "UserProductAccess" (
  "id" SERIAL NOT NULL,
  "userId" INTEGER NOT NULL,
  "productId" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "UserProductAccess_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserProductAccess_userId_productId_key" ON "UserProductAccess"("userId", "productId");
CREATE INDEX "UserProductAccess_userId_idx" ON "UserProductAccess"("userId");
CREATE INDEX "UserProductAccess_productId_idx" ON "UserProductAccess"("productId");

-- AddForeignKey
ALTER TABLE "UserProductAccess" ADD CONSTRAINT "UserProductAccess_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserProductAccess" ADD CONSTRAINT "UserProductAccess_productId_fkey"
FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
