import { useState } from "react";
import { useFeedbackReports, useUpdateFeedbackStatus, type FeedbackReport } from "./hooks/use-feedback";
import { toast } from "sonner";
import { Toaster } from "./components/ui/sonner";
import { useI18n } from "./lib/i18n/I18nContext";

const statusColors: Record<FeedbackReport["status"], { bg: string; text: string }> = {
  open: { bg: "rgba(244,63,94,0.15)", text: "#fb7185" }, // danger red
  in_progress: { bg: "rgba(245,158,11,0.15)", text: "#fbbf24" }, // warning yellow
  resolved: { bg: "rgba(16,185,129,0.15)", text: "#34d399" }, // success green
};

const typeColors: Record<FeedbackReport["type"], { bg: string; text: string }> = {
  bug: { bg: "rgba(239,68,68,0.1)", text: "#f87171" }, // lighter red
  feature_request: { bg: "rgba(59,130,246,0.1)", text: "#60a5fa" }, // blue
};

function getSafePageUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? value : null;
  } catch {
    return null;
  }
}

export default function AdminFeedbackPage() {
  const { data: reports, isLoading, error } = useFeedbackReports();
  const updateStatus = useUpdateFeedbackStatus();
  const { t, locale } = useI18n();

  const [filterStatus, setFilterStatus] = useState<"all" | FeedbackReport["status"]>("all");
  const [filterType, setFilterType] = useState<"all" | FeedbackReport["type"]>("all");

  const filteredReports = (reports || []).filter((r) => {
    if (filterStatus !== "all" && r.status !== filterStatus) return false;
    if (filterType !== "all" && r.type !== filterType) return false;
    return true;
  });

  return (
    <div
      style={{
        minHeight: "100vh",
        padding: "32px 16px",
        background: "var(--page-bg, var(--dark, #0f0f14))",
        color: "var(--text-main, #fff)",
        boxSizing: "border-box",
        fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
      }}
    >
      <div
        style={{
          maxWidth: 1000,
          margin: "0 auto",
          background: "var(--card-bg, #1c1c24)",
          border: "1px solid var(--border-color, #2a2a34)",
          borderRadius: 12,
          padding: 24,
          boxShadow: "0 4px 24px rgba(0,0,0,0.2)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24, flexWrap: "wrap", gap: 16 }}>
          <div>
            <h1 style={{ margin: "0 0 8px", fontSize: 22 }}>{t("admin.feedback.title")}</h1>
            <p style={{ margin: 0, opacity: 0.7, fontSize: 14 }}>
              {t("admin.feedback.subtitle")}
            </p>
          </div>
          
          <div style={{ display: "flex", gap: 12 }}>
            <select
              value={filterType}
              onChange={(e) =>
                setFilterType(
                  e.target.value as "all" | FeedbackReport["type"],
                )
              }
              style={{
                padding: "8px 12px",
                borderRadius: 8,
                border: "1px solid var(--border-color, #2a2a34)",
                background: "var(--input-bg, #25252f)",
                color: "var(--text-main, #fff)",
                fontSize: 13,
                outline: "none",
                cursor: "pointer",
              }}
            >
              <option value="all">{t("admin.feedback.filter.allTypes")}</option>
              <option value="bug">{t("admin.feedback.type.bugs")}</option>
              <option value="feature_request">{t("admin.feedback.type.featureRequests")}</option>
            </select>
            
            <select
              value={filterStatus}
              onChange={(e) =>
                setFilterStatus(
                  e.target.value as "all" | FeedbackReport["status"],
                )
              }
              style={{
                padding: "8px 12px",
                borderRadius: 8,
                border: "1px solid var(--border-color, #2a2a34)",
                background: "var(--input-bg, #25252f)",
                color: "var(--text-main, #fff)",
                fontSize: 13,
                outline: "none",
                cursor: "pointer",
              }}
            >
              <option value="all">{t("admin.feedback.filter.allStatuses")}</option>
              <option value="open">{t("admin.feedback.status.open")}</option>
              <option value="in_progress">{t("admin.feedback.status.inProgress")}</option>
              <option value="resolved">{t("admin.feedback.status.resolved")}</option>
            </select>
          </div>
        </div>

        {isLoading ? (
          <div style={{ padding: 40, textAlign: "center", opacity: 0.5, fontSize: 14 }}>
            {t("admin.feedback.loading")}
          </div>
        ) : error ? (
          <div
            style={{
              padding: 12,
              borderRadius: 8,
              background: "rgba(192,57,43,0.15)",
              border: "1px solid rgba(192,57,43,0.4)",
              color: "#ff8a80",
              fontSize: 13,
            }}
          >
            {error instanceof Error ? error.message : t("admin.feedback.loadError")}
          </div>
        ) : filteredReports.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center", opacity: 0.5, fontSize: 14 }}>
            {t("admin.feedback.empty")}
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, textAlign: "left" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border-color, #2a2a34)", color: "var(--text-muted, rgba(255,255,255,0.5))" }}>
                  <th style={{ padding: "12px 16px", fontWeight: 500 }}>{t("admin.feedback.table.type")}</th>
                  <th style={{ padding: "12px 16px", fontWeight: 500 }}>{t("admin.feedback.table.report")}</th>
                  <th style={{ padding: "12px 16px", fontWeight: 500 }}>{t("admin.feedback.table.reporter")}</th>
                  <th style={{ padding: "12px 16px", fontWeight: 500 }}>{t("admin.feedback.table.date")}</th>
                  <th style={{ padding: "12px 16px", fontWeight: 500 }}>{t("admin.feedback.table.pageUrl")}</th>
                  <th style={{ padding: "12px 16px", fontWeight: 500 }}>{t("admin.feedback.table.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {filteredReports.map((report) => {
                  const safePageUrl = getSafePageUrl(report.pageUrl);
                  return (
                  <tr key={report.id} style={{ borderBottom: "1px solid var(--border-color, #2a2a34)", verticalAlign: "top" }}>
                    <td style={{ padding: "16px" }}>
                      <span
                        style={{
                          display: "inline-block",
                          padding: "2px 8px",
                          borderRadius: 999,
                          fontSize: 11,
                          fontWeight: 600,
                          background: typeColors[report.type].bg,
                          color: typeColors[report.type].text,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {report.type === "bug" ? t("admin.feedback.type.bug") : t("admin.feedback.type.feature")}
                      </span>
                    </td>
                    <td style={{ padding: "16px", minWidth: 250 }}>
                      <div style={{ fontWeight: 600, marginBottom: 4, color: "var(--text-main, #fff)", fontSize: 14 }}>
                        {report.title}
                      </div>
                      <div style={{ color: "var(--text-muted, rgba(255,255,255,0.7))", whiteSpace: "pre-wrap", marginBottom: 8, lineHeight: 1.4 }}>
                        {report.description}
                      </div>
                    </td>
                    <td style={{ padding: "16px", color: "var(--text-muted, rgba(255,255,255,0.7))" }}>
                      <div style={{ color: "var(--text-main, #fff)", fontWeight: 500 }}>{report.userEmail ?? t("admin.feedback.noVerifiedEmail")}</div>
                      <div style={{ fontSize: 12, marginTop: 2 }}>{report.userRole ?? t("common.unknown")}</div>
                    </td>
                    <td style={{ padding: "16px", color: "var(--text-muted, rgba(255,255,255,0.7))", whiteSpace: "nowrap" }}>
                      {new Date(report.createdAt).toLocaleDateString(locale === "no" ? "nb-NO" : "en-US")}
                    </td>
                    <td style={{ padding: "16px", maxWidth: 180 }}>
                      {safePageUrl ? (
                        <a
                          href={safePageUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={safePageUrl}
                          style={{
                            color: "var(--primary, #F88000)",
                            display: "block",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {safePageUrl}
                        </a>
                      ) : (
                        <span style={{ opacity: 0.5 }}>{t("admin.feedback.notProvided")}</span>
                      )}
                    </td>
                    <td style={{ padding: "16px" }}>
                      <select
                        value={report.status}
                        disabled={updateStatus.isPending && updateStatus.variables?.id === report.id}
                        onChange={async (e) => {
                           const newStatus = e.target
                             .value as FeedbackReport["status"];
                          try {
                            await updateStatus.mutate({ id: report.id, status: newStatus });
                             toast.success(t("admin.feedback.statusUpdated"));
                          } catch (err) {
                             toast.error(t("admin.feedback.updateError"));
                          }
                        }}
                        style={{
                          padding: "6px 10px",
                          borderRadius: 8,
                          border: `1px solid ${statusColors[report.status].text}`,
                          background: statusColors[report.status].bg,
                          color: statusColors[report.status].text,
                          fontWeight: 600,
                          fontSize: 12,
                          outline: "none",
                          cursor: "pointer",
                          appearance: "none",
                        }}
                      >
                        <option value="open">{t("admin.feedback.status.open")}</option>
                        <option value="in_progress">{t("admin.feedback.status.inProgress")}</option>
                        <option value="resolved">{t("admin.feedback.status.resolved")}</option>
                      </select>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
       <Toaster />
    </div>
  );
}
