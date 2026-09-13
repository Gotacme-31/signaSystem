ALTER TABLE "Order"
ADD COLUMN "publicTrackingToken" TEXT,
ADD COLUMN "publicTrackingTokenCreatedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "Order_publicTrackingToken_key"
ON "Order"("publicTrackingToken");
