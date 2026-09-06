import React, { useState, useEffect, useCallback, useMemo } from "react";
import { format, parseISO } from "date-fns";
import { 
  CheckSquare, Plus, LayoutGrid, List as ListIcon, 
  AlertCircle, X, Search, Clock, Calendar, User, 
  Building, MapPin, CheckCircle, RefreshCw, Filter, MessageSquare, Trash2
} from "lucide-react";
import { useT } from "../../lib/i18n/I18nContext";
import type { TranslationKey } from "../../lib/i18n/types";

export type TaskAccessRole = "owner" | "editor" | "viewer";

export const TASK_STATUSES = ["Not Started", "Working on it", "Stuck", "Done"] as const;
export const TASK_PRIORITIES = ["Low", "Medium", "High", "Urgent"] as const;
export const TASK_DEPARTMENTS = ["Rigging", "Lights", "LED", "Sound", "Stage", "Inspection", "Logistics"] as const;

export type GlobalTask = {
  id: string;
  projectId: string;
  projectName: string;
  title: string;
  status: typeof TASK_STATUSES[number];
  priority: typeof TASK_PRIORITIES[number];
  department: typeof TASK_DEPARTMENTS[number];
  dueDate: string | null;
  assignedTo: string | null;
  assignedUserId: string | null;
  assignedCrewName: string | null;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  accessRole: TaskAccessRole;
};

export type Project = { id: string; name: string; status: string };
export type Freelancer = { userId: string; fullName: string; primaryRole: string };

interface Props {
  getToken: () => Promise<string | null>;
  onOpenProject: (id: string) => void;
}

const API_BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

async function responseError(res: Response, fallback: string): Promise<string> {
  try {
    const body = await res.json();
    return typeof body?.error === "string" ? body.error : fallback;
  } catch {
    return fallback;
  }
}

function authHeaders(token: string | null): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

const KANBAN_COLUMNS = [
  { id: "Not Started", labelKey: "globalTasks.kanban.todo", color: "var(--text-muted)" },
  { id: "Working on it", labelKey: "globalTasks.kanban.inProgress", color: "var(--primary)" },
  { id: "Stuck", labelKey: "globalTasks.kanban.blocked", color: "var(--danger)" },
  { id: "Done", labelKey: "globalTasks.status.done", color: "var(--success)" },
] as const;

