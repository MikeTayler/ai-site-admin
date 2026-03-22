import { prisma } from "@/lib/db";
import { requireClientForUser } from "@/lib/auth/require-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
}

/** GET — change log for the signed-in client’s site. */
export async function GET() {
  const res = await requireClientForUser();
  if (!res.ok) {
    return Response.json({ error: res.error }, { status: res.status });
  }
  const { client } = res;

  const rows = await prisma.change.findMany({
    where: { clientId: client.id },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return Response.json({
    githubRepo: client.githubRepo,
    changes: rows.map((c) => ({
      id: c.id,
      createdAt: c.createdAt.toISOString(),
      prompt: c.prompt,
      summary: c.summary,
      commitSha: c.commitSha,
      deployUrl: c.deployUrl,
      files: asStringArray(c.files),
    })),
  });
}
