import React, { useEffect, useState, useMemo } from "react";
import { Truck, Calendar as CalendarIcon, MapPin, Users, Edit2, Plus, AlertCircle, CheckCircle, Clock, Navigation, Play, Check, RotateCcw, X, Save, Building, Maximize, Weight } from "lucide-react";
import { format, parseISO, isSameDay, startOfDay, addDays, isBefore } from "date-fns";
import { nb } from "date-fns/locale";
import { useI18n, useT } from "../../lib/i18n/I18nContext";

export type Vehicle = {
  id: string;
  name: string;
  vehicleType: "truck" | "van" | "trailer" | "rental";
  licensePlate: string;
  capacityKg: number | null;
  volumeM3: number | null;
  primaryDriverUserId: string | null;
  primaryDriverName: string | null;
  availabilityStatus: "available" | "assigned" | "maintenance" | "unavailable";
  notes: string | null;
};

export type Run = {
  id: string;
  projectId: string | null;
  projectName: string | null;
  vehicleId: string | null;
  vehicleName: string | null;
  vehicleLicensePlate: string | null;
  driverUserId: string | null;
  driverName: string | null;
  title: string;
  origin: string;
  destination: string;
  departureAt: string;
  loadInAt: string | null;
  loadOutAt: string | null;
  status: "scheduled" | "in_transit" | "delivered" | "returned";
  cargoNotes: string | null;
};

export type Project = {
  id: string;
  name: string;
  startDate: string | null;
  endDate: string | null;
  status: string | null;
};

export type Freelancer = {
  userId: string;
  fullName: string;
  primaryRole: string;
};

interface Props {
  getToken: () => Promise<string | null>;
  onOpenProject: (id: string) => void;
}

function toLocalDateTimeInput(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : format(date, "yyyy-MM-dd'T'HH:mm");
}

async function responseError(res: Response, fallback: string): Promise<string> {
  try {
    const body = await res.json();
    return typeof body?.error === "string" ? body.error : fallback;
  } catch {
    return fallback;
  }
}

