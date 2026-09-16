-- Engineer-typed demand items become real stock once approved and received:
-- units sites actually use, categories the owner's inventory groups by, and a
-- marker for master rows the app created from an approved demand line.
ALTER TYPE "Unit" ADD VALUE 'CFT';
ALTER TYPE "Unit" ADD VALUE 'LTR';
ALTER TYPE "Unit" ADD VALUE 'SET';
ALTER TYPE "Unit" ADD VALUE 'DAY';
ALTER TYPE "MaterialCategory" ADD VALUE 'tool';
ALTER TYPE "MaterialCategory" ADD VALUE 'consumable';
ALTER TABLE "materials" ADD COLUMN "fromDemand" BOOLEAN NOT NULL DEFAULT false;
