/*
  Warnings:

  - You are about to drop the column `tierSnapshot` on the `OrderItem` table. All the data in the column will be lost.
  - You are about to drop the `BranchProductTierPrice` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "BranchProductTierPrice" DROP CONSTRAINT "BranchProductTierPrice_branchProductId_fkey";

-- AlterTable
ALTER TABLE "OrderItem" DROP COLUMN "tierSnapshot",
ADD COLUMN     "appliedMinQty" DECIMAL(12,3);

-- DropTable
DROP TABLE "BranchProductTierPrice";

-- DropEnum
DROP TYPE "PriceTier";

-- CreateTable
CREATE TABLE "BranchProductQuantityPrice" (
    "id" SERIAL NOT NULL,
    "branchProductId" INTEGER NOT NULL,
    "minQty" DECIMAL(12,3) NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "BranchProductQuantityPrice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BranchProductQuantityPrice_branchProductId_idx" ON "BranchProductQuantityPrice"("branchProductId");

-- CreateIndex
CREATE UNIQUE INDEX "BranchProductQuantityPrice_branchProductId_minQty_key" ON "BranchProductQuantityPrice"("branchProductId", "minQty");

-- AddForeignKey
ALTER TABLE "BranchProductQuantityPrice" ADD CONSTRAINT "BranchProductQuantityPrice_branchProductId_fkey" FOREIGN KEY ("branchProductId") REFERENCES "BranchProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;
