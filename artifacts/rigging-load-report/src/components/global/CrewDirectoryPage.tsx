import React, { useEffect, useState, useMemo } from "react";
import { Search, Mail, Phone, MapPin, X, Users, CheckCircle, Clock, Edit2 } from "lucide-react";
import { FreelancerProfileModal } from "./FreelancerProfileModal";
import { useT } from "../../lib/i18n/I18nContext";

export type FreelancerRow = {
  userId: string;
  fullName: string;
  email: string;
  phone: string;
  defaultDayRate: number | null;
  primaryRole: string;
  city: string;
  skills: string[];
  photoObjectPath?: string;
  availabilityStatus?: "full" | "partial" | "tentative" | "unavailable" | "unknown";
};

interface Props {
  getToken: () => Promise<string | null>;
}

export function CrewDirectoryPage({ getToken }: Props) {
  const t = useT();
  const [freelancers, setFreelancers] = useState<FreelancerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [locationSearch, setLocationSearch] = useState("");
  const [editingUser, setEditingUser] = useState<FreelancerRow | null>(null);
  const [profileUserId, setProfileUserId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        const token = await getToken();
        const today = new Date().toISOString().slice(0, 10);
        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
        const params = new URLSearchParams({
          startDate: today,
          endDate: today,
          timezone,
        });
        const res = await fetch(`/api/portal/freelancers?${params.toString()}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) throw new Error(t("globalCrew.loadError"));
        const json = await res.json();
        if (mounted) {
          // ensure skills is an array
          const rows = (json.freelancers || []).map((f: any) => ({
            ...f,
            skills: Array.isArray(f.skills) ? f.skills : (typeof f.skills === 'string' ? f.skills.split(',').map((s:string) => s.trim()) : [])
          }));
          setFreelancers(rows);
        }
      } catch (err: any) {
        if (mounted) setError(err.message);
      } finally {
        if (mounted) setLoading(false);
      }
    }
    load();
    return () => { mounted = false; };
  }, [getToken, t]);

  const filtered = useMemo(() => {
    let list = freelancers;
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(f => 
        (f.fullName || "").toLowerCase().includes(q) ||
        (f.email || "").toLowerCase().includes(q) ||
        (f.primaryRole && f.primaryRole.toLowerCase().includes(q)) ||
        (f.city && f.city.toLowerCase().includes(q)) ||
        (f.skills && f.skills.some(s => s.toLowerCase().includes(q)))
      );
    }
    if (locationSearch.trim()) {
      const location = locationSearch.trim().toLowerCase();
      list = list.filter(f => (f.city || "").toLowerCase().includes(location));
    }
    return list;
  }, [freelancers, search, locationSearch]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    setSaving(true);
    try {
      const token = await getToken();
      const res = await fetch(`/api/portal/freelancers/${encodeURIComponent(editingUser.userId)}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          fullName: editingUser.fullName,
          email: editingUser.email,
          phone: editingUser.phone,
          defaultDayRate: editingUser.defaultDayRate,
          primaryRole: editingUser.primaryRole,
          city: editingUser.city,
          skills: editingUser.skills
        })
      });
      if (!res.ok) throw new Error(t("globalCrew.saveError"));
      const json = await res.json();
      const updated = json.freelancer as Partial<FreelancerRow> | undefined;
      if (!updated) throw new Error(t("globalCrew.missingUpdatedProfile"));
      setFreelancers(prev => prev.map(f =>
        f.userId === editingUser.userId
          ? { ...f, ...updated, userId: editingUser.userId, skills: Array.isArray(updated.skills) ? updated.skills : f.skills }
          : f
      ));
      setEditingUser(null);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  };

  const getInitials = (name?: string) => {
    if (!name) return "?";
    return name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
  };

  const photoUrl = (userId: string) => {
    const baseUrl =
      (typeof import.meta !== "undefined" &&
        (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL) ||
      "/";
    return `${baseUrl}api/portal/freelancers/${encodeURIComponent(userId)}/photo`;
  };

  useEffect(() => {
    if (!editingUser) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) setEditingUser(null);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [editingUser, saving]);

  return (
    <div style={{ padding: "0 16px 40px", maxWidth: 1400, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 24 }}>
        <div>
          <h2 style={{ fontSize: "1.5rem", fontWeight: 300, margin: "0 0 8px 0", color: "var(--text-main)" }}>
            {t("globalCrew.title")}
          </h2>
          <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", margin: 0 }}>
            {t("globalCrew.subtitle")}
          </p>
        </div>
      </div>

      <div style={{ marginBottom: 24, display: "flex", flexWrap: "wrap", gap: 12 }}>
        <div className="ehs-search-input" style={{ width: "100%", maxWidth: 400 }}>
          <Search size={16} color="var(--text-muted)" />
          <input 
            type="text" 
            placeholder={t("globalCrew.search")}
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <div className="ehs-search-input" style={{ width: "100%", maxWidth: 320 }}>
          <MapPin size={16} color="var(--text-muted)" />
          <input
            type="text"
            aria-label={t("globalCrew.locationAria")}
            placeholder={t("globalCrew.location")}
            value={locationSearch}
            onChange={e => setLocationSearch(e.target.value)}
          />
        </div>
      </div>

      {loading ? (
        <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)", fontSize: 14 }}>
          {t("globalCrew.loading")}
        </div>
      ) : error ? (
        <div style={{ padding: 40, textAlign: "center", color: "var(--danger)", fontSize: 14 }}>
          {error}
        </div>
      ) : filtered.length === 0 ? (
        <div className="ehs-empty-state">
          <div className="ehs-empty-state-icon">
            <Users size={24} />
          </div>
          <h3>{t("globalCrew.emptyTitle")}</h3>
          <p>{t("globalCrew.emptyText")}</p>
        </div>
      ) : (
        <div className="crew-grid">
          {filtered.map(f => (
            <div
              key={f.userId}
              className="crew-card"
              role="button"
              tabIndex={0}
              aria-label={t("globalCrew.openProfile", { name: f.fullName || t("globalCrew.freelancer") })}
              style={{ cursor: "pointer", position: "relative" }}
              onClick={() => setProfileUserId(f.userId)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setProfileUserId(f.userId);
                }
              }}
            >
              <button 
                type="button" 
                className="ehs-ghost-btn" 
                style={{ position: "absolute", top: 12, right: 12, padding: 6, zIndex: 2 }}
                onClick={(e) => {
                  e.stopPropagation();
                  setEditingUser(f);
                }}
                title={t("globalCrew.editProfile")}
              >
                <Edit2 size={14} />
              </button>
              <div className="crew-card-head">
                <div className="crew-avatar">
                  {f.photoObjectPath ? <img src={photoUrl(f.userId)} alt="" /> : getInitials(f.fullName)}
                </div>
                <div className="crew-info">
                  <h4>{f.fullName}</h4>
                  <p>{f.primaryRole || t("globalCrew.freelancer")}</p>
                </div>
              </div>
              <div className="crew-meta">
                {f.city && (
                  <div className="crew-meta-item">
                    <MapPin size={12} /> {f.city}
                  </div>
                )}
                {f.email && (
                  <div className="crew-meta-item">
                    <Mail size={12} /> {f.email}
                  </div>
                )}
                {f.phone && (
                  <div className="crew-meta-item">
                    <Phone size={12} /> {f.phone}
                  </div>
                )}
                <div className="crew-meta-item" style={{ marginTop: 4 }}>
                  {f.availabilityStatus === "unavailable" ? (
                    <><Clock size={12} color="var(--warning)" /> <span style={{ color: "var(--warning)" }}>{t("globalCrew.unavailableToday")}</span></>
                  ) : f.availabilityStatus === "tentative" || f.availabilityStatus === "partial" ? (
                    <><Clock size={12} color="var(--warning)" /> <span style={{ color: "var(--warning)" }}>{t("globalCrew.limitedToday")}</span></>
                  ) : f.availabilityStatus === "full" ? (
                    <><CheckCircle size={12} color="var(--success)" /> <span style={{ color: "var(--success)" }}>{t("globalCrew.availableToday")}</span></>
                  ) : (
                    <><Clock size={12} color="var(--text-muted)" /> <span>{t("globalCrew.availabilityUnknown")}</span></>
                  )}
                </div>
              </div>
              {f.skills && f.skills.length > 0 && (
                <div className="crew-skills">
                  {f.skills.slice(0, 4).map((s, i) => (
                    <span key={i} className="crew-skill-pill">{s}</span>
                  ))}
                  {f.skills.length > 4 && <span className="crew-skill-pill">+{f.skills.length - 4}</span>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {profileUserId && (
        <FreelancerProfileModal 
          userId={profileUserId} 
          getToken={getToken} 
          onClose={() => setProfileUserId(null)} 
        />
      )}

      {editingUser && (
        <div className="ehs-modal-backdrop" onClick={() => !saving && setEditingUser(null)}>
          <div className="ehs-modal" role="dialog" aria-modal="true" aria-labelledby="crew-edit-title" onClick={e => e.stopPropagation()}>
            <div className="ehs-modal-header">
              <h3 id="crew-edit-title">{t("globalCrew.editTitle")}</h3>
              <button className="ehs-ghost-btn" style={{ padding: 4 }} onClick={() => setEditingUser(null)}>
                <X size={16} />
              </button>
            </div>
            <form onSubmit={handleSave}>
              <div className="ehs-modal-body">
                <div className="ehs-form-group">
                  <label>{t("globalCrew.fullName")}</label>
                  <input required className="ehs-input" value={editingUser.fullName} onChange={e => setEditingUser({...editingUser, fullName: e.target.value})} />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                  <div className="ehs-form-group">
                    <label>{t("globalCrew.email")}</label>
                    <input type="email" required className="ehs-input" value={editingUser.email} onChange={e => setEditingUser({...editingUser, email: e.target.value})} />
                  </div>
                  <div className="ehs-form-group">
                    <label>{t("globalCrew.phone")}</label>
                    <input className="ehs-input" value={editingUser.phone || ""} onChange={e => setEditingUser({...editingUser, phone: e.target.value})} />
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                  <div className="ehs-form-group">
                    <label>{t("globalCrew.primaryRole")}</label>
                    <input className="ehs-input" value={editingUser.primaryRole || ""} onChange={e => setEditingUser({...editingUser, primaryRole: e.target.value})} />
                  </div>
                  <div className="ehs-form-group">
                    <label>{t("globalCrew.cityBase")}</label>
                    <input className="ehs-input" value={editingUser.city || ""} onChange={e => setEditingUser({...editingUser, city: e.target.value})} />
                  </div>
                </div>
                <div className="ehs-form-group">
                  <label>{t("globalCrew.dayRate")}</label>
                  <input type="number" className="ehs-input" value={editingUser.defaultDayRate || ""} onChange={e => setEditingUser({...editingUser, defaultDayRate: e.target.value ? Number(e.target.value) : null})} />
                </div>
                <div className="ehs-form-group">
                  <label>{t("globalCrew.skills")}</label>
                  <input className="ehs-input" value={(editingUser.skills || []).join(", ")} onChange={e => setEditingUser({...editingUser, skills: e.target.value.split(",").map(s => s.trim()).filter(Boolean)})} />
                </div>
              </div>
              <div className="ehs-modal-footer">
                <button type="button" className="ehs-ghost-btn" onClick={() => setEditingUser(null)}>{t("common.cancel")}</button>
                <button type="submit" className="ehs-primary-btn" disabled={saving}>
                  {saving ? t("common.saving") : t("globalCrew.saveChanges")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
