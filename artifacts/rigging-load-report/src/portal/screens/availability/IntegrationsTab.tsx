import React from "react";
import { PALETTE, type ThemeMode } from "../../lib/portalTheme";
import type { CalendarConnection, CalendarFeed } from "./types";
import { useT, type Translator } from "../../../lib/i18n/I18nContext";

function btnPill(theme: ThemeMode): React.CSSProperties {
  const c = PALETTE[theme];
  return {
    padding: "8px 16px",
    borderRadius: 999,
    border: `1px solid ${c.border}`,
    background: c.cardBgSubtle,
    color: c.text,
    fontSize: 13,
    fontWeight: "bold",
    cursor: "pointer"
  };
}

function ConnectionRow({
  provider,
  name,
  connection,
  onStart,
  onSync,
  onDelete,
  theme,
  t
}: {
  provider: string;
  name: string;
  connection?: CalendarConnection;
  onStart: () => void;
  onSync: (id: string) => void;
  onDelete: (id: string) => void;
  theme: ThemeMode;
  t: Translator;
}) {
  const c = PALETTE[theme];
  return (
    <div className="portal-availability-connection-row" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", background: c.cardBgSubtle, border: `1px solid ${c.border}`, borderRadius: 8 }}>
      <div className="portal-availability-connection-info" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <strong style={{ fontSize: 14 }}>{name}</strong>
        <div style={{ fontSize: 12, color: c.muted, display: "flex", alignItems: "center", gap: 6 }}>
          {!connection ? t("portal.availability.notConnected") : connection.connected ? (
            <>
              <span style={{ width: 8, height: 8, borderRadius: 4, background: c.success }}></span>
              {connection.accountLabel
                ? t("portal.availability.connectedAccount", { account: connection.accountLabel })
                : t("portal.availability.synced")}
            </>
          ) : (
            <>
              <span style={{ width: 8, height: 8, borderRadius: 4, background: c.danger }}></span>
              {t("portal.availability.error")}
            </>
          )}
        </div>
      </div>
      <div className="portal-availability-connection-actions" style={{ display: "flex", gap: 8 }}>
        {connection?.connected ? (
          <>
            <button onClick={() => onSync(connection.id)} style={{ padding: "6px 12px", fontSize: 13, background: "transparent", border: `1px solid ${c.border}`, color: c.text, borderRadius: 6, cursor: "pointer" }}>{t("portal.availability.sync")}</button>
            <button onClick={() => onDelete(connection.id)} style={{ padding: "6px 12px", fontSize: 13, background: "transparent", border: `1px solid ${c.danger}`, color: c.danger, borderRadius: 6, cursor: "pointer" }}>{t("portal.availability.disconnect")}</button>
          </>
        ) : (
          <button onClick={onStart} style={{ padding: "6px 12px", fontSize: 13, background: c.accent, border: "none", color: "#fff", borderRadius: 6, cursor: "pointer", fontWeight: "bold" }}>{t("portal.availability.connect")}</button>
        )}
      </div>
    </div>
  );
}

