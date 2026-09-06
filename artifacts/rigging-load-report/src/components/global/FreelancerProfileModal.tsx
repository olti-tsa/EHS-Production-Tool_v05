import React, { useEffect, useState } from "react";
import { X, Mail, Phone, MapPin, DollarSign } from "lucide-react";
import { useI18n, useT } from "../../lib/i18n/I18nContext";

export type ProfileHistoryData = {
  freelancer: {
    userId: string;
    fullName: string;
    email: string;
    phone?: string;
    primaryRole?: string;
    city?: string;
    defaultDayRate?: number;
    skills?: string[];
    dietaryTags?: string[];
    allergenTags?: string[];
    hasPhoto?: boolean;
    photoUrl?: string | null;
  };
  upcomingGigs: GigHistory[];
  pastGigs: GigHistory[];
  stats: {
    pastGigCount: number;
    totalWorkedMinutes: number;
    totalEarnings: number;
  };
};

export type GigHistory = {
  id: string;
  projectId: string | null;
  briefId: string;
  projectName: string;
  venue: string;
  role: string;
  startDate: string | null;
  endDate: string | null;
  assignedDates: string[];
  callTime: string;
  offTime: string;
  dayRate: number;
  workedMinutes: number;
  earnings: number;
  status: string;
};

interface Props {
  userId: string;
  getToken: () => Promise<string | null>;
  onClose: () => void;
}

