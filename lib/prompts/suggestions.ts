/**
 * Context-aware prompt suggestions for the chat UI (phase 4.4).
 * Pure functions — safe to call from API routes after loading site state.
 */

export type RecentChangeSummary = {
  summary: string;
  files: string[];
  createdAt: string;
};

export type PromptSuggestionContext = {
  /** No recorded pipeline changes yet — favour onboarding-style prompts. */
  isNewSite: boolean;
  /** PascalCase component keys present in any `content/pages/*.json` section. */
  presentComponents: string[];
  recentChanges: RecentChangeSummary[];
  /** Increments after each chat interaction to rotate which four suggestions appear. */
  interactionRound: number;
  conversationId: string | null;
  now: Date;
};

const ONBOARDING = [
  "Help me set up my website",
  "I want to describe my business",
  "Help me choose brand colours",
] as const;

const ACTIVE_CORE = [
  "Update my homepage headline",
  "Change the call-to-action text",
] as const;

function dedupe(strings: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of strings) {
    const t = s.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/** Pull `component` keys from all page JSON under `content/pages/`. */
export function extractPresentComponents(
  siteState: Record<string, unknown>,
): string[] {
  const set = new Set<string>();
  for (const [path, data] of Object.entries(siteState)) {
    if (!path.startsWith("content/pages/") || !path.endsWith(".json")) continue;
    if (!data || typeof data !== "object" || data === null) continue;
    const sections = (data as { sections?: unknown }).sections;
    if (!Array.isArray(sections)) continue;
    for (const sec of sections) {
      if (!sec || typeof sec !== "object") continue;
      const c = (sec as { component?: unknown }).component;
      if (typeof c === "string" && c.length > 0) set.add(c);
    }
  }
  return Array.from(set).sort();
}

function hasComponent(present: string[], name: string): boolean {
  return present.includes(name);
}

function gapPrompts(present: string[]): string[] {
  const out: string[] = [];
  if (!hasComponent(present, "Testimonials")) {
    out.push("Add a testimonials section");
  }
  if (!hasComponent(present, "FAQAccordion")) {
    out.push("Add an FAQ section to the site");
  }
  if (!hasComponent(present, "TeamGrid")) {
    out.push("Add a team section with our staff");
  }
  if (!hasComponent(present, "CTABanner")) {
    out.push("Add a call-to-action banner on key pages");
  }
  if (!hasComponent(present, "FeatureGrid")) {
    out.push("Add a features section highlighting what we offer");
  }
  return out;
}

/** Seasonal / calendar-aware nudges (Northern Hemisphere–oriented defaults). */
export function getSeasonalPrompts(now: Date): string[] {
  const month = now.getMonth();
  const day = now.getDate();
  const out: string[] = [];

  if (month === 11 && day >= 10) {
    out.push("Add a short holiday message or hours note on the homepage");
  }
  if (month === 11 || month === 0) {
    out.push("Refresh copy for the new year — goals, hours, or offers");
  }
  if (month >= 5 && month <= 7) {
    out.push("Highlight summer hours or seasonal services on the homepage");
  }
  if (month >= 2 && month <= 4) {
    out.push("Tune messaging for spring — events, promos, or fresh imagery");
  }
  if (month === 9) {
    out.push("Add a fall-themed update to the homepage or announcements");
  }

  return dedupe(out);
}

function postChangePrompts(
  last: RecentChangeSummary | undefined,
  present: string[],
): string[] {
  if (!last) return [];
  const files = last.files.join(" ").toLowerCase();
  const summary = last.summary.toLowerCase();
  const out: string[] = [];

  if (files.includes("home") || summary.includes("hero")) {
    out.push("Review the about page so it matches the updated homepage");
    out.push("Show me what the about page looks like next");
    out.push("Check navigation labels after the homepage changes");
  }
  if (files.includes("about")) {
    out.push("Align the homepage headline with the about page story");
  }
  if (files.includes("contact")) {
    out.push("Make sure the contact page reflects the latest site changes");
  }

  out.push("Make the tone more casual across the site");
  out.push("Show me ideas for improving the contact page");

  if (hasComponent(present, "TeamGrid")) {
    out.push("Add another team member to the team section");
  }

  return dedupe(out);
}

function simpleHash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

/** Deterministic shuffle so the same round + conversation shows stable chips until the next interaction. */
function seededPick<T>(items: T[], seed: string, count: number): T[] {
  if (items.length <= count) return [...items];
  const arr = [...items];
  let state = simpleHash(seed);
  const out: T[] = [];
  while (out.length < count && arr.length > 0) {
    state = (state * 1103515245 + 12345) >>> 0;
    const idx = state % arr.length;
    out.push(arr.splice(idx, 1)[0]!);
  }
  return out;
}

function buildCandidatePool(ctx: PromptSuggestionContext): string[] {
  const { isNewSite, presentComponents, recentChanges, now } = ctx;
  const pool: string[] = [];

  if (isNewSite) {
    pool.push(...ONBOARDING);
  } else {
    pool.push(...ACTIVE_CORE);
    pool.push(...gapPrompts(presentComponents));
  }

  pool.push(...getSeasonalPrompts(now));
  pool.push(...postChangePrompts(recentChanges[0], presentComponents));

  if (!isNewSite && hasComponent(presentComponents, "Testimonials")) {
    pool.push("Add another testimonial or refresh quotes");
  }

  return dedupe(pool);
}

const FALLBACK_ACTIVE = [
  "Update my homepage headline",
  "Add a testimonials section",
  "Change the call-to-action text",
  "Review copy on the about page",
];

/**
 * Returns 3–4 suggestion strings for the current context.
 * Rotates with `interactionRound` and `conversationId` so chips refresh after each interaction.
 */
export function getPromptSuggestions(ctx: PromptSuggestionContext): string[] {
  const pool = buildCandidatePool(ctx);
  const seed = `${ctx.conversationId ?? "none"}:${ctx.interactionRound}`;
  const target = 4;
  let picked = seededPick(pool, seed, target);

  if (picked.length < 3) {
    const extra = seededPick(
      dedupe([...FALLBACK_ACTIVE, ...pool]),
      `${seed}:fill`,
      target - picked.length,
    );
    picked = dedupe([...picked, ...extra]);
  }

  return picked.slice(0, target);
}
