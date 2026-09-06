import type {
  BriefAssignment,
  BriefSchedule,
  BriefSchedulePhaseKey,
  BriefScheduleSegment,
  ProjectBrief,
} from "./projectBrief";
import type { AcceptedSnapshot } from "../portal/lib/portalStorage";
import type { TranslationKey } from "./i18n/types";
import type { Locale } from "./i18n/types";

const PHASE_LABEL_KEYS: Record<BriefSchedulePhaseKey, TranslationKey> = {
  setup: "portal.brief.diff.phase.setup",
  rehearsal: "portal.brief.diff.phase.rehearsal",
  show: "portal.brief.diff.phase.show",
  downrig: "portal.brief.diff.phase.downrig",
};

const PHASE_KEYS: BriefSchedulePhaseKey[] = [
  "setup",
  "rehearsal",
  "show",
  "downrig",
];

export type DiffValue =
  | { kind: "text"; text: string }
  | {
      kind: "message";
      key: TranslationKey;
      params?: Record<string, string | number>;
    };

export type DiffEntry = {
  /** Stable key for React lists and analytics (e.g. "project.date",
   *  "schedule.setup[1].fromTime", "assignment.role"). */
  key: string;
  labelKey: TranslationKey;
  labelParams?: Record<string, string | number>;
  before: DiffValue;
  after: DiffValue;
};

const text = (value: string): DiffValue => ({ kind: "text", text: value });
const message = (
  key: TranslationKey,
  params?: Record<string, string | number>,
): DiffValue => ({ kind: "message", key, params });

