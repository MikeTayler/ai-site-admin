/**
 * Describes one registry component for the AI engine (schemas + variants).
 */
export type ComponentManifestEntry = {
  /** Registry key, e.g. "Hero", "FeatureGrid" */
  name: string;
  /** Allowed variant names (kebab-case or project convention). */
  variants: string[];
  /** JSON Schema (draft-07) for the section `content` object */
  contentSchema: Record<string, unknown>;
};

/**
 * All site JSON files keyed by repo-relative path, e.g. `"content/pages/home.json"`.
 */
export type SiteState = Record<string, unknown>;

export type AiEngineInput = {
  prompt: string;
  siteState: SiteState;
  /** Brand JSON (colours, typography, voice, etc.) — may duplicate `siteState["content/brand.json"]`. */
  brandConfig: unknown;
  manifest: ComponentManifestEntry[];
};

export type AiEngineChange = {
  file: string;
  content: unknown;
};

export type AiEngineResult = {
  changes: AiEngineChange[];
  summary: string;
};
