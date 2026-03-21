# AI Site Builder — Project Overview

## What This Is

An AI-native website platform for small to medium businesses. Websites are designed, built, deployed, and content-managed entirely through natural language prompts. There is no traditional CMS, no database on client sites, and no backend. The Git repository is the CMS. Content lives as JSON files, components come from a shared library, and an AI management app orchestrates everything.

## Architecture — Three Repositories

### 1. `ai-site-components` (this repo)

A shared, versioned React component library published as a private npm package. All client sites consume this library. It contains:

- **UI Components** — hero sections, feature grids, CTAs, testimonials, headers, footers, etc. Each component supports multiple variants and is fully themeable via CSS custom properties.
- **Theme System** — a ThemeProvider that accepts a BrandConfig JSON object and injects CSS custom properties. Every component references theme variables, never hard-coded values.
- **Component Registry** — a two-tier lookup that maps component type names (as they appear in JSON config) to React components. Local/custom components take priority over shared ones, enabling per-site overrides without architectural changes.
- **JSON Schemas** — validation schemas for every component's props. Used by the AI engine to validate output before deployment.
- **Storybook** — visual testing and documentation for every component and variant. Deployed as a static site.

### 2. `ai-site-template`

A Next.js application deployed to Vercel. This is the template that gets forked for each new client. It:

- Reads JSON content files from `/content/pages/`, `/content/brand.json`, `/content/navigation.json`
- Resolves components from the shared library via the registry
- Renders pages using a dynamic catch-all route
- Has no database, no authentication, no backend logic
- Deploys as a fully static site via Vercel

### 3. `ai-site-admin`

A separate Next.js application where clients log in (via Clerk) to manage their site. This is the product's control plane. It contains:

- **Chat Interface** — the primary interaction mode. Clients send natural language prompts to modify their site.
- **AI Engine** — calls LLMs via OpenRouter (OpenAI-compatible API). Translates prompts into validated JSON content changes using component schemas and brand context.
- **Git Integration** — commits changes to the client's site repo via the GitHub API. Atomic multi-file commits using the Git Trees API.
- **Deploy Monitoring** — watches Vercel deployments via their API. Confirms changes are live.
- **Brand Settings** — visual editor for colours, typography, tone of voice, logo.
- **Visual Editor** — click-on-text and click-on-image editing overlaid on the site preview.
- **Media Library** — image upload, processing (resize, WebP, responsive variants), and AI image generation.
- **Version History** — timeline of all changes with rollback capability.
- **Domain Management** — self-service custom domain setup via the Vercel Domains API.
- **Database** — Vercel Postgres (or Supabase) for conversations, client settings, and change logs. Only the admin app has a database.

## Core Data Flow

```
Client sends prompt
  → AI engine receives prompt + current site state + brand config + component manifest
  → LLM generates JSON content changes
  → Changes validated against component schemas
  → Committed to client's GitHub repo
  → Vercel auto-deploys
  → Client sees live update in preview panel
```

## Technology Stack

| Layer | Technology | Notes |
|---|---|---|
| Component Library | React, TypeScript, tsup, Storybook, Jest | This repo |
| Client Sites | Next.js 14+, Tailwind CSS | Static rendering from JSON |
| Management App | Next.js 14+, Tailwind CSS, Prisma | Client-facing control plane |
| Auth | Clerk | Email/password sign-in |
| Database | Vercel Postgres or Supabase | Admin app only |
| AI | OpenRouter | OpenAI-compatible API, model swappable via env var |
| Version Control | GitHub API (Octokit) | Atomic multi-file commits |
| Hosting | Vercel | Auto-deploy on push |
| Image Storage | Vercel Blob or Cloudflare R2 | Processed responsive images |
| Image Generation | OpenAI DALL-E or Stability AI (via OpenRouter or direct) | Abstracted behind provider interface |
| Image Processing | sharp | Resize, format conversion |
| Schema Validation | ajv | Validates all AI output |

## Content Schema

