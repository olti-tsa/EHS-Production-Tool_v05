import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MiniMap,
  Position,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  reconnectEdge,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type EdgeProps,
  type Node,
  type NodeChange,
  type NodeProps,
  type ReactFlowInstance,
  type Viewport,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import {
  computeLedSystemMetrics,
  newEdgeId,
  newNodeId,
  type LedSystem,
  type LedSystemEdge,
  type LedSystemEdgeKind,
  type LedSystemNode,
  type LedSystemNodeKind,
} from "../lib/ledSystem";
import {
  NOVASTAR_PROCESSOR_OPTIONS,
  type LedScreen,
  type NovastarProcessorModel,
} from "../lib/led";
import { useT } from "../lib/i18n/I18nContext";

// ─── Styling tokens ───────────────────────────────────────────────────
//
// The designer uses inline style objects so it doesn't have to ship
// extra CSS through index.css for v1. Colours match the EHS dark
// palette referenced in replit.md (#1C1C24 base, #25252F surface,
// #f88000 accent) and align with the React Flow viewport background.

const NODE_KIND_THEME: Record<
  LedSystemNodeKind,
  { emoji: string; accent: string }
> = {
  screen: { emoji: "▦", accent: "#3B82F6" },
  processor: { emoji: "⚙︎", accent: "#F88000" },
  fiberbox: { emoji: "✶", accent: "#A855F7" },
  psu: { emoji: "⚡", accent: "#EF4444" },
  // Phase 4 — touring topology nodes. Same chrome, new accents.
  "media-server": { emoji: "▶", accent: "#10B981" },
  "network-switch": { emoji: "⇄", accent: "#0EA5E9" },
  ups: { emoji: "🔋", accent: "#EAB308" },
  powerdistro: { emoji: "⌁", accent: "#DC2626" },
  genlock: { emoji: "⊙", accent: "#8B5CF6" },
};

const EDGE_KIND_THEME: Record<
  LedSystemEdgeKind,
  { color: string; dash?: string }
> = {
  signal: { color: "#F88000" },
  fiber: { color: "#3B82F6", dash: "6 4" },
  power: { color: "#EF4444", dash: "2 4" },
};

const NODE_KIND_TRANSLATION_KEYS: Record<
  LedSystemNodeKind,
  Parameters<ReturnType<typeof useT>>[0]
> = {
  screen: "ledSystem.node.screen",
  processor: "ledSystem.node.processor",
  fiberbox: "ledSystem.node.fiberbox",
  psu: "ledSystem.node.psu",
  "media-server": "ledSystem.node.mediaServer",
  "network-switch": "ledSystem.node.networkSwitch",
  ups: "ledSystem.node.ups",
  powerdistro: "ledSystem.node.powerDistro",
  genlock: "ledSystem.node.genlock",
};

const EDGE_KIND_TRANSLATION_KEYS: Record<
  LedSystemEdgeKind,
  Parameters<ReturnType<typeof useT>>[0]
> = {
  signal: "ledSystem.edge.signal",
  fiber: "ledSystem.edge.fiber",
  power: "ledSystem.edge.power",
};

const DIRECTION_TRANSLATION_KEYS = {
  left: "ledSystem.direction.left",
  right: "ledSystem.direction.right",
  up: "ledSystem.direction.up",
  down: "ledSystem.direction.down",
} as const;

// ─── Custom node component ────────────────────────────────────────────

type NodeData = {
  node: LedSystemNode;
  pixels: number;
  selected?: boolean;
  hasWarning?: boolean;
};

function SystemNode({ data, selected }: NodeProps<Node<NodeData>>) {
  const t = useT();
  const { node, pixels, hasWarning } = data;
  const theme = NODE_KIND_THEME[node.kind];
  const subtitle = (() => {
    if (node.kind === "screen") {
      if (pixels > 0) return `${pixels.toLocaleString()} px`;
      return t("ledSystem.node.noPixelData");
    }
    if (node.kind === "processor") {
      const modelName = node.processorModel
        ? (NOVASTAR_PROCESSOR_OPTIONS.find(
            (o) => o.model === node.processorModel,
          )?.name ?? t("ledSystem.other"))
        : t("ledSystem.other");
      return node.isBackup ? `${modelName} · ${t("ledSystem.backup")}` : modelName;
    }
    if (node.kind === "fiberbox") return t("ledSystem.node.fiberConverter");
    if (node.kind === "psu") {
      const a = node.psuAmps ?? 0;
      const ph = node.psuPhases ?? 1;
      return a > 0
        ? t("ledSystem.node.phaseSummary", { amps: a, phases: ph })
        : t("ledSystem.node.sizedInInspector");
    }
    return "";
  })();

  const ringColor = hasWarning
    ? "#EF4444"
    : selected
      ? "#F88000"
      : theme.accent;

  return (
    <div
      style={{
        background: "#25252F",
        color: "#F4F4F5",
        border: `1.5px solid ${ringColor}`,
        boxShadow: selected
          ? `0 0 0 3px rgba(248,128,0,0.25), 0 6px 16px rgba(0,0,0,0.45)`
          : "0 4px 12px rgba(0,0,0,0.4)",
        borderRadius: 10,
        minWidth: 160,
        padding: "10px 12px",
        fontSize: 12,
        fontFamily: "system-ui, sans-serif",
        position: "relative",
      }}
    >
      <Handle
        type="target"
        position={Position.Left}
        style={{
          background: theme.accent,
          width: 10,
          height: 10,
          border: "2px solid #1C1C24",
        }}
      />
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 4,
        }}
      >
        <span
          aria-hidden
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 22,
            height: 22,
            borderRadius: 6,
            background: theme.accent,
            color: "#0F0F14",
            fontWeight: 700,
            fontSize: 13,
          }}
        >
          {theme.emoji}
        </span>
        <span style={{ fontWeight: 600, flex: 1, lineHeight: 1.2 }}>
          {node.label}
        </span>
        {hasWarning && (
          <span
            title={t("ledSystem.seeWarnings")}
            style={{
              color: "#EF4444",
              fontSize: 14,
              lineHeight: 1,
            }}
          >
            ⚠
          </span>
        )}
      </div>
      <div
        style={{
          color: "#A1A1AA",
          fontSize: 11,
          lineHeight: 1.3,
        }}
      >
        {subtitle}
      </div>
      <Handle
        type="source"
        position={Position.Right}
        style={{
          background: theme.accent,
          width: 10,
          height: 10,
          border: "2px solid #1C1C24",
        }}
      />
    </div>
  );
}

