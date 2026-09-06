import React, { useEffect, useState, useMemo } from "react";
import { Search, Plus, MapPin, ChevronRight, ArrowLeft, Edit2, Save, Trash2 } from "lucide-react";
import { useT } from "../../lib/i18n/I18nContext";

export type VenueRiggingSpecs = {
  maxPointLoad: string;
  roofTrussCapacity: string;
  beamHeight: string;
  stageDimensions: string;
};

export type VenuePowerInfrastructure = {
  cee32A: string;
  cee63A: string;
  cee125A: string;
  panelLocations: string;
  shorePower: string;
};

export type VenueLogisticsAccess = {
  loadingDockDimensions: string;
  doorClearanceHeight: string;
  rampAccess: string;
  freightElevatorLimits: string;
  truckParkingRules: string;
};

export type VenueSiteFacilities = {
  wifiCredentials: string;
  productionOfficeLocations: string;
  dressingRooms: string;
  stageDimensions: string;
};

export type Venue = {
  id: string;
  name: string;
  address: string;
  website: string;
  technicalContactName: string;
  technicalContactPhone: string;
  technicalContactEmail: string;
  riggingSpecs: VenueRiggingSpecs | null;
  powerInfrastructure: VenuePowerInfrastructure | null;
  logisticsAccess: VenueLogisticsAccess | null;
  siteFacilities: VenueSiteFacilities | null;
  createdAt: string;
  updatedAt: string;
};

interface Props {
  getToken: () => Promise<string | null>;
}

