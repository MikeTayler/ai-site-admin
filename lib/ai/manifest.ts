/**
 * Server-only: uses `fs`. Import only from API routes, Server Actions, or `lib/ai/engine` (Node).
 */
import { existsSync } from "fs";
import fs from "fs/promises";
import path from "path";
import type { ComponentManifestEntry } from "@/lib/ai/types";

type JsonSchema = Record<string, unknown>;

let cache: {
  signature: string;
  markdown: string;
  entries: ComponentManifestEntry[];
  schemaPaths: string[];
} | null = null;

/**
 * Resolves the `ai-site-components` repo root (or published package root).
 * Set `COMPONENT_LIBRARY_ROOT` when the library is not next to this app or under `node_modules`.
 */
export function resolveComponentLibraryRoot(): string {
  const env = process.env.COMPONENT_LIBRARY_ROOT?.trim();
  if (env) return path.resolve(env);

  const cwd = process.cwd();
  /** Shipped with `ai-site-admin` so Vercel/serverless has schemas without a sibling repo. */
  const bundled = path.join(cwd, "data", "component-schemas");
  const bundledComponents = path.join(bundled, "src", "components");
  const fromNodeModules = path.resolve(
    cwd,
    "node_modules",
    "@ai-site",
    "components",
  );
  const sibling = path.resolve(cwd, "..", "ai-site-components");

  if (existsSync(bundledComponents)) return bundled;
  if (existsSync(fromNodeModules)) return fromNodeModules;
  if (existsSync(sibling)) return sibling;

  throw new Error(
    "Component library not found. Expected data/component-schemas/src/components (bundled), node_modules/@ai-site/components, ../ai-site-components, or set COMPONENT_LIBRARY_ROOT.",
  );
}

/**
 * Schemas live under `src/components` (recursive): each `*.schema.json` (PROJECT.md: per-component JSON Schemas).
 */
export function resolveComponentSchemasDirectory(libraryRoot?: string): string {
  const root = libraryRoot ?? resolveComponentLibraryRoot();
  const components = path.join(root, "src", "components");
  if (existsSync(components)) return components;

  const flatSchemas = path.join(root, "schemas");
  if (existsSync(flatSchemas)) return flatSchemas;

  throw new Error(
    `No component schemas directory found under ${root}. Expected src/components or schemas.`,
  );
}

async function walkSchemaFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(current: string) {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const e of entries) {
      const p = path.join(current, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.name.endsWith(".schema.json")) out.push(p);
    }
  }
  await walk(dir);
  return out.sort();
}

async function computeSignature(paths: string[]): Promise<string> {
  const parts = await Promise.all(
    paths.map(async (f) => {
      const s = await fs.stat(f);
      return `${f}:${s.mtimeMs}:${s.size}`;
    }),
  );
  return parts.join("|");
}

function asObj(v: unknown): JsonSchema | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as JsonSchema)
    : null;
}

/** One-line type hint for token-efficient prompts. */
function typeHint(s: JsonSchema, depth: number): string {
  if (depth > 3) return "…";
  const t = s.type;
  if (Array.isArray(s.enum)) return (s.enum as unknown[]).map(String).join("|");
  if (t === "string") return "str";
  if (t === "number" || t === "integer") return "num";
  if (t === "boolean") return "bool";
  if (t === "array") {
    const items = asObj(s.items);
    return items ? `arr<${typeHint(items, depth + 1)}>` : "arr";
  }
  if (t === "object") {
    const props = asObj(s.properties);
    if (!props || Object.keys(props).length === 0) return "obj";
    const req = new Set(
      Array.isArray(s.required) ? (s.required as string[]) : [],
    );
    const inner = Object.keys(props)
      .map((k) => {
        const child = asObj(props[k]);
        const mark = req.has(k) ? "*" : "?";
        const hint = child ? typeHint(child, depth + 1) : "?";
        return `${k}${mark}:${hint}`;
      })
      .join(",");
    return `{${inner}}`;
  }
  return "?";
}

function summarizeObjectProps(
  objSchema: JsonSchema | null,
  depth: number,
): string {
  if (!objSchema || depth > 2) return "";
  const props = asObj(objSchema.properties);
  const isObj =
    objSchema.type === "object" ||
    (!!props && Object.keys(props).length > 0);
  if (!isObj) return typeHint(objSchema, 0);
  if (!props) return "obj";
  const req = new Set(
    Array.isArray(objSchema.required)
      ? (objSchema.required as string[])
      : [],
  );
  return Object.keys(props)
    .map((k) => {
      const child = asObj(props[k]);
      const mark = req.has(k) ? "*" : "?";
      const hint = child ? typeHint(child, depth + 1) : "?";
      return `${k}${mark}:${hint}`;
    })
    .join("; ");
}

