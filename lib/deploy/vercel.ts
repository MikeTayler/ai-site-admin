/**
 * Vercel REST API (https://api.vercel.com) — server-side only.
 * Auth: `VERCEL_TOKEN`. Optional `VERCEL_TEAM_ID` for team-owned projects.
 */

const VERCEL_API_ORIGIN = "https://api.vercel.com";

export type VercelEnvTarget = "production" | "preview" | "development";

export type LatestDeployment = {
  id: string;
  name: string;
  /** e.g. READY, BUILDING, ERROR */
  status: string;
  /** Full https URL for the deployment */
  url: string;
  /** Unix ms when the deployment was created */
  createdAt: number;
};

export type VercelProjectInfo = {
  id: string;
  name: string;
  framework?: string | null;
  /** Primary production hostname when inferable (verified custom or default `*.vercel.app`) */
  productionDomain?: string;
  domains: Array<{
    name: string;
    apexName?: string;
    verified: boolean;
  }>;
  /** Raw subset of the Vercel project payload for advanced use */
  raw: Record<string, unknown>;
};

function getToken(): string {
  const t = process.env.VERCEL_TOKEN?.trim();
  if (!t) {
    throw new Error(
      "VERCEL_TOKEN is not set — add a Vercel token with access to the target project.",
    );
  }
  return t;
}

function getTeamId(): string | undefined {
  return process.env.VERCEL_TEAM_ID?.trim() || undefined;
}

function buildUrl(path: string): URL {
  const url = path.startsWith("http")
    ? new URL(path)
    : new URL(path.replace(/^\//, ""), `${VERCEL_API_ORIGIN}/`);
  const teamId = getTeamId();
  if (teamId && !url.searchParams.has("teamId")) {
    url.searchParams.set("teamId", teamId);
  }
  return url;
}

function formatRateLimitHeaders(res: Response): string {
  const remaining = res.headers.get("x-ratelimit-remaining");
  const limit = res.headers.get("x-ratelimit-limit");
  const reset = res.headers.get("x-ratelimit-reset");
  const retryAfter = res.headers.get("retry-after");
  const parts: string[] = [];
  if (remaining !== null && limit !== null) {
    parts.push(`rate limit ${remaining}/${limit} remaining`);
  }
  if (reset) {
    const n = Number(reset);
    if (!Number.isNaN(n)) {
      parts.push(`resets ${new Date(n * 1000).toISOString()}`);
    }
  }
  if (retryAfter) {
    parts.push(`retry-after ${retryAfter}s`);
  }
  return parts.length ? ` (${parts.join("; ")})` : "";
}

async function parseErrorBody(res: Response): Promise<string> {
  const text = await res.text();
  try {
    const j = JSON.parse(text) as { error?: { message?: string }; message?: string };
    return j.error?.message ?? j.message ?? text;
  } catch {
    return text || res.statusText;
  }
}

export class VercelApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly headers: Headers,
  ) {
    super(message);
    this.name = "VercelApiError";
  }
}

type VercelFetchOptions = RequestInit & {
  /** Per-request timeout (ms). Default 60s. */
  timeoutMs?: number;
};

/**
 * Authenticated `fetch` to the Vercel API with JSON handling and rate-limit-aware errors.
 */