export function IntegrationsTab({
  theme,
  connections,
  feed,
  icsUrl,
  setIcsUrl,
  handleAddIcs,
  handleStartConnection,
  handleSync,
  handleDeleteConnection,
  handleCopy,
  handleRotateFeed,
  handleDownload,
  getWebcalUrl,
  copied,
}: {
  theme: ThemeMode;
  connections: CalendarConnection[];
  feed: CalendarFeed | null;
  icsUrl: string;
  setIcsUrl: (val: string) => void;
  handleAddIcs: () => void;
  handleStartConnection: (provider: string) => void;
  handleSync: (id: string) => void;
  handleDeleteConnection: (id: string) => void;
  handleCopy: () => void;
  handleRotateFeed: () => void;
  handleDownload: () => void;
  getWebcalUrl: () => string;
  copied: boolean;
}) {
  const c = PALETTE[theme];
  const t = useT();

  return (
    <div className="portal-availability-integrations" style={{ display: "grid", gap: 16 }}>
      <div style={{ background: c.cardBg, border: `1px solid ${c.border}`, borderRadius: 14, padding: 20 }}>
        <h3 style={{ margin: "0 0 16px", fontSize: 18 }}>{t("portal.availability.connectedAccounts")}</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <ConnectionRow
            provider="google"
            name={t("portal.availability.provider.google")}
            connection={connections.find(c => c.provider === "google")}
            onStart={() => handleStartConnection("google")}
            onSync={handleSync}
            onDelete={handleDeleteConnection}
            theme={theme}
            t={t}
          />
          <ConnectionRow
            provider="microsoft"
            name={t("portal.availability.provider.microsoft")}
            connection={connections.find(c => c.provider === "microsoft")}
            onStart={() => handleStartConnection("microsoft")}
            onSync={handleSync}
            onDelete={handleDeleteConnection}
            theme={theme}
            t={t}
          />
          {connections.filter(c => c.provider === "ics").map(conn => (
            <ConnectionRow
              key={conn.id}
              provider="ics"
              name={t("portal.availability.provider.ics")}
              connection={conn}
              onStart={() => {}}
              onSync={handleSync}
              onDelete={handleDeleteConnection}
              theme={theme}
              t={t}
            />
          ))}
        </div>

        <h3 style={{ margin: "32px 0 16px", fontSize: 18 }}>{t("portal.availability.privateIcs")}</h3>
        <p style={{ fontSize: 13, color: c.muted, marginBottom: 12 }}>
          {t("portal.availability.icsHint")}
        </p>
        <div className="portal-availability-url-row" style={{ display: "flex", gap: 8 }}>
          <input 
            type="url" 
            value={icsUrl} 
            onChange={e => setIcsUrl(e.target.value)} 
            placeholder="https://..." 
            style={{ flex: 1, padding: "8px 12px", borderRadius: 8, border: `1px solid ${c.border}`, background: c.inputBg, color: c.text }} 
          />
          <button 
            onClick={handleAddIcs} 
            style={{ padding: "8px 16px", background: c.accent, color: "#fff", border: "none", borderRadius: 8, fontWeight: "bold", cursor: "pointer" }}
          >
            {t("portal.availability.addUrl")}
          </button>
        </div>
      </div>

      <div style={{ background: c.cardBg, border: `1px solid ${c.border}`, borderRadius: 14, padding: 20 }}>
        <h3 style={{ margin: "0 0 16px", fontSize: 18 }}>{t("portal.availability.export")}</h3>
        <p style={{ fontSize: 13, color: c.muted, marginBottom: 16 }}>
          {t("portal.availability.exportHint")}
        </p>
        {feed?.enabled && (
          <div className="portal-availability-feed-row" style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            <input 
              readOnly 
              value={feed.url} 
              style={{ flex: 1, padding: "8px 12px", borderRadius: 8, border: `1px solid ${c.border}`, background: c.inputBg, color: c.text }} 
            />
            <button 
              onClick={handleCopy} 
              style={{ padding: "8px 16px", background: c.cardBgSubtle, color: c.text, border: `1px solid ${c.border}`, borderRadius: 8, cursor: "pointer" }}
            >
              {copied ? t("portal.availability.copied") : t("portal.availability.copy")}
            </button>
            <button 
              onClick={handleRotateFeed} 
              style={{ padding: "8px 16px", background: "transparent", color: c.danger, border: `1px solid ${c.danger}`, borderRadius: 8, cursor: "pointer" }}
            >
              {t("portal.availability.rotate")}
            </button>
          </div>
        )}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {feed?.url && (
            <>
              <a href={`https://calendar.google.com/calendar/r?cid=${encodeURIComponent(getWebcalUrl())}`} target="_blank" rel="noopener noreferrer" style={{...btnPill(theme), textDecoration: "none"}}>{t("portal.availability.addToGoogle")}</a>
              <a href={getWebcalUrl()} style={{...btnPill(theme), textDecoration: "none"}}>{t("portal.availability.addToApple")}</a>
              <a href={`https://outlook.office.com/calendar/0/addcalendar?url=${encodeURIComponent(getWebcalUrl())}&name=EHS+Portal`} target="_blank" rel="noopener noreferrer" style={{...btnPill(theme), textDecoration: "none"}}>{t("portal.availability.addToOutlook")}</a>
            </>
          )}
          <button onClick={handleDownload} style={btnPill(theme)}>{t("portal.availability.downloadIcs")}</button>
        </div>
        <p style={{ fontSize: 12, color: c.danger, marginTop: 16 }}>
          {t("portal.availability.rotateWarning")}
        </p>
      </div>
    </div>
  );
}
