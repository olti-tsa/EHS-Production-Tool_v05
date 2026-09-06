import React, { useState, useEffect, useMemo } from "react";
import { 
  TrendingUp, TrendingDown, DollarSign, Clock, CreditCard, 
  FileSpreadsheet, Download, Plus, CheckCircle, XCircle, AlertCircle, RefreshCw,
  Search, Filter, ChevronRight, Settings, Flag, Edit2, Lock
} from "lucide-react";
import { useI18n, useT } from "../../lib/i18n/I18nContext";
import type { TranslationKey } from "../../lib/i18n/types";

// --- API Types ---

export type EconomyCategory = "labor" | "hotel" | "catering" | "transport" | "subRentals";

export type ProjectCategory = {
  category: EconomyCategory;
  budgetMinor: number;
  actualMinor: number;
  varianceMinor: number;
};

export type EasyjobData = {
  number: string | null;
  recordedRevenueMinor: number | null;
  differenceMinor: number | null;
  status: "unlinked" | "pending" | "matched" | "mismatch";
};

export type EconomyProject = {
  projectId: string;
  projectName: string;
  client: string | null;
  accessRole: "owner" | "editor" | "viewer";
  revenueMinor: number;
  totalExpensesMinor: number;
  netProfitMinor: number;
  netMarginBasisPoints: number;
  categories: ProjectCategory[];
  easyjob: EasyjobData;
};

export type EconomyTotals = {
  revenueMinor: number;
  expensesMinor: number;
  netProfitMinor: number;
};

export type EconomyExpense = {
  id: string;
  projectId: string;
  projectName: string;
  category: EconomyCategory;
  amountMinor: number;
  incurredOn: string;
  description: string;
  vendor: string | null;
  reference: string | null;
  accessRole: "owner" | "editor" | "viewer";
};

export type EconomyTimecard = {
  id: string;
  gigId: string;
  projectId: string;
  projectName: string;
  accessRole: "owner" | "editor" | "viewer";
  freelancerUserId: string;
  freelancerName: string;
  workDate: string;
  startMinute: number | null;
  endMinute: number | null;
  breakMinutes: number;
  producerBreakMinutes: number | null;
  producerAdjustmentMinutes: number | null;
  overtimeMinutes: number;
  workedMinutes: number;
  payableMinutes: number;
  rateMinor: number;
  flatFeeMinor: number | null;
  status: "draft" | "submitted" | "approved" | "rejected" | "flagged" | "locked";
  notes: string;
  rejectionReason: string | null;
  adjustmentReason: string | null;
  flagReason: string | null;
};

export type EconomyData = {
  ok: boolean;
  projects: EconomyProject[];
  totals: EconomyTotals;
  expenses: EconomyExpense[];
  timecards: EconomyTimecard[];
  laborMethod: string;
};

interface Props {
  getToken: () => Promise<string | null>;
  onOpenProject: (id: string) => void;
}

const TABS = ["Overview", "Projects", "Timecards", "Expenses", "Reconciliation"] as const;
type Tab = typeof TABS[number];
const TAB_LABEL_KEYS: Record<Tab, TranslationKey> = {
  Overview: "economy.tab.overview",
  Projects: "economy.tab.projects",
  Timecards: "economy.tab.timecards",
  Expenses: "economy.tab.expenses",
  Reconciliation: "economy.tab.reconciliation",
};

const CATEGORIES: EconomyCategory[] = ["labor", "hotel", "catering", "transport", "subRentals"];

function fmtMinor(minor: number | null | undefined, locale: string): string {
  if (minor == null) return "—";
  return new Intl.NumberFormat(locale === "no" ? "nb-NO" : "en-NO", { style: "currency", currency: "NOK", maximumFractionDigits: 0 }).format(minor / 100);
}

function fmtHours(min: number | null | undefined, locale: string): string {
  return new Intl.NumberFormat(locale === "no" ? "nb-NO" : "en-NO", {
    style: "unit", unit: "hour", unitDisplay: "narrow", maximumFractionDigits: 2,
  }).format((min ?? 0) / 60);
}

