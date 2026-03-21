import { Octokit } from "@octokit/rest";
import { RequestError } from "@octokit/request-error";

/** `owner/repo` or explicit owner + repo name */
export type SiteRepo = string | { owner: string; repo: string };

export type ContentChange = {
  /** Repo-relative path, e.g. `content/pages/home.json` */
  file: string;
  content: unknown;
};

export type CommitSummary = {
  sha: string;
  message: string;
  /** ISO 8601 timestamp */
  date: string;
  authorName?: string;
};

const CONTENT_PREFIX = "content/";
const MIN_RATE_LIMIT_BUFFER = 5;
const BLOB_FETCH_CONCURRENCY = 8;

function getToken(): string {
  const t = process.env.GITHUB_TOKEN?.trim();
  if (!t) {
    throw new Error(
      "GITHUB_TOKEN is not set — add a personal access token or GitHub App installation token with repo scope.",
    );
  }
  return t;
}

function getOctokit(): Octokit {
  return new Octokit({ auth: getToken() });
}

export function parseRepo(repo: SiteRepo): { owner: string; repo: string } {
  if (typeof repo === "string") {
    const parts = repo.split("/").filter(Boolean);
    if (parts.length !== 2) {
      throw new Error(
        `Invalid repo "${repo}". Use "owner/name" or { owner, repo }.`,
      );
    }
    return { owner: parts[0], repo: parts[1] };
  }
  if (!repo.owner?.trim() || !repo.repo?.trim()) {
    throw new Error('Repo must include non-empty "owner" and "repo".');
  }
  return { owner: repo.owner.trim(), repo: repo.repo.trim() };
}

function normalizePath(p: string): string {
  return p.replace(/^\/+/, "").replace(/\\/g, "/");
}

/** Human-readable GitHub API errors, including rate limits. */
export function formatGithubError(err: unknown, context: string): Error {
  if (err instanceof RequestError) {
    const status = err.status;
    const remaining = err.response?.headers["x-ratelimit-remaining"];
    const reset = err.response?.headers["x-ratelimit-reset"];
    const limit = err.response?.headers["x-ratelimit-limit"];
    let msg = `${context}: GitHub API ${status} — ${err.message}`;
    if (remaining !== undefined) {
      msg += ` (rate limit ${remaining}/${limit} remaining)`;
    }
    if (reset) {
      const resetSec = Number(reset);
      if (!Number.isNaN(resetSec)) {
        msg += `; resets ${new Date(resetSec * 1000).toISOString()}`;
      }
    }
    if (err.response?.data && typeof err.response.data === "object") {
      const any = err.response.data as { message?: string };
      if (any.message) msg += ` — ${any.message}`;
    }
    return new Error(msg);
  }
  if (err instanceof Error) {
    return new Error(`${context}: ${err.message}`);
  }
  return new Error(`${context}: ${String(err)}`);
}

async function assertRateLimitHeadroom(
  octokit: Octokit,
  context: string,
  needed: number,
): Promise<void> {
  try {
    const { data } = await octokit.rateLimit.get();
    const core = data.resources.core;
    if (core.remaining < Math.max(needed, MIN_RATE_LIMIT_BUFFER)) {
      throw new Error(
        `${context}: GitHub REST rate limit too low (${core.remaining} remaining, need ~${needed}). Limit ${core.limit}/hour; resets ${new Date(core.reset * 1000).toISOString()}.`,
      );
    }
  } catch (e) {
    if (e instanceof Error && e.message.includes("rate limit too low")) throw e;
    /* ignore secondary failures — primary requests still return rate-limit headers */
  }
}

async function getDefaultBranch(
  octokit: Octokit,
  owner: string,
  repo: string,
): Promise<string> {
  const { data } = await octokit.repos.get({ owner, repo });
  return data.default_branch;
}

async function getHeadCommitSha(
  octokit: Octokit,
  owner: string,
  repo: string,
  branch: string,
): Promise<string> {
  const { data } = await octokit.git.getRef({
    owner,
    repo,
    ref: `heads/${branch}`,
  });
  return data.object.sha;
}

type TreeBlobEntry = { path: string; sha: string };

function contentBlobsFromTree(
  tree: { tree?: Array<{ path?: string | null; type?: string | null; sha?: string | null }> },
  truncated?: boolean,
): TreeBlobEntry[] {
  if (truncated) {
    throw new Error(
      "Repository tree was truncated by GitHub — content/ is too large for a single recursive tree fetch. Shallow clone or increase limits.",
    );
  }
  const out: TreeBlobEntry[] = [];
  for (const t of tree.tree ?? []) {
    if (t.type !== "blob" || !t.path || !t.sha) continue;
    if (t.path.startsWith(CONTENT_PREFIX)) {
      out.push({ path: t.path, sha: t.sha });
    }
  }
  return out;
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let i = 0;
  async function worker() {
    for (;;) {
      const idx = i++;
      if (idx >= items.length) return;
      results[idx] = await fn(items[idx]);
    }
  }
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}