function fmtDate(iso: string | undefined, locale: Locale): string {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  const d = m
    ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
    : new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(locale === "no" ? "nb-NO" : "en-US", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function fmtRange(
  from: string | undefined,
  to: string | undefined,
  locale: Locale,
): string {
  if (!from && !to) return "—";
  if (from && to && from !== to) {
    return `${fmtDate(from, locale)} → ${fmtDate(to, locale)}`;
  }
  return fmtDate(from || to, locale);
}

function fmtTimeRange(
  fromTime: string | undefined,
  toTime: string | undefined,
  timeTbd = false,
  tbdLabel = "—",
): string {
  if (timeTbd) return tbdLabel;
  if (!fromTime && !toTime) return "—";
  if (fromTime && toTime) return `${fromTime}–${toTime}`;
  return fromTime || toTime || "—";
}

function fmtMoneyNok(n: number | undefined, locale: Locale): string {
  if (typeof n !== "number" || !isFinite(n) || n === 0) return "—";
  return new Intl.NumberFormat(locale === "no" ? "nb-NO" : "en-US", {
    style: "currency",
    currency: "NOK",
    maximumFractionDigits: 0,
  }).format(Math.round(n));
}

function fmtHours(n: number | undefined): string {
  if (typeof n !== "number" || !isFinite(n) || n === 0) return "—";
  return `${n} h`;
}

function pushIfChanged(
  out: DiffEntry[],
  key: string,
  labelKey: TranslationKey,
  before: string,
  after: string,
  labelParams?: Record<string, string | number>,
): void {
  if (before !== after) {
    out.push({
      key,
      labelKey,
      labelParams,
      before: text(before),
      after: text(after),
    });
  }
}

function diffSchedule(
  before: BriefSchedule | undefined,
  after: BriefSchedule | undefined,
  out: DiffEntry[],
  locale: Locale,
  tbdLabel: string,
): void {
  const b = before ?? {};
  const a = after ?? {};
  for (const key of PHASE_KEYS) {
    const beforeSegs: BriefScheduleSegment[] = b[key] ?? [];
    const afterSegs: BriefScheduleSegment[] = a[key] ?? [];
    const phaseKey = PHASE_LABEL_KEYS[key];
    const len = Math.max(beforeSegs.length, afterSegs.length);
    for (let i = 0; i < len; i++) {
      const bs = beforeSegs[i];
      const as = afterSegs[i];
      const labelKey =
        len > 1 ? "portal.brief.diff.label.phaseDay" : "portal.brief.diff.label.phase";
      const labelParams = { phaseKey, day: i + 1 };
      if (bs && !as) {
        out.push({
          key: `schedule.${key}[${i}]`,
          labelKey,
          labelParams,
          before: text(`${fmtRange(bs.from, bs.to, locale)} · ${fmtTimeRange(bs.fromTime, bs.toTime, bs.timeTbd, tbdLabel)}`),
          after: message("portal.brief.diff.value.removed"),
        });
        continue;
      }
      if (!bs && as) {
        out.push({
          key: `schedule.${key}[${i}]`,
          labelKey,
          labelParams,
          before: text("—"),
          after: text(`${fmtRange(as.from, as.to, locale)} · ${fmtTimeRange(as.fromTime, as.toTime, as.timeTbd, tbdLabel)}`),
        });
        continue;
      }
      if (!bs || !as) continue;
      pushIfChanged(
        out,
        `schedule.${key}[${i}].dates`,
        len > 1
          ? "portal.brief.diff.label.phaseDayDates"
          : "portal.brief.diff.label.phaseDates",
        fmtRange(bs.from, bs.to, locale),
        fmtRange(as.from, as.to, locale),
        labelParams,
      );
      pushIfChanged(
        out,
        `schedule.${key}[${i}].times`,
        len > 1
          ? "portal.brief.diff.label.phaseDayTimes"
          : "portal.brief.diff.label.phaseTimes",
        fmtTimeRange(bs.fromTime, bs.toTime, bs.timeTbd, tbdLabel),
        fmtTimeRange(as.fromTime, as.toTime, as.timeTbd, tbdLabel),
        labelParams,
      );
    }
  }
}

function diffAssignment(
  before: BriefAssignment | undefined,
  after: BriefAssignment | undefined,
  out: DiffEntry[],
  locale: Locale,
): void {
  // Treat completely missing assignment as "no diff" (the freelancer
  // wasn't on the call sheet either before or after).
  if (!before && !after) return;
  // Explicit reassignment / removal semantics — much clearer for the
  // freelancer than a flurry of per-field changes when the producer
  // takes them off (or adds them onto) the call sheet.
  if (before && !after) {
    out.push({
      key: "assignment.removed",
      labelKey: "portal.brief.diff.label.yourAssignment",
      before: before.role
        ? text(`${before.role}${before.name ? ` (${before.name})` : ""}`)
        : message("portal.brief.diff.value.onCallSheet"),
      after: message("portal.brief.diff.value.removedFromCallSheet"),
    });
    return;
  }
  if (!before && after) {
    out.push({
      key: "assignment.added",
      labelKey: "portal.brief.diff.label.yourAssignment",
      before: message("portal.brief.diff.value.notOnCallSheet"),
      after: after.role
        ? text(`${after.role}${after.name ? ` (${after.name})` : ""}`)
        : message("portal.brief.diff.value.addedToCallSheet"),
    });
    return;
  }
  const b = before ?? ({} as Partial<BriefAssignment>);
  const a = after ?? ({} as Partial<BriefAssignment>);
  pushIfChanged(out, "assignment.role", "portal.brief.diff.label.yourRole", b.role ?? "—", a.role ?? "—");
  pushIfChanged(
    out,
    "assignment.callTime",
    "portal.brief.diff.label.yourCallTime",
    b.callTime || "—",
    a.callTime || "—",
  );
  pushIfChanged(
    out,
    "assignment.offTime",
    "portal.brief.diff.label.yourOffTime",
    b.offTime || "—",
    a.offTime || "—",
  );
  pushIfChanged(
    out,
    "assignment.hours",
    "portal.brief.diff.label.yourHours",
    fmtHours(b.hours),
    fmtHours(a.hours),
  );
  pushIfChanged(
    out,
    "assignment.dayRate",
    "portal.brief.diff.label.yourDayRate",
    fmtMoneyNok(b.dayRate, locale),
    fmtMoneyNok(a.dayRate, locale),
  );
  pushIfChanged(
    out,
    "assignment.notes",
    "portal.brief.diff.label.notesForYou",
    (b.notes ?? "").trim() || "—",
    (a.notes ?? "").trim() || "—",
  );
}

/** Compare an accepted snapshot against the current brief and return
 *  a flat list of human-readable changes. Returns an empty array when
 *  there are no changes (or when no snapshot exists yet). */
export function diffBriefAgainstSnapshot(
  snapshot: AcceptedSnapshot | undefined,
  current: ProjectBrief,
  options: { locale?: Locale; tbdLabel?: string } = {},
): DiffEntry[] {
  if (!snapshot) return [];
  const out: DiffEntry[] = [];
  const locale = options.locale ?? "en";
  const tbdLabel = options.tbdLabel ?? "—";
  const bp = snapshot.project;
  const ap = current.project;
  pushIfChanged(out, "project.venue", "portal.brief.diff.label.venue", bp.venue || "—", ap.venue || "—");
  pushIfChanged(
    out,
    "project.date",
    "portal.brief.diff.label.showDate",
    fmtRange(bp.date, bp.endDate, locale),
    fmtRange(ap.date, ap.endDate, locale),
  );
  pushIfChanged(
    out,
    "project.preparedBy",
    "portal.brief.diff.label.projectManager",
    bp.preparedBy || "—",
    ap.preparedBy || "—",
  );
  diffSchedule(bp.schedule, ap.schedule, out, locale, tbdLabel);
  const currentMine =
    current.assignments.find((a) => a.crewId === current.recipientCrewId) ??
    undefined;
  diffAssignment(snapshot.myAssignment, currentMine, out, locale);
  return out;
}
