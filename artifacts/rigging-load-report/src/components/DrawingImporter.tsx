import { useEffect, useRef, useState } from "react";
import {
  analyzeDrawing,
  emptyExtractedItems,
  loadVenueMemory,
  saveVenueMemory,
  selectAll,
  selectNone,
  totalAdded,
  totalItemCount,
  totalSkipped,
  type AnalyzerMode,
  type ApplySelection,
  type ApplySummary,
  type ExtractedItems,
  type LoadedVenueMemory,
} from "../lib/drawingAnalysis";
import { fileToFloorPlan, type FloorPlan } from "../lib/floorPlan";
import { OverlayEditor } from "./analyzer/OverlayEditor";
import { useI18n, useT } from "../lib/i18n/I18nContext";

type Props = {
  /** Current venue dimensions, sent as context to the analyser so it
   *  can reconcile sizes on the drawing with what the user already set. */
  currentVenue: { widthM: number; depthM: number; ceilingM: number };
  projectName?: string;
  /** Apply the user's chosen subset back to the report. Returns an
   *  `ApplySummary` so the importer can show the user how many items
   *  were added vs. skipped because they already existed (cross-PDF
   *  dedup — e.g. truss "LX1" appearing on every drawing in a project
   *  collapses to a single rigging system on the report). */
  onApply: (
    extracted: ExtractedItems,
    selection: ApplySelection,
  ) => ApplySummary;
  /** Promote the currently-loaded drawing to the Rigg Plan backdrop.
   *  Optional — host views that don't show a plan can omit this. */
  onUseAsFloorPlan?: (plan: FloorPlan) => void;
  /** True when a backdrop is already set, so the button can swap labels
   *  to "Replace floor plan". */
  hasFloorPlan?: boolean;
};

const ACCEPT =
  "image/png,image/jpeg,image/jpg,image/webp,image/gif,application/pdf,.pdf";

function isPdfFile(f: File): boolean {
  return f.type === "application/pdf" || /\.pdf$/i.test(f.name);
}

function isAcceptedFile(f: File): boolean {
  return f.type.startsWith("image/") || isPdfFile(f);
}

const fmt = (n: number | null, locale: string, d = 1): string =>
  n == null ? "—" : n.toLocaleString(locale, { maximumFractionDigits: d });

/** Toggle one index in/out of an Immutable-ish Set without mutating the
 *  caller's reference (so React picks up the change). */
function toggleIndex(set: Set<number>, idx: number): Set<number> {
  const next = new Set(set);
  if (next.has(idx)) next.delete(idx);
  else next.add(idx);
  return next;
}

