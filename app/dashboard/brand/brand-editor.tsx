"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { defaultBrandConfig } from "@/lib/brand/defaults";
import { GOOGLE_FONT_OPTIONS, googleFontsStylesheetHref } from "@/lib/brand/google-fonts";
import {
  TONE_OPTIONS,
  type BrandConfig,
  type BorderRadius,
  type SpacingFeel,
  type ToneOption,
} from "@/lib/brand/types";

function rawGithubAssetUrl(githubRepo: string, path: string): string {
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  if (path.startsWith("data:")) return path;
  const parts = githubRepo.split("/").filter(Boolean);
  if (parts.length < 2) return path;
  const [owner, repo] = parts;
  const rel = path.startsWith("/") ? path.slice(1) : path;
  return `https://raw.githubusercontent.com/${owner}/${repo}/main/public/${rel}`;
}

const RADIUS: { value: BorderRadius; label: string; px: number }[] = [
  { value: "none", label: "None", px: 0 },
  { value: "small", label: "Small", px: 4 },
  { value: "medium", label: "Medium", px: 8 },
  { value: "large", label: "Large", px: 16 },
];

const SPACING: { value: SpacingFeel; label: string; pad: string; gap: string }[] = [
  { value: "compact", label: "Compact", pad: "0.75rem", gap: "0.5rem" },
  { value: "normal", label: "Normal", pad: "1rem", gap: "0.75rem" },
  { value: "relaxed", label: "Relaxed", pad: "1.5rem", gap: "1.25rem" },
];

function TagField({
  label,
  tags,
  onChange,
  placeholder,
}: {
  label: string;
  tags: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
}) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const t = draft.trim();
    if (!t || tags.includes(t)) return;
    onChange([...tags, t]);
    setDraft("");
  };
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-zinc-700">{label}</label>
      <div className="flex flex-wrap gap-2 rounded-lg border border-zinc-200 bg-white p-2">
        {tags.map((t) => (
          <span
            key={t}
            className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-800"
          >
            {t}
            <button
              type="button"
              onClick={() => onChange(tags.filter((x) => x !== t))}
              className="text-zinc-500 hover:text-zinc-900"
              aria-label={`Remove ${t}`}
            >
              ×
            </button>
          </span>
        ))}
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder={placeholder}
          className="min-w-[8rem] flex-1 border-0 bg-transparent text-sm outline-none placeholder:text-zinc-400"
        />
      </div>
      <p className="mt-1 text-xs text-zinc-500">Press Enter to add a tag.</p>
    </div>
  );
}

