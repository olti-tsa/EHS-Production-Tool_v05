import React, { useState } from "react";
import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog";
import { Trash2 } from "lucide-react";
import { useT } from "../lib/i18n/I18nContext";
import { toast } from "sonner";
import type { ProjectStatus } from "../lib/projectStatus";
import {
  AlertDialog,
  AlertDialogPortal,
  AlertDialogOverlay,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
  AlertDialogTrigger,
} from "./ui/alert-dialog";

interface Props {
  projectId: string;
  projectName: string;
  projectStatus: ProjectStatus;
  getToken: () => Promise<string | null>;
  onSuccess: () => void | Promise<void>;
  trigger: React.ReactNode;
}

export function DeleteProjectDialog({
  projectId,
  projectName,
  projectStatus,
  getToken,
  onSuccess,
  trigger
}: Props) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const requiresTypedConfirmation =
    projectStatus === "active" ||
    projectStatus === "completed" ||
    projectStatus === "archived";
  const nameToMatch = projectName || t("shell.breadcrumb.untitled");

  const confirmationMatches =
    !requiresTypedConfirmation || confirmText === nameToMatch;

  const handleDelete = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (loading) return;
    if (!confirmationMatches) {
      setError(t("project.delete.error.exactName"));
      return;
    }
    
    setLoading(true);
    setError("");
    let succeeded = false;
    
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20_000);
    try {
      const token = await getToken();
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "DELETE",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        signal: controller.signal,
      });
      
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        const serverMessage =
          json && typeof json.error === "string" ? json.error : "";
        throw new Error(serverMessage || t("project.delete.error.generic"));
      }
      
      succeeded = true;
      toast.success(t("project.delete.success"));
      await onSuccess();
    } catch (err: any) {
      const message =
        err instanceof DOMException && err.name === "AbortError"
          ? t("project.delete.error.generic")
          : err?.message || t("project.delete.error.generic");
      setError(message);
      toast.error(message);
    } finally {
      window.clearTimeout(timeout);
      setLoading(false);
      if (succeeded) {
        setOpen(false);
        setConfirmText("");
        setError("");
      }
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        {trigger}
      </AlertDialogTrigger>
      <AlertDialogPortal>
        <AlertDialogOverlay
          className="fixed inset-0 z-[12000] bg-black/70 backdrop-blur-sm"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 12000,
            background: "rgba(0, 0, 0, 0.7)",
            backdropFilter: "blur(4px)",
          }}
        />
        <AlertDialogPrimitive.Content
          onClick={(e) => e.stopPropagation()}
          className="fixed left-1/2 top-1/2 z-[12001] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-6 text-slate-100"
          style={{
            position: "fixed",
            left: "50%",
            top: "50%",
            transform: "translate(-50%, -50%)",
            zIndex: 12001,
            width: "calc(100vw - 32px)",
            maxWidth: 448,
            maxHeight: "calc(100vh - 32px)",
            overflowY: "auto",
            boxSizing: "border-box",
            padding: 24,
            border: "1px solid rgb(30 41 59)",
            borderRadius: 16,
            backgroundColor: "rgb(15 23 42)",
            color: "rgb(241 245 249)",
            boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.7)",
          }}
        >
          <AlertDialogHeader className="mb-6 text-left">
            <div
              className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-red-500/15 text-red-500"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 44,
                height: 44,
                marginBottom: 16,
                borderRadius: 12,
                backgroundColor: "rgba(239, 68, 68, 0.15)",
                color: "rgb(239 68 68)",
              }}
            >
              <Trash2 size={22} aria-hidden="true" />
            </div>
            <AlertDialogTitle className="mb-2 text-xl font-bold text-white">
              {t("project.delete.title")}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-sm leading-relaxed text-slate-300">
              {t("project.delete.description", { name: nameToMatch })}
            </AlertDialogDescription>
            {(projectStatus === "completed" || projectStatus === "archived") ? (
              <p className="mt-3 rounded-xl border border-amber-500/25 bg-amber-500/10 p-3 text-sm text-amber-200">
                {projectStatus === "completed"
                  ? t("project.delete.completedPolicy")
                  : t("project.delete.archivedPolicy")}
              </p>
            ) : null}
          </AlertDialogHeader>

          {requiresTypedConfirmation && (
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-200">
                {t("project.delete.confirmLabel")} <span className="font-bold text-white">{nameToMatch}</span>
              </label>
              <input
                type="text"
                className="mb-4 w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-red-500"
                style={{
                  display: "block",
                  width: "100%",
                  boxSizing: "border-box",
                  marginBottom: 16,
                  padding: "10px 14px",
                  border: "1px solid rgb(51 65 85)",
                  borderRadius: 12,
                  backgroundColor: "rgb(2 6 23)",
                  color: "white",
                }}
                value={confirmText}
                onChange={(e) => {
                  setConfirmText(e.target.value);
                  if (error) setError("");
                }}
                placeholder={nameToMatch}
              />
            </div>
          )}

          {error && (
            <div className="mb-4 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">
              {error}
            </div>
          )}
        
          <AlertDialogFooter
            className="mt-2 flex flex-row items-center justify-end gap-3 space-x-0"
            style={{
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "flex-end",
              gap: 12,
              marginTop: 8,
            }}
          >
            <AlertDialogCancel
              disabled={loading}
              className="mt-0 rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm font-medium text-slate-300 transition-all hover:bg-slate-700 hover:text-white"
              onClick={(e) => {
                e.stopPropagation();
                setConfirmText("");
                setError("");
              }}
            >
              {t("project.delete.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={loading}
              className="flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-medium text-white shadow-lg transition-all hover:bg-red-700 active:bg-red-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Trash2 size={16} aria-hidden="true" />
              {loading ? t("project.delete.deleting") : t("project.delete.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogPrimitive.Content>
      </AlertDialogPortal>
    </AlertDialog>
  );
}