export function FreelancerProfileModal({ userId, getToken, onClose }: Props) {
  const t = useT();
  const { locale } = useI18n();
  const [data, setData] = useState<ProfileHistoryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    const fetchProfile = async () => {
      try {
        const token = await getToken();
        const baseUrl =
          (typeof import.meta !== "undefined" &&
            (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL) ||
          "/";
        const res = await fetch(`${baseUrl}api/portal/freelancers/${encodeURIComponent(userId)}/profile-history`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) throw new Error(t("freelancerProfile.error.load"));
        const json = await res.json();
        if (mounted) {
          if (!json.ok) throw new Error(json.error || t("freelancerProfile.error.load"));
          // Format data correctly
          setData(json);
        }
      } catch (err: unknown) {
        if (mounted) {
          setError(err instanceof Error ? err.message : t("freelancerProfile.error.load"));
        }
      } finally {
        if (mounted) setLoading(false);
      }
    };
    fetchProfile();
    return () => {
      mounted = false;
    };
  }, [userId, getToken, t]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const photoUrl = data?.freelancer.hasPhoto
    ? `${
        (typeof import.meta !== "undefined" &&
          (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL) ||
        "/"
      }api/portal/freelancers/${encodeURIComponent(userId)}/photo`
    : null;

  const getInitials = (name?: string) => {
    if (!name) return "?";
    return name.split(" ").map((n) => n[0]).join("").substring(0, 2).toUpperCase();
  };

  const formatHours = (mins: number) => (mins / 60).toFixed(1) + "h";
  const formatGigDates = (gig: GigHistory) => {
    if (gig.assignedDates.length > 0) return gig.assignedDates.join(", ");
    if (gig.startDate && gig.endDate && gig.endDate !== gig.startDate) {
      return `${gig.startDate} ${t("freelancerProfile.dates.to")} ${gig.endDate}`;
    }
    return gig.startDate ?? gig.endDate ?? t("freelancerProfile.dates.notSet");
  };

  return (
    <div
      role="presentation"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        display: "grid",
        placeItems: "center",
        padding: 20,
        background: "rgba(5, 8, 14, 0.64)",
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label={t("freelancerProfile.dialogLabel")}
        style={{
          width: "min(680px, 100%)",
          minWidth: "min(100vw - 32px, 320px)",
          maxHeight: "min(85vh, 900px)",
          display: "flex",
          flexDirection: "column",
          borderRadius: 18,
          background: "var(--card-bg)",
          color: "var(--text-main)",
          border: "1px solid var(--border-color)",
          boxShadow: "0 24px 80px rgba(0,0,0,0.35)",
          overflow: "hidden",
        }}
      >
        <div style={{ padding: "16px 24px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid var(--border-color)" }}>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>{t("freelancerProfile.title")}</h3>
          <button type="button" aria-label={t("common.close")} className="ehs-ghost-btn" onClick={onClose} style={{ padding: 6 }}>
            <X size={18} />
          </button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: 24 }}>
          {loading ? (
            <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)", fontSize: 14 }}>
              {t("freelancerProfile.loading")}
            </div>
          ) : error ? (
            <div style={{ padding: 40, textAlign: "center", color: "var(--danger)", fontSize: 14 }}>
              {error}
            </div>
          ) : data ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
              {/* Header Section */}
              <div style={{ display: "flex", gap: 24, alignItems: "center", flexWrap: "wrap" }}>
                <div style={{
                  width: 96, height: 96, borderRadius: "50%", background: "var(--primary-soft)",
                  color: "var(--primary)", display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 32, fontWeight: 700, overflow: "hidden", flexShrink: 0
                }}>
                  {photoUrl ? <img src={photoUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : getInitials(data.freelancer.fullName)}
                </div>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <h2 style={{ margin: "0 0 6px", fontSize: 24, fontWeight: 700 }}>{data.freelancer.fullName}</h2>
                  <div style={{ color: "var(--text-muted)", fontSize: 15, marginBottom: 12, display: "flex", flexWrap: "wrap", gap: "12px 16px" }}>
                    {data.freelancer.primaryRole && <span><strong>{data.freelancer.primaryRole}</strong></span>}
                    {data.freelancer.city && <span style={{ display: "flex", alignItems: "center", gap: 4 }}><MapPin size={14}/>{data.freelancer.city}</span>}
                   {data.freelancer.defaultDayRate != null && <span style={{ display: "flex", alignItems: "center", gap: 4 }}><DollarSign size={14}/>{data.freelancer.defaultDayRate.toLocaleString(locale === "no" ? "nb-NO" : "en-US")} {t("freelancerProfile.rateUnit")}</span>}
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 12, fontSize: 13 }}>
                    {data.freelancer.email && (
                      <span style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--text-main)", wordBreak: "break-all" }}><Mail size={14} color="var(--text-muted)"/> {data.freelancer.email}</span>
                    )}
                    {data.freelancer.phone && (
                      <span style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--text-main)", wordBreak: "break-all" }}><Phone size={14} color="var(--text-muted)"/> {data.freelancer.phone}</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Tags Section */}
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                {data.freelancer.skills && data.freelancer.skills.length > 0 && (
                  <div>
                    <h4 style={{ margin: "0 0 8px", fontSize: 13, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 0.5 }}>{t("freelancerProfile.skills")}</h4>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {data.freelancer.skills.map(s => <span key={s} className="crew-skill-pill">{s}</span>)}
                    </div>
                  </div>
                )}
                {(data.freelancer.dietaryTags?.length || data.freelancer.allergenTags?.length) ? (
                  <div>
                    <h4 style={{ margin: "0 0 8px", fontSize: 13, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 0.5 }}>{t("freelancerProfile.dietaryAllergens")}</h4>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {data.freelancer.dietaryTags?.map(t => <span key={t} style={{ padding: "4px 8px", borderRadius: 4, background: "rgba(22, 163, 74, 0.1)", color: "#16a34a", fontSize: 12, fontWeight: 600 }}>{t}</span>)}
                      {data.freelancer.allergenTags?.map(a => <span key={a} style={{ padding: "4px 8px", borderRadius: 4, background: "rgba(220, 38, 38, 0.1)", color: "#dc2626", fontSize: 12, fontWeight: 600 }}>{a}</span>)}
                    </div>
                  </div>
                ) : null}
              </div>

              {/* Stats Row */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
                <div style={{ background: "var(--input-bg)", border: "1px solid var(--border-color)", padding: 16, borderRadius: 12, textAlign: "center" }}>
                  <div style={{ color: "var(--text-muted)", fontSize: 11, fontWeight: 700, textTransform: "uppercase", marginBottom: 4 }}>{t("freelancerProfile.stats.pastGigs")}</div>
                  <div style={{ fontSize: 24, fontWeight: 800 }}>{data.stats.pastGigCount}</div>
                </div>
                <div style={{ background: "var(--input-bg)", border: "1px solid var(--border-color)", padding: 16, borderRadius: 12, textAlign: "center" }}>
                  <div style={{ color: "var(--text-muted)", fontSize: 11, fontWeight: 700, textTransform: "uppercase", marginBottom: 4 }}>{t("freelancerProfile.stats.hoursWorked")}</div>
                  <div style={{ fontSize: 24, fontWeight: 800 }}>{formatHours(data.stats.totalWorkedMinutes)}</div>
                </div>
                <div style={{ background: "var(--input-bg)", border: "1px solid var(--border-color)", padding: 16, borderRadius: 12, textAlign: "center" }}>
                  <div style={{ color: "var(--text-muted)", fontSize: 11, fontWeight: 700, textTransform: "uppercase", marginBottom: 4 }}>{t("freelancerProfile.stats.earnings")}</div>
                   <div style={{ fontSize: 24, fontWeight: 800 }}>{data.stats.totalEarnings.toLocaleString(locale === "no" ? "nb-NO" : "en-US")}</div>
                </div>
              </div>

              {/* Upcoming Gigs */}
              <div>
                <h4 style={{ margin: "0 0 12px", fontSize: 16, borderBottom: "2px solid var(--primary)", display: "inline-block", paddingBottom: 4 }}>{t("freelancerProfile.upcoming")}</h4>
                {data.upcomingGigs.length > 0 ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {data.upcomingGigs.map(gig => (
                      <div key={gig.id} style={{ display: "flex", justifyContent: "space-between", padding: 12, background: "var(--input-bg)", border: "1px solid var(--border-color)", borderRadius: 8 }}>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 14 }}>{gig.projectName}</div>
                          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
                            {gig.role} • {gig.venue}
                          </div>
                        </div>
                        <div style={{ textAlign: "right", fontSize: 13 }}>
                          <div style={{ fontWeight: 600 }}>{formatGigDates(gig)}</div>
                          <div style={{ color: "var(--text-muted)", marginTop: 2 }}>{gig.callTime || "--:--"} - {gig.offTime || "--:--"}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ padding: 16, border: "1px dashed var(--border-color)", borderRadius: 8, color: "var(--text-muted)", fontSize: 13 }}>
                    {t("freelancerProfile.upcomingEmpty")}
                  </div>
                )}
              </div>

              {/* Past Gigs */}
              <div>
                <h4 style={{ margin: "0 0 12px", fontSize: 16, borderBottom: "2px solid var(--border-color)", display: "inline-block", paddingBottom: 4 }}>{t("freelancerProfile.past")}</h4>
                {data.pastGigs.length > 0 ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {data.pastGigs.map(gig => (
                      <div key={gig.id} style={{ display: "flex", justifyContent: "space-between", padding: 12, background: "var(--input-bg)", border: "1px solid var(--border-color)", borderRadius: 8, opacity: 0.8 }}>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 14 }}>{gig.projectName}</div>
                          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
                            {gig.role} • {gig.venue}
                          </div>
                        </div>
                        <div style={{ textAlign: "right", fontSize: 13 }}>
                          <div style={{ fontWeight: 600 }}>{formatGigDates(gig)}</div>
                           <div style={{ color: "var(--text-muted)", marginTop: 2 }}>{formatHours(gig.workedMinutes)} • {gig.earnings.toLocaleString(locale === "no" ? "nb-NO" : "en-US")} NOK</div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ padding: 16, border: "1px dashed var(--border-color)", borderRadius: 8, color: "var(--text-muted)", fontSize: 13 }}>
                    {t("freelancerProfile.pastEmpty")}
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