// ─── Custom edge component ────────────────────────────────────────────
//
// Coloured + dashed per cable kind, with the distance shown inline so
// the producer can read the cable plan at a glance without opening
// the inspector.

function SystemEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  data,
  selected,
}: EdgeProps & { data?: { edge: LedSystemEdge; hasWarning?: boolean } }) {
  const edge = data?.edge;
  if (!edge) return null;
  const theme = EDGE_KIND_THEME[edge.kind];
  const stroke = data?.hasWarning ? "#EF4444" : theme.color;
  const dash = theme.dash;
  // Bezier curve to keep things readable when nodes overlap. Same maths
  // React Flow uses internally for the default smoothstep edge.
  const midX = (sourceX + targetX) / 2;
  const path = `M${sourceX},${sourceY} C${midX},${sourceY} ${midX},${targetY} ${targetX},${targetY}`;
  const labelX = midX;
  const labelY = (sourceY + targetY) / 2;
  return (
    <g>
      <path
        id={id}
        d={path}
        fill="none"
        stroke={stroke}
        strokeWidth={selected ? 3 : 2}
        strokeDasharray={dash}
      />
      <foreignObject
        x={labelX - 32}
        y={labelY - 12}
        width={64}
        height={24}
        style={{ overflow: "visible" }}
      >
        <div
          style={{
            background: "#1C1C24",
            color: "#F4F4F5",
            border: `1px solid ${stroke}`,
            borderRadius: 999,
            fontSize: 10,
            fontFamily: "system-ui",
            padding: "1px 8px",
            textAlign: "center",
            whiteSpace: "nowrap",
            boxShadow: "0 2px 4px rgba(0,0,0,0.4)",
          }}
        >
          {edge.distanceM > 0 ? `${edge.distanceM} m` : "—"}
        </div>
      </foreignObject>
    </g>
  );
}

// ─── Top-level component ──────────────────────────────────────────────

const NODE_TYPES = { system: SystemNode };
const EDGE_TYPES = { system: SystemEdge };

type Props = {
  system: LedSystem;
  onChange: (next: LedSystem) => void;
  /** Existing screens from the LED report. Used to pixel-resolve
   *  screen-kind nodes that are linked by `screenRefId`, and to power
   *  the screen-link dropdown in the inspector. */
  screens: LedScreen[];
  /** Map of LedScreen.id → total pixels. Built by App.tsx via
   *  `computeScreenMetrics`. */
  screenPixelsById: Map<string, number>;
};

export function LedSystemDesigner(props: Props) {
  return (
    <ReactFlowProvider>
      <DesignerInner {...props} />
    </ReactFlowProvider>
  );
}

