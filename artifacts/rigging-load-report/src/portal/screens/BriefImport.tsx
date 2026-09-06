import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { PALETTE, type ThemeMode } from "../lib/portalTheme";
import {
  upsertBrief,
  type PortalData,
} from "../lib/portalStorage";
import { BriefShareError, decodeBrief } from "../../lib/briefShare";
import { useT } from "../../lib/i18n/I18nContext";

/** Handles `/portal/brief/import?b=<encoded>` — decodes the payload,
 *  upserts it into the freelancer's portal data, then redirects to the
 *  brief detail screen. Re-importing the same briefId is idempotent
 *  (the existing decision and gig link are preserved). */

type Status = "loading" | "missing" | "error";

export function BriefImport({
  theme,
  setData,
}: {
  theme: ThemeMode;
  setData: React.Dispatch<React.SetStateAction<PortalData>>;
}) {
  const c = PALETTE[theme];
  const t = useT();
  const [, setLocation] = useLocation();
  const [status, setStatus] = useState<Status>("loading");
  const [errMsg, setErrMsg] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const params = new URLSearchParams(window.location.search);
        const encoded = params.get("b");
        if (!encoded) {
          if (!cancelled) setStatus("missing");
          return;
        }
        const brief = await decodeBrief(encoded);
        if (cancelled) return;
        setData((prev) => upsertBrief(prev, brief).data);
        // Replace history so the back button doesn't bounce them back to
        // the import URL (which would re-import the same brief).
        setLocation(`/portal/briefs/${brief.briefId}`, { replace: true });
      } catch (e) {
        if (!cancelled) {
          setStatus("error");
          const message =
            e instanceof BriefShareError
              ? t(`portal.import.error.${e.code}`)
              : t("portal.import.readError");
          setErrMsg(message);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      style={{
        background: c.cardBg,
        border: `1px solid ${c.border}`,
        borderRadius: 14,
        padding: 32,
        boxShadow: c.shadowSoft,
        textAlign: "center",
        maxWidth: 520,
        margin: "32px auto",
      }}
    >
      {status === "loading" ? (
        <>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>
            {t("portal.import.loadingTitle")}
          </div>
          <div style={{ fontSize: 13, color: c.muted }}>
            {t("portal.import.loadingBody")}
          </div>
        </>
      ) : status === "missing" ? (
        <>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>
            {t("portal.import.missingTitle")}
          </div>
          <div style={{ fontSize: 13, color: c.muted, marginBottom: 16 }}>
            {t("portal.import.missingBody")}
          </div>
          <Link
            href="/portal/briefs"
            style={{
              display: "inline-block",
              padding: "10px 16px",
              fontSize: 14,
              fontWeight: 700,
              background: c.accent,
              color: "#0b0b0b",
              borderRadius: 8,
              textDecoration: "none",
            }}
          >
            {t("portal.import.viewBriefs")}
          </Link>
        </>
      ) : (
        <>
          <div
            style={{
              fontSize: 18,
              fontWeight: 700,
              marginBottom: 8,
              color: c.danger,
            }}
          >
            {t("portal.import.errorTitle")}
          </div>
          <div
            style={{
              fontSize: 13,
              color: c.muted,
              marginBottom: 16,
              lineHeight: 1.5,
            }}
          >
            {errMsg || t("portal.import.errorBody")}
          </div>
          <Link
            href="/portal/briefs"
            style={{
              display: "inline-block",
              padding: "10px 16px",
              fontSize: 14,
              fontWeight: 700,
              background: c.accent,
              color: "#0b0b0b",
              borderRadius: 8,
              textDecoration: "none",
            }}
          >
            {t("portal.import.viewBriefs")}
          </Link>
        </>
      )}
    </div>
  );
}
