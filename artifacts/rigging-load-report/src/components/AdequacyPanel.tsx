import { useMemo, useState } from "react";
import {
  computeCrewAdequacy,
  countRosterByAdequacyRole,
  type AdequacyMetrics,
  type AdequacySuggestion,
} from "../lib/crewAdequacy";
import { useT, type Translator } from "../lib/i18n/I18nContext";

/** Crew Adequacy panel — Phase C, Slice 3.
 *
 *  Renders a small card next to the Producer Roster that compares
 *  the suggested crew range (computed from the project's physical
 *  scope) against the actual headcount on the roster. The suggested
 *  range is always a *range*, never a single number, and we frame
 *  the result as a suggestion ("Suggested 6–8 riggers, you have 5
 *  → likely short by 1–3"). The PM remains the authority — the
 *  meter just flags shortages they might've missed.
 *
 *  Inputs split into two buckets:
 *    - **Derived** (from rigging / LED / lighting / stage tabs):
 *      hoistPoints, ledArea, stageArea, fixtureCount. The PM can't
 *      edit these here; they live elsewhere in the app and flow in
 *      via props.
 *    - **Project profile** (only the meter cares): setupDays,
 *      ledWallCount, ticketed. These don't have an obvious home
 *      anywhere else, so we surface a tiny inline form right on
 *      the panel. The defaults are deliberately conservative for
 *      a rental-house production (multi-day setup, non-ticketed,
 *      no walls) so a PM who never touches the form gets the same
 *      "no adequacy modifiers fired" baseline they'd get today. */
export function AdequacyPanel({
  derived,
  rosterRoles,
}: {
  /** Project-scope numbers pulled from elsewhere in the app
   *  (rigging tab → hoist points, LED tab → LED m², stage tab →
   *  stage m², lighting tab → fixture count). */
  derived: {
    hoistPoints: number;
    ledArea: number;
    stageArea: number;
    fixtureCount: number;
  };
  /** Free-text role strings from the merged roster. We classify
   *  them into the meter's role keys via `countRosterByAdequacyRole`
   *  so the producer's filing system (e.g. "Stage Hand" vs
   *  "Stage") still works. */
  rosterRoles: ReadonlyArray<string>;
}) {
  const t = useT();
  // Project-profile inputs are local component state. Persisting
  // them is overkill for Slice 3 — the meter is recomputed every
  // render and the producer can re-tick on reload. If usage shows
  // people want it sticky we can promote into App's persisted state
  // later without touching the lib.
  const [setupDays, setSetupDays] = useState<number>(2);
  const [ledWallCount, setLedWallCount] = useState<number>(0);
  const [ticketed, setTicketed] = useState<boolean>(false);

  const metrics: AdequacyMetrics = useMemo(
    () => ({
      hoistPoints: Math.max(0, Math.round(derived.hoistPoints)),
      ledArea: Math.max(0, derived.ledArea),
      stageArea: Math.max(0, derived.stageArea),
      fixtureCount: Math.max(0, Math.round(derived.fixtureCount)),
      setupDays: Math.max(0, Math.round(setupDays)),
      ledWallCount: Math.max(0, Math.round(ledWallCount)),
      ticketed,
    }),
    [derived, setupDays, ledWallCount, ticketed],
  );

  const currentByRole = useMemo(
    () => countRosterByAdequacyRole(rosterRoles),
    [rosterRoles],
  );

  const result = useMemo(
    () => computeCrewAdequacy(metrics, currentByRole),
    [metrics, currentByRole],
  );

  // Hide rows where the suggested range is 0–0 AND the producer has
  // 0 booked — they're noise (e.g. no FOH on a non-ticketed corporate
  // gig) and crowd the visible suggestions.
  const visible = result.suggestions.filter(
    (s) => !(s.min === 0 && s.max === 0 && s.current === 0),
  );

  return (
    <section className="led-card adequacy-card">
      <div className="led-card-head">
        <div>
          <h3>{t("adequacy.title")}</h3>
          <p className="led-report-sub">
            {t("adequacy.subtitle")}
          </p>
        </div>
      </div>

      {/* Project-profile mini-form. Compact so the panel doesn't
          dominate the tab. */}
      <div className="adequacy-profile">
        <label className="adequacy-field">
          <span>{t("adequacy.setupDays")}</span>
          <input
            type="number"
            min={0}
            step={1}
            value={setupDays}
            onChange={(e) => setSetupDays(Number(e.target.value) || 0)}
            className="led-input led-input-num"
          />
        </label>
        <label className="adequacy-field">
          <span>{t("adequacy.ledWalls")}</span>
          <input
            type="number"
            min={0}
            step={1}
            value={ledWallCount}
            onChange={(e) => setLedWallCount(Number(e.target.value) || 0)}
            className="led-input led-input-num"
          />
        </label>
        <label className="adequacy-field adequacy-check">
          <input
            type="checkbox"
            checked={ticketed}
            onChange={(e) => setTicketed(e.target.checked)}
          />
          <span>{t("adequacy.ticketed")}</span>
        </label>
      </div>

      {visible.length === 0 ? (
        <div className="led-empty">
          {t("adequacy.empty")}
        </div>
      ) : (
        <ul className="adequacy-list">
          {visible.map((s) => (
            <AdequacyRow key={s.role} s={s} t={t} />
          ))}
        </ul>
      )}
    </section>
  );
}

