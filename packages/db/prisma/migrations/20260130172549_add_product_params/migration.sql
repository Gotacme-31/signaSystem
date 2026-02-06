-- CreateTable
CREATE TABLE "ProductParam" (
    "id" SERIAL NOT NULL,
    "productId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "priceDelta" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "order" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ProductParam_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductParam_productId_idx" ON "ProductParam"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductParam_productId_name_key" ON "ProductParam"("productId", "name");

-- AddForeignKey
ALTER TABLE "ProductParam" ADD CONSTRAINT "ProductParam_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
