import { useState } from "react";
import { useAuth } from "@clerk/react";
import { useT } from "./lib/i18n/I18nContext";

type Result = {
  ok: boolean;
  error?: string;
  results?: Array<{
    userId: string;
    email: string | null;
    previousType: unknown;
    newType: string;
    freelancerProfileDeleted: boolean;
  }>;
  deleted?: Array<{ userId: string; email: string | null }>;
};

const API_BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

export default function AdminUsersPage() {
  const { getToken } = useAuth();
  const t = useT();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState<null | "promote" | "demote" | "delete">(null);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function call(
    path: string,
    body: Record<string, unknown>,
    kind: "promote" | "demote" | "delete",
  ) {
    setError(null);
    setResult(null);
    setBusy(kind);
    try {
      const token = await getToken();
      const r = await fetch(`${API_BASE}/api${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      });
      const json = (await r.json().catch(() => ({}))) as Result;
      if (!r.ok) {
        setError(json.error || t("admin.users.httpError", { status: r.status }));
      } else {
        setResult(json);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const trimmed = email.trim().toLowerCase();
  const disabled = !trimmed || !trimmed.includes("@") || busy !== null;

  return (
    <div
      style={{
        minHeight: "100vh",
        padding: "32px 16px",
        background: "var(--page-bg, #0f0f14)",
        color: "var(--ink, #fff)",
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          maxWidth: 640,
          margin: "0 auto",
          background: "var(--card-bg, #1c1c24)",
          border: "1px solid var(--border, #2a2a34)",
          borderRadius: 12,
          padding: 24,
        }}
      >
        <h1 style={{ margin: "0 0 8px", fontSize: 22 }}>{t("admin.users.title")}</h1>
        <p style={{ margin: "0 0 20px", opacity: 0.7, fontSize: 14 }}>
          {t("admin.users.descriptionBefore")} <code>@ehs.no</code>{" "}
          {t("admin.users.descriptionAfter")}
        </p>

        <label style={{ display: "block", marginBottom: 16 }}>
          <span style={{ display: "block", fontSize: 13, marginBottom: 6 }}>
            {t("admin.users.email")}
          </span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
             placeholder={t("admin.users.emailPlaceholder")}
            style={{
              width: "100%",
              padding: "10px 12px",
              borderRadius: 8,
              border: "1px solid var(--border, #2a2a34)",
              background: "var(--input-bg, #25252f)",
              color: "var(--ink, #fff)",
              fontSize: 14,
              boxSizing: "border-box",
            }}
          />
        </label>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            disabled={disabled}
            onClick={() =>
              call(
                "/admin/set-user-type",
                { email: trimmed, userType: "employee" },
                "promote",
              )
            }
            style={btn("#f88000")}
          >
            {busy === "promote" ? t("admin.users.working") : t("admin.users.employee")}
          </button>
          <button
            disabled={disabled}
            onClick={() =>
              call(
                "/admin/set-user-type",
                { email: trimmed, userType: "freelancer" },
                "demote",
              )
            }
            style={btn("#444")}
          >
            {busy === "demote" ? t("admin.users.working") : t("admin.users.freelancer")}
          </button>
          <button
            disabled={disabled}
            onClick={() => {
              if (
                !confirm(
                  t("admin.users.deleteConfirm", { email: trimmed }),
                )
              )
                return;
              void call("/admin/delete-user", { email: trimmed }, "delete");
            }}
            style={btn("#c0392b")}
          >
            {busy === "delete" ? t("admin.users.working") : t("admin.users.delete")}
          </button>
        </div>

        {error && (
          <div
            style={{
              marginTop: 16,
              padding: 12,
              borderRadius: 8,
              background: "rgba(192,57,43,0.15)",
              border: "1px solid rgba(192,57,43,0.4)",
              color: "#ff8a80",
              fontSize: 13,
            }}
          >
            {error}
          </div>
        )}

        {result && (
          <pre
            style={{
              marginTop: 16,
              padding: 12,
              borderRadius: 8,
              background: "var(--surface, #25252f)",
              border: "1px solid var(--border, #2a2a34)",
              fontSize: 12,
              overflowX: "auto",
              whiteSpace: "pre-wrap",
            }}
          >
            {JSON.stringify(result, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}

function btn(bg: string): React.CSSProperties {
  return {
    padding: "10px 16px",
    borderRadius: 8,
    border: "none",
    background: bg,
    color: "#fff",
    fontWeight: 600,
    fontSize: 14,
    cursor: "pointer",
  };
}
