"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PipelineProgressPhase } from "@/lib/ai/pipeline";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  metadata?: unknown;
  createdAt?: string;
};

type StreamEvent =
  | { type: "meta"; conversationId: string }
  | {
      type: "status";
      phase: PipelineProgressPhase;
      message?: string;
      timestamp?: string;
      detail?: unknown;
    }
  | { type: "result"; conversationId: string }
  | { type: "error"; message: string };

function getDeployUrl(meta: unknown): string | undefined {
  if (!meta || typeof meta !== "object" || meta === null) return undefined;
  const u = (meta as { deployUrl?: string }).deployUrl;
  return typeof u === "string" && u.length > 0 ? u : undefined;
}

const PHASE_LABEL: Record<PipelineProgressPhase, string> = {
  thinking: "Thinking…",
  validating: "Validating output…",
  committing: "Committing to GitHub…",
  deploying: "Deploying on Vercel…",
  complete: "Complete",
  error: "Error",
};

function parseSseBuffer(
  buffer: string,
  onEvent: (ev: StreamEvent) => void,
): string {
  let rest = buffer;
  const blocks = rest.split("\n\n");
  rest = blocks.pop() ?? "";
  for (const block of blocks) {
    const line = block.trim();
    if (!line.startsWith("data:")) continue;
    const json = line.slice(5).trim();
    try {
      onEvent(JSON.parse(json) as StreamEvent);
    } catch {
      /* ignore malformed chunk */
    }
  }
  return rest;
}

export default function ChatPage() {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [statusLines, setStatusLines] = useState<string[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, statusLines, scrollToBottom]);

  const loadMessages = useCallback(async (convId?: string | null) => {
    setLoading(true);
    setLoadError(null);
    try {
      const q =
        convId != null && convId !== ""
          ? `?conversationId=${encodeURIComponent(convId)}`
          : "";
      const res = await fetch(`/api/chat${q}`, { credentials: "include" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error((j as { error?: string }).error ?? res.statusText);
      }
      const data = (await res.json()) as {
        conversationId: string | null;
        messages: ChatMessage[];
      };
      setConversationId(data.conversationId);
      setMessages(
        data.messages.map((m) => ({
          ...m,
          id: m.id,
        })),
      );
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Failed to load chat");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadMessages();
  }, [loadMessages]);

  const handleNewConversation = async () => {
    try {
      const res = await fetch("/api/chat/conversations", {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error((j as { error?: string }).error ?? res.statusText);
      }
      const { conversationId: id } = (await res.json()) as {
        conversationId: string;
      };
      setConversationId(id);
      setMessages([]);
      setStatusLines([]);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not start thread");
    }
  };

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || sending) return;

    setInput("");
    setSending(true);
    setStreaming(true);
    setStatusLines([]);

    const userMsg: ChatMessage = {
      id: `temp-${Date.now()}`,
      role: "user",
      content: text,
    };
    setMessages((prev) => [...prev, userMsg]);

    let buffer = "";
    let resolvedConvId: string | null = conversationId;
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          conversationId: conversationId ?? undefined,
        }),
      });

      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        throw new Error((j as { error?: string }).error ?? res.statusText);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        buffer = parseSseBuffer(buffer, (ev) => {
          if (ev.type === "meta") {
            resolvedConvId = ev.conversationId;
            setConversationId(ev.conversationId);
          }
          if (ev.type === "status") {
            const label = PHASE_LABEL[ev.phase] ?? ev.phase;
            const line = ev.message ? `${label} — ${ev.message}` : label;
            setStatusLines((prev) => [...prev, line].slice(-12));
          }
          if (ev.type === "result") {
            resolvedConvId = ev.conversationId;
            setConversationId(ev.conversationId);
          }
          if (ev.type === "error") {
            setStatusLines((prev) => [...prev, `Error: ${ev.message}`]);
          }
        });
      }
      if (buffer.trim()) {
        parseSseBuffer(`${buffer}\n\n`, (ev) => {
          if (ev.type === "meta") {
            resolvedConvId = ev.conversationId;
            setConversationId(ev.conversationId);
          }
          if (ev.type === "result") {
            resolvedConvId = ev.conversationId;
            setConversationId(ev.conversationId);
          }
          if (ev.type === "error") {
            setStatusLines((prev) => [...prev, `Error: ${ev.message}`]);
          }
        });
      }

      await loadMessages(resolvedConvId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Request failed";
      setMessages((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          role: "assistant",
          content: `**Error:** ${msg}`,
        },
      ]);
    } finally {
      setSending(false);
      setStreaming(false);
      setStatusLines([]);
      textareaRef.current?.focus();
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center text-sm text-zinc-500">
        Loading conversation…
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        {loadError}
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100dvh-8.5rem)] min-h-[420px] flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-3">
        <div>
          <h2 className="text-base font-semibold text-zinc-900">Chat</h2>
          <p className="text-xs text-zinc-500">
            Prompts run the full AI → Git → Vercel pipeline.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void handleNewConversation()}
          className="rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm font-medium text-zinc-800 shadow-sm hover:bg-zinc-50"
        >
          New conversation
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {messages.length === 0 && !sending && (
          <p className="text-center text-sm text-zinc-500">
            Send a message to update your site. Previous runs appear here once
            saved.
          </p>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                m.role === "user"
                  ? "bg-zinc-900 text-white"
                  : "border border-zinc-200 bg-zinc-50 text-zinc-800"
              }`}
            >
              <div className="whitespace-pre-wrap">{m.content}</div>
              {m.role === "assistant" &&
                (() => {
                  const url = getDeployUrl(m.metadata);
                  if (!url) return null;
                  return (
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 inline-block text-xs font-medium text-emerald-700 underline"
                    >
                      View changes
                    </a>
                  );
                })()}
            </div>
          </div>
        ))}

        {streaming && (
          <div className="flex justify-start">
            <div className="max-w-[85%] rounded-2xl border border-dashed border-zinc-200 bg-zinc-50/80 px-4 py-2.5 text-sm text-zinc-600">
              <div className="mb-1 flex items-center gap-2">
                <span className="inline-flex h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
                <span className="text-xs font-medium text-zinc-500">
                  Working on your site…
                </span>
              </div>
              {statusLines.length > 0 && (
                <ul className="space-y-0.5 text-xs text-zinc-500">
                  {statusLines.map((line, i) => (
                    <li key={`${line}-${i}`}>• {line}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <div className="border-t border-zinc-100 p-4">
        <div className="flex gap-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Describe the change you want… (Enter to send, Shift+Enter for new line)"
            rows={3}
            disabled={sending}
            className="min-h-[80px] flex-1 resize-y rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-200 disabled:opacity-50"
          />
          <button
            type="button"
            onClick={() => void sendMessage()}
            disabled={sending || !input.trim()}
            className="self-end rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-40"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
