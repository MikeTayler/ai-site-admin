import type { BrandConfig } from "@/lib/brand/types";

export function defaultBrandConfig(): BrandConfig {
  return {
    colors: {
      primary: "#4A6741",
      secondary: "#8B7355",
      accent: "#D4A574",
      neutral: "#F5F0EB",
      background: "#FFFFFF",
      text: "#2D2D2D",
      textLight: "#6B6B6B",
    },
    typography: {
      headingFont: "Playfair Display",
      bodyFont: "Inter",
      baseSize: 16,
      scale: 1.25,
    },
    borderRadius: "medium",
    spacing: "relaxed",
    logo: {
      light: "/images/logo-light.svg",
      dark: "/images/logo-dark.svg",
    },
    voice: {
      tone: ["warm", "professional"],
      industry: "",
      audience: "",
      valuePropositions: [],
      keywords: [],
      avoid: [],
    },
  };
}

/** Merge unknown JSON from DB into a full BrandConfig. */
export function normalizeBrandConfig(raw: unknown): BrandConfig {
  const d = defaultBrandConfig();
  if (!raw || typeof raw !== "object" || raw === null) return d;
  const b = raw as Record<string, unknown>;

  const colors =
    b.colors && typeof b.colors === "object" && b.colors !== null
      ? (b.colors as Record<string, unknown>)
      : {};
  const typography =
    b.typography && typeof b.typography === "object" && b.typography !== null
      ? (b.typography as Record<string, unknown>)
      : {};
  const logo =
    b.logo && typeof b.logo === "object" && b.logo !== null
      ? (b.logo as Record<string, unknown>)
      : {};
  const voice =
    b.voice && typeof b.voice === "object" && b.voice !== null
      ? (b.voice as Record<string, unknown>)
      : {};

  const str = (v: unknown, fallback: string) =>
    typeof v === "string" ? v : fallback;
  const num = (v: unknown, fallback: number) =>
    typeof v === "number" && !Number.isNaN(v) ? v : fallback;
  const strArr = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

  const borderRadius = str(b.borderRadius, d.borderRadius);
  const spacing = str(b.spacing, d.spacing);

  return {
    colors: {
      primary: str(colors.primary, d.colors.primary),
      secondary: str(colors.secondary, d.colors.secondary),
      accent: str(colors.accent, d.colors.accent),
      neutral: str(colors.neutral, d.colors.neutral),
      background: str(colors.background, d.colors.background),
      text: str(colors.text, d.colors.text),
      textLight: str(colors.textLight, d.colors.textLight),
    },
    typography: {
      headingFont: str(typography.headingFont, d.typography.headingFont),
      bodyFont: str(typography.bodyFont, d.typography.bodyFont),
      baseSize: num(typography.baseSize, d.typography.baseSize),
      scale: num(typography.scale, d.typography.scale),
    },
    borderRadius:
      borderRadius === "none" ||
      borderRadius === "small" ||
      borderRadius === "medium" ||
      borderRadius === "large"
        ? borderRadius
        : d.borderRadius,
    spacing:
      spacing === "compact" ||
      spacing === "normal" ||
      spacing === "relaxed"
        ? spacing
        : d.spacing,
    logo: {
      light: str(logo.light, d.logo.light),
      dark: str(logo.dark, d.logo.dark),
    },
    voice: {
      tone: Array.isArray(voice.tone) ? strArr(voice.tone) : [...d.voice.tone],
      industry: str(voice.industry, d.voice.industry),
      audience: str(voice.audience, d.voice.audience),
      valuePropositions: strArr(voice.valuePropositions),
      keywords: strArr(voice.keywords),
      avoid: strArr(voice.avoid),
    },
  };
}
