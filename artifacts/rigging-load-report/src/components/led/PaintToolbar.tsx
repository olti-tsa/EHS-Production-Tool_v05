/** Paint toolbar for the main pixel-map canvas.
 *
 *  Lives inline above the pixel-map SVG. Lets the producer switch
 *  between three "canvas modes":
 *    - off         → normal pixel-map view, no port overlay
 *    - power       → render every screen's powerMap overlay, allow
 *                    click-painting on the currently selected screen
 *    - signal      → same, for signalMap
 *
 *  All port-mutation state lives in the parent (LedScreenReportView)
 *  so the canvas owns a single source of truth. This component is a
 *  thin presenter that calls back up.
 */

import { useRef, type RefObject } from "react";
import { jsPDF } from "jspdf";
import type { LedPortChain, LedPortMap, LedScreen } from "../../lib/led";
import { pngRasterScale } from "../../lib/ledExport";
import { useT } from "../../lib/i18n/I18nContext";
import type { TranslationKey } from "../../lib/i18n/types";

export type PaintMode = "off" | "power" | "signal";

const POWER_PALETTE = [
  "#F88000", "#E0641A", "#C0392B", "#D35400", "#E67E22",
  "#B7410E", "#A04000", "#FF7043",
];
const SIGNAL_PALETTE = [
  "#2A6FB0", "#1F6F8B", "#2980B9", "#3F51B5", "#1565C0",
  "#0288D1", "#5C6BC0", "#3949AB",
];
const MODE_LABEL_KEYS: Record<PaintMode, TranslationKey> = {
  off: "led.paint.mode.view",
  power: "led.paint.mode.power",
  signal: "led.paint.mode.signal",
};

export function newPortId(): string {
  return `p_${Math.random().toString(36).slice(2, 9)}`;
}

export function nextLabel(existing: LedPortChain[]): string {
  const nums = existing
    .map((p) => Number(p.label))
    .filter((n) => Number.isFinite(n) && n > 0);
  const next = nums.length === 0 ? 1 : Math.max(...nums) + 1;
  return String(next);
}

export function nextColor(mode: PaintMode, existing: LedPortChain[]): string {
  const palette = mode === "signal" ? SIGNAL_PALETTE : POWER_PALETTE;
  return palette[existing.length % palette.length];
}

