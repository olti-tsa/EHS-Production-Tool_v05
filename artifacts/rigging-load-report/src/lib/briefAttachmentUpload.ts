/** Producer-side helper for uploading a brief attachment.
 *
 *  Two-step flow:
 *    1. Ask the api-server (Clerk-authenticated) to mint a presigned
 *       upload URL + return the canonical objectPath.
 *    2. PUT the bytes directly to GCS at that signed URL.
 *
 *  Returns a `BriefAttachment` ready to embed in a ProjectBrief. */

import type { BriefAttachment } from "./projectBrief";

export type BriefAttachmentUploadErrorCode =
  | "auth_required"
  | "request_failed"
  | "upload_failed";

export class BriefAttachmentUploadError extends Error {
  constructor(
    readonly code: BriefAttachmentUploadErrorCode,
    readonly status?: number,
  ) {
    super(code);
    this.name = "BriefAttachmentUploadError";
  }
}

/** Minimal handle to whatever the producer wants to attach. We accept
 *  data URLs because that's the form the floor-plan helper already
 *  produces, but a Blob with metadata works just as well. */
export type AttachmentInput = {
  name: string;
  contentType: string;
  sizeBytes: number;
  /** Source bytes — exactly one of `dataUrl` or `blob` must be set. */
  dataUrl?: string;
  blob?: Blob;
};

function apiBase(): string {
  // BASE_URL has a trailing slash; mirrors drawingAnalysis.ts.
  const env = (import.meta as { env?: { BASE_URL?: string } }).env;
  return (env?.BASE_URL ?? "/") + "api";
}

/** Convert a "data:<mime>;base64,<...>" URL to a Blob so we can PUT it.
 *  We only emit base64 data URLs in this codebase (FileReader.readAsDataURL
 *  always does), so we don't need to handle the percent-encoded variant. */
function dataUrlToBlob(dataUrl: string, fallbackType: string): Blob {
  const m = /^data:([^;,]+)?(?:;base64)?,(.*)$/i.exec(dataUrl);
  if (!m) throw new Error("Malformed data URL");
  const mime = m[1] || fallbackType || "application/octet-stream";
  const rest = m[2] ?? "";
  // The regex above doesn't actually distinguish base64 from percent-
  // encoded; sniff for base64 explicitly.
  const isBase64 = /;base64,/i.test(dataUrl);
  if (isBase64) {
    const binary = atob(rest);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }
  return new Blob([decodeURIComponent(rest)], { type: mime });
}

type UploadUrlResponse = {
  ok?: boolean;
  uploadURL?: string;
  objectPath?: string;
  error?: string;
};

/** Generate a stable id for the BriefAttachment. We use the object-path
 *  suffix (which is itself a UUID) when available so the same upload
 *  always produces the same id; otherwise fall back to a random id. */
function attachmentIdFromObjectPath(objectPath: string): string {
  const parts = objectPath.split("/");
  const last = parts[parts.length - 1] || "";
  if (last) return `att_${last.slice(0, 16)}`;
  return `att_${Math.random().toString(36).slice(2, 10)}`;
}

/** Upload one attachment. `getToken` is Clerk's per-session JWT factory
 *  — passing it (rather than a raw string) lets the caller trigger a
 *  fresh token fetch right before the request. */
export async function uploadBriefAttachment(
  input: AttachmentInput,
  getToken: () => Promise<string | null>,
): Promise<BriefAttachment> {
  if (!input.dataUrl && !input.blob) {
    throw new Error("uploadBriefAttachment: dataUrl or blob is required");
  }
  const token = await getToken();
  if (!token) {
    throw new BriefAttachmentUploadError("auth_required");
  }

  // Step 1 — request a presigned upload URL.
  const reqRes = await fetch(`${apiBase()}/storage/uploads/request-url`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      name: input.name,
      size: input.sizeBytes,
      contentType: input.contentType,
    }),
  });
  let reqJson: UploadUrlResponse;
  try {
    reqJson = (await reqRes.json()) as UploadUrlResponse;
  } catch {
    throw new BriefAttachmentUploadError("request_failed", reqRes.status);
  }
  if (!reqRes.ok || !reqJson.ok || !reqJson.uploadURL || !reqJson.objectPath) {
    throw new BriefAttachmentUploadError("request_failed", reqRes.status);
  }

  // Step 2 — PUT the bytes directly to GCS at the signed URL. The
  // signed URL embeds the auth, so no Authorization header is sent
  // (and adding one would actually break the signature).
  const blob =
    input.blob ??
    dataUrlToBlob(input.dataUrl as string, input.contentType);
  const putRes = await fetch(reqJson.uploadURL, {
    method: "PUT",
    headers: { "Content-Type": input.contentType },
    body: blob,
  });
  if (!putRes.ok) {
    throw new BriefAttachmentUploadError("upload_failed", putRes.status);
  }

  return {
    id: attachmentIdFromObjectPath(reqJson.objectPath),
    name: input.name,
    contentType: input.contentType,
    sizeBytes: input.sizeBytes,
    objectPath: reqJson.objectPath,
  };
}

/** Build the public-by-token download URL for a brief attachment. The
 *  Portal calls this to populate the download anchors. */
export function attachmentDownloadUrl(att: { objectPath: string }): string {
  // objectPath is `/objects/<id>` and the route is `/api/storage/objects/*`,
  // so we just append objectPath after `${BASE_URL}api/storage`.
  return `${apiBase()}/storage${att.objectPath}`;
}
