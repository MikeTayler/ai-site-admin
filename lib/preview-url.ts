import { prisma } from "@/lib/db";
import { getProductionSiteUrl } from "@/lib/deploy/vercel";

/**
 * URL for the site preview iframe: always the **production** hostname (custom domain or
 * `project.vercel.app` from Vercel project settings), never a branch/preview deployment URL.
 * `Change.deployUrl` is not used here — it stores the per-deployment URL from the pipeline.
 */
export async function resolvePreviewUrlForClient(clientId: string): Promise<{
  url: string | null;
  source: "production" | "none";
}> {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { vercelProjectId: true },
  });
  if (!client?.vercelProjectId) {
    return { url: null, source: "none" };
  }

  try {
    const url = await getProductionSiteUrl(client.vercelProjectId);
    if (url) return { url, source: "production" };
  } catch {
    /* VERCEL_TOKEN missing, API error, etc. */
  }

  return { url: null, source: "none" };
}
