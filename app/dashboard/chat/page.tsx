"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PipelineProgressPhase, PipelineResult } from "@/lib/ai/pipeline";
import { SitePreviewPanel } from "@/components/site-preview-panel";

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
  | { type: "result"; result: PipelineResult; conversationId: string }
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
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [suggestionRound, setSuggestionRound] = useState(0);
  const [showPreview, setShowPreview] = useState(false);
  const [previewSplit, setPreviewSplit] = useState(52);
  const [previewRefreshKey, setPreviewRefreshKey] = useState(0);
  const layoutRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; startSplit: number; width: number } | null>(
    null,
  );
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    try {
      if (localStorage.getItem("dashboard-chat-show-preview") === "1") {
        setShowPreview(true);
      }
      const s = localStorage.getItem("dashboard-chat-preview-split");
      if (s) {
        const n = Number(s);
        if (!Number.isNaN(n)) setPreviewSplit(Math.min(78, Math.max(28, n)));
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("dashboard-chat-show-preview", showPreview ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [showPreview]);

  useEffect(() => {
    try {
      localStorage.setItem("dashboard-chat-preview-split", String(previewSplit));
    } catch {
      /* ignore */
    }
  }, [previewSplit]);

  const onSeparatorMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const el = layoutRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    dragRef.current = {
      startX: e.clientX,
      startSplit: previewSplit,
      width: rect.width,
    };
    const onMove = (ev: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = ev.clientX - d.startX;
      const deltaPct = (dx / d.width) * 100;
      const next = Math.min(78, Math.max(28, d.startSplit - deltaPct));
      setPreviewSplit(next);
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.removeProperty("cursor");
      document.body.style.removeProperty("user-select");
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [previewSplit]);

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

  useEffect(() => {
    if (loading) return;
    let cancelled = false;
    void (async () => {
      try {
        const q = new URLSearchParams();
        q.set("round", String(suggestionRound));
        if (conversationId) q.set("conversationId", conversationId);
        const res = await fetch(`/api/chat/suggestions?${q}`, {
          credentials: "include",
        });
        if (!res.ok) return;
        const data = (await res.json()) as { suggestions?: string[] };
        if (
          !cancelled &&
          Array.isArray(data.suggestions) &&
          data.suggestions.length > 0
        ) {
          setSuggestions(data.suggestions);
        }
      } catch {
        if (!cancelled) setSuggestions([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loading, suggestionRound, conversationId]);

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
      setSuggestionRound(0);
      setSuggestions([]);
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
        const raw = await res.text();
        let detail = res.statusText || `HTTP ${res.status}`;
        try {
          const j = JSON.parse(raw) as { error?: string };
          if (typeof j.error === "string" && j.error.length > 0) detail = j.error;
        } catch {
          if (raw.trim()) detail = raw.trim();
        }
        throw new Error(detail);
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
            if (
              ev.result.success &&
              ev.result.deployUrl &&
              ev.result.deployUrl.length > 0
            ) {
              setPreviewRefreshKey((k) => k + 1);
            }
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
            if (
              ev.result.success &&
              ev.result.deployUrl &&
              ev.result.deployUrl.length > 0
            ) {
              setPreviewRefreshKey((k) => k + 1);
            }
          }
          if (ev.type === "error") {
            setStatusLines((prev) => [...prev, `Error: ${ev.message}`]);
          }
        });
      }

      await loadMessages(resolvedConvId);
      setSuggestionRound((r) => r + 1);
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
      setSuggestionRound((r) => r + 1);
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
    <div
      ref={layoutRef}
      className="flex h-[calc(100dvh-8.5rem)] min-h-[420px] min-w-0 flex-row gap-0"
    >
      <div
        className="flex min-h-0 min-w-0 flex-col"
        style={{ width: showPreview ? `${previewSplit}%` : "100%" }}
      >
        <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-100 px-4 py-3">
        <div>
          <h2 className="text-base font-semibold text-zinc-900">Chat</h2>
          <p className="text-xs text-zinc-500">
            Prompts run the full AI → Git → Vercel pipeline.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowPreview((v) => !v)}
            className="rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm font-medium text-zinc-800 shadow-sm hover:bg-zinc-50"
          >
            {showPreview ? "Hide preview" : "Show preview"}
          </button>
          <Link
            href="/dashboard/preview"
            className="rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm font-medium text-zinc-800 shadow-sm hover:bg-zinc-50"
          >
            Full-page preview
          </Link>
          <button
            type="button"
            onClick={() => void handleNewConversation()}
            className="rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm font-medium text-zinc-800 shadow-sm hover:bg-zinc-50"
          >
            New conversation
          </button>
        </div>
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
        {suggestions.length > 0 && (
          <div className="mb-3">
            <p className="mb-2 text-xs font-medium text-zinc-500">
              Suggested prompts
            </p>
            <div className="flex flex-wrap gap-2">
              {suggestions.map((label, i) => (
                <button
                  key={`${label}-${i}`}
                  type="button"
                  onClick={() => {
                    setInput(label);
                    textareaRef.current?.focus();
                  }}
                  disabled={sending}
                  className="max-w-full rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-left text-xs leading-snug text-zinc-700 shadow-sm transition hover:border-zinc-300 hover:bg-white disabled:opacity-50"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}
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
      </div>

      {showPreview && (
        <>
          <button
            type="button"
            aria-label="Resize chat and preview"
            onMouseDown={onSeparatorMouseDown}
            className="group relative w-3 shrink-0 cursor-col-resize border-x border-transparent bg-transparent px-0 hover:bg-zinc-100/80"
          >
            <span className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-zinc-200 group-hover:bg-zinc-400" />
          </button>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
            <SitePreviewPanel
              compact
              refreshKey={previewRefreshKey}
              className="h-full min-h-0 border-0 shadow-none"
            />
          </div>
        </>
      )}
    </div>
  );
}
