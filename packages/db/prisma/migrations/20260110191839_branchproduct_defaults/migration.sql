/*
  Warnings:

  - You are about to drop the column `sizePrices` on the `BranchProduct` table. All the data in the column will be lost.
  - You are about to drop the column `workflowSteps` on the `BranchProduct` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "BranchProduct" DROP COLUMN "sizePrices",
DROP COLUMN "workflowSteps";