export function PaintToolbar({
  mode,
  onModeChange,
  selectedScreen,
  map,
  onMapChange,
  activePortId,
  onActivePortChange,
  canvasSvgRef,
}: {
  mode: PaintMode;
  onModeChange: (m: PaintMode) => void;
  /** The currently selected screen — null when none is selected; in
   *  that case the toolbar shows a "Pick a screen to start painting"
   *  hint and disables port management. */
  selectedScreen: LedScreen | null;
  /** The selected screen's map for the current mode (powerMap when
   *  mode === "power", signalMap when "signal", undefined for "off"). */
  map: LedPortMap | undefined;
  onMapChange: (next: LedPortMap | undefined) => void;
  activePortId: string | null;
  onActivePortChange: (id: string | null) => void;
  /** Ref to the parent pixel-map SVG — used by PNG/PDF export. */
  canvasSvgRef: RefObject<SVGSVGElement | null>;
}) {
  const t = useT();
  const ports: LedPortChain[] = map?.ports ?? [];
  const isPaint = mode !== "off";
  const canEdit = isPaint && selectedScreen !== null;

  // ── Mutations ────────────────────────────────────────────────────
  function commit(nextPorts: LedPortChain[]) {
    onMapChange(nextPorts.length === 0 ? undefined : { ports: nextPorts });
  }

  function addPort() {
    if (!canEdit) return;
    const port: LedPortChain = {
      id: newPortId(),
      label: nextLabel(ports),
      color: nextColor(mode, ports),
      cells: [],
    };
    commit([...ports, port]);
    onActivePortChange(port.id);
  }

  function deletePort(id: string) {
    const next = ports.filter((p) => p.id !== id);
    if (activePortId === id) onActivePortChange(next[0]?.id ?? null);
    commit(next);
  }

  function renamePort(id: string, label: string) {
    commit(ports.map((p) => (p.id === id ? { ...p, label } : p)));
  }

  function recolorPort(id: string, color: string) {
    commit(ports.map((p) => (p.id === id ? { ...p, color } : p)));
  }

  function clearPort(id: string) {
    commit(ports.map((p) => (p.id === id ? { ...p, cells: [] } : p)));
  }

  function reverseChain(id: string) {
    commit(
      ports.map((p) =>
        p.id === id ? { ...p, cells: [...p.cells].reverse() } : p,
      ),
    );
  }

  // Cable totals — for the currently displayed map only.
  const hops = ports.reduce((n, p) => n + Math.max(0, p.cells.length - 1), 0);
  const trunks = ports.filter((p) => p.cells.length > 0).length;

  // ── Export helpers (reuse the parent canvas SVG) ─────────────────
  async function renderCanvas(): Promise<HTMLCanvasElement | null> {
    const svg = canvasSvgRef.current;
    if (!svg) return null;
    const vb = svg.viewBox.baseVal;
    const width = vb.width || svg.clientWidth || 1200;
    const height = vb.height || svg.clientHeight || 800;
    // Clone + inline the viewBox so the serialized SVG renders at the
    // intended aspect ratio even without the layout context.
    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.setAttribute("width", String(width));
    clone.setAttribute("height", String(height));
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    const xml = new XMLSerializer().serializeToString(clone);
    const blob = new Blob([xml], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      const loaded = new Promise<HTMLImageElement>((resolve, reject) => {
        img.onload = () => resolve(img);
        img.onerror = (e) => reject(e);
      });
      img.src = url;
      const loadedImg = await loaded;
      // Supersample so the exported plan is high-resolution (the live
      // viewBox is in native LED-pixel units, which for a single small
      // screen would otherwise rasterize tiny). Caps at the browser
      // canvas limit so large multi-screen layouts still export.
      const scale = pngRasterScale(width, height);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(loadedImg, 0, 0, canvas.width, canvas.height);
      return canvas;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function exportPng() {
    const canvas = await renderCanvas();
    if (!canvas) return;
    canvas.toBlob((b) => {
      if (!b) return;
      const name = selectedScreen?.name || "pixel-map";
      const suffix = mode === "off" ? "map" : `${mode}-map`;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(b);
      a.download = `${name}-${suffix}.png`;
      a.click();
      URL.revokeObjectURL(a.href);
    }, "image/png");
  }

  async function exportPdf() {
    const canvas = await renderCanvas();
    if (!canvas) return;
    const dataUrl = canvas.toDataURL("image/png");
    const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    pdf.setFontSize(14);
    const title =
      mode === "power"
        ? t("led.paint.pdf.powerPlan")
        : mode === "signal"
          ? t("led.paint.pdf.signalPlan")
          : t("led.paint.pdf.pixelMap");
    pdf.text(`${selectedScreen?.name || t("led.paint.pdf.pixelMap")} — ${title}`, 14, 14);
    const ratio = canvas.height / canvas.width;
    const drawW = pageW - 28;
    const drawH = Math.min(drawW * ratio, pageH - 40);
    const actualW = drawH < drawW * ratio ? drawH / ratio : drawW;
    pdf.addImage(dataUrl, "PNG", (pageW - actualW) / 2, 22, actualW, actualW * ratio);
    if (isPaint) {
      pdf.setFontSize(10);
      pdf.text(
        t("led.paint.pdf.cableSummary", { ports: ports.length, trunks, hops, total: trunks + hops }),
        14,
        pageH - 12,
      );
    }
    const fileName = selectedScreen?.name || "pixel-map";
    const suffix = mode === "off" ? "map" : `${mode}-plan`;
    pdf.save(`${fileName}-${suffix}.pdf`);
  }

  return (
    <div className="paint-toolbar">
      <div className="paint-toolbar-row paint-toolbar-modes">
        <span className="paint-toolbar-label">{t("led.paint.canvasMode")}</span>
        <div className="paint-mode-seg" role="radiogroup" aria-label={t("led.paint.canvasMode")}>
          {(["off", "power", "signal"] as PaintMode[]).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              className={`paint-mode-btn ${mode === m ? "is-active" : ""} paint-mode-${m}`}
              onClick={() => onModeChange(m)}
            >
              {t(MODE_LABEL_KEYS[m])}
            </button>
          ))}
        </div>
        <div className="paint-toolbar-spacer" />
        <button type="button" className="btn btn-soft btn-sm" onClick={exportPng}>
          PNG
        </button>
        <button type="button" className="btn btn-soft btn-sm" onClick={exportPdf}>
          PDF
        </button>
      </div>

      {isPaint && (
        <div className="paint-toolbar-row paint-toolbar-ports">
          {!selectedScreen && (
            <span className="paint-hint">
              {t("led.paint.pickScreen")}
            </span>
          )}
          {selectedScreen && ports.length === 0 && (
            <span className="paint-hint">
              {t("led.paint.noPorts", {
                type: t(mode === "power" ? "led.paint.powerFeeds" : "led.paint.signalPorts"),
                name: selectedScreen.name,
              })}
            </span>
          )}
          {selectedScreen &&
            ports.map((p) => {
              const active = p.id === activePortId;
              return (
                <div
                  key={p.id}
                  className={`paint-port ${active ? "is-active" : ""}`}
                  onClick={() => onActivePortChange(p.id)}
                >
                  <input
                    type="color"
                    value={p.color}
                    onChange={(e) => recolorPort(p.id, e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    className="paint-port-color"
                     title={t("led.paint.portColor")}
                     aria-label={t("led.paint.portColor")}
                  />
                  <input
                    type="text"
                    value={p.label}
                    onChange={(e) => renamePort(p.id, e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    className="paint-port-label"
                    style={{ width: Math.max(34, p.label.length * 9 + 12) }}
                     title={t("led.paint.portLabel")}
                     aria-label={t("led.paint.portLabel")}
                  />
                  <span className="paint-port-count">{p.cells.length}</span>
                  <button
                    className="paint-port-icon"
                    onClick={(e) => { e.stopPropagation(); reverseChain(p.id); }}
                     title={t("led.paint.reverseChain")}
                     aria-label={t("led.paint.reverseChain")}
                  >⇄</button>
                  <button
                    className="paint-port-icon"
                    onClick={(e) => { e.stopPropagation(); clearPort(p.id); }}
                     title={t("led.paint.clearCells")}
                     aria-label={t("led.paint.clearCells")}
                  >⌫</button>
                  <button
                    className="paint-port-icon paint-port-icon-danger"
                    onClick={(e) => { e.stopPropagation(); deletePort(p.id); }}
                     title={t("led.paint.deletePort")}
                     aria-label={t("led.paint.deletePort")}
                  >×</button>
                </div>
              );
            })}
          {selectedScreen && (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={addPort}
            >
              {t(mode === "power" ? "led.paint.addPowerFeed" : "led.paint.addSignalPort")}
            </button>
          )}
          {selectedScreen && ports.length > 0 && (
            <span className="paint-cable-summary">
              {t(
                ports.length === 1
                  ? "led.paint.cableSummaryOne"
                  : "led.paint.cableSummaryMany",
                { ports: ports.length, trunks, hops, total: trunks + hops },
              )}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
