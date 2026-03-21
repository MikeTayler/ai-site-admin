/**
 * Baseline JSON Schemas (draft-07) for site files.
 * Section `content` is validated per-component via the manifest `contentSchema`.
 */

export const pageDocumentSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  type: "object",
  additionalProperties: true,
  required: ["slug", "title", "description", "sections"],
  properties: {
    slug: { type: "string" },
    title: { type: "string" },
    description: { type: "string" },
    sections: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: true,
        required: ["id", "component", "variant", "content", "settings"],
        properties: {
          id: { type: "string" },
          component: { type: "string" },
          variant: { type: "string" },
          content: { type: "object" },
          settings: { type: "object" },
        },
      },
    },
  },
} as const;

export const brandDocumentSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  type: "object",
  additionalProperties: true,
  required: ["colors", "typography"],
  properties: {
    colors: { type: "object" },
    typography: { type: "object" },
    borderRadius: { type: "string" },
    spacing: { type: "string" },
    logo: { type: "object" },
    voice: { type: "object" },
  },
} as const;

export const navigationDocumentSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  type: "object",
  additionalProperties: true,
  properties: {
    title: { type: "string" },
    items: { type: "array" },
    cta: { type: "object" },
    footer: { type: "object" },
  },
} as const;
