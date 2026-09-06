/** Bridge between the rich `ExtractedItems` shape used everywhere
 *  else (with category-specific fields like `lengthM`, `qty`,
 *  `weightKg`) and the flat per-box list the overlay editor renders.
 *
 *  We don't strip the rich payload — the editor carries it on each
 *  item so a round-trip through the editor preserves every field
 *  that didn't change. This way a user who only nudges a box's
 *  position never accidentally erases the model's `weightKg` for a
 *  fixture they didn't touch. */

import type {
  Bbox,
  ExtractedItems,
  ExtractedLedScreen,
  ExtractedLighting,
  ExtractedSound,
  ExtractedStage,
  ExtractedTruss,
} from "../../lib/drawingAnalysis";

export type OverlayItemKind =
  | "truss"
  | "lighting"
  | "led"
  | "stage"
  | "sound";

/** A single editable box — flattened from one item in `ExtractedItems`.
 *  `payload` is the original record (still typed by category) so we
 *  can put it back on save without losing fields the editor doesn't
 *  surface. */
export type OverlayItem =
  | {
      id: string;
      kind: "truss";
      bbox: Bbox;
      label: string;
      confidence: number | null;
      payload: ExtractedTruss;
    }
  | {
      id: string;
      kind: "lighting";
      bbox: Bbox;
      label: string;
      confidence: number | null;
      payload: ExtractedLighting;
    }
  | {
      id: string;
      kind: "led";
      bbox: Bbox;
      label: string;
      confidence: number | null;
      payload: ExtractedLedScreen;
    }
  | {
      id: string;
      kind: "stage";
      bbox: Bbox;
      label: string;
      confidence: number | null;
      payload: ExtractedStage;
    }
  | {
      id: string;
      kind: "sound";
      bbox: Bbox;
      label: string;
      confidence: number | null;
      payload: ExtractedSound;
    };

/** Default bbox used when an item has no positional data — placed at
 *  the visual centre of the image so the user can immediately drag
 *  it where it belongs. We also use this for items added by hand from
 *  the "+ Add" buttons. */
export function defaultBbox(): Bbox {
  return { x: 0.4, y: 0.4, width: 0.2, height: 0.2 };
}

function makeId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

/** Flatten an `ExtractedItems` into the editor's box list, preserving
 *  insertion order within each category. Items without a bbox get a
 *  default bbox placed at the centre so they remain editable rather
 *  than invisible. */
export function toOverlayItems(items: ExtractedItems): OverlayItem[] {
  const out: OverlayItem[] = [];
  items.trusses.forEach((t) => {
    out.push({
      id: makeId("tr"),
      kind: "truss",
      bbox: t.bbox ?? defaultBbox(),
      label: t.name,
      confidence: t.confidence,
      payload: t,
    });
  });
  items.lighting.forEach((f) => {
    out.push({
      id: makeId("lx"),
      kind: "lighting",
      bbox: f.bbox ?? defaultBbox(),
      label: `${f.qty}× ${f.name}${f.trussName ? ` · ${f.trussName}` : ""}`,
      confidence: f.confidence,
      payload: f,
    });
  });
  items.ledScreens.forEach((s) => {
    out.push({
      id: makeId("led"),
      kind: "led",
      bbox: s.bbox ?? defaultBbox(),
      label: s.name,
      confidence: s.confidence,
      payload: s,
    });
  });
  items.stages.forEach((s) => {
    out.push({
      id: makeId("st"),
      kind: "stage",
      bbox: s.bbox ?? defaultBbox(),
      label: s.name,
      confidence: s.confidence,
      payload: s,
    });
  });
  items.sound.forEach((s) => {
    out.push({
      id: makeId("snd"),
      kind: "sound",
      bbox: s.bbox ?? defaultBbox(),
      label: `${s.qty}× ${s.name}`,
      confidence: s.confidence,
      payload: s,
    });
  });
  return out;
}

