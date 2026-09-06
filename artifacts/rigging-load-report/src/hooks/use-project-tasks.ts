import { useAuth } from "@clerk/react";
import { useCallback, useEffect, useRef, useState } from "react";

const API_BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

export const TASK_STATUSES = [
  "Not Started",
  "Working on it",
  "Stuck",
  "Done",
] as const;
export const TASK_PRIORITIES = ["Low", "Medium", "High", "Urgent"] as const;
export const TASK_DEPARTMENTS = [
  "Rigging",
  "Lights",
  "LED",
  "Sound",
  "Stage",
  "Inspection",
  "Logistics",
] as const;

export type ProjectTaskStatus = (typeof TASK_STATUSES)[number];
export type ProjectTaskPriority = (typeof TASK_PRIORITIES)[number];
export type ProjectTaskDepartment = (typeof TASK_DEPARTMENTS)[number];
export type TaskCrewMember = {
  userId: string;
  fullName: string;
  primaryRole: string;
};

export type ProjectTask = {
  id: string;
  projectId: string;
  title: string;
  status: ProjectTaskStatus;
  priority: ProjectTaskPriority;
  department: ProjectTaskDepartment;
  dueDate: string | null;
  assignedTo: string;
  assignedUserId: string | null;
  description: string;
  createdAt: string;
  updatedAt: string;
};

export type TaskUpdate = Partial<
  Pick<
    ProjectTask,
    "title" | "status" | "priority" | "department" | "dueDate" | "assignedTo" | "assignedUserId" | "description"
  >
>;

export type ProjectTaskErrorCode = "loadFailed" | "saveProjectFirst";

export function useProjectTasks(projectId: string | null) {
  const { getToken } = useAuth();
  const [tasks, setTasks] = useState<ProjectTask[]>([]);
  const [crew, setCrew] = useState<TaskCrewMember[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<ProjectTaskErrorCode | null>(null);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const updateQueues = useRef(new Map<string, Promise<ProjectTask>>());

  const request = useCallback(
    async (path: string, init?: RequestInit) => {
      const token = await getToken();
      const response = await fetch(`${API_BASE}${path}`, {
        ...init,
        headers: {
          ...(init?.body ? { "Content-Type": "application/json" } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...init?.headers,
        },
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(json.error || `HTTP ${response.status}`);
      }
      return json;
    },
    [getToken],
  );

  const refetch = useCallback(async () => {
    if (!projectId) {
      setTasks([]);
      setError(null);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const json = await request(`/api/projects/${projectId}/tasks`);
      setTasks(json.tasks ?? []);
    } catch (cause) {
      setError("loadFailed");
    } finally {
      setIsLoading(false);
    }
  }, [projectId, request]);

  useEffect(() => {
    void refetch();
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void refetch();
    }, 15_000);
    const onFocus = () => void refetch();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [refetch]);

  useEffect(() => {
    let cancelled = false;
    void request("/api/portal/freelancers")
      .then((json) => {
        if (!cancelled) setCrew(json.freelancers ?? []);
      })
      .catch(() => {
        if (!cancelled) setCrew([]);
      });
    return () => {
      cancelled = true;
    };
  }, [request]);

  const createTask = useCallback(
    async (title: string) => {
      if (!projectId) throw new Error("saveProjectFirst");
      const json = await request(`/api/projects/${projectId}/tasks`, {
        method: "POST",
        body: JSON.stringify({ title }),
      });
      setTasks((current) => [...current, json.task]);
      return json.task as ProjectTask;
    },
    [projectId, request],
  );

  const updateTask = useCallback(
    async (id: string, updates: TaskUpdate) => {
      setPendingIds((current) => new Set(current).add(id));
      const previous = updateQueues.current.get(id) ?? Promise.resolve(null);
      const operation = previous.catch(() => null).then(async () => {
        const json = await request(`/api/projects/tasks/${id}`, {
          method: "PATCH",
          body: JSON.stringify(updates),
        });
        setTasks((current) =>
          current.map((task) => (task.id === id ? json.task : task)),
        );
        return json.task as ProjectTask;
      });
      updateQueues.current.set(id, operation);
      try {
        return await operation;
      } finally {
        if (updateQueues.current.get(id) === operation) {
          updateQueues.current.delete(id);
          setPendingIds((current) => {
            const next = new Set(current);
            next.delete(id);
            return next;
          });
        }
      }
    },
    [request],
  );

  const deleteTask = useCallback(
    async (id: string) => {
      setPendingIds((current) => new Set(current).add(id));
      try {
        await request(`/api/projects/tasks/${id}`, { method: "DELETE" });
        setTasks((current) => current.filter((task) => task.id !== id));
      } finally {
        setPendingIds((current) => {
          const next = new Set(current);
          next.delete(id);
          return next;
        });
      }
    },
    [request],
  );

  return {
    tasks,
    crew,
    isLoading,
    error,
    pendingIds,
    createTask,
    updateTask,
    deleteTask,
    refetch,
  };
}