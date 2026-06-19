DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OrderFileStatus') THEN
    CREATE TYPE "OrderFileStatus" AS ENUM ('ACTIVE', 'PENDING_DELETE', 'DELETED', 'DELETE_FAILED');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OrderFileType') THEN
    CREATE TYPE "OrderFileType" AS ENUM ('ORIGINAL', 'PREPARED', 'OTHER');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "OrderFile" (
  "id" SERIAL NOT NULL,
  "orderId" INTEGER NOT NULL,
  "orderItemId" INTEGER,
  "type" "OrderFileType" NOT NULL DEFAULT 'ORIGINAL',
  "status" "OrderFileStatus" NOT NULL DEFAULT 'ACTIVE',
  "originalName" TEXT NOT NULL,
  "storedName" TEXT NOT NULL,
  "relativePath" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "uploadedById" INTEGER,
  "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "downloadedAt" TIMESTAMP(3),
  "downloadedById" INTEGER,
  "deleteAfter" TIMESTAMP(3),
  "deletedAt" TIMESTAMP(3),
  "deleteAttempts" INTEGER NOT NULL DEFAULT 0,
  "lastDeleteError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "OrderFile_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "OrderFile_orderId_idx" ON "OrderFile"("orderId");
CREATE INDEX IF NOT EXISTS "OrderFile_orderId_status_idx" ON "OrderFile"("orderId", "status");
CREATE INDEX IF NOT EXISTS "OrderFile_orderItemId_idx" ON "OrderFile"("orderItemId");
CREATE INDEX IF NOT EXISTS "OrderFile_status_deleteAfter_idx" ON "OrderFile"("status", "deleteAfter");
CREATE INDEX IF NOT EXISTS "OrderFile_uploadedById_idx" ON "OrderFile"("uploadedById");
CREATE INDEX IF NOT EXISTS "OrderFile_downloadedById_idx" ON "OrderFile"("downloadedById");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'OrderFile_orderId_fkey'
      AND table_name = 'OrderFile'
  ) THEN
    ALTER TABLE "OrderFile"
      ADD CONSTRAINT "OrderFile_orderId_fkey"
      FOREIGN KEY ("orderId") REFERENCES "Order"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'OrderFile_orderItemId_fkey'
      AND table_name = 'OrderFile'
  ) THEN
    ALTER TABLE "OrderFile"
      ADD CONSTRAINT "OrderFile_orderItemId_fkey"
      FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'OrderFile_uploadedById_fkey'
      AND table_name = 'OrderFile'
  ) THEN
    ALTER TABLE "OrderFile"
      ADD CONSTRAINT "OrderFile_uploadedById_fkey"
      FOREIGN KEY ("uploadedById") REFERENCES "User"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'OrderFile_downloadedById_fkey'
      AND table_name = 'OrderFile'
  ) THEN
    ALTER TABLE "OrderFile"
      ADD CONSTRAINT "OrderFile_downloadedById_fkey"
      FOREIGN KEY ("downloadedById") REFERENCES "User"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