export function DrawingImporter({
  currentVenue,
  projectName,
  onApply,
  onUseAsFloorPlan,
  hasFloorPlan,
}: Props) {
  const t = useT();
  const { locale } = useI18n();
  const numberLocale = locale === "no" ? "nb-NO" : "en-US";
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [extracted, setExtracted] = useState<ExtractedItems | null>(null);
  // Analyzer mode toggle. Persisted in localStorage so the producer's
  // preferred mode survives reloads. Existing users keep whatever
  // they last picked (classic / geometry / production); fresh
  // installs default to "production" because that's the mode that
  // honours Position-Count tables (the LED TRUSS / Position L&R /
  // Position C zones) as the primary grouping filter — which is the
  // workflow the rest of this importer is tuned for. Stored
  // alongside the mode that produced the *current* detections so we
  // can show a small badge on the results header.
  const [analyzerMode, setAnalyzerMode] = useState<AnalyzerMode>(() => {
    if (typeof window === "undefined") return "production";
    const saved = window.localStorage.getItem("rigplan.analyzerMode");
    if (saved === "geometry") return "geometry";
    if (saved === "production") return "production";
    if (saved === "classic") return "classic";
    return "production";
  });
  const [extractedMode, setExtractedMode] = useState<AnalyzerMode | null>(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("rigplan.analyzerMode", analyzerMode);
  }, [analyzerMode]);
  const [selection, setSelection] = useState<ApplySelection>(selectNone());
  const [applied, setApplied] = useState(false);
  const [appliedSummary, setAppliedSummary] = useState<ApplySummary | null>(
    null,
  );
  const [isDragOver, setIsDragOver] = useState(false);
  const [isPreparingFloorPlan, setIsPreparingFloorPlan] = useState(false);
  const [floorPlanApplied, setFloorPlanApplied] = useState(false);
  // Overlay editor state. `editorImageUrl` is set on open by reading
  // the file (image → object URL, PDF → rasterised page 1). Holding
  // both flags lets us show a brief loading state while a PDF is
  // being rasterised on the worker thread.
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorImageUrl, setEditorImageUrl] = useState<string | null>(null);
  const [isPreparingEditor, setIsPreparingEditor] = useState(false);
  // Set true once we successfully PUT the venue memory — either from
  // the overlay editor's "Save corrections" button (so even users
  // who never click "Apply to reports" still feed corrections back
  // into the learning loop) or from the Apply step itself. Drives a
  // small confirmation line at the top of the results panel so the
  // user can see the learning loop fired.
  const [memorySaved, setMemorySaved] = useState(false);
  // Holds the saved memory blob (if any) for the current
  // `projectName`, fetched once when the project is set and again
  // whenever the project changes. Drives a small "memory available"
  // hint above the Analyze button so users can see that the next
  // analysis will be informed by past corrections — without having
  // to actually run an analysis to find out. The server is the
  // source of truth: even if this fetch fails or returns null, the
  // analyser will still pull memory itself when the request comes
  // through. This is purely a UI signal.
  const [memoryAvailable, setMemoryAvailable] =
    useState<LoadedVenueMemory | null>(null);
  // Monotonic counter we bump on reset / re-analyze / file change so a
  // late-resolving venue-memory save from a previous attempt never
  // flips the "Saved as venue memory…" banner on after the user has
  // already moved on to a new file or cleared the form.
  const memorySaveTokenRef = useRef(0);
  // Render-synced mirror of the `projectName` prop. We need this
  // because `persistMemoryInBackground` runs an async PUT and the
  // ordinary closure-captured value of `projectName` would be
  // stale by the time .then/.catch resolve if the parent has
  // changed the prop in the meantime. A ref updated during render
  // is the React-idiomatic way to read the latest prop from an
  // async callback — it's synchronous with commit (unlike
  // useEffect, which fires after commit and is not guaranteed to
  // run before pending microtasks resolve).
  const projectNameRef = useRef(projectName);
  projectNameRef.current = projectName;
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Revoke the object URL when we swap files / unmount, otherwise the
  // browser leaks an in-memory blob.
  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // Probe venue memory whenever the project name (which we use as the
  // venue key) changes. Cleanup flag keeps a slow response from
  // landing after the project has changed again, which would lie
  // about which venue the indicator is for. We don't hit the server
  // when there's no project name — there's nothing to look up. The
  // venue-switch race against in-flight memory PUTs is handled in
  // `persistMemoryInBackground` via the render-synced
  // `projectNameRef`, so this effect only handles the GET side and
  // clears the local "Saved" indicator for visual freshness.
  useEffect(() => {
    setMemorySaved(false);
    const trimmed = projectName?.trim();
    if (!trimmed) {
      setMemoryAvailable(null);
      return;
    }
    let cancelled = false;
    void loadVenueMemory(trimmed)
      .then((m) => {
        if (!cancelled) setMemoryAvailable(m);
      })
      .catch(() => {
        if (!cancelled) setMemoryAvailable(null);
      });
    return () => {
      cancelled = true;
    };
  }, [projectName]);

  function pickFile(f: File) {
    if (!isAcceptedFile(f)) {
      setError(t("drawing.error.unsupportedFile"));
      return;
    }
    // Size guard mirrors the server-side caps so the user gets immediate
    // feedback instead of waiting for the upload to fail.
    const isPdf = isPdfFile(f);
    const cap = isPdf ? 8_000_000 : 4_500_000;
    if (f.size > cap) {
      setError(
        isPdf
          ? t("drawing.error.pdfTooLarge")
          : t("drawing.error.imageTooLarge"),
      );
      return;
    }
    setError(null);
    setExtracted(null);
    setExtractedMode(null);
    setSelection(selectNone());
    setApplied(false);
    setAppliedSummary(null);
    setFloorPlanApplied(false);
    setEditorOpen(false);
    setEditorImageUrl(null);
    setMemorySaved(false);
    memorySaveTokenRef.current += 1;
    setFile(f);
  }

  async function useAsFloorPlan() {
    if (!file || !onUseAsFloorPlan) return;
    setError(null);
    setIsPreparingFloorPlan(true);
    try {
      const plan = await fileToFloorPlan(file);
      onUseAsFloorPlan(plan);
      setFloorPlanApplied(true);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t("drawing.error.floorPlan"),
      );
    } finally {
      setIsPreparingFloorPlan(false);
    }
  }

  async function runAnalyze() {
    if (!file) return;
    setIsAnalyzing(true);
    setError(null);
    setExtracted(null);
    setExtractedMode(null);
    setApplied(false);
    setAppliedSummary(null);
    setMemorySaved(false);
    memorySaveTokenRef.current += 1;
    // Snapshot the mode at the moment we kick off the request so a
    // user toggling Classic ↔ Geometry mid-flight can't make the
    // results header lie about which prompt actually produced them.
    const requestMode = analyzerMode;
    try {
      const result = await analyzeDrawing(
        file,
        {
          venue: currentVenue,
          projectName,
          // The venue memory loop is keyed off this name. We use the
          // project / venue label the host already passed for context;
          // when it's empty the server simply skips the memory lookup.
          venueName: projectName,
        },
        undefined,
        requestMode,
      );
      setExtracted(result);
      setExtractedMode(requestMode);
      setSelection(selectAll(result));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("drawing.error.analysis"));
    } finally {
      setIsAnalyzing(false);
    }
  }

  /** Prepare the renderable image URL for the overlay editor.
   *  - Plain images: use the existing object URL we already created
   *    for the inline preview (no re-decode).
   *  - PDFs: rasterise page 1 via `fileToFloorPlan` (same path used
   *    for the Rigg Plan backdrop) so the editor has a flat raster
   *    to overlay boxes on. */
  async function openEditor() {
    if (!file || !extracted) return;
    setError(null);
    if (!isPdfFile(file)) {
      setEditorImageUrl(previewUrl);
      setEditorOpen(true);
      return;
    }
    setIsPreparingEditor(true);
    try {
      const plan = await fileToFloorPlan(file);
      setEditorImageUrl(plan.imageDataUrl);
      setEditorOpen(true);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t("drawing.error.editor"),
      );
    } finally {
      setIsPreparingEditor(false);
    }
  }

  function closeEditor() {
    setEditorOpen(false);
  }

  /** Commit the editor's corrected items back to our state and
   *  refresh the per-category selection so newly-added items are
   *  selected by default and removed items don't leave dangling
   *  indexes in the selection set. Also persists the corrections to
   *  venue memory immediately — the user just made deliberate edits
   *  (deletes, label changes), and we want that learning even if
   *  they never click "Apply to reports". Best-effort and
   *  token-guarded so a slow save resolving after the user has
   *  re-analysed or chosen another file can't flip a stale "saved"
   *  indicator on. */
  function saveEditorChanges(corrected: ExtractedItems) {
    setExtracted(corrected);
    setSelection(selectAll(corrected));
    setEditorOpen(false);
    // The user just made deliberate corrections; clear any stale
    // "Applied" banner so they're prompted to apply the new version.
    setApplied(false);
    setAppliedSummary(null);
    setMemorySaved(false);
    persistMemoryInBackground(corrected);
  }

  /** Best-effort PUT of `corrected` to venue memory. Used by both the
   *  overlay editor's Save-corrections button and by Apply-to-reports.
   *
   *  Two layered guards keep stale completions from lying to the UI:
   *
   *  - Token guard (`memorySaveTokenRef`) is bumped on file change /
   *    re-analyze / reset, so any save that started before one of
   *    those can't flip "Saved" on for a fresh extraction.
   *
   *  - Venue identity guard reads `projectNameRef.current` (the
   *    render-synced mirror of the prop, NOT the closure-captured
   *    value) so a venue switch that happened after the PUT was
   *    fired correctly invalidates the completion. The ref pattern
   *    is necessary because a passive useEffect on `[projectName]`
   *    is post-commit-async and not guaranteed to run before pending
   *    promise microtasks. */
  function persistMemoryInBackground(corrected: ExtractedItems) {
    const venueAtSave = projectName?.trim();
    if (!venueAtSave) return;
    const token = memorySaveTokenRef.current;
    void saveVenueMemory(venueAtSave, corrected)
      .then((ok) => {
        if (memorySaveTokenRef.current !== token) return;
        if (projectNameRef.current?.trim() !== venueAtSave) return;
        setMemorySaved(ok);
        // Optimistically refresh the "memory available" indicator
        // so the user can see right away that future analyses will
        // benefit. We synthesise a minimal record matching the GET
        // shape — the next mount-time fetch will replace it with
        // the canonical server copy. Safe to use `venueAtSave`
        // (rather than re-reading the ref) because the venue-match
        // check above already proves they're equal.
        if (ok) {
          setMemoryAvailable({
            venueName: venueAtSave,
            data: { lastCorrected: corrected, savedAt: new Date().toISOString() },
            updatedAt: new Date().toISOString(),
          });
        }
      })
      .catch(() => {
        if (memorySaveTokenRef.current !== token) return;
        if (projectNameRef.current?.trim() !== venueAtSave) return;
        setMemorySaved(false);
      });
  }

  function applyAll() {
    if (!extracted) return;
    const result = onApply(extracted, selection);
    setApplied(true);
    setAppliedSummary(result);
    // Best-effort: save the applied items as venue memory so the next
    // analysis of the same venue gets a hint. The shared helper
    // handles both the token guard (stale completions after reset /
    // re-analyze / file change) and the venue-identity guard
    // (project name changing mid-flight).
    persistMemoryInBackground(extracted);
  }

  function reset() {
    setFile(null);
    setExtracted(null);
    setExtractedMode(null);
    setSelection(selectNone());
    setError(null);
    setApplied(false);
    setAppliedSummary(null);
    setFloorPlanApplied(false);
    setEditorOpen(false);
    setEditorImageUrl(null);
    setMemorySaved(false);
    memorySaveTokenRef.current += 1;
    if (inputRef.current) inputRef.current.value = "";
  }

  const itemTotal = extracted ? totalItemCount(extracted) : 0;
  const items = extracted ?? emptyExtractedItems();
  const venueChanged =
    extracted &&
    (items.venue.widthM != null ||
      items.venue.depthM != null ||
      items.venue.ceilingM != null);

  return (
    <section className="led-card drawing-import">
      <div className="led-card-head">
        <h3>{t("drawing.title")}</h3>
        <span className="led-hint">
          {t("drawing.subtitle")}
        </span>
      </div>

      {!file && (
        <label
          className={`drawing-dropzone${isDragOver ? " is-drag" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragOver(true);
          }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragOver(false);
            const f = e.dataTransfer.files?.[0];
            if (f) pickFile(f);
          }}
        >
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) pickFile(f);
            }}
            style={{ display: "none" }}
          />
          <div className="drawing-dropzone-inner">
            <strong>{t("drawing.drop.title")}</strong>
            <span>
              {t("drawing.drop.guidance")}
            </span>
          </div>
        </label>
      )}

      {file && (
        <div className="drawing-preview-row">
          <div className="drawing-preview">
            {!previewUrl ? (
              <div className="drawing-preview-empty">{t("drawing.preview.loading")}</div>
            ) : isPdfFile(file) ? (
              <div className="drawing-preview-pdf" aria-label={t("drawing.preview.pdfAria")}>
                <span className="drawing-preview-pdf-badge">PDF</span>
                <span className="drawing-preview-pdf-name">{file.name}</span>
              </div>
            ) : (
              <img src={previewUrl} alt={file.name} />
            )}
          </div>
          <div className="drawing-preview-meta">
            <strong>{file.name}</strong>
            <span className="led-sub">
              {(file.size / 1024 / 1024).toFixed(2)} MB ·{" "}
              {isPdfFile(file) ? t("drawing.preview.pdfDocument") : file.type || t("drawing.preview.image")}
            </span>
            {memoryAvailable && projectName && projectName.trim() && (
              <div
                className="drawing-memory-hint"
                title={
                  memoryAvailable.updatedAt
                    ? t("drawing.memory.updated", { date: new Date(memoryAvailable.updatedAt).toLocaleString(numberLocale) })
                    : undefined
                }
              >
                <span className="drawing-memory-hint-dot" aria-hidden="true" />
                {t("drawing.memory.found")}{" "}
                <strong>{memoryAvailable.venueName || projectName}</strong>.
                {t("drawing.memory.hint")}
              </div>
            )}
            <fieldset
              className="drawing-mode-toggle"
              disabled={isAnalyzing}
              title={t("drawing.mode.tooltip")}
            >
              <legend>{t("drawing.mode.legend")}</legend>
              {/* Wrapping the radio labels in a dedicated row keeps the
                  fieldset's <legend> on its own line above them. Without
                  this wrapper, browsers position <legend> as part of the
                  fieldset's flex flow which can overlap the first radio
                  option when the options need to wrap. */}
              <div className="drawing-mode-options">
                {(
                  [
                    { value: "classic", labelKey: "drawing.mode.classic" },
                    { value: "geometry", labelKey: "drawing.mode.geometry" },
                    { value: "production", labelKey: "drawing.mode.production" },
                  ] as const
                ).map((opt) => (
                  <label
                    key={opt.value}
                    className={
                      "drawing-mode-option" +
                      (analyzerMode === opt.value ? " is-active" : "")
                    }
                  >
                    <input
                      type="radio"
                      name="drawing-analyzer-mode"
                      value={opt.value}
                      checked={analyzerMode === opt.value}
                      onChange={() => setAnalyzerMode(opt.value)}
                    />
                    <span>{t(opt.labelKey)}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="drawing-preview-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={runAnalyze}
                disabled={isAnalyzing}
              >
                {isAnalyzing ? t("drawing.action.analyzing") : extracted ? t("drawing.action.reanalyze") : t("drawing.action.analyze")}
              </button>
              {onUseAsFloorPlan && (
                <button
                  type="button"
                  className="btn btn-soft"
                  onClick={useAsFloorPlan}
                  disabled={isPreparingFloorPlan || isAnalyzing}
                  title={
                    hasFloorPlan
                      ? t("drawing.floorPlan.replaceTitle")
                      : t("drawing.floorPlan.useTitle")
                  }
                >
                  {isPreparingFloorPlan
                    ? t("drawing.action.preparing")
                    : floorPlanApplied
                      ? t("drawing.floorPlan.set")
                      : hasFloorPlan
                        ? t("drawing.floorPlan.replace")
                        : t("drawing.floorPlan.use")}
                </button>
              )}
              <button
                type="button"
                className="btn btn-soft"
                onClick={reset}
                disabled={isAnalyzing || isPreparingFloorPlan}
              >
                {t("drawing.action.chooseAnother")}
              </button>
            </div>
          </div>
        </div>
      )}

      {error && <div className="drawing-error">{error}</div>}

      {extracted && (
        <div className="drawing-results">
          <header className="drawing-results-head">
            <div>
              <h4>
                {t(
                  itemTotal === 1
                    ? "drawing.results.foundOne"
                    : "drawing.results.foundMany",
                  { count: itemTotal },
                )}
                {extractedMode === "geometry" && (
                  <span
                    className="drawing-mode-badge"
                     title={t("drawing.mode.geometryResultTooltip")}
                  >
                     {t("drawing.mode.geometry")}
                  </span>
                )}
                {extractedMode === "production" && (
                  <span
                    className="drawing-mode-badge drawing-mode-badge-production"
                     title={t("drawing.mode.productionResultTooltip")}
                  >
                     {t("drawing.mode.production")}
                  </span>
                )}
              </h4>
              {extracted.summary && (
                <p className="led-sub">{extracted.summary}</p>
              )}
              {memorySaved && projectName && projectName.trim() && (
                <p
                  className="led-sub drawing-memory-saved"
                   title={t("drawing.memory.savedTitle")}
                >
                   {t("drawing.memory.saved")}{" "}
                  <strong>{projectName}</strong>.
                </p>
              )}
            </div>
            <div className="drawing-results-actions">
              <button
                type="button"
                className="btn btn-soft btn-sm"
                onClick={openEditor}
                disabled={isPreparingEditor}
                 title={t("drawing.action.editTitle")}
              >
                 {isPreparingEditor ? t("drawing.action.preparing") : t("drawing.action.edit")}
              </button>
              <button
                type="button"
                className="btn btn-soft btn-sm"
                onClick={() => setSelection(selectAll(extracted))}
              >
                 {t("drawing.action.selectAll")}
              </button>
              <button
                type="button"
                className="btn btn-soft btn-sm"
                onClick={() => setSelection(selectNone())}
              >
                 {t("drawing.action.selectNone")}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={applyAll}
                disabled={
                  !selection.applyVenue &&
                  selection.stageIndexes.size === 0 &&
                  selection.trussIndexes.size === 0 &&
                  selection.lightingIndexes.size === 0 &&
                  selection.ledIndexes.size === 0 &&
                  selection.soundIndexes.size === 0
                }
              >
                 {applied ? t("drawing.action.applyAgain") : t("drawing.action.apply")}
              </button>
            </div>
          </header>

          {applied && appliedSummary && (
            <div className="drawing-applied-banner">
              <div>
                {(() => {
                  const added = totalAdded(appliedSummary);
                  const skipped = totalSkipped(appliedSummary);
                  const parts: string[] = [];
                  if (appliedSummary.venueApplied) {
                    parts.push(t("drawing.applied.venue"));
                  }
                  if (added > 0) {
                    parts.push(
                      t(
                        added === 1
                          ? "drawing.applied.addedOne"
                          : "drawing.applied.addedMany",
                        { count: added },
                      ),
                    );
                  }
                  if (skipped > 0) {
                    parts.push(
                      t(
                        skipped === 1
                          ? "drawing.applied.skippedOne"
                          : "drawing.applied.skippedMany",
                        { count: skipped },
                      ),
                    );
                  }
                  if (parts.length === 0) {
                    parts.push(t("drawing.applied.none"));
                  }
                  return parts.join(" ");
                })()}
              </div>
              {totalSkipped(appliedSummary) > 0 && (
                <div className="led-sub" style={{ marginTop: 4 }}>
                  {t("drawing.applied.duplicates")}{" "}
                  {(
                    [
                      ["drawing.duplicate.systems", appliedSummary.systems.skipped],
                      ["drawing.duplicate.fixtures", appliedSummary.fixtures.skipped],
                      ["drawing.duplicate.ledScreens", appliedSummary.ledScreens.skipped],
                      ["drawing.duplicate.stages", appliedSummary.stages.skipped],
                      ["drawing.duplicate.sound", appliedSummary.sound.skipped],
                    ] as const
                  )
                    .filter(([, n]) => n > 0)
                    .map(([label, n]) => t(label, { count: n }))
                    .join(" · ")}
                </div>
              )}
              <div className="led-sub" style={{ marginTop: 4 }}>
                {t("drawing.applied.review")}
              </div>
            </div>
          )}

          {/* Venue */}
          {venueChanged && (
            <div className="drawing-group">
              <label className="drawing-group-head">
                <input
                  type="checkbox"
                  aria-label={t("drawing.action.applyVenue")}
                  checked={selection.applyVenue}
                  onChange={(e) =>
                    setSelection((s) => ({ ...s, applyVenue: e.target.checked }))
                  }
                />
                <strong>{t("drawing.venue.title")}</strong>
                <span className="led-sub">{t("drawing.destination.smashIt")}</span>
              </label>
              <div className="drawing-group-body">
                {t("drawing.venue.dimensions", {
                  width: fmt(items.venue.widthM, numberLocale),
                  depth: fmt(items.venue.depthM, numberLocale),
                  ceiling: fmt(items.venue.ceilingM, numberLocale),
                })}
              </div>
            </div>
          )}

          {/* Trusses → Rigging Report */}
          {items.trusses.length > 0 && (
            <CategoryGroup
              title={t("drawing.category.trusses")}
              destination={t("drawing.destination.rigging")}
              selectAllLabel={t("drawing.action.selectAll")}
              selectItemLabel={(index) => t("drawing.action.selectItem", { index })}
              count={items.trusses.length}
              selected={selection.trussIndexes}
              onToggle={(i) =>
                setSelection((s) => ({
                  ...s,
                  trussIndexes: toggleIndex(s.trussIndexes, i),
                }))
              }
              onSelectAll={() =>
                setSelection((s) => ({
                  ...s,
                  trussIndexes: new Set(items.trusses.map((_, i) => i)),
                }))
              }
            >
              {items.trusses.map((truss, i) => (
                <div key={i}>
                  <strong>{truss.name}</strong>
                  <span className="led-sub">
                    {fmt(truss.lengthM, numberLocale)} m · {t("drawing.item.points", { count: truss.pointCount })}
                    {truss.hoistKg != null
                      ? ` · ${t("drawing.item.motors", { value: truss.hoistKg >= 1000 ? "1 t" : `${truss.hoistKg} kg` })}`
                      : ""}
                    {truss.trimM != null ? ` · ${t("drawing.item.trim", { value: fmt(truss.trimM, numberLocale) })}` : ""}
                    {truss.notes ? ` · ${truss.notes}` : ""}
                  </span>
                </div>
              ))}
            </CategoryGroup>
          )}

          {/* Lighting */}
          {items.lighting.length > 0 && (
            <CategoryGroup
              title={t("drawing.category.lighting")}
              destination={t("drawing.destination.lighting")}
              selectAllLabel={t("drawing.action.selectAll")}
              selectItemLabel={(index) => t("drawing.action.selectItem", { index })}
              count={items.lighting.length}
              selected={selection.lightingIndexes}
              onToggle={(i) =>
                setSelection((s) => ({
                  ...s,
                  lightingIndexes: toggleIndex(s.lightingIndexes, i),
                }))
              }
              onSelectAll={() =>
                setSelection((s) => ({
                  ...s,
                  lightingIndexes: new Set(items.lighting.map((_, i) => i)),
                }))
              }
            >
              {items.lighting.map((f, i) => (
                <div key={i}>
                  <strong>
                    {f.qty}× {f.name}
                  </strong>
                  <span className="led-sub">
                    {f.trussName ? `${t("drawing.item.on", { name: f.trussName })} · ` : ""}
                    {f.weightKg != null ? t("drawing.item.weightEach", { value: fmt(f.weightKg, numberLocale) }) : t("drawing.item.weightUnknown")}
                    {f.watts != null ? ` · ${t("drawing.item.wattsEach", { value: fmt(f.watts, numberLocale, 0) })}` : ""}
                    {f.notes ? ` · ${f.notes}` : ""}
                  </span>
                </div>
              ))}
            </CategoryGroup>
          )}

          {/* LED screens */}
          {items.ledScreens.length > 0 && (
            <CategoryGroup
              title={t("drawing.category.led")}
              destination={t("drawing.destination.led")}
              selectAllLabel={t("drawing.action.selectAll")}
              selectItemLabel={(index) => t("drawing.action.selectItem", { index })}
              count={items.ledScreens.length}
              selected={selection.ledIndexes}
              onToggle={(i) =>
                setSelection((s) => ({
                  ...s,
                  ledIndexes: toggleIndex(s.ledIndexes, i),
                }))
              }
              onSelectAll={() =>
                setSelection((s) => ({
                  ...s,
                  ledIndexes: new Set(items.ledScreens.map((_, i) => i)),
                }))
              }
            >
              {items.ledScreens.map((s, i) => {
                // Prefer panel grid; fall back to metres if the drawing
                // only labelled the screen size in metres ("5 x 3 m").
                let size = t("drawing.item.panelGridUnknown");
                if (s.panelsWide != null && s.panelsTall != null) {
                  size = t("drawing.item.panels", { wide: s.panelsWide, tall: s.panelsTall });
                } else if (s.widthM != null && s.heightM != null) {
                  size = `${fmt(s.widthM, numberLocale)} × ${fmt(s.heightM, numberLocale)} m`;
                }
                return (
                  <div key={i}>
                    <strong>{s.name}</strong>
                    <span className="led-sub">
                      {size}
                      {s.notes ? ` · ${s.notes}` : ""}
                    </span>
                  </div>
                );
              })}
            </CategoryGroup>
          )}

          {/* Stages */}
          {items.stages.length > 0 && (
            <CategoryGroup
              title={t("drawing.category.stages")}
              destination={t("drawing.destination.stage")}
              selectAllLabel={t("drawing.action.selectAll")}
              selectItemLabel={(index) => t("drawing.action.selectItem", { index })}
              count={items.stages.length}
              selected={selection.stageIndexes}
              onToggle={(i) =>
                setSelection((s) => ({
                  ...s,
                  stageIndexes: toggleIndex(s.stageIndexes, i),
                }))
              }
              onSelectAll={() =>
                setSelection((s) => ({
                  ...s,
                  stageIndexes: new Set(items.stages.map((_, i) => i)),
                }))
              }
            >
              {items.stages.map((s, i) => (
                <div key={i}>
                  <strong>{s.name}</strong>
                  <span className="led-sub">
                    {fmt(s.widthM, numberLocale)} × {fmt(s.depthM, numberLocale)} m
                    {s.notes ? ` · ${s.notes}` : ""}
                  </span>
                </div>
              ))}
            </CategoryGroup>
          )}

          {/* Sound */}
          {items.sound.length > 0 && (
            <CategoryGroup
              title={t("drawing.category.sound")}
              destination={t("drawing.destination.sound")}
              selectAllLabel={t("drawing.action.selectAll")}
              selectItemLabel={(index) => t("drawing.action.selectItem", { index })}
              count={items.sound.length}
              selected={selection.soundIndexes}
              onToggle={(i) =>
                setSelection((s) => ({
                  ...s,
                  soundIndexes: toggleIndex(s.soundIndexes, i),
                }))
              }
              onSelectAll={() =>
                setSelection((s) => ({
                  ...s,
                  soundIndexes: new Set(items.sound.map((_, i) => i)),
                }))
              }
            >
              {items.sound.map((s, i) => (
                <div key={i}>
                  <strong>
                    {s.qty}× {s.name}
                  </strong>
                  <span className="led-sub">
                    {s.weightKg != null ? t("drawing.item.weightEach", { value: fmt(s.weightKg, numberLocale) }) : ""}
                    {s.watts != null ? ` · ${t("drawing.item.wattsEach", { value: fmt(s.watts, numberLocale, 0) })}` : ""}
                    {s.notes ? ` · ${s.notes}` : ""}
                  </span>
                </div>
              ))}
            </CategoryGroup>
          )}

          {itemTotal === 0 && !venueChanged && (
            <div className="led-empty">
              {t("drawing.empty")}
            </div>
          )}
        </div>
      )}

      {editorOpen && extracted && editorImageUrl && (
        <OverlayEditor
          imageUrl={editorImageUrl}
          extracted={extracted}
          onClose={closeEditor}
          onSave={saveEditorChanges}
        />
      )}
    </section>
  );
}

function CategoryGroup({
  title,
  destination,
  count,
  selected,
  onToggle,
  onSelectAll,
  children,
  selectAllLabel,
  selectItemLabel,
}: {
  title: string;
  destination: string;
  count: number;
  selected: Set<number>;
  onToggle: (i: number) => void;
  onSelectAll: () => void;
  children: React.ReactNode;
  selectAllLabel: string;
  selectItemLabel: (index: number) => string;
}) {
  // Pull the <li> children out of the rendered tree so we can wrap each
  // with its own checkbox row tied to the parent's selection set.
  const childArray = Array.isArray(children) ? children : [children];
  return (
    <div className="drawing-group">
      <div className="drawing-group-head">
        <strong>{title}</strong>
        <span className="led-sub">{destination}</span>
        <span className="drawing-group-count">
          {selected.size}/{count}
        </span>
        <button
          type="button"
          className="btn btn-soft btn-xs"
          onClick={onSelectAll}
        >
          {selectAllLabel}
        </button>
      </div>
      <ul className="drawing-item-list">
        {childArray.map((child, i) => (
          <li key={i} className="drawing-item">
            <input
              type="checkbox"
              aria-label={selectItemLabel(i + 1)}
              checked={selected.has(i)}
              onChange={() => onToggle(i)}
            />
            <div className="drawing-item-body">{child}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}