export function GlobalTaskBoard({ getToken, onOpenProject }: Props) {
  const t = useT();
  const statusKey: Record<GlobalTask["status"], TranslationKey> = { "Not Started": "globalTasks.status.notStarted", "Working on it": "globalTasks.status.working", Stuck: "globalTasks.status.stuck", Done: "globalTasks.status.done" };
  const priorityKey: Record<GlobalTask["priority"], TranslationKey> = { Low: "globalTasks.priority.low", Medium: "globalTasks.priority.medium", High: "globalTasks.priority.high", Urgent: "globalTasks.priority.urgent" };
  const departmentKey: Record<GlobalTask["department"], TranslationKey> = { Rigging: "globalTasks.department.rigging", Lights: "globalTasks.department.lights", LED: "globalTasks.department.led", Sound: "globalTasks.department.sound", Stage: "globalTasks.department.stage", Inspection: "globalTasks.department.inspection", Logistics: "globalTasks.department.logistics" };
  const [tasks, setTasks] = useState<GlobalTask[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [crew, setCrew] = useState<Freelancer[]>([]);
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [viewMode, setViewMode] = useState<"kanban" | "list">("kanban");
  
  const [filterProject, setFilterProject] = useState("");
  const [filterDepartment, setFilterDepartment] = useState("");
  const [filterPriority, setFilterPriority] = useState("");
  const [filterAssignee, setFilterAssignee] = useState("");
  const [sortBy, setSortBy] = useState("created");

  const [selectedTask, setSelectedTask] = useState<GlobalTask | null>(null);

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [createSaving, setCreateSaving] = useState(false);
  const [createDraft, setCreateDraft] = useState({
    projectId: "",
    title: "",
    status: "Not Started" as GlobalTask["status"],
    priority: "Medium" as GlobalTask["priority"],
    department: "Rigging" as GlobalTask["department"],
    dueDate: "",
    assignedUserId: "",
    description: ""
  });

  const fetchTasks = useCallback(async (isBackground = false) => {
    if (!isBackground) setLoading(true);
    try {
      const token = await getToken();
      const headers = authHeaders(token);
      const res = await fetch(`${API_BASE}/api/tasks`, { headers });
      if (!res.ok) throw new Error(await responseError(res, t("globalTasks.error.fetch")));
      const json = await res.json();
      setTasks(json.tasks || []);
      setError(null);
    } catch (err: any) {
      if (!isBackground) setError(err.message);
    } finally {
      if (!isBackground) setLoading(false);
    }
  }, [getToken, t]);

  useEffect(() => {
    fetchTasks();
    const interval = setInterval(() => fetchTasks(true), 15000);
    const onFocus = () => fetchTasks(true);
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [fetchTasks]);

  useEffect(() => {
    const fetchMeta = async () => {
      try {
        const token = await getToken();
        const headers = authHeaders(token);
        const [projRes, crewRes] = await Promise.all([
          fetch(`${API_BASE}/api/projects`, { headers }),
          fetch(`${API_BASE}/api/portal/freelancers`, { headers })
        ]);
        if (projRes.ok) {
           const { projects } = await projRes.json();
           setProjects(projects || []);
        }
        if (crewRes.ok) {
           const { freelancers } = await crewRes.json();
           setCrew(freelancers || []);
        }
      } catch (err) {
        console.error(err);
      }
    };
    fetchMeta();
  }, [getToken]);

  const safeUpdateTask = async (id: string, updates: Partial<GlobalTask>) => {
    const original = tasks.find(t => t.id === id);
    if (!original || original.accessRole === "viewer") return;
    
    setTasks(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t));
    if (selectedTask?.id === id) {
       setSelectedTask(prev => prev ? { ...prev, ...updates } : null);
    }
    
    try {
      const token = await getToken();
      const headers = { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
      const res = await fetch(`${API_BASE}/api/projects/tasks/${id}`, {
         method: "PATCH",
         headers,
         body: JSON.stringify(updates)
      });
      if (!res.ok) throw new Error(await responseError(res, t("globalTasks.error.update")));
      fetchTasks(true);
    } catch (err: any) {
       setTasks(prev => prev.map(t => t.id === id ? original : t));
       if (selectedTask?.id === id) setSelectedTask(original);
       alert(err.message);
    }
  };

  const handleDeleteTask = async (id: string) => {
    if (!confirm(t("globalTasks.deleteConfirm"))) return;
    const original = tasks.find(t => t.id === id);
    if (!original || original.accessRole === "viewer") return;
    
    setTasks(prev => prev.filter(t => t.id !== id));
    if (selectedTask?.id === id) setSelectedTask(null);
    
    try {
      const token = await getToken();
      const headers = authHeaders(token);
      const res = await fetch(`${API_BASE}/api/projects/tasks/${id}`, {
         method: "DELETE",
         headers
      });
      if (!res.ok) throw new Error(await responseError(res, t("globalTasks.error.delete")));
      fetchTasks(true);
    } catch (err: any) {
      setTasks(prev => [...prev, original]);
      alert(err.message);
    }
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateSaving(true);
    try {
      const token = await getToken();
      const headers = { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
      const payload = {
         ...createDraft,
         assignedUserId: createDraft.assignedUserId || null,
         dueDate: createDraft.dueDate || null,
      };
      const res = await fetch(`${API_BASE}/api/tasks`, {
         method: "POST",
         headers,
         body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error(await responseError(res, t("globalTasks.error.create")));
      
      await fetchTasks(true);
      setIsCreateModalOpen(false);
      setCreateDraft({
        projectId: "", title: "", status: "Not Started", priority: "Medium",
        department: "Rigging", dueDate: "", assignedUserId: "", description: ""
      });
    } catch (err: any) {
      alert(err.message);
    } finally {
      setCreateSaving(false);
    }
  };

  const handleDragStart = (e: React.DragEvent, taskId: string) => {
    e.dataTransfer.setData("text/plain", taskId);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDrop = (e: React.DragEvent, status: GlobalTask["status"]) => {
    e.preventDefault();
    const taskId = e.dataTransfer.getData("text/plain");
    const task = tasks.find(t => t.id === taskId);
    if (task && task.accessRole !== "viewer" && task.status !== status) {
      safeUpdateTask(taskId, { status });
    }
  };

  const filteredTasks = useMemo(() => {
    return tasks.filter(t => {
      if (filterProject && t.projectId !== filterProject) return false;
      if (filterDepartment && t.department !== filterDepartment) return false;
      if (filterPriority && t.priority !== filterPriority) return false;
      if (filterAssignee === "UNASSIGNED" && t.assignedUserId) return false;
      if (
        filterAssignee &&
        filterAssignee !== "UNASSIGNED" &&
        t.assignedUserId !== filterAssignee
      ) return false;
      return true;
    });
  }, [tasks, filterProject, filterDepartment, filterPriority, filterAssignee]);

  const sortedFilteredTasks = useMemo(() => {
    const sorted = [...filteredTasks];
    if (sortBy === "dueDate") {
       sorted.sort((a, b) => {
         if (!a.dueDate) return 1;
         if (!b.dueDate) return -1;
         return a.dueDate.localeCompare(b.dueDate);
       });
    } else if (sortBy === "priority") {
       const pLevel: Record<string, number> = { "Urgent": 4, "High": 3, "Medium": 2, "Low": 1 };
       sorted.sort((a, b) => (pLevel[b.priority] || 0) - (pLevel[a.priority] || 0));
    } else {
       sorted.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }
    return sorted;
  }, [filteredTasks, sortBy]);

  const activeProjects = projects.filter(p => p.status === "active");

  return (
    <div className="gt-container">
      <div className="gt-header">
        <div>
          <h2 className="gt-header-title">{t("globalTasks.title")}</h2>
          <p className="gt-header-subtitle">{t("globalTasks.subtitle")}</p>
        </div>
        <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
          <div className="gt-view-toggle">
            <button 
              className={viewMode === "kanban" ? "is-active" : ""} 
              onClick={() => setViewMode("kanban")}
              title={t("globalTasks.action.kanban")}
            ><LayoutGrid size={16} /></button>
            <button 
              className={viewMode === "list" ? "is-active" : ""} 
              onClick={() => setViewMode("list")}
              title={t("globalTasks.action.list")}
            ><ListIcon size={16} /></button>
          </div>
          <button className="ehs-primary-btn" onClick={() => setIsCreateModalOpen(true)}>
            <Plus size={16} style={{ marginRight: "6px" }} /> {t("globalTasks.action.create")}
          </button>
        </div>
      </div>

      <div className="gt-filters-bar">
        <Filter size={16} color="var(--text-muted)" />
        <select className="gt-filter-select" value={filterProject} onChange={e => setFilterProject(e.target.value)}>
          <option value="">{t("globalTasks.filter.project")}</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select className="gt-filter-select" value={filterDepartment} onChange={e => setFilterDepartment(e.target.value)}>
          <option value="">{t("globalTasks.filter.department")}</option>
          {TASK_DEPARTMENTS.map(d => <option key={d} value={d}>{t(departmentKey[d])}</option>)}
        </select>
        <select className="gt-filter-select" value={filterPriority} onChange={e => setFilterPriority(e.target.value)}>
          <option value="">{t("globalTasks.filter.priority")}</option>
          {TASK_PRIORITIES.map(p => <option key={p} value={p}>{t(priorityKey[p])}</option>)}
        </select>
        <select className="gt-filter-select" value={filterAssignee} onChange={e => setFilterAssignee(e.target.value)}>
          <option value="">{t("globalTasks.filter.assignee")}</option>
          <option value="UNASSIGNED">{t("globalTasks.unassigned")}</option>
          {crew.map(c => <option key={c.userId} value={c.userId}>{c.fullName}</option>)}
        </select>
        
        <div style={{ flex: 1 }} />
        <select className="gt-filter-select" value={sortBy} onChange={e => setSortBy(e.target.value)}>
          <option value="created">{t("globalTasks.sort.created")}</option>
          <option value="dueDate">{t("globalTasks.sort.dueDate")}</option>
          <option value="priority">{t("globalTasks.sort.priority")}</option>
        </select>
        {loading && <RefreshCw size={16} className="gt-spin" color="var(--text-muted)" aria-label={t("globalTasks.loading")} />}
      </div>

      {error && (
        <div className="gt-error-banner">
          <AlertCircle size={16} /> {error}
          <button className="ehs-ghost-btn" onClick={() => fetchTasks()}>{t("globalTasks.action.retry")}</button>
          <button className="btn-icon" aria-label={t("globalTasks.action.dismiss")} title={t("globalTasks.action.dismiss")} onClick={() => setError(null)}><X size={16} /></button>
        </div>
      )}

      {!loading && tasks.length === 0 && !error ? (
        <div className="ehs-empty-state" style={{ marginTop: "40px" }}>
          <div className="ehs-empty-state-icon"><CheckSquare size={32} /></div>
          <h3>{t("globalTasks.empty.title")}</h3>
          <p>{t("globalTasks.empty.body")}</p>
          <button className="ehs-primary-btn" style={{ marginTop: "16px" }} onClick={() => setIsCreateModalOpen(true)}>
            {t("globalTasks.empty.action")}
          </button>
        </div>
      ) : (
        viewMode === "kanban" ? (
          <div className="kanban-board">
            {KANBAN_COLUMNS.map(col => (
              <div 
                key={col.id} 
                className="kanban-column"
                onDragOver={e => e.preventDefault()}
                onDrop={e => handleDrop(e, col.id)}
              >
                <div className="kanban-col-header" style={{ borderTopColor: col.color }}>
                  <span>{t(col.labelKey)}</span>
                  <span className="kanban-count">{sortedFilteredTasks.filter(t => t.status === col.id).length}</span>
                </div>
                <div className="kanban-col-body">
                  {sortedFilteredTasks.filter(t => t.status === col.id).map(task => (
                    <div 
                      key={task.id}
                      className={`gt-card ${task.accessRole === "viewer" ? "is-readonly" : ""}`}
                      draggable={task.accessRole !== "viewer"}
                      onDragStart={e => handleDragStart(e, task.id)}
                      onClick={() => setSelectedTask(task)}
                    >
                      <div className="gt-card-project" onClick={e => { e.stopPropagation(); onOpenProject(task.projectId); }}>
                        {task.projectName}
                      </div>
                      <div className="gt-card-title">{task.title}</div>
                      <div className="gt-card-meta">
                        <div className="gt-meta-left">
                          <span className={`gt-priority-badge gt-priority-${task.priority}`}>{t(priorityKey[task.priority])}</span>
                          <span className="gt-dept-badge">{t(departmentKey[task.department])}</span>
                        </div>
                        <div className="gt-meta-right">
                          {task.dueDate && <span className="gt-due-badge" title={t("globalTasks.dueDate")}><Calendar size={10} /> {format(parseISO(task.dueDate), "MMM d")}</span>}
                          {task.assignedCrewName && (
                            <div className="gt-assignee-badge" title={task.assignedCrewName}>
                              <User size={10} /> {task.assignedCrewName.split(" ")[0]}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="gt-table-wrapper">
            <table className="gt-table">
              <thead>
                <tr>
                  <th>{t("globalTasks.table.project")}</th>
                  <th>{t("globalTasks.table.task")}</th>
                  <th>{t("globalTasks.table.status")}</th>
                  <th>{t("globalTasks.table.priority")}</th>
                  <th>{t("globalTasks.table.department")}</th>
                  <th>{t("globalTasks.table.assignee")}</th>
                  <th>{t("globalTasks.table.dueDate")}</th>
                </tr>
              </thead>
              <tbody>
                {sortedFilteredTasks.map(task => (
                  <tr key={task.id} onClick={() => setSelectedTask(task)}>
                    <td>
                      <span className="gt-card-project" onClick={e => { e.stopPropagation(); onOpenProject(task.projectId); }}>
                        {task.projectName}
                      </span>
                    </td>
                    <td style={{ fontWeight: 500 }}>{task.title}</td>
                    <td onClick={e => e.stopPropagation()}>
                      <select 
                        value={task.status}
                        onChange={e => safeUpdateTask(task.id, { status: e.target.value as any })}
                        disabled={task.accessRole === "viewer"}
                        className={`gt-table-select gt-status-${task.status.replace(/\s+/g, "")}`}
                      >
                        {TASK_STATUSES.map(s => <option key={s} value={s}>{t(statusKey[s])}</option>)}
                      </select>
                    </td>
                    <td>
                      <span className={`gt-priority-badge gt-priority-${task.priority}`}>{t(priorityKey[task.priority])}</span>
                    </td>
                    <td><span className="gt-dept-badge">{t(departmentKey[task.department])}</span></td>
                    <td>
                      {task.assignedCrewName ? (
                        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}><User size={12} color="var(--text-muted)" /> {task.assignedCrewName}</div>
                      ) : <span style={{ color: "var(--text-muted)" }}>{t("globalTasks.unassigned")}</span>}
                    </td>
                    <td>
                      {task.dueDate ? (
                        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}><Calendar size={12} color="var(--text-muted)" /> {format(parseISO(task.dueDate), "MMM d, yyyy")}</div>
                      ) : t("globalTasks.noDueDate")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {/* Sidebar for editing a selected task */}
      {selectedTask && (
        <div className="gt-sidebar-overlay" onClick={() => setSelectedTask(null)}>
          <div className="gt-sidebar" onClick={e => e.stopPropagation()}>
            <div className="gt-sidebar-header">
              <h3 style={{ fontSize: "16px", margin: 0 }}>{t("globalTasks.sidebar.title")}</h3>
              <button className="btn-icon" aria-label={t("common.close")} title={t("common.close")} onClick={() => setSelectedTask(null)}><X size={16} /></button>
            </div>
            <div className="gt-sidebar-body">
              <div className="ehs-form-group">
                <label>{t("globalTasks.sidebar.project")}</label>
                <div style={{ padding: "8px 12px", background: "var(--input-bg)", borderRadius: "6px", fontSize: "14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <strong>{selectedTask.projectName}</strong>
                  <button className="ehs-ghost-btn" style={{ padding: "4px 8px", fontSize: "12px" }} onClick={() => onOpenProject(selectedTask.projectId)}>{t("globalTasks.sidebar.open")}</button>
                </div>
              </div>
              <div className="ehs-form-group">
                <label>{t("globalTasks.sidebar.taskTitle")}</label>
                <textarea 
                  className="ehs-input" 
                  rows={2}
                  style={{ resize: "none" }}
                  value={selectedTask.title}
                  disabled={selectedTask.accessRole === "viewer"}
                  onChange={e => setSelectedTask({...selectedTask, title: e.target.value})}
                  onBlur={e => {
                    const original = tasks.find(t => t.id === selectedTask.id);
                    if (original && original.title !== e.target.value) safeUpdateTask(selectedTask.id, { title: e.target.value });
                  }}
                />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
                <div className="ehs-form-group">
                  <label>{t("globalTasks.sidebar.status")}</label>
                  <select 
                    className={`ehs-input gt-status-${selectedTask.status.replace(/\s+/g, "")}`} 
                    value={selectedTask.status} 
                    disabled={selectedTask.accessRole === "viewer"}
                    onChange={e => {
                      const val = e.target.value as any;
                      setSelectedTask({...selectedTask, status: val});
                      safeUpdateTask(selectedTask.id, { status: val });
                    }}
                  >
                    {TASK_STATUSES.map(s => <option key={s} value={s}>{t(statusKey[s])}</option>)}
                  </select>
                </div>
                <div className="ehs-form-group">
                  <label>{t("globalTasks.sidebar.priority")}</label>
                  <select 
                    className={`ehs-input gt-priority-${selectedTask.priority}`} 
                    value={selectedTask.priority} 
                    disabled={selectedTask.accessRole === "viewer"}
                    onChange={e => {
                      const val = e.target.value as any;
                      setSelectedTask({...selectedTask, priority: val});
                      safeUpdateTask(selectedTask.id, { priority: val });
                    }}
                  >
                    {TASK_PRIORITIES.map(s => <option key={s} value={s}>{t(priorityKey[s])}</option>)}
                  </select>
                </div>
                <div className="ehs-form-group">
                  <label>{t("globalTasks.sidebar.department")}</label>
                  <select 
                    className="ehs-input" 
                    value={selectedTask.department} 
                    disabled={selectedTask.accessRole === "viewer"}
                    onChange={e => {
                      const val = e.target.value as any;
                      setSelectedTask({...selectedTask, department: val});
                      safeUpdateTask(selectedTask.id, { department: val });
                    }}
                  >
                    {TASK_DEPARTMENTS.map(s => <option key={s} value={s}>{t(departmentKey[s])}</option>)}
                  </select>
                </div>
                <div className="ehs-form-group">
                  <label>{t("globalTasks.sidebar.dueDate")}</label>
                  <input 
                    type="date" 
                    className="ehs-input" 
                    value={selectedTask.dueDate || ""} 
                    disabled={selectedTask.accessRole === "viewer"}
                    onChange={e => {
                      const val = e.target.value || null;
                      setSelectedTask({...selectedTask, dueDate: val});
                      safeUpdateTask(selectedTask.id, { dueDate: val });
                    }}
                  />
                </div>
              </div>
              <div className="ehs-form-group">
                <label>{t("globalTasks.sidebar.assignee")}</label>
                <select 
                  className="ehs-input" 
                  value={selectedTask.assignedUserId || ""} 
                  disabled={selectedTask.accessRole === "viewer"}
                  onChange={e => {
                    const val = e.target.value || null;
                    const c = crew.find(x => x.userId === val);
                    setSelectedTask({...selectedTask, assignedUserId: val, assignedTo: c?.fullName || null, assignedCrewName: c?.fullName || null});
                    safeUpdateTask(selectedTask.id, { assignedUserId: val });
                  }}
                >
                  <option value="">{t("globalTasks.unassigned")}</option>
                  {crew.map(c => <option key={c.userId} value={c.userId}>{c.fullName}</option>)}
                </select>
              </div>
              <div className="ehs-form-group">
                <label>{t("globalTasks.sidebar.description")}</label>
                <textarea 
                  className="ehs-input" 
                  rows={6}
                  value={selectedTask.description || ""}
                  disabled={selectedTask.accessRole === "viewer"}
                  placeholder={t("globalTasks.sidebar.descriptionPlaceholder")}
                  onChange={e => setSelectedTask({...selectedTask, description: e.target.value})}
                  onBlur={e => {
                    const original = tasks.find(t => t.id === selectedTask.id);
                    if (original && original.description !== e.target.value) safeUpdateTask(selectedTask.id, { description: e.target.value });
                  }}
                />
              </div>
            </div>
            <div className="gt-sidebar-footer">
              <span className="gt-meta-text">{t("globalTasks.sidebar.created", { date: format(parseISO(selectedTask.createdAt), "MMM d, yyyy, HH:mm") })}</span>
              {selectedTask.accessRole !== "viewer" && (
                <button className="btn-icon" style={{ color: "var(--danger)" }} aria-label={t("globalTasks.sidebar.delete")} title={t("globalTasks.sidebar.delete")} onClick={() => handleDeleteTask(selectedTask.id)}>
                  <Trash2 size={16} />
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Create Modal */}
      {isCreateModalOpen && (
        <div className="ehs-modal-backdrop" onClick={() => !createSaving && setIsCreateModalOpen(false)}>
          <div className="ehs-modal" onClick={e => e.stopPropagation()}>
            <div className="ehs-modal-header">
              <h3>{t("globalTasks.modal.title")}</h3>
              <button className="btn-icon" aria-label={t("common.close")} title={t("common.close")} onClick={() => setIsCreateModalOpen(false)}><X size={16} /></button>
            </div>
            <form onSubmit={handleCreateSubmit}>
              <div className="ehs-modal-body">
                <div className="ehs-form-group">
                  <label>{t("globalTasks.modal.project")}</label>
                  <select required className="ehs-input" value={createDraft.projectId} onChange={e => setCreateDraft({...createDraft, projectId: e.target.value})}>
                    <option value="">{t("globalTasks.modal.project.none")}</option>
                    {activeProjects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
                <div className="ehs-form-group">
                  <label>{t("globalTasks.modal.taskTitle")}</label>
                  <input required className="ehs-input" value={createDraft.title} onChange={e => setCreateDraft({...createDraft, title: e.target.value})} placeholder={t("globalTasks.modal.titlePlaceholder")} />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
                  <div className="ehs-form-group">
                    <label>{t("globalTasks.modal.status")}</label>
                    <select required className="ehs-input" value={createDraft.status} onChange={e => setCreateDraft({...createDraft, status: e.target.value as any})}>
                      {TASK_STATUSES.map(s => <option key={s} value={s}>{t(statusKey[s])}</option>)}
                    </select>
                  </div>
                  <div className="ehs-form-group">
                    <label>{t("globalTasks.modal.priority")}</label>
                    <select required className="ehs-input" value={createDraft.priority} onChange={e => setCreateDraft({...createDraft, priority: e.target.value as any})}>
                      {TASK_PRIORITIES.map(s => <option key={s} value={s}>{t(priorityKey[s])}</option>)}
                    </select>
                  </div>
                  <div className="ehs-form-group">
                    <label>{t("globalTasks.modal.department")}</label>
                    <select required className="ehs-input" value={createDraft.department} onChange={e => setCreateDraft({...createDraft, department: e.target.value as any})}>
                      {TASK_DEPARTMENTS.map(s => <option key={s} value={s}>{t(departmentKey[s])}</option>)}
                    </select>
                  </div>
                  <div className="ehs-form-group">
                    <label>{t("globalTasks.modal.dueDate")}</label>
                    <input type="date" className="ehs-input" value={createDraft.dueDate} onChange={e => setCreateDraft({...createDraft, dueDate: e.target.value})} />
                  </div>
                </div>
                <div className="ehs-form-group">
                  <label>{t("globalTasks.modal.assignee")}</label>
                  <select className="ehs-input" value={createDraft.assignedUserId} onChange={e => setCreateDraft({...createDraft, assignedUserId: e.target.value})}>
                    <option value="">{t("globalTasks.unassigned")}</option>
                    {crew.map(c => <option key={c.userId} value={c.userId}>{c.fullName}</option>)}
                  </select>
                </div>
                <div className="ehs-form-group">
                  <label>{t("globalTasks.modal.description")}</label>
                  <textarea className="ehs-input" rows={4} value={createDraft.description} onChange={e => setCreateDraft({...createDraft, description: e.target.value})} placeholder={t("globalTasks.modal.descriptionPlaceholder")} />
                </div>
              </div>
              <div className="ehs-modal-footer">
                <button type="button" className="ehs-ghost-btn" onClick={() => setIsCreateModalOpen(false)}>{t("globalTasks.modal.cancel")}</button>
                <button type="submit" className="ehs-primary-btn" disabled={createSaving}>{createSaving ? t("globalTasks.modal.saving") : t("globalTasks.modal.create")}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      <style dangerouslySetInnerHTML={{__html: `
        .gt-container {
          padding: 0 16px 40px;
          max-width: 1600px;
          margin: 0 auto;
          height: calc(100vh - 100px);
          display: flex;
          flex-direction: column;
        }
        .gt-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-end;
          margin-bottom: 24px;
        }
        .gt-header-title {
          font-size: 1.5rem;
          font-weight: 300;
          margin: 0 0 8px 0;
          color: var(--text-main);
        }
        .gt-header-subtitle {
          color: var(--text-muted);
          font-size: 0.85rem;
          margin: 0;
        }
        .gt-view-toggle {
          display: flex;
          background: var(--input-bg);
          border-radius: 6px;
          padding: 2px;
          border: 1px solid var(--border-color);
        }
        .gt-view-toggle button {
          background: transparent;
          border: none;
          padding: 6px 12px;
          border-radius: 4px;
          cursor: pointer;
          color: var(--text-muted);
          transition: all 0.2s;
        }
        .gt-view-toggle button.is-active {
          background: var(--card-bg);
          color: var(--text-main);
          box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }
        .gt-filters-bar {
          display: flex;
          gap: 12px;
          flex-wrap: wrap;
          margin-bottom: 20px;
          padding: 12px;
          background: var(--card-bg);
          border: 1px solid var(--border-color);
          border-radius: 8px;
          align-items: center;
        }
        .gt-filter-select {
          background: var(--input-bg);
          border: 1px solid transparent;
          border-radius: 6px;
          padding: 6px 10px;
          font-size: 13px;
          color: var(--text-main);
          outline: none;
          cursor: pointer;
          width: auto;
          min-width: 150px;
          flex: 0 1 190px;
        }
        .gt-filter-select:hover, .gt-filter-select:focus {
          border-color: var(--border-color);
        }
        .kanban-board {
          display: flex;
          gap: 16px;
          overflow-x: auto;
          flex: 1;
          min-height: 0;
          padding-bottom: 16px;
        }
        .kanban-column {
          flex: 1;
          min-width: 320px;
          background: rgba(0, 0, 0, 0.02);
          border-radius: 8px;
          display: flex;
          flex-direction: column;
          max-height: 100%;
          border: 1px solid var(--border-color);
        }
        .dark .kanban-column {
          background: rgba(255, 255, 255, 0.02);
        }
        .kanban-col-header {
          padding: 12px 16px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          border-top: 3px solid;
          border-radius: 8px 8px 0 0;
          font-weight: 600;
          font-size: 13px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: var(--text-main);
          background: var(--card-bg);
          border-bottom: 1px solid var(--border-color);
        }
        .kanban-count {
          background: var(--input-bg);
          padding: 2px 8px;
          border-radius: 12px;
          font-size: 11px;
          color: var(--text-muted);
        }
        .kanban-col-body {
          padding: 12px;
          overflow-y: auto;
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .gt-card {
          background: var(--card-bg);
          border: 1px solid var(--border-color);
          border-radius: 8px;
          padding: 14px;
          cursor: grab;
          transition: transform 0.2s, box-shadow 0.2s, border-color 0.2s;
          position: relative;
          box-shadow: 0 1px 3px rgba(0,0,0,0.02);
        }
        .gt-card.is-readonly {
          cursor: pointer;
        }
        .gt-card:active:not(.is-readonly) {
          cursor: grabbing;
          transform: scale(0.98);
        }
        .gt-card:hover {
          border-color: rgba(248, 128, 0, 0.4);
          box-shadow: 0 4px 12px rgba(0,0,0,0.05);
        }
        .gt-card-project {
          font-size: 11px;
          font-weight: 700;
          color: var(--primary);
          margin-bottom: 6px;
          cursor: pointer;
          display: inline-block;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        .gt-card-project:hover {
          text-decoration: underline;
        }
        .gt-card-title {
          font-size: 14px;
          font-weight: 600;
          color: var(--text-main);
          margin-bottom: 14px;
          line-height: 1.4;
        }
        .gt-card-meta {
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 12px;
          color: var(--text-muted);
        }
        .gt-meta-left, .gt-meta-right {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .gt-priority-badge {
          padding: 2px 6px;
          border-radius: 4px;
          font-size: 10px;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        .gt-priority-Urgent { background: rgba(239, 68, 68, 0.1); color: var(--danger); }
        .gt-priority-High { background: rgba(245, 158, 11, 0.1); color: var(--warning); }
        .gt-priority-Medium { background: rgba(59, 130, 246, 0.1); color: var(--primary); }
        .gt-priority-Low { background: rgba(100, 116, 139, 0.1); color: var(--text-muted); }
        .gt-dept-badge {
          font-size: 11px;
          font-weight: 500;
          padding: 2px 6px;
          background: var(--input-bg);
          border-radius: 4px;
        }
        .gt-assignee-badge, .gt-due-badge {
          display: flex;
          align-items: center;
          gap: 4px;
          font-size: 11px;
          font-weight: 500;
        }
        
        .gt-table-wrapper {
          background: var(--card-bg);
          border: 1px solid var(--border-color);
          border-radius: 8px;
          overflow: auto;
          flex: 1;
        }
        .gt-table {
          width: 100%;
          border-collapse: collapse;
          text-align: left;
          font-size: 13px;
        }
        .gt-table th {
          padding: 12px 16px;
          border-bottom: 1px solid var(--border-color);
          background: rgba(0,0,0,0.02);
          color: var(--text-muted);
          font-weight: 600;
          text-transform: uppercase;
          font-size: 11px;
          letter-spacing: 0.5px;
          white-space: nowrap;
        }
        .dark .gt-table th {
          background: rgba(255,255,255,0.02);
        }
        .gt-table td {
          padding: 14px 16px;
          border-bottom: 1px solid var(--border-color);
          color: var(--text-main);
          vertical-align: middle;
        }
        .gt-table tr:last-child td {
          border-bottom: none;
        }
        .gt-table tr:hover {
          background: rgba(0,0,0,0.01);
          cursor: pointer;
        }
        .dark .gt-table tr:hover {
          background: rgba(255,255,255,0.01);
        }
        .gt-table-select {
          background: transparent;
          border: 1px solid transparent;
          border-radius: 4px;
          font-size: 12px;
          font-weight: 700;
          padding: 4px 6px;
          cursor: pointer;
          transition: all 0.2s;
        }
        .gt-table-select:hover:not(:disabled) {
          border-color: var(--border-color);
          background: var(--input-bg);
        }
        .gt-table-select:disabled {
          cursor: not-allowed;
          opacity: 0.7;
        }
        
        .gt-status-NotStarted { color: var(--text-muted); }
        .gt-status-Workingonit { color: var(--primary); }
        .gt-status-Stuck { color: var(--danger); }
        .gt-status-Done { color: var(--success); text-decoration: line-through; }

        .gt-sidebar-overlay {
          position: fixed;
          top: 0; left: 0; right: 0; bottom: 0;
          background: rgba(0,0,0,0.4);
          z-index: 1000;
          display: flex;
          justify-content: flex-end;
          animation: fadeIn 0.2s ease;
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        .gt-sidebar {
          width: 440px;
          max-width: 90vw;
          background: var(--card-bg);
          height: 100%;
          box-shadow: -4px 0 24px rgba(0,0,0,0.1);
          display: flex;
          flex-direction: column;
          animation: slideInRight 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
        @keyframes slideInRight {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
        .gt-sidebar-header {
          padding: 16px 20px;
          border-bottom: 1px solid var(--border-color);
          display: flex;
          justify-content: space-between;
          align-items: center;
          background: var(--input-bg);
        }
        .gt-sidebar-body {
          padding: 24px 20px;
          overflow-y: auto;
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 20px;
        }
        .gt-sidebar-footer {
          padding: 16px 20px;
          border-top: 1px solid var(--border-color);
          display: flex;
          justify-content: space-between;
          align-items: center;
          background: var(--input-bg);
        }
        .gt-meta-text {
          font-size: 12px;
          color: var(--text-muted);
        }
        .gt-error-banner {
          background: rgba(239, 68, 68, 0.1);
          color: var(--danger);
          padding: 12px 16px;
          border-radius: 8px;
          margin-bottom: 20px;
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 13px;
          font-weight: 500;
        }
        .gt-spin {
          animation: spin 1s linear infinite;
        }
        @keyframes spin { 100% { transform: rotate(360deg); } }
        @media (max-width: 760px) {
          .gt-container {
            height: auto;
            min-height: calc(100vh - 100px);
            padding-inline: 8px;
          }
          .gt-header {
            align-items: flex-start;
            gap: 16px;
          }
          .gt-filters-bar {
            align-items: stretch;
          }
          .gt-filter-select {
            flex: 1 1 calc(50% - 12px);
            min-width: 130px;
          }
          .kanban-column {
            min-height: 420px;
            max-height: 70vh;
          }
        }
      `}} />
    </div>
  );
}