function BrandPreview({
  brand,
  githubRepo,
  pendingLight,
  pendingDark,
}: {
  brand: BrandConfig;
  githubRepo: string;
  pendingLight: string | null;
  pendingDark: string | null;
}) {
  const href = googleFontsStylesheetHref(
    brand.typography.headingFont,
    brand.typography.bodyFont,
  );

  useEffect(() => {
    if (!href) return;
    const id = "brand-preview-google-fonts";
    let el = document.getElementById(id) as HTMLLinkElement | null;
    if (!el) {
      el = document.createElement("link");
      el.id = id;
      el.rel = "stylesheet";
      document.head.appendChild(el);
    }
    el.href = href;
  }, [href]);

  const radiusPx =
    RADIUS.find((r) => r.value === brand.borderRadius)?.px ?? 8;
  const space = SPACING.find((s) => s.value === brand.spacing) ?? SPACING[2];

  /** `SiteHeader`: on light header backgrounds it shows `logo.dark` (dark ink); on primary/dark header, `logo.light`. */
  const srcForLightHeaderBg =
    pendingDark ?? rawGithubAssetUrl(githubRepo, brand.logo.dark);
  const srcForDarkHeaderBg =
    pendingLight ?? rawGithubAssetUrl(githubRepo, brand.logo.light);

  return (
    <div
      className="sticky top-6 overflow-hidden rounded-xl border border-zinc-200 shadow-sm"
      style={{ fontFamily: `"${brand.typography.bodyFont}", system-ui, sans-serif` }}
    >
      <div
        className="border-b border-zinc-100 px-4 py-2 text-xs font-medium text-zinc-500"
      >
        Live preview
      </div>
      <div
        className="p-4"
        style={{
          backgroundColor: brand.colors.background,
          color: brand.colors.text,
        }}
      >
        <div
          className="mb-4 flex items-center justify-between gap-4"
          style={{ gap: space.gap }}
        >
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={srcForLightHeaderBg}
              alt="Logo on default header"
              className="h-8 max-w-[140px] object-contain"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
          </div>
          <div
            className="hidden rounded sm:block"
            style={{
              width: 48,
              height: 32,
              backgroundColor: brand.colors.primary,
              borderRadius: radiusPx,
            }}
          />
        </div>
        <div
          style={{
            padding: space.pad,
            borderRadius: radiusPx,
            backgroundColor: brand.colors.neutral,
            border: `1px solid ${brand.colors.secondary}33`,
          }}
        >
          <h3
            className="mb-2 text-xl font-semibold leading-tight"
            style={{
              fontFamily: `"${brand.typography.headingFont}", serif`,
              color: brand.colors.text,
            }}
          >
            Your headline stands out here
          </h3>
          <p
            className="text-sm leading-relaxed"
            style={{ color: brand.colors.textLight }}
          >
            Body copy uses your chosen font and secondary text colour. Adjust colours
            and typography on the left — this panel updates as you type.
          </p>
          <button
            type="button"
            className="mt-3 inline-block text-sm font-medium"
            style={{
              backgroundColor: brand.colors.primary,
              color: brand.colors.background,
              borderRadius: radiusPx,
              padding: `${space.pad} 1rem`,
            }}
          >
            Sample button
          </button>
        </div>
        <div className="mt-4 flex gap-4">
          <div
            className="flex-1 rounded border border-zinc-200 p-2"
            style={{ backgroundColor: brand.colors.background }}
          >
            <p className="mb-1 text-[10px] uppercase text-zinc-500">
              Default header (light bg) → <code className="text-[9px]">logo.dark</code>
            </p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={srcForLightHeaderBg}
              alt=""
              className="h-6 max-w-full object-contain"
              onError={(e) => {
                (e.target as HTMLImageElement).style.opacity = "0.3";
              }}
            />
          </div>
          <div
            className="flex-1 rounded border border-zinc-600 p-2"
            style={{ backgroundColor: "#18181b" }}
          >
            <p className="mb-1 text-[10px] uppercase text-zinc-400">
              Primary header (dark bg) → <code className="text-[9px]">logo.light</code>
            </p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={srcForDarkHeaderBg}
              alt=""
              className="h-6 max-w-full object-contain"
              onError={(e) => {
                (e.target as HTMLImageElement).style.opacity = "0.3";
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export function BrandEditor() {
  const [brand, setBrand] = useState<BrandConfig | null>(null);
  const [githubRepo, setGithubRepo] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState(false);
  const [pendingLight, setPendingLight] = useState<string | null>(null);
  const [pendingDark, setPendingDark] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch("/api/brand", { credentials: "include" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error((j as { error?: string }).error ?? res.statusText);
      }
      const data = (await res.json()) as {
        brand: BrandConfig;
        githubRepo: string;
        source?: "github" | "database";
      };
      setBrand(data.brand);
      setGithubRepo(data.githubRepo);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Failed to load brand");
      setBrand(defaultBrandConfig());
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const updateBrand = useCallback((patch: Partial<BrandConfig>) => {
    setBrand((b) => (b ? { ...b, ...patch } : b));
  }, []);

  const setColor = useCallback(
    (key: keyof BrandConfig["colors"], value: string) => {
      setBrand((b) =>
        b ? { ...b, colors: { ...b.colors, [key]: value } } : b,
      );
    },
    [],
  );

  const toggleTone = useCallback((tone: ToneOption) => {
    setBrand((b) => {
      if (!b) return b;
      const set = new Set(b.voice.tone);
      if (set.has(tone)) set.delete(tone);
      else set.add(tone);
      return {
        ...b,
        voice: { ...b.voice, tone: Array.from(set) as string[] },
      };
    });
  }, []);

  const fontOptions = useMemo(() => {
    const set = new Set(GOOGLE_FONT_OPTIONS);
    if (brand) {
      set.add(brand.typography.headingFont);
      set.add(brand.typography.bodyFont);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [brand]);

  const onLogoFile = (variant: "light" | "dark", file: File | null) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === "string" ? reader.result : "";
      if (variant === "light") {
        setPendingLight(dataUrl);
        setBrand((b) =>
          b ? { ...b, logo: { ...b.logo, light: dataUrl } } : b,
        );
      } else {
        setPendingDark(dataUrl);
        setBrand((b) =>
          b ? { ...b, logo: { ...b.logo, dark: dataUrl } } : b,
        );
      }
    };
    reader.readAsDataURL(file);
  };

  const save = async () => {
    if (!brand) return;
    setSaving(true);
    setSaveError(null);
    setSaveOk(false);
    try {
      const payload: {
        brand: BrandConfig;
        logoUploads?: { light?: string; dark?: string };
      } = { brand };
      if (pendingLight?.startsWith("data:")) {
        payload.logoUploads = {
          ...payload.logoUploads,
          light: pendingLight,
        };
      }
      if (pendingDark?.startsWith("data:")) {
        payload.logoUploads = {
          ...payload.logoUploads,
          dark: pendingDark,
        };
      }
      const res = await fetch("/api/brand", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
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
      const data = JSON.parse(raw) as { brand?: BrandConfig };
      if (data.brand) setBrand(data.brand);
      setPendingLight(null);
      setPendingDark(null);
      setSaveOk(true);
      setTimeout(() => setSaveOk(false), 4000);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  if (!brand) {
    return (
      <div className="text-sm text-zinc-500">
        {loadError ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-900">
            {loadError}
          </div>
        ) : (
          "Loading brand settings…"
        )}
      </div>
    );
  }

  const colorKeys: (keyof BrandConfig["colors"])[] = [
    "primary",
    "secondary",
    "accent",
    "neutral",
    "background",
    "text",
    "textLight",
  ];

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-zinc-900">Brand settings</h2>
          <p className="text-sm text-zinc-500">
            Updates save to your database and commit <code className="text-xs">content/brand.json</code>{" "}
            to your site repo (live after Vercel deploys).
          </p>
        </div>
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
      </div>

      {saveError && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {saveError}
        </div>
      )}
      {saveOk && (
        <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          Saved — <code className="text-xs">content/brand.json</code> is on GitHub. Your
          public site only updates after <strong>Vercel deploys</strong> that commit
          (often 1–2 minutes). Hard-refresh the live URL if styles look unchanged.
        </div>
      )}

      <div className="grid gap-8 lg:grid-cols-[1fr_minmax(280px,360px)]">
        <div className="space-y-10">
          <section>
            <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-zinc-500">
              Visual identity
            </h3>
            <div className="space-y-6">
              <div>
                <p className="mb-2 text-sm font-medium text-zinc-700">Logos</p>
                <p className="mb-3 text-xs leading-relaxed text-zinc-600">
                  The site header is usually on a <strong>light</strong> background and uses{" "}
                  <code className="rounded bg-zinc-100 px-0.5">logo.dark</code> (dark-coloured
                  mark). The second slot is for a <strong>dark</strong> header (primary style),
                  which uses <code className="rounded bg-zinc-100 px-0.5">logo.light</code>.
                </p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-zinc-700">
                      Default header (most visitors)
                    </label>
                    <p className="mb-1 text-[11px] text-zinc-500">
                      Dark logo on light background → saves as <code>logo.dark</code>
                    </p>
                    <input
                      type="file"
                      accept="image/svg+xml,image/png,image/jpeg,image/webp"
                      className="text-sm"
                      onChange={(e) =>
                        onLogoFile("dark", e.target.files?.[0] ?? null)
                      }
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-zinc-700">
                      Primary / dark header
                    </label>
                    <p className="mb-1 text-[11px] text-zinc-500">
                      Light logo on dark background → saves as <code>logo.light</code>
                    </p>
                    <input
                      type="file"
                      accept="image/svg+xml,image/png,image/jpeg,image/webp"
                      className="text-sm"
                      onChange={(e) =>
                        onLogoFile("light", e.target.files?.[0] ?? null)
                      }
                    />
                  </div>
                </div>
                <p className="mt-2 text-xs text-zinc-500">
                  Files commit to <code>public/images/brand-dark.*</code> and{" "}
                  <code>brand-light.*</code> in the site repo. Max ~1.5MB. For a{" "}
                  <strong>local</strong> template clone, run <code>git pull</code> after saving —
                  the admin only pushes to GitHub, not your disk.
                </p>
              </div>

              <div>
                <p className="mb-2 text-sm font-medium text-zinc-700">Colour palette</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  {colorKeys.map((key) => (
                    <div key={key} className="flex items-center gap-2">
                      <input
                        type="color"
                        value={brand.colors[key]}
                        onChange={(e) => setColor(key, e.target.value)}
                        className="h-10 w-14 cursor-pointer rounded border border-zinc-200"
                      />
                      <div className="flex-1">
                        <label className="text-xs capitalize text-zinc-500">{key}</label>
                        <input
                          type="text"
                          value={brand.colors[key]}
                          onChange={(e) => setColor(key, e.target.value)}
                          className="mt-0.5 w-full rounded border border-zinc-200 px-2 py-1 font-mono text-xs"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <p className="mb-2 text-sm font-medium text-zinc-700">Typography (Google Fonts)</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs text-zinc-500">Heading</label>
                    <select
                      value={brand.typography.headingFont}
                      onChange={(e) =>
                        setBrand((b) =>
                          b
                            ? {
                                ...b,
                                typography: {
                                  ...b.typography,
                                  headingFont: e.target.value,
                                },
                              }
                            : b,
                        )
                      }
                      className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm"
                    >
                      {fontOptions.map((f) => (
                        <option key={f} value={f}>
                          {f}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-zinc-500">Body</label>
                    <select
                      value={brand.typography.bodyFont}
                      onChange={(e) =>
                        setBrand((b) =>
                          b
                            ? {
                                ...b,
                                typography: {
                                  ...b.typography,
                                  bodyFont: e.target.value,
                                },
                              }
                            : b,
                        )
                      }
                      className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm"
                    >
                      {fontOptions.map((f) => (
                        <option key={`b-${f}`} value={f}>
                          {f}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs text-zinc-500">Base size (px)</label>
                    <input
                      type="number"
                      min={12}
                      max={22}
                      value={brand.typography.baseSize}
                      onChange={(e) =>
                        setBrand((b) =>
                          b
                            ? {
                                ...b,
                                typography: {
                                  ...b.typography,
                                  baseSize: Number(e.target.value) || 16,
                                },
                              }
                            : b,
                        )
                      }
                      className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-zinc-500">Scale</label>
                    <input
                      type="number"
                      step={0.05}
                      min={1}
                      max={1.5}
                      value={brand.typography.scale}
                      onChange={(e) =>
                        setBrand((b) =>
                          b
                            ? {
                                ...b,
                                typography: {
                                  ...b.typography,
                                  scale: Number(e.target.value) || 1.25,
                                },
                              }
                            : b,
                        )
                      }
                      className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm"
                    />
                  </div>
                </div>
              </div>

              <div>
                <p className="mb-2 text-sm font-medium text-zinc-700">Border radius</p>
                <div className="flex flex-wrap gap-2">
                  {RADIUS.map((r) => (
                    <button
                      key={r.value}
                      type="button"
                      onClick={() => updateBrand({ borderRadius: r.value })}
                      className={`flex flex-col items-center gap-1 rounded-lg border px-3 py-2 text-xs ${
                        brand.borderRadius === r.value
                          ? "border-zinc-900 bg-zinc-50"
                          : "border-zinc-200 bg-white hover:bg-zinc-50"
                      }`}
                    >
                      <span
                        className="h-8 w-12 bg-zinc-300"
                        style={{ borderRadius: r.px }}
                      />
                      {r.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="mb-2 text-sm font-medium text-zinc-700">Spacing feel</p>
                <div className="flex flex-wrap gap-2">
                  {SPACING.map((s) => (
                    <button
                      key={s.value}
                      type="button"
                      onClick={() => updateBrand({ spacing: s.value })}
                      className={`rounded-lg border px-4 py-2 text-sm ${
                        brand.spacing === s.value
                          ? "border-zinc-900 bg-zinc-50"
                          : "border-zinc-200 bg-white hover:bg-zinc-50"
                      }`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <section>
            <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-zinc-500">
              Voice and tone
            </h3>
            <div className="space-y-6">
              <div>
                <p className="mb-2 text-sm font-medium text-zinc-700">Tone</p>
                <div className="flex flex-wrap gap-2">
                  {TONE_OPTIONS.map((tone) => {
                    const active = brand.voice.tone.includes(tone);
                    return (
                      <button
                        key={tone}
                        type="button"
                        onClick={() => toggleTone(tone)}
                        className={`rounded-full border px-3 py-1 text-xs capitalize ${
                          active
                            ? "border-zinc-900 bg-zinc-900 text-white"
                            : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
                        }`}
                      >
                        {tone}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-zinc-700">
                  Industry
                </label>
                <input
                  type="text"
                  value={brand.voice.industry}
                  onChange={(e) =>
                    setBrand((b) =>
                      b
                        ? {
                            ...b,
                            voice: { ...b.voice, industry: e.target.value },
                          }
                        : b,
                    )
                  }
                  className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-zinc-700">
                  Target audience
                </label>
                <textarea
                  value={brand.voice.audience}
                  onChange={(e) =>
                    setBrand((b) =>
                      b
                        ? {
                            ...b,
                            voice: { ...b.voice, audience: e.target.value },
                          }
                        : b,
                    )
                  }
                  rows={3}
                  className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <p className="mb-2 text-sm font-medium text-zinc-700">
                  Key messages / value propositions
                </p>
                {brand.voice.valuePropositions.map((line, i) => (
                  <div key={i} className="mb-2 flex gap-2">
                    <input
                      type="text"
                      value={line}
                      onChange={(e) => {
                        const next = [...brand.voice.valuePropositions];
                        next[i] = e.target.value;
                        setBrand((b) =>
                          b ? { ...b, voice: { ...b.voice, valuePropositions: next } } : b,
                        );
                      }}
                      className="flex-1 rounded-lg border border-zinc-200 px-3 py-2 text-sm"
                    />
                    <button
                      type="button"
                      className="text-zinc-500 hover:text-red-600"
                      onClick={() => {
                        const next = brand.voice.valuePropositions.filter((_, j) => j !== i);
                        setBrand((b) =>
                          b ? { ...b, voice: { ...b.voice, valuePropositions: next } } : b,
                        );
                      }}
                    >
                      Remove
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() =>
                    setBrand((b) =>
                      b
                        ? {
                            ...b,
                            voice: {
                              ...b.voice,
                              valuePropositions: [...b.voice.valuePropositions, ""],
                            },
                          }
                        : b,
                    )
                  }
                  className="text-sm font-medium text-emerald-700 hover:underline"
                >
                  + Add message
                </button>
              </div>
              <TagField
                label="Words and phrases to use"
                tags={brand.voice.keywords}
                onChange={(keywords) =>
                  setBrand((b) => (b ? { ...b, voice: { ...b.voice, keywords } } : b))
                }
                placeholder="Type a phrase, Enter"
              />
              <TagField
                label="Words and phrases to avoid"
                tags={brand.voice.avoid}
                onChange={(avoid) =>
                  setBrand((b) => (b ? { ...b, voice: { ...b.voice, avoid } } : b))
                }
                placeholder="Type a phrase, Enter"
              />
            </div>
          </section>
        </div>

        <BrandPreview
          brand={brand}
          githubRepo={githubRepo}
          pendingLight={pendingLight}
          pendingDark={pendingDark}
        />
      </div>
    </div>
  );
}
