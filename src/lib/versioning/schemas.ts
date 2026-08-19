import { z } from "zod";
import type { RecordType } from "@prisma/client";

// One validation source for create AND amend of every versioned record type.

const dateStr = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected yyyy-mm-dd")
  .transform((s) => new Date(s));

const uuid = z.string().uuid();

export const unitEnum = z.enum(["CUM", "SQM", "MTR", "BAG", "NOS", "KG", "TON"]);

export const progressEntrySchema = z
  .object({
    siteId: uuid,
    activityId: uuid,
    entryDate: dateStr,
    qtyDone: z.number().positive().max(1_000_000),
    unit: unitEnum,
    executedBy: z.enum(["dept", "contractor"]),
    contractorName: z.string().trim().max(120).optional(),
    notes: z.string().trim().max(2000).optional(),
  })
  .refine((v) => v.executedBy !== "contractor" || !!v.contractorName?.trim(), {
    message: "Contractor name is required for contractor-executed work",
    path: ["contractorName"],
  });

export const materialReceiptSchema = z.object({
  siteId: uuid,
  materialId: uuid,
  qty: z.number().positive().max(10_000_000),
  unit: unitEnum,
  supplier: z.string().trim().min(1).max(160),
  challanNo: z.string().trim().min(1).max(80),
  qualityAdequate: z.boolean(),
  qualityRemarks: z.string().trim().max(1000).optional(),
  photoIds: z.array(uuid).max(10).default([]),
  requisitionEntityId: uuid.optional(),
  receivedDate: dateStr,
});

export const consumptionEntrySchema = z.object({
  siteId: uuid,
  materialId: uuid,
  activityId: uuid,
  mixDesignId: uuid.optional(),
  qty: z.number().positive().max(10_000_000),
  entryDate: dateStr,
});

export const materialLineSchema = z.object({
  materialId: uuid,
  qty: z.number().positive(),
  unit: unitEnum,
});

export const fundLineSchema = z.object({
  head: z.string().trim().min(1).max(200),
  amount: z.number().positive().max(1_000_000_000),
});

export const requisitionSchema = z
  .object({
    siteId: uuid,
    kind: z.enum(["material", "fund"]),
    lines: z.union([z.array(materialLineSchema).min(1), z.array(fundLineSchema).min(1)]),
    neededBy: dateStr.optional(),
    justification: z.string().trim().min(5).max(2000),
  })
  .superRefine((v, ctx) => {
    const isFundLines = v.lines.every((l) => "head" in l);
    const isMaterialLines = v.lines.every((l) => "materialId" in l);
    if (v.kind === "fund" && !isFundLines) {
      ctx.addIssue({ code: "custom", message: "Fund requests need {head, amount} lines", path: ["lines"] });
    }
    if (v.kind === "material" && !isMaterialLines) {
      ctx.addIssue({
        code: "custom",
        message: "Material requests need {materialId, qty, unit} lines",
        path: ["lines"],
      });
    }
  })
  .transform((v) => ({
    ...v,
    amountTotal:
      v.kind === "fund"
        ? (v.lines as { amount: number }[]).reduce((s, l) => s + l.amount, 0)
        : null,
  }));

export const labourEntrySchema = z
  .object({
    siteId: uuid,
    entryType: z.enum(["day_rate", "period"]),
    source: z.enum(["morning_market", "contractor"]),
    contractorName: z.string().trim().max(120).optional(),
    workTypeId: uuid,
    workersCount: z.number().int().positive().max(10_000),
    rate: z.number().positive().max(1_000_000),
    rateBasis: z.enum(["per_day", "per_unit"]),
    outputQty: z.number().nonnegative().max(10_000_000).optional(),
    outputUnit: unitEnum.optional(),
    entryDate: dateStr.optional(),
    periodStart: dateStr.optional(),
    periodEnd: dateStr.optional(),
  })
  .superRefine((v, ctx) => {
    if (v.entryType === "day_rate") {
      if (!v.entryDate)
        ctx.addIssue({ code: "custom", message: "Day-rate labour needs an entry date", path: ["entryDate"] });
      if (v.periodStart || v.periodEnd)
        ctx.addIssue({
          code: "custom",
          message: "Day-rate labour must not carry a period",
          path: ["periodStart"],
        });
    } else {
      if (!v.periodStart)
        ctx.addIssue({ code: "custom", message: "Period labour needs a start date", path: ["periodStart"] });
      if (v.entryDate)
        ctx.addIssue({
          code: "custom",
          message: "Period labour must not carry a single entry date",
          path: ["entryDate"],
        });
      if (v.periodEnd && v.periodStart && v.periodEnd < v.periodStart)
        ctx.addIssue({ code: "custom", message: "Period end before start", path: ["periodEnd"] });
    }
    if (v.source === "contractor" && !v.contractorName?.trim()) {
      ctx.addIssue({
        code: "custom",
        message: "Contractor name required for contractor-sourced labour",
        path: ["contractorName"],
      });
    }
    if (v.outputQty !== undefined && !v.outputUnit) {
      ctx.addIssue({ code: "custom", message: "Output unit required with output qty", path: ["outputUnit"] });
    }
  });

// measurement_book amendments go through the dedicated re-upload route
// (the payload is a file, not JSON), so it is deliberately absent here.
export const AMENDABLE_VIA_API: Partial<Record<RecordType, z.ZodTypeAny>> = {
  progress_entry: progressEntrySchema,
  material_receipt: materialReceiptSchema,
  consumption_entry: consumptionEntrySchema,
  requisition: requisitionSchema,
  labour_entry: labourEntrySchema,
};
