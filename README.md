This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

Push to GitHub and import the repo in Vercel, or use the [Vercel CLI](https://vercel.com/docs/cli).

### Required environment variables

Vercel does **not** read `.env.local` from the repo. Set these under **Project → Settings → Environment Variables** for **Production** (and **Preview** if you use preview deploys). Copy names from [`.env.local.example`](./.env.local.example).

| Variable | Notes |
|----------|--------|
| `DATABASE_URL` | Postgres connection string. **Required** for Prisma unless you use Vercel’s Neon integration with a custom prefix (see below). |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk |
| `CLERK_SECRET_KEY` | Clerk |
| `OPENROUTER_API_KEY` | AI pipeline |
| `GITHUB_TOKEN` | Repo scope for site Git integration |
| `VERCEL_TOKEN` | For deployment status in the pipeline (optional but needed for “wait for deploy”) |

After adding variables, trigger a **redeploy** (Deployments → … → Redeploy).

### Neon on Vercel with a name prefix

If you connected Neon through Vercel, you were asked for a **prefix** (e.g. `ai_site_builder_`). Vercel then injects variables like `PREFIX_POSTGRES_PRISMA_URL`, not `DATABASE_URL`. **Prisma’s schema only knows `DATABASE_URL`**, which is why a plain `DATABASE_URL` in `.env.local` fixed things locally.

This app **maps prefixed Neon URLs automatically** at runtime (`*_POSTGRES_PRISMA_URL`, then `*_POSTGRES_URL`) so you do not have to duplicate the connection string as `DATABASE_URL` in the dashboard—unless you prefer to set `DATABASE_URL` explicitly.

For **`prisma migrate deploy`** from your machine or CI, the Prisma CLI still expects `DATABASE_URL` in the environment (it does not load the Next.js app). Either export `DATABASE_URL` to the same value as your `*_POSTGRES_PRISMA_URL`, or add a `DATABASE_URL` entry in Vercel for build scripts that run migrations.

### Database migrations

Apply Prisma migrations to your production database once `DATABASE_URL` points at it, e.g. from your machine:

```bash
DATABASE_URL="postgresql://..." npx prisma migrate deploy
```

(or use Vercel’s recommended workflow for your DB provider.)
