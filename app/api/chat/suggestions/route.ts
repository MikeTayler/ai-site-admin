import { prisma } from "@/lib/db";
import { requireClientForUser } from "@/lib/auth/require-client";
import { getAllContent } from "@/lib/git/github";
import {
  extractPresentComponents,
  getPromptSuggestions,
} from "@/lib/prompts/suggestions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
}

/**
 * GET /api/chat/suggestions?round=0&conversationId=optional
 * Returns 3–4 contextual prompt strings for the chat chips.
 */
export async function GET(req: Request) {
  const res = await requireClientForUser();
  if (!res.ok) {
    return Response.json({ error: res.error }, { status: res.status });
  }
  const { client } = res;
  const { searchParams } = new URL(req.url);
  const roundRaw = searchParams.get("round");
  const interactionRound =
    roundRaw !== null && roundRaw !== ""
      ? Math.max(0, Math.floor(Number(roundRaw)) || 0)
      : 0;
  const conversationId = searchParams.get("conversationId");

  const [changeCount, recentChanges, siteState] = await Promise.all([
    prisma.change.count({ where: { clientId: client.id } }),
    prisma.change.findMany({
      where: { clientId: client.id },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { summary: true, files: true, createdAt: true },
    }),
    getAllContent(client.githubRepo).catch(() => ({} as Record<string, unknown>)),
  ]);

  const presentComponents = extractPresentComponents(siteState);
  const isNewSite = changeCount === 0;

  const suggestions = getPromptSuggestions({
    isNewSite,
    presentComponents,
    recentChanges: recentChanges.map((c) => ({
      summary: c.summary,
      files: asStringArray(c.files),
      createdAt: c.createdAt.toISOString(),
    })),
    interactionRound,
    conversationId,
    now: new Date(),
  });

  return Response.json({ suggestions });
}
