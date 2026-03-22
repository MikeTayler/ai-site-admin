/**
 * Vercel + Neon ask for a variable name prefix (e.g. `ai_site_builder_`). The integration
 * then exposes `PREFIX_POSTGRES_PRISMA_URL`, etc., but not plain `DATABASE_URL`, which
 * Prisma requires. This maps prefixed Neon vars onto `DATABASE_URL` before Prisma connects.
 *
 * Priority: explicit `DATABASE_URL` → `*_POSTGRES_PRISMA_URL` → `*_POSTGRES_URL`.
 */
export function ensureDatabaseUrlFromVercelNeon(): void {
  if (process.env.DATABASE_URL?.trim()) return;

  const env = process.env;
  const keys = Object.keys(env);

  const prismaUrlKey = keys.find((k) => k.endsWith("_POSTGRES_PRISMA_URL"));
  const v = prismaUrlKey ? env[prismaUrlKey]?.trim() : undefined;
  if (v) {
    process.env.DATABASE_URL = v;
    return;
  }

  const postgresUrlKey = keys.find((k) => k.endsWith("_POSTGRES_URL"));
  const v2 = postgresUrlKey ? env[postgresUrlKey]?.trim() : undefined;
  if (v2) {
    process.env.DATABASE_URL = v2;
  }
}
