import React, { useState, useRef, KeyboardEvent } from "react";
import { useProjectTasks, TASK_STATUSES, TASK_PRIORITIES, TASK_DEPARTMENTS, type ProjectTask, type ProjectTaskStatus, type ProjectTaskPriority, type ProjectTaskDepartment, type TaskUpdate } from "../hooks/use-project-tasks";
import { useT } from "../lib/i18n/I18nContext";
import type { TranslationKey } from "../lib/i18n/types";
import { Plus, Trash2, Calendar, User, MessageSquare, AlertCircle, RefreshCw, X } from "lucide-react";
import { format, parseISO } from "date-fns";

const statusColor = (status: ProjectTaskStatus) => {
  switch (status) {
    case "Done": return "var(--success)";
    case "Stuck": return "var(--danger)";
    case "Working on it": return "var(--primary)";
    default: return "var(--text-muted)";
  }
};

const priorityColor = (priority: ProjectTaskPriority) => {
  switch (priority) {
    case "Urgent": return "var(--danger)";
    case "High": return "var(--warning)";
    case "Medium": return "var(--primary)";
    default: return "var(--text-muted)";
  }
};

interface Props {
  projectId: string | null;
  accessRole?: string;
}

export function ProjectTaskBoard({ projectId, accessRole = "viewer" }: Props) {
  const isViewer = accessRole === "viewer";
  const { tasks, crew, isLoading, error, pendingIds, createTask, updateTask, deleteTask, refetch } = useProjectTasks(projectId);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [selectedTask, setSelectedTask] = useState<ProjectTask | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const addInputRef = useRef<HTMLInputElement>(null);
  const activeSavesRef = useRef(new Set<string>());

  const t = useT();
  const statusKey: Record<ProjectTaskStatus, TranslationKey> = { "Not Started": "projectTasks.status.notStarted", "Working on it": "projectTasks.status.working", Stuck: "projectTasks.status.stuck", Done: "projectTasks.status.done" };
  const priorityKey: Record<ProjectTaskPriority, TranslationKey> = { Low: "projectTasks.priority.low", Medium: "projectTasks.priority.medium", High: "projectTasks.priority.high", Urgent: "projectTasks.priority.urgent" };
  const departmentKey: Record<ProjectTaskDepartment, TranslationKey> = { Rigging: "projectTasks.department.rigging", Lights: "projectTasks.department.lights", LED: "projectTasks.department.led", Sound: "projectTasks.department.sound", Stage: "projectTasks.department.stage", Inspection: "projectTasks.department.inspection", Logistics: "projectTasks.department.logistics" };
  const taskError = error
    ? t(
        error === "saveProjectFirst"
          ? "projectTasks.saveProjectFirst"
          : "projectTasks.loadError",
      )
    : null;

  // If the user clicks on a task row, we open the details sidebar
  const handleRowClick = (task: ProjectTask) => {
    setSelectedTask(task);
  };

  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTaskTitle.trim() || isAdding || !projectId) return;
    setIsAdding(true);
    setActionError(null);
    try {
      await createTask(newTaskTitle.trim());
      setNewTaskTitle("");
      // Keep focus to add another
      setTimeout(() => addInputRef.current?.focus(), 0);
    } catch (err) {
      setActionError(
        err instanceof Error && err.message === "saveProjectFirst"
          ? t("projectTasks.saveProjectFirst")
          : t("projectTasks.createError"),
      );
    } finally {
      setIsAdding(false);
    }
  };

  const safeUpdateTask = async (id: string, updates: TaskUpdate) => {
    if (activeSavesRef.current.has(id)) return null;
    activeSavesRef.current.add(id);
    setActionError(null);
    const confirmedTask = tasks.find((task) => task.id === id);
    try {
      const savedTask = await updateTask(id, updates);
      setSelectedTask((current) =>
        current?.id === id ? savedTask : current,
      );
      return savedTask;
    } catch (err) {
      setActionError(t("projectTasks.updateError"));
      setSelectedTask((current) =>
        current?.id === id ? confirmedTask ?? null : current,
      );
      void refetch();
      return null;
    } finally {
      activeSavesRef.current.delete(id);
    }
  };

  const safeDeleteTask = async (id: string) => {
    if (!window.confirm(t("projectTasks.deleteConfirm"))) return;
    setActionError(null);
    try {
      await deleteTask(id);
      if (selectedTask?.id === id) setSelectedTask(null);
    } catch (err) {
      setActionError(t("projectTasks.deleteError"));
    }
  };

  const handleKeyDownAdd = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      handleAddSubmit(e);
    }
  };

  const selectedTaskPending = selectedTask
    ? pendingIds.has(selectedTask.id)
    : false;

  if (!projectId) {
    return (
      <div className="task-board-container" style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "60vh" }}>
        <div className="task-board-empty">
          <AlertCircle size={32} style={{ margin: "0 auto 16px", color: "var(--text-muted)" }} />
          <h3>{t("projectTasks.noProject")}</h3>
          <p>{t("projectTasks.saveProjectFirst")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="task-board-container">
      <div className="task-board-header">
        <div className="task-board-title-row">
          <h2 className="task-board-title">{t("shell.nav.tasks")}</h2>
          {isLoading && tasks.length === 0 && <span className="task-board-loading-inline">{t("common.loading")}</span>}
        </div>
        {(error || actionError) && (
          <div className="task-board-error">
            <AlertCircle size={14} />
            <span>{taskError || actionError}</span>
            {error && <button className="btn-icon" onClick={() => refetch()} title={t("projectTasks.retry")} aria-label={t("projectTasks.retry")}><RefreshCw size={12} /></button>}
            {actionError && <button className="btn-icon" onClick={() => setActionError(null)} title={t("projectTasks.dismiss")} aria-label={t("projectTasks.dismiss")}><X size={12} /></button>}
          </div>
        )}
      </div>

      <div className="task-board-layout">
        <div className="task-board-main">
          <div className="task-board-table-wrapper">
            <table className="task-board-table">
              <thead>
                <tr>
                  <th style={{ width: "40%" }}>{t("projectTasks.taskName")}</th>
                  <th style={{ width: "15%" }}>{t("projectTasks.status")}</th>
                  <th style={{ width: "15%" }}>{t("projectTasks.priority")}</th>
                  <th style={{ width: "15%" }}>{t("projectTasks.assignee")}</th>
                  <th style={{ width: "15%" }}>{t("projectTasks.dueDate")}</th>
                  <th style={{ width: "40px" }}></th>
                </tr>
              </thead>
              <tbody>
                {tasks.length === 0 && !isLoading && (
                  <tr>
                    <td colSpan={6} className="task-board-empty-row">
                       {t("projectTasks.empty")}
                    </td>
                  </tr>
                )}
                {tasks.map(task => {
                  const isPending = pendingIds.has(task.id);
                  const isSelected = selectedTask?.id === task.id;
                  return (
                    <tr 
                      key={task.id} 
                      className={`task-row ${isPending ? "is-pending" : ""} ${isSelected ? "is-selected" : ""}`}
                      onClick={() => handleRowClick(task)}
                    >
                      <td>
                        <div className="task-cell-title">
                          <span className="task-title-text" style={{ textDecoration: task.status === "Done" ? "line-through" : "none", color: task.status === "Done" ? "var(--text-muted)" : "inherit" }}>
                            {task.title}
                          </span>
                          {task.description && <MessageSquare size={13} className="task-icon-muted" />}
                        </div>
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <select 
                          className="task-select status-select" 
                          value={task.status}
                          onChange={(e) => safeUpdateTask(task.id, { status: e.target.value as ProjectTaskStatus })}
                          style={{ color: statusColor(task.status), borderColor: statusColor(task.status) }}
                          disabled={isPending || isViewer}
                        >
                          {TASK_STATUSES.map(s => <option key={s} value={s}>{t(statusKey[s])}</option>)}
                        </select>
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <select 
                          className="task-select priority-select" 
                          value={task.priority}
                          onChange={(e) => safeUpdateTask(task.id, { priority: e.target.value as ProjectTaskPriority })}
                          style={{ color: priorityColor(task.priority) }}
                          disabled={isPending || isViewer}
                        >
                          {TASK_PRIORITIES.map(s => <option key={s} value={s}>{t(priorityKey[s])}</option>)}
                        </select>
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <select
                          className="task-select"
                          value={task.assignedUserId || ""}
                          onChange={(e) => safeUpdateTask(task.id, { assignedUserId: e.target.value || null })}
                          disabled={isPending || isViewer}
                        >
                          <option value="">{t("projectTasks.unassigned")}</option>
                          {crew.map((member) => (
                            <option key={member.userId} value={member.userId}>
                              {member.fullName}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <input 
                          type="date" 
                          className="task-input-inline date-input" 
                          value={task.dueDate || ""} 
                          onChange={(e) => safeUpdateTask(task.id, { dueDate: e.target.value || null })}
                          disabled={isPending || isViewer}
                        />
                      </td>
                      <td onClick={(e) => e.stopPropagation()} style={{ textAlign: "right", paddingRight: "16px" }}>
                        {!isViewer && (
                          <button
                            className="btn-icon task-delete-btn"
                            onClick={() => safeDeleteTask(task.id)}
                            disabled={isPending}
                            title={t("projectTasks.delete")}
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
                
                {/* Quick Add Row */}
                {!isViewer && (
                  <tr className="task-add-row">
                    <td colSpan={6}>
                      <form onSubmit={handleAddSubmit} className="task-add-form">
                        <Plus size={16} className="task-add-icon" />
                        <input
                          ref={addInputRef}
                          type="text"
                          className="task-add-input"
                           placeholder={t("projectTasks.addPlaceholder")}
                          value={newTaskTitle}
                          onChange={e => setNewTaskTitle(e.target.value)}
                          onKeyDown={handleKeyDownAdd}
                          disabled={isAdding || isLoading}
                        />
                        <button type="submit" className="btn btn-primary btn-sm task-add-btn" disabled={!newTaskTitle.trim() || isAdding || isLoading}>
                           {isAdding ? t("projectTasks.adding") : t("common.add")}
                        </button>
                      </form>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {selectedTask && (
          <div className="task-board-sidebar">
            <div className="task-sidebar-header">
              <div className="task-sidebar-heading">
                 <h3 className="task-sidebar-title">{t("projectTasks.details")}</h3>
                {selectedTaskPending && (
                   <span className="task-saving-indicator">{t("common.saving")}</span>
                )}
              </div>
               <button className="btn-icon task-sidebar-close" onClick={() => setSelectedTask(null)} aria-label={t("projectTasks.closeDetails")}>
                <X size={16} />
              </button>
            </div>
            <div className="task-sidebar-scroll">
              
              <div className="task-form-group">
                 <label>{t("projectTasks.title")}</label>
                <textarea 
                  value={selectedTask.title} 
                  className="task-sidebar-input task-sidebar-textarea title-textarea"
                  rows={2}
                  disabled={selectedTaskPending || isViewer}
                  onChange={(e) => {
                    const val = e.target.value;
                    setSelectedTask({...selectedTask, title: val});
                  }}
                  onBlur={(e) => {
                     const confirmed = tasks.find(t => t.id === selectedTask.id);
                     const title = e.target.value.trim();
                     if (!title) {
                       setSelectedTask(confirmed ?? null);
                     } else if (title !== confirmed?.title) {
                       safeUpdateTask(selectedTask.id, { title });
                    }
                  }}
                />
              </div>

              <div className="task-form-row">
                <div className="task-form-group">
                   <label>{t("projectTasks.status")}</label>
                  <select 
                    className="task-sidebar-select" 
                    value={selectedTask.status}
                    disabled={selectedTaskPending || isViewer}
                    onChange={(e) => {
                      const val = e.target.value as ProjectTaskStatus;
                      setSelectedTask({...selectedTask, status: val});
                      safeUpdateTask(selectedTask.id, { status: val });
                    }}
                  >
                     {TASK_STATUSES.map(s => <option key={s} value={s}>{t(statusKey[s])}</option>)}
                  </select>
                </div>
                <div className="task-form-group">
                   <label>{t("projectTasks.priority")}</label>
                  <select 
                    className="task-sidebar-select" 
                    value={selectedTask.priority}
                    disabled={selectedTaskPending || isViewer}
                    onChange={(e) => {
                      const val = e.target.value as ProjectTaskPriority;
                      setSelectedTask({...selectedTask, priority: val});
                      safeUpdateTask(selectedTask.id, { priority: val });
                    }}
                  >
                     {TASK_PRIORITIES.map(s => <option key={s} value={s}>{t(priorityKey[s])}</option>)}
                  </select>
                </div>
                <div className="task-form-group">
                   <label>{t("projectTasks.department")}</label>
                  <select
                    className="task-sidebar-select"
                    value={selectedTask.department}
                    disabled={selectedTaskPending || isViewer}
                    onChange={(e) => {
                      const department = e.target.value as ProjectTaskDepartment;
                      setSelectedTask({ ...selectedTask, department });
                      safeUpdateTask(selectedTask.id, { department });
                    }}
                  >
                    {TASK_DEPARTMENTS.map((department) => (
                      <option key={department} value={department}>
                         {t(departmentKey[department])}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="task-form-group">
                 <label>{t("projectTasks.assignee")}</label>
                <div className="task-input-with-icon">
                  <User size={14} className="input-icon" />
                   <select
                     value={selectedTask.assignedUserId || ""}
                     className="task-sidebar-input"
                     disabled={selectedTaskPending || isViewer}
                     onChange={(e) => {
                       const assignedUserId = e.target.value || null;
                       const assignedTo =
                         crew.find((member) => member.userId === assignedUserId)?.fullName ?? "";
                       setSelectedTask({ ...selectedTask, assignedUserId, assignedTo });
                       safeUpdateTask(selectedTask.id, { assignedUserId });
                     }}
                   >
                      <option value="">{t("projectTasks.unassigned")}</option>
                     {crew.map((member) => (
                       <option key={member.userId} value={member.userId}>
                         {member.fullName} {member.primaryRole ? `— ${member.primaryRole}` : ""}
                       </option>
                     ))}
                   </select>
                </div>
              </div>

              <div className="task-form-group">
                 <label>{t("projectTasks.dueDate")}</label>
                <div className="task-input-with-icon">
                  <Calendar size={14} className="input-icon" />
                  <input 
                    type="date" 
                    value={selectedTask.dueDate || ""} 
                    className="task-sidebar-input"
                    disabled={selectedTaskPending || isViewer}
                    onChange={(e) => {
                      const val = e.target.value || null;
                      setSelectedTask({...selectedTask, dueDate: val});
                      safeUpdateTask(selectedTask.id, { dueDate: val });
                    }}
                  />
                </div>
              </div>

              <div className="task-form-group task-form-group-flex">
                 <label>{t("projectTasks.descriptionNotes")}</label>
                <textarea 
                  className="task-sidebar-input task-sidebar-textarea" 
                  value={selectedTask.description || ""}
                   placeholder={t("projectTasks.descriptionPlaceholder")}
                  disabled={selectedTaskPending || isViewer}
                  onChange={(e) => setSelectedTask({...selectedTask, description: e.target.value})}
                   onBlur={(e) => {
                     const confirmed = tasks.find(t => t.id === selectedTask.id);
                     if (e.target.value !== confirmed?.description) {
                       safeUpdateTask(selectedTask.id, { description: e.target.value });
                     }
                   }}
                />
              </div>

            </div>
            <div className="task-sidebar-footer">
              <span className="task-meta">
                {t("projectTasks.created")} {format(parseISO(selectedTask.createdAt), "MMM d, yyyy, HH:mm")}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
