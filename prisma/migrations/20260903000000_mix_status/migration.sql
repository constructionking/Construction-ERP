-- Mix confirmation state, mirroring how the accountant audits cement:
--   locked      -> variance flags raise normally
--   provisional -> flags raise, marked "(provisional rate)" (e.g. brick mortar
--                  until brick size is confirmed)
--   tbd         -> consumption is reported but NEVER flagged (e.g. per-joint
--                  haunching before the joint volume is fixed)
CREATE TYPE "MixStatus" AS ENUM ('locked', 'provisional', 'tbd');
ALTER TABLE "mix_designs" ADD COLUMN "status" "MixStatus" NOT NULL DEFAULT 'locked';
ALTER TABLE "mix_designs" ADD COLUMN "note" TEXT;
