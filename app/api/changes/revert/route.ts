import { prisma } from "@/lib/db";
import { requireClientForUser } from "@/lib/auth/require-client";
import { revertToCommit } from "@/lib/git/github";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST — restore repo `content/` to match a past commit (GitHub), record a Change row.
 * Body: { commitSha: string }
 */
export async function POST(req: Request) {
  const res = await requireClientForUser();
  if (!res.ok) {
    return Response.json({ error: res.error }, { status: res.status });
  }
  const { client } = res;

  let body: { commitSha?: string };
  try {
    body = (await req.json()) as { commitSha?: string };
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const sha = typeof body.commitSha === "string" ? body.commitSha.trim() : "";
  if (!sha) {
    return Response.json({ error: "commitSha is required" }, { status: 400 });
  }

  try {
    const { commitSha: newSha } = await revertToCommit(client.githubRepo, sha);

    await prisma.change.create({
      data: {
        clientId: client.id,
        commitSha: newSha,
        summary: `Restored content/ to match ${sha.slice(0, 7)}`,
        files: ["content/"],
        prompt: "Restore this version (history)",
        deployUrl: null,
      },
    });

    return Response.json({
      ok: true,
      commitSha: newSha,
      message:
        "Repository updated. Trigger or wait for Vercel to deploy the new commit.",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ error: msg }, { status: 500 });
  }
}
