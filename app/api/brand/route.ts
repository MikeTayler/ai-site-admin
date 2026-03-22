import { prisma } from "@/lib/db";
import { requireClientForUser } from "@/lib/auth/require-client";
import { normalizeBrandConfig } from "@/lib/brand/defaults";
import type { BrandConfig } from "@/lib/brand/types";
import { MAX_LOGO_BYTES, parseDataUrl } from "@/lib/brand/upload";
import { commitChanges, getFileContent, putRepoFile } from "@/lib/git/github";
import { validate } from "@/lib/validator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PutBody = {
  brand: BrandConfig;
  logoUploads?: {
    light?: string;
    dark?: string;
  };
};

/**
 * GET — brand for editing + preview.
 * Prefer `content/brand.json` from GitHub (same source the client site builds from);
 * fall back to `Client.brandConfig` if the file is missing or GitHub errors.
 */
export async function GET() {
  const res = await requireClientForUser();
  if (!res.ok) {
    return Response.json({ error: res.error }, { status: res.status });
  }
  const { client } = res;

  let brand = normalizeBrandConfig(client.brandConfig);
  let source: "github" | "database" = "database";
  try {
    const { data } = await getFileContent(
      client.githubRepo,
      "content/brand.json",
    );
    brand = normalizeBrandConfig(data);
    source = "github";
  } catch {
    /* use DB */
  }

  return Response.json({
    brand,
    githubRepo: client.githubRepo,
    source,
  });
}

/**
 * PUT — save brand to DB, upload new logos to `public/images/`, commit `content/brand.json`.
 */
export async function PUT(req: Request) {
  const res = await requireClientForUser();
  if (!res.ok) {
    return Response.json({ error: res.error }, { status: res.status });
  }
  const { client } = res;

  let body: PutBody;
  try {
    body = (await req.json()) as PutBody;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.brand || typeof body.brand !== "object") {
    return Response.json({ error: "brand is required" }, { status: 400 });
  }

  let brand = normalizeBrandConfig(body.brand as unknown);

  const repo = client.githubRepo;
  const uploads = body.logoUploads;

  try {
    if (uploads?.light?.startsWith("data:")) {
      const { buffer, ext } = parseDataUrl(uploads.light);
      if (buffer.length > MAX_LOGO_BYTES) {
        return Response.json(
          { error: "Light logo file is too large (max ~1.5MB)." },
          { status: 400 },
        );
      }
      const path = `public/images/brand-light.${ext}`;
      await putRepoFile(repo, path, buffer, "Update brand logo (light)");
      brand = {
        ...brand,
        logo: { ...brand.logo, light: `/images/brand-light.${ext}` },
      };
    }

    if (uploads?.dark?.startsWith("data:")) {
      const { buffer, ext } = parseDataUrl(uploads.dark);
      if (buffer.length > MAX_LOGO_BYTES) {
        return Response.json(
          { error: "Dark logo file is too large (max ~1.5MB)." },
          { status: 400 },
        );
      }
      const path = `public/images/brand-dark.${ext}`;
      await putRepoFile(repo, path, buffer, "Update brand logo (dark)");
      brand = {
        ...brand,
        logo: { ...brand.logo, dark: `/images/brand-dark.${ext}` },
      };
    }

    brand = {
      ...brand,
      voice: {
        ...brand.voice,
        valuePropositions: brand.voice.valuePropositions
          .map((s) => s.trim())
          .filter(Boolean),
        keywords: brand.voice.keywords.map((s) => s.trim()).filter(Boolean),
        avoid: brand.voice.avoid.map((s) => s.trim()).filter(Boolean),
      },
    };

    validate(brand, "brand");

    const { commitSha } = await commitChanges(
      repo,
      [
        {
          file: "content/brand.json",
          content: brand,
        },
      ],
      "Update brand configuration",
    );

    await prisma.client.update({
      where: { id: client.id },
      data: { brandConfig: brand as object },
    });

    await prisma.change.create({
      data: {
        clientId: client.id,
        commitSha,
        summary: "Update brand configuration",
        files: ["content/brand.json"],
        prompt: "Brand settings (admin UI)",
        deployUrl: null,
      },
    });

    return Response.json({ ok: true, commitSha, brand });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ error: msg }, { status: 500 });
  }
}
