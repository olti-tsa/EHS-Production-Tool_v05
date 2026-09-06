import { useAuth } from "@clerk/react";
import { useCallback, useEffect, useRef, useState } from "react";

const API_BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

export type ChatRole = "owner" | "editor" | "viewer";
export type ProjectChatErrorCode = "loadFailed" | "sendFailed";

export type ChatMember = {
  userId: string;
  role: ChatRole;
  name: string | null;
  email: string | null;
  isOwner: boolean;
};

export type ChatMessage = {
  id: string;
  projectId: string;
  authorUserId: string;
  authorName: string | null;
  authorEmail: string | null;
  body: string;
  createdAt: string;
};

export function useProjectChat(projectId: string | null) {
  const { getToken } = useAuth();
  
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [members, setMembers] = useState<ChatMember[]>([]);
  const [currentRole, setCurrentRole] = useState<ChatRole | null>(null);
  
  const [isInitializing, setIsInitializing] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<ProjectChatErrorCode | null>(null);
  
  const isMountedRef = useRef(true);
  const latestMessageIdRef = useRef<string | null>(null);
  const activeProjectIdRef = useRef(projectId);
  activeProjectIdRef.current = projectId;

  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  const request = useCallback(
    async (path: string, init?: RequestInit, signal?: AbortSignal) => {
      const token = await getToken();
      const response = await fetch(`${API_BASE}${path}`, {
        ...init,
        signal,
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

  const fetchMembers = useCallback(async (signal?: AbortSignal) => {
    if (!projectId) return;
    const requestedProjectId = projectId;
    try {
      const json = await request(`/api/projects/${requestedProjectId}/members`, {}, signal);
      if (
        isMountedRef.current &&
        activeProjectIdRef.current === requestedProjectId
      ) {
        setMembers(json.members || []);
        setCurrentRole(json.currentRole || null);
      }
    } catch (err) {
      if (err instanceof Error && err.name !== "AbortError") {
        console.error("Failed to fetch members:", err);
      }
    }
  }, [projectId, request]);

  const loadInitial = useCallback(async (signal?: AbortSignal) => {
    if (!projectId) return;
    const requestedProjectId = projectId;
    try {
      const json = await request(
        `/api/projects/${requestedProjectId}/messages?limit=50`,
        {},
        signal,
      );
      if (
        isMountedRef.current &&
        activeProjectIdRef.current === requestedProjectId
      ) {
        const msgs = json.messages || [];
        // The messages are returned ascending (oldest first). 
        // We will assume the backend does this or we can sort just in case.
        setMessages(msgs);
        setHasMore(!!json.hasMore);
        if (msgs.length > 0) {
          latestMessageIdRef.current = msgs[msgs.length - 1].id;
        } else {
          latestMessageIdRef.current = null;
        }
      }
    } catch (err) {
      if (
        err instanceof Error &&
        err.name !== "AbortError" &&
        isMountedRef.current &&
        activeProjectIdRef.current === requestedProjectId
      ) {
        setError("loadFailed");
      }
    }
  }, [projectId, request]);

  const pollMessages = useCallback(async (signal?: AbortSignal) => {
    if (!projectId || document.hidden) return;
    const requestedProjectId = projectId;
    
    let url = `/api/projects/${requestedProjectId}/messages?limit=50`;
    if (latestMessageIdRef.current) {
      url += `&after=${latestMessageIdRef.current}`;
    }
    
    try {
      const json = await request(url, {}, signal);
      if (
        !isMountedRef.current ||
        activeProjectIdRef.current !== requestedProjectId
      ) {
        return;
      }
      
      const newMsgs: ChatMessage[] = json.messages || [];
      if (newMsgs.length > 0) {
        setMessages(prev => {
          const combined = [...prev, ...newMsgs];
          const seen = new Set<string>();
          const deduped = combined.filter(m => {
            if (seen.has(m.id)) return false;
            seen.add(m.id);
            return true;
          });
          return deduped;
        });
        latestMessageIdRef.current = newMsgs[newMsgs.length - 1].id;
      }
    } catch (err) {
      // Ignore transient polling errors
    }
  }, [projectId, request]);

  useEffect(() => {
    if (!projectId) {
      setMessages([]);
      setMembers([]);
      setCurrentRole(null);
      setError(null);
      latestMessageIdRef.current = null;
      return;
    }

    const ac = new AbortController();
    const requestedProjectId = projectId;
    setMessages([]);
    setMembers([]);
    setCurrentRole(null);
    setHasMore(false);
    setIsSending(false);
    latestMessageIdRef.current = null;
    setIsInitializing(true);
    setError(null);

    Promise.all([
      loadInitial(ac.signal),
      fetchMembers(ac.signal)
    ]).finally(() => {
      if (
        isMountedRef.current &&
        activeProjectIdRef.current === requestedProjectId
      ) {
        setIsInitializing(false);
      }
    });

    return () => ac.abort();
  }, [projectId, loadInitial, fetchMembers]);

  useEffect(() => {
    if (!projectId) return;

    let timeoutId: number;
    let isPolling = false;
    let cancelled = false;
    const ac = new AbortController();

    const tick = async () => {
      if (cancelled) return;
      if (!isPolling && !document.hidden && !isInitializing) {
        isPolling = true;
        try {
          await pollMessages(ac.signal);
        } finally {
          isPolling = false;
        }
      }
      if (!cancelled && isMountedRef.current) {
        timeoutId = window.setTimeout(tick, 5000);
      }
    };

    timeoutId = window.setTimeout(tick, 5000);

    const onVisibilityChange = () => {
      if (!document.hidden && isMountedRef.current && !isInitializing) {
        if (!isPolling) {
          isPolling = true;
          pollMessages(ac.signal).finally(() => { isPolling = false; });
        }
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      ac.abort();
      window.clearTimeout(timeoutId);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [projectId, pollMessages, isInitializing]);

  const sendMessage = useCallback(async (body: string) => {
    if (!projectId) return null;
    const requestedProjectId = projectId;
    setIsSending(true);
    setError(null);
    try {
      const json = await request(`/api/projects/${requestedProjectId}/messages`, {
        method: "POST",
        body: JSON.stringify({ body })
      });
      const newMsg = json.message as ChatMessage;
      if (activeProjectIdRef.current !== requestedProjectId) return newMsg;
      setMessages(prev => {
        const has = prev.some(m => m.id === newMsg.id);
        if (has) return prev;
        return [...prev, newMsg];
      });
      latestMessageIdRef.current = newMsg.id;
      return newMsg;
    } catch (err) {
      if (
        isMountedRef.current &&
        activeProjectIdRef.current === requestedProjectId
      ) {
        setError("sendFailed");
      }
      throw err;
    } finally {
      if (
        isMountedRef.current &&
        activeProjectIdRef.current === requestedProjectId
      ) {
        setIsSending(false);
      }
    }
  }, [projectId, request]);

  const inviteMember = useCallback(async (email: string, role: ChatRole) => {
    if (!projectId) return;
    await request(`/api/projects/${projectId}/members`, {
      method: "POST",
      body: JSON.stringify({ email, role })
    });
    await fetchMembers();
  }, [projectId, request, fetchMembers]);

  const removeMember = useCallback(async (userId: string) => {
    if (!projectId) return;
    await request(`/api/projects/${projectId}/members/${userId}`, {
      method: "DELETE"
    });
    await fetchMembers();
  }, [projectId, request, fetchMembers]);

  const retry = useCallback(() => {
    setError(null);
    return loadInitial();
  }, [loadInitial]);

  return {
    messages,
    hasMore,
    members,
    currentRole,
    isInitializing,
    isSending,
    error,
    sendMessage,
    inviteMember,
    removeMember,
    retry,
  };
}