export function TransportDashboard({ getToken, onOpenProject }: Props) {
  const t = useT();
  const { locale } = useI18n();
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [crew, setCrew] = useState<Freelancer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [isVehicleModalOpen, setIsVehicleModalOpen] = useState(false);
  const [editingVehicle, setEditingVehicle] = useState<Partial<Vehicle> | null>(null);
  const [vehicleSaving, setVehicleSaving] = useState(false);

  const [isRunModalOpen, setIsRunModalOpen] = useState(false);
  const [editingRun, setEditingRun] = useState<Partial<Run> | null>(null);
  const [runSaving, setRunSaving] = useState(false);

  const fetchData = async () => {
    try {
      const token = await getToken();
      const headers: Record<string, string> = token
        ? { Authorization: `Bearer ${token}` }
        : {};
      const baseUrl =
        (typeof import.meta !== "undefined" &&
          (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL) ||
        "/";

      const [transportRes, projectsRes, crewRes] = await Promise.all([
        fetch(`${baseUrl}api/transport`, { headers }),
        fetch(`${baseUrl}api/projects`, { headers }),
        fetch(`${baseUrl}api/portal/freelancers`, { headers }),
      ]);

      if (!transportRes.ok) throw new Error(t("transport.error.load"));
      if (!projectsRes.ok) throw new Error(t("transport.error.projects"));
      if (!crewRes.ok) throw new Error(t("transport.error.crew"));

      const transportData = await transportRes.json();
      const projectsData = await projectsRes.json();
      const crewData = await crewRes.json();

      setVehicles(transportData.vehicles || []);
      setRuns(transportData.runs || []);
      setProjects(projectsData.projects || []);
      setCrew(crewData.freelancers || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSaveVehicle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingVehicle) return;
    setVehicleSaving(true);
    try {
      const token = await getToken();
      const headers = { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
      const baseUrl = import.meta.env.BASE_URL || "/";
      
      let res;
      if (editingVehicle.id) {
        // PATCH api/transport/vehicles/:id with availabilityStatus and/or primaryDriverUserId
        res = await fetch(`${baseUrl}api/transport/vehicles/${editingVehicle.id}`, {
          method: "PATCH",
          headers,
          body: JSON.stringify({
            availabilityStatus: editingVehicle.availabilityStatus,
            primaryDriverUserId: editingVehicle.primaryDriverUserId
          }),
        });
      } else {
        res = await fetch(`${baseUrl}api/transport/vehicles`, {
          method: "POST",
          headers,
          body: JSON.stringify(editingVehicle),
        });
      }
      
      if (!res.ok) throw new Error(await responseError(res, t("transport.error.saveVehicle")));
      await fetchData();
      setIsVehicleModalOpen(false);
      setEditingVehicle(null);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setVehicleSaving(false);
    }
  };

  const handleSaveRun = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingRun) return;
    setRunSaving(true);
    try {
      const token = await getToken();
      const headers = { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
      const baseUrl = import.meta.env.BASE_URL || "/";
      
      let res;
      if (editingRun.id) {
        // PATCH api/transport/runs/:id with {status}
        res = await fetch(`${baseUrl}api/transport/runs/${editingRun.id}`, {
          method: "PATCH",
          headers,
          body: JSON.stringify({ status: editingRun.status }),
        });
      } else {
        const payload = {
          ...editingRun,
          departureAt: editingRun.departureAt
            ? new Date(editingRun.departureAt).toISOString()
            : null,
          loadInAt: editingRun.loadInAt
            ? new Date(editingRun.loadInAt).toISOString()
            : null,
          loadOutAt: editingRun.loadOutAt
            ? new Date(editingRun.loadOutAt).toISOString()
            : null,
        };
        res = await fetch(`${baseUrl}api/transport/runs`, {
          method: "POST",
          headers,
          body: JSON.stringify(payload),
        });
      }
      
      if (!res.ok) throw new Error(await responseError(res, t("transport.error.saveRun")));
      await fetchData();
      setIsRunModalOpen(false);
      setEditingRun(null);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setRunSaving(false);
    }
  };

  const handleChangeRunStatus = async (id: string, newStatus: Run["status"]) => {
    // optimistic update
    const previous = [...runs];
    setRuns(prev => prev.map(r => r.id === id ? { ...r, status: newStatus } : r));
    try {
      const token = await getToken();
      const baseUrl = import.meta.env.BASE_URL || "/";
      const res = await fetch(`${baseUrl}api/transport/runs/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) throw new Error(t("transport.error.updateStatus"));
      // refresh canonical
      await fetchData();
    } catch (err: any) {
      alert(err.message);
      setRuns(previous); // revert on error
    }
  };

  const runsByDate = useMemo(() => {
    const groups: Record<string, Run[]> = {};
    const sorted = [...runs].sort((a, b) => new Date(a.departureAt).getTime() - new Date(b.departureAt).getTime());
    
    sorted.forEach(r => {
      if (!r.departureAt) return;
      const dateKey = startOfDay(parseISO(r.departureAt)).toISOString();
      if (!groups[dateKey]) groups[dateKey] = [];
      groups[dateKey].push(r);
    });
    return groups;
  }, [runs]);

  const runDates = Object.keys(runsByDate).sort();
  const todayStart = startOfDay(new Date()).getTime();

  return (
    <div style={{ padding: "0 16px 40px", maxWidth: 1400, margin: "0 auto" }}>
      <div className="producer-page-header transport-page-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 24, flexWrap: "wrap", gap: 16 }}>
        <div>
          <h2 style={{ fontSize: "1.5rem", fontWeight: 300, margin: "0 0 8px 0", color: "var(--text-main)" }}>
            {t("transport.title")}
          </h2>
          <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", margin: 0 }}>
            {t("transport.subtitle")}
          </p>
        </div>
        <div className="producer-action-bar transport-actions" style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
           <button className="ehs-ghost-btn" onClick={() => {
             setEditingVehicle({ vehicleType: "truck", availabilityStatus: "available" });
             setIsVehicleModalOpen(true);
           }}>
              <Plus size={16} style={{ marginRight: 6 }} /> {t("transport.action.addVehicle")}
           </button>
           <button className="ehs-primary-btn" onClick={() => {
              setEditingRun({ status: "scheduled", departureAt: toLocalDateTimeInput(new Date()) });
             setIsRunModalOpen(true);
           }}>
              <Navigation size={16} style={{ marginRight: 6 }} /> {t("transport.action.scheduleRun")}
           </button>
        </div>
      </div>
      
      {loading ? (
         <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)", fontSize: 14 }}>{t("transport.loading")}</div>
      ) : error ? (
        <div style={{ padding: 40, textAlign: "center", color: "var(--danger)", fontSize: 14 }}>{error}</div>
      ) : (
        <div className="transport-grid">
          
          <div className="transport-runs">
             <h3 className="section-title">{t("transport.runs.title")}</h3>
            {runDates.length === 0 ? (
              <div className="ehs-empty-state">
                <div className="ehs-empty-state-icon"><Navigation size={24} /></div>
                 <h3>{t("transport.runs.empty.title")}</h3>
                 <p>{t("transport.runs.empty.body")}</p>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
                {runDates.map(dateKey => {
                  const d = new Date(dateKey);
                  const isToday = d.getTime() === todayStart;
                  const isPast = d.getTime() < todayStart;
                  const isTomorrow = d.getTime() === addDays(new Date(todayStart), 1).getTime();
                  
                   let label = format(d, "EEEE, MMMM d, yyyy", { locale: locale === "no" ? nb : undefined });
                   if (isToday) label = t("transport.runs.today");
                   else if (isTomorrow) label = t("transport.runs.tomorrow");

                  return (
                    <div key={dateKey}>
                      <h4 className={`run-date-header ${isToday ? "is-today" : isPast ? "is-past" : ""}`}>
                        {label}
                      </h4>
                      <div className="run-list">
                        {runsByDate[dateKey].map(run => (
                          <RunCard 
                            key={run.id} 
                            run={run} 
                            onChangeStatus={(status) => handleChangeRunStatus(run.id, status)}
                             onOpenProject={() => run.projectId && onOpenProject(run.projectId)}
                             t={t}
                          />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="transport-fleet">
             <h3 className="section-title">{t("transport.fleet.title")}</h3>
            <div className="fleet-list">
              {vehicles.map(vehicle => (
                <div key={vehicle.id} className="fleet-card" onClick={() => {
                  setEditingVehicle(vehicle);
                  setIsVehicleModalOpen(true);
                }}>
                  <div className="fleet-card-header">
                    <div className="fleet-card-title">
                      <Truck size={14} color="var(--text-muted)" />
                      <span>{vehicle.name}</span>
                    </div>
                     <span className={`status-dot ${vehicle.availabilityStatus}`} title={t(`transport.vehicle.status.${vehicle.availabilityStatus}`)} />
                  </div>
                  <div className="fleet-card-plate">{vehicle.licensePlate}</div>
                  <div className="fleet-card-meta">
                     {t(`transport.vehicle.type.${vehicle.vehicleType}`)} {vehicle.capacityKg ? `· ${vehicle.capacityKg}kg` : ""} {vehicle.volumeM3 ? `· ${vehicle.volumeM3}m³` : ""}
                  </div>
                  {vehicle.primaryDriverName && (
                    <div className="fleet-card-driver">
                      <Users size={12} /> {vehicle.primaryDriverName}
                    </div>
                  )}
                </div>
              ))}
              {vehicles.length === 0 && (
                <div style={{ color: "var(--text-muted)", fontSize: 13, textAlign: "center", padding: 20 }}>
                   {t("transport.fleet.empty")}
                </div>
              )}
            </div>
          </div>

        </div>
      )}

      {/* Vehicle Modal */}
      {isVehicleModalOpen && editingVehicle && (
        <div className="ehs-modal-backdrop" onClick={() => !vehicleSaving && setIsVehicleModalOpen(false)}>
          <div className="ehs-modal" role="dialog" onClick={e => e.stopPropagation()} style={{ width: "100%", maxWidth: 600, minWidth: "min(100vw - 32px, 320px)" }}>
            <div className="ehs-modal-header">
               <h3>{editingVehicle.id ? t("transport.vehicle.modal.edit") : t("transport.vehicle.modal.add")}</h3>
              <button className="ehs-ghost-btn" style={{ padding: 4 }} onClick={() => setIsVehicleModalOpen(false)}>
                 <X size={16} aria-label={t("common.close")} />
              </button>
            </div>
            <form onSubmit={handleSaveVehicle}>
              <div className="ehs-modal-body">
                <div className="ehs-form-group">
                   <label>{t("transport.vehicle.name")}</label>
                   <input required className="ehs-input" value={editingVehicle.name || ""} onChange={e => setEditingVehicle({...editingVehicle, name: e.target.value})} placeholder={t("transport.vehicle.namePlaceholder")} disabled={!!editingVehicle.id} />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16 }}>
                  <div className="ehs-form-group">
                   <label>{t("transport.vehicle.licensePlate")}</label>
                   <input required className="ehs-input" value={editingVehicle.licensePlate || ""} onChange={e => setEditingVehicle({...editingVehicle, licensePlate: e.target.value})} placeholder={t("transport.vehicle.licensePlatePlaceholder")} disabled={!!editingVehicle.id} />
                  </div>
                  <div className="ehs-form-group">
                     <label>{t("transport.vehicle.type")}</label>
                    <select required className="ehs-input" value={editingVehicle.vehicleType || "truck"} onChange={e => setEditingVehicle({...editingVehicle, vehicleType: e.target.value as any})} disabled={!!editingVehicle.id}>
                       <option value="truck">{t("transport.vehicle.type.truck")}</option>
                       <option value="van">{t("transport.vehicle.type.van")}</option>
                       <option value="trailer">{t("transport.vehicle.type.trailer")}</option>
                       <option value="rental">{t("transport.vehicle.type.rental")}</option>
                    </select>
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16 }}>
                  <div className="ehs-form-group">
                     <label>{t("transport.vehicle.capacity")}</label>
                    <input type="number" className="ehs-input" value={editingVehicle.capacityKg || ""} onChange={e => setEditingVehicle({...editingVehicle, capacityKg: e.target.value ? Number(e.target.value) : null})} disabled={!!editingVehicle.id} />
                  </div>
                  <div className="ehs-form-group">
                     <label>{t("transport.vehicle.volume")}</label>
                    <input type="number" className="ehs-input" value={editingVehicle.volumeM3 || ""} onChange={e => setEditingVehicle({...editingVehicle, volumeM3: e.target.value ? Number(e.target.value) : null})} disabled={!!editingVehicle.id} />
                  </div>
                </div>
                
                {!!editingVehicle.id && <hr style={{ margin: "12px 0", border: "none", borderTop: "1px dashed var(--border-color)" }} />}

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16 }}>
                  <div className="ehs-form-group">
                     <label>{t("transport.vehicle.primaryDriver")}</label>
                    <select className="ehs-input" value={editingVehicle.primaryDriverUserId || ""} onChange={e => setEditingVehicle({...editingVehicle, primaryDriverUserId: e.target.value || null})}>
                       <option value="">{t("transport.vehicle.primaryDriver.none")}</option>
                      {crew.map(c => (
                        <option key={c.userId} value={c.userId}>{c.fullName}</option>
                      ))}
                    </select>
                  </div>
                  <div className="ehs-form-group">
                     <label>{t("transport.vehicle.status")}</label>
                    <select required className="ehs-input" value={editingVehicle.availabilityStatus || "available"} onChange={e => setEditingVehicle({...editingVehicle, availabilityStatus: e.target.value as any})}>
                       <option value="available">{t("transport.vehicle.status.available")}</option>
                       <option value="assigned">{t("transport.vehicle.status.assigned")}</option>
                       <option value="maintenance">{t("transport.vehicle.status.maintenance")}</option>
                       <option value="unavailable">{t("transport.vehicle.status.unavailable")}</option>
                    </select>
                  </div>
                </div>
                <div className="ehs-form-group">
                   <label>{t("transport.vehicle.notes")}</label>
                  <textarea className="ehs-input" style={{ minHeight: 60 }} value={editingVehicle.notes || ""} onChange={e => setEditingVehicle({...editingVehicle, notes: e.target.value || null})} disabled={!!editingVehicle.id} />
                </div>
              </div>
              <div className="ehs-modal-footer">
                 <button type="button" className="ehs-ghost-btn" onClick={() => setIsVehicleModalOpen(false)}>{t("common.cancel")}</button>
                <button type="submit" className="ehs-primary-btn" disabled={vehicleSaving}>
                   {vehicleSaving ? t("common.saving") : t("transport.vehicle.save")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Run Modal */}
      {isRunModalOpen && editingRun && !editingRun.id && (
        <div className="ehs-modal-backdrop" onClick={() => !runSaving && setIsRunModalOpen(false)}>
          <div className="ehs-modal" role="dialog" onClick={e => e.stopPropagation()} style={{ width: "100%", maxWidth: 600, minWidth: "min(100vw - 32px, 320px)" }}>
            <div className="ehs-modal-header">
               <h3>{t("transport.run.modal.title")}</h3>
              <button className="ehs-ghost-btn" style={{ padding: 4 }} onClick={() => setIsRunModalOpen(false)}>
                 <X size={16} aria-label={t("common.close")} />
              </button>
            </div>
            <form onSubmit={handleSaveRun}>
              <div className="ehs-modal-body">
                <div className="ehs-form-group">
                   <label>{t("transport.run.title")}</label>
                   <input required className="ehs-input" value={editingRun.title || ""} onChange={e => setEditingRun({...editingRun, title: e.target.value})} placeholder={t("transport.run.titlePlaceholder")} />
                </div>
                
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16 }}>
                  <div className="ehs-form-group">
                   <label>{t("transport.run.project")}</label>
                    <select required className="ehs-input" value={editingRun.projectId || ""} onChange={e => setEditingRun({...editingRun, projectId: e.target.value || null})}>
                       <option value="">{t("transport.run.project.none")}</option>
                      {projects.filter((p) => p.status === "active").map(p => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="ehs-form-group">
                     <label>{t("transport.run.status")}</label>
                    <select required className="ehs-input" value={editingRun.status || "scheduled"} onChange={e => setEditingRun({...editingRun, status: e.target.value as any})}>
                       <option value="scheduled">{t("transport.run.status.scheduled")}</option>
                       <option value="in_transit">{t("transport.run.status.in_transit")}</option>
                       <option value="delivered">{t("transport.run.status.delivered")}</option>
                       <option value="returned">{t("transport.run.status.returned")}</option>
                    </select>
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16 }}>
                  <div className="ehs-form-group">
                     <label>{t("transport.run.vehicle")}</label>
                    <select required className="ehs-input" value={editingRun.vehicleId || ""} onChange={e => setEditingRun({...editingRun, vehicleId: e.target.value || null})}>
                       <option value="">{t("transport.run.vehicle.none")}</option>
                      {vehicles.map(v => (
                        <option key={v.id} value={v.id}>{v.name} ({v.licensePlate})</option>
                      ))}
                    </select>
                  </div>
                  <div className="ehs-form-group">
                     <label>{t("transport.run.driver")}</label>
                    <select className="ehs-input" value={editingRun.driverUserId || ""} onChange={e => setEditingRun({...editingRun, driverUserId: e.target.value || null})}>
                       <option value="">{t("transport.run.driver.tba")}</option>
                      {crew.map(c => (
                        <option key={c.userId} value={c.userId}>{c.fullName}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16 }}>
                  <div className="ehs-form-group">
                     <label>{t("transport.run.origin")}</label>
                     <input required className="ehs-input" value={editingRun.origin || ""} onChange={e => setEditingRun({...editingRun, origin: e.target.value})} placeholder={t("transport.run.originPlaceholder")} />
                  </div>
                  <div className="ehs-form-group">
                     <label>{t("transport.run.destination")}</label>
                     <input required className="ehs-input" value={editingRun.destination || ""} onChange={e => setEditingRun({...editingRun, destination: e.target.value})} placeholder={t("transport.run.destinationPlaceholder")} />
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 16 }}>
                  <div className="ehs-form-group">
                     <label>{t("transport.run.departureTime")}</label>
                    <input type="datetime-local" required className="ehs-input" value={editingRun.departureAt ? toLocalDateTimeInput(editingRun.departureAt) : ""} onChange={e => setEditingRun({...editingRun, departureAt: e.target.value})} />
                  </div>
                </div>
                
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16 }}>
                  <div className="ehs-form-group">
                     <label>{t("transport.run.loadIn")}</label>
                    <input type="datetime-local" className="ehs-input" value={editingRun.loadInAt ? toLocalDateTimeInput(editingRun.loadInAt) : ""} onChange={e => setEditingRun({...editingRun, loadInAt: e.target.value || null})} />
                  </div>
                  <div className="ehs-form-group">
                     <label>{t("transport.run.loadOut")}</label>
                    <input type="datetime-local" className="ehs-input" value={editingRun.loadOutAt ? toLocalDateTimeInput(editingRun.loadOutAt) : ""} onChange={e => setEditingRun({...editingRun, loadOutAt: e.target.value || null})} />
                  </div>
                </div>

                <div className="ehs-form-group">
                   <label>{t("transport.run.cargoNotes")}</label>
                   <textarea className="ehs-input" style={{ minHeight: 60 }} value={editingRun.cargoNotes || ""} onChange={e => setEditingRun({...editingRun, cargoNotes: e.target.value || null})} placeholder={t("transport.run.cargoNotesPlaceholder")} />
                </div>
              </div>
              <div className="ehs-modal-footer">
                 <button type="button" className="ehs-ghost-btn" onClick={() => setIsRunModalOpen(false)}>{t("common.cancel")}</button>
                <button type="submit" className="ehs-primary-btn" disabled={runSaving}>
                   {runSaving ? t("common.saving") : t("transport.run.save")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <style dangerouslySetInnerHTML={{__html: `
        .transport-grid {
          display: grid;
          grid-template-columns: 1fr 380px;
          gap: 32px;
          align-items: start;
        }
        @media (max-width: 900px) {
          .transport-grid {
            grid-template-columns: 1fr;
          }
        }
        .section-title {
          font-size: 16px;
          font-weight: 700;
          margin: 0 0 16px;
          color: var(--text-main);
          letter-spacing: 0.5px;
          text-transform: uppercase;
        }
        .run-date-header {
          font-size: 12px;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 1px;
          color: var(--text-muted);
          margin: 0 0 12px;
          padding-bottom: 6px;
          border-bottom: 1px solid var(--border-color);
        }
        .run-date-header.is-today {
          color: var(--primary);
          border-bottom-color: var(--primary-soft);
        }
        .run-list {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .run-card {
          background: var(--card-bg);
          border: 1px solid var(--border-color);
          border-radius: 12px;
          padding: 16px;
          transition: all 0.2s ease;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .run-card:hover {
          border-color: rgba(248, 128, 0, 0.4);
          box-shadow: 0 4px 12px rgba(0,0,0,0.05);
        }
        .run-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 16px;
        }
        .run-title {
          font-size: 15px;
          font-weight: 700;
          color: var(--text-main);
          margin: 0 0 4px;
        }
        .run-project {
          font-size: 12px;
          font-weight: 600;
          color: var(--primary);
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          gap: 4px;
        }
        .run-project:hover {
          text-decoration: underline;
        }
        .run-route {
          display: flex;
          align-items: center;
          gap: 8px;
          background: var(--input-bg);
          padding: 8px 12px;
          border-radius: 6px;
          font-size: 13px;
          font-weight: 500;
          color: var(--text-main);
        }
        .route-arrow {
          color: var(--text-muted);
        }
        .run-meta {
          display: flex;
          flex-wrap: wrap;
          gap: 16px;
          font-size: 12px;
          color: var(--text-muted);
        }
        .run-meta-item {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .run-meta-item strong {
          color: var(--text-main);
          font-weight: 600;
        }
        .run-actions {
          display: flex;
          gap: 8px;
          margin-top: 4px;
          padding-top: 12px;
          border-top: 1px dashed var(--border-color);
        }
        .status-btn {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          padding: 6px 12px;
          border-radius: 999px;
          cursor: pointer;
          transition: all 0.2s;
          border: 1px solid transparent;
        }
        .status-btn.is-active {
          box-shadow: inset 0 0 0 1px currentColor;
        }
        .status-btn.scheduled { background: var(--input-bg); color: var(--text-muted); }
        .status-btn.scheduled.is-active { background: rgba(148, 163, 184, 0.1); color: var(--text-main); }
        .status-btn.in_transit { background: rgba(59, 130, 246, 0.1); color: rgb(59, 130, 246); }
        .status-btn.delivered { background: rgba(16, 185, 129, 0.1); color: var(--success); }
        .status-btn.returned { background: rgba(100, 116, 139, 0.1); color: var(--text-muted); }

        .fleet-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .fleet-card {
          background: var(--card-bg);
          border: 1px solid var(--border-color);
          border-radius: 8px;
          padding: 12px;
          cursor: pointer;
          transition: all 0.2s ease;
        }
        .fleet-card:hover {
          border-color: rgba(248, 128, 0, 0.4);
        }
        .fleet-card-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 4px;
        }
        .fleet-card-title {
          font-size: 13px;
          font-weight: 700;
          color: var(--text-main);
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .fleet-card-plate {
          font-size: 11px;
          font-family: monospace;
          background: var(--input-bg);
          display: inline-block;
          padding: 2px 6px;
          border-radius: 4px;
          border: 1px solid var(--border-color);
          color: var(--text-muted);
          margin-bottom: 8px;
        }
        .fleet-card-meta {
          font-size: 12px;
          color: var(--text-muted);
          margin-bottom: 4px;
        }
        .fleet-card-driver {
          font-size: 12px;
          font-weight: 500;
          color: var(--text-main);
          display: flex;
          align-items: center;
          gap: 4px;
        }
        .status-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
        }
        .status-dot.available { background: var(--success); }
        .status-dot.assigned { background: var(--primary); }
        .status-dot.maintenance { background: var(--danger); }
        .status-dot.unavailable { background: var(--text-muted); }
        .transport-page-header > div:first-child,
        .run-card,
        .fleet-card,
        .run-header,
        .run-meta-item,
        .fleet-card-header,
        .fleet-card-title { min-width: 0; }
        .run-title,
        .run-project,
        .run-route span,
        .run-meta-item,
        .fleet-card-title,
        .fleet-card-meta,
        .fleet-card-driver {
          overflow-wrap: anywhere;
        }
        @media (max-width: 640px) {
          .transport-page-header > div:first-child { flex: 1 1 100%; }
          .transport-actions { width: 100%; }
          .transport-actions > button { flex: 1 1 150px; min-width: 0; }
          .run-actions { gap: 6px; }
          .status-btn { flex: 1 1 130px; min-width: 0; }
        }
      `}} />
    </div>
  );
}

function RunCard({ run, onChangeStatus, onOpenProject, t }: { run: Run, onChangeStatus: (status: Run["status"]) => void, onOpenProject: () => void, t: ReturnType<typeof useT> }) {
  return (
    <div className="run-card">
      <div className="run-header">
        <div>
          <h4 className="run-title">{run.title}</h4>
          {run.projectName ? (
            <div className="run-project" onClick={onOpenProject}>
              <Building size={12} /> {run.projectName}
            </div>
          ) : (
            <div className="run-project" style={{ color: "var(--text-muted)", cursor: "default" }}>{t("transport.run.internal")}</div>
          )}
        </div>
      </div>

      <div className="run-route">
        <span>{run.origin}</span>
        <Navigation size={12} className="route-arrow" />
        <span>{run.destination}</span>
      </div>

      <div className="run-meta">
        <div className="run-meta-item">
          <Clock size={14} /> <strong>{format(new Date(run.departureAt), "HH:mm")}</strong> {t("transport.run.departure")}
        </div>
        {run.vehicleName && (
          <div className="run-meta-item">
            <Truck size={14} /> <strong>{run.vehicleName}</strong> {run.vehicleLicensePlate ? `(${run.vehicleLicensePlate})` : ""}
          </div>
        )}
        {run.driverName && (
          <div className="run-meta-item">
            <Users size={14} /> <strong>{run.driverName}</strong>
          </div>
        )}
      </div>

      {(run.loadInAt || run.loadOutAt || run.cargoNotes) && (
        <div className="run-meta" style={{ marginTop: -4 }}>
          {run.loadInAt && (
            <div className="run-meta-item">
               <span style={{ color: "var(--text-muted)" }}>{t("transport.run.loadInLabel")}</span> <strong>{format(new Date(run.loadInAt), "HH:mm")}</strong>
            </div>
          )}
          {run.loadOutAt && (
            <div className="run-meta-item">
               <span style={{ color: "var(--text-muted)" }}>{t("transport.run.loadOutLabel")}</span> <strong>{format(new Date(run.loadOutAt), "HH:mm")}</strong>
            </div>
          )}
          {run.cargoNotes && (
             <div className="run-meta-item" style={{ width: "100%", marginTop: 4 }}>
               <span style={{ color: "var(--text-muted)" }}>{t("transport.run.cargoLabel")}</span> {run.cargoNotes}
             </div>
          )}
        </div>
      )}

      <div className="run-actions">
        <button type="button" className={`status-btn scheduled ${run.status === "scheduled" ? "is-active" : ""}`} onClick={() => onChangeStatus("scheduled")}>
          {t("transport.run.status.scheduled")}
        </button>
        <button type="button" className={`status-btn in_transit ${run.status === "in_transit" ? "is-active" : ""}`} onClick={() => onChangeStatus("in_transit")}>
          <Play size={10} style={{ marginRight: 2 }} /> {t("transport.run.status.in_transit")}
        </button>
        <button type="button" className={`status-btn delivered ${run.status === "delivered" ? "is-active" : ""}`} onClick={() => onChangeStatus("delivered")}>
          <Check size={10} style={{ marginRight: 2 }} /> {t("transport.run.status.delivered")}
        </button>
        <button type="button" className={`status-btn returned ${run.status === "returned" ? "is-active" : ""}`} onClick={() => onChangeStatus("returned")}>
          {t("transport.run.status.returned")}
        </button>
      </div>
    </div>
  );
}