/**
 * Reads a single file from the repo and parses JSON. Returns the parsed value and blob SHA.
 */
export async function getFileContent(
  repo: SiteRepo,
  filePath: string,
): Promise<{ data: unknown; sha: string }> {
  const { owner, repo: repoName } = parseRepo(repo);
  const path = normalizePath(filePath);
  const octokit = getOctokit();
  try {
    await assertRateLimitHeadroom(octokit, "getFileContent", 1);
    const { data } = await octokit.repos.getContent({
      owner,
      repo: repoName,
      path,
    });
    if (Array.isArray(data)) {
      throw new Error(`Path "${path}" is a directory, not a file.`);
    }
    if (data.type !== "file" || !("content" in data) || !data.sha) {
      throw new Error(`Path "${path}" is not a readable file.`);
    }
    const raw = Buffer.from(data.content, "base64").toString("utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`File "${path}" is not valid JSON: ${msg}`);
    }
    return { data: parsed, sha: data.sha };
  } catch (e) {
    throw formatGithubError(e, `getFileContent(${path})`);
  }
}

/**
 * Recursively loads all blobs under `content/` and returns a map of path → parsed JSON.
 */
export async function getAllContent(
  repo: SiteRepo,
): Promise<Record<string, unknown>> {
  const { owner, repo: repoName } = parseRepo(repo);
  const octokit = getOctokit();
  try {
    const branch = await getDefaultBranch(octokit, owner, repoName);
    const headSha = await getHeadCommitSha(octokit, owner, repoName, branch);
    const { data: commit } = await octokit.git.getCommit({
      owner,
      repo: repoName,
      commit_sha: headSha,
    });
    const treeSha = commit.tree.sha;
    const { data: tree } = await octokit.git.getTree({
      owner,
      repo: repoName,
      tree_sha: treeSha,
      recursive: "true",
    });
    const blobs = contentBlobsFromTree(tree, tree.truncated);
    await assertRateLimitHeadroom(octokit, "getAllContent", blobs.length + 2);

    const contents = await mapPool(blobs, BLOB_FETCH_CONCURRENCY, async (b) => {
      const { data: blob } = await octokit.git.getBlob({
        owner,
        repo: repoName,
        file_sha: b.sha,
      });
      const raw = Buffer.from(blob.content, "base64").toString("utf8");
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new Error(`"${b.path}" is not valid JSON: ${msg}`);
      }
      return { path: b.path, parsed };
    });

    const out: Record<string, unknown> = {};
    for (const { path, parsed } of contents) {
      out[path] = parsed;
    }
    return out;
  } catch (e) {
    throw formatGithubError(e, "getAllContent");
  }
}

function stringifyJsonFile(content: unknown): string {
  return `${JSON.stringify(content, null, 2)}\n`;
}

/**
 * Creates one commit that applies all file updates atomically (Git Trees API).
 */
export async function commitChanges(
  repo: SiteRepo,
  changes: ContentChange[],
  message: string,
): Promise<{ commitSha: string }> {
  if (!changes.length) {
    throw new Error("commitChanges: no changes provided.");
  }
  const msg = message.trim() || "Update site content";
  const { owner, repo: repoName } = parseRepo(repo);
  const octokit = getOctokit();
  try {
    const branch = await getDefaultBranch(octokit, owner, repoName);
    const headSha = await getHeadCommitSha(octokit, owner, repoName, branch);
    const { data: headCommit } = await octokit.git.getCommit({
      owner,
      repo: repoName,
      commit_sha: headSha,
    });
    const baseTreeSha = headCommit.tree.sha;

    await assertRateLimitHeadroom(octokit, "commitChanges", changes.length + 5);

    const seen = new Set<string>();
    for (const ch of changes) {
      const p = normalizePath(ch.file);
      if (seen.has(p)) {
        throw new Error(`commitChanges: duplicate path "${p}" in changes array.`);
      }
      seen.add(p);
    }

    const tree: Array<{
      path: string;
      mode: "100644";
      type: "blob";
      sha: string;
    }> = [];

    for (const ch of changes) {
      const path = normalizePath(ch.file);
      if (!path.startsWith(CONTENT_PREFIX)) {
        throw new Error(
          `commitChanges: path "${path}" must live under ${CONTENT_PREFIX}`,
        );
      }
      const body = stringifyJsonFile(ch.content);
      const { data: blob } = await octokit.git.createBlob({
        owner,
        repo: repoName,
        content: body,
        encoding: "utf-8",
      });
      tree.push({
        path,
        mode: "100644",
        type: "blob",
        sha: blob.sha,
      });
    }

    const { data: newTree } = await octokit.git.createTree({
      owner,
      repo: repoName,
      base_tree: baseTreeSha,
      tree,
    });

    const { data: newCommit } = await octokit.git.createCommit({
      owner,
      repo: repoName,
      message: msg,
      tree: newTree.sha,
      parents: [headSha],
    });

    await octokit.git.updateRef({
      owner,
      repo: repoName,
      ref: `heads/${branch}`,
      sha: newCommit.sha,
    });

    return { commitSha: newCommit.sha };
  } catch (e) {
    throw formatGithubError(e, "commitChanges");
  }
}

