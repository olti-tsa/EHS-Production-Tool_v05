/** Brief sharing — encode a ProjectBrief into a URL-safe payload using
 *  gzip + base64url, and decode it back. Uses the standard browser
 *  CompressionStream / DecompressionStream APIs (Chrome 80+, Safari 16.4+,
 *  Firefox 113+) — no extra dependencies. The encoded payload is ~3-7 KB
 *  for a typical small/mid show, which fits comfortably in a URL fragment
 *  and the system clipboard. */

import { normalizeBrief, type ProjectBrief } from "./projectBrief";

export type BriefShareErrorCode =
  | "decompression_unsupported"
  | "payload_unreadable"
  | "payload_invalid";

export class BriefShareError extends Error {
  constructor(readonly code: BriefShareErrorCode) {
    super(code);
    this.name = "BriefShareError";
  }
}

/** base64url-encode a Uint8Array (RFC 4648 §5: no padding, +/→-/_). */
function bufferToBase64Url(buf: Uint8Array): string {
  // chunk to keep call-stack happy on large inputs
  const CHUNK = 0x8000;
  let bin = "";
  for (let i = 0; i < buf.length; i += CHUNK) {
    bin += String.fromCharCode(
      ...buf.subarray(i, Math.min(i + CHUNK, buf.length)),
    );
  }
  const b64 = btoa(bin);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Inverse of bufferToBase64Url. */
function base64UrlToBuffer(s: string): Uint8Array {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/");
  const padLen = (4 - (padded.length % 4)) % 4;
  const bin = atob(padded + "=".repeat(padLen));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function encodeBrief(brief: ProjectBrief): Promise<string> {
  // Share links are freelancer-facing, unlike the producer's saved project.
  const { clientContact: _clientContact, ...project } = brief.project;
  const json = JSON.stringify({ ...brief, project });
  const stream = new Response(json).body;
  if (!stream || typeof CompressionStream === "undefined") {
    // Fallback: uncompressed base64url. Larger but functional on very
    // old browsers. The Portal decoder probes for gzip magic to choose.
    const buf = new TextEncoder().encode(json);
    return `u.${bufferToBase64Url(buf)}`;
  }
  const compressed = stream.pipeThrough(new CompressionStream("gzip"));
  const blob = await new Response(compressed).blob();
  const buf = new Uint8Array(await blob.arrayBuffer());
  return bufferToBase64Url(buf);
}

async function decodeBriefInternal(encoded: string): Promise<ProjectBrief> {
  // Strip the optional "u." prefix used by the uncompressed fallback.
  const isUncompressed = encoded.startsWith("u.");
  const payload = isUncompressed ? encoded.slice(2) : encoded;
  const buf = base64UrlToBuffer(payload);

  let json: string;
  if (isUncompressed) {
    json = new TextDecoder().decode(buf);
  } else {
    if (typeof DecompressionStream === "undefined") {
      throw new BriefShareError("decompression_unsupported");
    }
    // Wrap the Uint8Array in a Blob so the Response constructor accepts
    // it as a BodyInit on TypeScript's stricter DOM lib (Uint8Array
    // alone isn't structurally a BodyInit in modern TS).
    const stream = new Response(new Blob([buf as BlobPart])).body;
    if (!stream) throw new BriefShareError("payload_unreadable");
    const decompressed = stream.pipeThrough(new DecompressionStream("gzip"));
    json = await new Response(decompressed).text();
  }

  const parsed = JSON.parse(json) as unknown;
  const brief = normalizeBrief(parsed);
  if (!brief) {
    throw new BriefShareError("payload_invalid");
  }
  // Also protect previously generated links containing the legacy contact.
  const { clientContact: _clientContact, ...project } = brief.project;
  return { ...brief, project };
}

export async function decodeBrief(encoded: string): Promise<ProjectBrief> {
  try {
    return await decodeBriefInternal(encoded);
  } catch (error) {
    if (error instanceof BriefShareError) throw error;
    throw new BriefShareError("payload_invalid");
  }
}

/** Build the absolute URL the producer should send to the freelancer.
 *  Uses the artifact's base path (Vite's BASE_URL) so it works under
 *  `/`, `/<artifact>/`, or any other mount-point. */
export function buildShareUrl(encoded: string, baseUrl: string): string {
  const origin = window.location.origin;
  // baseUrl from import.meta.env.BASE_URL always has a trailing slash.
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  // The portal route is mounted at <base>portal — send recipients there
  // with the encoded payload as a query param.
  return `${origin}${base}portal/brief/import?b=${encoded}`;
}
