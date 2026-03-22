import { runAiEngine } from "@/lib/ai/engine";
import { getCachedComponentManifest } from "@/lib/ai/manifest";
import { normalizeBrandConfig } from "@/lib/brand/defaults";
import { prisma } from "@/lib/db";
import { commitChanges, getAllContent } from "@/lib/git/github";
import { waitForDeployment } from "@/lib/deploy/vercel";

export type PipelineProgressPhase =
  | "thinking"
  | "validating"
  | "committing"
  | "deploying"
  | "complete"
  | "error";

export type PipelineProgressEvent = {
  phase: PipelineProgressPhase;
  /** ISO 8601 */
  timestamp: string;
  message?: string;
  detail?: unknown;
};

export type PipelineResult = {
  success: boolean;
  summary?: string;
  changes: Array<{ file: string; description: string }>;
  deployUrl?: string;
  commitSha?: string;
  timestamp: string;
  error?: string;
};

export type ProcessPromptOptions = {
  /** Fired for each major phase (chat UI + debugging). */
  onProgress?: (event: PipelineProgressEvent) => void;
  /** Passed to `waitForDeployment` (default 120s). */
  deployTimeoutMs?: number;
};

function nowIso(): string {
  return new Date().toISOString();
}

function logPipeline(
  step: string,
  payload?: Record<string, unknown>,
): void {
  console.log(
    JSON.stringify({
      source: "pipeline",
      step,
      ts: nowIso(),
      ...payload,
    }),
  );
}

function emit(
  onProgress: ProcessPromptOptions["onProgress"],
  phase: PipelineProgressPhase,
  message?: string,
  detail?: unknown,
): void {
  const event: PipelineProgressEvent = {
    phase,
    timestamp: nowIso(),
    message,
    detail,
  };
  logPipeline(`progress:${phase}`, {
    message,
    ...(detail !== undefined
      ? {
          detail:
            typeof detail === "object"
              ? JSON.stringify(detail)
              : String(detail),
        }
      : {}),
  });
  onProgress?.(event);
}

function toChangeDescriptions(
  files: string[],
  summary: string,
): Array<{ file: string; description: string }> {
  const line = summary.trim() || "Content update";
  return files.map((file) => ({
    file,
    description: line,
  }));
}

/**
 * End-to-end: load client → GitHub state → manifest → AI engine → commit → Vercel wait → persist `Change` row.
 */
export async function processPrompt(
  clientId: string,
  prompt: string,
  options: ProcessPromptOptions = {},
): Promise<PipelineResult> {
  const { onProgress, deployTimeoutMs } = options;
  const emptyFail = (error: string): PipelineResult => ({
    success: false,
    changes: [],
    timestamp: nowIso(),
    error,
  });

  logPipeline("start", { clientId, promptLength: prompt.length });

  try {
    const client = await prisma.client.findUnique({
      where: { id: clientId },
    });
    if (!client) {
      const msg = `No client found for id "${clientId}".`;
      emit(onProgress, "error", msg);
      logPipeline("error", { reason: "client_not_found", clientId });
      return emptyFail(msg);
    }

    logPipeline("client_loaded", {
      clientId,
      githubRepo: client.githubRepo,
      vercelProjectId: client.vercelProjectId,
    });

    logPipeline("fetch_github_state", { repo: client.githubRepo });
    const siteState = await getAllContent(client.githubRepo);

    logPipeline("load_manifest");
    const { entries: manifest } = await getCachedComponentManifest();

    const brandFromRepo = siteState["content/brand.json"];
    const brandConfig = normalizeBrandConfig(
      brandFromRepo !== undefined ? brandFromRepo : client.brandConfig,
    );

    emit(
      onProgress,
      "thinking",
      "AI is processing your prompt",
    );
    logPipeline("ai_engine_start", { manifestEntries: manifest.length });

    const engineResult = await runAiEngine({
      prompt,
      siteState,
      brandConfig,
      manifest,
    });

    emit(
      onProgress,
      "validating",
      "Validated AI output against schemas",
    );
    logPipeline("ai_engine_done", {
      summary: engineResult.summary,
      changeCount: engineResult.changes.length,
    });

    if (!engineResult.changes.length) {
      const msg = "AI returned no file changes.";
      emit(onProgress, "error", msg);
      logPipeline("error", { reason: "no_changes" });
      return {
        success: false,
        summary: engineResult.summary,
        changes: [],
        timestamp: nowIso(),
        error: msg,
      };
    }

    const commitMessage = `AI: ${engineResult.summary.trim().slice(0, 200)}`;

    emit(onProgress, "committing", "Pushing changes to GitHub");
    logPipeline("github_commit_start", {
      files: engineResult.changes.map((c) => c.file),
    });

    const { commitSha } = await commitChanges(
      client.githubRepo,
      engineResult.changes.map((c) => ({
        file: c.file,
        content: c.content,
      })),
      commitMessage,
    );

    logPipeline("github_commit_done", { commitSha });

    emit(
      onProgress,
      "deploying",
      "Waiting for Vercel deployment",
    );
    logPipeline("vercel_wait_start", {
      projectId: client.vercelProjectId,
      commitSha,
    });

    const { url: deployUrl } = await waitForDeployment(
      client.vercelProjectId,
      commitSha,
      deployTimeoutMs ?? 120_000,
    );

    logPipeline("vercel_wait_done", { deployUrl });

    const changeRows = toChangeDescriptions(
      engineResult.changes.map((c) => c.file),
      engineResult.summary,
    );

    emit(onProgress, "complete", `Deployment live: ${deployUrl}`, {
      deployUrl,
      commitSha,
    });
    logPipeline("complete", {
      commitSha,
      deployUrl,
      summary: engineResult.summary,
    });

    try {
      await prisma.change.create({
        data: {
          clientId: client.id,
          commitSha,
          summary: engineResult.summary,
          files: engineResult.changes.map((c) => c.file),
          prompt,
          deployUrl,
        },
      });
      logPipeline("change_record_created", { commitSha });
    } catch (e) {
      logPipeline("change_record_failed", {
        error: e instanceof Error ? e.message : String(e),
      });
    }

    return {
      success: true,
      summary: engineResult.summary,
      changes: changeRows,
      deployUrl,
      commitSha,
      timestamp: nowIso(),
    };
  } catch (e) {
    const message =
      e instanceof Error ? e.message : `Unknown error: ${String(e)}`;
    emit(onProgress, "error", message, e);
    logPipeline("error", {
      message,
      stack: e instanceof Error ? e.stack : undefined,
    });
    return {
      success: false,
      changes: [],
      timestamp: nowIso(),
      error: message,
    };
  }
}
