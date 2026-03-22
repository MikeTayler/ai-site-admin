import { prisma } from "@/lib/db";
import { getLatestDeployment } from "@/lib/deploy/vercel";

/**
 * Best URL to load in the site preview iframe for a client.
 * Prefers the latest Change with a deploy URL, then falls back to Vercel’s latest deployment.
 */
export async function resolvePreviewUrlForClient(clientId: string): Promise<{
  url: string | null;
  source: "change" | "vercel" | "none";
}> {
  const latestChange = await prisma.change.findFirst({
    where: { clientId, deployUrl: { not: null } },
    orderBy: { createdAt: "desc" },
    select: { deployUrl: true },
  });
  const fromChange = latestChange?.deployUrl?.trim();
  if (fromChange) {
    return { url: fromChange, source: "change" };
  }

  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { vercelProjectId: true },
  });
  if (!client?.vercelProjectId) {
    return { url: null, source: "none" };
  }

  try {
    const d = await getLatestDeployment(client.vercelProjectId);
    if (d.url) return { url: d.url, source: "vercel" };
  } catch {
    /* no deployments or API error */
  }

  return { url: null, source: "none" };
}
