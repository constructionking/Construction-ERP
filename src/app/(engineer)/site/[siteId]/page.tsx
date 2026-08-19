import { redirect } from "next/navigation";

export default async function SiteIndex({ params }: { params: Promise<{ siteId: string }> }) {
  const { siteId } = await params;
  redirect(`/site/${siteId}/progress`);
}
