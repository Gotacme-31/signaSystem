/*
  Warnings:

  - A unique constraint covering the columns `[username]` on the table `User` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `username` to the `User` table without a default value. This is not possible if the table is not empty.

*/
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.

-- 1. Agregar columna username (nullable primero)
ALTER TABLE "User" ADD COLUMN "username" TEXT;

-- 2. Actualizar usuarios existentes con un username basado en su email
-- (toma la parte antes del @ y si está vacío, usa 'user_' + id)
UPDATE "User" 
SET "username" = 
  CASE 
    WHEN email IS NOT NULL AND email != '' THEN 
      SPLIT_PART(email, '@', 1)
    ELSE 
      CONCAT('user_', id)
  END;

-- 3. Ahora hacer username NOT NULL y UNIQUE
ALTER TABLE "User" ALTER COLUMN "username" SET NOT NULL;
ALTER TABLE "User" ADD CONSTRAINT "User_username_key" UNIQUE ("username");

-- 4. Hacer email opcional
ALTER TABLE "User" ALTER COLUMN "email" DROP NOT NULL;