function DesignerInner({ system, onChange, screens, screenPixelsById }: Props) {
  const t = useT();
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [pendingEdgeKind, setPendingEdgeKind] =
    useState<LedSystemEdgeKind>("signal");
  const flowRef = useRef<ReactFlowInstance | null>(null);

  // Live metrics derived from the persisted system + the up-to-date
  // pixel map. Recomputed every render — cheap (single pass over
  // edges + BFS per processor) and avoids stale-closure bugs.
  const metrics = useMemo(
    () => computeLedSystemMetrics(system, screenPixelsById),
    [system, screenPixelsById],
  );

  const warningNodeIds = useMemo(() => {
    const s = new Set<string>();
    for (const w of metrics.warnings) if (w.nodeId) s.add(w.nodeId);
    return s;
  }, [metrics.warnings]);
  const warningEdgeIds = useMemo(() => {
    const s = new Set<string>();
    for (const w of metrics.warnings) if (w.edgeId) s.add(w.edgeId);
    return s;
  }, [metrics.warnings]);

  // ── Persisted-shape ↔ React-Flow translation ───────────────────────
  //
  // React Flow needs to OWN the live `nodes` / `edges` arrays it
  // renders so it can stamp internal fields onto them — most
  // importantly `measured: {width, height}`, which gets written after
  // the first layout pass and is what tells RF the node is "ready to
  // drag". If we recomputed the arrays from props each render via
  // `useMemo`, those internal fields got thrown away on every re-
  // render and the second drag attempt threw "node is not initialized"
  // → uncaught runtime error in production. So we keep a local state
  // mirror, apply ALL React Flow changes to it (positions + dimensions
  // + selection), and reconcile from the persisted system in an effect
  // that preserves any RF-stamped fields on nodes whose id we've seen
  // before. Position commits flow back to the persisted system on
  // drag-stop only — not on every drag tick — so autosave and undo
  // stay sane.

  const buildNodeData = useCallback(
    (n: LedSystemNode): NodeData => ({
      node: n,
      pixels:
        n.kind === "screen"
          ? n.screenRefId
            ? (screenPixelsById.get(n.screenRefId) ?? 0)
            : (n.pixelsW ?? 0) * (n.pixelsH ?? 0)
          : 0,
      selected: n.id === selectedNodeId,
      hasWarning: warningNodeIds.has(n.id),
    }),
    [screenPixelsById, selectedNodeId, warningNodeIds],
  );

  const [rfNodes, setRfNodes] = useState<Node<NodeData>[]>(() =>
    system.nodes.map((n) => ({
      id: n.id,
      type: "system",
      position: { x: n.x, y: n.y },
      data: buildNodeData(n),
    })),
  );
  const [rfEdges, setRfEdges] = useState<Edge[]>(() =>
    system.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      type: "system",
      selected: e.id === selectedEdgeId,
      data: { edge: e, hasWarning: warningEdgeIds.has(e.id) },
    })),
  );

  // ── Reconciliation: split into two effects on purpose ──────────────
  //
  // Effect A (structural) runs only when persisted node identity or
  // coordinates change. It adds new ids, drops missing ids, and pulls
  // in fresh persisted positions — but it skips position writes for
  // any node RF currently flags as `dragging`, so a mid-drag
  // unrelated re-render (selection, screen-pixel recompute, autosave
  // round-trip) cannot snap a node back to its old persisted position
  // before the user has dropped it. Existing RF internals
  // (`measured`, `width`, `height`) are preserved by spreading the
  // previous node first.
  //
  // Effect B (data-only) runs on selection / warning / pixel changes
  // and refreshes only `data`. It never touches `position`,
  // `measured`, or `dragging`, so it cannot race with an in-progress
  // drag. This separation is what fixes the snap-back race a code
  // review caught after the first drag-bug repair.
  useEffect(() => {
    setRfNodes((prev) => {
      const prevById = new Map(prev.map((n) => [n.id, n]));
      return system.nodes.map((n) => {
        const existing = prevById.get(n.id);
        if (existing) {
          return {
            ...existing,
            position: existing.dragging
              ? existing.position
              : { x: n.x, y: n.y },
          };
        }
        return {
          id: n.id,
          type: "system",
          position: { x: n.x, y: n.y },
          data: buildNodeData(n),
        } satisfies Node<NodeData>;
      });
    });
    // Intentionally only depends on `system.nodes` — `buildNodeData`
    // is read for first-mount node creation, but pulling it into the
    // dep array would re-run this effect (and overwrite drag
    // positions) on every selection change. New-node hydration of
    // `data` is best-effort here; effect B will refresh it on the
    // very next pass.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [system.nodes]);

  useEffect(() => {
    setRfNodes((prev) =>
      prev.map((n) => ({ ...n, data: buildNodeData(n.data.node) })),
    );
  }, [buildNodeData]);

  useEffect(() => {
    setRfEdges((prev) => {
      const prevById = new Map(prev.map((e) => [e.id, e]));
      return system.edges.map((e) => {
        const existing = prevById.get(e.id);
        const base: Edge = existing
          ? { ...existing, source: e.source, target: e.target }
          : { id: e.id, source: e.source, target: e.target, type: "system" };
        return {
          ...base,
          selected: e.id === selectedEdgeId,
          data: { edge: e, hasWarning: warningEdgeIds.has(e.id) },
        };
      });
    });
  }, [system.edges, selectedEdgeId, warningEdgeIds]);

  // ── Mutations ──────────────────────────────────────────────────────

  const updateNodes = useCallback(
    (mutator: (nodes: LedSystemNode[]) => LedSystemNode[]) => {
      onChange({ ...system, nodes: mutator(system.nodes) });
    },
    [system, onChange],
  );
  const updateEdges = useCallback(
    (mutator: (edges: LedSystemEdge[]) => LedSystemEdge[]) => {
      onChange({ ...system, edges: mutator(system.edges) });
    },
    [system, onChange],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange<Node<NodeData>>[]) => {
      // Apply EVERY change to the local mirror so RF's internal
      // bookkeeping (dimensions, selection) survives across renders.
      setRfNodes((prev) => applyNodeChanges(changes, prev));
      // Commit position to the persisted system only when a drag has
      // ended (`dragging: false`). Mid-drag updates would thrash
      // autosave and the project-list cache for no benefit.
      const drops = changes.filter(
        (c): c is Extract<NodeChange<Node<NodeData>>, { type: "position" }> =>
          c.type === "position" &&
          c.dragging === false &&
          c.position !== undefined,
      );
      if (drops.length === 0) return;
      const dropsById = new Map(drops.map((d) => [d.id, d.position!]));
      let dirty = false;
      const nextNodes = system.nodes.map((n) => {
        const p = dropsById.get(n.id);
        if (!p) return n;
        if (p.x === n.x && p.y === n.y) return n;
        dirty = true;
        return { ...n, x: p.x, y: p.y };
      });
      if (dirty) onChange({ ...system, nodes: nextNodes });
    },
    [system, onChange],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      // Apply locally first so RF's internal selection / animation
      // state stays consistent.
      setRfEdges((prev) => applyEdgeChanges(changes, prev));
      const removeIds = new Set(
        changes
          .filter((c): c is { id: string; type: "remove" } => c.type === "remove")
          .map((c) => c.id),
      );
      if (removeIds.size === 0) return;
      updateEdges((edges) => edges.filter((e) => !removeIds.has(e.id)));
      if (selectedEdgeId && removeIds.has(selectedEdgeId)) {
        setSelectedEdgeId(null);
      }
    },
    [updateEdges, selectedEdgeId],
  );

  const onConnect = useCallback(
    (conn: Connection) => {
      if (!conn.source || !conn.target) return;
      const newEdge: LedSystemEdge = {
        id: newEdgeId(),
        source: conn.source,
        target: conn.target,
        kind: pendingEdgeKind,
        distanceM: 0,
      };
      updateEdges((edges) => [...edges, newEdge]);
      setSelectedEdgeId(newEdge.id);
      // Mirror into local RF state so the new edge appears immediately
      // even before the reconcile effect fires on the next render.
      setRfEdges((prev) =>
        addEdge(
          { ...conn, id: newEdge.id, type: "system" } as Connection,
          prev,
        ),
      );
    },
    [pendingEdgeKind, updateEdges],
  );

  const onReconnect = useCallback(
    (oldEdge: Edge, conn: Connection) => {
      if (!conn.source || !conn.target) return;
      updateEdges((edges) =>
        edges.map((e) =>
          e.id === oldEdge.id
            ? { ...e, source: conn.source!, target: conn.target! }
            : e,
        ),
      );
      setRfEdges((prev) => reconnectEdge(oldEdge, conn, prev));
    },
    [updateEdges],
  );

  const onMoveEnd = useCallback(
    (_evt: unknown, vp: Viewport) => {
      // Persist the viewport so the producer comes back to the same
      // pan / zoom on reload. Compared cheaply to skip no-op writes.
      const cur = system.viewport;
      if (cur && cur.x === vp.x && cur.y === vp.y && cur.zoom === vp.zoom) {
        return;
      }
      onChange({ ...system, viewport: vp });
    },
    [system, onChange],
  );

  // ── Toolbar actions ────────────────────────────────────────────────

  const addNode = useCallback(
    (kind: LedSystemNodeKind, extra?: Partial<LedSystemNode>) => {
      const inst = flowRef.current;
      // Drop near the centre of the current viewport so it lands in
      // the producer's view regardless of pan / zoom. Falls back to
      // the canvas origin if React Flow hasn't initialised yet.
      const center = inst
        ? inst.screenToFlowPosition({
            x: window.innerWidth / 2,
            y: window.innerHeight / 2,
          })
        : { x: 80, y: 80 };
      // Ordinal label: "Screen 3" etc.
      const ordinal =
        system.nodes.filter((n) => n.kind === kind).length + 1;
      const label =
        extra?.label ??
        t("ledSystem.node.defaultLabel", {
          kind: t(NODE_KIND_TRANSLATION_KEYS[kind]),
          ordinal,
        });
      const node: LedSystemNode = {
        id: newNodeId(),
        kind,
        x: center.x - 80,
        y: center.y - 30,
        label,
        ...extra,
      };
      updateNodes((nodes) => [...nodes, node]);
      setSelectedNodeId(node.id);
    },
    [system.nodes, updateNodes, t],
  );

  const removeNode = useCallback(
    (id: string) => {
      onChange({
        ...system,
        nodes: system.nodes.filter((n) => n.id !== id),
        edges: system.edges.filter((e) => e.source !== id && e.target !== id),
      });
      if (selectedNodeId === id) setSelectedNodeId(null);
    },
    [system, onChange, selectedNodeId],
  );

  const updateNode = useCallback(
    (id: string, patch: Partial<LedSystemNode>) => {
      updateNodes((nodes) =>
        nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)),
      );
    },
    [updateNodes],
  );

  const updateEdge = useCallback(
    (id: string, patch: Partial<LedSystemEdge>) => {
      updateEdges((edges) =>
        edges.map((e) => (e.id === id ? { ...e, ...patch } : e)),
      );
    },
    [updateEdges],
  );

  const removeEdge = useCallback(
    (id: string) => {
      updateEdges((edges) => edges.filter((e) => e.id !== id));
      if (selectedEdgeId === id) setSelectedEdgeId(null);
    },
    [updateEdges, selectedEdgeId],
  );

  // Sync the React-Flow viewport when it changes from upstream — e.g.
  // a project load / switch swaps in a different LedSystem while the
  // LED tab is still mounted, and we want to land on that project's
  // saved pan/zoom. Local pans flow through `onMoveEnd` → `onChange`,
  // which keeps `system.viewport` byte-equal to the live RF viewport,
  // so this effect is a no-op on user drags (no fight, no flicker).
  const persistedVp = system.viewport;
  const lastSyncedVp = useRef<Viewport | null>(null);
  useEffect(() => {
    if (!persistedVp || !flowRef.current) return;
    const last = lastSyncedVp.current;
    if (
      last &&
      last.x === persistedVp.x &&
      last.y === persistedVp.y &&
      last.zoom === persistedVp.zoom
    ) {
      return;
    }
    flowRef.current.setViewport(persistedVp);
    lastSyncedVp.current = persistedVp;
  }, [persistedVp]);

  const selectedNode =
    selectedNodeId !== null
      ? (system.nodes.find((n) => n.id === selectedNodeId) ?? null)
      : null;
  const selectedEdge =
    selectedEdgeId !== null
      ? (system.edges.find((e) => e.id === selectedEdgeId) ?? null)
      : null;

  // ── Render ─────────────────────────────────────────────────────────

  return (
    <div
      className="led-system-designer-grid"
      style={{
        background: "#1C1C24",
        border: "1px solid #2F2F3A",
        borderRadius: 12,
        padding: 12,
        marginTop: 16,
      }}
    >
      {/* Canvas + toolbar */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
          minHeight: 540,
        }}
      >
        <Toolbar
          indoor={system.indoor}
          onToggleIndoor={(v) => onChange({ ...system, indoor: v })}
          onAdd={addNode}
          pendingEdgeKind={pendingEdgeKind}
          onPendingEdgeKindChange={setPendingEdgeKind}
        />
        <div
          style={{
            position: "relative",
            background: "#0F0F14",
            border: "1px solid #2F2F3A",
            borderRadius: 8,
            height: 600,
            overflow: "hidden",
          }}
        >
          <ReactFlow
            nodes={rfNodes}
            edges={rfEdges}
            nodeTypes={NODE_TYPES}
            edgeTypes={EDGE_TYPES}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onReconnect={onReconnect}
            onMoveEnd={onMoveEnd}
            onInit={(inst) => {
              flowRef.current = inst;
              if (system.viewport) inst.setViewport(system.viewport);
            }}
            onNodeClick={(_e, node) => {
              setSelectedNodeId(node.id);
              setSelectedEdgeId(null);
            }}
            onEdgeClick={(_e, edge) => {
              setSelectedEdgeId(edge.id);
              setSelectedNodeId(null);
            }}
            onPaneClick={() => {
              setSelectedNodeId(null);
              setSelectedEdgeId(null);
            }}
            snapToGrid
            snapGrid={[16, 16]}
            fitView={!system.viewport}
            fitViewOptions={{ padding: 0.3 }}
            proOptions={{ hideAttribution: true }}
            ariaLabelConfig={{
              "node.a11yDescription.default": t(
                "ledSystem.a11y.nodeDescription",
              ),
              "node.a11yDescription.keyboardDisabled": t(
                "ledSystem.a11y.nodeKeyboardDisabled",
              ),
              "node.a11yDescription.ariaLiveMessage": ({ direction, x, y }) =>
                t("ledSystem.a11y.nodeMoved", {
                  direction:
                    direction in DIRECTION_TRANSLATION_KEYS
                      ? t(
                          DIRECTION_TRANSLATION_KEYS[
                            direction as keyof typeof DIRECTION_TRANSLATION_KEYS
                          ],
                        )
                      : direction,
                  x,
                  y,
                }),
              "edge.a11yDescription.default": t(
                "ledSystem.a11y.edgeDescription",
              ),
              "controls.ariaLabel": t("ledSystem.a11y.controls"),
              "controls.zoomIn.ariaLabel": t("ledSystem.a11y.zoomIn"),
              "controls.zoomOut.ariaLabel": t("ledSystem.a11y.zoomOut"),
              "controls.fitView.ariaLabel": t("ledSystem.a11y.fitView"),
              "controls.interactive.ariaLabel": t(
                "ledSystem.a11y.toggleInteractivity",
              ),
              "minimap.ariaLabel": t("ledSystem.a11y.minimap"),
              "handle.ariaLabel": t("ledSystem.a11y.handle"),
            }}
          >
            <Background
              variant={BackgroundVariant.Dots}
              gap={16}
              size={1}
              color="#2F2F3A"
            />
            <Controls
              style={{
                background: "#25252F",
                border: "1px solid #2F2F3A",
                borderRadius: 6,
              }}
            />
            <MiniMap
              pannable
              zoomable
              style={{ background: "#25252F" }}
              nodeColor={(n) => {
                const kind = (n.data as NodeData | undefined)?.node.kind;
                return kind ? NODE_KIND_THEME[kind].accent : "#52525B";
              }}
              maskColor="rgba(0,0,0,0.55)"
            />
          </ReactFlow>
        </div>
      </div>

      {/* Right column: inspector + metrics */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 12,
          minWidth: 0,
        }}
      >
        {selectedNode ? (
          <NodeInspector
            node={selectedNode}
            screens={screens}
            onChange={(patch) => updateNode(selectedNode.id, patch)}
            onRemove={() => removeNode(selectedNode.id)}
          />
        ) : selectedEdge ? (
          <EdgeInspector
            edge={selectedEdge}
            onChange={(patch) => updateEdge(selectedEdge.id, patch)}
            onRemove={() => removeEdge(selectedEdge.id)}
          />
        ) : (
          <div style={panelStyle}>
            <div style={panelTitleStyle}>{t("ledSystem.inspector")}</div>
            <div style={{ color: "#A1A1AA", fontSize: 12 }}>
              {t("ledSystem.inspectorHelp")}
            </div>
          </div>
        )}
        <MetricsPanel metrics={metrics} system={system} />
      </div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────

