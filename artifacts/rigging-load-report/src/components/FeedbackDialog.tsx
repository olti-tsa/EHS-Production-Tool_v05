import React, { useState } from "react";
import { useSubmitFeedback } from "../hooks/use-feedback";
import { toast } from "sonner";
import { Bug, Lightbulb } from "lucide-react";
import { useT } from "../lib/i18n/I18nContext";

export function FeedbackDialog({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const submitFeedback = useSubmitFeedback();
  const t = useT();

  const [type, setType] = useState<"bug" | "feature_request">("bug");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !description.trim()) return;

    try {
      await submitFeedback.mutateAsync({
        type,
        title: title.trim(),
        description: description.trim(),
        pageUrl: window.location.href,
      });
      
      toast.success(t("feedback.success"));

      onClose();

      // Reset after close animation
      setTimeout(() => {
        setType("bug");
        setTitle("");
        setDescription("");
      }, 300);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t("feedback.unknownError"),
      );
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="ehs-feedback-dialog"
      role="dialog"
      aria-labelledby="feedback-panel-title"
      aria-describedby="feedback-panel-description"
      style={{
        position: "fixed",
        bottom: 24,
        left: 24,
        zIndex: 9999,
        width: "calc(100vw - 3rem)",
        minWidth: "min(340px, calc(100vw - 3rem))",
        maxWidth: 512,
        maxHeight: "calc(100vh - 3rem)",
        overflowY: "auto",
        padding: 24,
        borderRadius: 16,
        background: "var(--card-bg, #25252F)",
        border: "1px solid var(--border-color, #2a2a34)",
        boxShadow: "0 24px 64px rgba(0, 0, 0, 0.45)",
        color: "var(--text-main, #E5E5EC)",
      }}
    >
      <div
        className="ehs-feedback-header"
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 16,
          marginBottom: 16,
        }}
      >
        <div>
          <h3
            id="feedback-panel-title"
            style={{ margin: 0, fontSize: 18, fontWeight: 600 }}
          >
            {t("feedback.title")}
          </h3>
          <p
            id="feedback-panel-description"
            style={{ margin: "6px 0 0", color: "var(--text-muted, #9999A6)", fontSize: 14 }}
          >
            {t("feedback.description")}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          disabled={submitFeedback.isPending}
          aria-label={t("feedback.closeAria")}
          style={{
            flexShrink: 0,
            border: 0,
            borderRadius: 6,
            padding: "4px 8px",
            background: "transparent",
            color: "var(--text-muted, #9999A6)",
            cursor: submitFeedback.isPending ? "not-allowed" : "pointer",
            fontSize: 13,
          }}
        >
          ✕ {t("common.close")}
        </button>
      </div>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div
            className="ehs-feedback-type-grid"
            role="group"
            aria-label={t("feedback.type")}
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
              gap: 12,
              width: "100%",
              marginBottom: 4,
            }}
          >
            <button
              type="button"
              aria-pressed={type === "bug"}
              onClick={() => setType("bug")}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                cursor: "pointer",
                padding: 12,
                borderRadius: 8,
                border: `1px solid ${type === "bug" ? "#F88000" : "var(--border-color, #2a2a34)"}`,
                background: type === "bug" ? "rgba(248,128,0,0.10)" : "rgba(0,0,0,0.08)",
                color: type === "bug" ? "var(--text-main, #E5E5EC)" : "var(--text-muted, #9999A6)",
                boxShadow: type === "bug" ? "0 0 0 2px rgba(248,128,0,0.20)" : "none",
                fontSize: 14,
                fontWeight: 600,
                transition: "background 150ms ease, border-color 150ms ease, box-shadow 150ms ease, color 150ms ease",
              }}
            >
              <Bug size={16} aria-hidden />
              {t("feedback.bugReport")}
            </button>
            <button
              type="button"
              aria-pressed={type === "feature_request"}
              onClick={() => setType("feature_request")}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                cursor: "pointer",
                padding: 12,
                borderRadius: 8,
                border: `1px solid ${type === "feature_request" ? "#F88000" : "var(--border-color, #2a2a34)"}`,
                background:
                  type === "feature_request"
                    ? "rgba(248,128,0,0.10)"
                    : "rgba(0,0,0,0.08)",
                color:
                  type === "feature_request"
                    ? "var(--text-main, #E5E5EC)"
                    : "var(--text-muted, #9999A6)",
                boxShadow:
                  type === "feature_request"
                    ? "0 0 0 2px rgba(248,128,0,0.20)"
                    : "none",
                fontSize: 14,
                fontWeight: 600,
                transition: "background 150ms ease, border-color 150ms ease, box-shadow 150ms ease, color 150ms ease",
              }}
            >
              <Lightbulb size={16} aria-hidden />
              {t("feedback.featureRequest")}
            </button>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            <label style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-main, #E5E5EC)" }}>{t("feedback.form.title")}</label>
            <input
              required
              maxLength={255}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("feedback.form.titlePlaceholder")}
              style={{
                width: "100%",
                padding: "10px",
                borderRadius: "8px",
                border: "1px solid var(--border-color, rgba(255,255,255,0.08))",
                background: "var(--input-bg, #1C1C24)",
                color: "var(--text-main, #E5E5EC)",
                fontSize: "14px",
                outline: "none",
              }}
            />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            <label style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-main, #E5E5EC)" }}>{t("feedback.form.details")}</label>
            <textarea
              required
              rows={5}
              maxLength={10000}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("feedback.form.detailsPlaceholder")}
              style={{
                width: "100%",
                padding: "10px",
                borderRadius: "8px",
                border: "1px solid var(--border-color, rgba(255,255,255,0.08))",
                background: "var(--input-bg, #1C1C24)",
                color: "var(--text-main, #E5E5EC)",
                fontSize: "14px",
                resize: "vertical",
                outline: "none",
              }}
            />
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "8px" }}>
            <button
              type="button"
              onClick={onClose}
              disabled={submitFeedback.isPending}
              style={{
                padding: "8px 16px",
                borderRadius: "8px",
                border: "1px solid var(--border-color, rgba(255,255,255,0.08))",
                background: "transparent",
                color: "var(--text-main, #E5E5EC)",
                fontSize: "14px",
                cursor: submitFeedback.isPending ? "not-allowed" : "pointer",
              }}
            >
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              disabled={submitFeedback.isPending || !title.trim() || !description.trim()}
              style={{
                padding: "8px 16px",
                borderRadius: "8px",
                border: "none",
                background: "#F88000",
                color: "#0b0b0b",
                fontWeight: 600,
                fontSize: "14px",
                cursor: submitFeedback.isPending || !title.trim() || !description.trim() ? "not-allowed" : "pointer",
                opacity: submitFeedback.isPending || !title.trim() || !description.trim() ? 0.7 : 1,
              }}
            >
              {submitFeedback.isPending ? t("feedback.submitting") : t("feedback.submit")}
            </button>
          </div>
        </form>
    </div>
  );
}