function minToHHMM(m: number | null | undefined): string {
  if (m == null) return "—";
  const h = Math.floor(m / 60);
  const min = m % 60;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

function fmtDate(value: string, locale: string): string {
  return new Intl.DateTimeFormat(locale === "no" ? "nb-NO" : "en-NO", {
    year: "numeric", month: "short", day: "numeric",
  }).format(new Date(`${value}T00:00:00`));
}

function fmtPercent(value: number, locale: string): string {
  return new Intl.NumberFormat(locale === "no" ? "nb-NO" : "en-NO", {
    style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1,
  }).format(value / 100);
}

export function EconomyDashboard({ getToken, onOpenProject }: Props) {
  const t = useT();
  const { locale } = useI18n();
  const categoryLabels = useMemo<Record<EconomyCategory, string>>(() => ({
    labor: t("economy.categories.labor"),
    hotel: t("economy.categories.hotel"),
    catering: t("economy.categories.catering"),
    transport: t("economy.categories.transport"),
    subRentals: t("economy.categories.subRentals"),
  }), [t]);
  const timecardStatusLabels = useMemo<Record<EconomyTimecard["status"], string>>(() => ({
    draft: t("economy.timecards.status.draft"),
    submitted: t("economy.timecards.status.submitted"),
    approved: t("economy.timecards.status.approved"),
    rejected: t("economy.timecards.status.rejected"),
    flagged: t("economy.timecards.status.flagged"),
    locked: t("economy.timecards.status.locked"),
  }), [t]);
  const reconciliationStatusLabels = useMemo<Record<EasyjobData["status"], string>>(() => ({
    unlinked: t("economy.recon.unlinked"),
    pending: t("economy.recon.pending"),
    matched: t("economy.recon.matched"),
    mismatch: t("economy.recon.mismatch"),
  }), [t]);
  const [activeTab, setActiveTab] = useState<Tab>("Overview");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [data, setData] = useState<EconomyData | null>(null);

  // Modals state
  const [expenseDraft, setExpenseDraft] = useState<{
    projectId: string;
    category: EconomyCategory;
    date: string;
    description: string;
    vendor: string;
    reference: string;
    amountMajor: string;
  } | null>(null);
  const [savingExpense, setSavingExpense] = useState(false);

  const [settingsDraft, setSettingsDraft] = useState<{
    projectId: string;
    projectName: string;
    contractRevenueMajor: string;
    easyjobRevenueMajor: string;
    laborBudgetMajor: string;
    hotelBudgetMajor: string;
    cateringBudgetMajor: string;
    transportBudgetMajor: string;
    subRentalsBudgetMajor: string;
  } | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);

  const [timecardAdjustDraft, setTimecardAdjustDraft] = useState<{
    id: string;
    breakMinutes: number;
    adjustmentMinutes: number;
    overtimeMinutes: number;
    reason: string;
  } | null>(null);
  
  const [timecardRejectDraft, setTimecardRejectDraft] = useState<{ id: string, decision: "reject" | "flag", reason: string } | null>(null);
  const [savingTimecard, setSavingTimecard] = useState(false);

  const fetchData = async (isBackground = false) => {
    if (!isBackground) setLoading(true);
    try {
      const token = await getToken();
      const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
      const baseUrl = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

      const res = await fetch(`${baseUrl}/api/economy`, { headers });
      if (!res.ok) {
        throw new Error(t("economy.error.loadStatus", { status: res.status }));
      }
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || t("economy.error.api"));
      setData(json);
      setError(null);
    } catch (err: any) {
      setError(err.message || t("economy.error.load"));
      if (!isBackground) setData(null);
    } finally {
      if (!isBackground) setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleExportCsv = async () => {
    try {
      const token = await getToken();
      const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
      const baseUrl = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
      
      const res = await fetch(`${baseUrl}/api/economy/export.csv`, { headers });
      if (!res.ok) throw new Error(t("economy.error.export"));
      
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `economy-export-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleSaveExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!expenseDraft) return;
    setSavingExpense(true);
    try {
      const token = await getToken();
      const baseUrl = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
      
      const amountMinor = Math.round(parseFloat(expenseDraft.amountMajor) * 100);
      
      const res = await fetch(`${baseUrl}/api/economy/projects/${encodeURIComponent(expenseDraft.projectId)}/expenses`, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json", 
          ...(token ? { Authorization: `Bearer ${token}` } : {}) 
        },
        body: JSON.stringify({
          category: expenseDraft.category,
          amountMinor,
          incurredOn: expenseDraft.date,
          description: expenseDraft.description,
          vendor: expenseDraft.vendor || undefined,
          reference: expenseDraft.reference || undefined,
        })
      });
      if (!res.ok) throw new Error(t("economy.error.saveExpense"));
      await fetchData(true);
      setExpenseDraft(null);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSavingExpense(false);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settingsDraft) return;
    setSavingSettings(true);
    try {
      const token = await getToken();
      const baseUrl = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
      
      const payload = {
        contractRevenueMinor: Math.round(parseFloat(settingsDraft.contractRevenueMajor || "0") * 100),
        easyjobRevenueMinor: Math.round(parseFloat(settingsDraft.easyjobRevenueMajor || "0") * 100),
        laborBudgetMinor: Math.round(parseFloat(settingsDraft.laborBudgetMajor || "0") * 100),
        hotelBudgetMinor: Math.round(parseFloat(settingsDraft.hotelBudgetMajor || "0") * 100),
        cateringBudgetMinor: Math.round(parseFloat(settingsDraft.cateringBudgetMajor || "0") * 100),
        transportBudgetMinor: Math.round(parseFloat(settingsDraft.transportBudgetMajor || "0") * 100),
        subRentalsBudgetMinor: Math.round(parseFloat(settingsDraft.subRentalsBudgetMajor || "0") * 100),
      };

      const res = await fetch(`${baseUrl}/api/economy/projects/${encodeURIComponent(settingsDraft.projectId)}/settings`, {
        method: "PATCH",
        headers: { 
          "Content-Type": "application/json", 
          ...(token ? { Authorization: `Bearer ${token}` } : {}) 
        },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error(t("economy.error.saveSettings"));
      await fetchData(true);
      setSettingsDraft(null);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSavingSettings(false);
    }
  };

  const handleTimecardDecide = async (id: string, decision: "approve" | "reject" | "flag", reason?: string) => {
    setSavingTimecard(true);
    try {
      const token = await getToken();
      const baseUrl = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
      const res = await fetch(`${baseUrl}/api/portal/time-entries/${encodeURIComponent(id)}/decide`, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json", 
          ...(token ? { Authorization: `Bearer ${token}` } : {}) 
        },
        body: JSON.stringify({ decision, reason: reason || "" })
      });
      if (!res.ok) throw new Error(t("economy.error.timecardDecision"));
      await fetchData(true);
      setTimecardRejectDraft(null);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSavingTimecard(false);
    }
  };

  const handleTimecardLock = async (id: string) => {
    setSavingTimecard(true);
    try {
      const token = await getToken();
      const baseUrl = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
      const res = await fetch(`${baseUrl}/api/portal/time-entries/${encodeURIComponent(id)}/lock`, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json", 
          ...(token ? { Authorization: `Bearer ${token}` } : {}) 
        },
        body: JSON.stringify({})
      });
      if (!res.ok) throw new Error(t("economy.error.lockTimecard"));
      await fetchData(true);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSavingTimecard(false);
    }
  };

  const handleSaveTimecardAdjust = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!timecardAdjustDraft) return;
    setSavingTimecard(true);
    try {
      const token = await getToken();
      const baseUrl = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
      const res = await fetch(`${baseUrl}/api/portal/time-entries/${encodeURIComponent(timecardAdjustDraft.id)}/adjust`, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json", 
          ...(token ? { Authorization: `Bearer ${token}` } : {}) 
        },
        body: JSON.stringify({
          adjustmentMinutes: timecardAdjustDraft.adjustmentMinutes,
          breakMinutes: timecardAdjustDraft.breakMinutes,
          overtimeMinutes: timecardAdjustDraft.overtimeMinutes,
          reason: timecardAdjustDraft.reason
        })
      });
      if (!res.ok) throw new Error(t("economy.error.adjustTimecard"));
      await fetchData(true);
      setTimecardAdjustDraft(null);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSavingTimecard(false);
    }
  };

  const openSettingsModal = (p: EconomyProject) => {
    if (p.accessRole !== "owner") return;
    
    // Extract budgets from categories array
    const catMap: Record<EconomyCategory, number> = { labor: 0, hotel: 0, catering: 0, transport: 0, subRentals: 0 };
    p.categories.forEach(c => catMap[c.category] = c.budgetMinor);

    setSettingsDraft({
      projectId: p.projectId,
      projectName: p.projectName,
      contractRevenueMajor: (p.revenueMinor / 100).toFixed(2),
      easyjobRevenueMajor: ((p.easyjob.recordedRevenueMinor || 0) / 100).toFixed(2),
      laborBudgetMajor: (catMap.labor / 100).toFixed(2),
      hotelBudgetMajor: (catMap.hotel / 100).toFixed(2),
      cateringBudgetMajor: (catMap.catering / 100).toFixed(2),
      transportBudgetMajor: (catMap.transport / 100).toFixed(2),
      subRentalsBudgetMajor: (catMap.subRentals / 100).toFixed(2),
    });
  };

  return (
    <div className="eco-container">
      <div className="eco-header">
        <div>
          <h2 className="eco-title">{t("economy.title")}</h2>
          <p className="eco-subtitle">{t("economy.subtitle")}</p>
        </div>
        <div className="eco-actions">
          <button className="ehs-ghost-btn" onClick={() => fetchData(false)}>
            <RefreshCw size={16} className={loading ? "spin" : ""} style={{ marginRight: 6 }} /> {t("economy.action.refresh")}
          </button>
          <button className="ehs-primary-btn" onClick={() => {
            if (data?.projects.length) {
              setExpenseDraft({
                projectId: data.projects[0].projectId,
                category: "hotel",
                date: new Date().toISOString().split("T")[0],
                description: "",
                vendor: "",
                reference: "",
                amountMajor: ""
              });
            } else {
              alert(t("economy.error.noProjectsForExpense"));
            }
          }}>
            <Plus size={16} style={{ marginRight: 6 }} /> {t("economy.action.addExpense")}
          </button>
        </div>
      </div>

      <div className="eco-tabs">
        {TABS.map(tab => (
          <button 
            key={tab} 
            className={`eco-tab ${activeTab === tab ? "is-active" : ""}`}
            onClick={() => setActiveTab(tab)}
          >
            {t(TAB_LABEL_KEYS[tab])}
            {tab === "Timecards" && data?.timecards.filter(t => t.status === "submitted").length ? (
              <span className="eco-tab-badge">{data.timecards.filter(t => t.status === "submitted").length}</span>
            ) : null}
          </button>
        ))}
      </div>

      {loading && !data ? (
        <div className="eco-loading" style={{ padding: 40, textAlign: "center", color: "var(--text-muted)", fontSize: 14 }}>
          {t("economy.loading")}
        </div>
      ) : error ? (
        <div className="eco-error" style={{ padding: 40, textAlign: "center", color: "var(--danger)", fontSize: 14 }}>
          <AlertCircle size={18} style={{ verticalAlign: "middle", marginRight: 6 }} /> {error}
        </div>
      ) : data ? (
        <div className="eco-content">
          
          {activeTab === "Overview" && (
            <div className="eco-overview">
              <div className="eco-kpi-grid">
                <div className="eco-kpi-card">
                  <div className="kpi-header">
                    <span className="kpi-label">{t("economy.kpi.revenue")}</span>
                    <TrendingUp size={20} color="var(--success)" />
                  </div>
                  <div className="kpi-value">{fmtMinor(data.totals.revenueMinor, locale)}</div>
                  <div className="kpi-meta">{t("economy.kpi.revenueMeta", { n: data.projects.length })}</div>
                </div>
                <div className="eco-kpi-card">
                  <div className="kpi-header">
                    <span className="kpi-label">{t("economy.kpi.expenses")}</span>
                    <TrendingDown size={20} color="var(--danger)" />
                  </div>
                  <div className="kpi-value">{fmtMinor(data.totals.expensesMinor, locale)}</div>
                  <div className="kpi-meta">{t("economy.kpi.expensesMeta")}</div>
                </div>
                <div className="eco-kpi-card">
                  <div className="kpi-header">
                    <span className="kpi-label">{t("economy.kpi.profit")}</span>
                    <DollarSign size={20} color="var(--primary)" />
                  </div>
                  <div className={`kpi-value ${data.totals.netProfitMinor < 0 ? 'text-danger' : 'text-success'}`}>
                    {fmtMinor(data.totals.netProfitMinor, locale)}
                  </div>
                  <div className="kpi-meta">
                    {data.totals.revenueMinor > 0 
                      ? t("economy.kpi.margin", { pct: new Intl.NumberFormat(locale === "no" ? "nb-NO" : "en-NO", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format((data.totals.netProfitMinor / data.totals.revenueMinor) * 100) })
                      : t("economy.kpi.marginZero")}
                  </div>
                </div>
              </div>

              <div className="eco-panel">
                <div className="panel-header">
                  <h3>{t("economy.overview.title")}</h3>
                </div>
                <div className="eco-table-wrap">
                  <table className="eco-table">
                    <thead>
                      <tr>
                        <th>{t("economy.overview.table.project")}</th>
                        <th style={{ textAlign: "right" }}>{t("economy.overview.table.revenue")}</th>
                        <th style={{ textAlign: "right" }}>{t("economy.overview.table.expenses")}</th>
                        <th style={{ textAlign: "right" }}>{t("economy.overview.table.profit")}</th>
                        <th style={{ textAlign: "right" }}>{t("economy.overview.table.margin")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.projects.map(p => (
                        <tr key={p.projectId}>
                          <td>
                            <span className="eco-link" onClick={() => onOpenProject(p.projectId)}>{p.projectName}</span>
                          </td>
                          <td style={{ textAlign: "right" }}>{fmtMinor(p.revenueMinor, locale)}</td>
                          <td style={{ textAlign: "right" }}>{fmtMinor(p.totalExpensesMinor, locale)}</td>
                          <td style={{ textAlign: "right" }} className={p.netProfitMinor < 0 ? "text-danger" : "text-success"}>
                            {fmtMinor(p.netProfitMinor, locale)}
                          </td>
                          <td style={{ textAlign: "right" }}>
                            <span className={`eco-tag ${p.netMarginBasisPoints < 0 ? 'is-danger' : p.netMarginBasisPoints > 2000 ? 'is-success' : ''}`}>
                              {fmtPercent(p.netMarginBasisPoints / 100, locale)}
                            </span>
                          </td>
                        </tr>
                      ))}
                      {data.projects.length === 0 && (
                        <tr><td colSpan={5} className="eco-empty">{t("economy.overview.empty")}</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {activeTab === "Projects" && (
            <div className="eco-project-grid">
              {data.projects.map(p => (
                <div key={p.projectId} className="eco-panel project-card">
                  <div className="panel-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <h3 className="eco-link" style={{ margin: "0 0 4px 0" }} onClick={() => onOpenProject(p.projectId)}>{p.projectName}</h3>
                      <div className="eco-muted" style={{ fontSize: 12 }}>{t("economy.projects.client", { client: p.client || t("economy.projects.clientNone") })}</div>
                    </div>
                    {p.accessRole === "owner" && (
                      <button className="ehs-ghost-btn" onClick={() => openSettingsModal(p)}>
                        <Settings size={14} style={{ marginRight: 6 }} /> {t("economy.projects.settings")}
                      </button>
                    )}
                  </div>
                  <div className="project-card-stats">
                    <div className="pc-stat">
                      <span>{t("economy.projects.revenue")}</span>
                      <strong>{fmtMinor(p.revenueMinor, locale)}</strong>
                    </div>
                    <div className="pc-stat">
                      <span>{t("economy.projects.expenses")}</span>
                      <strong>{fmtMinor(p.totalExpensesMinor, locale)}</strong>
                    </div>
                    <div className="pc-stat">
                      <span>{t("economy.projects.margin")}</span>
                      <strong className={p.netMarginBasisPoints < 0 ? 'text-danger' : 'text-success'}>
                        {fmtPercent(p.netMarginBasisPoints / 100, locale)}
                      </strong>
                    </div>
                  </div>
                  
                  <div className="breakdown-list">
                    {p.categories.map(cat => {
                      const percent = cat.budgetMinor > 0 ? Math.min((cat.actualMinor / cat.budgetMinor) * 100, 100) : 0;
                      const isOver = cat.varianceMinor < 0; // if actual > budget, variance is negative

                      return (
                        <div key={cat.category} className="breakdown-item">
                          <div className="bd-labels">
                            <span className="bd-name">{categoryLabels[cat.category]}</span>
                            <div className="bd-values">
                              <strong>{fmtMinor(cat.actualMinor, locale)}</strong>
                              <span className="bd-divider">/</span>
                              <span className="bd-budget">
                                {cat.budgetMinor > 0 ? fmtMinor(cat.budgetMinor, locale) : t("economy.projects.noBudget")}
                              </span>
                            </div>
                          </div>
                          <div className="bd-bar-bg">
                            <div 
                              className={`bd-bar-fill ${isOver ? 'is-over' : ''}`} 
                              style={{ width: `${percent}%` }} 
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
              {data.projects.length === 0 && (
                <div className="eco-empty">{t("economy.overview.empty")}</div>
              )}
            </div>
          )}

          {activeTab === "Timecards" && (
            <div className="eco-panel">
              <div className="panel-header" style={{ display: "flex", justifyContent: "space-between" }}>
                <h3 style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {t("economy.timecards.title")}
                </h3>
              </div>
              <div className="eco-table-wrap">
                <table className="eco-table">
                  <thead>
                    <tr>
                      <th>{t("economy.timecards.table.freelancer")}</th>
                      <th>{t("economy.timecards.table.project")}</th>
                      <th>{t("economy.timecards.table.date")}</th>
                      <th>{t("economy.timecards.table.hours")}</th>
                      <th>{t("economy.timecards.table.cost")}</th>
                      <th>{t("economy.timecards.table.status")}</th>
                      <th>{t("economy.timecards.table.actions")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.timecards.sort((a,b) => new Date(b.workDate).getTime() - new Date(a.workDate).getTime()).map(timecard => {
                      const costMinor = (timecard.flatFeeMinor ?? 0) > 0 ? timecard.flatFeeMinor! : Math.ceil((timecard.payableMinutes * timecard.rateMinor) / 60);
                      return (
                        <tr key={timecard.id}>
                          <td>
                            <div style={{ fontWeight: 500 }}>{timecard.freelancerName}</div>
                            {timecard.notes && <div className="eco-muted" style={{ fontSize: 11, maxWidth: 200, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={timecard.notes}>{timecard.notes}</div>}
                          </td>
                          <td>
                            <span className="eco-link" onClick={() => onOpenProject(timecard.projectId)}>{timecard.projectName}</span>
                          </td>
                          <td>{fmtDate(timecard.workDate, locale)}</td>
                          <td>
                            <div style={{ fontWeight: 600 }}>{fmtHours(timecard.payableMinutes, locale)} ({minToHHMM(timecard.payableMinutes)})</div>
                            {(timecard.producerAdjustmentMinutes || 0) !== 0 && (
                              <div style={{ fontSize: 11, color: "var(--primary)" }}>
                                {t("economy.timecards.adj", { adj: `${timecard.producerAdjustmentMinutes! > 0 ? "+" : ""}${timecard.producerAdjustmentMinutes}` })}
                              </div>
                            )}
                          </td>
                          <td>{fmtMinor(costMinor, locale)}</td>
                          <td>
                            <span className={`eco-status-pill status-${timecard.status}`}>{timecardStatusLabels[timecard.status]}</span>
                            {timecard.flagReason && <div style={{ fontSize: 10, color: "var(--danger)", marginTop: 4 }}>{t("economy.timecards.flag", { reason: timecard.flagReason })}</div>}
                          </td>
                          <td>
                            {timecard.accessRole === "owner" && (
                              <div className="eco-row-actions">
                                {timecard.status === "submitted" && (
                                  <>
                                    <button className="btn-approve" onClick={() => handleTimecardDecide(timecard.id, "approve")}><CheckCircle size={14} /> {t("economy.timecards.action.approve")}</button>
                                    <button className="btn-reject" onClick={() => setTimecardRejectDraft({ id: timecard.id, decision: "reject", reason: "" })}><XCircle size={14} /> {t("economy.timecards.action.reject")}</button>
                                    <button className="btn-flag" onClick={() => setTimecardRejectDraft({ id: timecard.id, decision: "flag", reason: "" })}><Flag size={14} /> {t("economy.timecards.action.flag")}</button>
                                  </>
                                )}
                                {timecard.status === "submitted" && (
                                  <button className="btn-adjust" onClick={() => setTimecardAdjustDraft({
                                    id: timecard.id,
                                    breakMinutes: timecard.producerBreakMinutes ?? timecard.breakMinutes,
                                    adjustmentMinutes: timecard.producerAdjustmentMinutes || 0,
                                    overtimeMinutes: timecard.overtimeMinutes,
                                    reason: ""
                                  })}><Edit2 size={14} /> {t("economy.timecards.action.adjust")}</button>
                                )}
                                {timecard.status === "approved" && (
                                  <button className="btn-lock" onClick={() => handleTimecardLock(timecard.id)}><Lock size={14} /> {t("economy.timecards.action.lock")}</button>
                                )}
                              </div>
                            )}
                            {timecard.accessRole !== "owner" && <span className="eco-muted">{t("economy.timecards.readonly")}</span>}
                          </td>
                        </tr>
                      )
                    })}
                    {data.timecards.length === 0 && (
                      <tr><td colSpan={7} className="eco-empty">{t("economy.timecards.empty")}</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === "Expenses" && (
            <div className="eco-panel">
              <div className="panel-header">
                <h3>{t("economy.expenses.title")}</h3>
              </div>
              <div className="eco-table-wrap">
                <table className="eco-table">
                  <thead>
                    <tr>
                      <th>{t("economy.expenses.table.date")}</th>
                      <th>{t("economy.expenses.table.project")}</th>
                      <th>{t("economy.expenses.table.category")}</th>
                      <th>{t("economy.expenses.table.description")}</th>
                      <th>{t("economy.expenses.table.vendor")}</th>
                      <th style={{ textAlign: "right" }}>{t("economy.expenses.table.amount")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.expenses.sort((a,b) => new Date(b.incurredOn).getTime() - new Date(a.incurredOn).getTime()).map(e => (
                      <tr key={e.id}>
                        <td>{fmtDate(e.incurredOn, locale)}</td>
                        <td>
                          <span className="eco-link" onClick={() => onOpenProject(e.projectId)}>{e.projectName}</span>
                        </td>
                        <td><span className="eco-tag">{categoryLabels[e.category]}</span></td>
                        <td>{e.description}</td>
                        <td>
                          <div style={{ fontSize: 12, fontWeight: 500 }}>{e.vendor || "—"}</div>
                          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{e.reference || "—"}</div>
                        </td>
                        <td style={{ textAlign: "right", fontWeight: 500 }}>{fmtMinor(e.amountMinor, locale)}</td>
                      </tr>
                    ))}
                    {data.expenses.length === 0 && (
                      <tr><td colSpan={6} className="eco-empty">{t("economy.expenses.empty")}</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === "Reconciliation" && (
            <div className="eco-panel">
              <div className="panel-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <h3 style={{ margin: 0 }}>{t("economy.recon.title")}</h3>
                <button className="ehs-ghost-btn" style={{ padding: "4px 12px", fontSize: 12, fontWeight: 600 }} onClick={handleExportCsv}>
                  <Download size={14} style={{ marginRight: 6 }} /> {t("economy.recon.export")}
                </button>
              </div>
              <div className="eco-table-wrap">
                <table className="eco-table">
                  <thead>
                    <tr>
                      <th>{t("economy.recon.table.project")}</th>
                      <th>{t("economy.recon.table.easyjobId")}</th>
                      <th style={{ textAlign: "right" }}>{t("economy.recon.table.internalRev")}</th>
                      <th style={{ textAlign: "right" }}>{t("economy.recon.table.easyjobRev")}</th>
                      <th style={{ textAlign: "right" }}>{t("economy.recon.table.difference")}</th>
                      <th>{t("economy.recon.table.status")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.projects.map(p => (
                      <tr key={p.projectId}>
                        <td><span className="eco-link" onClick={() => onOpenProject(p.projectId)}>{p.projectName}</span></td>
                        <td style={{ fontFamily: "monospace" }}>{p.easyjob.number || "—"}</td>
                        <td style={{ textAlign: "right", color: "var(--text-muted)" }}>{fmtMinor(p.revenueMinor, locale)}</td>
                        <td style={{ textAlign: "right", fontWeight: 500 }}>{fmtMinor(p.easyjob.recordedRevenueMinor, locale)}</td>
                        <td style={{ textAlign: "right", color: (p.easyjob.differenceMinor || 0) < 0 ? "var(--danger)" : (p.easyjob.differenceMinor || 0) > 0 ? "var(--success)" : "inherit" }}>
                          {(p.easyjob.differenceMinor || 0) > 0 ? "+" : ""}{fmtMinor(p.easyjob.differenceMinor, locale)}
                        </td>
                        <td>
                          <span className={`eco-status-pill status-${p.easyjob.status}`}>{reconciliationStatusLabels[p.easyjob.status]}</span>
                        </td>
                      </tr>
                    ))}
                    {data.projects.length === 0 && (
                      <tr><td colSpan={6} className="eco-empty">{t("economy.recon.empty")}</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

        </div>
      ) : null}

      {/* Settings Modal */}
      {settingsDraft && (
        <div className="ehs-modal-backdrop" onClick={() => !savingSettings && setSettingsDraft(null)}>
          <div className="ehs-modal" style={{ maxWidth: 500, width: "100%", minWidth: "min(100vw - 32px, 320px)" }} onClick={e => e.stopPropagation()}>
            <div className="ehs-modal-header">
              <h3>{t("economy.modal.settings.title", { project: settingsDraft.projectName })}</h3>
              <button aria-label={t("common.close")} className="ehs-ghost-btn" style={{ padding: 4 }} onClick={() => setSettingsDraft(null)}><XCircle size={16} /></button>
            </div>
            <form onSubmit={handleSaveSettings}>
              <div className="ehs-modal-body">
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16 }}>
                  <div className="ehs-form-group">
                    <label>{t("economy.modal.settings.contractRevenue")}</label>
                    <input type="number" required min="0" step="0.01" className="ehs-input" value={settingsDraft.contractRevenueMajor} onChange={e => setSettingsDraft({...settingsDraft, contractRevenueMajor: e.target.value})} />
                  </div>
                  <div className="ehs-form-group">
                    <label>{t("economy.modal.settings.easyjobRevenue")}</label>
                    <input type="number" min="0" step="0.01" className="ehs-input" value={settingsDraft.easyjobRevenueMajor} onChange={e => setSettingsDraft({...settingsDraft, easyjobRevenueMajor: e.target.value})} />
                  </div>
                </div>

                <hr style={{ margin: "16px 0", border: "none", borderTop: "1px solid var(--border-color)" }} />
                <h4 style={{ margin: "0 0 12px", fontSize: 13, color: "var(--text-main)" }}>{t("economy.modal.settings.budgets")}</h4>
                
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16 }}>
                  <div className="ehs-form-group">
                    <label>{categoryLabels.labor}</label>
                    <input type="number" min="0" step="0.01" className="ehs-input" value={settingsDraft.laborBudgetMajor} onChange={e => setSettingsDraft({...settingsDraft, laborBudgetMajor: e.target.value})} />
                  </div>
                  <div className="ehs-form-group">
                    <label>{categoryLabels.hotel}</label>
                    <input type="number" min="0" step="0.01" className="ehs-input" value={settingsDraft.hotelBudgetMajor} onChange={e => setSettingsDraft({...settingsDraft, hotelBudgetMajor: e.target.value})} />
                  </div>
                  <div className="ehs-form-group">
                    <label>{categoryLabels.catering}</label>
                    <input type="number" min="0" step="0.01" className="ehs-input" value={settingsDraft.cateringBudgetMajor} onChange={e => setSettingsDraft({...settingsDraft, cateringBudgetMajor: e.target.value})} />
                  </div>
                  <div className="ehs-form-group">
                    <label>{categoryLabels.transport}</label>
                    <input type="number" min="0" step="0.01" className="ehs-input" value={settingsDraft.transportBudgetMajor} onChange={e => setSettingsDraft({...settingsDraft, transportBudgetMajor: e.target.value})} />
                  </div>
                  <div className="ehs-form-group">
                    <label>{categoryLabels.subRentals}</label>
                    <input type="number" min="0" step="0.01" className="ehs-input" value={settingsDraft.subRentalsBudgetMajor} onChange={e => setSettingsDraft({...settingsDraft, subRentalsBudgetMajor: e.target.value})} />
                  </div>
                </div>
              </div>
              <div className="ehs-modal-footer">
                <button type="button" className="ehs-ghost-btn" onClick={() => setSettingsDraft(null)}>{t("common.cancel")}</button>
                <button type="submit" className="ehs-primary-btn" disabled={savingSettings}>
                  {savingSettings ? t("common.saving") : t("economy.modal.settings.save")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Expense Modal */}
      {expenseDraft && (
        <div className="ehs-modal-backdrop" onClick={() => !savingExpense && setExpenseDraft(null)}>
          <div className="ehs-modal" style={{ width: "100%", minWidth: "min(100vw - 32px, 320px)" }} onClick={e => e.stopPropagation()}>
            <div className="ehs-modal-header">
              <h3>{t("economy.modal.expense.title")}</h3>
              <button aria-label={t("common.close")} className="ehs-ghost-btn" style={{ padding: 4 }} onClick={() => setExpenseDraft(null)}><XCircle size={16} /></button>
            </div>
            <form onSubmit={handleSaveExpense}>
              <div className="ehs-modal-body">
                <div className="ehs-form-group">
                  <label>{t("economy.modal.expense.project")}</label>
                  <select 
                    required
                    className="ehs-input" 
                    value={expenseDraft.projectId} 
                    onChange={e => setExpenseDraft({...expenseDraft, projectId: e.target.value})}
                  >
                    {data?.projects.map(p => (
                      <option key={p.projectId} value={p.projectId} disabled={p.accessRole === 'viewer'}>{p.projectName}</option>
                    ))}
                  </select>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16 }}>
                  <div className="ehs-form-group">
                    <label>{t("economy.modal.expense.category")}</label>
                    <select 
                      required 
                      className="ehs-input" 
                      value={expenseDraft.category} 
                      onChange={e => setExpenseDraft({...expenseDraft, category: e.target.value as EconomyCategory})}
                    >
                      {CATEGORIES.map(c => <option key={c} value={c}>{categoryLabels[c]}</option>)}
                    </select>
                  </div>
                  <div className="ehs-form-group">
                    <label>{t("economy.modal.expense.date")}</label>
                    <input type="date" required className="ehs-input" value={expenseDraft.date} onChange={e => setExpenseDraft({...expenseDraft, date: e.target.value})} />
                  </div>
                </div>
                <div className="ehs-form-group">
                  <label>{t("economy.modal.expense.amount")}</label>
                  <input type="number" required min="0" step="0.01" className="ehs-input" value={expenseDraft.amountMajor} onChange={e => setExpenseDraft({...expenseDraft, amountMajor: e.target.value})} placeholder="0.00" />
                </div>
                <div className="ehs-form-group">
                  <label>{t("economy.modal.expense.description")}</label>
                  <input required className="ehs-input" value={expenseDraft.description} onChange={e => setExpenseDraft({...expenseDraft, description: e.target.value})} placeholder={t("economy.modal.expense.descriptionPlaceholder")} />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16 }}>
                  <div className="ehs-form-group">
                    <label>{t("economy.modal.expense.vendor")}</label>
                    <input className="ehs-input" value={expenseDraft.vendor} onChange={e => setExpenseDraft({...expenseDraft, vendor: e.target.value})} placeholder={t("economy.modal.expense.vendorPlaceholder")} />
                  </div>
                  <div className="ehs-form-group">
                    <label>{t("economy.modal.expense.reference")}</label>
                    <input className="ehs-input" value={expenseDraft.reference} onChange={e => setExpenseDraft({...expenseDraft, reference: e.target.value})} placeholder={t("economy.modal.expense.referencePlaceholder")} />
                  </div>
                </div>
              </div>
              <div className="ehs-modal-footer">
                <button type="button" className="ehs-ghost-btn" onClick={() => setExpenseDraft(null)}>{t("common.cancel")}</button>
                <button type="submit" className="ehs-primary-btn" disabled={savingExpense}>
                  {savingExpense ? t("common.saving") : t("economy.modal.expense.save")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Timecard Adjust Modal */}
      {timecardAdjustDraft && (
        <div className="ehs-modal-backdrop" onClick={() => !savingTimecard && setTimecardAdjustDraft(null)}>
          <div className="ehs-modal" style={{ maxWidth: 400, width: "100%", minWidth: "min(100vw - 32px, 320px)" }} onClick={e => e.stopPropagation()}>
            <div className="ehs-modal-header">
              <h3>{t("economy.modal.adjust.title")}</h3>
              <button aria-label={t("common.close")} className="ehs-ghost-btn" style={{ padding: 4 }} onClick={() => setTimecardAdjustDraft(null)}><XCircle size={16} /></button>
            </div>
            <form onSubmit={handleSaveTimecardAdjust}>
              <div className="ehs-modal-body">
                <div className="ehs-form-group">
                  <label>{t("economy.modal.adjust.break")}</label>
                  <input type="number" required min="0" className="ehs-input" value={timecardAdjustDraft.breakMinutes} onChange={e => setTimecardAdjustDraft({...timecardAdjustDraft, breakMinutes: parseInt(e.target.value) || 0})} />
                </div>
                <div className="ehs-form-group">
                  <label>{t("economy.modal.adjust.adjustment")}</label>
                  <input type="number" required className="ehs-input" value={timecardAdjustDraft.adjustmentMinutes} onChange={e => setTimecardAdjustDraft({...timecardAdjustDraft, adjustmentMinutes: parseInt(e.target.value) || 0})} />
                </div>
                <div className="ehs-form-group">
                  <label>{t("economy.modal.adjust.overtime")}</label>
                  <input type="number" required min="0" className="ehs-input" value={timecardAdjustDraft.overtimeMinutes} onChange={e => setTimecardAdjustDraft({...timecardAdjustDraft, overtimeMinutes: parseInt(e.target.value) || 0})} />
                </div>
                <div className="ehs-form-group">
                  <label>{t("economy.modal.adjust.reason")}</label>
                  <input required className="ehs-input" value={timecardAdjustDraft.reason} onChange={e => setTimecardAdjustDraft({...timecardAdjustDraft, reason: e.target.value})} placeholder={t("economy.modal.adjust.reasonPlaceholder")} />
                </div>
              </div>
              <div className="ehs-modal-footer">
                <button type="button" className="ehs-ghost-btn" onClick={() => setTimecardAdjustDraft(null)}>{t("common.cancel")}</button>
                <button type="submit" className="ehs-primary-btn" disabled={savingTimecard}>
                  {savingTimecard ? t("common.saving") : t("economy.modal.adjust.save")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Timecard Reject/Flag Modal */}
      {timecardRejectDraft && (
        <div className="ehs-modal-backdrop" onClick={() => !savingTimecard && setTimecardRejectDraft(null)}>
          <div className="ehs-modal" style={{ maxWidth: 400, width: "100%", minWidth: "min(100vw - 32px, 320px)" }} onClick={e => e.stopPropagation()}>
            <div className="ehs-modal-header">
              <h3>{timecardRejectDraft.decision === "flag" ? t("economy.modal.timecard.flag") : t("economy.modal.timecard.reject")}</h3>
              <button aria-label={t("common.close")} className="ehs-ghost-btn" style={{ padding: 4 }} onClick={() => setTimecardRejectDraft(null)}><XCircle size={16} /></button>
            </div>
            <form onSubmit={(e) => { e.preventDefault(); handleTimecardDecide(timecardRejectDraft.id, timecardRejectDraft.decision, timecardRejectDraft.reason); }}>
              <div className="ehs-modal-body">
                <div className="ehs-form-group">
                  <label>{t("economy.modal.timecard.reason")}</label>
                  <textarea required className="ehs-input" rows={3} value={timecardRejectDraft.reason} onChange={e => setTimecardRejectDraft({...timecardRejectDraft, reason: e.target.value})} placeholder={t("economy.modal.timecard.reasonPlaceholder")} />
                </div>
              </div>
              <div className="ehs-modal-footer">
                <button type="button" className="ehs-ghost-btn" onClick={() => setTimecardRejectDraft(null)}>{t("common.cancel")}</button>
                <button type="submit" className="ehs-primary-btn" disabled={savingTimecard}>
                  {savingTimecard ? t("economy.modal.timecard.submitting") : t("economy.modal.timecard.submit", { action: timecardRejectDraft.decision === "flag" ? t("economy.timecards.action.flag") : t("economy.timecards.action.reject") })}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <style dangerouslySetInnerHTML={{__html: `
        .eco-container {
          padding: 0 16px 40px;
          max-width: 1400px;
          margin: 0 auto;
        }
        .eco-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-end;
          margin-bottom: 24px;
        }
        .eco-title {
          font-size: 1.5rem;
          font-weight: 300;
          margin: 0 0 8px 0;
          color: var(--text-main);
        }
        .eco-subtitle {
          color: var(--text-muted);
          font-size: 0.85rem;
          margin: 0;
        }
        .eco-actions {
          display: flex;
          gap: 12px;
        }
        .spin {
          animation: spin 1s linear infinite;
        }
        @keyframes spin { 100% { transform: rotate(360deg); } }
        
        .eco-tabs {
          display: flex;
          gap: 32px;
          border-bottom: 1px solid var(--border-color);
          margin-bottom: 24px;
        }
        .eco-tab {
          background: none;
          border: none;
          padding: 12px 0;
          font-size: 14px;
          font-weight: 600;
          color: var(--text-muted);
          cursor: pointer;
          position: relative;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .eco-tab:hover {
          color: var(--text-main);
        }
        .eco-tab.is-active {
          color: var(--primary);
        }
        .eco-tab.is-active::after {
          content: '';
          position: absolute;
          bottom: -1px;
          left: 0;
          right: 0;
          height: 2px;
          background: var(--primary);
        }
        .eco-tab-badge {
          background: var(--danger);
          color: white;
          font-size: 10px;
          padding: 2px 6px;
          border-radius: 99px;
          line-height: 1;
        }

        .eco-content {
          display: flex;
          flex-direction: column;
          gap: 24px;
        }

        .eco-kpi-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
          gap: 20px;
          margin-bottom: 24px;
        }
        .eco-kpi-card {
          background: var(--card-bg);
          border: 1px solid var(--border-color);
          border-radius: 12px;
          padding: 20px;
        }
        .kpi-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 12px;
        }
        .kpi-label {
          font-size: 13px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: var(--text-muted);
        }
        .kpi-value {
          font-size: 28px;
          font-weight: 300;
          color: var(--text-main);
          margin-bottom: 4px;
        }
        .kpi-meta {
          font-size: 12px;
          color: var(--text-muted);
        }
        .text-success { color: var(--success); }
        .text-danger { color: var(--danger); }

        .eco-panel {
          background: var(--card-bg);
          border: 1px solid var(--border-color);
          border-radius: 12px;
          overflow: hidden;
        }
        .panel-header {
          padding: 16px 20px;
          border-bottom: 1px solid var(--border-color);
        }
        .panel-header h3 {
          margin: 0;
          font-size: 15px;
          font-weight: 700;
          color: var(--text-main);
        }

        .eco-project-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(380px, 1fr));
          gap: 20px;
        }
        .project-card-stats {
          display: flex;
          padding: 16px 20px;
          gap: 16px;
          background: var(--surface-soft);
          border-bottom: 1px solid var(--border-color);
        }
        .pc-stat {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .pc-stat span {
          font-size: 11px;
          text-transform: uppercase;
          color: var(--text-muted);
          font-weight: 600;
        }
        .pc-stat strong {
          font-size: 14px;
          color: var(--text-main);
        }

        .breakdown-list {
          padding: 20px;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
        .breakdown-item {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .bd-labels {
          display: flex;
          justify-content: space-between;
          font-size: 12px;
        }
        .bd-name {
          font-weight: 600;
          color: var(--text-main);
          text-transform: capitalize;
        }
        .bd-values {
          display: flex;
          align-items: center;
          gap: 4px;
        }
        .bd-divider {
          color: var(--text-muted);
        }
        .bd-budget {
          color: var(--text-muted);
        }
        .bd-bar-bg {
          height: 6px;
          background: var(--input-bg);
          border-radius: 99px;
          overflow: hidden;
        }
        .bd-bar-fill {
          height: 100%;
          background: var(--primary);
          border-radius: 99px;
          transition: width 0.3s ease;
        }
        .bd-bar-fill.is-over {
          background: var(--danger);
        }

        .eco-table-wrap {
          overflow-x: auto;
        }
        .eco-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 13px;
        }
        .eco-table th {
          text-align: left;
          padding: 12px 20px;
          color: var(--text-muted);
          font-weight: 600;
          border-bottom: 1px solid var(--border-color);
          background: var(--surface-soft);
          text-transform: uppercase;
          font-size: 11px;
          letter-spacing: 0.5px;
        }
        .eco-table td {
          padding: 12px 20px;
          border-bottom: 1px solid var(--border-color);
          color: var(--text-main);
          vertical-align: middle;
        }
        .eco-table tr:last-child td {
          border-bottom: none;
        }
        .eco-table tbody tr:hover {
          background: rgba(0,0,0,0.02);
        }
        
        .eco-link {
          color: var(--primary);
          cursor: pointer;
          font-weight: 600;
        }
        .eco-link:hover {
          text-decoration: underline;
        }
        .eco-muted {
          color: var(--text-muted);
        }
        .eco-empty {
          text-align: center;
          padding: 32px !important;
          color: var(--text-muted);
        }

        .eco-tag {
          background: var(--input-bg);
          padding: 4px 8px;
          border-radius: 4px;
          font-size: 11px;
          font-weight: 600;
          color: var(--text-muted);
          text-transform: capitalize;
        }
        .eco-tag.is-success { background: rgba(16, 185, 129, 0.1); color: var(--success); }
        .eco-tag.is-danger { background: rgba(239, 68, 68, 0.1); color: var(--danger); }

        .eco-status-pill {
          display: inline-flex;
          padding: 4px 10px;
          border-radius: 99px;
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        .status-submitted, .status-pending { background: rgba(245, 158, 11, 0.1); color: rgb(245, 158, 11); }
        .status-approved, .status-matched { background: rgba(16, 185, 129, 0.1); color: var(--success); }
        .status-rejected, .status-mismatch { background: rgba(239, 68, 68, 0.1); color: var(--danger); }
        .status-locked, .status-unlinked { background: var(--input-bg); color: var(--text-muted); }
        .status-flagged { background: rgba(239, 68, 68, 0.1); color: var(--danger); }
        .status-draft { background: var(--input-bg); color: var(--text-muted); }

        .eco-row-actions {
          display: flex;
          gap: 6px;
        }
        .btn-approve, .btn-reject, .btn-lock, .btn-flag, .btn-adjust {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 4px 8px;
          border: none;
          border-radius: 4px;
          font-size: 11px;
          font-weight: 600;
          cursor: pointer;
        }
        .btn-approve { background: var(--success); color: white; }
        .btn-reject { background: transparent; border: 1px solid var(--danger); color: var(--danger); }
        .btn-flag { background: var(--danger); color: white; }
        .btn-lock { background: var(--primary); color: white; }
        .btn-adjust { background: var(--input-bg); color: var(--text-main); border: 1px solid var(--border-color); }
      `}} />
    </div>
  );
}
