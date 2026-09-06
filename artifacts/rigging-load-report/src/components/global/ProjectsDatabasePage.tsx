import React, { useCallback, useEffect, useState, useMemo } from "react";
import { Archive, ArchiveRestore, Search, Plus, FileText, ChevronRight, Trash2, ArrowRight } from "lucide-react";
import { DeleteProjectDialog } from "../DeleteProjectDialog";
import { ProjectStatusDialog } from "../ProjectStatusDialog";
import { useI18n, useT } from "../../lib/i18n/I18nContext";
import {
  getNextProjectStatus,
  PROJECT_STATUS_META,
  PROJECT_STATUS_ORDER,
  normalizeProjectStatus,
  type ProjectStatus,
} from "../../lib/projectStatus";
import { toast } from "sonner";

export type ProjectRow = {
  id: string;
  name: string;
  venue: string;
  client: string;
  easyjob_number: string | null;
  crewCount: number;
  status: ProjectStatus;
  eligibleUnsentFreelancers?: Array<{ id: string; name: string }>;
  createdAt: string;
  updatedAt: string;
  accessRole: string;
  archivedAt?: string | null;
  isArchived?: boolean;
  created_by?: string;
  manager?: {
    userId: string;
    name: string;
    email: string | null;
    avatarUrl: string | null;
  };
};

interface Props {
  getToken: () => Promise<string | null>;
  onOpenProject: (id: string) => void;
  onNewProject: () => void;
  onProjectDeleted?: (id: string) => void;
  canPermanentlyDelete: boolean;
}

