import { requireClientForUser } from "@/lib/auth/require-client";
import { resolvePreviewUrlForClient } from "@/lib/preview-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET — { url, source } for the site preview iframe. */
export async function GET() {
  const res = await requireClientForUser();
  if (!res.ok) {
    return Response.json({ error: res.error }, { status: res.status });
  }
  const { url, source } = await resolvePreviewUrlForClient(res.client.id);
  return Response.json({ url, source });
}
