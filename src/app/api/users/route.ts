import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { withApi } from "@/lib/api";
import { guard } from "@/lib/auth/guard";

export const GET = withApi(async () => {
  await guard("site.manage");
  const users = await prisma.user.findMany({
    where: { isActive: true },
    select: { id: true, name: true, email: true, phone: true, isOwner: true, siteRoles: true },
    orderBy: { name: "asc" },
  });
  return NextResponse.json({ users });
});

const createSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().email().transform((e) => e.toLowerCase()),
  phone: z.string().trim().min(8).max(20).optional(),
  password: z.string().min(8).max(100),
});

export const POST = withApi(async (req: NextRequest) => {
  await guard("site.manage"); // owner-only
  const data = createSchema.parse(await req.json());
  const passwordHash = await bcrypt.hash(data.password, 10);
  const user = await prisma.user.create({
    data: { name: data.name, email: data.email, phone: data.phone, passwordHash },
    select: { id: true, name: true, email: true },
  });
  return NextResponse.json({ user }, { status: 201 });
});
