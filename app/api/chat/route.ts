import { prisma } from "@/lib/db";
import { requireClientForUser } from "@/lib/auth/require-client";
import { processPrompt, type PipelineResult } from "@/lib/ai/pipeline";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

function sseData(obj: object): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(obj)}\n\n`);
}

/**
 * GET /api/chat?conversationId=optional — latest conversation (or by id) with messages.
 */
export async function GET(req: Request) {
  const res = await requireClientForUser();
  if (!res.ok) {
    return Response.json({ error: res.error }, { status: res.status });
  }
  const { client } = res;
  const { searchParams } = new URL(req.url);
  const qId = searchParams.get("conversationId");

  const conversation = qId
    ? await prisma.conversation.findFirst({
        where: { id: qId, clientId: client.id },
        include: {
          messages: { orderBy: { createdAt: "asc" } },
        },
      })
    : await prisma.conversation.findFirst({
        where: { clientId: client.id },
        orderBy: { updatedAt: "desc" },
        include: {
          messages: { orderBy: { createdAt: "asc" } },
        },
      });

  return Response.json({
    clientId: client.id,
    conversationId: conversation?.id ?? null,
    messages: (conversation?.messages ?? []).map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      metadata: m.metadata,
      createdAt: m.createdAt.toISOString(),
    })),
  });
}

/**
 * POST /api/chat — stream pipeline status + result (SSE). Body: { message, conversationId? }.
 */
export async function POST(req: Request) {
  const res = await requireClientForUser();
  if (!res.ok) {
    return Response.json({ error: res.error }, { status: res.status });
  }
  const { client } = res;

  let body: { message?: string; conversationId?: string | null };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) {
    return Response.json({ error: "message is required" }, { status: 400 });
  }

  const rawConvId = body.conversationId;
  const hasConvId =
    typeof rawConvId === "string" && rawConvId.length > 0;

  let conversation: { id: string };
  if (hasConvId) {
    const found = await prisma.conversation.findFirst({
      where: { id: rawConvId, clientId: client.id },
    });
    if (!found) {
      return Response.json({ error: "Conversation not found" }, { status: 404 });
    }
    conversation = found;
  } else {
    conversation = await prisma.conversation.create({
      data: { clientId: client.id },
    });
  }

  await prisma.message.create({
    data: {
      conversationId: conversation.id,
      role: "user",
      content: message,
    },
  });

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: object) => controller.enqueue(sseData(obj));
      send({ type: "meta", conversationId: conversation.id });

      try {
        const result: PipelineResult = await processPrompt(client.id, message, {
          onProgress: (e) => {
            send({
              type: "status",
              phase: e.phase,
              message: e.message,
              timestamp: e.timestamp,
              detail: e.detail,
            });
          },
        });

        const assistantText = result.success
          ? (result.summary ?? "Changes deployed.")
          : `Something went wrong: ${result.error ?? "Unknown error"}`;

        await prisma.message.create({
          data: {
            conversationId: conversation.id,
            role: "assistant",
            content: assistantText,
            metadata: {
              success: result.success,
              summary: result.summary,
              deployUrl: result.deployUrl,
              commitSha: result.commitSha,
              changes: result.changes,
              error: result.error,
              timestamp: result.timestamp,
            } as object,
          },
        });

        send({ type: "result", result, conversationId: conversation.id });
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        await prisma.message.create({
          data: {
            conversationId: conversation.id,
            role: "assistant",
            content: `Error: ${errMsg}`,
            metadata: { success: false, error: errMsg } as object,
          },
        });
        send({ type: "error", message: errMsg });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
