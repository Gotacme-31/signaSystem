-- CreateEnum
CREATE TYPE "ParamChargeType" AS ENUM ('PER_METER', 'PER_PIECE');

-- AlterTable
ALTER TABLE "OrderItemOption" ADD COLUMN     "chargeType" "ParamChargeType" NOT NULL DEFAULT 'PER_METER',
ADD COLUMN     "quantity" DECIMAL(12,3) NOT NULL DEFAULT 1,
ADD COLUMN     "subtotal" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ProductParam" ADD COLUMN     "chargeType" "ParamChargeType" NOT NULL DEFAULT 'PER_METER';
