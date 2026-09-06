import React, { useEffect, useState, useMemo } from "react";
import { Search, Plus, Building2, ChevronRight, ArrowLeft, Edit2, Save, Trash2, Copy, Calendar as CalendarIcon, Briefcase } from "lucide-react";
import { useT } from "../../lib/i18n/I18nContext";

export type ClientPrimaryContact = {
  name: string;
  role: string;
  phone: string;
  email: string;
};

export type ClientProject = {
  id: string;
  name: string;
  venue: string;
  easyjob_number: string | null;
  start_date: string | null;
  end_date: string | null;
  status: string;
  updatedAt: string;
};

export type Client = {
  id: string;
  companyName: string;
  billingAddress: string;
  organizationNumber: string;
  primaryContacts: ClientPrimaryContact[];
  defaultPaymentTermsDays: number;
  projects?: ClientProject[];
};

interface Props {
  getToken: () => Promise<string | null>;
  onProjectCloned?: (projectId: string) => void;
}

export function ClientsDatabasePage({ getToken, onProjectCloned }: Props) {
  const t = useT();
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  const [activeClientId, setActiveClientId] = useState<string | null>(null);
  const [activeClientFull, setActiveClientFull] = useState<Client | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [clientDraft, setClientDraft] = useState<Partial<Client>>({});
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<"general" | "projects">("general");

  const [cloneModal, setCloneModal] = useState<{ projectId: string, name: string, easyjob_number: string } | null>(null);

  const fetchClients = async () => {
    try {
      const token = await getToken();
      const res = await fetch("/api/clients", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(t("clients.error.load"));
      const json = await res.json();
      setClients(json.clients || []);
      setError("");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchClients();
  }, [getToken]);

  const loadClientDetail = async (id: string) => {
    try {
      const token = await getToken();
      const res = await fetch(`/api/clients/${id}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || t("clients.error.loadDetail"));
      setActiveClientFull({ ...json.client, projects: json.projects });
    } catch (err: any) {
      alert(err.message);
    }
  };

  const filtered = useMemo(() => {
    if (!search.trim()) return clients;
    const q = search.toLowerCase();
    return clients.filter(c => 
      (c.companyName || "").toLowerCase().includes(q) ||
      (c.organizationNumber || "").toLowerCase().includes(q)
    );
  }, [clients, search]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const token = await getToken();
      const isNew = activeClientId === "new";
      const method = isNew ? "POST" : "PATCH";
      const url = isNew ? "/api/clients" : `/api/clients/${activeClientId}`;

      const res = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(clientDraft)
      });
      
      if (!res.ok) throw new Error(t("clients.error.save"));
      const json = await res.json();
      
      await fetchClients();
      setIsEditing(false);
      
      if (isNew && json.client?.id) {
        setActiveClientId(json.client.id);
        setActiveClientFull(json.client);
        setActiveTab("projects");
      } else if (!isNew) {
        loadClientDetail(activeClientId!);
      }
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!activeClientId || activeClientId === "new") return;
    if (!confirm(t("clients.deleteConfirm"))) return;
    
    setSaving(true);
    try {
      const token = await getToken();
      const res = await fetch(`/api/clients/${activeClientId}`, {
        method: "DELETE",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(t("clients.error.delete"));
      
      await fetchClients();
      setActiveClientId(null);
      setActiveClientFull(null);
      setIsEditing(false);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleCloneProject = async () => {
    if (!cloneModal || !activeClientId) return;
    setSaving(true);
    try {
      const token = await getToken();
      const res = await fetch(`/api/clients/${activeClientId}/projects/${cloneModal.projectId}/clone`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          name: cloneModal.name,
          easyjob_number: cloneModal.easyjob_number || undefined
        })
      });
      if (!res.ok) throw new Error(t("clients.error.clone"));
      const json = await res.json();
      
      setCloneModal(null);
      if (onProjectCloned && json.project?.id) {
        onProjectCloned(json.project.id);
      } else {
        loadClientDetail(activeClientId);
      }
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  };

  const openClient = (client: Client) => {
    setActiveClientId(client.id);
    setActiveClientFull(client);
    setIsEditing(false);
    setClientDraft(client);
    setActiveTab("general");
    loadClientDetail(client.id);
  };

  const openNew = () => {
    setActiveClientId("new");
    setActiveClientFull(null);
    setIsEditing(true);
    setClientDraft({
      companyName: "", billingAddress: "", organizationNumber: "",
      primaryContacts: [], defaultPaymentTermsDays: 14
    });
    setActiveTab("general");
  };

  if (activeClientId) {
    const isNew = activeClientId === "new";
    const c = isEditing ? clientDraft : activeClientFull || clientDraft;
    
    if (!c) return null;

    const Input = ({ label, field, type = "text", multiline = false }: { label: string, field: Extract<keyof Client, "companyName" | "organizationNumber" | "billingAddress" | "defaultPaymentTermsDays">, type?: string, multiline?: boolean }) => {
      if (isEditing) {
        if (multiline) {
          return (
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "var(--text-muted)", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</label>
              <textarea 
                className="ehs-input" 
                style={{ width: "100%", minHeight: 80, resize: "vertical" }}
                value={(c[field] as string) || ""}
                onChange={e => setClientDraft(prev => ({ ...prev, [field]: e.target.value }))}
                placeholder={t("clients.placeholder.enter", { field: label.toLowerCase() })}
              />
            </div>
          );
        }
        return (
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "var(--text-muted)", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</label>
            <input 
              type={type}
              className="ehs-input" 
              style={{ width: "100%" }}
              value={c[field] || ""}
              onChange={e => setClientDraft(prev => ({ ...prev, [field]: type === "number" ? Number(e.target.value) : e.target.value }))}
              placeholder={t("clients.placeholder.enter", { field: label.toLowerCase() })}
            />
          </div>
        );
      }

      return (
        <div style={{ marginBottom: 24 }}>
          <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "var(--text-muted)", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</label>
          <div style={{ fontSize: 14, color: c[field] !== undefined ? "var(--text-main)" : "var(--text-muted)", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
                {c[field] !== undefined && c[field] !== "" ? (type === "number" && field === "defaultPaymentTermsDays" ? t("clients.table.days", { days: c[field] as number }) : c[field]) : "—"}
          </div>
        </div>
      );
    };

    return (
      <div style={{ padding: "0 16px 40px", maxWidth: 900, margin: "0 auto" }}>
        {cloneModal && (
          <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
            <div style={{ background: "var(--card-bg)", padding: 24, borderRadius: 12, width: 400, border: "1px solid var(--border-color)" }}>
              <h3 style={{ margin: "0 0 16px 0", fontSize: 18 }}>{t("clients.modal.clone.title")}</h3>
              <p style={{ margin: "0 0 16px 0", fontSize: 13, color: "var(--text-muted)" }}>{t("clients.modal.clone.subtitle")}</p>
              
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "var(--text-muted)", marginBottom: 6, textTransform: "uppercase" }}>{t("clients.modal.clone.newName")}</label>
                <input 
                  type="text" 
                  className="ehs-input" 
                  style={{ width: "100%" }}
                  value={cloneModal.name}
                  onChange={e => setCloneModal(p => ({ ...p!, name: e.target.value }))}
                />
              </div>
              
              <div style={{ marginBottom: 24 }}>
                <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "var(--text-muted)", marginBottom: 6, textTransform: "uppercase" }}>{t("clients.modal.clone.newEasyjob")}</label>
                <input 
                  type="text" 
                  className="ehs-input" 
                  style={{ width: "100%" }}
                  value={cloneModal.easyjob_number}
                  onChange={e => setCloneModal(p => ({ ...p!, easyjob_number: e.target.value }))}
                />
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 12 }}>
                <button className="ehs-ghost-btn" onClick={() => setCloneModal(null)} disabled={saving}>{t("common.cancel")}</button>
                <button className="ehs-primary-btn" onClick={handleCloneProject} disabled={saving || !cloneModal.name.trim()}>
                  {saving ? t("clients.modal.clone.cloning") : t("clients.modal.clone.action")}
                </button>
              </div>
            </div>
          </div>
        )}

        <div style={{ marginBottom: 24 }}>
          <button 
            className="ehs-ghost-btn" 
            style={{ padding: "6px 12px", marginLeft: -12, marginBottom: 16 }}
            onClick={() => {
              if (isEditing && !isNew) {
                if (confirm(t("clients.discardConfirm"))) {
                  setIsEditing(false);
                }
              } else {
                setActiveClientId(null);
                setActiveClientFull(null);
              }
            }}
          >
            <ArrowLeft size={16} /> {t("clients.action.back")}
          </button>
          
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <h2 style={{ fontSize: "2rem", fontWeight: 300, margin: "0 0 8px 0", color: "var(--text-main)", display: "flex", alignItems: "center", gap: 12 }}>
                <Building2 size={28} color="var(--primary)" />
                {isNew ? t("clients.newClient") : (c.companyName || t("clients.unnamedClient"))}
              </h2>
              {!isNew && !isEditing && c.organizationNumber && (
                <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", margin: 0, fontFamily: "monospace" }}>
                  {t("clients.orgNo", { org: c.organizationNumber })}
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
                    <Save size={16} /> {saving ? t("common.saving") : t("clients.action.save")}
                  </button>
                </>
              ) : (
                <>
                  <button className="ehs-ghost-btn text-danger" onClick={handleDelete} disabled={saving}>
                    <Trash2 size={16} /> {t("common.delete")}
                  </button>
                  <button className="ehs-primary-btn" onClick={() => { setClientDraft(activeClientFull || {}); setIsEditing(true); }}>
                    <Edit2 size={16} /> {t("common.edit")}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="ehs-tabs" style={{ display: "flex", gap: 24, borderBottom: "1px solid var(--border-color)", marginBottom: 32 }}>
          {[
            { id: "general", label: t("clients.tab.general") },
            { id: "projects", label: t("clients.tab.projects") },
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
                marginBottom: -1,
                display: tab.id === "projects" && isNew ? "none" : "block"
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
                <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16, borderBottom: "1px solid var(--border-color)", paddingBottom: 8 }}>{t("clients.general.companyDetails")}</h3>
                <Input label={t("clients.general.companyName")} field="companyName" />
                <Input label={t("clients.general.orgNumber")} field="organizationNumber" />
                <Input label={t("clients.general.billingAddress")} field="billingAddress" multiline />
                <Input label={t("clients.general.paymentTerms")} field="defaultPaymentTermsDays" type="number" />
              </div>
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, borderBottom: "1px solid var(--border-color)", paddingBottom: 8 }}>
                   <h3 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>{t("clients.general.contactPersonnel")}</h3>
                  {isEditing && (
                    <button 
                      className="ehs-ghost-btn" 
                      style={{ padding: "4px 8px", fontSize: 12 }}
                      onClick={() => setClientDraft(prev => ({ 
                        ...prev, 
                        primaryContacts: [...(prev.primaryContacts || []), { name: "", role: "", phone: "", email: "" }] 
                      }))}
                    >
                      <Plus size={12} style={{ marginRight: 4 }} /> {t("clients.general.addContact")}
                    </button>
                  )}
                </div>
                
                {isEditing ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                    {(c.primaryContacts || []).map((contact, idx) => (
                      <div key={idx} style={{ background: "var(--input-bg)", padding: 12, borderRadius: 8, position: "relative" }}>
                        <button 
                          className="ehs-ghost-btn text-danger" 
                          style={{ position: "absolute", top: 8, right: 8, padding: 4 }}
                          aria-label={t("common.remove")}
                          onClick={() => setClientDraft(prev => ({
                            ...prev,
                            primaryContacts: (prev.primaryContacts || []).filter((_, i) => i !== idx)
                          }))}
                        >
                          <Trash2 size={14} />
                        </button>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8, marginTop: 4 }}>
                          <input type="text" className="ehs-input" placeholder={t("clients.general.contact.name")} value={contact.name} onChange={e => {
                            const newContacts = [...(clientDraft.primaryContacts || [])];
                            newContacts[idx] = { ...newContacts[idx], name: e.target.value };
                            setClientDraft(prev => ({ ...prev, primaryContacts: newContacts }));
                          }} />
                          <input type="text" className="ehs-input" placeholder={t("clients.general.contact.role")} value={contact.role} onChange={e => {
                            const newContacts = [...(clientDraft.primaryContacts || [])];
                            newContacts[idx] = { ...newContacts[idx], role: e.target.value };
                            setClientDraft(prev => ({ ...prev, primaryContacts: newContacts }));
                          }} />
                          <input type="text" className="ehs-input" placeholder={t("clients.general.contact.phone")} value={contact.phone} onChange={e => {
                            const newContacts = [...(clientDraft.primaryContacts || [])];
                            newContacts[idx] = { ...newContacts[idx], phone: e.target.value };
                            setClientDraft(prev => ({ ...prev, primaryContacts: newContacts }));
                          }} />
                          <input type="email" className="ehs-input" placeholder={t("clients.general.contact.email")} value={contact.email} onChange={e => {
                            const newContacts = [...(clientDraft.primaryContacts || [])];
                            newContacts[idx] = { ...newContacts[idx], email: e.target.value };
                            setClientDraft(prev => ({ ...prev, primaryContacts: newContacts }));
                          }} />
                        </div>
                      </div>
                    ))}
                    {(!c.primaryContacts || c.primaryContacts.length === 0) && (
                      <div style={{ fontSize: 13, color: "var(--text-muted)", textAlign: "center", padding: "16px 0" }}>
                         {t("clients.general.noContacts")}
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                    {(c.primaryContacts || []).map((contact, idx) => (
                      <div key={idx} style={{ background: "var(--input-bg)", padding: 12, borderRadius: 8 }}>
                        <div style={{ fontWeight: 600, fontSize: 14 }}>{contact.name || t("clients.table.unnamed")}</div>
                        {contact.role && <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>{contact.role}</div>}
                        {contact.phone && <div style={{ fontSize: 13, marginTop: 4 }}>📞 {contact.phone}</div>}
                        {contact.email && <div style={{ fontSize: 13, marginTop: 2 }}>✉️ {contact.email}</div>}
                      </div>
                    ))}
                    {(!c.primaryContacts || c.primaryContacts.length === 0) && (
                      <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
                        {t("clients.general.noContactsAvailable")}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === "projects" && !isNew && (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, borderBottom: "1px solid var(--border-color)", paddingBottom: 8 }}>
                 <h3 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>{t("clients.projects.title")}</h3>
                 <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{t("clients.projects.subtitle")}</span>
              </div>
              
              {!activeClientFull?.projects || activeClientFull.projects.length === 0 ? (
                <div style={{ textAlign: "center", padding: "40px 0", color: "var(--text-muted)" }}>
                  <Briefcase size={32} style={{ margin: "0 auto 12px auto", opacity: 0.5 }} />
                   <p style={{ margin: 0, fontSize: 14 }}>{t("clients.projects.empty")}</p>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {activeClientFull.projects.map(p => (
                    <div key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: 16, border: "1px solid var(--border-color)", borderRadius: 8, background: "var(--input-bg)" }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>{p.name}</div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 16, fontSize: 12, color: "var(--text-muted)" }}>
                          <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                            <CalendarIcon size={12} /> 
                            {p.start_date ? (p.end_date ? `${p.start_date} ${t("calendar.project.to")} ${p.end_date}` : p.start_date) : t("clients.projects.noDates")}
                          </span>
                          <span>{t("clients.projects.venue", { venue: p.venue || t("clients.projects.unknownVenue") })}</span>
                          {p.easyjob_number && <span>{t("clients.projects.easyjob")} <span style={{ fontFamily: "monospace" }}>{p.easyjob_number}</span></span>}
                          {p.status && <span>{t("clients.projects.status", { status: p.status })}</span>}
                        </div>
                      </div>
                      <button 
                        className="ehs-ghost-btn" 
                         title={t("clients.projects.cloneTitle")}
                        onClick={() => setCloneModal({ projectId: p.id, name: `${p.name} (Copy)`, easyjob_number: "" })}
                      >
                         <Copy size={16} style={{ marginRight: 6 }} /> {t("clients.projects.action.clone")}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
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
            {t("clients.title")}
          </h2>
          <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", margin: 0 }}>
            {t("clients.subtitle")}
          </p>
        </div>
        <button className="ehs-primary-btn" onClick={openNew}>
          <Plus size={16} /> {t("clients.action.new")}
        </button>
      </div>

      <div className="ehs-table-container">
        <div className="ehs-table-toolbar">
          <div className="ehs-search-input">
            <Search size={16} color="var(--text-muted)" />
            <input 
              type="text" 
              placeholder={t("clients.searchPlaceholder")}
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
        </div>

        {loading ? (
          <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)", fontSize: 14 }}>
            {t("clients.loading")}
          </div>
        ) : error ? (
          <div style={{ padding: 40, textAlign: "center", color: "var(--danger)", fontSize: 14 }}>
            {error}
          </div>
        ) : filtered.length === 0 ? (
          <div className="ehs-empty-state">
            <div className="ehs-empty-state-icon">
              <Building2 size={24} />
            </div>
            <h3>{t("clients.empty.title")}</h3>
            <p>
              {clients.length === 0 
                ? t("clients.empty.body")
                : t("clients.empty.search")}
            </p>
            {clients.length === 0 && (
              <button className="ehs-primary-btn" onClick={openNew}>
                <Plus size={16} /> {t("clients.action.add")}
              </button>
            )}
          </div>
        ) : (
          <div className="mobile-table-scroll" style={{ overflowX: "auto" }}>
            <table className="ehs-table">
              <thead>
                <tr>
                  <th>{t("clients.table.companyName")}</th>
                  <th>{t("clients.table.orgNumber")}</th>
                  <th>{t("clients.table.billingTerms")}</th>
                  <th>{t("clients.table.contactInfo")}</th>
                  <th style={{ width: 40 }}></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(c => (
                  <tr key={c.id} className="is-clickable" onClick={() => openClient(c)}>
                    <td style={{ fontWeight: 600, maxWidth: 200, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.companyName || t("clients.table.untitled")}</td>
                    <td style={{ fontFamily: "monospace", color: "var(--text-muted)" }}>{c.organizationNumber || "—"}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{c.defaultPaymentTermsDays ? t("clients.table.days", { days: c.defaultPaymentTermsDays }) : "—"}</td>
                    <td style={{ maxWidth: 200, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {(c.primaryContacts && c.primaryContacts.length > 0) ? c.primaryContacts[0].name || c.primaryContacts[0].email || t("clients.table.unnamed") : "—"}
                    </td>
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
