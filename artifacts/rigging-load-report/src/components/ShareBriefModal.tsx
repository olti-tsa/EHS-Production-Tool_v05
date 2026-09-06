import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@clerk/react";
import {
  buildBrief,
  type BriefAttachment,
  type BuildBriefInput,
  type ProjectBrief,
} from "../lib/projectBrief";
import { encodeBrief, buildShareUrl } from "../lib/briefShare";
import { crewHours, formatCrewDayRate } from "../lib/crew";
import { loadActiveFloorPlan, type FloorPlan } from "../lib/floorPlan";
import {
  BriefAttachmentUploadError,
  uploadBriefAttachment,
} from "../lib/briefAttachmentUpload";
import {
  renderScreenPngBlob,
  getLogoDataUrl,
  isLedExportError,
} from "../lib/ledExport";
import { computeScreenMetrics } from "../lib/led";
import { computeStage } from "../lib/stage";
import { buildStageReportHtml, type StageExportCopy } from "../lib/stageExport";
import {
  htmlToPdfBlob,
  isHtmlToPdfError,
  pdfFilename,
} from "../lib/htmlToPdf";
import ehsLogo from "../assets/ehs-logo.png";
import { useI18n, useT, type Translator } from "../lib/i18n/I18nContext";

function stageExportCopy(t: Translator): StageExportCopy {
  return {
    untitled: t("stage.untitled"), productionTool: t("export.stage.productionTool"), buildSheet: t("export.stageBuildSheet"), generated: t("export.stage.generated"),
    print: t("export.stage.print"), close: t("common.close"), venueProject: t("export.stage.venueProject"), date: t("export.stage.date"), projectManager: t("export.stage.projectManager"),
    layoutMode: t("export.stage.layoutMode"), manualPlacement: t("export.stage.manualPlacement"), autoTiled: t("export.stage.autoTiled"), buildDirection: t("export.stage.buildDirection"),
    rightToLeft: t("stage.direction.rightToLeft"), leftToRight: t("stage.direction.leftToRight"), maleSideFaces: t("export.stage.maleSideFaces"), overrides: (count) => t("export.stage.overrides", { count }),
    layout: t("export.stage.layout"), noDecksManual: t("export.stage.noDecksManual"), handrail: t("export.stage.handrail"), leg: t("export.stage.leg"),
    maleEdges: t("export.stage.maleEdges"), maleEdgesDetail: t("export.stage.maleEdgesDetail"), connectorGuidance: t("export.stage.connectorGuidance"),
    width: t("export.stage.width"), depth: t("export.stage.depth"), area: t("export.stage.area"), totalWeight: t("export.stage.totalWeight"), cannotTile: t("export.stage.cannotTile"),
    decks: t("export.stage.decks"), size: t("export.stage.size"), quantity: t("export.stage.quantity"), unit: t("export.stage.unit"), total: t("export.stage.total"), noDecks: t("export.stage.noDecks"),
    subtotal: t("export.stage.subtotal"), legs: t("export.stage.legs"), perDeck: t("export.stage.perDeck"), sharedCorners: t("stage.legs.sharedCorners"), pieces: t("stage.unit.pieces"),
    unitWeight: t("export.stage.unitWeight"), bracingRequired: t("export.stage.bracingRequired"), buildSequence: t("export.stage.buildSequence"), deck: t("export.stage.deck"),
    maleSide: t("export.stage.maleSide"), legsToInstall: t("export.stage.legsToInstall"), sequenceHelp: t("export.stage.sequenceHelp"), loadCapacity: t("export.stage.loadCapacity"),
    distributedLoad: t("export.stage.distributedLoad"), placedAreaOnly: t("export.stage.placedAreaOnly"), ratedSwl: t("export.stage.ratedSwl"), capacityHelp: t("export.stage.capacityHelp"),
    handrails: t("stage.handrails"), side: t("export.stage.side"), length: t("export.stage.length"), weight: t("export.stage.weight"), noHandrails: t("export.stage.noHandrails"),
    notes: t("stage.notes"), grandTotal: t("export.stage.grandTotal"), footer: t("export.stage.footer"), popupError: t("export.stage.popupError"),
    connectorLabel: { N: t("stage.side.upstage"), E: t("stage.side.right"), S: t("stage.side.downstage"), W: t("stage.side.left") },
    connectorShort: { N: t("stage.short.N"), E: t("stage.short.E"), S: t("stage.short.S"), W: t("stage.short.W") },
    railSide: { front: t("stage.rail.front"), back: t("stage.rail.back"), left: t("stage.rail.left"), right: t("stage.rail.right") },
    legsAdded: (count) => t(count === 1 ? "export.stage.leg" : "export.stage.legs"),
    deckCount: (count) => t(count === 1 ? "export.stage.deck" : "export.stage.decks"),
    legCount: (count) => t(count === 1 ? "export.stage.leg" : "export.stage.legs"),
  };
}

