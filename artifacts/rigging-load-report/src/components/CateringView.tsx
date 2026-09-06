import { useEffect, useMemo, useState } from "react";
import { openCateringSheet } from "../lib/cateringSheetExport";
import { useI18n, useT } from "../lib/i18n/I18nContext";

/** Server response shape for `GET /api/portal/briefs/:id/catering`.
 *  Mirrors what `portalBriefs.ts` returns. Kept inline (not in
 *  `lib/`) so this view is self-contained — it's the only consumer. */
type CateringResponse = {
  ok?: boolean;
  brief?: {
    id: string;
    projectName: string;
    venue: string;
  };
  days?: Array<{
    date: string;
    total: number;
    byCategory: Record<DietaryTag, number>;
    allergenRoster: Array<{
      userId: string;
      name: string;
      role: string;
      allergens: string[];
    }>;
  }>;
  categories?: ReadonlyArray<DietaryTag>;
  missing?: {
    profileless: Array<{ name: string; userId: string }>;
  };
  error?: string;
};

/** Must match the canonical tag list in `dietaryTags.ts` server-side.
 *  TypeScript will catch any drift here against the response shape. */
type DietaryTag =
  | "vegetarian"
  | "vegan"
  | "halal"
  | "gluten-free"
  | "lactose-free";

/** UTC-stable date formatter. We get YYYY-MM-DD strings from the
 *  server and want to render them as e.g. "Mon 18 May" without
 *  shifting them into the browser's local timezone (which would
 *  display the wrong day for crew west of UTC). */
function fmtDate(iso: string, locale: "en" | "no"): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(locale === "no" ? "nb-NO" : "en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
  });
}

type Props = {
  briefId: string;
  /** Async token resolver from Clerk's `useAuth`. Threaded in from
   *  App.tsx so this component stays decoupled from the auth lib. */
  getToken: () => Promise<string | null>;
};

/** Producer's per-brief catering aggregation view. Polls the server
 *  every 60 s while mounted so meal counts stay fresh as freelancers
 *  accept briefs or edit their assigned working days, without needing
 *  a manual refresh. The endpoint is owner-only — surfaces a clean
 *  error banner if the producer somehow lands here without owning the
 *  brief (shouldn't happen via the UI, but defensive). */
