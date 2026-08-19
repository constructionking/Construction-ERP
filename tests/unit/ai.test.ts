import { describe, it, expect } from "vitest";
import { extractJson } from "@/lib/ai/client";
import { buildPhotoProgressPrompt } from "@/lib/ai/photo-progress";
import { buildMbAnomalyPrompt } from "@/lib/ai/mb-anomaly";

describe("extractJson", () => {
  it("parses a bare JSON object", () => {
    expect(extractJson('{"a": 1}')).toEqual({ a: 1 });
  });

  it("parses JSON inside a fenced block", () => {
    expect(extractJson('Here you go:\n```json\n{"estimate_pct": 45}\n```')).toEqual({
      estimate_pct: 45,
    });
  });

  it("parses JSON surrounded by prose", () => {
    expect(extractJson('Based on the photos: {"estimate_pct": 30, "confidence": 0.7} hope that helps')).toEqual(
      { estimate_pct: 30, confidence: 0.7 }
    );
  });

  it("returns null for garbage", () => {
    expect(extractJson("no json here")).toBeNull();
    expect(extractJson("{broken")).toBeNull();
  });
});

describe("prompt builders", () => {
  it("photo prompt carries the activity identity and JSON contract", () => {
    const prompt = buildPhotoProgressPrompt({
      code: "SLAB2",
      name: "Second floor slab",
      category: "concreting",
      boqQty: "120",
      unit: "CUM",
    });
    expect(prompt).toContain("SLAB2");
    expect(prompt).toContain("120 CUM");
    expect(prompt).toContain('"estimate_pct"');
  });

  it("MB prompt lists lines with cumulative context", () => {
    const prompt = buildMbAnomalyPrompt({
      lines: [
        {
          srNo: 1,
          activityCode: "FND",
          description: "Footing PCC",
          nos: "6",
          length: "2",
          breadth: "2",
          depth: "0.5",
          qty: "12",
          unit: "CUM",
        },
      ],
      activities: [{ code: "FND", name: "Foundation", boqQty: "100", unit: "CUM", doneQty: "95" }],
    });
    expect(prompt).toContain("FND | Foundation | BOQ 100 CUM | done 95");
    expect(prompt).toContain("1 | FND | Footing PCC");
    expect(prompt).toContain('"remarks"');
  });
});