const panelStyle: CSSProperties = {
  background: "#25252F",
  border: "1px solid #2F2F3A",
  borderRadius: 8,
  padding: 12,
  color: "#F4F4F5",
  fontSize: 12,
  fontFamily: "system-ui, sans-serif",
};
const panelTitleStyle: CSSProperties = {
  fontSize: 11,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "#A1A1AA",
  marginBottom: 8,
  fontWeight: 600,
};
const buttonStyle: CSSProperties = {
  background: "#1C1C24",
  color: "#F4F4F5",
  border: "1px solid #3F3F4A",
  borderRadius: 6,
  padding: "6px 10px",
  fontSize: 12,
  cursor: "pointer",
};
const buttonPrimary: CSSProperties = {
  ...buttonStyle,
  background: "#F88000",
  borderColor: "#F88000",
  color: "#0F0F14",
  fontWeight: 600,
};
const inputStyle: CSSProperties = {
  background: "#1C1C24",
  color: "#F4F4F5",
  border: "1px solid #3F3F4A",
  borderRadius: 6,
  padding: "6px 8px",
  fontSize: 12,
  width: "100%",
  boxSizing: "border-box",
};

function Toolbar({
  indoor,
  onToggleIndoor,
  onAdd,
  pendingEdgeKind,
  onPendingEdgeKindChange,
}: {
  indoor: boolean;
  onToggleIndoor: (v: boolean) => void;
  onAdd: (kind: LedSystemNodeKind) => void;
  pendingEdgeKind: LedSystemEdgeKind;
  onPendingEdgeKindChange: (k: LedSystemEdgeKind) => void;
}) {
  const t = useT();
  const nodeLabels = useMemo(
    () =>
      Object.fromEntries(
        (Object.keys(NODE_KIND_TRANSLATION_KEYS) as LedSystemNodeKind[]).map(
          (kind) => [kind, t(NODE_KIND_TRANSLATION_KEYS[kind])],
        ),
      ) as Record<LedSystemNodeKind, string>,
    [t],
  );
  const edgeLabels = useMemo(
    () =>
      Object.fromEntries(
        (Object.keys(EDGE_KIND_TRANSLATION_KEYS) as LedSystemEdgeKind[]).map(
          (kind) => [kind, t(EDGE_KIND_TRANSLATION_KEYS[kind])],
        ),
      ) as Record<LedSystemEdgeKind, string>,
    [t],
  );
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 8,
        background: "#25252F",
        border: "1px solid #2F2F3A",
        borderRadius: 8,
        padding: 8,
        alignItems: "center",
      }}
    >
      <span style={{ color: "#A1A1AA", fontSize: 11, marginRight: 4 }}>
        {t("ledSystem.add")}:
      </span>
      {(Object.keys(NODE_KIND_THEME) as LedSystemNodeKind[]).map((k) => (
        <button
          key={k}
          style={buttonStyle}
          onClick={() => onAdd(k)}
          title={t("ledSystem.addNew", { item: nodeLabels[k] })}
        >
          <span style={{ color: NODE_KIND_THEME[k].accent, marginRight: 4 }}>
            {NODE_KIND_THEME[k].emoji}
          </span>
          {nodeLabels[k]}
        </button>
      ))}
      <span
        style={{
          width: 1,
          height: 20,
          background: "#3F3F4A",
          margin: "0 4px",
        }}
      />
      <span style={{ color: "#A1A1AA", fontSize: 11, marginRight: 4 }}>
        {t("ledSystem.newCable")}:
      </span>
      {(Object.keys(EDGE_KIND_THEME) as LedSystemEdgeKind[]).map((k) => (
        <button
          key={k}
          style={{
            ...buttonStyle,
            borderColor:
              pendingEdgeKind === k ? EDGE_KIND_THEME[k].color : "#3F3F4A",
            color:
              pendingEdgeKind === k ? EDGE_KIND_THEME[k].color : "#F4F4F5",
          }}
          onClick={() => onPendingEdgeKindChange(k)}
        >
          {edgeLabels[k]}
        </button>
      ))}
      <span style={{ flex: 1 }} />
      <label
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          color: "#F4F4F5",
          fontSize: 12,
        }}
      >
        <input
          type="checkbox"
          checked={indoor}
          onChange={(e) => onToggleIndoor(e.target.checked)}
        />
        {t("ledSystem.indoorInstall")}
      </label>
    </div>
  );
}