Every client site stores content as JSON files in the `/content/` directory:

```
/content/
  brand.json          — colours, typography, tone of voice, logo
  navigation.json     — site title, primary nav `items`, CTA, footer
  pages/
    home.json         — page definition with sections array
    about.json
    services.json
    contact.json
  schemas/            — JSON Schema (draft-07) for Page, Section, Brand, Navigation
  integrations/
    forms.json        — form provider config
    analytics.json    — tracking config
    booking.json      — scheduling embed config
```

Formal types mirror these files in `lib/types.ts`. Use `validate(data, kind)` from `lib/validator.ts` (`kind`: `page` | `brand` | `navigation` | `section`) so the AI engine can check output before commit; the Next.js build validates page, brand, and navigation the same way.

### Images (`SiteImage` + `ImageConfig`)

- **Implementation:** `lib/siteImage.tsx` (client component), **barrel:** `lib/image.ts` — wraps `next/image` with focal-point `object-position` (0–1), responsive `sizes` presets (`sizeContext`), branded placeholders when `src` is missing or on load error, and **required `alt`**.
- **Type:** `ImageConfig` — `{ src, alt, focalPoint?, width?, height? }` — re-exported from `lib/types.ts`.
- **Registry components** in `@ai-site/components` import `SiteImage` from the virtual module `@site/image`. In this app, `next.config.mjs` aliases `@site/image` to `./lib/siteImage.tsx` so the library stays stack-agnostic while the client site owns the real implementation. Storybook/Jest in the component package resolve `@site/image` to a small stub.
- **Remote images:** configure `images.remotePatterns` in `next.config.mjs` for your CDN domains.

### Page Definition Structure

```json
{
  "slug": "home",
  "title": "Home — Align Studio",
  "description": "Meta description for SEO",
  "sections": [
    {
      "id": "hero-1",
      "component": "Hero",
      "variant": "centered",
      "content": {
        "heading": "Find Your Balance",
        "subheading": "Boutique pilates studio in Hamilton",
        "cta": { "label": "Book a Class", "href": "/contact" }
      },
      "settings": {
        "spacing": "large",
        "background": "primary",
        "maxWidth": "narrow"
      }
    }
  ]
}
```

### Brand Config Structure

```json
{
  "colors": {
    "primary": "#4A6741",
    "secondary": "#8B7355",
    "accent": "#D4A574",
    "neutral": "#F5F0EB",
    "background": "#FFFFFF",
    "text": "#2D2D2D",
    "textLight": "#6B6B6B"
  },
  "typography": {
    "headingFont": "Playfair Display",
    "bodyFont": "Inter",
    "baseSize": 16,
    "scale": 1.25
  },
  "borderRadius": "medium",
  "spacing": "relaxed",
  "logo": {
    "light": "/images/logo-light.svg",
    "dark": "/images/logo-dark.svg"
  },
  "voice": {
    "tone": ["warm", "professional", "encouraging"],
    "industry": "Health and wellness",
    "audience": "Women aged 25-45 interested in rehabilitation and wellness",
    "keywords": ["balance", "strength", "mindful movement"],
    "avoid": ["aggressive", "extreme", "no pain no gain"]
  }
}
```

## Component Library Conventions (This Repo)

### File Structure Per Component

```
src/components/Hero/
  Hero.tsx              — component implementation
  Hero.schema.json      — JSON Schema for props validation
  Hero.stories.tsx      — Storybook stories (all variants + edge cases)
  Hero.test.tsx         — unit + snapshot tests
  index.ts              — re-exports component and types
```

### Component Rules

- Every component exports a typed Props interface with a required `variant` field (union of variant names)
- All styling uses CSS custom properties from the theme system — never hard-coded colours, fonts, or spacing
- Components must render correctly with only required props
- Components must not break if optional props are missing
- Editable content elements include `data-content-path` attributes for the visual editor (e.g., `data-content-path="pages/home.sections[0].content.heading"`)
- Images use the shared `SiteImage` component and `ImageConfig` type, never raw `<img>` tags

