/* Demo seed: one site with two weeks of activity so every dashboard, report
 * and audit flag has something real to show on first login.
 *
 * Logins (password: demo1234):
 *   owner@demo.erp / engineer@demo.erp / accounts@demo.erp
 */
import { PrismaClient, Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const PASSWORD = "demo1234";

function daysAgo(n: number): Date {
  const d = new Date(Date.now() - n * 86400_000);
  return new Date(d.toISOString().slice(0, 10));
}

async function main() {
  const existing = await prisma.site.findUnique({ where: { code: "SUN" } });
  if (existing) {
    console.log("Seed already applied (site SUN exists) — nothing to do.");
    return;
  }

  const passwordHash = await bcrypt.hash(PASSWORD, 10);

  const [owner, engineer, accounts] = await Promise.all([
    prisma.user.create({
      data: { name: "Rajesh Kumar (Owner)", email: "owner@demo.erp", passwordHash, isOwner: true },
    }),
    prisma.user.create({
      data: { name: "Amit Sharma (Engineer)", email: "engineer@demo.erp", passwordHash },
    }),
    prisma.user.create({
      data: { name: "Priya Nair (Accounts)", email: "accounts@demo.erp", passwordHash },
    }),
  ]);

  const site = await prisma.site.create({
    data: {
      name: "Sunrise Heights",
      code: "SUN",
      location: "Pune, Maharashtra",
      startDate: daysAgo(30),
      status: "active",
    },
  });

  await prisma.siteRole.createMany({
    data: [
      { userId: engineer.id, siteId: site.id, role: "engineer" },
      { userId: accounts.id, siteId: site.id, role: "accounts" },
    ],
  });

  // ---------- materials, mixes, work types ----------
  const [cement, sand, aggregate, bricks, tmt12] = await Promise.all([
    prisma.material.create({
      data: { name: "Cement OPC 53", unit: "BAG", category: "cement", unitsPerCum: 29 },
    }),
    prisma.material.create({
      data: { name: "River sand", unit: "CUM", category: "sand", densityKgPerCum: 1600 },
    }),
    prisma.material.create({
      data: { name: "Aggregate 20mm", unit: "CUM", category: "aggregate", densityKgPerCum: 1500 },
    }),
    prisma.material.create({
      data: { name: "Red clay bricks", unit: "NOS", category: "brick", unitsPerCum: 500 },
    }),
    prisma.material.create({
      data: { name: "TMT 12mm", unit: "KG", category: "steel", densityKgPerCum: 7850 },
    }),
  ]);

  const m20 = await prisma.mixDesign.create({
    data: {
      code: "M20",
      name: "M20 (1:1.5:3) nominal mix",
      coefficients: {
        create: [
          { materialId: cement.id, qtyPerUnit: 8.06 },
          { materialId: sand.id, qtyPerUnit: 0.44 },
          { materialId: aggregate.id, qtyPerUnit: 0.88 },
        ],
      },
    },
  });
  await prisma.mixDesign.create({
    data: {
      code: "M25",
      name: "M25 design mix",
      coefficients: {
        create: [
          { materialId: cement.id, qtyPerUnit: 8.8 },
          { materialId: sand.id, qtyPerUnit: 0.42 },
          { materialId: aggregate.id, qtyPerUnit: 0.84 },
        ],
      },
    },
  });

  const [excavationWt, brickworkWt, plasterWt] = await Promise.all([
    prisma.workType.create({ data: { name: "Excavation", defaultUnit: "CUM" } }),
    prisma.workType.create({ data: { name: "Brickwork", defaultUnit: "CUM" } }),
    prisma.workType.create({ data: { name: "Plastering", defaultUnit: "SQM" } }),
  ]);

  await prisma.benchmarkRate.createMany({
    data: [
      {
        workTypeId: excavationWt.id,
        unit: "CUM",
        benchmarkCostPerUnit: 180,
        effectiveFrom: daysAgo(60),
        setById: owner.id,
      },
      {
        workTypeId: brickworkWt.id,
        unit: "CUM",
        benchmarkCostPerUnit: 950,
        effectiveFrom: daysAgo(60),
        setById: owner.id,
      },
      {
        workTypeId: plasterWt.id,
        unit: "SQM",
        benchmarkCostPerUnit: 48,
        effectiveFrom: daysAgo(60),
        setById: owner.id,
      },
    ],
  });

  // ---------- amendment policies (the approved edit-rights defaults) ----------
  await prisma.amendmentPolicy.createMany({
    data: [
      { recordType: "material_receipt", allowedWindow: "until_day_close", allowedActor: "author", enabled: true },
      { recordType: "measurement_book", allowedWindow: "same_day", allowedActor: "author", enabled: true },
      { recordType: "progress_entry", allowedWindow: "until_day_close", allowedActor: "author", enabled: true },
      { recordType: "consumption_entry", allowedWindow: "until_day_close", allowedActor: "author", enabled: true },
      { recordType: "requisition", allowedWindow: "until_actioned", allowedActor: "author", enabled: true },
      { recordType: "labour_entry", allowedWindow: "until_day_close", allowedActor: "author", enabled: true },
    ],
  });

  // ---------- WBS / BOQ ----------
  async function activity(input: {
    code: string;
    name: string;
    category: Prisma.ActivityCreateInput["category"];
    boqQty: number;
    unit: Prisma.ActivityCreateInput["unit"];
    norm: number;
    sequence: number;
    contractorName?: string;
    after?: string; // predecessor activity id
  }) {
    const created = await prisma.activity.create({
      data: {
        siteId: site.id,
        code: input.code,
        name: input.name,
        category: input.category,
        boqQty: input.boqQty,
        unit: input.unit,
        productivityNormQtyPerDay: input.norm,
        sequence: input.sequence,
        contractorName: input.contractorName,
      },
    });
    if (input.after) {
      await prisma.activityDependency.create({
        data: { predecessorId: input.after, successorId: created.id },
      });
    }
    return created;
  }

  const exc = await activity({
    code: "EXC", name: "Excavation & earthwork", category: "earthwork",
    boqQty: 450, unit: "CUM", norm: 40, sequence: 1,
  });
  const fnd = await activity({
    code: "FND", name: "Foundation & footings (M20)", category: "concreting",
    boqQty: 220, unit: "CUM", norm: 12, sequence: 2, contractorName: "Sharma Constructions", after: exc.id,
  });
  const col = await activity({
    code: "COL", name: "Columns up to plinth (M25)", category: "concreting",
    boqQty: 85, unit: "CUM", norm: 6, sequence: 3, contractorName: "Sharma Constructions", after: fnd.id,
  });
  const slab = await activity({
    code: "SLB1", name: "Ground floor slab (M25)", category: "concreting",
    boqQty: 140, unit: "CUM", norm: 10, sequence: 4, contractorName: "Sharma Constructions", after: col.id,
  });
  const mas = await activity({
    code: "MAS", name: "Blockwork & masonry GF", category: "masonry",
    boqQty: 320, unit: "CUM", norm: 8, sequence: 5, contractorName: "Patil Brothers", after: slab.id,
  });
  const pls = await activity({
    code: "PLS", name: "Internal plaster GF", category: "plaster",
    boqQty: 1800, unit: "SQM", norm: 60, sequence: 6, contractorName: "Patil Brothers", after: mas.id,
  });

  // ---------- baseline (locked 3 weeks ago) ----------
  const baselinePlan: Array<[string, number, number, number]> = [
    // [activityId, startDaysAgo, endDaysAgo, plannedQty]
    [exc.id, 30, 19, 450],
    [fnd.id, 18, 1, 220],
    [col.id, 0, -14, 85],
    [slab.id, -15, -29, 140],
    [mas.id, -30, -70, 320],
    [pls.id, -71, -101, 1800],
  ];
  await prisma.baseline.create({
    data: {
      siteId: site.id,
      version: 1,
      lockedById: owner.id,
      lockedAt: daysAgo(21),
      note: "Initial baseline after monsoon-adjusted suggestion",
      activities: {
        create: baselinePlan.map(([activityId, start, end, qty]) => ({
          activityId,
          plannedStart: daysAgo(start),
          plannedEnd: daysAgo(end),
          plannedQty: qty,
        })),
      },
    },
  });

  // ---------- progress: EXC complete, FND behind schedule ----------
  for (let i = 0; i < 11; i++) {
    await prisma.progressEntry.create({
      data: {
        siteId: site.id,
        activityId: exc.id,
        entryDate: daysAgo(29 - i),
        qtyDone: 41,
        unit: "CUM",
        executedBy: "dept",
        status: "submitted",
        createdById: engineer.id,
        createdAt: daysAgo(29 - i),
      },
    });
  }
  // FND started on time but running at ~60% pace → contractor delay flag
  for (let i = 0; i < 14; i++) {
    await prisma.progressEntry.create({
      data: {
        siteId: site.id,
        activityId: fnd.id,
        entryDate: daysAgo(17 - i),
        qtyDone: 7,
        unit: "CUM",
        executedBy: "contractor",
        contractorName: "Sharma Constructions",
        status: "submitted",
        createdById: engineer.id,
        createdAt: daysAgo(17 - i),
      },
    });
  }

  // ---------- inventory: receipts + consumption (over-norm cement → flag) ----------
  const receipts: Array<[string, number, string, string, boolean, string | null, number]> = [
    [cement.id, 600, "UltraTech Depot", "CH-1101", true, null, 16],
    [cement.id, 400, "UltraTech Depot", "CH-1188", true, null, 8],
    [sand.id, 60, "Krishna Sand Suppliers", "CH-2201", true, null, 14],
    [aggregate.id, 110, "Deccan Crushers", "CH-3301", true, null, 14],
    [bricks.id, 24000, "Wagholi Brick Kiln", "CH-4401", false, "~8% broken bricks in the lot", 6],
    [tmt12.id, 8500, "Kamdhenu Steels", "CH-5501", true, null, 12],
  ];
  for (const [materialId, qty, supplier, challanNo, qualityAdequate, remarks, ago] of receipts) {
    const material = [cement, sand, aggregate, bricks, tmt12].find((m) => m.id === materialId)!;
    await prisma.materialReceipt.create({
      data: {
        siteId: site.id,
        materialId,
        qty,
        unit: material.unit,
        supplier,
        challanNo,
        qualityAdequate,
        qualityRemarks: remarks,
        receivedDate: daysAgo(ago),
        status: "submitted",
        createdById: engineer.id,
        createdAt: daysAgo(ago),
      },
    });
  }

  // FND has 98 cum done → theory: cement 790 bags. Enter 920 (+16%) → warn flag.
  const consumption: Array<[string, number, number]> = [
    [cement.id, 920, 10],
    [sand.id, 45, 10],
    [aggregate.id, 88, 10],
  ];
  for (const [materialId, qty, ago] of consumption) {
    await prisma.consumptionEntry.create({
      data: {
        siteId: site.id,
        materialId,
        activityId: fnd.id,
        mixDesignId: m20.id,
        qty,
        entryDate: daysAgo(ago),
        status: "submitted",
        createdById: engineer.id,
        createdAt: daysAgo(ago),
      },
    });
  }

  // ---------- labour: day gang (over benchmark) + open period ----------
  const dayLabour = await prisma.labourEntry.create({
    data: {
      siteId: site.id,
      entryType: "day_rate",
      source: "morning_market",
      workTypeId: excavationWt.id,
      workersCount: 8,
      rate: 750, // 8×750 = ₹6000 for 25 cum → ₹240/cum vs ₹180 benchmark → flag
      rateBasis: "per_day",
      outputQty: 25,
      outputUnit: "CUM",
      entryDate: daysAgo(3),
      status: "submitted",
      createdById: engineer.id,
      createdAt: daysAgo(3),
    },
  });
  await prisma.labourEntry.create({
    data: {
      siteId: site.id,
      entryType: "period",
      source: "contractor",
      contractorName: "Patil Brothers",
      workTypeId: brickworkWt.id,
      workersCount: 6,
      rate: 800,
      rateBasis: "per_day",
      periodStart: daysAgo(9),
      status: "submitted",
      createdById: engineer.id,
      createdAt: daysAgo(9),
    },
  });

  // ---------- requisitions ----------
  await prisma.requisition.create({
    data: {
      siteId: site.id,
      kind: "fund",
      lines: [
        { head: "Diesel for JCB & generator", amount: 45000 },
        { head: "Water tanker (10 trips)", amount: 12000 },
      ],
      amountTotal: 57000,
      neededBy: daysAgo(-3),
      justification: "Slab preparation week — continuous dewatering and compaction running",
      status: "submitted",
      createdById: engineer.id,
      createdAt: daysAgo(1),
    },
  });
  await prisma.requisition.create({
    data: {
      siteId: site.id,
      kind: "material",
      lines: [
        { materialId: cement.id, qty: 500, unit: "BAG" },
        { materialId: tmt12.id, qty: 4000, unit: "KG" },
      ],
      neededBy: daysAgo(-7),
      justification: "Column casting cycle starts next week",
      status: "submitted",
      createdById: engineer.id,
      createdAt: daysAgo(2),
    },
  });

  console.log("Core data seeded. Running audits & forecasts to generate flags…");

  // Run the real engines so flags/forecasts are genuine outputs, not fixtures.
  process.env.DATABASE_URL = process.env.DATABASE_URL; // already loaded
  const { runConsumptionAudit, runLabourAudit, runReceiptAudits } = await import(
    "../src/lib/audit/engine"
  );
  const { recomputeForecasts } = await import("../src/lib/schedule/service");

  await runConsumptionAudit({ siteId: site.id, activityId: fnd.id, mixDesignId: m20.id });
  await runLabourAudit(dayLabour.entityId);
  const badReceipt = await prisma.materialReceipt.findFirst({
    where: { qualityAdequate: false },
  });
  if (badReceipt) await runReceiptAudits(badReceipt.id);
  await recomputeForecasts(site.id);

  const flags = await prisma.auditFlag.count();
  console.log(`Done. Site "Sunrise Heights" seeded with ${flags} live audit flag(s).`);
  console.log("Logins (password demo1234): owner@demo.erp · engineer@demo.erp · accounts@demo.erp");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