export function VenuesDatabasePage({ getToken }: Props) {
  const t = useT();
  const [venues, setVenues] = useState<Venue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  const [activeVenueId, setActiveVenueId] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [venueDraft, setVenueDraft] = useState<Partial<Venue>>({});
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<"general" | "rigging" | "power" | "logistics" | "facilities">("general");

  const fetchVenues = async () => {
    try {
      const token = await getToken();
      const res = await fetch("/api/venues", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(t("venues.error.load"));
      const json = await res.json();
      setVenues(json.venues || []);
      setError("");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchVenues();
  }, [getToken, t]);

  const filtered = useMemo(() => {
    if (!search.trim()) return venues;
    const q = search.toLowerCase();
    return venues.filter(v => 
      (v.name || "").toLowerCase().includes(q) ||
      (v.address || "").toLowerCase().includes(q)
    );
  }, [venues, search]);

  const activeVenue = venues.find(v => v.id === activeVenueId);

  const handleSave = async () => {
    setSaving(true);
    try {
      const token = await getToken();
      const isNew = activeVenueId === "new";
      const method = isNew ? "POST" : "PATCH";
      const url = isNew ? "/api/venues" : `/api/venues/${activeVenueId}`;

      const res = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(venueDraft)
      });
      
      if (!res.ok) throw new Error(t("venues.error.save"));
      const json = await res.json();
      
      await fetchVenues();
      setIsEditing(false);
      
      if (isNew && json.venue?.id) {
        setActiveVenueId(json.venue.id);
      }
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!activeVenueId || activeVenueId === "new") return;
    if (!confirm(t("venues.deleteConfirm"))) return;
    
    setSaving(true);
    try {
      const token = await getToken();
      const res = await fetch(`/api/venues/${activeVenueId}`, {
        method: "DELETE",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(t("venues.error.delete"));
      
      await fetchVenues();
      setActiveVenueId(null);
      setIsEditing(false);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  };

  const openVenue = (venue: Venue) => {
    setActiveVenueId(venue.id);
    setIsEditing(false);
    setVenueDraft(venue);
    setActiveTab("general");
  };

    const openNew = () => {
    setActiveVenueId("new");
    setIsEditing(true);
    setVenueDraft({
      name: "", address: "", website: "",
      technicalContactName: "", technicalContactPhone: "", technicalContactEmail: "",
      riggingSpecs: { maxPointLoad: "", roofTrussCapacity: "", beamHeight: "", stageDimensions: "" },
      powerInfrastructure: { cee32A: "", cee63A: "", cee125A: "", panelLocations: "", shorePower: "" },
      logisticsAccess: { loadingDockDimensions: "", doorClearanceHeight: "", rampAccess: "", freightElevatorLimits: "", truckParkingRules: "" },
      siteFacilities: { wifiCredentials: "", productionOfficeLocations: "", dressingRooms: "", stageDimensions: "" }
    });
    setActiveTab("general");
  };

  if (activeVenueId) {
    const isNew = activeVenueId === "new";
    const v = isEditing ? venueDraft : activeVenue;
    
    if (!v) return null;

    const Input = ({ label, field, multiline = false }: { label: string, field: Extract<keyof Venue, "name" | "address" | "website" | "technicalContactName" | "technicalContactPhone" | "technicalContactEmail">, multiline?: boolean }) => {
      if (isEditing) {
        if (multiline) {
          return (
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "var(--text-muted)", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</label>
              <textarea 
                className="ehs-input" 
                style={{ width: "100%", minHeight: 120, resize: "vertical" }}
                value={(v[field] as string) || ""}
                onChange={e => setVenueDraft(prev => ({ ...prev, [field]: e.target.value }))}
                placeholder={t("venues.placeholder.enter", { field: label.toLowerCase() })}
              />
            </div>
          );
        }
        return (
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "var(--text-muted)", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</label>
            <input 
              type="text"
              className="ehs-input" 
              style={{ width: "100%" }}
              value={(v[field] as string) || ""}
              onChange={e => setVenueDraft(prev => ({ ...prev, [field]: e.target.value }))}
              placeholder={t("venues.placeholder.enter", { field: label.toLowerCase() })}
            />
          </div>
        );
      }

      return (
        <div style={{ marginBottom: 24 }}>
          <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "var(--text-muted)", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</label>
          <div style={{ fontSize: 14, color: v[field] ? "var(--text-main)" : "var(--text-muted)", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
            {(v[field] as string) || "—"}
          </div>
        </div>
      );
    };

    const StructuredInput = ({ title, field, labels }: { title: string, field: Extract<keyof Venue, "riggingSpecs" | "powerInfrastructure" | "logisticsAccess" | "siteFacilities">, labels: Record<string, string> }) => {
      const obj = (v[field] as Record<string, string> | null) || {};
      
      if (isEditing) {
        return (
          <div style={{ marginBottom: 24 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, borderBottom: "1px solid var(--border-color)", paddingBottom: 8 }}>
              <h3 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>{title}</h3>
            </div>
            {Object.entries(labels).map(([key, label]) => (
              <div key={key} style={{ marginBottom: 16 }}>
                <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "var(--text-muted)", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</label>
                <input 
                  type="text"
                  className="ehs-input" 
                  style={{ width: "100%" }}
                  value={obj[key] || ""}
                  onChange={e => setVenueDraft(prev => {
                    const currentField = (prev[field] as Record<string, string> | null) || {};
                    return { ...prev, [field]: { ...currentField, [key]: e.target.value } };
                  })}
                  placeholder={t("venues.placeholder.enter", { field: label.toLowerCase() })}
                />
              </div>
            ))}
          </div>
        );
      }

      return (
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, borderBottom: "1px solid var(--border-color)", paddingBottom: 8 }}>
            <h3 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>{title}</h3>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 280px), 1fr))", gap: 24 }}>
            {Object.entries(labels).map(([key, label]) => (
              <div key={key} style={{ marginBottom: 16 }}>
                <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "var(--text-muted)", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</label>
                <div style={{ fontSize: 14, color: obj[key] ? "var(--text-main)" : "var(--text-muted)", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
                  {obj[key] || "—"}
                </div>
              </div>
            ))}
          </div>
        </div>
      );
    };

    return (
      <div style={{ padding: "0 16px 40px", maxWidth: 900, margin: "0 auto" }}>
        <div style={{ marginBottom: 24 }}>
          <button 
            className="ehs-ghost-btn" 
            style={{ padding: "6px 12px", marginLeft: -12, marginBottom: 16 }}
            onClick={() => {
              if (isEditing && !isNew) {
                if (confirm(t("venues.discardConfirm"))) {
                  setIsEditing(false);
                }
              } else {
                setActiveVenueId(null);
              }
            }}
          >
            <ArrowLeft size={16} /> {t("venues.action.back")}
          </button>
          
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <h2 style={{ fontSize: "2rem", fontWeight: 300, margin: "0 0 8px 0", color: "var(--text-main)", display: "flex", alignItems: "center", gap: 12 }}>
                <MapPin size={28} color="var(--primary)" />
                {isNew ? t("venues.newVenue") : (v.name || t("venues.unnamedVenue"))}
              </h2>
              {!isNew && !isEditing && (
                <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", margin: 0 }}>
                  {v.address}
                </p>
              )}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              {isEditing ? (
                <>
                  {!isNew && (
                    <button className="ehs-ghost-btn" onClick={() => setIsEditing(false)} disabled={saving}>
                       {t("common.cancel")}
                    </button>
                  )}
                  <button className="ehs-primary-btn" onClick={handleSave} disabled={saving}>
                     <Save size={16} /> {saving ? t("common.saving") : t("venues.action.save")}
                  </button>
                </>
              ) : (
                <>
                  <button className="ehs-ghost-btn text-danger" onClick={handleDelete} disabled={saving}>
                     <Trash2 size={16} /> {t("common.delete")}
                  </button>
                  <button className="ehs-primary-btn" onClick={() => { setVenueDraft(activeVenue || {}); setIsEditing(true); }}>
                     <Edit2 size={16} /> {t("common.edit")}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="ehs-tabs" style={{ display: "flex", gap: 24, borderBottom: "1px solid var(--border-color)", marginBottom: 32 }}>
          {[
             { id: "general", label: t("venues.tab.general") },
             { id: "rigging", label: t("venues.tab.rigging") },
             { id: "power", label: t("venues.tab.power") },
             { id: "logistics", label: t("venues.tab.logistics") },
             { id: "facilities", label: t("venues.tab.facilities") }
          ].map(tab => (
            <button
              key={tab.id}
              style={{
                background: "none",
                border: "none",
                padding: "0 0 12px 0",
                fontSize: 14,
                fontWeight: activeTab === tab.id ? 600 : 400,
                color: activeTab === tab.id ? "var(--primary)" : "var(--text-muted)",
                borderBottom: activeTab === tab.id ? "2px solid var(--primary)" : "2px solid transparent",
                cursor: "pointer",
                marginBottom: -1
              }}
              onClick={() => setActiveTab(tab.id as any)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div style={{ background: "var(--card-bg)", border: "1px solid var(--border-color)", borderRadius: 12, padding: 24 }}>
          {activeTab === "general" && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 280px), 1fr))", gap: 24 }}>
              <div>
                 <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16, borderBottom: "1px solid var(--border-color)", paddingBottom: 8 }}>{t("venues.general.venueDetails")}</h3>
                 <Input label={t("venues.general.venueName")} field="name" />
                 <Input label={t("venues.general.address")} field="address" multiline />
                 <Input label={t("venues.general.website")} field="website" />
              </div>
              <div>
                 <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16, borderBottom: "1px solid var(--border-color)", paddingBottom: 8 }}>{t("venues.general.techContact")}</h3>
                 <Input label={t("venues.general.contactName")} field="technicalContactName" />
                 <Input label={t("venues.general.phoneNumber")} field="technicalContactPhone" />
                 <Input label={t("venues.general.emailAddress")} field="technicalContactEmail" />
              </div>
            </div>
          )}

          {activeTab === "rigging" && (
            <StructuredInput
              title={t("venues.rigging.title")}
              field="riggingSpecs"
              labels={{
                maxPointLoad: t("venues.rigging.maxPointLoad"), roofTrussCapacity: t("venues.rigging.roofTrussCapacity"), beamHeight: t("venues.rigging.beamHeight"), stageDimensions: t("venues.rigging.stageDimensions")
              }}
            />
          )}

          {activeTab === "power" && (
            <StructuredInput
              title={t("venues.power.title")}
              field="powerInfrastructure"
              labels={{
                cee32A: t("venues.power.cee32A"), cee63A: t("venues.power.cee63A"), cee125A: t("venues.power.cee125A"), panelLocations: t("venues.power.panelLocations"), shorePower: t("venues.power.shorePower")
              }}
            />
          )}

          {activeTab === "logistics" && (
            <StructuredInput
              title={t("venues.logistics.title")}
              field="logisticsAccess"
              labels={{
                loadingDockDimensions: t("venues.logistics.loadingDockDimensions"), doorClearanceHeight: t("venues.logistics.doorClearanceHeight"), rampAccess: t("venues.logistics.rampAccess"), freightElevatorLimits: t("venues.logistics.freightElevatorLimits"), truckParkingRules: t("venues.logistics.truckParkingRules")
              }}
            />
          )}

          {activeTab === "facilities" && (
            <StructuredInput
              title={t("venues.facilities.title")}
              field="siteFacilities"
              labels={{
                wifiCredentials: t("venues.facilities.wifiCredentials"), productionOfficeLocations: t("venues.facilities.productionOfficeLocations"), dressingRooms: t("venues.facilities.dressingRooms"), stageDimensions: t("venues.rigging.stageDimensions")
              }}
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: "0 16px 40px", maxWidth: 1400, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 24 }}>
        <div>
          <h2 style={{ fontSize: "1.5rem", fontWeight: 300, margin: "0 0 8px 0", color: "var(--text-main)" }}>
            {t("venues.title")}
          </h2>
          <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", margin: 0 }}>
            {t("venues.subtitle")}
          </p>
        </div>
        <button className="ehs-primary-btn" onClick={openNew}>
          <Plus size={16} /> {t("venues.action.new")}
        </button>
      </div>

      <div className="ehs-table-container">
        <div className="ehs-table-toolbar">
          <div className="ehs-search-input">
            <Search size={16} color="var(--text-muted)" />
            <input 
              type="text" 
               placeholder={t("venues.searchPlaceholder")}
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
        </div>

        {loading ? (
          <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)", fontSize: 14 }}>
             {t("venues.loading")}
          </div>
        ) : error ? (
          <div style={{ padding: 40, textAlign: "center", color: "var(--danger)", fontSize: 14 }}>
            {error}
          </div>
        ) : filtered.length === 0 ? (
          <div className="ehs-empty-state">
            <div className="ehs-empty-state-icon">
              <MapPin size={24} />
            </div>
             <h3>{t("venues.empty.title")}</h3>
            <p>
              {venues.length === 0 
                 ? t("venues.empty.body") : t("venues.empty.search")}
            </p>
            {venues.length === 0 && (
              <button className="ehs-primary-btn" onClick={openNew}>
                 <Plus size={16} /> {t("venues.action.add")}
              </button>
            )}
          </div>
        ) : (
          <div className="mobile-table-scroll" style={{ overflowX: "auto" }}>
            <table className="ehs-table">
              <thead>
                <tr>
                   <th>{t("venues.table.name")}</th>
                   <th>{t("venues.table.location")}</th>
                   <th>{t("venues.table.techContact")}</th>
                   <th>{t("venues.table.contactPhone")}</th>
                  <th style={{ width: 40 }}></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(v => (
                  <tr key={v.id} className="is-clickable" onClick={() => openVenue(v)}>
                     <td style={{ fontWeight: 600 }}>{v.name || t("venues.table.untitled")}</td>
                    <td style={{ maxWidth: 250, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{v.address || "—"}</td>
                    <td style={{ maxWidth: 200, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{v.technicalContactName || "—"}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{v.technicalContactPhone || "—"}</td>
                    <td style={{ textAlign: "right" }}>
                      <ChevronRight size={16} color="var(--text-muted)" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
