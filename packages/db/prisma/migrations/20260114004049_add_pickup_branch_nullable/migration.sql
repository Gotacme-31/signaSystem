/*
  Warnings:

  - Made the column `pickupBranchId` on table `Order` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "Order" DROP CONSTRAINT "Order_pickupBranchId_fkey";

-- AlterTable
ALTER TABLE "Order" ALTER COLUMN "pickupBranchId" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_pickupBranchId_fkey" FOREIGN KEY ("pickupBranchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
