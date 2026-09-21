import { db } from "@/db/client";
import { ingestionItems, ingestionJobs } from "@/db/schema";
import { createInitialDraft } from "./draft";

/**
 * Shared by both upload-completion paths (the E2E fake-provider path and the
 * real Drive relay, `src/app/api/intake/cover/chunk/route.ts`) — creates the
 * `ingestion_jobs`/`ingestion_items` pair a confirmed upload starts. Extracted
 * here (previously inlined in the single-shot upload route) once the upload
 * became two Route Handlers (`init`/`chunk`) sharing this same completion step.
 */
export interface ConfirmedUpload {
  fileId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string | null;
}

export async function createIngestionRecord(confirmed: ConfirmedUpload): Promise<string> {
  const [job] = await db
    .insert(ingestionJobs)
    .values({
      jobType: "single_add",
      source: "teacher_capture",
      status: "running",
      totalItems: 1,
      startedAt: new Date(),
    })
    .returning({ id: ingestionJobs.id });
  const draft = createInitialDraft({
    fileId: confirmed.fileId,
    filename: confirmed.filename,
    mimeType: confirmed.mimeType,
    sizeBytes: confirmed.sizeBytes,
    checksum: confirmed.checksum,
  });
  const [item] = await db
    .insert(ingestionItems)
    .values({
      jobId: job.id,
      driveFileId: confirmed.fileId,
      contentHash: confirmed.checksum,
      status: "processing",
      startedAt: new Date(),
      intakeDraft: draft,
    })
    .returning({ id: ingestionItems.id });
  return item.id;
}
