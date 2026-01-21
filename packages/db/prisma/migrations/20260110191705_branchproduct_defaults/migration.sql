-- AlterTable
ALTER TABLE "BranchProduct" ADD COLUMN     "sizePrices" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "workflowSteps" JSONB NOT NULL DEFAULT '[]';
