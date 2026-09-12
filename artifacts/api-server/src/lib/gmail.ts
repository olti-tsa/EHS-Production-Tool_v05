import { ReplitConnectors } from "@replit/connectors-sdk";
import { logger } from "./logger";

const connectors = new ReplitConnectors();

function base64url(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function encodeRfc2047(value: string): string {
  // Header values may not contain CR/LF — strip them defensively before
  // any encoding decision. Without this, a malicious profile name like
  // "Foo\r\nBcc: attacker@x" could splice extra headers into the
  // RFC 822 message we hand to Gmail.
  const safe = value.replace(/[\r\n]+/g, " ");
  const isAscii = /^[\x20-\x7E]*$/.test(safe);
  if (isAscii) return safe;
  const utf8 = Buffer.from(safe, "utf8").toString("base64");
  return `=?UTF-8?B?${utf8}?=`;
}

function chunk76(s: string): string {
  return s.match(/.{1,76}/g)?.join("\r\n") ?? s;
}

/** Strict validator for the bare-address half of a To: header. We
 *  refuse anything containing CR/LF, angle brackets, commas, or
 *  whitespace, and require a minimal `local@domain` shape. The
 *  recipient address is sourced from `freelancer_profiles.email`,
 *  which is user-edited, so this is the trust boundary. */
function isSafeEmailAddress(value: string): boolean {
  if (!value) return false;
  if (/[\r\n<>,\s]/.test(value)) return false;
  return /^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(value);
}

export type InlineEmailImage = {
  contentId: string;
  filename: string;
  content: Buffer;
};

export function buildRfc822(args: {
  to: string;
  toName?: string;
  subject: string;
  textBody: string;
  htmlBody?: string;
  inlineImages?: InlineEmailImage[];
}): string {
  const toHeader = args.toName
    ? `${encodeRfc2047(args.toName)} <${args.to}>`
    : args.to;
  const bodyB64 = chunk76(Buffer.from(args.textBody, "utf8").toString("base64"));
  const htmlBodyB64 = args.htmlBody
    ? chunk76(Buffer.from(args.htmlBody, "utf8").toString("base64"))
    : null;
  const boundary = "ehs-alt-9f4b25f0";
  if (htmlBodyB64) {
    const images = args.inlineImages ?? [];
    for (const image of images) {
      if (!/^[a-zA-Z0-9._@-]+$/.test(image.contentId) ||
          !/^[a-zA-Z0-9._-]+$/.test(image.filename)) {
        throw new Error("Invalid inline image metadata");
      }
    }
    const relatedBoundary = "ehs-related-a48c610e";
    const htmlPart = [
      `Content-Type: text/html; charset=UTF-8`,
      `Content-Transfer-Encoding: base64`,
      ``,
      htmlBodyB64,
    ];
    const richPart = images.length ? [
      `Content-Type: multipart/related; boundary="${relatedBoundary}"; type="text/html"`,
      ``,
      `--${relatedBoundary}`,
      ...htmlPart,
      ...images.flatMap((image) => [
        `--${relatedBoundary}`,
        `Content-Type: image/png; name="${image.filename}"`,
        `Content-Transfer-Encoding: base64`,
        `Content-ID: <${image.contentId}>`,
        `Content-Disposition: inline; filename="${image.filename}"`,
        ``,
        chunk76(image.content.toString("base64")),
      ]),
      `--${relatedBoundary}--`,
    ] : htmlPart;
    return [
      `To: ${toHeader}`,
      `Subject: ${encodeRfc2047(args.subject)}`,
      `MIME-Version: 1.0`,
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      ``,
      `--${boundary}`,
      `Content-Type: text/plain; charset=UTF-8`,
      `Content-Transfer-Encoding: base64`,
      ``,
      bodyB64,
      `--${boundary}`,
      ...richPart,
      `--${boundary}--`,
      ``,
    ].join("\r\n");
  }
  return [
    `To: ${toHeader}`,
    `Subject: ${encodeRfc2047(args.subject)}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset=UTF-8`,
    `Content-Transfer-Encoding: base64`,
    ``,
    bodyB64,
  ].join("\r\n");
}

export type SendGmailResult =
  | { ok: true; id?: string }
  | { ok: false; error: string };

export async function sendGmail(args: {
  to: string;
  toName?: string;
  subject: string;
  textBody: string;
  htmlBody?: string;
  inlineImages?: InlineEmailImage[];
}): Promise<SendGmailResult> {
  if (!isSafeEmailAddress(args.to)) {
    logger.warn(
      // We deliberately do NOT log the address itself here — it failed
      // validation, which is exactly the case where it might contain
      // injected content we don't want in our log stream.
      { length: args.to?.length ?? 0 },
      "gmail send rejected: invalid recipient address",
    );
    return { ok: false, error: "invalid recipient address" };
  }
  try {
    const raw = base64url(buildRfc822(args));
    const resp = await connectors.proxy(
      "google-mail",
      "/gmail/v1/users/me/messages/send",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ raw }),
      },
    );
    if (!resp.ok) {
      // Drain the body so the underlying connection can be released, but
      // do NOT log it — Gmail error payloads frequently echo the
      // recipient address. Status alone is enough for triage; the
      // caller's log line already carries briefId + freelancerUserId
      // for correlation.
      await resp.text().catch(() => "");
      logger.warn(
        { status: resp.status },
        "gmail send failed",
      );
      return { ok: false, error: `gmail ${resp.status}` };
    }
    const json = (await resp.json().catch(() => ({}))) as { id?: string };
    return { ok: true, id: json.id };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    // Same redaction rule: never include recipient address in the log.
    logger.warn({ err: error }, "gmail send threw");
    return { ok: false, error };
  }
}
