"use client";

import { useCallback, useEffect, useState } from "react";

const DEVICE = {
  desktop: { label: "Desktop", width: 1280 },
  tablet: { label: "Tablet", width: 768 },
  mobile: { label: "Mobile", width: 375 },
} as const;

type DeviceKey = keyof typeof DEVICE;

type Props = {
  /** Bump to reload the iframe (e.g. after a successful deploy). */
  refreshKey?: number;
  className?: string;
  /** Compact toolbar for side panel */
  compact?: boolean;
};

export function SitePreviewPanel({
  refreshKey = 0,
  className = "",
  compact = false,
}: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [device, setDevice] = useState<DeviceKey>("desktop");
  const [manualTick, setManualTick] = useState(0);

  const loadUrl = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch("/api/preview", { credentials: "include" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error((j as { error?: string }).error ?? res.statusText);
      }
      const data = (await res.json()) as {
        url: string | null;
        source?: string;
      };
      setUrl(data.url);
      setSource(data.source ?? null);
      if (!data.url) {
        setLoadError(
          "No deployment URL yet. Run a chat prompt or connect Vercel.",
        );
      }
    } catch (e) {
      setUrl(null);
      setLoadError(e instanceof Error ? e.message : "Could not load preview");
    }
  }, []);

  useEffect(() => {
    void loadUrl();
  }, [loadUrl, refreshKey]);

  const reloadIframe = useCallback(() => {
    setManualTick((t) => t + 1);
  }, []);

  const frameWidth = DEVICE[device].width;

  return (
    <div
      className={`flex min-h-0 flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm ${className}`}
    >
      <div
        className={`flex flex-wrap items-center gap-2 border-b border-zinc-100 bg-zinc-50/80 ${compact ? "px-2 py-2" : "px-3 py-2.5"}`}
      >
        <span className="text-xs font-semibold text-zinc-700">Site preview</span>
        {(Object.keys(DEVICE) as DeviceKey[]).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setDevice(k)}
            className={`rounded-md px-2 py-1 text-xs font-medium ${
              device === k
                ? "bg-zinc-900 text-white"
                : "bg-white text-zinc-600 ring-1 ring-zinc-200 hover:bg-zinc-50"
            }`}
          >
            {DEVICE[k].label}{" "}
            <span className="text-zinc-400">({DEVICE[k].width}px)</span>
          </button>
        ))}
        <button
          type="button"
          onClick={reloadIframe}
          disabled={!url}
          className="ml-auto rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-40"
        >
          Refresh
        </button>
        {url && (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-medium text-emerald-700 underline"
          >
            Open live
          </a>
        )}
      </div>
      {loadError && (
        <div className="border-b border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {loadError}
          {source && (
            <span className="ml-1 text-amber-700">({source})</span>
          )}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto bg-zinc-200/80 p-4">
        {url ? (
          <div
            className="mx-auto h-[min(70vh,800px)] overflow-hidden rounded-lg border border-zinc-300 bg-white shadow-inner"
            style={{
              width: "100%",
              maxWidth: frameWidth,
            }}
          >
            <iframe
              key={`${url}-${refreshKey}-${manualTick}`}
              title="Site preview"
              src={url}
              className="h-full w-full border-0"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
            />
          </div>
        ) : (
          <p className="text-center text-sm text-zinc-500">
            Preview URL unavailable.
          </p>
        )}
      </div>
    </div>
  );
}