### Theme Variables

Components reference these CSS custom properties (injected by ThemeProvider):

```
--color-primary, --color-secondary, --color-accent, --color-neutral
--color-background, --color-text, --color-text-light
--font-heading, --font-body
--radius-sm, --radius-md, --radius-lg
--space-xs, --space-sm, --space-md, --space-lg, --space-xl, --space-2xl
```

### Registry Type Names

Each component registers with a string key used in JSON config files:

| Registry Key | Component | Variants |
|---|---|---|
| `SiteHeader` | SiteHeader | centered, left-aligned, transparent, sticky |
| `SiteFooter` | SiteFooter | simple, multi-column, newsletter |
| `Hero` | Hero | centered, split, full-bleed, video |
| `FeatureGrid` | FeatureGrid | three-column, two-column-images, alternating |
| `CTABanner` | CTABanner | inline, full-width, with-image |
| `Testimonials` | Testimonials | cards, featured, carousel |
| `TextContent` | TextContent | single-column, two-column, with-sidebar |
| `ContactForm` | ContactForm | simple, with-map, split |
| `ImageGallery` | ImageGallery | grid, masonry, lightbox |
| `TeamGrid` | TeamGrid | cards, headshots, detailed |
| `PricingTable` | PricingTable | tier-cards, comparison, simple |
| `FAQAccordion` | FAQAccordion | simple, grouped |
| `Stats` | Stats | counter-row, featured, with-icons |

### Naming Conventions

- Component names: PascalCase (`FeatureGrid`, `CTABanner`)
- Registry keys: PascalCase matching component name
- Variant names: kebab-case (`three-column`, `full-bleed`)
- CSS custom properties: kebab-case with category prefix (`--color-primary`, `--space-lg`)
- JSON content field names: camelCase (`headingText`, `ctaLabel`)
- File names: PascalCase for components, camelCase for utilities

### Package Info

- Package name: `@ai-site/components`
- Bundler: tsup (dual CJS/ESM output)
- Peer dependencies: react, react-dom
- Testing: Jest + React Testing Library
- Documentation: Storybook 8

## AI Engine Context

The AI engine (in the admin app) receives a component manifest that describes every available component, its variants, and its prop schema. When generating content changes, the LLM:

- Can only use components that exist in the manifest
- Must output valid JSON matching the component's schema
- Must preserve existing sections that aren't being modified
- Writes copy that matches the brand voice settings
- Outputs a structured changes array: `{ changes: [{ file, content }], summary }`

All AI output is validated against JSON schemas before being committed. Invalid output triggers a retry with the validation error fed back to the LLM.

## Environment Variables

### Component Library (this repo)
None required — this is a pure library.

### Client Site Template
- `CANONICAL_DOMAIN` — the primary domain for redirects and sitemap

**`@ai-site/components` dependency:** In the AI Site Builder monorepo, this template uses `file:../ai-site-components` in `package.json` so the app resolves the sibling library. For a fork without that layout, point the dependency at GitHub instead, for example `git+https://github.com/MikeTayler/ai-site-components.git`. The library’s `package.json` `files` field must include everything required to produce `dist` (e.g. `src`, `tsup.config.ts`, `scripts`) if you rely on building from a git install; otherwise run `npm run build` in the library repo and commit or publish `dist`.

### Admin App
- `CLERK_PUBLISHABLE_KEY` — Clerk auth (public)
- `CLERK_SECRET_KEY` — Clerk auth (secret)
- `OPENROUTER_API_KEY` — LLM access via OpenRouter
- `OPENROUTER_MODEL` — default model string (e.g., `anthropic/claude-sonnet-4-20250514`)
- `GITHUB_TOKEN` — GitHub API access for repo operations
- `VERCEL_TOKEN` — Vercel API for deploy monitoring and domain management
- `DATABASE_URL` — Postgres connection string
- `BLOB_READ_WRITE_TOKEN` — Vercel Blob for image storage
