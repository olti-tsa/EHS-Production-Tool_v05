/**
 * Convert a self-contained HTML document string to a multi-page A4 PDF
 * and trigger a browser download. No popup, no print dialog — the user
 * gets a real .pdf file in their Downloads folder.
 *
 * Implementation notes:
 *  - The HTML is rendered into a hidden, off-screen same-origin iframe
 *    so its <style> blocks (and any A4 sizing) work as written.
 *  - html2canvas rasterises the iframe body to a PNG, which is then
 *    sliced across A4 pages by jsPDF. The text is not selectable in the
 *    resulting PDF (it's image-based), which is the right trade-off for
 *    a build/handoff sheet — the layout is preserved 1:1, including
 *    SVG diagrams and tables, with no font-availability surprises.
 *  - We size the iframe at ~794px wide (≈ A4 at 96 dpi) so the
 *    rendered page width maps cleanly to a 210 mm A4 page.
 */
import jsPDF from "jspdf";
import html2canvas from "html2canvas";

const A4_PORTRAIT_PX = 794; // ≈ 210 mm at 96 dpi
const A4_LANDSCAPE_PX = 1123; // ≈ 297 mm at 96 dpi

export type Orientation = "portrait" | "landscape";
export type HtmlToPdfOptions = {
  orientation?: Orientation;
  singlePage?: boolean;
};

export type HtmlToPdfErrorCode =
  | "iframe-document-unavailable"
  | "render-failed";

/** Stable, non-localized export failure. UI callers must map `code` to
 * translated copy and may log `cause` for diagnostics. */
export class HtmlToPdfError extends Error {
  readonly code: HtmlToPdfErrorCode;
  readonly cause?: unknown;

  constructor(code: HtmlToPdfErrorCode, cause?: unknown) {
    super(`[html-to-pdf:${code}]`);
    this.name = "HtmlToPdfError";
    this.code = code;
    this.cause = cause;
  }
}

export function isHtmlToPdfError(error: unknown): error is HtmlToPdfError {
  return error instanceof HtmlToPdfError;
}

/** Render an HTML document string to a multi-page A4 PDF and return it
 *  as a Blob. Use this when you want to attach the PDF to something
 *  (upload it, embed it, etc.) instead of triggering a browser download.
 *  See `downloadHtmlAsPdf` for the download variant. */
export async function htmlToPdfBlob(
  html: string,
  options: HtmlToPdfOptions = {},
): Promise<Blob> {
  try {
    const pdf = await renderHtmlToJsPdf(html, options);
    // jsPDF's `output("blob")` returns a Blob synchronously.
    return pdf.output("blob");
  } catch (error) {
    if (isHtmlToPdfError(error)) throw error;
    throw new HtmlToPdfError("render-failed", error);
  }
}

export async function downloadHtmlAsPdf(
  html: string,
  filename: string,
  options: HtmlToPdfOptions = {},
): Promise<void> {
  try {
    const pdf = await renderHtmlToJsPdf(html, options);
    pdf.save(filename);
  } catch (error) {
    if (isHtmlToPdfError(error)) throw error;
    throw new HtmlToPdfError("render-failed", error);
  }
}

async function renderHtmlToJsPdf(
  html: string,
  options: HtmlToPdfOptions,
): Promise<jsPDF> {
  const orientation = options.orientation ?? "portrait";
  const renderWidth = orientation === "landscape" ? A4_LANDSCAPE_PX : A4_PORTRAIT_PX;
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.cssText = [
    "position:fixed",
    "left:-10000px",
    "top:0",
    `width:${renderWidth}px`,
    "height:auto",
    "border:0",
    "pointer-events:none",
    "opacity:0",
  ].join(";");
  document.body.appendChild(iframe);

  try {
    const doc = iframe.contentDocument;
    if (!doc) throw new HtmlToPdfError("iframe-document-unavailable");
    doc.open();
    doc.write(html);
    doc.close();

    // Wait for the iframe document to be parsed and any inline images /
    // fonts to settle. We check the document's `readyState` and also
    // wait for `document.fonts.ready` when supported.
    await new Promise<void>((resolve) => {
      if (doc.readyState === "complete") {
        resolve();
        return;
      }
      iframe.addEventListener("load", () => resolve(), { once: true });
    });
    await Promise.all(
      Array.from(doc.images).map((image) => {
        if (image.complete) return Promise.resolve();
        return new Promise<void>((resolve) => {
          image.addEventListener("load", () => resolve(), { once: true });
          image.addEventListener("error", () => resolve(), { once: true });
        });
      }),
    );
    const fonts = (doc as Document & { fonts?: { ready: Promise<unknown> } })
      .fonts;
    if (fonts?.ready) {
      try {
        await fonts.ready;
      } catch {
        /* font loading errors shouldn't block PDF generation */
      }
    }
    // Wait one frame so layout finishes after late style application.
    await new Promise<void>((r) =>
      requestAnimationFrame(() => requestAnimationFrame(() => r())),
    );

    const renderTarget = doc.body;
    const renderHeight = Math.max(
      renderTarget.scrollHeight,
      renderTarget.offsetHeight,
      doc.documentElement.scrollHeight,
    );

    // Grow the iframe to its natural content height so html2canvas
    // captures the full page in one go.
    iframe.style.height = `${renderHeight}px`;

    const canvas = await html2canvas(renderTarget, {
      backgroundColor: "#ffffff",
      scale: 2,
      useCORS: true,
      logging: false,
      windowWidth: renderWidth,
      windowHeight: renderHeight,
    });

    const pdf = new jsPDF({
      unit: "mm",
      format: "a4",
      orientation,
    });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    let imgW = pageW;
    let imgH = (canvas.height * imgW) / canvas.width;
    if (options.singlePage && imgH > pageH) {
      const scale = pageH / imgH;
      imgW *= scale;
      imgH = pageH;
    }
    const x = (pageW - imgW) / 2;

    const imgData = canvas.toDataURL("image/png");
    let position = 0;
    pdf.addImage(imgData, "PNG", x, position, imgW, imgH);
    if (options.singlePage) return pdf;
    let remaining = imgH - pageH;
    while (remaining > 0.1) {
      position -= pageH;
      pdf.addPage();
      pdf.addImage(imgData, "PNG", x, position, imgW, imgH);
      remaining -= pageH;
    }

    return pdf;
  } catch (error) {
    if (isHtmlToPdfError(error)) throw error;
    throw new HtmlToPdfError("render-failed", error);
  } finally {
    iframe.remove();
  }
}

/** Filesystem-safe filename slug. */
export function pdfFilename(
  parts: Array<string | undefined | null>,
  fallback: string,
): string {
  const cleaned = parts
    .map((p) => (p ?? "").trim())
    .filter((p) => p.length > 0)
    .join(" — ")
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, " ")
    .trim();
  return (cleaned || fallback) + ".pdf";
}