function rootPropLine(schema: JsonSchema): string {
  const props = asObj(schema.properties);
  if (!props) return "";
  const req = new Set(
    Array.isArray(schema.required) ? (schema.required as string[]) : [],
  );
  const keys = Object.keys(props);
  const parts = keys.map((k) => `${k}${req.has(k) ? "*" : "?"}`);
  return parts.join(", ");
}

function extractVariants(schema: JsonSchema): string[] {
  const variant = asObj(schema.properties)?.variant;
  const v = asObj(variant);
  if (v && Array.isArray(v.enum)) return v.enum as string[];
  return [];
}

function extractContentSchema(
  schema: JsonSchema,
): Record<string, unknown> | null {
  const props = asObj(schema.properties)?.content;
  const c = asObj(props);
  if (!c) return null;
  return JSON.parse(JSON.stringify(c)) as Record<string, unknown>;
}

function componentNameFromPath(filePath: string, schema: JsonSchema): string {
  const title = typeof schema.title === "string" ? schema.title.trim() : "";
  if (title) return title;
  const base = path.basename(filePath, ".schema.json");
  return base;
}

function buildMarkdownDoc(
  filePath: string,
  schema: JsonSchema,
): { name: string; block: string } {
  const name = componentNameFromPath(filePath, schema);
  const desc =
    typeof schema.description === "string" ? schema.description.trim() : "";
  const variants = extractVariants(schema);
  const vLine =
    variants.length > 0
      ? `Variants: ${variants.join(" | ")}`
      : "Variants: (see variant prop in schema)";

  const rootLine = rootPropLine(schema);
  const contentProp = asObj(asObj(schema.properties)?.content);
  const settingsProp = asObj(asObj(schema.properties)?.settings);

  const contentLine = summarizeObjectProps(contentProp, 0);
  const settingsLine = summarizeObjectProps(settingsProp, 0);

  const lines: string[] = [
    `### ${name}`,
    desc ? `${desc}` : "",
    vLine,
    `Props: ${rootLine || "(see schema)"}`,
    contentLine ? `content: ${contentLine}` : "",
    settingsLine ? `settings: ${settingsLine}` : "",
  ].filter(Boolean);

  const block = lines.join("\n");
  return { name, block };
}

export type BuiltComponentManifest = {
  /** Compact, human-readable doc for prompts and internal use */
  markdown: string;
  /** Structured entries for `runAiEngine` / Ajv (`content` sub-schema only) */
  entries: ComponentManifestEntry[];
  schemaPaths: string[];
};

/**
 * Reads all `*.schema.json` files under the component library, builds manifest entries + markdown.
 * Does not use the in-memory cache (see {@link getCachedComponentManifest}).
 */
export async function buildComponentManifest(
  libraryRoot?: string,
): Promise<BuiltComponentManifest> {
  const schemasDir = resolveComponentSchemasDirectory(libraryRoot);
  const files = await walkSchemaFiles(schemasDir);
  if (files.length === 0) {
    throw new Error(`No *.schema.json files found under ${schemasDir}`);
  }

  const parsed = await Promise.all(
    files.map(async (file) => {
      const raw = await fs.readFile(file, "utf8");
      const schema = JSON.parse(raw) as JsonSchema;
      const name = componentNameFromPath(file, schema);
      const variants = extractVariants(schema);
      const contentSchema = extractContentSchema(schema);
      if (!contentSchema) {
        throw new Error(`Schema ${file} has no properties.content object`);
      }
      const entry: ComponentManifestEntry = { name, variants, contentSchema };
      const { block } = buildMarkdownDoc(file, schema);
      return { name, file, entry, block };
    }),
  );

  parsed.sort((a, b) => a.name.localeCompare(b.name));

  const markdown = [
    "# Component library manifest",
    "",
    "Auto-generated from JSON Schema files in the component library. Registry keys = page JSON `section.component`.",
    "",
    "---",
    "",
    parsed.map((p) => p.block).join("\n\n---\n\n"),
    "",
  ].join("\n");

  return {
    markdown,
    entries: parsed.map((p) => p.entry),
    schemaPaths: parsed.map((p) => p.file),
  };
}

/**
 * Cached manifest: rebuilt only when any schema file path, mtime, or size changes.
 */
export async function getCachedComponentManifest(
  libraryRoot?: string,
): Promise<BuiltComponentManifest> {
  const schemasDir = resolveComponentSchemasDirectory(libraryRoot);
  const files = await walkSchemaFiles(schemasDir);
  const signature = await computeSignature(files);

  if (cache && cache.signature === signature) {
    return {
      markdown: cache.markdown,
      entries: cache.entries,
      schemaPaths: cache.schemaPaths,
    };
  }

  const built = await buildComponentManifest(libraryRoot);
  cache = {
    signature,
    markdown: built.markdown,
    entries: built.entries,
    schemaPaths: built.schemaPaths,
  };
  return built;
}

export function clearComponentManifestCache(): void {
  cache = null;
}
