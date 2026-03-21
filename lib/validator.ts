import Ajv, { type ErrorObject } from "ajv";
import addFormats from "ajv-formats";
import type { ComponentManifestEntry } from "@/lib/ai/types";
import {
  brandDocumentSchema,
  navigationDocumentSchema,
  pageDocumentSchema,
} from "@/lib/schemas/site-content";

const ajv = new Ajv({ allErrors: true, strict: false, allowUnionTypes: true });
addFormats(ajv);

const validatePage = ajv.compile(pageDocumentSchema);
const validateBrand = ajv.compile(brandDocumentSchema);
const validateNavigation = ajv.compile(navigationDocumentSchema);

export type ValidationKind = "page" | "brand" | "navigation" | "section";

export class ValidationError extends Error {
  constructor(
    message: string,
    public readonly ajvErrors: ErrorObject[] | null | undefined,
    public readonly kind: ValidationKind,
  ) {
    super(message);
    this.name = "ValidationError";
  }
}

function formatAjvErrors(errors: ErrorObject[] | null | undefined): string {
  if (!errors?.length) return "Unknown schema validation error";
  return errors
    .map((e) => {
      const path = e.instancePath || "(root)";
      return `${path}: ${e.message ?? "invalid"} (${e.keyword})`;
    })
    .join("\n");
}

function manifestMap(manifest: ComponentManifestEntry[]) {
  const m = new Map<string, ComponentManifestEntry>();
  for (const entry of manifest) {
    m.set(entry.name, entry);
  }
  return m;
}

/**
 * Validates a single document by kind (PROJECT.md — used by builds and the AI engine).
 * For `section`, pass `componentType` and `manifest` so `content` can be checked against `contentSchema`.
 */
export function validate(
  data: unknown,
  kind: ValidationKind,
  context?: {
    componentType?: string;
    manifest?: ComponentManifestEntry[];
  },
): void {
  if (kind === "page") {
    if (!validatePage(data)) {
      throw new ValidationError(
        `Page validation failed:\n${formatAjvErrors(validatePage.errors)}`,
        validatePage.errors,
        "page",
      );
    }
    return;
  }
  if (kind === "brand") {
    if (!validateBrand(data)) {
      throw new ValidationError(
        `Brand validation failed:\n${formatAjvErrors(validateBrand.errors)}`,
        validateBrand.errors,
        "brand",
      );
    }
    return;
  }
  if (kind === "navigation") {
    if (!validateNavigation(data)) {
      throw new ValidationError(
        `Navigation validation failed:\n${formatAjvErrors(validateNavigation.errors)}`,
        validateNavigation.errors,
        "navigation",
      );
    }
    return;
  }
  if (kind === "section") {
    const componentType = context?.componentType;
    const manifest = context?.manifest;
    if (!componentType || !manifest) {
      throw new ValidationError(
        "Section validation requires componentType and manifest in context",
        [],
        "section",
      );
    }
    const entry = manifestMap(manifest).get(componentType);
    if (!entry) {
      throw new ValidationError(
        `Unknown component "${componentType}" — not present in manifest`,
        [],
        "section",
      );
    }
    let validateContent: ReturnType<typeof ajv.compile>;
    try {
      validateContent = ajv.compile(entry.contentSchema);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new ValidationError(
        `Invalid contentSchema for component "${componentType}": ${msg}`,
        [],
        "section",
      );
    }
    if (!validateContent(data)) {
      throw new ValidationError(
        `Section content for "${componentType}" failed:\n${formatAjvErrors(validateContent.errors)}`,
        validateContent.errors,
        "section",
      );
    }
    return;
  }
}

export function normalizeContentPath(file: string): string {
  return file.trim().replace(/^\.?\//, "").replace(/\\/g, "/");
}

function classifyPath(
  path: string,
): "page" | "brand" | "navigation" | "unsupported" {
  const n = normalizeContentPath(path);
  if (n === "content/brand.json" || n.endsWith("/content/brand.json")) {
    return "brand";
  }
  if (
    n === "content/navigation.json" ||
    n.endsWith("/content/navigation.json")
  ) {
    return "navigation";
  }
  if (
    (n.startsWith("content/pages/") && n.endsWith(".json")) ||
    /\/content\/pages\/[^/]+\.json$/.test(n)
  ) {
    return "page";
  }
  return "unsupported";
}

/**
 * Validates one AI change item: full page / brand / nav documents, plus per-section content against the manifest.
 */
export function validateChangeFile(
  file: string,
  content: unknown,
  manifest: ComponentManifestEntry[],
): void {
  const kind = classifyPath(file);
  if (kind === "unsupported") {
    throw new ValidationError(
      `Cannot validate file "${file}" — supported paths: content/brand.json, content/navigation.json, content/pages/*.json`,
      [],
      "page",
    );
  }
  if (kind === "brand") {
    validate(content, "brand");
    return;
  }
  if (kind === "navigation") {
    validate(content, "navigation");
    return;
  }
  validate(content, "page");
  const page = content as { sections?: unknown[] };
  if (!Array.isArray(page.sections)) return;
  for (let i = 0; i < page.sections.length; i++) {
    const section = page.sections[i] as Record<string, unknown> | null;
    if (!section || typeof section !== "object") {
      throw new ValidationError(
        `Page "${file}" sections[${i}] must be an object`,
        [],
        "page",
      );
    }
    const component = section.component;
    if (typeof component !== "string") {
      throw new ValidationError(
        `Page "${file}" sections[${i}].component must be a string`,
        [],
        "page",
      );
    }
    validate(section.content, "section", {
      componentType: component,
      manifest,
    });
  }
}

export type ValidatedAiEnvelope = {
  changes: { file: string; content: unknown }[];
  summary: string;
};

/**
 * Validates the LLM envelope shape and each changed file (including section content via manifest).
 */
export function validateAiEnvelope(
  raw: unknown,
  manifest: ComponentManifestEntry[],
): ValidatedAiEnvelope {
  if (!raw || typeof raw !== "object") {
    throw new ValidationError(
      "AI output must be a JSON object",
      [],
      "page",
    );
  }
  const o = raw as Record<string, unknown>;
  if (!Array.isArray(o.changes)) {
    throw new ValidationError(
      'AI output must include a "changes" array',
      [],
      "page",
    );
  }
  if (typeof o.summary !== "string") {
    throw new ValidationError(
      'AI output must include a string "summary"',
      [],
      "page",
    );
  }
  const seen = new Set<string>();
  for (let i = 0; i < o.changes.length; i++) {
    const ch = o.changes[i];
    if (!ch || typeof ch !== "object") {
      throw new ValidationError(`changes[${i}] must be an object`, [], "page");
    }
    const c = ch as Record<string, unknown>;
    if (typeof c.file !== "string" || !c.file.trim()) {
      throw new ValidationError(
        `changes[${i}].file must be a non-empty string`,
        [],
        "page",
      );
    }
    if (!c.content || typeof c.content !== "object" || Array.isArray(c.content)) {
      throw new ValidationError(
        `changes[${i}].content must be a JSON object`,
        [],
        "page",
      );
    }
    const norm = normalizeContentPath(c.file);
    if (seen.has(norm)) {
      throw new ValidationError(
        `Duplicate file in changes: "${c.file}"`,
        [],
        "page",
      );
    }
    seen.add(norm);
    validateChangeFile(c.file, c.content, manifest);
  }
  return {
    changes: o.changes as { file: string; content: unknown }[],
    summary: o.summary,
  };
}