function AdequacyRow({ s, t }: { s: AdequacySuggestion; t: Translator }) {
  // Always render as a range, even when min === max. The whole
  // point of the meter is to communicate "this is a suggestion,
  // not a hard number" — collapsing "3–3" to "3" makes the
  // suggestion read like a prescription. "3–3" is a deliberate
  // visual cue that says "exactly three is what the formula wants,
  // but it's still up to you".
  const rangeLabel = `${s.min}–${s.max}`;
  // Verdict tone:
  //   - bad  → short of the lower bound (likely under-crewed)
  //   - warn → over the upper bound (likely over-crewed; soft warning)
  //   - ok   → within the suggested range
  const tone: "ok" | "warn" | "bad" =
    s.shortBy > 0 ? "bad" : s.over > 0 ? "warn" : "ok";

  let verdict: string;
  if (s.shortBy > 0) {
    const minShort = s.shortBy;
    const maxShort = Math.max(0, s.max - s.current);
    verdict =
      minShort === maxShort
        ? t("adequacy.verdict.short", { count: minShort })
        : t("adequacy.verdict.shortRange", { min: minShort, max: maxShort });
  } else if (s.over > 0) {
    verdict = t("adequacy.verdict.over", { count: s.over });
  } else {
    verdict = t("adequacy.verdict.covered");
  }

  // Modifier list rendered as a tooltip on the small "why" hint
  // beside the verdict. Empty modifier list (e.g. baseline rigger
  // recommendation) reads as "Base ratio" so the tooltip is never
  // empty.
  const reasonsTitle =
    s.modifiers.length > 0
      ? s.modifiers.map((modifier) => translateAdequacyModifier(modifier, t)).join("\n")
      : t("adequacy.baseRatio");

  return (
    <li className={`adequacy-row adequacy-row-${tone}`}>
      <div className="adequacy-row-head">
        <strong>{t(`adequacy.role.${s.role}` as Parameters<typeof t>[0])}</strong>
        <span className="adequacy-range">
          {t("adequacy.suggested")} <strong>{rangeLabel}</strong>
        </span>
      </div>
      <div className="adequacy-row-body">
        <span className="adequacy-current">
          {t("adequacy.youHave")} <strong>{s.current}</strong>
        </span>
        <span className="adequacy-arrow">→</span>
        <span className={`adequacy-verdict adequacy-verdict-${tone}`}>
          {verdict}
        </span>
        <span className="adequacy-why" title={reasonsTitle}>
          {t("adequacy.why")}
        </span>
      </div>
    </li>
  );
}

function translateAdequacyModifier(modifier: string, t: Translator): string {
  const number = modifier.match(/(\d+(?:\.\d+)?)/)?.[1] ?? "";
  if (modifier.startsWith("Tight setup window") && modifier.includes("toprigger")) return t("adequacy.reason.tightToprigger");
  if (modifier.startsWith("Tight setup window") && modifier.includes("stagehands")) return t("adequacy.reason.tightStagehands");
  if (modifier.startsWith("LED area")) return t("adequacy.reason.ledArea", { value: number });
  if (modifier.startsWith("Stage area")) return t("adequacy.reason.stageArea", { value: number });
  if (modifier.startsWith("Lighting fixtures")) return t("adequacy.reason.fixtures", { value: number });
  if (modifier.includes("Lights FOH")) return t("adequacy.reason.lightsBaseline");
  if (modifier.startsWith("~1 LD per")) {
    const values = modifier.match(/\d+(?:\.\d+)?/g) ?? [];
    return t("adequacy.reason.ldRatio", { per: values[0] ?? "", count: values[1] ?? "" });
  }
  if (modifier.includes("AV FOH")) return t("adequacy.reason.avBaseline");
  if (modifier.startsWith("1 video op")) {
    const values = modifier.match(/\d+(?:\.\d+)?/g) ?? [];
    return t("adequacy.reason.videoWalls", { count: values[1] ?? "" });
  }
  if (modifier.includes("Sound FOH")) return t("adequacy.reason.soundBaseline");
  if (modifier.startsWith("Ticketed show")) return t("adequacy.reason.ticketed");
  return t("adequacy.baseRatio");
}
