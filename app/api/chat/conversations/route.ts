import { requireClientForUser } from "@/lib/auth/require-client";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const res = await requireClientForUser();
  if (!res.ok) {
    return Response.json({ error: res.error }, { status: res.status });
  }
  const conversation = await prisma.conversation.create({
    data: { clientId: res.client.id },
  });
  return Response.json({ conversationId: conversation.id });
}
