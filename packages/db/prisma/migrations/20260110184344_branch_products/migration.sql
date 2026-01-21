/*
  Warnings:

  - You are about to drop the column `basePrice` on the `BranchProduct` table. All the data in the column will be lost.
  - You are about to drop the column `isEnabled` on the `BranchProduct` table. All the data in the column will be lost.
  - You are about to drop the column `sizePrices` on the `BranchProduct` table. All the data in the column will be lost.
  - You are about to drop the column `workflowSteps` on the `BranchProduct` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "BranchProduct" DROP CONSTRAINT "BranchProduct_branchId_fkey";

-- DropForeignKey
ALTER TABLE "BranchProduct" DROP CONSTRAINT "BranchProduct_productId_fkey";

-- AlterTable
ALTER TABLE "BranchProduct" DROP COLUMN "basePrice",
DROP COLUMN "isEnabled",
DROP COLUMN "sizePrices",
DROP COLUMN "workflowSteps",
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true;

-- AddForeignKey
ALTER TABLE "BranchProduct" ADD CONSTRAINT "BranchProduct_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BranchProduct" ADD CONSTRAINT "BranchProduct_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
