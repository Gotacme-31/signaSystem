-- CreateEnum
CREATE TYPE "StepStatus" AS ENUM ('PENDING', 'DONE');

-- CreateEnum
CREATE TYPE "ShippingStage" AS ENUM ('SHIPPED', 'RECEIVED');

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "shippingStage" "ShippingStage";

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "currentStepOrder" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "isReady" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ProductProcessStep" (
    "id" SERIAL NOT NULL,
    "productId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ProductProcessStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItemStep" (
    "id" SERIAL NOT NULL,
    "orderItemId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "status" "StepStatus" NOT NULL DEFAULT 'PENDING',
    "doneAt" TIMESTAMP(3),

    CONSTRAINT "OrderItemStep_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductProcessStep_productId_idx" ON "ProductProcessStep"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductProcessStep_productId_order_key" ON "ProductProcessStep"("productId", "order");

-- CreateIndex
CREATE INDEX "OrderItemStep_orderItemId_status_idx" ON "OrderItemStep"("orderItemId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "OrderItemStep_orderItemId_order_key" ON "OrderItemStep"("orderItemId", "order");

-- AddForeignKey
ALTER TABLE "ProductProcessStep" ADD CONSTRAINT "ProductProcessStep_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItemStep" ADD CONSTRAINT "OrderItemStep_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
