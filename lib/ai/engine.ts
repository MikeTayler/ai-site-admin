import OpenAI from "openai";
import type { AiEngineInput, AiEngineResult, ComponentManifestEntry } from "@/lib/ai/types";
import { ValidationError, validateAiEnvelope } from "@/lib/validator";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

const MAX_ATTEMPTS = 3;

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v?.trim()) {
    throw new Error(`${name} is not set`);
  }
  return v.trim();
}

function getOpenRouterClient(): OpenAI {
  return new OpenAI({
    apiKey: requireEnv("OPENROUTER_API_KEY"),
    baseURL: OPENROUTER_BASE_URL,
  });
}

function buildSystemPrompt(manifest: ComponentManifestEntry[]): string {
  const manifestJson = JSON.stringify(manifest, null, 2);
  return `You are a website content manager. You modify website content by outputting valid JSON only.

## Your role
- You receive natural-language instructions and must respond with a single JSON object that describes file-level updates to the site.
- You never invent component type names: every section's "component" field MUST match a name from the component manifest below.
- You must satisfy every required field in the JSON Schemas for components you touch.
- When you do not need to change a section, omit it from the update or repeat it unchanged as it appears in the current site state — do not delete or rewrite unrelated sections unless the user asked you to.

## Component manifest (names, variants, and content JSON Schemas)
Each entry has:
- "name": registry key used in page JSON (e.g. "Hero")
- "variants": allowed variant strings for that component
- "contentSchema": JSON Schema (draft-07) for the section's "content" object

${manifestJson}

## Output format (required)
Respond with ONLY a JSON object (no markdown fences, no commentary) with exactly this shape:
{
  "changes": [
    { "file": "content/pages/home.json", "content": { } },
    { "file": "content/brand.json", "content": { } }
  ],
  "summary": "One or two sentences describing what you changed for the site owner."
}

- "file" must be a repo-relative path using forward slashes (e.g. content/pages/about.json).
- "content" must be the full parsed JSON document for that file (object), not a string.
- Only include files you are actually changing.
- "summary" must be a non-empty string.

## Rules
1. Never use a component name that does not appear in the manifest.
2. Every section you output in a page must include "id", "component", "variant", "content", and "settings".
3. Each section's "content" must validate against the manifest contentSchema for that component.
4. Preserve existing sections that are not being modified (copy them forward unchanged unless the user asked to remove or replace them).
5. Brand copy must follow the brand voice settings when present in the brand configuration.`;
}

function buildUserMessage(input: AiEngineInput, validationFeedback?: string): string {
  const { prompt, siteState, brandConfig } = input;
  let text = `## User request
${prompt}

## Brand configuration (including voice / tone — follow this for copy)
${JSON.stringify(brandConfig, null, 2)}

## Current site state (all content JSON files)
${JSON.stringify(siteState, null, 2)}`;

  if (validationFeedback) {
    text += `

## Validation errors from your previous response
The output failed schema validation. Fix the issues below and return ONLY the corrected JSON object with the same required shape { "changes", "summary" }.

${validationFeedback}`;
  }

  return text;
}

/** Extracts a single JSON object from model output (plain JSON or fenced \`\`\`json blocks). */
function extractJsonObjectFromText(raw: string): unknown {
  const trimmed = raw.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)```/m.exec(trimmed);
  const candidate = fence ? fence[1].trim() : trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end < start) {
    throw new Error("Model output did not contain a JSON object");
  }
  const jsonSlice = candidate.slice(start, end + 1);
  return JSON.parse(jsonSlice) as unknown;
}

function formatValidationFailure(err: unknown): string {
  if (err instanceof ValidationError) {
    return err.message;
  }
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

/**
 * Calls OpenRouter (OpenAI-compatible chat completions), parses JSON, validates against manifest/schemas,
 * and retries up to 2 additional times when validation fails (3 attempts total).
 */
export async function runAiEngine(input: AiEngineInput): Promise<AiEngineResult> {
  const model = requireEnv("OPENROUTER_MODEL");
  const client = getOpenRouterClient();
  const systemPrompt = buildSystemPrompt(input.manifest);

  let lastFailure: string | undefined;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const userMessage = buildUserMessage(
      input,
      attempt > 0 ? lastFailure : undefined,
    );

    const completion = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      temperature: 0.25,
    });

    const rawText = completion.choices[0]?.message?.content;
    if (!rawText?.trim()) {
      lastFailure = "Model returned an empty response.";
      if (attempt === MAX_ATTEMPTS - 1) {
        throw new Error(
          `AI engine failed after ${MAX_ATTEMPTS} attempts: ${lastFailure}`,
        );
      }
      continue;
    }

    let parsed: unknown;
    try {
      parsed = extractJsonObjectFromText(rawText);
    } catch (e) {
      lastFailure = `Failed to parse JSON from model output: ${formatValidationFailure(e)}`;
      if (attempt === MAX_ATTEMPTS - 1) {
        throw new Error(
          `AI engine failed after ${MAX_ATTEMPTS} attempts: ${lastFailure}`,
        );
      }
      continue;
    }

    try {
      const validated = validateAiEnvelope(parsed, input.manifest);
      return validated;
    } catch (e) {
      lastFailure = formatValidationFailure(e);
      if (attempt === MAX_ATTEMPTS - 1) {
        throw new Error(
          `AI engine failed after ${MAX_ATTEMPTS} attempts. Last validation error:\n${lastFailure}`,
        );
      }
    }
  }

  throw new Error("AI engine: unexpected end of retry loop");
}