export function CateringView({ briefId, getToken }: Props) {
  const t = useT();
  const { locale } = useI18n();
  const categoryLabel: Record<DietaryTag, string> = {
    vegetarian: t("catering.category.vegetarian"),
    vegan: t("catering.category.vegan"),
    halal: t("catering.category.halal"),
    "gluten-free": t("catering.category.glutenFree"),
    "lactose-free": t("catering.category.lactoseFree"),
  };
  const [data, setData] = useState<CateringResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!briefId) return;
    let cancelled = false;
    const baseUrl =
      (typeof import.meta !== "undefined" &&
        (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL) ||
      "/";
    const fetchOnce = async () => {
      try {
        const token = await getToken();
        if (cancelled) return;
        const res = await fetch(
          `${baseUrl}api/portal/briefs/${briefId}/catering`,
          {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          },
        );
        if (cancelled) return;
        if (!res.ok) {
          const msg =
            res.status === 403
              ? t("catering.error.notOwner")
              : res.status === 404
                ? t("catering.error.notFound")
                : t("catering.error.load");
          setError(msg);
          setLoading(false);
          return;
        }
        const json = (await res.json()) as CateringResponse;
        if (cancelled) return;
        if (!json.ok) {
          setError(json.error ?? t("catering.error.load"));
          setLoading(false);
          return;
        }
        setData(json);
        setError(null);
        setLoading(false);
      } catch {
        if (cancelled) return;
        // Transient network error — keep showing the previous data
        // (if any) and let the next poll recover. Surface a quiet
        // banner so the producer knows the count might be stale.
        setError(t("catering.error.connection"));
        setLoading(false);
      }
    };
    void fetchOnce();
    const pollTimer = window.setInterval(fetchOnce, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(pollTimer);
    };
  }, [briefId, getToken, t]);

  // Project-wide totals — sum across days, plus unique-people counts
  // so the producer can sanity-check their roster size separately.
  const summary = useMemo(() => {
    if (!data?.days) return null;
    const dayCount = data.days.length;
    let mealsServed = 0;
    const peoplePerCat: Record<DietaryTag, Set<string>> = {
      vegetarian: new Set(),
      vegan: new Set(),
      halal: new Set(),
      "gluten-free": new Set(),
      "lactose-free": new Set(),
    };
    for (const d of data.days) {
      mealsServed += d.total;
      // We don't have per-person tags on a day directly here, but
      // `byCategory` already counts them per day. For the project
      // total we sum over days — same number a chef would order.
    }
    // Per-category meal totals (sum of daily counts, NOT unique
    // headcount — a vegan present on 5 days is 5 vegan meals, which
    // is what the kitchen actually plates).
    const mealsByCat: Record<DietaryTag, number> = {
      vegetarian: 0,
      vegan: 0,
      halal: 0,
      "gluten-free": 0,
      "lactose-free": 0,
    };
    for (const d of data.days) {
      for (const k of Object.keys(d.byCategory) as DietaryTag[]) {
        mealsByCat[k] += d.byCategory[k] ?? 0;
      }
    }
    return { dayCount, mealsServed, mealsByCat, peoplePerCat };
  }, [data]);

  if (loading && !data) {
    return (
      <div className="led-report">
        <header className="led-report-header">
          <h2>{t("catering.title")}</h2>
        </header>
        <div className="led-empty">{t("common.loading")}</div>
      </div>
    );
  }

  return (
    <div className="led-report">
      <header className="led-report-header">
        <div>
          <h2>{t("catering.title")}</h2>
          <p className="led-report-sub">
            {t("catering.subtitle")}
          </p>
        </div>
        {summary && (
          <div className="led-report-meta">
            <span className="badge">
              {t("catering.daysCount", { count: summary.dayCount })}
            </span>
            <span className="badge">
              {t("catering.mealsTotal", { count: summary.mealsServed })}
            </span>
            {/* One-click handoff to the venue chef. Disabled when
                there are no days yet — nothing useful to hand over. */}
            <button
              type="button"
              onClick={() => {
                if (!data?.brief || !data.days || data.days.length === 0) {
                  return;
                }
                openCateringSheet({
                  brief: data.brief,
                  days: data.days,
                  profilelessCount: data.missing?.profileless?.length ?? 0,
                  locale,
                  copy: {
                    categoryLabel,
                    days: t("catering.export.days"),
                    totalMeals: t("catering.export.totalMeals"),
                    noSpecialDietary: t("catering.export.noSpecialDietary"),
                    noAllergens: t("catering.export.noAllergens"),
                    name: t("catering.export.name"),
                    role: t("catering.export.role"),
                    allergens: t("catering.export.allergens"),
                    meals: t("catering.export.meals"),
                    cateringBrief: t("catering.export.brief"),
                    generated: t("catering.export.generated"),
                    profilelessNote: t("catering.export.profilelessNote", {
                      count: data.missing?.profileless?.length ?? 0,
                    }),
                    untitledProject: t("catering.export.untitledProject"),
                    venueTba: t("catering.export.venueTba"),
                    print: t("catering.export.print"),
                    footer: t("catering.export.footer", { id: data.brief.id }),
                  },
                });
              }}
              disabled={
                !data?.brief || !data.days || data.days.length === 0
              }
              style={{
                marginLeft: 8,
                padding: "6px 12px",
                fontSize: 13,
                fontWeight: 700,
                border: "none",
                borderRadius: 6,
                cursor:
                  !data?.brief || !data.days || data.days.length === 0
                    ? "not-allowed"
                    : "pointer",
                background:
                  !data?.brief || !data.days || data.days.length === 0
                    ? "var(--muted, #475569)"
                    : "#f88000",
                color: "#fff",
                opacity:
                  !data?.brief || !data.days || data.days.length === 0
                    ? 0.6
                    : 1,
              }}
              title={t("catering.printTitle")}
            >
              {t("catering.print")}
            </button>
          </div>
        )}
      </header>

      {error && (
        <div
          style={{
            margin: "0 0 12px 0",
            padding: "8px 12px",
            border: "1px solid #d97706",
            background: "#78350f22",
            color: "#fbbf24",
            borderRadius: 6,
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}

      {/* Project-wide category totals at a glance */}
      {summary && summary.dayCount > 0 && (
        <div className="led-dashboard">
          {(Object.keys(summary.mealsByCat) as DietaryTag[]).map((k) => (
            <div className="led-stat" key={k}>
              <div className="led-stat-label">{categoryLabel[k]}</div>
              <div className="led-stat-value">{summary.mealsByCat[k]}</div>
              <div className="led-stat-sub">{t("catering.mealsAcrossRun")}</div>
            </div>
          ))}
        </div>
      )}

      {/* Profileless nudge banner — chef can't know what these people
          eat until they fill in their portal profile. Producer sees
          who they are by name (or fallback) so they can chase. */}
      {data?.missing?.profileless && data.missing.profileless.length > 0 && (
        <section className="led-card" style={{ marginBottom: 16 }}>
          <div className="led-card-head">
            <h3>{t("catering.missing.title")}</h3>
          </div>
          <p
            style={{
              fontSize: 13,
              color: "var(--muted, #94a3b8)",
              marginBottom: 8,
            }}
          >
            {t("catering.missing.body")}
          </p>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {data.missing.profileless.map((p) => (
              <li key={p.userId} style={{ fontSize: 13 }}>
                {p.name}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Per-day cards — the bulk of the view. Empty state when the
          brief has no confirmed gigs with assigned working days yet. */}
      {!data?.days || data.days.length === 0 ? (
        <div className="led-empty">
          {t("catering.empty")}
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gap: 12,
            gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
          }}
        >
          {data.days.map((day) => (
            <DayCard key={day.date} day={day} locale={locale} t={t} categoryLabel={categoryLabel} />
          ))}
        </div>
      )}
    </div>
  );
}

function DayCard({
  day,
  locale,
  t,
  categoryLabel,
}: {
  day: NonNullable<CateringResponse["days"]>[number];
  locale: "en" | "no";
  t: ReturnType<typeof useT>;
  categoryLabel: Record<DietaryTag, string>;
}) {
  const tagsWithCounts = (Object.keys(day.byCategory) as DietaryTag[])
    .map((k) => ({ tag: k, count: day.byCategory[k] }))
    .filter((x) => x.count > 0);

  return (
    <section className="led-card">
      <div className="led-card-head">
        <h3 style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span>{fmtDate(day.date, locale)}</span>
          <span style={{ fontSize: 12, color: "var(--muted, #94a3b8)" }}>
            {day.date}
          </span>
        </h3>
        <span className="badge">
          {t("catering.mealsCount", { count: day.total })}
        </span>
      </div>

      {tagsWithCounts.length > 0 && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 6,
            marginBottom: 8,
          }}
        >
          {tagsWithCounts.map(({ tag, count }) => (
            <span
              key={tag}
              style={{
                fontSize: 12,
                padding: "3px 8px",
                borderRadius: 999,
                border: "1px solid var(--accent, #fbbf24)",
                color: "var(--accent, #fbbf24)",
                fontWeight: 600,
              }}
            >
              {categoryLabel[tag]} · {count}
            </span>
          ))}
        </div>
      )}

      {day.allergenRoster.length === 0 ? (
        <p
          style={{
            fontSize: 12,
            color: "var(--muted, #94a3b8)",
            margin: "8px 0 0 0",
          }}
        >
          {t("catering.noAllergens")}
        </p>
      ) : (
        <div style={{ marginTop: 8 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: 0.4,
              color: "var(--muted, #94a3b8)",
              marginBottom: 4,
            }}
          >
            {t("catering.allergens")}
          </div>
          <ul
            style={{
              listStyle: "none",
              margin: 0,
              padding: 0,
              display: "grid",
              gap: 4,
            }}
          >
            {day.allergenRoster.map((p) => (
              <li
                key={p.userId}
                style={{ fontSize: 13, lineHeight: 1.35 }}
              >
                <strong>{p.name}</strong>
                {p.role ? (
                  <span style={{ color: "var(--muted, #94a3b8)" }}>
                    {" "}
                    · {p.role}
                  </span>
                ) : null}
                <span style={{ color: "var(--muted, #94a3b8)" }}> — </span>
                <span>{p.allergens.join(", ")}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
