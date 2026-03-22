"use client";

import { useCallback, useEffect, useState } from "react";

type ChangeRow = {
  id: string;
  createdAt: string;
  prompt: string;
  summary: string;
  commitSha: string;
  deployUrl: string | null;
  files: string[];
};

function githubCommitUrl(repo: string, sha: string): string {
  const [owner, name] = repo.split("/").filter(Boolean);
  if (!owner || !name) return "#";
  return `https://github.com/${owner}/${name}/commit/${sha}`;
}

export default function HistoryPage() {
  const [githubRepo, setGithubRepo] = useState("");
  const [changes, setChanges] = useState<ChangeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revertingId, setRevertingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/history", { credentials: "include" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error((j as { error?: string }).error ?? res.statusText);
      }
      const data = (await res.json()) as {
        githubRepo: string;
        changes: ChangeRow[];
      };
      setGithubRepo(data.githubRepo);
      setChanges(data.changes);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load history");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const restore = async (commitSha: string, id: string) => {
    if (
      !confirm(
        "Restore site content to this version? This creates a new commit on GitHub.",
      )
    ) {
      return;
    }
    setRevertingId(id);
    setMessage(null);
    try {
      const res = await fetch("/api/changes/revert", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commitSha }),
      });
      const raw = await res.text();
      if (!res.ok) {
        let msg = res.statusText;
        try {
          const j = JSON.parse(raw) as { error?: string };
          if (j.error) msg = j.error;
        } catch {
          if (raw.trim()) msg = raw.trim();
        }
        throw new Error(msg);
      }
      const data = JSON.parse(raw) as { message?: string };
      setMessage(data.message ?? "Restored.");
      await load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Restore failed");
    } finally {
      setRevertingId(null);
    }
  };

  if (loading) {
    return (
      <div className="text-sm text-zinc-500">Loading change history…</div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        {error}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-zinc-900">Change history</h2>
        <p className="text-sm text-zinc-500">
          Prompts, commits, and deployments for your site. Restoring rewrites{" "}
          <code className="text-xs">content/</code> to match a past commit.
        </p>
      </div>

      {message && (
        <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          {message}
        </div>
      )}

      {changes.length === 0 ? (
        <p className="text-sm text-zinc-500">
          No changes recorded yet. Run a prompt from Chat to create your first
          entry.
        </p>
      ) : (
        <ul className="space-y-4">
          {changes.map((c) => (
            <li
              key={c.id}
              className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm"
            >
              <time
                className="mb-1 block text-xs font-medium text-zinc-500"
                dateTime={c.createdAt}
              >
                {new Date(c.createdAt).toLocaleString()}
              </time>
              <p className="text-sm font-medium text-zinc-900">{c.summary}</p>
              <p className="mt-1 text-xs text-zinc-600">
                <span className="font-medium text-zinc-700">Prompt:</span>{" "}
                {c.prompt}
              </p>
              {c.files.length > 0 && (
                <ul className="mt-2 list-inside list-disc text-xs text-zinc-500">
                  {c.files.slice(0, 8).map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                  {c.files.length > 8 && (
                    <li>…and {c.files.length - 8} more</li>
                  )}
                </ul>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <a
                  href={githubCommitUrl(githubRepo, c.commitSha)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-xs text-emerald-700 underline"
                >
                  {c.commitSha.slice(0, 7)}
                </a>
                {c.deployUrl && (
                  <a
                    href={c.deployUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-zinc-600 underline"
                  >
                    Deployment
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => void restore(c.commitSha, c.id)}
                  disabled={revertingId !== null}
                  className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-50"
                >
                  {revertingId === c.id ? "Restoring…" : "Restore this version"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