export function ProjectsDatabasePage({
  getToken,
  onOpenProject,
  onNewProject,
  onProjectDeleted,
  canPermanentlyDelete,
}: Props) {
  const t = useT();
  const { locale } = useI18n();
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [showArchived, setShowArchived] = useState(false);
  const [archiveBusyId, setArchiveBusyId] = useState<string | null>(null);
  const [transitionProject, setTransitionProject] = useState<ProjectRow | null>(null);
  const [transitionLoading, setTransitionLoading] = useState(false);
  const [transitionError, setTransitionError] = useState("");

  const loadProjects = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const token = await getToken();
      const res = await fetch(
        `/api/projects${showArchived ? "?includeArchived=true" : ""}`,
        {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        },
      );
      if (!res.ok) throw new Error(t("projects.database.error.load"));
      const json = await res.json();
      setProjects(
        (json.projects || []).map((project: ProjectRow) => ({
          ...project,
          status: normalizeProjectStatus(project.status),
        })),
      );
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [getToken, showArchived]);

  const changeArchivedState = useCallback(async (project: ProjectRow) => {
    if (archiveBusyId) return;
    setArchiveBusyId(project.id);
    try {
      const token = await getToken();
      const action = project.isArchived ? "unarchive" : "archive";
      const res = await fetch(`/api/projects/${project.id}/${action}`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.project) {
        throw new Error(json?.error || t("projects.archiveError"));
      }
      if (!showArchived && !project.isArchived) {
        setProjects((all) => all.filter((item) => item.id !== project.id));
      } else {
        setProjects((all) =>
          all.map((item) =>
            item.id === project.id
              ? {
                  ...item,
                  ...json.project,
                  status: normalizeProjectStatus(json.project.status, item.status),
                }
              : item,
          ),
        );
      }
      toast.success(
        project.isArchived
          ? t("projects.unarchiveSuccess")
          : t("projects.archiveSuccess"),
      );
      if (!project.isArchived) onProjectDeleted?.(project.id);
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : t("projects.archiveError"),
      );
    } finally {
      setArchiveBusyId(null);
    }
  }, [archiveBusyId, getToken, onProjectDeleted, showArchived, t]);

  const nextStatus = transitionProject
    ? getNextProjectStatus(transitionProject.status)
    : null;

  const changeStatus = useCallback(async (reason?: string) => {
    if (!transitionProject) return;
    const target = getNextProjectStatus(transitionProject.status);
    if (!target || transitionLoading) return;
    setTransitionLoading(true);
    setTransitionError("");
    try {
      const token = await getToken();
      const res = await fetch(`/api/projects/${transitionProject.id}/status`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ status: target, ...(reason ? { reason } : {}) }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok || !json.project) {
        throw new Error(json?.error || t("project.status.error"));
      }
      const confirmedStatus = normalizeProjectStatus(
        json.status ?? json.project.status,
        target,
      );
      setProjects((all) =>
        all.map((project) =>
          project.id === transitionProject.id
            ? { ...project, ...json.project, status: confirmedStatus }
            : project,
        ),
      );
      setTransitionProject(null);
    } catch (cause) {
      setTransitionError(
        cause instanceof Error ? cause.message : t("project.status.error"),
      );
    } finally {
      setTransitionLoading(false);
    }
  }, [getToken, t, transitionLoading, transitionProject]);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  const filtered = useMemo(() => {
    let list = projects;
    if (statusFilter !== "all") {
      list = list.filter(p => p.status === statusFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(p => 
        (p.name || "").toLowerCase().includes(q) ||
        (p.venue || "").toLowerCase().includes(q) ||
        (p.client || "").toLowerCase().includes(q) ||
        (p.easyjob_number && p.easyjob_number.toLowerCase().includes(q))
      );
    }
    return list;
  }, [projects, search, statusFilter]);

  const formatDate = (ds: string) => {
    if (!ds) return "—";
    return new Intl.DateTimeFormat(locale === "no" ? "nb-NO" : "en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric"
    }).format(new Date(ds));
  };

  return (
    <div style={{ padding: "0 16px 40px", maxWidth: 1400, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 16, marginBottom: 24 }}>
        <div style={{ minWidth: 0 }}>
          <h2 style={{ fontSize: "1.5rem", fontWeight: 300, margin: "0 0 8px 0", color: "var(--text-main)" }}>
            {t("projects.database.title")}
          </h2>
          <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", margin: 0 }}>
            {t("projects.database.subtitle")}
          </p>
        </div>
        <button className="ehs-primary-btn" onClick={onNewProject}>
          <Plus size={16} /> {t("projects.database.action.new")}
        </button>
      </div>

      <div className="ehs-table-container">
        <div className="ehs-table-toolbar">
          <div className="ehs-search-input">
            <Search size={16} color="var(--text-muted)" />
            <input 
              type="text" 
              placeholder={t("projects.database.searchPlaceholder")}
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <label
              className="ehs-ghost-btn"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 7,
                padding: "6px 12px",
                fontSize: 12,
                borderRadius: 999,
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(event) => setShowArchived(event.target.checked)}
              />
              {t("projects.showArchived")}
            </label>
            {(["all", ...PROJECT_STATUS_ORDER] as const).map(f => (
              <button
                key={f}
                className={statusFilter === f ? "ehs-primary-btn" : "ehs-ghost-btn"}
                style={{ padding: "6px 12px", fontSize: "12px", borderRadius: 999 }}
                onClick={() => setStatusFilter(f)}
              >
                {f === "all"
                  ? t("project.status.all")
                  : t(`project.status.${f}` as Parameters<typeof t>[0])}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)", fontSize: 14 }}>
            {t("projects.database.loading")}
          </div>
        ) : error ? (
          <div style={{ padding: 40, textAlign: "center", color: "var(--danger)", fontSize: 14 }}>
            {error}
          </div>
        ) : filtered.length === 0 ? (
          <div className="ehs-empty-state">
            <div className="ehs-empty-state-icon">
              <FileText size={24} />
            </div>
            <h3>{t("projects.database.empty.title")}</h3>
            <p>
              {projects.length === 0 
                ? t("projects.database.empty.body")
                : t("projects.database.empty.filtered")}
            </p>
            {projects.length === 0 && (
              <button className="ehs-primary-btn" onClick={onNewProject}>
                <Plus size={16} /> {t("projects.database.action.create")}
              </button>
            )}
          </div>
        ) : (
          <div className="mobile-table-scroll" style={{ overflowX: "auto" }}>
            <table className="ehs-table">
              <thead>
                <tr>
                  <th>{t("projects.database.table.name")}</th>
                  <th>{t("projects.database.table.client")}</th>
                  <th>{t("projects.database.table.venue")}</th>
                  <th>{t("projects.database.table.easyjobNumber")}</th>
                  <th>{t("projects.database.table.crew")}</th>
                  <th>{t("projects.database.table.status")}</th>
                  <th>{t("projects.database.table.updated")}</th>
                  <th>{t("projects.database.table.role")}</th>
                  <th style={{ width: 170 }}></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(p => (
                  <tr key={p.id} className="is-clickable" onClick={() => onOpenProject(p.id)}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{p.name || t("projects.database.untitled")}</div>
                      {p.manager ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, fontWeight: 'normal', fontSize: 12, color: 'var(--text-muted)' }}>
                          {p.manager.avatarUrl ? (
                            <img src={p.manager.avatarUrl} alt={p.manager.name} style={{ width: 16, height: 16, borderRadius: '50%', objectFit: 'cover' }} />
                          ) : (
                            <div style={{ width: 16, height: 16, borderRadius: '50%', background: 'var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, color: 'var(--text-main)', fontWeight: 600 }}>
                              {p.manager.name.charAt(0).toUpperCase()}
                            </div>
                          )}
                          <span title={p.manager.email || undefined}>{t("projects.database.createdBy", { name: p.manager.name })}</span>
                        </div>
                      ) : null}
                    </td>
                    <td>{p.client || "—"}</td>
                    <td>{p.venue || "—"}</td>
                    <td>{p.easyjob_number ? <span style={{ fontFamily: "monospace", color: "var(--text-muted)" }}>{p.easyjob_number}</span> : "—"}</td>
                    <td>{p.crewCount} <span style={{ color: "var(--text-muted)", fontSize: 11 }}>{t("projects.database.pax")}</span></td>
                    <td>
                      <span
                        className={`ehs-badge ${p.status}`}
                        style={{
                          color: PROJECT_STATUS_META[p.status].color,
                          background: PROJECT_STATUS_META[p.status].background,
                        }}
                      >
                        {t(`project.status.${p.status}` as Parameters<typeof t>[0])}
                      </span>
                      {p.isArchived && p.status !== "archived" ? (
                        <span
                          className="ehs-badge archived"
                          style={{
                            marginLeft: 6,
                            color: PROJECT_STATUS_META.archived.color,
                            background: PROJECT_STATUS_META.archived.background,
                          }}
                        >
                          {t("projects.archived")}
                        </span>
                      ) : null}
                    </td>
                    <td style={{ color: "var(--text-muted)", fontSize: 12 }}>{formatDate(p.updatedAt)}</td>
                    <td>
                      <span style={{ textTransform: "capitalize", fontSize: 12, fontWeight: 600, color: "var(--text-muted)" }}>
                        {p.accessRole}
                      </span>
                    </td>
                    <td style={{ textAlign: "right", paddingRight: 16 }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8 }}>
                        {(p.accessRole === "owner" || p.accessRole === "editor") &&
                        getNextProjectStatus(p.status) ? (
                          <button
                            type="button"
                            className="ehs-ghost-btn"
                            onClick={(event) => {
                              event.stopPropagation();
                              setTransitionError("");
                              setTransitionProject(p);
                            }}
                            title={t("project.status.change")}
                            aria-label={t("project.status.change")}
                            style={{ padding: "5px 8px" }}
                          >
                            <ArrowRight size={14} />
                          </button>
                        ) : null}
                        {p.accessRole !== "viewer" ? (
                          <button
                            type="button"
                            className="ehs-ghost-btn"
                            disabled={archiveBusyId === p.id}
                            onClick={(event) => {
                              event.stopPropagation();
                              void changeArchivedState(p);
                            }}
                            title={
                              p.isArchived
                                ? t("projects.unarchive")
                                : t("projects.archive")
                            }
                            aria-label={
                              p.isArchived
                                ? t("projects.unarchive")
                                : t("projects.archive")
                            }
                            style={{ padding: "5px 8px" }}
                          >
                            {p.isArchived ? (
                              <ArchiveRestore size={14} />
                            ) : (
                              <Archive size={14} />
                            )}
                          </button>
                        ) : null}
                        {canPermanentlyDelete && (
                          <DeleteProjectDialog
                            projectId={p.id}
                            projectName={p.name}
                            projectStatus={p.status}
                            getToken={getToken}
                            onSuccess={async () => {
                              await loadProjects();
                              onProjectDeleted?.(p.id);
                            }}
                            trigger={
                              <button
                                type="button"
                                className="ehs-ghost-btn"
                                style={{ color: "var(--danger)", background: "transparent", border: "1px solid var(--danger)", cursor: "pointer", padding: "5px 8px", borderRadius: 6, whiteSpace: "nowrap" }}
                                onClick={(e) => e.stopPropagation()}
                                title={t("projects.permanentDelete")}
                                aria-label={t("projects.permanentDelete")}
                              >
                                <Trash2 size={14} />
                                <span>{t("project.delete.title")}</span>
                              </button>
                            }
                          />
                        )}
                        <ChevronRight size={16} color="var(--text-muted)" />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {transitionProject && nextStatus ? (
        <ProjectStatusDialog
          open
          onOpenChange={(open) => {
            if (!open && !transitionLoading) setTransitionProject(null);
          }}
          fromStatus={transitionProject.status}
          toStatus={nextStatus}
          projectName={transitionProject.name || t("shell.breadcrumb.untitled")}
          eligibleFreelancers={transitionProject.eligibleUnsentFreelancers}
          loading={transitionLoading}
          error={transitionError}
          onConfirm={changeStatus}
        />
      ) : null}
    </div>
  );
}