/**
 * Recent commits touching `content/` (for version timeline).
 * Stops paginating once `limit` commits are collected (saves API calls vs full `paginate`).
 */
export async function getCommitHistory(
  repo: SiteRepo,
  limit: number,
): Promise<CommitSummary[]> {
  const { owner, repo: repoName } = parseRepo(repo);
  const octokit = getOctokit();
  const cap = Math.max(1, limit);
  try {
    const branch = await getDefaultBranch(octokit, owner, repoName);
    await assertRateLimitHeadroom(octokit, "getCommitHistory", Math.min(cap, 50) + 2);
    const out: CommitSummary[] = [];
    const iterator = octokit.paginate.iterator(octokit.repos.listCommits, {
      owner,
      repo: repoName,
      sha: branch,
      path: "content",
      per_page: 100,
    });
    for await (const { data } of iterator) {
      for (const c of data) {
        out.push({
          sha: c.sha,
          message: (
            c.commit.message.split("\n")[0] ?? c.commit.message
          ).trim(),
          date:
            c.commit.author?.date ??
            c.commit.committer?.date ??
            new Date(0).toISOString(),
          authorName: c.commit.author?.name ?? undefined,
        });
        if (out.length >= cap) return out;
      }
    }
    return out;
  } catch (e) {
    throw formatGithubError(e, "getCommitHistory");
  }
}

/**
 * Restores the `content/` tree to match the given commit (new commit on the default branch).
 */
export async function revertToCommit(
  repo: SiteRepo,
  sha: string,
): Promise<{ commitSha: string }> {
  const targetSha = sha.trim();
  if (!targetSha) {
    throw new Error("revertToCommit: commit SHA is required.");
  }
  const { owner, repo: repoName } = parseRepo(repo);
  const octokit = getOctokit();
  try {
    const branch = await getDefaultBranch(octokit, owner, repoName);
    const headSha = await getHeadCommitSha(octokit, owner, repoName, branch);

    const { data: targetCommit } = await octokit.git.getCommit({
      owner,
      repo: repoName,
      commit_sha: targetSha,
    });
    const { data: headCommit } = await octokit.git.getCommit({
      owner,
      repo: repoName,
      commit_sha: headSha,
    });

    const { data: targetTree } = await octokit.git.getTree({
      owner,
      repo: repoName,
      tree_sha: targetCommit.tree.sha,
      recursive: "true",
    });
    const { data: headTree } = await octokit.git.getTree({
      owner,
      repo: repoName,
      tree_sha: headCommit.tree.sha,
      recursive: "true",
    });

    if (targetTree.truncated || headTree.truncated) {
      throw new Error(
        "revertToCommit: tree listing was truncated — repository too large for this API path.",
      );
    }

    const targetMap = new Map(
      contentBlobsFromTree(targetTree, false).map((b) => [b.path, b.sha]),
    );
    const headMap = new Map(
      contentBlobsFromTree(headTree, false).map((b) => [b.path, b.sha]),
    );

    const tree: Array<{
      path: string;
      mode: "100644";
      type: "blob";
      sha: string | null;
    }> = [];

    for (const path of Array.from(headMap.keys())) {
      if (!targetMap.has(path)) {
        tree.push({ path, mode: "100644", type: "blob", sha: null });
      }
    }

    for (const [path, blobSha] of Array.from(targetMap.entries())) {
      if (headMap.get(path) !== blobSha) {
        tree.push({ path, mode: "100644", type: "blob", sha: blobSha });
      }
    }

    if (!tree.length) {
      throw new Error(
        "revertToCommit: content/ already matches the target commit — nothing to change.",
      );
    }

    await assertRateLimitHeadroom(octokit, "revertToCommit", tree.length + 5);

    const { data: newTree } = await octokit.git.createTree({
      owner,
      repo: repoName,
      base_tree: headCommit.tree.sha,
      tree,
    });

    const short = targetSha.slice(0, 7);
    const { data: newCommit } = await octokit.git.createCommit({
      owner,
      repo: repoName,
      message: `Restore content/ to state at ${short}`,
      tree: newTree.sha,
      parents: [headSha],
    });

    await octokit.git.updateRef({
      owner,
      repo: repoName,
      ref: `heads/${branch}`,
      sha: newCommit.sha,
    });

    return { commitSha: newCommit.sha };
  } catch (e) {
    throw formatGithubError(e, "revertToCommit");
  }
}
