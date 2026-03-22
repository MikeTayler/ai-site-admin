/**
 * Brand config for `content/brand.json` (ThemeProvider + AI engine).
 * @see PROJECT.md — Brand Config Structure
 */

export const TONE_OPTIONS = [
  "professional",
  "casual",
  "playful",
  "authoritative",
  "warm",
  "technical",
  "friendly",
  "luxurious",
] as const;

export type ToneOption = (typeof TONE_OPTIONS)[number];

export type BorderRadius = "none" | "small" | "medium" | "large";
export type SpacingFeel = "compact" | "normal" | "relaxed";

export type BrandColors = {
  primary: string;
  secondary: string;
  accent: string;
  neutral: string;
  background: string;
  text: string;
  textLight: string;
};

export type BrandTypography = {
  headingFont: string;
  bodyFont: string;
  baseSize: number;
  scale: number;
};

export type BrandLogo = {
  light: string;
  dark: string;
};

export type BrandVoice = {
  tone: string[];
  industry: string;
  audience: string;
  /** Key messages / value propositions */
  valuePropositions: string[];
  /** Words and phrases to use */
  keywords: string[];
  /** Words and phrases to avoid */
  avoid: string[];
};

export type BrandConfig = {
  colors: BrandColors;
  typography: BrandTypography;
  borderRadius: BorderRadius;
  spacing: SpacingFeel;
  logo: BrandLogo;
  voice: BrandVoice;
};
