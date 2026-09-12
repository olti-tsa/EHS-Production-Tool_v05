export type DeclineReasonInput =
  | { ok: true; value: string | null | undefined }
  | { ok: false };

/** Validate and normalise the optional decline explanation on a response.
 * `undefined` means the caller omitted the field; null and blank strings
 * explicitly mean no explanation. */
export function parseDeclineReason(raw: unknown): DeclineReasonInput {
  if (raw === undefined) return { ok: true, value: undefined };
  if (raw === null) return { ok: true, value: null };
  if (typeof raw !== "string") return { ok: false };
  const value = raw.trim();
  if (value.length > 1000) return { ok: false };
  return { ok: true, value: value || null };
}