function NodeInspector({
  node,
  screens,
  onChange,
  onRemove,
}: {
  node: LedSystemNode;
  screens: LedScreen[];
  onChange: (patch: Partial<LedSystemNode>) => void;
  onRemove: () => void;
}) {
  const t = useT();
  return (
    <div style={panelStyle}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 8,
        }}
      >
        <div style={{ ...panelTitleStyle, marginBottom: 0, flex: 1 }}>
          {t(NODE_KIND_TRANSLATION_KEYS[node.kind])}
        </div>
        <button
          style={{ ...buttonStyle, color: "#EF4444", borderColor: "#7F1D1D" }}
          onClick={onRemove}
        >
          {t("ledSystem.delete")}
        </button>
      </div>
      <Field label={t("ledSystem.label")}>
        <input
          style={inputStyle}
          value={node.label}
          onChange={(e) => onChange({ label: e.target.value })}
        />
      </Field>
      {node.kind === "screen" && (
        <>
          <Field label={t("ledSystem.linkScreen")}>
            <select
              style={inputStyle}
              value={node.screenRefId ?? ""}
              onChange={(e) =>
                onChange({ screenRefId: e.target.value || null })
              }
            >
              <option value="">{t("ledSystem.standalone")}</option>
              {screens.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name ||
                    t("ledSystem.screenFallback", { id: s.id.slice(0, 6) })}
                </option>
              ))}
            </select>
          </Field>
          {!node.screenRefId && (
            <div
              style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}
            >
              <Field label={t("ledSystem.pixelsW")}>
                <input
                  style={inputStyle}
                  type="number"
                  min={0}
                  value={node.pixelsW ?? 0}
                  onChange={(e) =>
                    onChange({ pixelsW: Number(e.target.value) || 0 })
                  }
                />
              </Field>
              <Field label={t("ledSystem.pixelsH")}>
                <input
                  style={inputStyle}
                  type="number"
                  min={0}
                  value={node.pixelsH ?? 0}
                  onChange={(e) =>
                    onChange({ pixelsH: Number(e.target.value) || 0 })
                  }
                />
              </Field>
            </div>
          )}
        </>
      )}
      {node.kind === "processor" && (
        <>
          <Field label={t("ledSystem.model")}>
            <select
              style={inputStyle}
              value={node.processorModel ?? ""}
              onChange={(e) =>
                onChange({
                  processorModel:
                    (e.target.value as NovastarProcessorModel) || null,
                })
              }
            >
              <option value="">{t("ledSystem.otherGeneric")}</option>
              {NOVASTAR_PROCESSOR_OPTIONS.map((o) => (
                <option key={o.model} value={o.model}>
                  {o.name}
                </option>
              ))}
            </select>
          </Field>
          <label
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              color: "#F4F4F5",
              fontSize: 12,
              marginBottom: 8,
            }}
          >
            <input
              type="checkbox"
              checked={!!node.isBackup}
              onChange={(e) => onChange({ isBackup: e.target.checked })}
            />
            {t("ledSystem.hotSpare")}
          </label>
        </>
      )}
      {node.kind === "psu" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <Field label={t("ledSystem.amps")}>
            <input
              style={inputStyle}
              type="number"
              min={0}
              value={node.psuAmps ?? 0}
              onChange={(e) =>
                onChange({ psuAmps: Number(e.target.value) || 0 })
              }
            />
          </Field>
          <Field label={t("ledSystem.phases")}>
            <select
              style={inputStyle}
              value={node.psuPhases ?? 1}
              onChange={(e) =>
                onChange({
                  psuPhases: Number(e.target.value) === 3 ? 3 : 1,
                })
              }
            >
              <option value={1}>{t("ledSystem.onePhase")}</option>
              <option value={3}>{t("ledSystem.threePhase")}</option>
            </select>
          </Field>
        </div>
      )}
      <Field label={t("ledSystem.notes")}>
        <textarea
          style={{ ...inputStyle, minHeight: 60, resize: "vertical" }}
          value={node.notes ?? ""}
          onChange={(e) => onChange({ notes: e.target.value })}
        />
      </Field>
    </div>
  );
}

