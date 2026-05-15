-- Add new role for branch-multi-access counter users
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'MULTI_COUNTER';

-- Store additional branch access per user
CREATE TABLE IF NOT EXISTS "UserBranchAccess" (
  "id" SERIAL NOT NULL,
  "userId" INTEGER NOT NULL,
  "branchId" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "UserBranchAccess_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "UserBranchAccess_userId_branchId_key" ON "UserBranchAccess"("userId", "branchId");
CREATE INDEX IF NOT EXISTS "UserBranchAccess_userId_idx" ON "UserBranchAccess"("userId");
CREATE INDEX IF NOT EXISTS "UserBranchAccess_branchId_idx" ON "UserBranchAccess"("branchId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'UserBranchAccess_userId_fkey'
      AND table_name = 'UserBranchAccess'
  ) THEN
    ALTER TABLE "UserBranchAccess"
      ADD CONSTRAINT "UserBranchAccess_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'UserBranchAccess_branchId_fkey'
      AND table_name = 'UserBranchAccess'
  ) THEN
    ALTER TABLE "UserBranchAccess"
      ADD CONSTRAINT "UserBranchAccess_branchId_fkey"
      FOREIGN KEY ("branchId") REFERENCES "Branch"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