function attachmentErrorMessage(error: unknown, t: Translator): string {
  if (!(error instanceof BriefAttachmentUploadError)) {
    return t("shareBrief.error.attachment");
  }
  if (error.code === "auth_required") {
    return t("shareBrief.error.attachmentAuth");
  }
  return t(
    error.code === "request_failed"
      ? "shareBrief.error.attachmentRequest"
      : "shareBrief.error.attachmentUpload",
    { status: error.status ?? "" },
  );
}

/** "Share with Crew" modal — generates one personalised brief link per
 *  crew member (and one generic link). The producer copies a link and
 *  sends it to the freelancer via WhatsApp / email / etc. The freelancer
 *  opens the link, lands in their Portal, and sees the full project
 *  briefing with their assignment highlighted. */

export type ShareBriefModalProps = {
  onClose: () => void;
  state: BuildBriefInput;
};

type RecipientLink = {
  /** crewId, or `null` for the generic link (no recipient highlighting). */
  crewId: string | null;
  label: string;
  sublabel: string;
  url: string;
  /** Encoded payload size in bytes — surfaced so the producer can spot a
   *  brief that's too large to share via short channels. */
  payloadBytes: number;
};

export function ShareBriefModal({ onClose, state }: ShareBriefModalProps) {
  const t = useT();
  const { locale } = useI18n();
  const [links, setLinks] = useState<RecipientLink[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [previewBrief, setPreviewBrief] = useState<ProjectBrief | null>(null);
  /** Producer-facing status while we upload the floor-plan attachment.
   *  `null` once the upload finishes (or there was nothing to upload). */
  const [uploadStatus, setUploadStatus] = useState<string | null>(
    t("shareBrief.preparing"),
  );
  /** Free-text note the producer types just before sharing — gets
   *  embedded into every generated brief as `project.description`. */
  const [description, setDescription] = useState<string>("");
  /** Attachments uploaded once on open and re-used for every link. We
   *  hoist them out of the upload effect so editing the description
   *  re-builds the links without re-uploading the floor plan / LED
   *  diagrams. `null` while uploads are still in flight. */
  const [readyAttachments, setReadyAttachments] = useState<
    BriefAttachment[] | null
  >(null);
  const { getToken } = useAuth();

  // Generate the links once on open. Encoding is async (gzip is async)
  // but tiny — just enough to need a Promise.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Step 1 — if the producer has a floor plan stashed, upload it
        // once. Every brief we generate below embeds the resulting
        // attachment metadata, so all recipients pull the same object
        // out of storage rather than re-uploading per crew member.
        const attachments: BriefAttachment[] = [];
        const floorPlan: FloorPlan | null = loadActiveFloorPlan();
        if (floorPlan?.originalDataUrl) {
          setUploadStatus(t("shareBrief.uploadingFile", { name: floorPlan.fileName }));
          try {
            const att = await uploadBriefAttachment(
              {
                name: floorPlan.fileName || "drawing",
                contentType: floorPlan.contentType || "application/octet-stream",
                sizeBytes: floorPlan.sizeBytes || 0,
                dataUrl: floorPlan.originalDataUrl,
              },
              getToken,
            );
            if (cancelled) return;
            attachments.push(att);
          } catch (e) {
            // Non-fatal — we still want to ship the textual brief even
            // if the drawing upload fails (slow connection, signed-out
            // session, etc). Surface a soft warning to the producer.
            if (!cancelled) {
              setError(
                e instanceof Error
                  ? t("shareBrief.error.drawingDetail", {
                      message: attachmentErrorMessage(e, t),
                    })
                  : t("shareBrief.error.drawing"),
              );
            }
          }
        }
        if (cancelled) return;

        // Step 2 — render one PNG per LED screen (with the producer's
        // pill-size + power/signal markers baked in) and upload each
        // alongside the floor plan. We skip empty screens (no panels)
        // because the export would just be a black rectangle. Failures
        // are non-fatal: the textual brief still ships, but we surface
        // a soft warning so the producer knows a diagram dropped.
        const ledDiagrams = state.ledDiagrams;
        if (ledDiagrams) {
          const printable = ledDiagrams.screens.filter((s) => {
            if (s.panelsWide <= 0 || s.panelsTall <= 0) return false;
            const m = computeScreenMetrics(s, ledDiagrams.panels);
            return Number.isFinite(m.pixelsX) && Number.isFinite(m.pixelsY) &&
              m.pixelsX > 0 && m.pixelsY > 0;
          });
          for (let i = 0; i < printable.length; i++) {
            const screen = printable[i];
            if (cancelled) return;
            setUploadStatus(
              t("shareBrief.uploadingLed", {
                current: i + 1,
                total: printable.length,
                name: screen.name || t("shareBrief.screenFallback"),
              }),
            );
            try {
              const png = await renderScreenPngBlob({
                screen,
                panels: ledDiagrams.panels,
                settings: ledDiagrams.settings,
                logoDataUrl: null,
                filenameFallback: t("export.ledScreenFilenameFallback"),
              });
              if (cancelled) return;
              const att = await uploadBriefAttachment(
                {
                  name: png.fileName,
                  contentType: "image/png",
                  sizeBytes: png.sizeBytes,
                  blob: png.blob,
                },
                getToken,
              );
              if (cancelled) return;
              attachments.push(att);
            } catch (e) {
              if (!cancelled) {
                // Append, don't replace, so a floor-plan warning is
                // preserved if it happened first.
                const msg =
                  e instanceof Error && !isLedExportError(e)
                    ? t("shareBrief.error.ledDetail", {
                        name: screen.name || t("shareBrief.screenFallback"),
                        message: attachmentErrorMessage(e, t),
                      })
                    : t("shareBrief.error.led", {
                        name: screen.name || t("shareBrief.screenFallback"),
                      });
                setError((prev) => (prev ? `${prev}\n${msg}` : msg));
              }
            }
          }
        }

        // Step 3 — render one PDF per stage (using the same Stage Build
        // Sheet the producer can download from the Stage tab) and
        // upload each as a brief attachment. This way every freelancer
        // who opens the brief gets the full stage build sheet without
        // the producer having to download + re-attach it manually.
        // Failures are non-fatal — we keep going so the textual brief
        // and other attachments still ship.
        const stages = state.stages.filter(
          (s) => s && (s.width > 0 || s.depth > 0 || s.editMode === "manual"),
        );
        if (stages.length > 0) {
          // Logo is optional — load once and reuse across stages. If the
          // asset can't be fetched (offline, CSP, etc.) we just produce
          // logo-less PDFs.
          let stageLogo: string | null = null;
          try {
            stageLogo = await getLogoDataUrl(ehsLogo);
          } catch {
            stageLogo = null;
          }
          for (let i = 0; i < stages.length; i++) {
            const stage = stages[i];
            if (cancelled) return;
            const stageName =
              stage.name.trim() ||
              t("shareBrief.stageFallback", { number: i + 1 });
            setUploadStatus(
              t("shareBrief.uploadingStage", {
                current: i + 1,
                total: stages.length,
                name: stageName,
              }),
            );
            try {
              const calc = computeStage(stage);
              const html = buildStageReportHtml({
                stage,
                calc,
                project: {
                  venue: state.venue,
                  date: state.reportDate,
                  endDate: state.reportEndDate || undefined,
                  preparedBy: state.engineer,
                },
                logoDataUrl: stageLogo,
                locale: locale === "no" ? "nb-NO" : "en-US",
                copy: stageExportCopy(t),
              });
              const blob = await htmlToPdfBlob(html);
              if (cancelled) return;
              const fileName = pdfFilename(
                [
                  t("export.stageBuildSheet"),
                  stageName,
                  state.venue,
                  state.reportDate,
                ],
                t("export.pdfFilenameFallback"),
              );
              const att = await uploadBriefAttachment(
                {
                  name: fileName,
                  contentType: "application/pdf",
                  sizeBytes: blob.size,
                  blob,
                },
                getToken,
              );
              if (cancelled) return;
              attachments.push(att);
            } catch (e) {
              if (!cancelled) {
                const msg =
                  e instanceof Error && !isHtmlToPdfError(e)
                    ? t("shareBrief.error.stageDetail", {
                        name: stageName,
                         message: attachmentErrorMessage(e, t),
                      })
                    : t("shareBrief.error.stage", { name: stageName });
                setError((prev) => (prev ? `${prev}\n${msg}` : msg));
              }
            }
          }
        }

        if (cancelled) return;
        setUploadStatus(null);
        // Hand off to the link-building effect below. It rebuilds links
        // whenever the description changes too, so editing the note
        // doesn't re-upload anything.
        setReadyAttachments(attachments);
      } catch (e) {
        if (!cancelled) {
          setError(
            e instanceof Error
              ? e.message
              : t("shareBrief.error.generate"),
          );
          setUploadStatus(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // We intentionally regenerate only when the modal first opens; the
    // producer can re-open it after editing the project to get new links.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Build / rebuild the share links whenever the uploaded attachments
  // are ready *or* the producer edits the description. Splitting this
  // out from the upload effect means typing in the note doesn't kick
  // off another floor-plan / LED-diagram upload — only the (cheap)
  // gzip + base64url encoding re-runs.
  useEffect(() => {
    if (!readyAttachments) return;
    let cancelled = false;
    (async () => {
      try {
        const baseUrl =
          (typeof import.meta !== "undefined" &&
            (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL) ||
          "/";
        const generated: RecipientLink[] = [];
        // Generic link (no recipient highlighted) — usable when the
        // producer just wants to share the brief broadly (e.g. with a
        // venue contact who isn't on the call sheet).
        {
          const brief = buildBrief({
            ...state,
            description,
            recipientCrewId: null,
            attachments: readyAttachments,
          });
          if (!cancelled) setPreviewBrief(brief);
          const encoded = await encodeBrief(brief);
          generated.push({
            crewId: null,
            label: t("shareBrief.generic"),
            sublabel: t("shareBrief.genericHint"),
            url: buildShareUrl(encoded, baseUrl),
            payloadBytes: encoded.length,
          });
        }
        // Per-crew links.
        for (const m of state.crew) {
          const brief = buildBrief({
            ...state,
            description,
            recipientCrewId: m.id,
            attachments: readyAttachments,
          });
          const encoded = await encodeBrief(brief);
          generated.push({
            crewId: m.id,
            label: m.name || t("shareBrief.unnamed"),
            sublabel: `${t("shareBrief.recipientSummary", {
              role: m.role,
              call: m.callTime || "—",
              off: m.offTime || "—",
              rate: formatCrewDayRate(m.dayRate),
            })}${
              (m.hotelDates?.length ?? 0) > 0
                ? t("shareBrief.nights", { count: m.hotelDates!.length })
                : ""
            }`,
            url: buildShareUrl(encoded, baseUrl),
            payloadBytes: encoded.length,
          });
        }
        if (!cancelled) setLinks(generated);
      } catch (e) {
        if (!cancelled) {
          setError(
            e instanceof Error
              ? e.message
              : t("shareBrief.error.generate"),
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // `state` is captured by reference from the parent and is intended
    // to be stable for the lifetime of the modal — only the description
    // and attachments should drive a rebuild.
  }, [readyAttachments, description, t]);

  async function copyLink(key: string, url: string) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        // Fallback for older browsers / non-secure contexts.
        const ta = document.createElement("textarea");
        ta.value = url;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1800);
    } catch {
      setError(t("shareBrief.error.copy"));
    }
  }

  const projectSummary = useMemo(() => {
    if (!previewBrief) return null;
    return {
      systems: previewBrief.rigging.systemCount,
      hoists: previewBrief.rigging.hoistCount,
      fixtures: previewBrief.lighting.fixtureCount,
      circuits: previewBrief.lighting.circuitCount,
      ledScreens: previewBrief.led.screenCount,
      stages: previewBrief.stage.stageCount,
      stageArea: previewBrief.stage.totalArea,
      soundRows: previewBrief.sound.rowCount,
      crew: previewBrief.assignments.length,
    };
  }, [previewBrief]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("shareBrief.dialogAria")}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15,23,42,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        zIndex: 100,
      }}
    >
      <div
        style={{
          background: "#fff",
          color: "#0f172a",
          borderRadius: 16,
          width: "100%",
          maxWidth: 720,
          maxHeight: "calc(100dvh - 32px)",
          overflow: "auto",
          boxShadow: "0 24px 64px rgba(0,0,0,0.35)",
        }}
      >
        <header
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 12,
            padding: "18px 20px 14px",
            borderBottom: "1px solid #e2e8f0",
            position: "sticky",
            top: 0,
            background: "#fff",
            zIndex: 1,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>
               {t("shareBrief.title")}
            </h2>
            <p
              style={{
                margin: "4px 0 0",
                fontSize: 13,
                color: "#64748b",
                lineHeight: 1.45,
              }}
            >
               {t("shareBrief.intro")}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
             aria-label={t("common.close")}
            style={{
              border: "1px solid #e2e8f0",
              background: "#f8fafc",
              borderRadius: 8,
              padding: "6px 10px",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
             {t("common.close")}
          </button>
        </header>

        {projectSummary ? (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))",
              gap: 8,
              padding: "14px 20px",
              borderBottom: "1px solid #e2e8f0",
              background: "#f8fafc",
            }}
          >
            <SummaryStat label={t("shareBrief.stat.crew")} value={`${projectSummary.crew}`} />
            <SummaryStat label={t("shareBrief.stat.rigSystems")} value={`${projectSummary.systems}`} />
            <SummaryStat label={t("shareBrief.stat.hoists")} value={`${projectSummary.hoists}`} />
            <SummaryStat label={t("shareBrief.stat.fixtures")} value={`${projectSummary.fixtures}`} />
            <SummaryStat label={t("shareBrief.stat.circuits")} value={`${projectSummary.circuits}`} />
            <SummaryStat label={t("shareBrief.stat.ledScreens")} value={`${projectSummary.ledScreens}`} />
            <SummaryStat
               label={t("shareBrief.stat.stage")}
              value={`${projectSummary.stages}`}
              sub={projectSummary.stageArea > 0 ? `${projectSummary.stageArea} m²` : undefined}
            />
            <SummaryStat label={t("shareBrief.stat.soundRows")} value={`${projectSummary.soundRows}`} />
          </div>
        ) : null}

        {/* Producer-written note. Sits above the link list so the
            producer reads "type your note → grab a link" top-to-bottom.
            Editing this re-runs only the encoding pass — the floor
            plan / LED diagrams already uploaded above are reused. */}
        <div
          style={{
            padding: "14px 20px",
            borderBottom: "1px solid #e2e8f0",
            background: "#fff",
          }}
        >
          <label
            htmlFor="share-brief-description"
            style={{
              display: "block",
              fontSize: 12,
              fontWeight: 700,
              color: "#0f172a",
              marginBottom: 6,
            }}
          >
             {t("shareBrief.note")}{" "}
            <span style={{ color: "#94a3b8", fontWeight: 500 }}>
               {t("shareBrief.optional")}
            </span>
          </label>
          <textarea
            id="share-brief-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
             placeholder={t("shareBrief.notePlaceholder")}
            rows={3}
            style={{
              width: "100%",
              padding: "8px 10px",
              fontSize: 13,
              lineHeight: 1.45,
              fontFamily: "inherit",
              border: "1px solid #cbd5e1",
              borderRadius: 8,
              background: "#fff",
              color: "#0f172a",
              boxSizing: "border-box",
              resize: "vertical",
              minHeight: 64,
            }}
          />
          <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>
             {t("shareBrief.noteHint")}
          </div>
        </div>

        <div style={{ padding: "16px 20px 20px" }}>
          {error ? (
            <div
              role="alert"
              style={{
                padding: "10px 12px",
                background: "rgba(220,38,38,0.08)",
                border: "1px solid rgba(220,38,38,0.25)",
                borderRadius: 10,
                color: "#991b1b",
                fontSize: 13,
                marginBottom: 12,
              }}
            >
              {error}
            </div>
          ) : null}

          {!links ? (
            <div style={{ padding: 24, textAlign: "center", color: "#64748b" }}>
               {uploadStatus ?? t("shareBrief.generating")}
            </div>
          ) : links.length === 1 ? (
            // No crew yet — only the generic link is available.
            <>
              <div
                style={{
                  padding: "10px 12px",
                  background: "rgba(99,102,241,0.08)",
                  border: "1px solid rgba(99,102,241,0.25)",
                  borderRadius: 10,
                  color: "#3730a3",
                  fontSize: 13,
                  marginBottom: 12,
                }}
              >
                 {t("shareBrief.noCrew")}
              </div>
               {renderLinkRow(links[0], "generic", copiedKey, copyLink, t)}
            </>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {links.map((l, i) =>
                 renderLinkRow(l, l.crewId ?? `generic-${i}`, copiedKey, copyLink, t),
              )}
            </div>
          )}

          {previewBrief && previewBrief.attachments.length > 0 ? (
            <div
              style={{
                marginTop: 14,
                padding: "10px 12px",
                background: "rgba(248,128,0,0.08)",
                border: "1px solid rgba(248,128,0,0.25)",
                borderRadius: 10,
                fontSize: 12,
                color: "#7c2d12",
                lineHeight: 1.5,
              }}
            >
               <strong>{t("shareBrief.attachments")}</strong>{" "}
              {previewBrief.attachments
                .map((a) => a.name)
                .join(", ")}
               . {t("shareBrief.attachmentsHint")}
            </div>
          ) : null}

          <p
            style={{
              marginTop: 16,
              fontSize: 12,
              color: "#64748b",
              lineHeight: 1.5,
            }}
          >
             {t("shareBrief.linksHint")}
          </p>
        </div>
      </div>
    </div>
  );
}

function renderLinkRow(
  l: RecipientLink,
  key: string,
  copiedKey: string | null,
  copy: (key: string, url: string) => void,
  t: Translator,
) {
  const isCopied = copiedKey === key;
  const tooLarge = l.payloadBytes > 12000;
  return (
    <div
      key={key}
      style={{
        border: "1px solid #e2e8f0",
        borderRadius: 12,
        padding: 12,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        background: "#fff",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: 14,
              fontWeight: 700,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {l.label}
          </div>
          <div
            style={{
              fontSize: 12,
              color: "#64748b",
              marginTop: 2,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {l.sublabel}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          <a
            href={l.url}
            target="_blank"
            rel="noreferrer"
            style={{
              fontSize: 12,
              fontWeight: 600,
              padding: "6px 10px",
              border: "1px solid #cbd5e1",
              borderRadius: 8,
              color: "#0f172a",
              textDecoration: "none",
              background: "#f8fafc",
            }}
          >
             {t("shareBrief.preview")}
          </a>
          <button
            type="button"
            onClick={() => copy(key, l.url)}
            style={{
              fontSize: 12,
              fontWeight: 700,
              padding: "6px 12px",
              border: "1px solid #f88000",
              borderRadius: 8,
              cursor: "pointer",
              background: isCopied ? "#fff7ed" : "#f88000",
              color: isCopied ? "#9a3412" : "#0b0b0b",
            }}
          >
             {isCopied ? t("shareBrief.copied") : t("shareBrief.copy")}
          </button>
        </div>
      </div>
      <input
        readOnly
        value={l.url}
        onFocus={(e) => e.currentTarget.select()}
        style={{
          width: "100%",
          padding: "8px 10px",
          fontSize: 12,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          border: "1px solid #e2e8f0",
          borderRadius: 8,
          background: "#f8fafc",
          color: "#334155",
          boxSizing: "border-box",
        }}
      />
      {tooLarge ? (
        <div style={{ fontSize: 11, color: "#9a3412" }}>
           {t("shareBrief.largeLink", {
             size: (l.payloadBytes / 1024).toFixed(1),
           })}
        </div>
      ) : null}
    </div>
  );
}

function SummaryStat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div>
      <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600 }}>
        {label}
      </div>
      <div
        style={{
          fontSize: 17,
          fontWeight: 800,
          color: "#0f172a",
          lineHeight: 1.1,
        }}
      >
        {value}
      </div>
      {sub ? (
        <div style={{ fontSize: 10, color: "#94a3b8" }}>{sub}</div>
      ) : null}
    </div>
  );
}

/** Re-exported for the App.tsx call site that needs to compute the
 *  per-row hours when building the BuildBriefInput. */
export { crewHours };