function EdgeInspector({
  edge,
  onChange,
  onRemove,
}: {
  edge: LedSystemEdge;
  onChange: (patch: Partial<LedSystemEdge>) => void;
  onRemove: () => void;
}) {
  const t = useT();
  return (
    <div style={panelStyle}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 8,
        }}
      >
        <div style={{ ...panelTitleStyle, marginBottom: 0, flex: 1 }}>
          {t("ledSystem.cable")} · {t(EDGE_KIND_TRANSLATION_KEYS[edge.kind])}
        </div>
        <button
          style={{ ...buttonStyle, color: "#EF4444", borderColor: "#7F1D1D" }}
          onClick={onRemove}
        >
          {t("ledSystem.delete")}
        </button>
      </div>
      <Field label={t("ledSystem.cableType")}>
        <select
          style={inputStyle}
          value={edge.kind}
          onChange={(e) =>
            onChange({ kind: e.target.value as LedSystemEdgeKind })
          }
        >
          {(Object.keys(EDGE_KIND_THEME) as LedSystemEdgeKind[]).map((k) => (
            <option key={k} value={k}>
              {t(EDGE_KIND_TRANSLATION_KEYS[k])}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t("ledSystem.distance")}>
        <input
          style={inputStyle}
          type="number"
          min={0}
          step={1}
          value={edge.distanceM}
          onChange={(e) =>
            onChange({ distanceM: Math.max(0, Number(e.target.value) || 0) })
          }
        />
      </Field>
      <Field label={t("ledSystem.labelOptional")}>
        <input
          style={inputStyle}
          value={edge.label ?? ""}
          onChange={(e) =>
            onChange({ label: e.target.value || undefined })
          }
        />
      </Field>
    </div>
  );
}

