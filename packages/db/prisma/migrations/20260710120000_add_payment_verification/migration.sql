ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'PAYMENTS';

CREATE TYPE "PaymentVerificationStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'CONFIRMED', 'REJECTED');

ALTER TABLE "OrderPayment" ADD COLUMN "verificationStatus" "PaymentVerificationStatus";
ALTER TABLE "OrderPayment" ADD COLUMN "verifiedAt" TIMESTAMP(3);
ALTER TABLE "OrderPayment" ADD COLUMN "verifiedById" INTEGER;
ALTER TABLE "OrderPayment" ADD COLUMN "verificationNotes" TEXT;

UPDATE "OrderPayment"
SET "verificationStatus" = CASE
  WHEN "method" = 'TRANSFER'::"PaymentMethod" THEN 'CONFIRMED'::"PaymentVerificationStatus"
  ELSE 'NOT_REQUIRED'::"PaymentVerificationStatus"
END;

ALTER TABLE "OrderPayment" ALTER COLUMN "verificationStatus" SET NOT NULL;
ALTER TABLE "OrderPayment" ALTER COLUMN "verificationStatus" SET DEFAULT 'NOT_REQUIRED';

ALTER TABLE "OrderPayment"
ADD CONSTRAINT "OrderPayment_verifiedById_fkey"
FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "OrderPayment_verificationStatus_idx" ON "OrderPayment"("verificationStatus");
CREATE INDEX "OrderPayment_verifiedById_idx" ON "OrderPayment"("verifiedById");
