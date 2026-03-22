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

export type VercelProjectDomain = {
  name: string;
  apexName?: string;
  verified: boolean;
  /** If set, the domain is tied to a preview branch; production aliases usually omit this. */
  gitBranch?: string | null;
};

export type VercelProjectInfo = {
  id: string;
  name: string;
  framework?: string | null;
  /** Primary production hostname when inferable (verified custom or default `*.vercel.app`) */
  productionDomain?: string;
  domains: VercelProjectDomain[];
  /** Raw subset of the Vercel project payload for advanced use */
  raw: Record<string, unknown>;
};

/**
 * Picks the production hostname from GET /v9/projects `domains` (no guessing from project `name`).
 * Prefers verified custom domains, then production Vercel aliases (`gitBranch` unset), then other verified hosts.
 */
export function pickProductionHostnameFromDomains(
  domainRows: VercelProjectDomain[],
): string | undefined {
  if (!domainRows.length) return undefined;

  const verified = domainRows.filter((d) => d.verified);

  const custom = verified.find((d) => !d.name.endsWith(".vercel.app"));
  if (custom) return custom.name;

  const vercelVerified = verified.filter((d) => d.name.endsWith(".vercel.app"));
  const prodVercel = vercelVerified.filter(
    (d) => d.gitBranch == null || d.gitBranch === "",
  );
  const vercelCandidates = prodVercel.length > 0 ? prodVercel : vercelVerified;
  if (vercelCandidates.length === 1) return vercelCandidates[0].name;
  if (vercelCandidates.length > 1) {
    return [...vercelCandidates].sort((a, b) => b.name.length - a.name.length)[0]
      .name;
  }

  const anyVercel = domainRows.find((d) => d.name.endsWith(".vercel.app"));
  return anyVercel?.name;
}

function parseVercelDomainRow(row: unknown): VercelProjectDomain | null {
  if (!row || typeof row !== "object") return null;
  const o = row as Record<string, unknown>;
  const n = o.name;
  if (typeof n !== "string") return null;
  const gb = o.gitBranch;
  const gitBranch =
    typeof gb === "string" ? gb : gb === null ? null : undefined;
  return {
    name: n,
    apexName: typeof o.apexName === "string" ? o.apexName : undefined,
    verified: o.verified === true,
    gitBranch,
  };
}

/**
 * Domains assigned to the project (GET /v9/projects/:idOrName/domains).
 * Prefer this over the embedded `domains` field on GET /v9/projects/:id, which may be absent.
 */
export async function fetchProjectDomainsFromApi(
  projectId: string,
): Promise<VercelProjectDomain[]> {
  const data = await vercelFetch<Record<string, unknown> | unknown[]>(
    `/v9/projects/${encodeURIComponent(projectId)}/domains`,
  );
  const rawDomains: unknown[] = Array.isArray(data)
    ? data
    : Array.isArray((data as Record<string, unknown>).domains)
      ? ((data as Record<string, unknown>).domains as unknown[])
      : [];
  const out: VercelProjectDomain[] = [];
  for (const row of rawDomains) {
    const d = parseVercelDomainRow(row);
    if (d) out.push(d);
  }
  return out;
}

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
  /** Production / preview aliases — prefer these over `url` (which is the unique deployment hostname). */
  alias?: string[] | null;
};

type ListDeploymentsResponse = {
  deployments?: DeploymentListItem[];
};

function hostnameFromAliasEntry(entry: string): string {
  const t = entry.trim();
  if (!t) return "";
  if (t.startsWith("http://") || t.startsWith("https://")) {
    try {
      return new URL(t).hostname;
    } catch {
      return t;
    }
  }
  return t.split("/")[0];
}

/**
 * Public hostname for a deployment: use assigned aliases (stable production URLs), not the
 * per-deployment URL (`*.vercel.app` with team/hash segments from list response).
 */
function deploymentPublicHostname(d: DeploymentListItem): string {
  const rawAliases = Array.isArray(d.alias) ? d.alias : [];
  const hosts = rawAliases
    .filter((x): x is string => typeof x === "string" && x.length > 0)
    .map(hostnameFromAliasEntry)
    .filter(Boolean);

  const vercelHosts = hosts.filter((h) => h.endsWith(".vercel.app"));
  if (vercelHosts.length > 0) {
    vercelHosts.sort((a, b) => a.length - b.length);
    return vercelHosts[0];
  }
  if (hosts.length > 0) return hosts[0];

  const raw = d.url ?? "";
  if (!raw) return "";
  if (raw.startsWith("http://") || raw.startsWith("https://")) {
    try {
      return new URL(raw).hostname;
    } catch {
      /* fall through */
    }
  }
  return raw.replace(/^https?:\/\//, "").split("/")[0];
}

function mapDeployment(d: DeploymentListItem): LatestDeployment {
  const id = d.uid ?? d.id ?? "";
  const status = (d.readyState ?? d.state ?? "UNKNOWN").toString();
  const createdAt = d.created ?? d.createdAt ?? 0;
  const host = deploymentPublicHostname(d);
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
 * Includes preview and production — not suitable for a stable “live site” URL; use {@link getProductionSiteUrl}.
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

/**
 * Most recent **production** deployment only (excludes preview/branch deployments).
 */
export async function getLatestProductionDeployment(
  projectId: string,
): Promise<LatestDeployment | null> {
  const q = new URLSearchParams({
    projectId,
    limit: "1",
    target: "production",
  });
  const data = await vercelFetch<ListDeploymentsResponse>(
    `/v6/deployments?${q.toString()}`,
  );
  const d = data.deployments?.[0];
  if (!d) return null;
  return mapDeployment(d);
}

/**
 * HTTPS URL for the live **production** site — **only** from the Vercel project’s assigned
 * domains (stable aliases). Never uses per-deployment URLs from the deployments API.
 */
export async function getProductionSiteUrl(
  projectId: string,
): Promise<string | null> {
  try {
    let domains: VercelProjectDomain[] = [];
    try {
      domains = await fetchProjectDomainsFromApi(projectId);
    } catch {
      domains = [];
    }
    if (domains.length === 0) {
      domains = (await getProjectInfo(projectId)).domains;
    }
    const host = pickProductionHostnameFromDomains(domains);
    if (host) return deploymentHostnameToUrl(host);
  } catch {
    /* ignore */
  }
  return null;
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
      const d = parseVercelDomainRow(row);
      if (d) domainRows.push(d);
    }
  }

  const productionDomain = pickProductionHostnameFromDomains(domainRows);

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
