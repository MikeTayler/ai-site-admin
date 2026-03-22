import { SitePreviewPanel } from "@/components/site-preview-panel";

export const dynamic = "force-dynamic";

export default function PreviewPage() {
  return (
    <div className="flex h-[calc(100dvh-8.5rem)] min-h-[560px] flex-col">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-zinc-900">Site preview</h2>
        <p className="text-sm text-zinc-500">
          Live deployment from your latest pipeline run or Vercel project.
        </p>
      </div>
      <div className="min-h-0 flex-1">
        <SitePreviewPanel className="h-full min-h-[480px]" />
      </div>
    </div>
  );
}
