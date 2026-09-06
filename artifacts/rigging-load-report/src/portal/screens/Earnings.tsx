import { useMemo } from "react";
import { PALETTE, type ThemeMode } from "../lib/portalTheme";
import {
  gigEarnings,
  statusColor,
  statusLabelT,
  type Gig,
  type PortalData,
} from "../lib/portalStorage";
import { useI18n, useT } from "../../lib/i18n/I18nContext";

function formatNok(n: number): string {
  return new Intl.NumberFormat("nb-NO", {
    style: "currency",
    currency: "NOK",
    maximumFractionDigits: 0,
  }).format(Math.round(n));
}

function formatDayShort(iso: string, locale?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString(locale === "no" ? "nb-NO" : "en-GB", {
    day: "2-digit",
    month: "short",
    year: "2-digit",
  });
}

function csvEscape(value: string): string {
  // Defuse spreadsheet formula injection: cells starting with =, +, -, @, or
  // a tab/CR are interpreted as formulas by Excel/Sheets/Numbers. Prefix
  // with a single quote so the cell is rendered as plain text.
  let v = value;
  if (/^[=+\-@\t\r]/.test(v)) {
    v = `'${v}`;
  }
  if (/[",\n]/.test(v)) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}

function buildCsv(gigs: Gig[], t: ReturnType<typeof useT>): string {
  const header = [
    t("portal.earnings.csv.status"),
    t("portal.earnings.csv.project"),
    t("portal.earnings.csv.client"),
    t("portal.earnings.csv.role"),
    t("portal.earnings.csv.venue"),
    t("portal.earnings.csv.start"),
    t("portal.earnings.csv.end"),
    t("portal.earnings.csv.hours"),
    t("portal.earnings.csv.rate"),
    t("portal.earnings.csv.flatFee"),
    t("portal.earnings.csv.total"),
    t("portal.earnings.csv.notes"),
  ].map(csvEscape).join(",");
  const rows = gigs.map((g) =>
    [
      statusLabelT(g.status, t),
      g.projectName,
      g.client,
      g.role,
      g.venue,
      g.startDate,
      g.endDate,
      String(g.hours),
      String(g.rate),
      String(g.flatFee),
      String(Math.round(gigEarnings(g))),
      g.notes,
    ]
      .map(csvEscape)
      .join(","),
  );
  return [header, ...rows].join("\n");
}

function downloadCsv(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function Earnings({
  theme,
  data,
}: {
  theme: ThemeMode;
  data: PortalData;
}) {
  const c = PALETTE[theme];
  const t = useT();
  const { locale } = useI18n();

  const now = new Date();
  const yearStart = `${now.getFullYear()}-01-01`;
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;

  const totals = useMemo(() => {
    let month = 0;
    let year = 0;
    let allTime = 0;
    let readyToInvoice = 0;
    let invoicedNotPaid = 0;
    let paid = 0;
    for (const g of data.gigs) {
      const e = gigEarnings(g);
      allTime += e;
      if (g.startDate >= yearStart) year += e;
      if (g.startDate >= monthStart) month += e;
      if (g.status === "done") readyToInvoice += e;
      if (g.status === "invoiced") invoicedNotPaid += e;
      if (g.status === "paid") paid += e;
    }
    return { month, year, allTime, readyToInvoice, invoicedNotPaid, paid };
  }, [data.gigs, monthStart, yearStart]);

  const readyList = useMemo(
    () =>
      data.gigs
        .filter((g) => g.status === "done")
        .sort((a, b) => a.startDate.localeCompare(b.startDate)),
    [data.gigs],
  );

  const invoicedList = useMemo(
    () =>
      data.gigs
        .filter((g) => g.status === "invoiced")
        .sort((a, b) => a.startDate.localeCompare(b.startDate)),
    [data.gigs],
  );

  const history = useMemo(
    () =>
      data.gigs
        .filter((g) => g.status === "paid")
        .sort((a, b) => b.startDate.localeCompare(a.startDate)),
    [data.gigs],
  );

  function exportYear() {
    const yearGigs = data.gigs.filter((g) => g.startDate >= yearStart);
    if (yearGigs.length === 0) return;
    downloadCsv(
      `ehs-portal-earnings-${now.getFullYear()}.csv`,
      buildCsv(yearGigs, t),
    );
  }

  function exportReady() {
    if (readyList.length === 0) return;
    downloadCsv(
      `ehs-portal-ready-to-invoice-${new Date().toISOString().slice(0, 10)}.csv`,
      buildCsv(readyList, t),
    );
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800, flex: 1 }}>
          {t("portal.earnings.title")}
        </h1>
        <button
          type="button"
          onClick={exportYear}
          disabled={data.gigs.length === 0}
          style={{
            padding: "9px 14px",
            fontSize: 13,
            fontWeight: 700,
            background: c.cardBg,
            color: c.text,
            border: `1px solid ${c.border}`,
            borderRadius: 8,
            cursor: data.gigs.length === 0 ? "not-allowed" : "pointer",
            opacity: data.gigs.length === 0 ? 0.5 : 1,
          }}
        >
          {t("portal.earnings.exportYearCsv").replace("{year}", String(now.getFullYear()))}
        </button>
      </header>

      <section
        style={{
          display: "grid",
          gap: 12,
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
        }}
      >
        <Stat theme={theme} label={t("portal.earnings.thisMonth")} value={formatNok(totals.month)} accent />
        <Stat theme={theme} label={t("portal.earnings.ytd").replace("{year}", String(now.getFullYear()))} value={formatNok(totals.year)} />
        <Stat theme={theme} label={t("portal.earnings.readyToInvoice")} value={formatNok(totals.readyToInvoice)} />
        <Stat theme={theme} label={t("portal.earnings.outstanding")} value={formatNok(totals.invoicedNotPaid)} />
        <Stat theme={theme} label={t("portal.earnings.paidAllTime")} value={formatNok(totals.paid)} />
      </section>

      <Section
        theme={theme}
        title={t("portal.earnings.readyToInvoice")}
        action={
          readyList.length > 0 ? (
            <button
              type="button"
              onClick={exportReady}
              style={{
                padding: "6px 12px",
                fontSize: 12,
                fontWeight: 700,
                background: c.accent,
                color: "#0b0b0b",
                border: "none",
                borderRadius: 8,
                cursor: "pointer",
              }}
            >
              {t("portal.earnings.exportCsv")}
            </button>
          ) : null
        }
      >
        {readyList.length === 0 ? (
          <Empty theme={theme} text={t("portal.earnings.emptyReady")} />
        ) : (
          <GigTable theme={theme} gigs={readyList} t={t} />
        )}
      </Section>

      <Section theme={theme} title={t("portal.earnings.invoicedAwaiting")}>
        {invoicedList.length === 0 ? (
          <Empty theme={theme} text={t("portal.earnings.emptyInvoiced")} />
        ) : (
          <GigTable theme={theme} gigs={invoicedList} t={t} />
        )}
      </Section>

      <Section theme={theme} title={t("portal.earnings.paidHistory")}>
        {history.length === 0 ? (
          <Empty theme={theme} text={t("portal.earnings.emptyPaid")} />
        ) : (
          <GigTable theme={theme} gigs={history} t={t} />
        )}
      </Section>
    </div>
  );
}

function Stat({
  theme,
  label,
  value,
  accent,
}: {
  theme: ThemeMode;
  label: string;
  value: string;
  accent?: boolean;
}) {
  const c = PALETTE[theme];
  return (
    <div
      style={{
        background: c.cardBg,
        border: `1px solid ${c.border}`,
        borderRadius: 12,
        padding: 14,
        boxShadow: c.shadowSoft,
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 700, color: c.muted, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>
        {label}
      </div>
      <div
        style={{
          fontSize: 20,
          fontWeight: 800,
          color: accent ? c.accent : c.text,
        }}
      >
        {value}
      </div>
    </div>
  );
}

function Section({
  theme,
  title,
  action,
  children,
}: {
  theme: ThemeMode;
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  const c = PALETTE[theme];
  return (
    <section
      style={{
        background: c.cardBg,
        border: `1px solid ${c.border}`,
        borderRadius: 14,
        padding: 14,
        boxShadow: c.shadowSoft,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 10,
        }}
      >
        <h2
          style={{
            margin: 0,
            fontSize: 13,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: 0.6,
            color: c.muted,
            flex: 1,
          }}
        >
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Empty({ theme, text }: { theme: ThemeMode; text: string }) {
  const c = PALETTE[theme];
  return (
    <div
      style={{
        padding: "16px 4px",
        color: c.muted,
        fontSize: 13,
      }}
    >
      {text}
    </div>
  );
}

function GigTable({
  theme,
  gigs,
  t,
}: {
  theme: ThemeMode;
  gigs: Gig[];
  t: ReturnType<typeof useT>;
}) {
  const c = PALETTE[theme];
  const { locale } = useI18n();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {gigs.map((g) => {
        const sc = statusColor(g.status);
        return (
          <div
            key={g.id}
            style={{
              display: "flex",
              gap: 12,
              padding: "10px 12px",
              background: c.cardBgSubtle,
              border: `1px solid ${c.border}`,
              borderRadius: 10,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontSize: 14, fontWeight: 700 }}>
                {g.projectName}
              </div>
              <div style={{ fontSize: 12, color: c.muted, marginTop: 2 }}>
                {g.client ? `${g.client} · ` : ""}
                {formatDayShort(g.startDate, locale)}
                {g.endDate && g.endDate !== g.startDate
                  ? ` → ${formatDayShort(g.endDate, locale)}`
                  : ""}
              </div>
            </div>
            <div
              style={{
                fontSize: 14,
                fontWeight: 700,
                minWidth: 110,
                textAlign: "right",
              }}
            >
              {formatNok(gigEarnings(g))}
            </div>
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                padding: "4px 8px",
                borderRadius: 999,
                background: sc.bg,
                color: sc.fg,
              }}
            >
              {statusLabelT(g.status, t)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
