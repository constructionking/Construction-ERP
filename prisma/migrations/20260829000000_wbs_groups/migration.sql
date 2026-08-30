-- Two-level WBS: main activities (structures like "Boundary wall", "STP")
-- become explicit group rows; trade items hang beneath them via parentId.
ALTER TABLE "activities" ADD COLUMN "isGroup" BOOLEAN NOT NULL DEFAULT false;
