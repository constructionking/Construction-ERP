-- Owner-set mix per work item: different sub-activities use different mixes
-- (UGT raft on M25, road edging PCC on 1:4:8...). The engineer's consumption
-- form pre-selects it; the consumption audit keeps keying on the mix actually
-- booked on each entry.
ALTER TABLE "activities" ADD COLUMN "defaultMixId" UUID;