function MetricsPanel({
  metrics,
  system,
}: {
  metrics: ReturnType<typeof computeLedSystemMetrics>;
  system: LedSystem;
}) {
  const t = useT();
  const warningMessages = useMemo(
    () =>
      metrics.warnings.map((warning) => {
        const edge = warning.edgeId
          ? system.edges.find((candidate) => candidate.id === warning.edgeId)
          : undefined;
        const node = warning.nodeId
          ? system.nodes.find((candidate) => candidate.id === warning.nodeId)
          : undefined;
        const processor = warning.nodeId
          ? metrics.processors.find(
              (candidate) => candidate.nodeId === warning.nodeId,
            )
          : undefined;
        const limits = system.cableLimits ?? {
          catMaxM: 90,
          fiberMaxM: 300,
          cvtPorts: 10,
        };
        if (warning.id.endsWith("-cat") && edge) {
          return t("ledSystem.warning.signalDistance", {
            distance: edge.distanceM,
            limit: limits.catMaxM,
          });
        }
        if (warning.id.endsWith("-fiber") && edge) {
          return t("ledSystem.warning.fiberDistance", {
            distance: edge.distanceM,
            limit: limits.fiberMaxM,
          });
        }
        if (warning.id.endsWith("-fanout") && node) {
          const fanout = system.edges.filter(
            (candidate) => {
              if (
                candidate.kind !== "signal" ||
                (candidate.source !== node.id && candidate.target !== node.id)
              ) {
                return false;
              }
              const otherId =
                candidate.source === node.id
                  ? candidate.target
                  : candidate.source;
              return system.nodes.some(
                (candidateNode) =>
                  candidateNode.id === otherId &&
                  candidateNode.kind === "screen",
              );
            },
          ).length;
          return t("ledSystem.warning.fanout", {
            label: node.label,
            count: fanout,
            limit: limits.cvtPorts,
          });
        }
        if (warning.id.endsWith("-ports") && processor) {
          return t("ledSystem.warning.ports", {
            label: processor.label,
            used: processor.portsUsed,
            capacity: processor.portCapacity ?? 0,
          });
        }
        if (warning.id.endsWith("-px") && processor) {
          return t("ledSystem.warning.pixels", {
            label: processor.label,
            used: processor.pixelsUsed.toLocaleString(),
            capacity: (processor.pixelCapacity ?? 0).toLocaleString(),
          });
        }
        if (warning.id.endsWith("-px-near") && processor) {
          return t("ledSystem.warning.pixelsNear", {
            label: processor.label,
            percent: Math.round(
              (processor.pixelsUsed / (processor.pixelCapacity ?? 1)) * 100,
            ),
          });
        }
        if (warning.id.endsWith("-orphan") && node) {
          return t("ledSystem.warning.noFeed", { label: node.label });
        }
        return t("ledSystem.warning.generic");
      }),
    [metrics.processors, metrics.warnings, system, t],
  );
  return (
    <div style={panelStyle}>
      <div style={panelTitleStyle}>{t("ledSystem.overview")}</div>
      <Stat label={t("ledSystem.screens")} value={metrics.counts.screens} />
      <Stat
        label={t("ledSystem.processors")}
        value={`${metrics.counts.processors}${
          metrics.counts.backupProcessors > 0
            ? ` ${t("ledSystem.backupCount", {
                count: metrics.counts.backupProcessors,
              })}`
            : ""
        }`}
      />
      <Stat label={t("ledSystem.fiberBoxes")} value={metrics.counts.fiberBoxes} />
      <Stat label={t("ledSystem.powerSupplies")} value={metrics.counts.psus} />
      <Stat
        label={t("ledSystem.totalPixels")}
        value={
          metrics.pixelsTotal > 0
            ? metrics.pixelsTotal.toLocaleString()
            : "—"
        }
      />
      <Stat
        label={t("ledSystem.totalPower")}
        value={metrics.psuKw > 0 ? `${metrics.psuKw.toFixed(1)} kW` : "—"}
      />
      <div style={{ ...panelTitleStyle, marginTop: 14 }}>
        {t("ledSystem.cabling")}
      </div>
      <Stat
        label={t("ledSystem.cableRuns", {
          kind: t("ledSystem.edge.signalShort"),
          count: metrics.cables.signalCount,
        })}
        value={`${metrics.cables.signalM} m`}
        accent={EDGE_KIND_THEME.signal.color}
      />
      <Stat
        label={t("ledSystem.cableRuns", {
          kind: t("ledSystem.edge.fiber"),
          count: metrics.cables.fiberCount,
        })}
        value={`${metrics.cables.fiberM} m`}
        accent={EDGE_KIND_THEME.fiber.color}
      />
      <Stat
        label={t("ledSystem.cableRuns", {
          kind: t("ledSystem.edge.power"),
          count: metrics.cables.powerCount,
        })}
        value={`${metrics.cables.powerM} m`}
        accent={EDGE_KIND_THEME.power.color}
      />
      <Stat
        label={t("ledSystem.totalCable")}
        value={`${metrics.cables.totalM} m`}
      />

      {metrics.processors.length > 0 && (
        <>
          <div style={{ ...panelTitleStyle, marginTop: 14 }}>
            {t("ledSystem.processorCapacity")}
          </div>
          {metrics.processors.map((p) => (
            <ProcessorRow key={p.nodeId} p={p} />
          ))}
        </>
      )}

      {metrics.warnings.length > 0 && (
        <>
          <div style={{ ...panelTitleStyle, marginTop: 14, color: "#EF4444" }}>
            {t("ledSystem.warnings", { count: metrics.warnings.length })}
          </div>
          <ul style={{ margin: 0, paddingLeft: 16, color: "#FCA5A5" }}>
            {metrics.warnings.map((w, index) => (
              <li
                key={w.id}
                style={{
                  fontSize: 11,
                  marginBottom: 4,
                  color: w.level === "danger" ? "#FCA5A5" : "#FCD34D",
                }}
              >
                {warningMessages[index]}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function ProcessorRow({
  p,
}: {
  p: ReturnType<typeof computeLedSystemMetrics>["processors"][number];
}) {
  const t = useT();
  const portPct =
    p.portCapacity && p.portCapacity > 0
      ? Math.min(100, (p.portsUsed / p.portCapacity) * 100)
      : 0;
  const pxPct =
    p.pixelCapacity && p.pixelCapacity > 0
      ? Math.min(100, (p.pixelsUsed / p.pixelCapacity) * 100)
      : 0;
  return (
    <div
      style={{
        background: "#1C1C24",
        border: "1px solid #2F2F3A",
        borderRadius: 6,
        padding: 8,
        marginBottom: 6,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginBottom: 4,
        }}
      >
        <span style={{ fontWeight: 600, color: "#F4F4F5" }}>
          {p.label}
          {p.isBackup && (
            <span
              style={{
                marginLeft: 6,
                fontSize: 10,
                color: "#A1A1AA",
                fontWeight: 400,
              }}
            >
              {t("ledSystem.backupLower")}
            </span>
          )}
        </span>
      </div>
      {p.portCapacity !== null && (
        <Bar
          label={t("ledSystem.portsCapacity", {
            used: p.portsUsed,
            capacity: p.portCapacity,
          })}
          pct={portPct}
          accent="#F88000"
        />
      )}
      {p.pixelCapacity !== null && (
        <Bar
          label={t("ledSystem.pixelsCapacity", {
            used: p.pixelsUsed.toLocaleString(),
            capacity: p.pixelCapacity.toLocaleString(),
          })}
          pct={pxPct}
          accent="#3B82F6"
        />
      )}
      {p.portCapacity === null && p.pixelCapacity === null && (
        <div style={{ color: "#A1A1AA", fontSize: 11 }}>
          {t("ledSystem.genericNoCapacity")}
        </div>
      )}
    </div>
  );
}

function Bar({
  label,
  pct,
  accent,
}: {
  label: string;
  pct: number;
  accent: string;
}) {
  return (
    <div style={{ marginTop: 2 }}>
      <div
        style={{
          fontSize: 10,
          color: "#A1A1AA",
          marginBottom: 2,
          display: "flex",
          justifyContent: "space-between",
        }}
      >
        <span>{label}</span>
        <span>{Math.round(pct)} %</span>
      </div>
      <div
        style={{
          background: "#2F2F3A",
          borderRadius: 3,
          height: 4,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            background: pct > 95 ? "#EF4444" : pct > 80 ? "#FCD34D" : accent,
            height: "100%",
          }}
        />
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string | number;
  accent?: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        padding: "4px 0",
        borderBottom: "1px dashed #2F2F3A",
        fontSize: 12,
      }}
    >
      <span style={{ color: "#A1A1AA" }}>
        {accent && (
          <span
            style={{
              display: "inline-block",
              width: 8,
              height: 8,
              borderRadius: 2,
              background: accent,
              marginRight: 6,
            }}
          />
        )}
        {label}
      </span>
      <span style={{ color: "#F4F4F5", fontWeight: 500 }}>{value}</span>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div
        style={{
          fontSize: 10,
          color: "#A1A1AA",
          marginBottom: 3,
          textTransform: "uppercase",
          letterSpacing: "0.05em",
        }}
      >
        {label}
      </div>
      {children}
    </div>
  );
}
