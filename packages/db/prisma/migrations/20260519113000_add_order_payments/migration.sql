-- CreateTable
CREATE TABLE IF NOT EXISTS "OrderPayment" (
  "id" SERIAL NOT NULL,
  "orderId" INTEGER NOT NULL,
  "method" "PaymentMethod" NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "reference" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "OrderPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "OrderPayment_orderId_idx" ON "OrderPayment"("orderId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "OrderPayment_method_idx" ON "OrderPayment"("method");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "OrderPayment_createdAt_idx" ON "OrderPayment"("createdAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'OrderPayment_orderId_fkey'
      AND table_name = 'OrderPayment'
  ) THEN
    ALTER TABLE "OrderPayment"
      ADD CONSTRAINT "OrderPayment_orderId_fkey"
      FOREIGN KEY ("orderId") REFERENCES "Order"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Backfill existing orders to a single payment row (idempotent)
INSERT INTO "OrderPayment" ("orderId", "method", "amount", "reference", "createdAt")
SELECT o."id", o."paymentMethod", o."total", NULL, o."createdAt"
FROM "Order" o
WHERE NOT EXISTS (
  SELECT 1 FROM "OrderPayment" op WHERE op."orderId" = o."id"
);