export async function vercelFetch<T>(
  path: string,
  init: VercelFetchOptions = {},
): Promise<T> {
  const { timeoutMs = 60_000, ...rest } = init;
  const url = buildUrl(path);
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url.toString(), {
      ...rest,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${getToken()}`,
        Accept: "application/json",
        ...rest.headers,
      },
    });

    if (res.status === 429) {
      const detail = await parseErrorBody(res);
      throw new VercelApiError(
        `Vercel API rate limited: ${detail}${formatRateLimitHeaders(res)}`,
        res.status,
        res.headers,
      );
    }

    if (!res.ok) {
      const detail = await parseErrorBody(res);
      throw new VercelApiError(
        `Vercel API ${res.status}: ${detail}${formatRateLimitHeaders(res)}`,
        res.status,
        res.headers,
      );
    }

    if (res.status === 204) {
      return undefined as T;
    }

    const text = await res.text();
    if (!text) return undefined as T;
    return JSON.parse(text) as T;
  } catch (e) {
    if (e instanceof VercelApiError) throw e;
    if (e instanceof Error && e.name === "AbortError") {
      throw new Error(
        `Vercel API request timed out after ${timeoutMs}ms (${url.pathname}${url.search})`,
      );
    }
    throw e;
  } finally {
    clearTimeout(t);
  }
}

function deploymentHostnameToUrl(host: string | null | undefined): string {
  if (!host) return "";
  if (host.startsWith("http://") || host.startsWith("https://")) return host;
  return `https://${host}`;
}

type DeploymentListItem = {
  uid?: string;
  id?: string;
  name?: string;
  state?: string;
  readyState?: string;
  url?: string | null;
  created?: number;
  createdAt?: number;
};

type ListDeploymentsResponse = {
  deployments?: DeploymentListItem[];
};

function mapDeployment(d: DeploymentListItem): LatestDeployment {
  const id = d.uid ?? d.id ?? "";
  const status = (d.readyState ?? d.state ?? "UNKNOWN").toString();
  const createdAt = d.created ?? d.createdAt ?? 0;
  const host = d.url ?? "";
  return {
    id,
    name: d.name ?? "",
    status,
    url: deploymentHostnameToUrl(host),
    createdAt,
  };
}

/**
 * Returns the most recent deployment for the project (newest first).
 */
export async function getLatestDeployment(
  projectId: string,
): Promise<LatestDeployment> {
  const q = new URLSearchParams({
    projectId,
    limit: "1",
  });
  const data = await vercelFetch<ListDeploymentsResponse>(
    `/v6/deployments?${q.toString()}`,
  );
  const d = data.deployments?.[0];
  if (!d) {
    throw new Error(
      `No deployments found for project "${projectId}". Deploy once or check project / team id.`,
    );
  }
  return mapDeployment(d);
}

const POLL_MS = 3000;
const DEFAULT_WAIT_MS = 120_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Polls until a deployment for `commitSha` is **READY** or fails.
 * Uses `GET /v6/deployments` with the `sha` filter (Git commit SHA).
 */
export async function waitForDeployment(
  projectId: string,
  commitSha: string,
  timeoutMs: number = DEFAULT_WAIT_MS,
): Promise<{ url: string; deployment: LatestDeployment }> {
  const sha = commitSha.trim();
  if (!sha) {
    throw new Error("waitForDeployment: commitSha is required.");
  }
  const deadline = Date.now() + timeoutMs;
  let lastStatus = "";

  while (Date.now() < deadline) {
    const q = new URLSearchParams({
      projectId,
      sha,
      limit: "5",
    });
    const data = await vercelFetch<ListDeploymentsResponse>(
      `/v6/deployments?${q.toString()}`,
      { timeoutMs: 45_000 },
    );
    const list = data.deployments ?? [];
    const sorted = [...list].sort(
      (a, b) =>
        (b.created ?? b.createdAt ?? 0) - (a.created ?? a.createdAt ?? 0),
    );
    const d = sorted[0];
    if (!d) {
      await sleep(POLL_MS);
      continue;
    }

    const deployment = mapDeployment(d);
    lastStatus = deployment.status;

    if (deployment.status === "READY") {
      if (!deployment.url) {
        throw new Error(
          "Deployment is READY but no URL was returned by the Vercel API.",
        );
      }
      return { url: deployment.url, deployment };
    }

    if (
      deployment.status === "ERROR" ||
      deployment.status === "CANCELED" ||
      deployment.status === "DELETED"
    ) {
      throw new Error(
        `Deployment for ${sha.slice(0, 7)} ended with status ${deployment.status} (project ${projectId}).`,
      );
    }

    await sleep(POLL_MS);
  }

  throw new Error(
    `Timed out after ${timeoutMs}ms waiting for deployment (commit ${sha.slice(0, 7)}, last status "${lastStatus || "none"}").`,
  );
}

/**
 * Project metadata and domains (GET /v9/projects/:idOrName).
 */
export async function getProjectInfo(
  projectId: string,
): Promise<VercelProjectInfo> {
  const raw = await vercelFetch<Record<string, unknown>>(
    `/v9/projects/${encodeURIComponent(projectId)}`,
  );
  const id = String(raw.id ?? "");
  const name = String(raw.name ?? "");
  const framework =
    typeof raw.framework === "string" ? raw.framework : null;

  const domainRows: VercelProjectInfo["domains"] = [];
  const rawDomains = raw.domains;
  if (Array.isArray(rawDomains)) {
    for (const row of rawDomains) {
      if (!row || typeof row !== "object") continue;
      const o = row as Record<string, unknown>;
      const n = o.name;
      if (typeof n !== "string") continue;
      domainRows.push({
        name: n,
        apexName: typeof o.apexName === "string" ? o.apexName : undefined,
        verified: o.verified === true,
      });
    }
  }

  const verified = domainRows.filter((d) => d.verified);
  const productionDomain =
    verified.find((d) => !d.name.endsWith(".vercel.app"))?.name ??
    verified[0]?.name ??
    domainRows.find((d) => d.name.endsWith(".vercel.app"))?.name;

  return {
    id,
    name,
    framework,
    productionDomain,
    domains: domainRows,
    raw,
  };
}

function normalizeTargets(
  target: VercelEnvTarget | VercelEnvTarget[],
): VercelEnvTarget[] {
  return Array.isArray(target) ? target : [target];
}

/**
 * Creates or updates an environment variable (`upsert=true`).
 * Uses `type: "encrypted"` suitable for secrets / API keys.
 */
export async function setEnvironmentVariable(
  projectId: string,
  key: string,
  value: string,
  target: VercelEnvTarget | VercelEnvTarget[],
): Promise<void> {
  const targets = normalizeTargets(target);
  if (!targets.length) {
    throw new Error("setEnvironmentVariable: at least one target is required.");
  }
  const path = `/v10/projects/${encodeURIComponent(projectId)}/env?upsert=true`;
  await vercelFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      key,
      value,
      type: "encrypted",
      target: targets,
    }),
  });
}
