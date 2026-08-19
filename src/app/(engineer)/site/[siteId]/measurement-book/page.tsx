import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireSiteRolePage } from "@/lib/auth/page-guard";
import { dateOnly } from "@/lib/versioning/day-close";
import { Card, CardContent, CardHeader, CardTitle, Badge, EmptyState } from "@/components/ui";
import { MbUploader } from "./mb-uploader";

export default async function MeasurementBookPage({
  params,
}: {
  params: Promise<{ siteId: string }>;
}) {
  const { siteId } = await params;
  await requireSiteRolePage(siteId, ["engineer"]);

  const books = await prisma.measurementBook.findMany({
    where: { siteId, isCurrent: true },
    orderBy: { mbDate: "desc" },
    include: { _count: { select: { lines: true } } },
    take: 30,
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Measurement book
        </h2>
        <Link
          href={`/site/${siteId}/progress`}
          className="text-sm font-medium text-brand-700 underline-offset-2 hover:underline"
        >
          ← Progress
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Upload today&apos;s MB</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-xs leading-relaxed text-slate-500">
            Use the preset template — it is all-or-nothing: any bad row rejects the file with a
            row-wise error list.{" "}
            <a
              className="font-medium text-brand-700 underline underline-offset-2"
              href={`/api/measurement-books/template?siteId=${siteId}`}
            >
              Download template (with this site&apos;s activity codes)
            </a>
          </p>
          <MbUploader siteId={siteId} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Uploaded books</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {books.length === 0 ? (
            <EmptyState title="No measurement books yet" />
          ) : (
            books.map((book) => (
              <div
                key={book.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2.5"
              >
                <div>
                  <p className="text-sm font-medium text-slate-800">
                    {dateOnly(book.mbDate)} · Sheet {book.sheetNo}
                  </p>
                  <p className="text-xs text-slate-500">{book._count.lines} lines parsed</p>
                </div>
                <div className="flex items-center gap-2">
                  {book.version > 1 ? <Badge tone="amber">v{book.version}</Badge> : null}
                  <MbUploader siteId={siteId} reuploadEntityId={book.entityId} compact />
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