/** Re-bundle the editor's box list back into the rich `ExtractedItems`
 *  shape. Each item's payload is updated with the latest bbox /
 *  confidence / label so saved corrections survive the round-trip. */
export function fromOverlayItems(
  base: ExtractedItems,
  items: OverlayItem[],
): ExtractedItems {
  const trusses: ExtractedTruss[] = [];
  const lighting: ExtractedLighting[] = [];
  const led: ExtractedLedScreen[] = [];
  const stages: ExtractedStage[] = [];
  const sound: ExtractedSound[] = [];
  for (const item of items) {
    switch (item.kind) {
      case "truss":
        trusses.push({
          ...item.payload,
          name: item.payload.name,
          bbox: item.bbox,
          confidence: item.confidence,
        });
        break;
      case "lighting":
        lighting.push({
          ...item.payload,
          bbox: item.bbox,
          confidence: item.confidence,
        });
        break;
      case "led":
        led.push({
          ...item.payload,
          bbox: item.bbox,
          confidence: item.confidence,
        });
        break;
      case "stage":
        stages.push({
          ...item.payload,
          bbox: item.bbox,
          confidence: item.confidence,
        });
        break;
      case "sound":
        sound.push({
          ...item.payload,
          bbox: item.bbox,
          confidence: item.confidence,
        });
        break;
    }
  }
  return {
    venue: base.venue,
    summary: base.summary,
    trusses,
    lighting,
    ledScreens: led,
    stages,
    sound,
  };
}

/** Build a fresh OverlayItem of the given kind, with sensible defaults
 *  the user can edit in the side panel. Used by the "+ Add" buttons
 *  in the overlay editor. */
export function newOverlayItem(kind: OverlayItemKind, name: string): OverlayItem {
  const bbox = defaultBbox();
  switch (kind) {
    case "truss":
      return {
        id: makeId("tr"),
        kind,
        bbox,
        label: name,
        confidence: null,
        payload: {
          name,
          lengthM: 8,
          pointCount: 3,
          hoistKg: null,
          trimM: null,
          notes: "",
          confidence: null,
          bbox,
        },
      };
    case "lighting":
      return {
        id: makeId("lx"),
        kind,
        bbox,
        label: `1× ${name}`,
        confidence: null,
        payload: {
          name,
          qty: 1,
          weightKg: null,
          watts: null,
          trussName: "",
          notes: "",
          confidence: null,
          bbox,
        },
      };
    case "led":
      return {
        id: makeId("led"),
        kind,
        bbox,
        label: name,
        confidence: null,
        payload: {
          name,
          panelsWide: null,
          panelsTall: null,
          widthM: 4,
          heightM: 2.5,
          notes: "",
          confidence: null,
          bbox,
        },
      };
    case "stage":
      return {
        id: makeId("st"),
        kind,
        bbox,
        label: name,
        confidence: null,
        payload: {
          name,
          widthM: 8,
          depthM: 6,
          notes: "",
          confidence: null,
          bbox,
        },
      };
    case "sound":
      return {
        id: makeId("snd"),
        kind,
        bbox,
        label: `1× ${name}`,
        confidence: null,
        payload: {
          name,
          qty: 1,
          weightKg: null,
          watts: null,
          notes: "",
          confidence: null,
          bbox,
        },
      };
  }
}

/** Recompute the human-readable label after the side panel edits the
 *  underlying payload. Keeps the badge text in sync with category-
 *  specific fields (qty for lighting/sound, name for everything
 *  else). */
export function relabelOverlayItem(item: OverlayItem): OverlayItem {
  switch (item.kind) {
    case "lighting": {
      const p = item.payload;
      return {
        ...item,
        label: `${p.qty}× ${p.name}${p.trussName ? ` · ${p.trussName}` : ""}`,
      };
    }
    case "sound": {
      const p = item.payload;
      return { ...item, label: `${p.qty}× ${p.name}` };
    }
    default:
      return { ...item, label: item.payload.name };
  }
}
