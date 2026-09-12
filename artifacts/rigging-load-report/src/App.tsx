import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth, useClerk, useUser } from "@clerk/react";
import { Link, useLocation } from "wouter";
import { toast } from "sonner";
import { briefDeliveryToast } from "./lib/briefDeliveryToast";
import "./index.css";
import ehsLogo from "./assets/ehs-logo.png";
import { AppShell, type ShellView, type ShellAction } from "./components/AppShell";
import {
  OverviewView,
  type OverviewKpi,
  type OverviewCrewRow,
  type OverviewSystemCard,
  type OverviewActivityItem,
} from "./components/OverviewView";
import {
  Bell as ShellBell,
  Download as ShellDownload,
  FileText as ShellFileText,
  HelpCircle as ShellHelpCircle,
  PlayCircle as ShellPlayCircle,
  RotateCcw as ShellRotateCcw,
  Share2 as ShellShare2,
  FileDown as ShellFileDown,
} from "lucide-react";
import {
  CUSTOM_LED_PANEL,
  CUSTOM_PANEL_KEY,
  DEFAULT_LED_SETTINGS,
  LED_PANEL_COLOR_PRESETS,
  LED_SCREEN_COLORS,
  buildLedPanels,
  computeLedTotals,
  defaultLinkedLedMeta,
  defaultPanelKeyOf,
  findPanelKeyForInventoryName,
  getLedPanel,
  resolveScreenPanel,
  migrateLedPanelKey,
  newLedScreen,
  normalizeLedSettings,
  enabledPanelCount,
  computeScreenMetrics,
  computeScreenCableBOM,
  computeScreenProcessorCapacity,
  LED_SHAPE_TEMPLATE_OPTIONS,
  NOVASTAR_PROCESSOR_CATALOG,
  type LedCustomPanel,
  type LedLinkedMeta,
  type LedScreen,
  type LedSettings,
} from "./lib/led";
import { findProcessor } from "./lib/ledProcessors";
import { NumberField } from "./components/NumberField";
import { ShareBriefModal } from "./components/ShareBriefModal";
import { HelpModal } from "./components/HelpModal";
import { ProjectListModal } from "./components/ProjectListModal";
import { GlobalShell, type GlobalView } from "./components/global/GlobalShell";
import { HomeDashboard, type DashboardStats } from "./components/global/HomeDashboard";
import { ProjectsDatabasePage } from "./components/global/ProjectsDatabasePage";
import { CrewDirectoryPage } from "./components/global/CrewDirectoryPage";
import { MasterCalendarPage } from "./components/global/MasterCalendarPage";
import { GlobalTaskBoard } from "./components/global/GlobalTaskBoard";
import { TransportDashboard } from "./components/global/TransportDashboard";
import { EconomyDashboard } from "./components/global/EconomyDashboard";
import { VenuesDatabasePage } from "./components/global/VenuesDatabasePage";
import { ClientsDatabasePage } from "./components/global/ClientsDatabasePage";
import { SettingsPage } from "./components/global/SettingsPage";
import { DeleteProjectDialog } from "./components/DeleteProjectDialog";
import { ProjectStatusDialog } from "./components/ProjectStatusDialog";
import { FolderOpen as ShellFolderOpen, Copy as ShellCopy, Trash2 as ShellTrash2 } from "lucide-react";
import { useI18n } from "./lib/i18n/I18nContext";
import { buildBrief, type BuildBriefInput } from "./lib/projectBrief";
import {
  projectIdentityPayload,
  resolveProjectName,
} from "./lib/projectIdentity";
import type { CrewRequestStatus } from "./lib/crew";
import {
  getNextProjectStatus,
  normalizeProjectStatus,
  type ProjectStatus,
} from "./lib/projectStatus";
import { useAdminAccess } from "./hooks/use-admin-access";
import {
  exportScreenAsPng,
  getLogoDataUrl,
  isLedExportError,
  renderScreenPngBlob,
} from "./lib/ledExport";
import { LedScreenReportView } from "./components/LedScreenReportView";
import {
  EMPTY_LED_SYSTEM,
  normalizeLedSystem,
  type LedSystem,
} from "./lib/ledSystem";
import {
  computeStage,
  computeStageTotals,
  type Stage,
  makeDefaultStage,
  normalizeStage,
} from "./lib/stage";
import { buildStageReportHtml } from "./lib/stageExport";
import { downloadHtmlAsPdf, pdfFilename } from "./lib/htmlToPdf";
import { exportPowerPlanToCrew } from "./lib/powerPlanExport";
import {
  exportClientPack,
  type ClientPackSchedulePhase,
  type ClientPackSystem,
} from "./lib/clientPackExport";
import {
  exportShowSimulation,
  type ShowSimulationInput,
} from "./lib/showSimulation";
import { StageReportView } from "./components/StageReportView";
import {
  makeCrewMember,
  expandProjectDays,
  pickScheduleTimesForDates,
  normalizeCrewMember,
  type CrewMember,
} from "./lib/crew";
import {
  assignedDatesFromShiftPhases,
  crewShiftAssignmentKey,
  filterShiftSelectionsToSchedule,
  firstShiftTimesFromWindows,
  scheduledShiftKeys,
  shiftWindowsForSelections,
  shiftTimesForSelections,
  summarizeShiftWindows,
  type CrewShiftPhaseKey,
  type CrewShiftTimeMap,
} from "./lib/crewShiftAssignments";
import { CrewReportView } from "./components/CrewReportView";
import type { FreelancerCandidate } from "./components/MasterCrewSheet";
import { subscribeCrewResponses } from "./lib/crewResponseEvents";
import { CateringView } from "./components/CateringView";
import { HotelView } from "./components/HotelView";
import { skillToCrewRole } from "./lib/skillToCrewRole";
import {
  makeSoundItem,
  normalizeSoundItem,
  type SoundItem,
} from "./lib/sound";
import { SoundReportView } from "./components/SoundReportView";
import { ProjectTaskBoard } from "./components/ProjectTaskBoard";
import { ProjectChat } from "./components/ProjectChat";
import { InspectionView, type InspectionData, EMPTY_INSPECTION } from "./components/InspectionView";
import { EquipmentPicker } from "./components/EquipmentPicker";
import type { LibraryItem } from "./lib/equipmentLibrary";
import {
  emptyFloorPlanLibrary,
  loadFloorPlanLibrary,
  saveFloorPlanLibrary,
  type FloorPlan,
  type FloorPlanLibrary,
} from "./lib/floorPlan";
import {
  applyPresetToDistro,
  computeDistroLoad,
  defaultPowerPlan,
  DISTRO_PRESETS,
  makeDistro,
  makeDrop,
  makeFixtureWattsLookup,
  makePowerCircuit,
  makePowerItem,
  normalizePowerPlan,
  type Channel,
  type ChannelMapping,
  type Distro,
  type DistroPresetId,
  type DistroSuggestion,
  type Drop,
  type DropCableKind,
  type PowerCircuit,
  type PowerItem,
  type PowerPhase,
  type PowerPlan,
  type SuggestedDistro,
} from "./lib/power";
import { PowerPlanView } from "./components/PowerPlanView";
import {
  clampTrussToVenue,
  DEFAULT_RIGG_PLAN,
  makeDefaultVenue,
  normalizeRiggPlan,
  type RiggPlan,
  type RiggPlanTruss,
  type RiggPlanVenue,
} from "./lib/riggPlan";
import {
  RiggPlanView,
  type RiggPlanSystemInfo,
} from "./components/RiggPlanView";
import { emptyApplySummary } from "./lib/drawingAnalysis";
import type {
  ApplySelection,
  ApplySummary,
  ExtractedItems,
} from "./lib/drawingAnalysis";

type DmxMode = {
  name: string;
  channels: number;
};

type InventoryItem = {
  name: string;
  weight: number;
  wattage: number;
  area: number;
  /** Optional list of factory DMX modes for this fixture. Sourced from
   *  manufacturer documentation. The first entry is treated as the default
   *  when the fixture is first linked into the Lighting Plan. */
  dmxModes?: DmxMode[];
  /** LED panel pixel/physical dimensions. When all four are set, this
   *  inventory item appears as a panel option on the LED Screen Report. */
  pixelWidth?: number;
  pixelHeight?: number;
  physicalWidth?: number;
  physicalHeight?: number;
  /** Manufacturer bracket / hang-bar name for an LED cabinet. When
   *  set, the Cable & bracket BOM shows this name × cabinet count
   *  instead of the placeholder. */
  bracketName?: string;
};

type Category = "Truss" | "Fixtures" | "LED Screen";

const inventory: Record<Category, InventoryItem[]> = {
  Truss: [
    { name: "Eurotruss FD34 - 3.0m (18.1kg)", weight: 18.1, wattage: 0, area: 0 },
    { name: "Eurotruss FD34 - 2.0m (12.5kg)", weight: 12.5, wattage: 0, area: 0 },
    { name: "Eurotruss FD34 - 1.0m (6.9kg)", weight: 6.9, wattage: 0, area: 0 },
    { name: "Eurotruss FD34 - 0.5m (4.5kg)", weight: 4.5, wattage: 0, area: 0 },
    { name: "Eurotruss FD34 - 0.25m (3.2kg)", weight: 3.2, wattage: 0, area: 0 },
    { name: "Eurotruss HD34 - 3.0m (21.4kg)", weight: 21.4, wattage: 0, area: 0 },
    { name: "Eurotruss HD34 - 2.0m (14.7kg)", weight: 14.7, wattage: 0, area: 0 },
    { name: "Eurotruss HD34 - 1.0m (8.1kg)", weight: 8.1, wattage: 0, area: 0 },
    { name: "Eurotruss HD34 - 0.5m (5.1kg)", weight: 5.1, wattage: 0, area: 0 },
    { name: "Eurotruss HD34 - 0.25m (3.8kg)", weight: 3.8, wattage: 0, area: 0 },
    { name: "Eurotruss FD32 - 4.0m (15.5kg)", weight: 15.5, wattage: 0, area: 0 },
    { name: "Eurotruss FD32 - 3.0m (11.8kg)", weight: 11.8, wattage: 0, area: 0 },
    { name: "Eurotruss FD32 - 2.0m (8.3kg)", weight: 8.3, wattage: 0, area: 0 },
    { name: "Eurotruss FD32 - 1.0m (4.7kg)", weight: 4.7, wattage: 0, area: 0 },
    { name: "Eurotruss FD32 - 0.5m (3.1kg)", weight: 3.1, wattage: 0, area: 0 },
  ],
  Fixtures: [
    {
      name: "Clay Paky Mythos 2 (32.0kg)",
      weight: 32.0,
      wattage: 800,
      area: 0,
      dmxModes: [
        { name: "Standard", channels: 30 },
        { name: "Vector / Extended", channels: 34 },
      ],
    },
    {
      name: "Elation DTW Blinder 350 IP (11.0kg)",
      weight: 11.0,
      wattage: 310,
      area: 0,
      dmxModes: [
        { name: "1 Channel", channels: 1 },
        { name: "2 Channel", channels: 2 },
        { name: "4 Channel", channels: 4 },
        { name: "Full / 9 Channel", channels: 9 },
      ],
    },
    {
      name: "Chauvet COLORado PXL Curve 12 (34.5kg)",
      weight: 34.5,
      wattage: 768,
      area: 0,
      dmxModes: [
        { name: "Single Control (20ch)", channels: 20 },
        { name: "Extended (53ch)", channels: 53 },
        { name: "Full Movement + Pixel (101ch)", channels: 101 },
        { name: "Per-Head Control (155ch)", channels: 155 },
        { name: "Max Pixel-Mapped (179ch)", channels: 179 },
      ],
    },
    {
      name: "Snow SnowPAR Pro Tri 18 (3.0kg)",
      weight: 3.0,
      wattage: 62,
      area: 0,
      dmxModes: [
        { name: "1 Channel", channels: 1 },
        { name: "3 Channel", channels: 3 },
        { name: "4 Channel", channels: 4 },
        { name: "6 Channel", channels: 6 },
      ],
    },
    { name: "Martin PowerPort 1500", weight: 0, wattage: 1100, area: 0 },
    {
      name: "MDG ATMe Haze",
      weight: 0,
      wattage: 715,
      area: 0,
      dmxModes: [{ name: "Standard", channels: 3 }],
    },
    {
      name: "Stage Fan / AF-1",
      weight: 0,
      wattage: 120,
      area: 0,
      dmxModes: [{ name: "Speed", channels: 1 }],
    },
    {
      name: "Astera Titan Tube (1.35kg)",
      weight: 1.35,
      wattage: 72,
      area: 0,
      dmxModes: [
        { name: "Single 5ch", channels: 5 },
        { name: "Single 8ch", channels: 8 },
        { name: "Single 11ch", channels: 11 },
        { name: "Pixel 16 (28ch)", channels: 28 },
      ],
    },
    {
      name: "Astera AX2 1m PixelBar (7.4kg)",
      weight: 7.4,
      wattage: 80,
      area: 0,
      dmxModes: [
        { name: "Single 5ch", channels: 5 },
        { name: "Single 8ch", channels: 8 },
        { name: "Single 11ch", channels: 11 },
        { name: "Pixel 16 (28ch)", channels: 28 },
      ],
    },
    {
      name: "Astera AX5 TriplePAR (3.4kg)",
      weight: 3.4,
      wattage: 45,
      area: 0,
      dmxModes: [
        { name: "Single 5ch", channels: 5 },
        { name: "Single 8ch", channels: 8 },
        { name: "Single 11ch", channels: 11 },
        { name: "Pixel 3 (15ch)", channels: 15 },
      ],
    },
    {
      name: "Astera AX9 PowerPar (5.66kg)",
      weight: 5.66,
      wattage: 110,
      area: 0,
      dmxModes: [
        { name: "Single 5ch", channels: 5 },
        { name: "Single 8ch", channels: 8 },
        { name: "Single 11ch", channels: 11 },
      ],
    },
    {
      name: "Astera Pixel Brick (1.12kg)",
      weight: 1.12,
      wattage: 20,
      area: 0,
      dmxModes: [
        { name: "Single 5ch", channels: 5 },
        { name: "Single 8ch", channels: 8 },
        { name: "Single 11ch", channels: 11 },
      ],
    },
    {
      name: "Martin MAC Aura (6.6kg)",
      weight: 6.6,
      wattage: 260,
      area: 0,
      dmxModes: [
        { name: "Standard", channels: 14 },
        { name: "Extended", channels: 25 },
      ],
    },
    {
      name: "Martin MAC Aura XB (7.5kg)",
      weight: 7.5,
      wattage: 260,
      area: 0,
      dmxModes: [
        { name: "Standard", channels: 14 },
        { name: "Extended", channels: 25 },
      ],
    },
    {
      name: "Martin MAC Aura XIP (10.0kg)",
      weight: 10.0,
      wattage: 340,
      area: 0,
      dmxModes: [
        { name: "Compact", channels: 20 },
        { name: "Basic", channels: 36 },
        { name: "Extended", channels: 57 },
        { name: "Ludicrous", channels: 93 },
        { name: "XB Standard", channels: 14 },
        { name: "XB Extended", channels: 25 },
      ],
    },
    {
      name: "Martin MAC Aura PXL (15.6kg)",
      weight: 15.6,
      wattage: 560,
      area: 0,
      dmxModes: [
        { name: "Compact", channels: 17 },
        { name: "Basic", channels: 32 },
        { name: "Extended", channels: 89 },
        { name: "Ludicrous", channels: 512 },
      ],
    },
    {
      name: "Martin MAC One (5.4kg)",
      weight: 5.4,
      wattage: 160,
      area: 0,
      dmxModes: [
        { name: "Compact", channels: 20 },
        { name: "Basic", channels: 36 },
        { name: "Ludicrous", channels: 108 },
        { name: "Compact Direct", channels: 20 },
      ],
    },
    {
      name: "Martin MAC Viper XIP (37.8kg)",
      weight: 37.8,
      wattage: 1040,
      area: 0,
      dmxModes: [
        { name: "Basic", channels: 54 },
        { name: "Extended", channels: 64 },
        { name: "Ludicrous", channels: 70 },
      ],
    },
    {
      name: "Martin MAC Viper AirFX (36.7kg)",
      weight: 36.7,
      wattage: 1225,
      area: 0,
      dmxModes: [
        { name: "Basic", channels: 20 },
        { name: "Extended", channels: 28 },
      ],
    },
    {
      name: "SnowARC Pro Quad 40 mkII (10.5kg)",
      weight: 10.5,
      wattage: 390,
      area: 0,
      dmxModes: [
        { name: "Snow only (1ch)", channels: 1 },
        { name: "Snow + RGBW (6ch)", channels: 6 },
      ],
    },
    {
      name: "DTS NICK NRG 1201 (12.9kg)",
      weight: 12.9,
      wattage: 340,
      area: 0,
      dmxModes: [{ name: "Standard", channels: 20 }],
    },
    {
      name: "Elation Pulse Panel FX (14.4kg)",
      weight: 14.4,
      wattage: 900,
      area: 0,
      dmxModes: [
        { name: "8 Channel", channels: 8 },
        { name: "16 Channel", channels: 16 },
        { name: "29 Channel", channels: 29 },
        { name: "52 Channel", channels: 52 },
        { name: "62 Channel", channels: 62 },
        { name: "65 Channel", channels: 65 },
      ],
    },
    {
      name: "Chauvet Color STRIKE M (13.1kg)",
      weight: 13.1,
      wattage: 740,
      area: 0,
      dmxModes: [
        { name: "8 Channel", channels: 8 },
        { name: "11 Channel", channels: 11 },
        { name: "13 Channel", channels: 13 },
        { name: "24 Channel", channels: 24 },
        { name: "30 Channel", channels: 30 },
        { name: "47 Channel", channels: 47 },
        { name: "74 Channel", channels: 74 },
        { name: "97 Channel", channels: 97 },
      ],
    },
    {
      name: "Martin RUSH MH 7 Hybrid (25.0kg)",
      weight: 25.0,
      wattage: 450,
      area: 0,
      dmxModes: [{ name: "Standard", channels: 21 }],
    },
  ],
  "LED Screen": [
    {
      // Uniview UR Pro — 500 × 1000 mm cabinet mounted in PORTRAIT
      // (0.5 m wide × 1.0 m tall). Cabinet-only weight per EHS spec.
      name: "Uniview UR Pro 0.5x1m (12.3kg)",
      weight: 12.3,
      wattage: 350,
      area: 0.5,
      pixelWidth: 128,
      pixelHeight: 256,
      physicalWidth: 0.5,
      physicalHeight: 1.0,
      bracketName: "Uniview UR Pro hanging bar",
    },
    {
      // Same 500 × 1000 mm cabinet plus its captive signal/power cable
      // loom (+0.275 kg). Use this row when totalling truck weight so
      // the cable contribution isn't lost in the BOM.
      name: "Uniview UR Pro 0.5x1m + cable (12.575kg)",
      weight: 12.575,
      wattage: 350,
      area: 0.5,
      pixelWidth: 128,
      pixelHeight: 256,
      physicalWidth: 0.5,
      physicalHeight: 1.0,
      bracketName: "Uniview UR Pro hanging bar",
    },
    {
      // 500 × 500 mm 90° corner cabinet — used to wrap a wall round a
      // pillar. Cabinet-only weight per EHS spec.
      name: "Uniview UR Pro 0.5x0.5m 90° (8.8kg)",
      weight: 8.8,
      wattage: 175,
      area: 0.25,
      pixelWidth: 128,
      pixelHeight: 128,
      physicalWidth: 0.5,
      physicalHeight: 0.5,
      bracketName: "Uniview UR Pro corner bracket",
    },
    {
      // Same 90° cabinet plus captive cable (+0.275 kg).
      name: "Uniview UR Pro 0.5x0.5m 90° + cable (9.075kg)",
      weight: 9.075,
      wattage: 175,
      area: 0.25,
      pixelWidth: 128,
      pixelHeight: 128,
      physicalWidth: 0.5,
      physicalHeight: 0.5,
      bracketName: "Uniview UR Pro corner bracket",
    },
    // ── LED rigging beams ──────────────────────────────────────────
    // Beams are deliberately left without pixel / physical metadata so
    // `buildLedPanels` skips them in the panel picker (they're not
    // pixel-carrying cabinets). They still flow through the rigging
    // weight / BOM the same way the Molton fabric rows do.
    { name: "Beam 1m hang/stack (10kg)", weight: 10, wattage: 0, area: 0 },
    { name: "Beam 0.5m (6kg)", weight: 6, wattage: 0, area: 0 },
    { name: "Beam 0.5m 90° (4.5kg)", weight: 4.5, wattage: 0, area: 0 },
    { name: "Molton 6x4m (7.2kg)", weight: 7.2, wattage: 0, area: 0 },
    { name: "Molton 9x6m (16.2kg)", weight: 16.2, wattage: 0, area: 0 },
    { name: "Molton 9x9m (24.3kg)", weight: 24.3, wattage: 0, area: 0 },
  ],
};

const distributionFactors: Record<number, number[]> = {
  2: [0.5, 0.5],
  3: [0.19, 0.62, 0.19],
  4: [0.13, 0.37, 0.37, 0.13],
  5: [0.1, 0.28, 0.24, 0.28, 0.1],
  6: [0.08, 0.23, 0.19, 0.19, 0.23, 0.08],
  7: [0.07, 0.19, 0.15, 0.18, 0.15, 0.19, 0.07],
  8: [0.06, 0.16, 0.14, 0.14, 0.14, 0.14, 0.16, 0.06],
};

type Hoist = {
  label: string;
  weight: number;
  watt: number;
  swl: number;
};

const hoistModels: Hoist[] = [
  { label: "EXE Rise D8+ 500kg (38.5kg | 0.8kW)", weight: 38.5, watt: 800, swl: 500 },
  { label: "EXE Rise D8+ 1000kg (69.6kg | 1.1kW)", weight: 69.6, watt: 1100, swl: 1000 },
];

/** Sentinel returned by `getHoist` when a system has no motor selected
 *  (`hoistIndex < 0`). All-zero weights/wattage/SWL means the motor
 *  contribution drops out of every calculation cleanly. UI code must
 *  treat `swl === 0` as "no SWL constraint" and skip overload checks
 *  rather than reporting a divide-by-zero or false-positive overload. */
const NO_HOIST: Hoist = { label: "None", weight: 0, watt: 0, swl: 0 };

/** Resolve a system's `hoistIndex` to a concrete `Hoist`. Returns the
 *  `NO_HOIST` sentinel when the user picked "None" in the Motor Type
 *  dropdown (`idx < 0`); otherwise returns the indexed model, falling
 *  back to the first hoist if the index is out of range so legacy /
 *  corrupt persisted data still renders something usable. */
function getHoist(idx: number): Hoist {
  if (idx < 0) return NO_HOIST;
  return hoistModels[idx] ?? hoistModels[0];
}

type Row = {
  id: string;
  category: Category | "Custom";
  selectedIndex: number;
  qty: number;
  custom?: InventoryItem;
};

type System = {
  id: string;
  name: string;
  pointCount: number;
  dynamicFactor: number;
  hoistIndex: number;
  riggingRows: Row[];
  fixtureRows: Row[];
  ledRows: Row[];
};

let idCounter = 0;
const newId = (prefix = "id") =>
  `${prefix}-${++idCounter}-${Math.random().toString(36).slice(2, 8)}`;

function makeRow(category: Category, qty = 1): Row {
  return { id: newId("row"), category, selectedIndex: 0, qty };
}

function makeCustomRow(targetCategory: Category, item: InventoryItem): Row {
  return {
    id: newId("row"),
    category: targetCategory,
    selectedIndex: -1,
    qty: 1,
    custom: item,
  };
}

function makeSystem(name: string): System {
  return {
    id: newId("sys"),
    name,
    pointCount: 3,
    dynamicFactor: 1.25,
    hoistIndex: 0,
    riggingRows: [makeRow("Truss", 4)],
    fixtureRows: [],
    ledRows: [],
  };
}

/** Create a system with no rows and no motor selected — used by the
 *  top-level Reset button so the user lands on a truly empty Rigging
 *  Report and isn't surprised to see a default truss row or a motor
 *  pre-picked. */
function makeEmptySystem(name: string): System {
  return {
    id: newId("sys"),
    name,
    pointCount: 3,
    dynamicFactor: 1.25,
    hoistIndex: -1,
    riggingRows: [],
    fixtureRows: [],
    ledRows: [],
  };
}

function getRowItem(row: Row): InventoryItem | undefined {
  if (row.custom) return row.custom;
  if (row.category === "Custom") return undefined;
  return inventory[row.category as Category][row.selectedIndex];
}

/** Strip "(weight)" parens, lowercase, and collapse non-alphanumerics
 *  to single spaces. Used so the analyser's "Clay Paky Mythos 2" can
 *  match the inventory's "Clay Paky Mythos 2 (32.0kg)". */
function normalizeFixtureName(s: string): string {
  return s
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Look up an analyser-extracted fixture name in `inventory.Fixtures`.
 *  Returns the matching index (≥ 0) or `-1` if no confident match.
 *
 *  Strategy: normalize both names, then prefer a direct substring
 *  match (either side) before falling back to a token-overlap score
 *  that requires ≥ 2 shared tokens AND ≥ 60 % of the inventory item's
 *  tokens to be present. The thresholds are intentionally conservative
 *  to avoid linking the wrong model on the Rigging Report — when in
 *  doubt we leave it as a Custom row carrying the analyser's data. */
function matchInventoryFixture(name: string): number {
  const target = normalizeFixtureName(name);
  if (!target) return -1;
  const targetTokens = target.split(/\s+/).filter((t) => t.length >= 2);
  if (targetTokens.length === 0) return -1;

  let bestIdx = -1;
  let bestScore = 0;
  inventory.Fixtures.forEach((item, idx) => {
    const itemNorm = normalizeFixtureName(item.name);
    if (!itemNorm) return;
    const itemTokens = itemNorm.split(/\s+/).filter((t) => t.length >= 2);
    if (itemTokens.length === 0) return;

    // Direct substring either way → strong match, BUT only when the
    // shorter side is specific enough to be unambiguous. We require
    // the analyser-extracted name to carry at least 2 meaningful
    // tokens AND the shorter side to be ≥ 6 characters; this stops
    // a single-token OCR fragment like "mac" from binding to the
    // first inventory item that happens to contain it.
    if (itemNorm.includes(target) || target.includes(itemNorm)) {
      const minLen = Math.min(itemNorm.length, target.length);
      if (targetTokens.length >= 2 && minLen >= 6) {
        const score = 100 + minLen;
        if (score > bestScore) {
          bestScore = score;
          bestIdx = idx;
        }
      }
      return;
    }

    // Token overlap — must share at least 2 tokens AND cover the
    // majority of the inventory item to count.
    const overlap = targetTokens.filter((t) =>
      itemTokens.includes(t),
    ).length;
    if (overlap >= 2 && overlap >= itemTokens.length * 0.6) {
      const score = overlap * 10;
      if (score > bestScore) {
        bestScore = score;
        bestIdx = idx;
      }
    }
  });

  return bestIdx;
}

const STORAGE_KEY_V2 = "ehs-rigging-report-v2";
const STORAGE_KEY_V1 = "ehs-rigging-report-v1";

type MainView =
  | "oversikt"
  | "rigging"
  | "lighting"
  | "led"
  | "stage"
  | "crew"
  | "catering"
  | "hotel"
  | "sound"
  | "riggPlan"
  | "inspection"
  | "tasks"
  | "chat";

const GLOBAL_VIEW_PATHS: Record<GlobalView, string> = {
  home: "/home",
  projects: "/projects",
  clients: "/clients",
  venues: "/venues",
  crew: "/crew",
  calendar: "/calendar",
  transport: "/transport",
  tasks: "/tasks",
  economy: "/economy",
  settings: "/settings",
};

function globalViewFromPath(path: string): GlobalView | null {
  const entry = (Object.entries(GLOBAL_VIEW_PATHS) as Array<[GlobalView, string]>)
    .find(([, candidate]) => path === candidate || path.startsWith(`${candidate}/`));
  return entry?.[0] ?? null;
}

function projectIdFromPath(path: string): string | null {
  const match = /^\/project\/([^/?#]+)\/?$/.exec(path);
  if (!match || match[1] === "new") return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

type ShowFixture = {
  id: string;
  name: string;
  qty: number;
  weight: number;
  watts: number;
  dmxChannels: number;
  beamAngle: number;
  systemId: string;
  position: number;
  circuit: string;
  universe: number;
  startAddress: number;
  notes: string;
  /** When true, base info (name/qty/weight/watts/systemId) comes from a
   *  rigging fixtureRow and is read-only on the lighting plan. */
  linked?: boolean;
  /** For linked rows, the source rigging Row id used for meta lookup. */
  sourceRowId?: string;
  /** Selected DMX mode index from the inventory item's dmxModes list, or
   *  null when the user has chosen "Custom..." and is entering channels
   *  manually. Only set on linked rows whose inventory item provides modes. */
  dmxModeIndex?: number | null;
  /** Available DMX modes for the underlying inventory item (linked rows). */
  availableDmxModes?: DmxMode[];
};

/** Lighting-plan-only fields layered on top of a rigging fixture row. */
type LinkedMeta = {
  dmxChannels: number;
  /** Selected mode index, or null if user picked "Custom..." (use stored
   *  dmxChannels). Index 0 is the default for items that have dmxModes. */
  dmxModeIndex?: number | null;
  beamAngle: number;
  position: number;
  circuit: string;
  universe: number;
  startAddress: number;
  notes: string;
};

function defaultLinkedMeta(): LinkedMeta {
  return {
    dmxChannels: 0,
    dmxModeIndex: 0,
    beamAngle: 0,
    position: 0,
    circuit: "",
    universe: 1,
    startAddress: 1,
    notes: "",
  };
}

function makeShowFixture(): ShowFixture {
  return {
    id: newId("fx"),
    name: "",
    qty: 1,
    weight: 0,
    watts: 0,
    dmxChannels: 0,
    beamAngle: 0,
    systemId: "",
    position: 0,
    circuit: "",
    universe: 1,
    startAddress: 1,
    notes: "",
  };
}

/** Phases of a production run. The "show" phase is implicitly stored in
 *  `reportDate`/`reportEndDate` for backwards compatibility — the other
 *  three live in `extraSchedule`. */
export type SchedulePhaseKey = "setup" | "rehearsal" | "show" | "downrig";

/** A single segment within a phase — one calendar date range plus an
 *  optional time-of-day range. A phase is an *array* of these so the
 *  producer can record multiple non-contiguous days for the same
 *  phase (e.g. Setup Mon + Wed, or Show Fri/Sat/Sun). Empty strings
 *  mean "not set". `fromTime` / `toTime` are HH:MM 24h strings
 *  (matching the value of <input type="time">). `timeTbd` explicitly
 *  marks a row whose time has not been decided yet. */
export type ScheduleSegment = {
  from: string;
  to: string;
  fromTime?: string;
  toTime?: string;
  timeTbd?: boolean;
};

/** Legacy single-segment shape kept as a type alias so existing
 *  downstream consumers that imported `SchedulePhase` continue to
 *  compile — the value lives inside a `ScheduleSegment[]` now. */
export type SchedulePhase = ScheduleSegment;

/** All schedule phases keyed by name → array of segments. Empty arrays
 *  / undefined entries mean "not set". The "show" entry only stores
 *  optional time-of-day fields and any *additional* show days here —
 *  the primary show calendar dates live in the separate `reportDate`
 *  / `reportEndDate` state for backwards compat with the V2
 *  persistence schema. */
export type ExtraSchedule = Partial<Record<SchedulePhaseKey, ScheduleSegment[]>>;

/** A combined schedule including the show phase, derived for downstream
 *  consumers (brief, exports, etc.). Each phase is an array of
 *  segments so multi-day projects are first-class. */
export type ProjectSchedule = Partial<Record<SchedulePhaseKey, ScheduleSegment[]>>;

export const SCHEDULE_PHASE_LABEL_KEYS: Record<SchedulePhaseKey, "schedule.phase.setup" | "schedule.phase.rehearsal" | "schedule.phase.show" | "schedule.phase.loadOut"> = {
  setup: "schedule.phase.setup",
  rehearsal: "schedule.phase.rehearsal",
  show: "schedule.phase.show",
  // Internal key stays "downrig" for backwards compatibility with
  // already-persisted localStorage data; the user-facing label is
  // "Load Out".
  downrig: "schedule.phase.loadOut",
};

/** Build a unified schedule from the show dates + the extra phases.
 *  Each phase becomes an array of one or more segments. The primary
 *  Show segment is synthesized from `reportDate`/`reportEndDate` (so
 *  the rest of the app's date inputs stay the source of truth) and
 *  any *additional* show days that the producer added in the popover
 *  are appended after it from `extra.show[1..]`. The first entry of
 *  `extra.show`, if present, contributes its `fromTime`/`toTime` to
 *  the primary Show segment.
 *
 *  Empty phase arrays are stripped so downstream consumers (brief,
 *  portal renderer, exports) can do `if (schedule.setup) …`. */
export function buildProjectSchedule(
  reportDate: string,
  reportEndDate: string,
  extra: ExtraSchedule,
): ProjectSchedule {
  const out: ProjectSchedule = {};
  (["setup", "rehearsal", "downrig"] as const).forEach((k) => {
    const arr = extra[k];
    if (arr && arr.length > 0) {
      const cleaned = arr.filter((s) => s.from || s.to);
      if (cleaned.length > 0) out[k] = cleaned;
    }
  });
  const showExtra = extra.show ?? [];
  // Primary show segment derives its dates from reportDate/reportEndDate;
  // its times come from the legacy show[0] storage slot.
  const primary: ScheduleSegment = {
    from: reportDate,
    to: reportEndDate || reportDate,
    fromTime: showExtra[0]?.fromTime,
    toTime: showExtra[0]?.toTime,
    timeTbd: showExtra[0]?.timeTbd,
  };
  const extraShowSegments = showExtra
    .slice(1)
    .filter((s) => s.from || s.to);
  const hasPrimary = !!reportDate || !!reportEndDate;
  const showSegs: ScheduleSegment[] = [];
  if (hasPrimary) showSegs.push(primary);
  showSegs.push(...extraShowSegments);
  if (showSegs.length > 0) out.show = showSegs;
  return out;
}

/**
 * The user's theme preference. "system" follows the OS / browser
 * `prefers-color-scheme` setting. Old saved states with "light" / "dark"
 * remain valid (back-compat); new users default to "system".
 */
type ThemePref = "light" | "dark" | "system";

type PersistedV2 = {
  theme: ThemePref;
  /** Human-readable project title. Optional for legacy saved states,
   *  where the previous combined venue field is used as the fallback. */
  projectName?: string;
  venue: string;
  venueId?: string | null;
  /** External Easyjob reference. Optional for backwards compatibility. */
  easyjobNumber?: string;
  /** Client / customer name. Optional — empty string when not yet set.
   *  Lives next to the venue in the project meta card and flows through
   *  to the Client Pack cover, the Show Simulation cover, and every
   *  Freelancer Portal brief / accepted Gig. */
  client?: string;
  clientId?: string | null;
  reportDate: string;
  /** Optional end date for the SHOW phase. Empty = single day.
   *  ISO date (YYYY-MM-DD). */
  reportEndDate?: string;
  /** Optional ranges for the other production phases — setup, rehearsal,
   *  downrig. The show phase is stored in reportDate/reportEndDate. */
  extraSchedule?: ExtraSchedule;
  engineer: string;
  /** Producer-authored free-text brief for the whole project. Captured on
   *  the Overview as a textarea next to project/client/schedule/PM and
   *  passed through to the Freelancer Portal brief as `project.description`
   *  so every freelancer sees the same context. Optional — empty string
   *  when not yet filled in. */
  briefDescription?: string;
  /** Client-side contact (name / phone / email — free text) so the crew
   *  on site knows who to ask for. Shared with the freelancer portal as
   *  `project.clientContact`. */
  clientContact?: string;
  systems: System[];
  activeSystemId: string;
  showFixtures?: ShowFixture[];
  mainView?: MainView;
  /** DMX/position overlays for fixtures linked from the rigging report,
   *  keyed by the source rigging Row id. */
  linkedMeta?: Record<string, LinkedMeta>;
  /** Manual (non-linked) LED screens added on the LED Screen Report tab. */
  ledScreens?: LedScreen[];
  /** Per-screen overlay (panel type, layout, output, color, notes) for LED
   *  screens linked from a rigging ledRow, keyed by source Row id. */
  ledLinkedMeta?: Record<string, LedLinkedMeta>;
  /** LED Screen Report settings (port limit, label visibility). */
  ledSettings?: LedSettings;
  /** LED System Designer — node-based system architecture (screens,
   *  processors, fiber boxes, PSUs, cables). v1 is purely producer-
   *  authored (no auto-population from ledScreens). */
  ledSystem?: LedSystem;
  /** Stage Report — list of stages (Nivtec deck calculator). */
  stages?: Stage[];
  /** Crew Report — call-sheet of crew members. */
  crew?: CrewMember[];
  /** Sound Report — audio inventory items. */
  soundItems?: SoundItem[];
  /** Lighting Report → Power Plan — circuits and per-phase items. */
  power?: PowerPlan;
  /** Rigg Plan — venue + per-system truss positions. */
  riggPlan?: RiggPlan;
  /** Server id of the project_briefs row backing this project's
   *  Crew Report request/accept loop. Created lazily on the first
   *  "Send requests" click and reused for every subsequent batch so
   *  all freelancers see the same brief in their portal and the
   *  producer's polling endpoint stays addressable across reloads. */
  activeBriefId?: string | null;
  /** Site inspection / befaring — free-form notes + AI-extracted
   *  structured data (equipment, schedule, technical, general). */
  inspection?: InspectionData;
};

/** Defensive read of arbitrary persisted JSON into a clean
 *  ExtraSchedule. Unknown keys / non-string fields are dropped so
 *  malformed localStorage cannot inject invalid date strings into
 *  the date-input UI. */
function sanitizeSegment(raw: unknown): ScheduleSegment | null {
  if (!raw || typeof raw !== "object") return null;
  const phObj = raw as Record<string, unknown>;
  const from = typeof phObj.from === "string" ? phObj.from : "";
  const to = typeof phObj.to === "string" ? phObj.to : "";
  const fromTime =
    typeof phObj.fromTime === "string" ? phObj.fromTime : undefined;
  const toTime =
    typeof phObj.toTime === "string" ? phObj.toTime : undefined;
  const timeTbd = phObj.timeTbd === true;
  if (!from && !to && !fromTime && !toTime && !timeTbd) return null;
  return { from, to, fromTime, toTime, timeTbd };
}

function sanitizeExtraSchedule(raw: unknown): ExtraSchedule {
  if (!raw || typeof raw !== "object") return {};
  const obj = raw as Record<string, unknown>;
  const out: ExtraSchedule = {};
  (["setup", "rehearsal", "show", "downrig"] as const).forEach((k) => {
    const ph = obj[k];
    if (!ph) return;
    // Legacy single-object shape → wrap into a one-element array so
    // already-persisted V2 data keeps working with the new multi-day
    // schema. Producers who never tap "Add Day" simply see that one
    // segment as before.
    if (Array.isArray(ph)) {
      const segs = ph
        .map(sanitizeSegment)
        .filter((s): s is ScheduleSegment => s !== null);
      if (segs.length > 0) out[k] = segs;
      return;
    }
    const seg = sanitizeSegment(ph);
    if (seg) out[k] = [seg];
  });
  return out;
}

function loadPersisted(): Partial<PersistedV2> | null {
  try {
    const rawV2 = localStorage.getItem(STORAGE_KEY_V2);
    if (rawV2) {
      const parsed = JSON.parse(rawV2) as Partial<PersistedV2>;
      // Sanitize the only field whose shape we care to harden — the
      // rest of PersistedV2 was already trusted before this change.
      return {
        ...parsed,
        extraSchedule: sanitizeExtraSchedule(parsed.extraSchedule),
      };
    }

    const rawV1 = localStorage.getItem(STORAGE_KEY_V1);
    if (rawV1) {
      const v1 = JSON.parse(rawV1);
      const sys: System = {
        id: newId("sys"),
        name: v1.systemName || "LX1",
        pointCount: v1.pointCount ?? 3,
        dynamicFactor: v1.dynamicFactor ?? 1.25,
        hoistIndex: v1.hoistIndex ?? 0,
        riggingRows: Array.isArray(v1.riggingRows)
          ? v1.riggingRows
          : [makeRow("Truss", 4)],
        fixtureRows: Array.isArray(v1.fixtureRows) ? v1.fixtureRows : [],
        ledRows: Array.isArray(v1.ledRows) ? v1.ledRows : [],
      };
      return {
        theme: v1.theme ?? "system",
        venue: v1.venue ?? "",
        reportDate: v1.reportDate ?? new Date().toISOString().slice(0, 10),
        engineer: v1.engineer ?? "",
        systems: [sys],
        activeSystemId: sys.id,
      };
    }
    return null;
  } catch {
    return null;
  }
}

type SystemMetrics = {
  payload: number;
  power: number;
  area: number;
  static: number;
  dynamic: number;
  motorPower: number;
  peak: number;
  swl: number;
  headroom: number;
  factors: number[];
  staticPointLoads: number[];
  dynamicPointLoads: number[];
  hoist: Hoist;
};

function computeMetrics(sys: System): SystemMetrics {
  let payload = 0,
    power = 0,
    area = 0;
  for (const row of [...sys.riggingRows, ...sys.fixtureRows, ...sys.ledRows]) {
    const item = getRowItem(row);
    if (!item) continue;
    payload += item.weight * row.qty;
    power += item.wattage * row.qty;
    area += item.area * row.qty;
  }
  const hoist = getHoist(sys.hoistIndex);
  const motorPower = hoist.watt * sys.pointCount;
  const staticTotal = payload + sys.pointCount * hoist.weight;
  const dynamicTotal = staticTotal * sys.dynamicFactor;
  const factors = distributionFactors[sys.pointCount] ?? [];
  const staticPointLoads = factors.map((f) => staticTotal * f);
  const dynamicPointLoads = factors.map((f) => dynamicTotal * f);
  const peak = dynamicPointLoads.length ? Math.max(...dynamicPointLoads) : 0;
  return {
    payload,
    power,
    area,
    static: staticTotal,
    dynamic: dynamicTotal,
    motorPower,
    peak,
    swl: hoist.swl,
    headroom: hoist.swl - peak,
    factors,
    staticPointLoads,
    dynamicPointLoads,
    hoist,
  };
}

function SignOutButton() {
  const { signOut } = useClerk();
  const { user } = useUser();
  const { t: tr } = useI18n();
  const label =
    user?.primaryEmailAddress?.emailAddress ??
    user?.username ??
    user?.firstName ??
    tr("account.default");
  const handleSignOut = () => {
    try {
      sessionStorage.setItem("ehs-skip-dev-auto-signin", "1");
      sessionStorage.removeItem("ehs-login-intent");
      sessionStorage.removeItem("ehs-auth-mode");
    } catch {
      /* sessionStorage may be unavailable */
    }
    try {
      localStorage.removeItem("ehs-user-role");
    } catch {
      /* localStorage may be unavailable */
    }
    void signOut();
  };
  return (
    <>
      <span className="header-user-email" title={tr("account.signedInAs", { label })}>
        {label}
      </span>
      <button
        type="button"
        className="header-icon-btn header-signout-btn"
        onClick={handleSignOut}
        title={tr("account.signOutWithLabel", { label })}
        aria-label={tr("global.menu.signOut")}
      >
        {/* Lucide-style "log-out" glyph: door + arrow leaving. */}
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
          <polyline points="16 17 21 12 16 7" />
          <line x1="21" y1="12" x2="9" y2="12" />
        </svg>
      </button>
    </>
  );
}

/**
 * Three-way theme picker shown in the top-right of the dashboard header.
 * Lets the user choose Light, Dark, or System (follow OS `prefers-color-scheme`).
 *
 * Implements the ARIA radiogroup keyboard pattern: only the selected radio is
 * in the tab order (`tabIndex=0`); ArrowLeft/Right (and Home/End) move focus
 * AND change the selection.
 */
function ThemeSegmentedControl({
  pref,
  onChange,
}: {
  pref: ThemePref;
  onChange: (next: ThemePref) => void;
}) {
  const { t: tr } = useI18n();
  const options = useMemo<
    ReadonlyArray<{ value: ThemePref; label: string; icon: string }>
  >(
    () => [
      { value: "light", label: tr("theme.light"), icon: "☀" },
      { value: "dark", label: tr("theme.dark"), icon: "☾" },
      { value: "system", label: tr("theme.system"), icon: "⌬" },
    ],
    [tr],
  );
  const btnRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedIndex = Math.max(
    0,
    options.findIndex((o) => o.value === pref),
  );
  const move = (next: number) => {
    const i = ((next % options.length) + options.length) % options.length;
    onChange(options[i].value);
    btnRefs.current[i]?.focus();
  };
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
        e.preventDefault();
        move(selectedIndex + 1);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        e.preventDefault();
        move(selectedIndex - 1);
        break;
      case "Home":
        e.preventDefault();
        move(0);
        break;
      case "End":
        e.preventDefault();
        move(options.length - 1);
        break;
      default:
        break;
    }
  };
  return (
    <div
      role="radiogroup"
      aria-label={tr("theme.label")}
      className="theme-seg"
      title={tr("theme.title")}
      onKeyDown={onKeyDown}
    >
      {options.map((o, i) => {
        const selected = pref === o.value;
        return (
          <button
            key={o.value}
            ref={(el) => {
              btnRefs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={tr(`theme.${o.value}Aria`)}
            tabIndex={selected ? 0 : -1}
            className={`theme-seg-btn${selected ? " is-selected" : ""}`}
            onClick={() => onChange(o.value)}
          >
            <span aria-hidden>{o.icon}</span>
            <span className="theme-seg-label">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function App() {
  const { getToken } = useAuth();
  const canPermanentlyDeleteProjects = useAdminAccess(getToken);
  const [location, navigate] = useLocation();
  const persisted = useRef<Partial<PersistedV2> | null>(loadPersisted()).current;
  const initialSystem = makeSystem("LX1");
  // Aliased to `tr` because this file already uses `t` as a local variable
  // name in many places (e.g. `const t = persisted?.theme`); using the
  // translator under a distinct name avoids accidental shadowing.
  const { t: tr, locale: i18nLocale } = useI18n();
  const dateLocale = i18nLocale === "no" ? "nb-NO" : "en-US";

  const [themePref, setThemePref] = useState<ThemePref>(() => {
    const t = persisted?.theme;
    return t === "light" || t === "dark" || t === "system" ? t : "system";
  });
  const [systemTheme, setSystemTheme] = useState<"light" | "dark">(() => {
    if (typeof window === "undefined" || !window.matchMedia) return "light";
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  });
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) =>
      setSystemTheme(e.matches ? "dark" : "light");
    if (typeof mq.addEventListener === "function") {
      mq.addEventListener("change", handler);
      return () => mq.removeEventListener("change", handler);
    }
    // Older Safari fallback
    mq.addListener(handler);
    return () => mq.removeListener(handler);
  }, []);
  const theme: "light" | "dark" =
    themePref === "system" ? systemTheme : themePref;
  const { user } = useUser();
  const authenticatedProjectManagerName =
    (
      user?.fullName ||
      [user?.firstName, user?.lastName].filter(Boolean).join(" ")
    ).trim();
  const [projectName, setProjectName] = useState(
    resolveProjectName(persisted?.projectName, persisted?.venue),
  );
  const [venue, setVenue] = useState(persisted?.venue ?? "");
  const [venueId, setVenueId] = useState<string | null>(persisted?.venueId ?? null);
  const [easyjobNumber, setEasyjobNumber] = useState(persisted?.easyjobNumber ?? "");
  const [client, setClient] = useState(persisted?.client ?? "");
  const [clientId, setClientId] = useState<string | null>(persisted?.clientId ?? null);
  const [reportDate, setReportDate] = useState(
    persisted?.reportDate ?? new Date().toISOString().slice(0, 10),
  );
  const [reportEndDate, setReportEndDate] = useState(
    persisted?.reportEndDate ?? "",
  );
  const [extraSchedule, setExtraSchedule] = useState<ExtraSchedule>(
    persisted?.extraSchedule ?? {},
  );
  const [engineer, setEngineer] = useState(
    persisted?.engineer ?? authenticatedProjectManagerName,
  );
  const projectManagerAutofillPendingRef = useRef(persisted == null);
  const [briefDescription, setBriefDescription] = useState(
    persisted?.briefDescription ?? "",
  );
  const [clientContact, setClientContact] = useState(
    persisted?.clientContact ?? "",
  );
  const [systems, setSystems] = useState<System[]>(
    persisted?.systems && persisted.systems.length > 0
      ? persisted.systems
      : [initialSystem],
  );

  const [venuesOptions, setVenuesOptions] = useState<Array<{ id: string; name: string; riggingSpecs?: Record<string, string>; powerInfrastructure?: Record<string, string>; logisticsAccess?: Record<string, string>; siteFacilities?: Record<string, string>; technicalContactName?: string; technicalContactPhone?: string; technicalContactEmail?: string }>>([]);
  const [clientsOptions, setClientsOptions] = useState<Array<{ id: string; companyName: string; }>>([]);

  useEffect(() => {
    let mounted = true;
    const loadOptions = async () => {
      try {
        const token = await getToken();
        if (!token) return;
        const [vRes, cRes] = await Promise.all([
          fetch("/api/venues", { headers: { Authorization: `Bearer ${token}` } }),
          fetch("/api/clients", { headers: { Authorization: `Bearer ${token}` } })
        ]);
        if (vRes.ok && mounted) {
          const vJson = await vRes.json();
          setVenuesOptions(vJson.venues || []);
        }
        if (cRes.ok && mounted) {
          const cJson = await cRes.json();
          setClientsOptions(cJson.clients || []);
        }
      } catch {}
    };
    loadOptions();
    return () => { mounted = false; };
  }, [getToken]);
  const [activeSystemId, setActiveSystemId] = useState<string>(() => {
    const fromPersisted = persisted?.activeSystemId;
    const list = persisted?.systems && persisted.systems.length > 0
      ? persisted.systems
      : [initialSystem];
    if (fromPersisted && list.some((s) => s.id === fromPersisted)) {
      return fromPersisted;
    }
    return list[0].id;
  });

  const [mainView, setMainView] = useState<MainView>(persisted?.mainView ?? "oversikt");
  const [globalView, setGlobalView] = useState<GlobalView | null>(
    () =>
      projectIdFromPath(location)
        ? null
        : (globalViewFromPath(location) ?? "home"),
  );
  const navigateGlobalView = useCallback((view: GlobalView) => {
    setGlobalView(view);
    navigate(GLOBAL_VIEW_PATHS[view]);
  }, [navigate]);
  useEffect(() => {
    const next = globalViewFromPath(location);
    if (next) setGlobalView(next);
  }, [location]);
  const clerk = useClerk();

  // Crew Report request/accept loop —
  //   `activeBriefId`   server id of the project_briefs row this project
  //                     is hanging its outgoing requests off of (lazily
  //                     created on the first Send requests click and
  //                     persisted across reloads in PersistedV2).
  //   `sendingRequests` true while the POST /api/portal/briefs round
  //                     trip is in flight; disables the sticky bar.
  //   `sendError`       last failure surfaced to the sidebar so the
  //                     producer sees why nothing happened.
  const [activeBriefId, setActiveBriefId] = useState<string | null>(
    persisted?.activeBriefId ?? null,
  );
  const [sendingRequests, setSendingRequests] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  /** Equipment-library picker state. `target` controls which add-handler the
   *  picked item flows into; `null` means the picker is closed. */
  const [pickerTarget, setPickerTarget] = useState<
    | null
    | { kind: "sound" }
    | { kind: "lighting" }
    | { kind: "power"; circuitId: string; phase: PowerPhase }
  >(null);
  const closePicker = () => setPickerTarget(null);
  const [showFixtures, setShowFixtures] = useState<ShowFixture[]>(
    persisted?.showFixtures ?? [],
  );
  const [linkedMeta, setLinkedMeta] = useState<Record<string, LinkedMeta>>(
    persisted?.linkedMeta ?? {},
  );
  const [ledScreens, setLedScreens] = useState<LedScreen[]>(
    () =>
      (persisted?.ledScreens ?? []).map((s) => ({
        ...s,
        panelKey: migrateLedPanelKey(s.panelKey),
      })),
  );
  /** Currently selected screen on the LED pixel-map canvas (null = none).
   *  Session-only — intentionally not persisted to localStorage so the
   *  user opens the tab with a clean visual rather than reviving a stale
   *  selection from a previous browsing session. */
  const [selectedLedScreenId, setSelectedLedScreenId] = useState<
    string | null
  >(null);
  const [ledLinkedMeta, setLedLinkedMeta] = useState<
    Record<string, LedLinkedMeta>
  >(() => {
    const raw = persisted?.ledLinkedMeta ?? {};
    const out: Record<string, LedLinkedMeta> = {};
    for (const [k, v] of Object.entries(raw)) {
      out[k] = { ...v, panelKey: migrateLedPanelKey(v.panelKey) };
    }
    return out;
  });
  const [ledSettings, setLedSettings] = useState<LedSettings>(
    normalizeLedSettings(persisted?.ledSettings),
  );
  const [ledSystemState, setLedSystemState] = useState<LedSystem>(() =>
    persisted?.ledSystem
      ? normalizeLedSystem(persisted.ledSystem)
      : { ...EMPTY_LED_SYSTEM },
  );
  const [crew, setCrew] = useState<CrewMember[]>(
    () => (persisted?.crew ?? []).map(normalizeCrewMember),
  );
  const [soundItems, setSoundItems] = useState<SoundItem[]>(
    () => (persisted?.soundItems ?? []).map(normalizeSoundItem),
  );
  const [inspection, setInspection] = useState<InspectionData>(
    () => persisted?.inspection ?? { ...EMPTY_INSPECTION },
  );
  const [power, setPower] = useState<PowerPlan>(
    () => normalizePowerPlan(persisted?.power),
  );
  const [stages, setStages] = useState<Stage[]>(() =>
    (persisted?.stages ?? []).map((stage) =>
      normalizeStage(stage, tr("stage.defaultName")),
    ),
  );
  const [riggPlan, setRiggPlan] = useState<RiggPlan>(() =>
    normalizeRiggPlan(persisted?.riggPlan),
  );

  // The floor-plan backdrop library lives in its own localStorage slot
  // so a few MB of drawing data URLs never bloat the main report blob
  // (and a QuotaExceededError on the floor-plan slot doesn't kill the
  // rest of the report's autosave). The producer can stack multiple
  // drawings — one of them is "active" at a time and rendered behind
  // the Rigg Plan canvas.
  const [floorPlanLibrary, setFloorPlanLibrary] = useState<FloorPlanLibrary>(
    () => loadFloorPlanLibrary(),
  );
  useEffect(() => {
    saveFloorPlanLibrary(floorPlanLibrary);
  }, [floorPlanLibrary]);
  /** Append a new drawing to the library and make it the active
   *  backdrop. Used by the Drawing Importer's "Use as floor plan"
   *  button — calling it three times stacks three plans the user can
   *  switch between. */
  const addFloorPlan = (plan: FloorPlan) => {
    setFloorPlanLibrary((lib) => ({
      plans: [...lib.plans, plan],
      activeId: plan.id,
    }));
  };
  /** Remove a single plan by id. If the active plan was removed, fall
   *  back to the next one in the list (or `null` if the library is
   *  empty afterwards) so the canvas always knows what to render. */
  const removeFloorPlan = (id: string) => {
    setFloorPlanLibrary((lib) => {
      const plans = lib.plans.filter((p) => p.id !== id);
      const activeId =
        lib.activeId === id
          ? (plans[0]?.id ?? null)
          : lib.activeId;
      return { plans, activeId };
    });
  };
  const [showVenueSpecs, setShowVenueSpecs] = useState(false);

  /** Switch which plan is shown as the backdrop. Pass `null` to hide
   *  the backdrop without deleting any plans. */
  const selectFloorPlan = (id: string | null) => {
    setFloorPlanLibrary((lib) => ({
      ...lib,
      activeId: id == null ? null : (lib.plans.some((p) => p.id === id) ? id : lib.activeId),
    }));
  };

  const [modalTarget, setModalTarget] = useState<Category | null>(null);
  const [custName, setCustName] = useState("");
  const [custWeight, setCustWeight] = useState("");
  const [custWatt, setCustWatt] = useState("");
  const [custArea, setCustArea] = useState("");
  /** Optional bracket / hang-bar name for a custom LED panel — drives
   *  the bracket-BOM display so producers see the real part name
   *  instead of the "(set bracket on inventory)" placeholder. */
  const [custBracket, setCustBracket] = useState("");

  const [savedAt, setSavedAt] = useState<string>("");
  const [cloudSavedAt, setCloudSavedAt] = useState<string>("");
  const [shareOpen, setShareOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(() => {
    try {
      return localStorage.getItem("ehs-current-project-id");
    } catch {
      return null;
    }
  });
  useEffect(() => {
    if (
      projectManagerAutofillPendingRef.current &&
      authenticatedProjectManagerName
    ) {
      setEngineer((current) => current || authenticatedProjectManagerName);
      projectManagerAutofillPendingRef.current = false;
    }
  }, [authenticatedProjectManagerName]);
  const [currentProjectAccessRole, setCurrentProjectAccessRole] = useState<
    "owner" | "editor" | "viewer" | null
  >(null);
  const [currentProjectServerStatus, setCurrentProjectServerStatus] =
    useState<ProjectStatus>("draft");
  const [currentProjectIsArchived, setCurrentProjectIsArchived] = useState(false);
  const [statusDialogOpen, setStatusDialogOpen] = useState(false);
  const [statusChanging, setStatusChanging] = useState(false);
  const [statusChangeError, setStatusChangeError] = useState("");
  const [dispatchRetryOpen, setDispatchRetryOpen] = useState(false);
  const [dispatchRetryLoading, setDispatchRetryLoading] = useState(false);
  const [dispatchRetryError, setDispatchRetryError] = useState("");
  const [dispatchRetryResult, setDispatchRetryResult] = useState<
    "sent" | "alreadySent" | null
  >(null);
  const [dashboardStats, setDashboardStats] = useState<DashboardStats>({
    activeProjects: 0,
    planningProjects: 0,
    totalFreelancers: 0,
    unassignedTasks: 0,
  });
  const projectSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const projectSaveVersion = useRef(0);
  const suppressCloudSave = useRef(false);
  const hydratedProjectRouteRef = useRef<string | null>(null);
  // Every project write joins this promise chain. This prevents a status
  // transition from overtaking an autosave, while retaining debounced saves.
  const cloudSaveQueue = useRef<Promise<void>>(Promise.resolve());

  const cloudSave = useCallback(async (data: PersistedV2) => {
    const isTerminal =
      currentProjectIsArchived ||
      currentProjectServerStatus === "completed" ||
      currentProjectServerStatus === "archived";
    if (
      currentProjectId &&
      (currentProjectAccessRole !== "owner" &&
        currentProjectAccessRole !== "editor")
    ) {
      return;
    }
    // Terminal records are intentionally not mutated by autosave. The
    // completed → archived status endpoint remains the sole permitted write.
    if (currentProjectId && isTerminal) return;
    const run = async () => {
      const token = await getToken();
       if (!token) throw new Error(tr("project.save.authError"));
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      };
      const body = {
        ...projectIdentityPayload(
          data.projectName || "",
          data.venue || "",
          data.venueId,
        ),
        client: data.client || "",
        client_id: data.clientId || null,
        easyjob_number: data.easyjobNumber || null,
        data,
      };
      let res: Response;
      if (currentProjectId) {
        res = await fetch(`/api/projects/${currentProjectId}`, {
          method: "PATCH",
          headers,
          body: JSON.stringify(body),
        });
      } else {
        res = await fetch("/api/projects", {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        });
      }
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.project) {
        throw new Error(
          json?.error ||
            `Could not save the project${res.status ? ` (${res.status})` : ""}.`,
        );
      }
      setCurrentProjectServerStatus(
        normalizeProjectStatus(
          json.project.status,
          currentProjectServerStatus,
        ),
      );
      if (!currentProjectId && json.project.id) {
        setCurrentProjectId(json.project.id);
        try {
          localStorage.setItem("ehs-current-project-id", json.project.id);
        } catch { /* ignore */ }
      }
      setCloudSavedAt(
        new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        }),
      );
    };
    // Recover the queue for later autosaves but preserve this caller's
    // rejection, so a lifecycle transition can stop before status mutation.
    const queued = cloudSaveQueue.current.catch(() => undefined).then(run);
    cloudSaveQueue.current = queued;
    return queued;
  }, [
    currentProjectAccessRole,
    currentProjectId,
    currentProjectIsArchived,
    currentProjectServerStatus,
    getToken,
  ]);

  const cloudSaveRef = useRef(cloudSave);
  useEffect(() => { cloudSaveRef.current = cloudSave; }, [cloudSave]);

  useEffect(() => {
    if (!currentProjectId) {
      setCurrentProjectAccessRole(null);
      setCurrentProjectIsArchived(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const token = await getToken();
        if (!token) return;
        const res = await fetch(`/api/projects/${currentProjectId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const json = await res.json();
        if (!cancelled) {
          setCurrentProjectAccessRole(json.project?.accessRole ?? null);
          setCurrentProjectIsArchived(json.project?.isArchived === true);
          setCurrentProjectServerStatus(
            normalizeProjectStatus(json.project?.status),
          );
        }
      } catch {
        // Keep cloud writes paused until access can be resolved safely.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentProjectId, getToken]);

  useEffect(() => {
    if (globalView !== "home") return;
    let cancelled = false;
    void (async () => {
      try {
        const token = await getToken();
        if (!token) return;
        const headers = { Authorization: `Bearer ${token}` };
        const [projectsRes, crewRes] = await Promise.all([
          fetch("/api/projects", { headers }),
          fetch("/api/portal/freelancers", { headers }),
        ]);
        if (!projectsRes.ok || !crewRes.ok) return;
        const [projectsJson, crewJson] = await Promise.all([
          projectsRes.json(),
          crewRes.json(),
        ]);
        if (cancelled) return;
        const projects = Array.isArray(projectsJson.projects) ? projectsJson.projects : [];
        const freelancers = Array.isArray(crewJson.freelancers) ? crewJson.freelancers : [];
        setDashboardStats({
          activeProjects: projects.filter((p: { status?: string }) => p.status === "active").length,
          planningProjects: projects.filter((p: { status?: string }) => p.status === "planning").length,
          totalFreelancers: freelancers.length,
          unassignedTasks: 0,
        });
      } catch {
        // The dedicated pages surface fetch errors; the hub keeps neutral counts.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getToken, globalView]);

  // Expose a generic parent-window handler that the Client Pack and
  // Show Simulation popups can invoke for "Download PDF". We render the
  // popup body to a tall canvas with html2canvas, slice it into A4 pages
  // with jsPDF, and trigger a direct file download — bypassing the
  // browser print dialog, which doesn't always offer "Save as PDF".
  useEffect(() => {
    type Win = Window & { __ehsDownloadPopupPdf?: unknown };
    const w = window as unknown as Win;
    w.__ehsDownloadPopupPdf = async (popupWin: Window, filename: string) => {
      const [{ default: jsPDF }, html2canvasMod] = await Promise.all([
        import("jspdf"),
        import("html2canvas"),
      ]);
      const html2canvas =
        (html2canvasMod as { default?: typeof import("html2canvas").default })
          .default ?? (html2canvasMod as unknown as typeof import("html2canvas").default);
      const doc = popupWin.document;
      const body = doc.body;
      const html = doc.documentElement;
      const printBar = doc.querySelector<HTMLElement>(".print-bar");
      const prevDisplay = printBar?.style.display ?? "";
      if (printBar) printBar.style.display = "none";

      // Force the popup into "PDF mode" while we capture: pin the body
      // to true A4 width (794px @ 96dpi) so html2canvas rasterises the
      // same proportions the PDF page will end up with — no awkward
      // shrink-to-fit, no oversized cover. The .pdf-export class lets
      // each popup's stylesheet (showSimulation, clientPackExport)
      // tighten spacing for the export specifically. */
      const A4_WIDTH_PX = 794;
      const prevBody = {
        width: body.style.width,
        maxWidth: body.style.maxWidth,
        margin: body.style.margin,
      };
      const prevHtmlOverflow = html.style.overflow;
      body.classList.add("pdf-export");
      body.style.width = `${A4_WIDTH_PX}px`;
      body.style.maxWidth = `${A4_WIDTH_PX}px`;
      body.style.margin = "0";
      html.style.overflow = "visible";
      // Allow the layout to settle before measuring.
      await new Promise<void>((r) => popupWin.requestAnimationFrame(() => r()));

      // Wait for every <img> in the popup to be fully decoded before
      // snapshotting. html2canvas reads pixels synchronously and will
      // render still-decoding images (large data-URL backdrops like
      // the Show Simulation floor plan or Client Pack pixel maps) as
      // blank gaps — even though the markup looks fine in the popup
      // itself. `img.decode()` is the supported way to await ready-
      // for-paint state; we fall back to the `complete` flag for any
      // browser that rejects the promise (Safari occasionally does).
      const imgs = Array.from(doc.querySelectorAll("img"));
      await Promise.all(
        imgs.map(async (img) => {
          if (img.complete && img.naturalWidth > 0) return;
          try {
            await img.decode();
          } catch {
            await new Promise<void>((r) => {
              if (img.complete) {
                r();
                return;
              }
              const done = () => r();
              img.addEventListener("load", done, { once: true });
              img.addEventListener("error", done, { once: true });
            });
          }
        }),
      );

      // Single source of truth for the html2canvas pixel scale so the
      // break-coordinate math below cannot silently drift if we ever
      // change the capture resolution.
      const CAPTURE_SCALE = 2;
      try {
        const canvas = await html2canvas(body, {
          scale: CAPTURE_SCALE,
          backgroundColor: "#ffffff",
          useCORS: true,
          windowWidth: A4_WIDTH_PX,
          windowHeight: body.scrollHeight,
        });
        const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
        const pageW = pdf.internal.pageSize.getWidth();
        const pageH = pdf.internal.pageSize.getHeight();
        // Canvas-pixel height of one A4 page at the captured scale.
        // canvas.width corresponds to pageW (in mm), so ratio is fixed.
        const pageHPx = (pageH * canvas.width) / pageW;

        // Section-aware page breaks. Naive slicing at fixed page
        // heights cuts sections in half — we instead collect the
        // top-Y of every "logical block" in the popup (cover page,
        // each phase, verdict, floor plan, footer / Client-Pack
        // sections) and end each PDF page at the LARGEST candidate
        // that still fits within one page-height of the cursor.
        // Sections taller than a single A4 page fall back to the
        // hard pageHPx cut, so very long phases don't deadlock.
        const bodyTop = body.getBoundingClientRect().top;
        const breakSelectors = [
          ".cover",
          ".phase",
          ".verdict",
          ".floor-plan",
          ".muted",
          "section",
          "h2",
        ];
        const breakSet = new Set<number>([0, canvas.height]);
        for (const sel of breakSelectors) {
          doc.querySelectorAll<HTMLElement>(sel).forEach((el) => {
            const top =
              (el.getBoundingClientRect().top - bodyTop) * CAPTURE_SCALE;
            if (top > 0 && top < canvas.height) breakSet.add(top);
          });
        }
        const breaks = Array.from(breakSet).sort((a, b) => a - b);

        const ranges: Array<{ from: number; to: number }> = [];
        let cursor = 0;
        const EPS = 1; // tolerate sub-pixel rounding
        while (cursor < canvas.height - EPS) {
          const maxEnd = cursor + pageHPx;
          // Largest break in (cursor, maxEnd]; if none, hard cut.
          let end = -1;
          for (const b of breaks) {
            if (b > cursor + EPS && b <= maxEnd + EPS) {
              if (b > end) end = b;
            } else if (b > maxEnd) {
              break;
            }
          }
          if (end <= cursor) end = Math.min(cursor + pageHPx, canvas.height);
          ranges.push({ from: cursor, to: end });
          cursor = end;
        }

        // Render each range onto its own PDF page via an offscreen
        // canvas slice. Sized exactly to the slice height so the
        // image lands at native resolution at the top of the page.
        const slice = doc.createElement("canvas");
        slice.width = canvas.width;
        const sliceCtx = slice.getContext("2d");
        if (!sliceCtx) throw new Error("Could not allocate slice canvas");
        for (let i = 0; i < ranges.length; i++) {
          const r = ranges[i]!;
          const sliceH = Math.max(1, Math.round(r.to - r.from));
          slice.height = sliceH;
          sliceCtx.fillStyle = "#ffffff";
          sliceCtx.fillRect(0, 0, slice.width, sliceH);
          sliceCtx.drawImage(canvas, 0, -r.from);
          const sliceUrl = slice.toDataURL("image/jpeg", 0.92);
          // Clamp to pageH to avoid sub-mm overflow caused by EPS /
          // rounding at boundary slices, which would otherwise spill
          // a hairline of the next section onto the following page.
          const sliceMmH = Math.min(pageH, (sliceH * pageW) / canvas.width);
          if (i > 0) pdf.addPage();
          pdf.addImage(sliceUrl, "JPEG", 0, 0, pageW, sliceMmH);
        }

        const safe =
          (filename || "Export.pdf").replace(/[\\/:*?"<>|]+/g, "-").trim() ||
          "Export.pdf";
        pdf.save(safe.endsWith(".pdf") ? safe : `${safe}.pdf`);
      } finally {
        if (printBar) printBar.style.display = prevDisplay;
        body.classList.remove("pdf-export");
        body.style.width = prevBody.width;
        body.style.maxWidth = prevBody.maxWidth;
        body.style.margin = prevBody.margin;
        html.style.overflow = prevHtmlOverflow;
      }
    };
    return () => {
      try {
        delete (window as unknown as Win).__ehsDownloadPopupPdf;
      } catch {
        (window as unknown as Win).__ehsDownloadPopupPdf = undefined;
      }
    };
  }, []);
  // Transient toast text for the Power Plan "Export to crew" action.
  // Cleared by the PowerPlanView after its auto-fade timer fires, or
  // when the user clicks the close (×) on the toast itself.
  const [powerExportToast, setPowerExportToast] = useState<string | null>(
    null,
  );

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  // Plan B — mark the document so global CSS can opt the legacy
  // .container/body padding out for the new full-bleed AppShell layout.
  useEffect(() => {
    document.documentElement.setAttribute("data-shell", "linear");
    return () => {
      document.documentElement.removeAttribute("data-shell");
    };
  }, []);

  const buildPersistedData = useCallback((): PersistedV2 => ({
    theme: themePref,
    projectName,
    venue,
    venueId,
    easyjobNumber,
    client,
    clientId,
    reportDate,
    reportEndDate,
    extraSchedule,
    engineer,
    briefDescription,
    clientContact,
    systems,
    activeSystemId,
    showFixtures,
    mainView,
    linkedMeta,
    ledScreens,
    ledLinkedMeta,
    ledSettings,
    ledSystem: ledSystemState,
    stages,
    crew,
    soundItems,
    power,
    activeBriefId,
    riggPlan,
    inspection,
  }), [
    themePref, projectName, venue, venueId, easyjobNumber, client, clientId,
    reportDate, reportEndDate, extraSchedule,
    engineer, briefDescription, clientContact, systems, activeSystemId, showFixtures, mainView, linkedMeta,
    ledScreens, ledLinkedMeta, ledSettings, ledSystemState, stages, crew, soundItems,
    power, activeBriefId, riggPlan, inspection,
  ]);

  useEffect(() => {
    if (suppressCloudSave.current) {
      suppressCloudSave.current = false;
      return () => {
        if (projectSaveTimer.current) {
          clearTimeout(projectSaveTimer.current);
          projectSaveTimer.current = null;
        }
      };
    }

    const data = buildPersistedData();
    try {
      localStorage.setItem(STORAGE_KEY_V2, JSON.stringify(data));
      setSavedAt(
        new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        }),
      );
    } catch {
      /* ignore quota errors */
    }

    if (projectSaveTimer.current) clearTimeout(projectSaveTimer.current);

    const ver = ++projectSaveVersion.current;
    projectSaveTimer.current = setTimeout(() => {
      if (ver !== projectSaveVersion.current) return;
      // Autosave failures are retried on a subsequent edit; only an
      // authoritative caller (such as a lifecycle transition) needs the
      // rejection surfaced synchronously.
      void cloudSaveRef.current(data).catch(() => undefined);
    }, 5000);

    return () => {
      if (projectSaveTimer.current) {
        clearTimeout(projectSaveTimer.current);
        projectSaveTimer.current = null;
      }
    };
  }, [buildPersistedData]);

  const activeSystem =
    systems.find((s) => s.id === activeSystemId) ?? systems[0];

  const updateActiveSystem = (updates: Partial<System>) => {
    setSystems((all) =>
      all.map((s) => (s.id === activeSystem.id ? { ...s, ...updates } : s)),
    );
  };

  const updateRowsKey = (
    key: "riggingRows" | "fixtureRows" | "ledRows",
    fn: (rows: Row[]) => Row[],
  ) => {
    setSystems((all) =>
      all.map((s) =>
        s.id === activeSystem.id ? { ...s, [key]: fn(s[key]) } : s,
      ),
    );
  };

  const addSystem = () => {
    const nextNumber = systems.length + 1;
    let baseName = `LX${nextNumber}`;
    while (systems.some((s) => s.name === baseName)) baseName += "'";
    const sys = makeSystem(baseName);
    setSystems((all) => [...all, sys]);
    setActiveSystemId(sys.id);
  };

  const duplicateActiveSystem = () => {
    const copy: System = {
      ...activeSystem,
      id: newId("sys"),
      name: `${activeSystem.name} copy`,
      riggingRows: activeSystem.riggingRows.map((r) => ({ ...r, id: newId("row") })),
      fixtureRows: activeSystem.fixtureRows.map((r) => ({ ...r, id: newId("row") })),
      ledRows: activeSystem.ledRows.map((r) => ({ ...r, id: newId("row") })),
    };
    setSystems((all) => [...all, copy]);
    setActiveSystemId(copy.id);
  };

  const removeSystem = (id: string) => {
    const target = systems.find((s) => s.id === id);
    if (!target) return;
    // When this is the last system left, deleting used to be blocked
    // outright. That made it impossible to wipe a set of imported
    // LX1/LX2/... systems and start fresh — the last row was always
    // stuck. Now we still need ≥ 1 system in the report (the rest of
    // the UI assumes activeSystem exists), but we satisfy that by
    // auto-creating one empty "System 1" to replace it. End result:
    // user can click × down the whole list and land on a true clean
    // slate without touching the venue, inventory, or floor plans.
    const isLast = systems.length <= 1;
    const promptMsg = isLast
      ? tr("rigging.confirm.removeLast", { name: target.name })
      : tr("rigging.confirm.remove", { name: target.name });
    if (!confirm(promptMsg)) return;

    if (isLast) {
      const fresh = makeEmptySystem(tr("rigging.defaultSystemName"));
      setSystems([fresh]);
      setActiveSystemId(fresh.id);
      return;
    }
    const remaining = systems.filter((s) => s.id !== id);
    setSystems(remaining);
    if (activeSystemId === id) setActiveSystemId(remaining[0].id);
  };

  const openModal = (category: Category) => {
    setModalTarget(category);
    setCustName("");
    setCustWeight("");
    setCustWatt("");
    setCustArea("");
    setCustBracket("");
  };
  const closeModal = () => setModalTarget(null);

  // ── Show Fixtures (Lighting Plan) ───────────────────────────────────────

  // Garbage-collect linkedMeta entries whose source rigging row no longer
  // exists (system or fixtureRow was deleted). Keeps localStorage tidy.
  useEffect(() => {
    const liveIds = new Set<string>();
    for (const sys of systems)
      for (const row of sys.fixtureRows) liveIds.add(row.id);
    setLinkedMeta((all) => {
      const keys = Object.keys(all);
      const orphans = keys.filter((k) => !liveIds.has(k));
      if (orphans.length === 0) return all;
      const next: Record<string, LinkedMeta> = {};
      for (const k of keys) if (liveIds.has(k)) next[k] = all[k];
      return next;
    });
  }, [systems]);

  /** Fixtures auto-derived from each rigging system's fixtureRows. Read-only
   *  base info (name/qty/weight/watts/systemId); DMX/position overlays come
   *  from `linkedMeta` keyed by the source rigging Row id. */
  const linkedFixtures = useMemo<ShowFixture[]>(() => {
    const out: ShowFixture[] = [];
    for (const sys of systems) {
      for (const row of sys.fixtureRows) {
        const item = getRowItem(row);
        if (!item) continue;
        const stored = linkedMeta[row.id];
        const meta = stored ?? defaultLinkedMeta();

        // Resolve DMX mode + channel count.
        // - Item has modes + meta.dmxModeIndex is a valid index → use mode's channels
        // - Item has modes + meta.dmxModeIndex === null → "Custom" override (use stored channels)
        // - Item has modes + no stored meta → default to first mode
        // - Item has no modes → use stored channels (free entry)
        const modes = item.dmxModes;
        let resolvedModeIndex: number | null | undefined;
        let resolvedChannels: number;
        if (modes && modes.length > 0) {
          if (!stored || meta.dmxModeIndex === undefined) {
            // No stored meta OR legacy meta from before dmxModes existed
            // (no dmxModeIndex field) → default to first mode. This avoids
            // dropping channels to 0 for users upgrading from older saves.
            resolvedModeIndex = 0;
            resolvedChannels = modes[0].channels;
          } else if (
            meta.dmxModeIndex !== null &&
            meta.dmxModeIndex >= 0 &&
            meta.dmxModeIndex < modes.length
          ) {
            resolvedModeIndex = meta.dmxModeIndex;
            resolvedChannels = modes[meta.dmxModeIndex].channels;
          } else {
            // null (explicit Custom) or out-of-range → custom entry
            resolvedModeIndex = null;
            resolvedChannels = meta.dmxChannels;
          }
        } else {
          resolvedModeIndex = undefined;
          resolvedChannels = meta.dmxChannels;
        }

        out.push({
          id: `linked-${row.id}`,
          name: item.name,
          qty: row.qty,
          weight: item.weight,
          watts: item.wattage,
          systemId: sys.id,
          linked: true,
          sourceRowId: row.id,
          dmxChannels: resolvedChannels,
          dmxModeIndex: resolvedModeIndex,
          availableDmxModes: modes,
          beamAngle: meta.beamAngle,
          position: meta.position,
          circuit: meta.circuit,
          universe: meta.universe,
          startAddress: meta.startAddress,
          notes: meta.notes,
        });
      }
    }
    return out;
  }, [systems, linkedMeta]);

  const allLightingFixtures = useMemo<ShowFixture[]>(
    () => [...linkedFixtures, ...showFixtures],
    [linkedFixtures, showFixtures],
  );

  // ── LED Screen Report ──────────────────────────────────────────────────

  /** Panel library derived directly from the rigging report's "LED Screen"
   *  inventory. Items without pixel/physical info (e.g. Molton fabric) are
   *  filtered out. A synthetic "Custom panel…" entry is appended last. */
  const ledPanels = useMemo(
    () => buildLedPanels(inventory["LED Screen"]),
    [],
  );
  /** Beams + non-pixel rigging items from the LED Screen inventory.
   *  Passed to the Rig Accessories panel inside each screen card so
   *  the producer can attach rigging beams without leaving the LED
   *  tab. Filter: anything where pixelWidth/pixelHeight is 0/missing. */
  const ledBeamsCatalog = useMemo(
    () =>
      inventory["LED Screen"]
        .filter(
          (it) => !it.pixelWidth || !it.pixelHeight || it.pixelWidth === 0,
        )
        .map((it) => ({ name: it.name, weight: it.weight })),
    [],
  );
  const defaultLedPanelKey = useMemo(
    () => defaultPanelKeyOf(ledPanels),
    [ledPanels],
  );

  // Garbage-collect ledLinkedMeta entries whose source rigging ledRow no
  // longer exists OR is not a panel-mappable inventory item (e.g. Molton).
  useEffect(() => {
    const liveIds = new Set<string>();
    for (const sys of systems) {
      for (const row of sys.ledRows) {
        const item = getRowItem(row);
        if (item && findPanelKeyForInventoryName(item.name, ledPanels)) {
          liveIds.add(row.id);
        }
      }
    }
    setLedLinkedMeta((all) => {
      const keys = Object.keys(all);
      const orphans = keys.filter((k) => !liveIds.has(k));
      if (orphans.length === 0) return all;
      const next: Record<string, LedLinkedMeta> = {};
      for (const k of keys) if (liveIds.has(k)) next[k] = all[k];
      return next;
    });
  }, [systems, ledPanels]);

  /** Screens auto-derived from each rigging system's ledRows. Layout
   *  (panelsWide/Tall, output, color, notes) lives in `ledLinkedMeta`
   *  keyed by source Row id; qty changes nudge the default layout. */
  const linkedLedScreens = useMemo<LedScreen[]>(() => {
    const out: LedScreen[] = [];
    let colorIdx = 0;
    for (const sys of systems) {
      for (const row of sys.ledRows) {
        const item = getRowItem(row);
        if (!item) continue;
        const detected = findPanelKeyForInventoryName(item.name, ledPanels);
        if (!detected) continue;
        const stored = ledLinkedMeta[row.id];
        const fallback = defaultLinkedLedMeta(row.qty, detected);
        const meta: LedLinkedMeta = stored ?? {
          ...fallback,
          color: LED_SCREEN_COLORS[colorIdx % LED_SCREEN_COLORS.length],
        };
        colorIdx++;
        const autoName = `${sys.name} · ${item.name}`;
        const displayName =
          meta.nameOverride && meta.nameOverride.trim().length > 0
            ? meta.nameOverride
            : autoName;
        out.push({
          id: `led-linked-${row.id}`,
          name: displayName,
          panelKey: meta.panelKey,
          panelsWide: meta.panelsWide,
          panelsTall: meta.panelsTall,
          color: meta.color,
          outputIndex: meta.outputIndex,
          notes: meta.notes,
          customPanel: meta.customPanel,
          linked: true,
          sourceRowId: row.id,
          // Project per-screen annotations from the linked meta into the
          // resolved screen so the visual / export / share path treats
          // linked and manual screens identically. Includes the new LED
          // shape / cell-marker / multi-processor fields so a producer
          // can edit them on a linked screen and have them survive the
          // round-trip through `updateLedScreen` and the brief.
          nameScale: meta.nameScale,
          markers: meta.markers,
          disabledCells: meta.disabledCells,
          shapeTemplate: meta.shapeTemplate,
          panelMarkers: meta.panelMarkers,
          processors: meta.processors,
          bracketOverride: meta.bracketOverride,
          // Display-only rotation (degrees clockwise) — mirrors the
          // linked meta so the rotation survives unlink / relink and
          // is visible on the pixel-map canvas + PNG export.
          rotationDeg: meta.rotationDeg,
          // Touring-grade (Phase 1-3) — surface advanced engineering
          // fields so the Inspector / RigAccessories / PortMapping
          // panels can edit them on linked screens too.
          brightnessNits: meta.brightnessNits,
          refreshRateHz: meta.refreshRateHz,
          bitDepth: meta.bitDepth,
          hdrEnabled: meta.hdrEnabled,
          curveType: meta.curveType,
          cabinetRotation: meta.cabinetRotation,
          transparencyMode: meta.transparencyMode,
          processorPortAssignments: meta.processorPortAssignments,
          maxCabinetsPerDataChain: meta.maxCabinetsPerDataChain,
          maxCabinetsPerPowerChain: meta.maxCabinetsPerPowerChain,
          voltageRegion: meta.voltageRegion,
          powerOverheadPct: meta.powerOverheadPct,
          powerFactor: meta.powerFactor,
          cameraSafeMode: meta.cameraSafeMode,
          scanRateProfile: meta.scanRateProfile,
          genlockEnabled: meta.genlockEnabled,
          backupSignalEnabled: meta.backupSignalEnabled,
          signalLoopEnabled: meta.signalLoopEnabled,
          curveAnglePerSeam: meta.curveAnglePerSeam,
          rigAccessories: meta.rigAccessories,
          autoFitBeams: meta.autoFitBeams,
        });
      }
    }
    return out;
  }, [systems, ledLinkedMeta, ledPanels]);

  const allLedScreens = useMemo<LedScreen[]>(
    () => [...linkedLedScreens, ...ledScreens],
    [linkedLedScreens, ledScreens],
  );

  const ledTotals = useMemo(
    () => computeLedTotals(allLedScreens, ledSettings, ledPanels, ledBeamsCatalog),
    [allLedScreens, ledSettings, ledPanels, ledBeamsCatalog],
  );

  /** Project state assembled into the shape the brief encoder needs.
   *  Resolves hoist labels (from the App-level `hoistModels` table) and
   *  LED panel definitions (from the dynamic `ledPanels` list) here so
   *  the share modal — and the projectBrief lib — never have to reach
   *  back into App-level state. Recomputed when any source field changes. */
  const briefInput = useMemo<BuildBriefInput>(() => {
    return {
      projectName,
      venue,
      client,
      clientContact: clientContact.trim() ? clientContact : undefined,
      reportDate,
      reportEndDate,
      schedule: buildProjectSchedule(reportDate, reportEndDate, extraSchedule),
      engineer,
      // Free-text producer brief captured on the Overview. Surfaced
      // verbatim on the freelancer brief page as `project.description`.
      description: briefDescription.trim() ? briefDescription : undefined,
      // The `recipientCrewId` is overridden per-link by ShareBriefModal.
      recipientCrewId: null,
      crew,
      rigging: {
        systems: systems.map((s) => {
          const hoist = getHoist(s.hoistIndex);
          return {
            id: s.id,
            name: s.name,
            pointCount: s.pointCount,
            dynamicFactor: s.dynamicFactor,
            hoistLabel: hoist.label,
            hoistWatt: hoist.watt,
            riggingRowCount: s.riggingRows.length,
            fixtureRowCount: s.fixtureRows.length,
            ledRowCount: s.ledRows.length,
          };
        }),
      },
      lighting: {
        showFixtures: allLightingFixtures.map((f) => ({
          qty: f.qty,
          watts: f.watts,
          universe: f.universe,
        })),
        power: {
          circuits: power.circuits.map((c) => ({
            voltage: c.voltage,
            ampsPerPhase: c.ampsPerPhase,
            items: c.items.map((it) => ({
              qty: it.qty,
              wattsPerUnit: it.wattsPerUnit,
              phase: it.phase,
            })),
          })),
          distros: (() => {
            const lookup = makeFixtureWattsLookup(allLightingFixtures);
            const trussNameById = new Map(
              systems.map((s) => [s.id, s.name]),
            );
            return power.distros.map((d) => {
              const load = computeDistroLoad(d, lookup);
              return {
                id: d.id,
                name: d.name,
                source: d.source,
                presetLabel: DISTRO_PRESETS[d.preset]?.label ?? d.preset,
                feedVoltage: d.feedVoltage,
                feedAmps: d.feedAmps,
                feedPhases: d.feedPhases,
                feedsTrusses: d.feedsTrusses
                  .map((id) => trussNameById.get(id))
                  .filter((n): n is string => Boolean(n && n.length > 0)),
                totalWatts: load.totalWatts,
                feederUtilization: load.feederUtilization,
                worstLegAmps: load.feederWorstAmps,
                imbalance: load.imbalance,
                imbalanceWarn: load.imbalanceWarn,
                channelOverload: load.hasChannelOverload,
                feederOverload: load.feederStatus === "over",
              };
            });
          })(),
        },
      },
      led: {
        ledScreens: allLedScreens.map((s) => {
          const panel = resolveScreenPanel(s, ledPanels);
          const enabled = enabledPanelCount(s);
          const bbox = Math.max(0, s.panelsWide) * Math.max(0, s.panelsTall);
          const disabled = Math.max(0, bbox - enabled);
          const bom = computeScreenCableBOM(s, ledPanels, ledBeamsCatalog);
          const cap = computeScreenProcessorCapacity(s.processors);
          const metrics = computeScreenMetrics(s, ledPanels);
          // Resolve the producer's `LedShapeTemplate` choice to a
          // human-readable label. Only emit a label if the screen has
          // actual disabled cells — a "rectangle" with no disabled
          // cells should produce no shape line in the brief. If the
          // producer applied a preset and didn't hand-toggle, surface
          // the template name from `LED_SHAPE_TEMPLATE_OPTIONS`;
          // otherwise fall back to the generic "Custom shape" label.
          const shapeLabel = (() => {
            if (disabled === 0) return undefined;
            if (s.shapeTemplate) {
              const opt = LED_SHAPE_TEMPLATE_OPTIONS.find(
                (o) => o.value === s.shapeTemplate,
              );
              if (opt) return opt.label;
            }
            return "Custom shape";
          })();
          const processors = (s.processors ?? [])
            .map((p) => NOVASTAR_PROCESSOR_CATALOG[p.model]?.name ?? p.model);
          // Single source of truth for the "Under capacity" badge.
          // Mirrors the per-row check in `LedScreenReportView` so the
          // report and the portal brief always agree. Combines the
          // pixel-cap test AND the outputs test (a screen can fit in
          // pixels but still need more daisy-chain outputs than the
          // attached processors offer).
          const requiredOutputs =
            (s.processors ?? []).length > 0 && cap.worstPixelsPerOutput > 0
              ? Math.ceil(metrics.pixels / cap.worstPixelsPerOutput)
              : 0;
          const processorUnderCapacity =
            (s.processors ?? []).length > 0 &&
            ((cap.maxPixels > 0 && metrics.pixels > cap.maxPixels) ||
              (cap.outputs > 0 && requiredOutputs > cap.outputs))
              ? true
              : undefined;
          return {
            id: s.id,
            name: s.name,
            panelType: panel.name,
            cols: s.panelsWide,
            rows: s.panelsTall,
            panelWatts: panel.power,
            enabledPanels: enabled,
            disabledPanels: disabled,
            shape: shapeLabel,
            signalCables: bom.signalCables,
            signalLengthM: bom.signalLengthM,
            powerCables: bom.powerCables,
            powerLengthM: bom.powerLengthM,
            brackets: bom.brackets,
            processors,
            processorOutputs: cap.outputs,
            processorMaxPixels: cap.maxPixels,
            processorPixels: metrics.pixels,
            processorUnderCapacity,
          };
        }),
        processor: findProcessor(ledSettings.processorId)?.name ?? "",
      },
      stages,
      sound: soundItems,
      riggPlan,
      // Pass-through state used by ShareBriefModal to render one PNG
      // per LED screen (with the producer's pill-size + power/signal
      // markers) and upload it as a brief attachment. Not embedded in
      // the brief itself — only used to drive the upload step.
      ledDiagrams: {
        screens: allLedScreens,
        panels: ledPanels,
        settings: ledSettings,
      },
    };
  }, [
    venue,
    client,
    reportDate,
    reportEndDate,
    extraSchedule,
    engineer,
    crew,
    systems,
    allLightingFixtures,
    power,
    allLedScreens,
    ledPanels,
    ledSettings,
    stages,
    soundItems,
    riggPlan,
  ]);

  const addLedScreen = () => {
    const idx = ledScreens.length + linkedLedScreens.length;
    // Cycle the panel-grid preset alongside the badge color so each
    // newly-added screen renders with a visually distinct palette on
    // the pixel-map canvas — same convention as PDF imports.
    const preset =
      LED_PANEL_COLOR_PRESETS[idx % LED_PANEL_COLOR_PRESETS.length];
    setLedScreens((all) => [
      ...all,
      newLedScreen(defaultLedPanelKey, {
        name: `Screen ${idx + 1}`,
        color: LED_SCREEN_COLORS[idx % LED_SCREEN_COLORS.length],
        panelColorDark: preset.dark,
        panelColorLight: preset.light,
      }),
    ]);
  };

  const updateLedScreen = (id: string, patch: Partial<LedScreen>) => {
    if (id.startsWith("led-linked-")) {
      const sourceRowId = id.slice("led-linked-".length);
      // Snapshot the currently-resolved linked screen as the base for the
      // first edit, so we don't drop the qty-derived default layout when
      // the user simply changes a single field like color or notes.
      const current = allLedScreens.find((s) => s.id === id);
      const seed: LedLinkedMeta = current
        ? {
            panelKey: current.panelKey,
            panelsWide: current.panelsWide,
            panelsTall: current.panelsTall,
            color: current.color,
            outputIndex: current.outputIndex,
            notes: current.notes,
            customPanel: current.customPanel,
            // Carry the new LED shape / cell-marker / multi-processor
            // fields into the seed so an edit that touches one of them
            // doesn't blow away the rest. (Previously only the legacy
            // fields above were seeded, so the first edit silently
            // dropped any pre-existing shape/markers/processors.)
            disabledCells: current.disabledCells,
            shapeTemplate: current.shapeTemplate,
            panelMarkers: current.panelMarkers,
            processors: current.processors,
            bracketOverride: current.bracketOverride,
            rotationDeg: current.rotationDeg,
            // Touring-grade fields — seed every advanced field so the
            // first edit on a linked screen doesn't blow away an
            // existing rig accessory / port-mapping / brightness etc.
            brightnessNits: current.brightnessNits,
            refreshRateHz: current.refreshRateHz,
            bitDepth: current.bitDepth,
            hdrEnabled: current.hdrEnabled,
            curveType: current.curveType,
            cabinetRotation: current.cabinetRotation,
            transparencyMode: current.transparencyMode,
            processorPortAssignments: current.processorPortAssignments,
            maxCabinetsPerDataChain: current.maxCabinetsPerDataChain,
            maxCabinetsPerPowerChain: current.maxCabinetsPerPowerChain,
            voltageRegion: current.voltageRegion,
            powerOverheadPct: current.powerOverheadPct,
            powerFactor: current.powerFactor,
            cameraSafeMode: current.cameraSafeMode,
            scanRateProfile: current.scanRateProfile,
            genlockEnabled: current.genlockEnabled,
            backupSignalEnabled: current.backupSignalEnabled,
            signalLoopEnabled: current.signalLoopEnabled,
            curveAnglePerSeam: current.curveAnglePerSeam,
            rigAccessories: current.rigAccessories,
          }
        : defaultLinkedLedMeta(1, defaultLedPanelKey);
      setLedLinkedMeta((all) => {
        const prev = all[sourceRowId] ?? seed;
        const next: LedLinkedMeta = {
          ...prev,
          ...("panelKey" in patch ? { panelKey: patch.panelKey! } : {}),
          ...("panelsWide" in patch ? { panelsWide: patch.panelsWide! } : {}),
          ...("panelsTall" in patch ? { panelsTall: patch.panelsTall! } : {}),
          ...("color" in patch ? { color: patch.color! } : {}),
          ...("outputIndex" in patch
            ? { outputIndex: patch.outputIndex ?? null }
            : {}),
          ...("notes" in patch ? { notes: patch.notes ?? "" } : {}),
          ...("customPanel" in patch
            ? { customPanel: patch.customPanel }
            : {}),
          // Persist a user-typed display name for a linked screen. Empty
          // string clears the override and restores the auto-generated name.
          ...("name" in patch
            ? { nameOverride: patch.name ?? "" }
            : {}),
          // Per-screen annotation patches: forwarded into the linked
          // meta so the field survives unlink / relink cycles and is
          // available to any consumer reading from `linkedLedScreens`.
          ...("nameScale" in patch
            ? { nameScale: patch.nameScale }
            : {}),
          ...("markers" in patch
            ? { markers: patch.markers ? [...patch.markers] : [] }
            : {}),
          // New LED shape / cell-marker / multi-processor patches.
          // Without these branches, edits to a linked screen would
          // silently drop the new fields and the brief / BOM / capacity
          // readouts wouldn't reflect the producer's changes.
          ...("disabledCells" in patch
            ? {
                disabledCells: patch.disabledCells
                  ? [...patch.disabledCells]
                  : undefined,
              }
            : {}),
          ...("shapeTemplate" in patch
            ? { shapeTemplate: patch.shapeTemplate }
            : {}),
          ...("panelMarkers" in patch
            ? {
                panelMarkers: patch.panelMarkers
                  ? [...patch.panelMarkers]
                  : undefined,
              }
            : {}),
          ...("processors" in patch
            ? {
                processors: patch.processors
                  ? [...patch.processors]
                  : undefined,
              }
            : {}),
          ...("bracketOverride" in patch
            ? { bracketOverride: patch.bracketOverride }
            : {}),
          // Round-trip rotation patches on linked screens. Without
          // this branch a producer's rotation tweak would be dropped
          // on the next re-projection from the rigging row.
          ...("rotationDeg" in patch
            ? { rotationDeg: patch.rotationDeg }
            : {}),
          // Touring-grade patch branches — each new advanced field
          // must round-trip from the Inspector / RigAccessories /
          // PortMapping editors on linked screens.
          ...("brightnessNits" in patch
            ? { brightnessNits: patch.brightnessNits }
            : {}),
          ...("refreshRateHz" in patch
            ? { refreshRateHz: patch.refreshRateHz }
            : {}),
          ...("bitDepth" in patch ? { bitDepth: patch.bitDepth } : {}),
          ...("hdrEnabled" in patch
            ? { hdrEnabled: patch.hdrEnabled }
            : {}),
          ...("curveType" in patch ? { curveType: patch.curveType } : {}),
          ...("cabinetRotation" in patch
            ? { cabinetRotation: patch.cabinetRotation }
            : {}),
          ...("transparencyMode" in patch
            ? { transparencyMode: patch.transparencyMode }
            : {}),
          ...("processorPortAssignments" in patch
            ? {
                processorPortAssignments: patch.processorPortAssignments
                  ? [...patch.processorPortAssignments]
                  : undefined,
              }
            : {}),
          ...("maxCabinetsPerDataChain" in patch
            ? { maxCabinetsPerDataChain: patch.maxCabinetsPerDataChain }
            : {}),
          ...("maxCabinetsPerPowerChain" in patch
            ? { maxCabinetsPerPowerChain: patch.maxCabinetsPerPowerChain }
            : {}),
          ...("voltageRegion" in patch
            ? { voltageRegion: patch.voltageRegion }
            : {}),
          ...("powerOverheadPct" in patch
            ? { powerOverheadPct: patch.powerOverheadPct }
            : {}),
          ...("powerFactor" in patch
            ? { powerFactor: patch.powerFactor }
            : {}),
          ...("cameraSafeMode" in patch
            ? { cameraSafeMode: patch.cameraSafeMode }
            : {}),
          ...("scanRateProfile" in patch
            ? { scanRateProfile: patch.scanRateProfile }
            : {}),
          ...("genlockEnabled" in patch
            ? { genlockEnabled: patch.genlockEnabled }
            : {}),
          ...("backupSignalEnabled" in patch
            ? { backupSignalEnabled: patch.backupSignalEnabled }
            : {}),
          ...("signalLoopEnabled" in patch
            ? { signalLoopEnabled: patch.signalLoopEnabled }
            : {}),
          ...("curveAnglePerSeam" in patch
            ? { curveAnglePerSeam: patch.curveAnglePerSeam }
            : {}),
          ...("rigAccessories" in patch
            ? {
                rigAccessories: patch.rigAccessories
                  ? [...patch.rigAccessories]
                  : undefined,
              }
            : {}),
          ...("autoFitBeams" in patch
            ? { autoFitBeams: patch.autoFitBeams }
            : {}),
        };
        return { ...all, [sourceRowId]: next };
      });
      return;
    }
    setLedScreens((all) =>
      all.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    );
  };

  const updateLedCustomPanel = (
    id: string,
    patch: Partial<LedCustomPanel>,
  ) => {
    const screen = allLedScreens.find((s) => s.id === id);
    if (!screen) return;
    const base =
      screen.customPanel ??
      ({
        pixelWidth: CUSTOM_LED_PANEL.pixelWidth,
        pixelHeight: CUSTOM_LED_PANEL.pixelHeight,
        physicalWidth: CUSTOM_LED_PANEL.physicalWidth,
        physicalHeight: CUSTOM_LED_PANEL.physicalHeight,
        weight: CUSTOM_LED_PANEL.weight,
        power: CUSTOM_LED_PANEL.power,
      } as LedCustomPanel);
    updateLedScreen(id, { customPanel: { ...base, ...patch } });
  };

  const removeLedScreen = (id: string) => {
    if (id.startsWith("led-linked-")) return; // linked rows can't be deleted here
    setLedScreens((all) => all.filter((s) => s.id !== id));
  };

  const duplicateLedScreen = (id: string) => {
    const src = allLedScreens.find((s) => s.id === id);
    if (!src) return;
    setLedScreens((all) => [
      ...all,
      newLedScreen(defaultLedPanelKey, {
        name: `${src.name} (copy)`,
        panelKey: src.panelKey,
        panelsWide: src.panelsWide,
        panelsTall: src.panelsTall,
        color: src.color,
        outputIndex: null,
        notes: src.notes,
        customPanel: src.customPanel,
        // Carry the producer's pill scaling and cable markers across the
        // duplicate, so "copy of X" matches what they see on screen X.
        // Markers are deep-copied with fresh ids so editing the copy
        // never mutates the original (and to prevent React key clashes).
        nameScale: src.nameScale,
        markers: (src.markers ?? []).map((m, i) => ({
          ...m,
          id: `${src.id}-dup-${Date.now()}-${i}`,
        })),
      }),
    ]);
  };

  const updateLedSettings = (patch: Partial<LedSettings>) => {
    setLedSettings((s) => ({ ...s, ...patch }));
  };

  const exportLedScreen = async (id: string) => {
    const screen = allLedScreens.find((s) => s.id === id);
    if (!screen) return;
    try {
      const logoDataUrl = await getLogoDataUrl(ehsLogo);
      await exportScreenAsPng({
        screen,
        panels: ledPanels,
        settings: ledSettings,
        logoDataUrl,
        filenameFallback: tr("export.ledScreenFilenameFallback"),
      });
    } catch (err) {
      console.error("PNG export failed:", err);
      alert(tr("export.pngError"));
    }
  };

  // ---- Rigg Plan ----
  // Garbage-collect orphan trusses whenever a system gets deleted, so
  // the persisted blob never accumulates stale entries from removed
  // systems. Keyed on the live system-id list (stable string) so this
  // doesn't fire on every drag.
  const liveSystemIds = systems.map((s) => s.id).join("|");
  useEffect(() => {
    setRiggPlan((p) => {
      const live = new Set(systems.map((s) => s.id));
      const next: Record<string, RiggPlanTruss> = {};
      let changed = false;
      for (const [id, t] of Object.entries(p.trussById)) {
        if (live.has(id)) next[id] = t;
        else changed = true;
      }
      return changed ? { ...p, trussById: next } : p;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveSystemIds]);

  const updateRiggPlanVenue = (patch: Partial<RiggPlanVenue>) => {
    setRiggPlan((p) => {
      // If the producer has deleted the venue, an "update" implicitly
      // re-creates it with default dimensions before applying the patch
      // — so e.g. the drawing-importer's "Apply venue" path can always
      // populate a venue, even from the empty state.
      const base = p.venue ?? makeDefaultVenue();
      const venue = { ...base, ...patch };
      // Re-clamp every existing truss into the new venue so shrinking
      // the venue can never leave trusses dangling outside it.
      const trussById: Record<string, RiggPlanTruss> = {};
      for (const [id, t] of Object.entries(p.trussById)) {
        trussById[id] = clampTrussToVenue(t, venue);
      }
      return { venue, trussById };
    });
  };
  /** Add a fresh venue with default dimensions when the Rigg Plan is
   *  empty. Re-uses the default-build helper so any future tweak to
   *  defaults flows through both first-load and "Add venue". */
  const addRiggPlanVenue = () => {
    setRiggPlan((p) => ({
      ...p,
      venue: p.venue ?? makeDefaultVenue(),
    }));
  };
  /** Delete the venue and every truss associated with it. Trusses and
   *  the floor-plan backdrop image both live in the venue's coordinate
   *  frame, so keeping them around when the venue is gone would leak
   *  hidden state and surprise the user the next time they add a venue
   *  back. The rigging systems themselves are not touched — they stay
   *  on the Rigging Report and will get re-seeded with default truss
   *  positions the next time a venue exists. */
  const deleteRiggPlanVenue = () => {
    if (
      !confirm(
        tr("riggPlan.confirm.deleteVenue"),
      )
    ) {
      return;
    }
    setRiggPlan(() => ({ venue: null, trussById: {} }));
    setFloorPlanLibrary(emptyFloorPlanLibrary());
  };
  const updateRiggPlanTruss = (
    systemId: string,
    patch: Partial<RiggPlanTruss>,
  ) => {
    setRiggPlan((p) => {
      const prev = p.trussById[systemId];
      const next: RiggPlanTruss = prev
        ? { ...prev, ...patch }
        : ({
            x: 0,
            y: 0,
            z: 6,
            lengthM: 6,
            rotation: 0,
            ...patch,
          } as RiggPlanTruss);
      return {
        ...p,
        trussById: { ...p.trussById, [systemId]: next },
      };
    });
  };

  /** Apply the user-vetted output of the drawing analyser. Each category
   *  is added through the same factories the manual "+ New" buttons use,
   *  so the items appear in their respective tabs as plain editable rows. */
  const applyExtractedItems = (
    extracted: ExtractedItems,
    selection: ApplySelection,
  ): ApplySummary => {
    // Cross-PDF dedup is the heart of this function: when the producer
    // uploads several drawings of the same project, items that recur
    // across them (e.g. an "LX1" truss visible on the rigging plan AND
    // the lighting plan) must collapse to ONE entry on the report
    // rather than stack as duplicates. Each category gets a normalised-
    // name lookup against the existing report; matches are skipped and
    // counted in the returned summary.
    const summary = emptyApplySummary();

    // Venue (Rigg Plan)
    if (selection.applyVenue) {
      const venuePatch: Partial<RiggPlanVenue> = {};
      if (extracted.venue.widthM != null && extracted.venue.widthM > 0) {
        venuePatch.widthM = Math.max(1, Math.round(extracted.venue.widthM * 2) / 2);
      }
      if (extracted.venue.depthM != null && extracted.venue.depthM > 0) {
        venuePatch.depthM = Math.max(1, Math.round(extracted.venue.depthM * 2) / 2);
      }
      if (extracted.venue.ceilingM != null && extracted.venue.ceilingM > 0) {
        venuePatch.ceilingM = Math.max(
          1,
          Math.round(extracted.venue.ceilingM * 2) / 2,
        );
      }
      if (Object.keys(venuePatch).length > 0) {
        updateRiggPlanVenue(venuePatch);
        summary.venueApplied = true;
      }
    }

    // Trusses → new Systems on the Rigging Report.
    //
    // We also keep a name → systemId map covering BOTH systems that
    // already existed and the ones we are about to create, so the
    // Lighting step below can attach each fixture to the same system
    // its truss resolves to. Names are matched case-insensitively
    // because operators on a drawing aren't always consistent
    // ("LX1" vs "Lx 1" vs "lx-1").
    const newSystems: System[] = [];
    const usedNames = new Set(systems.map((s) => s.name));
    /** Lower-cased, whitespace-collapsed lookup key for truss names. */
    const trussKey = (s: string): string =>
      s.trim().toLowerCase().replace(/[\s_-]+/g, "");
    const systemIdByTrussName = new Map<string, string>();
    for (const sys of systems) {
      const k = trussKey(sys.name);
      if (k) systemIdByTrussName.set(k, sys.id);
    }

    /** Add `key → id` to the map only the FIRST time we see `key`.
     *  Used so that if the analyser emits two trusses with the same
     *  label ("LX1", "LX1"), all fixtures tagged "LX1" attach to the
     *  same (first) system instead of being split between them. */
    const indexTruss = (key: string, id: string) => {
      if (key && !systemIdByTrussName.has(key)) {
        systemIdByTrussName.set(key, id);
      }
    };

    /** Map the analyser's per-motor capacity in kg onto one of the
     *  two configured hoist models. We split at the geometric mean
     *  (~707 kg) of 500 and 1000 kg, but force anything ≥ 750 kg up
     *  to the 1 t model so a "1 t" tag never silently rounds down. */
    const pickHoistIndex = (kg: number | null): number => {
      if (kg == null) return 0;
      return kg >= 750 ? 1 : 0;
    };

    if (selection.trussIndexes.size > 0) {
      extracted.trusses.forEach((t, i) => {
        if (!selection.trussIndexes.has(i)) return;
        const rawName = t.name && t.name.trim() ? t.name.trim() : "";
        // Cross-PDF dedup: if a system with this normalised name
        // already exists OR we just created one in this same apply
        // call (handles "LX1" appearing twice in the same PDF too),
        // skip — the existing system stands. The fixture-linking map
        // already points at it, so any lighting tagged with this
        // name will still wire up correctly.
        const dedupKey = rawName ? trussKey(rawName) : "";
        if (dedupKey && systemIdByTrussName.has(dedupKey)) {
          summary.systems.skipped += 1;
          return;
        }
        let name =
          rawName || `LX${systems.length + newSystems.length + 1}`;
        while (usedNames.has(name)) name += "'";
        usedNames.add(name);
        const sys = makeSystem(name);
        sys.pointCount = Math.min(8, Math.max(1, Math.round(t.pointCount || 3)));
        sys.hoistIndex = pickHoistIndex(t.hoistKg);
        newSystems.push(sys);
        summary.systems.added += 1;
        // Index BOTH the original PDF label and the (possibly-suffixed)
        // final name, so a fixture that says trussName="LX1" still
        // resolves even if we had to rename the system to "LX1'" to
        // dedupe. First-write-wins: the FIRST truss row labelled "LX1"
        // owns that label for fixture-linking purposes.
        if (rawName) indexTruss(trussKey(rawName), sys.id);
        indexTruss(trussKey(name), sys.id);
      });
    }

    // Lighting fixtures.
    //
    // Each extracted fixture row may carry a `trussName` from the PDF
    // ("LX1", "FOH", …). We try to link it to:
    //   1. an existing system on the Rigging Report,
    //   2. one of the systems we just created above, or
    //   3. as a last resort, a fresh system auto-created on the fly so
    //      that "fixtures on the same truss end up on the same system"
    //      even when the user didn't tick the matching truss row.
    //
    // Once we have a target system, the fixture goes IN AS A
    // `fixtureRows` row on that system so it shows up under the
    // Rigging Report's "Lighting Fixtures" group AND contributes to
    // the system's load. We try to match the analyser's name against
    // the user's `inventory.Fixtures` library first — a match means we
    // use the user's calibrated weight / wattage / DMX modes instead
    // of the (often rough) PDF numbers. Misses fall back to a custom
    // row carrying the analyser's data verbatim. Fixtures with no
    // truss tag still go to the standalone `showFixtures` list so the
    // user can decide where to assign them.
    if (selection.lightingIndexes.size > 0) {
      const standaloneAdditions: ShowFixture[] = [];
      // systemId → Row[] to append for systems that already exist
      // (newSystems are mutated in place since we hold the references).
      const fixtureRowPatches = new Map<string, Row[]>();
      // Notes coming off the analyser need to ride along with the
      // resulting fixtureRow via linkedMeta (same way the user's own
      // notes are stored). Collected here, committed once below so we
      // don't fire one setLinkedMeta per fixture.
      const noteSeeds: Record<string, string> = {};
      // Build a "this system already has fixture X" lookup for dedup.
      // We use the same `normalizeFixtureName` the inventory matcher
      // uses, which strips parenthetical suffixes like "(32.0kg)" and
      // collapses non-alphanumerics — so an analyser hit on "Clay
      // Paky Mythos 2" matches an existing inventory row whose stored
      // name is "Clay Paky Mythos 2 (32.0kg)". A plain space-collapse
      // would have missed that case and let duplicates through across
      // PDFs. The set tracks `${systemId}|${normalisedName}` pairs.
      const fixtureNameKey = (s: string) => normalizeFixtureName(s);
      const existingFixtureKeys = new Set<string>();
      for (const sys of systems) {
        for (const row of sys.fixtureRows) {
          // A row is either inventory-backed (selectedIndex points at
          // a Fixtures library entry) or custom (the `custom` field
          // carries the raw item with its name). Custom rows always
          // win when present because that's how `makeCustomRow` builds
          // analyser-imported fixtures that didn't match the library.
          const name = row.custom
            ? row.custom.name
            : (inventory.Fixtures[row.selectedIndex]?.name ?? "");
          const key = fixtureNameKey(name);
          if (key) existingFixtureKeys.add(`${sys.id}|${key}`);
        }
      }
      // Also dedup against any standalone show-fixtures that aren't
      // assigned to a system yet — same name + same systemId="" cell.
      for (const sf of showFixtures) {
        const key = fixtureNameKey(sf.name);
        if (key) existingFixtureKeys.add(`${sf.systemId}|${key}`);
      }

      extracted.lighting.forEach((f, i) => {
        if (!selection.lightingIndexes.has(i)) return;
        let systemId = "";
        const trussRaw = (f.trussName ?? "").trim();
        if (trussRaw) {
          const k = trussKey(trussRaw);
          const existingId = systemIdByTrussName.get(k);
          if (existingId) {
            systemId = existingId;
          } else {
            // Auto-create a system for this fixture's truss so all
            // fixtures sharing the same trussName collapse onto it.
            let name = trussRaw;
            while (usedNames.has(name)) name += "'";
            usedNames.add(name);
            const sys = makeSystem(name);
            newSystems.push(sys);
            // Account for this auto-created system in the summary so
            // the importer's "Added N items" banner matches reality —
            // otherwise lighting that conjures a fresh truss is
            // silently invisible to the user.
            summary.systems.added += 1;
            indexTruss(k, sys.id);
            indexTruss(trussKey(name), sys.id);
            systemId = sys.id;
          }
        }

        const qty = Math.max(1, Math.round(f.qty || 1));
        const fixtureName = f.name || "Fixture";
        const weight = f.weightKg != null ? Math.max(0, f.weightKg) : 0;
        const watts = f.watts != null ? Math.max(0, Math.round(f.watts)) : 0;

        // Cross-PDF dedup: if this same fixture name is already on
        // the same target system (or already in the unassigned
        // standalone list when systemId === ""), skip. We do NOT sum
        // quantities — the producer can edit quantities by hand on
        // the source row, but adding an N-th identical row would be
        // surprising. Track the (systemId, name) we just placed so a
        // single PDF that lists the same fixture twice also dedupes.
        const dedupKey = `${systemId}|${fixtureNameKey(fixtureName)}`;
        if (existingFixtureKeys.has(dedupKey)) {
          summary.fixtures.skipped += 1;
          return;
        }
        existingFixtureKeys.add(dedupKey);
        summary.fixtures.added += 1;

        if (systemId) {
          // Build a fixtureRow on the target rigging system.
          const matchedIdx = matchInventoryFixture(fixtureName);
          const row: Row =
            matchedIdx >= 0
              ? {
                  id: newId("row"),
                  category: "Fixtures",
                  selectedIndex: matchedIdx,
                  qty,
                }
              : {
                  ...makeCustomRow("Fixtures", {
                    name: fixtureName,
                    weight,
                    wattage: watts,
                    area: 0,
                  }),
                  qty,
                };
          // newSystems are local objects we still hold a reference to,
          // so we can push into them directly. Existing systems live
          // in state, so we collect patches and apply them in the
          // single setSystems update below.
          const newSys = newSystems.find((s) => s.id === systemId);
          if (newSys) {
            newSys.fixtureRows.push(row);
          } else {
            const list = fixtureRowPatches.get(systemId) ?? [];
            list.push(row);
            fixtureRowPatches.set(systemId, list);
          }
          // Carry the analyser's notes onto the linkedMeta entry so
          // they survive the showFixtures → fixtureRows routing.
          if (f.notes && f.notes.trim()) {
            noteSeeds[row.id] = f.notes.trim();
          }
        } else {
          // No truss tag → leave it as an unassigned standalone fixture
          // so the user can manually pick a system on the Lighting tab.
          standaloneAdditions.push({
            ...makeShowFixture(),
            name: fixtureName,
            qty,
            weight,
            watts,
            systemId: "",
            notes: f.notes || "",
          });
        }
      });

      if (standaloneAdditions.length > 0) {
        setShowFixtures((all) => [...all, ...standaloneAdditions]);
      }

      // Commit existing-system patches together with the newSystems
      // append in a single setSystems update so React only re-renders
      // once and the wiring stays consistent.
      if (newSystems.length > 0 || fixtureRowPatches.size > 0) {
        setSystems((all) => {
          const patched =
            fixtureRowPatches.size > 0
              ? all.map((s) => {
                  const extra = fixtureRowPatches.get(s.id);
                  return extra
                    ? { ...s, fixtureRows: [...s.fixtureRows, ...extra] }
                    : s;
                })
              : all;
          return [...patched, ...newSystems];
        });
        if (newSystems.length > 0) {
          // Focus the first newly-added one so the user can see the
          // result when they switch to the Rigging Report.
          setActiveSystemId(newSystems[0].id);
        }
      }

      // Seed analyser-supplied notes onto each linked fixture's meta
      // so they're visible on the Lighting tab and don't get lost.
      const noteRowIds = Object.keys(noteSeeds);
      if (noteRowIds.length > 0) {
        setLinkedMeta((all) => {
          const next = { ...all };
          for (const rowId of noteRowIds) {
            const prev = next[rowId] ?? defaultLinkedMeta();
            next[rowId] = { ...prev, notes: noteSeeds[rowId] };
          }
          return next;
        });
      }
    } else if (newSystems.length > 0) {
      // Lighting step skipped, but we still committed new trusses.
      setSystems((all) => [...all, ...newSystems]);
      setActiveSystemId(newSystems[0].id);
    }

    // LED screens
    if (selection.ledIndexes.size > 0) {
      const additions: LedScreen[] = [];
      // Cross-PDF dedup: collapse on case-insensitive screen name.
      // Includes both stand-alone LED screens and any LED rows that
      // ride along on a rigging system (`linkedLedScreens`) — both
      // render on the LED tab so users would see them as duplicates
      // either way. Without seeding from `linkedLedScreens` an
      // import could quietly add a second copy of a screen that's
      // already linked from a system row.
      const ledNameKey = (s: string) =>
        s.trim().toLowerCase().replace(/\s+/g, " ");
      const existingLedNames = new Set<string>();
      for (const s of ledScreens) {
        const k = ledNameKey(s.name);
        if (k) existingLedNames.add(k);
      }
      for (const s of linkedLedScreens) {
        const k = ledNameKey(s.name);
        if (k) existingLedNames.add(k);
      }
      // Resolve the active panel's physical size once so we can convert
      // analyser-supplied screen sizes in metres (e.g. "5 x 3 m") into
      // panel counts. Panels with zero physical size (the synthetic
      // Custom fallback) are skipped to avoid divide-by-zero.
      const defaultPanel = getLedPanel(defaultLedPanelKey, ledPanels);
      const panelWm = defaultPanel.physicalWidth;
      const panelHm = defaultPanel.physicalHeight;
      const metresToPanels = (
        sizeM: number | null,
        panelM: number,
      ): number | undefined => {
        if (sizeM == null || sizeM <= 0 || panelM <= 0) return undefined;
        return Math.max(1, Math.round(sizeM / panelM));
      };
      extracted.ledScreens.forEach((s, i) => {
        if (!selection.ledIndexes.has(i)) return;
        const idx = ledScreens.length + additions.length;
        const screenName = s.name || `Screen ${idx + 1}`;
        const dedupKey = ledNameKey(screenName);
        if (dedupKey && existingLedNames.has(dedupKey)) {
          summary.ledScreens.skipped += 1;
          return;
        }
        existingLedNames.add(dedupKey);
        summary.ledScreens.added += 1;
        // Panel grid wins when the analyser gave one outright; otherwise
        // we fall back to the metric size from the drawing.
        const wide =
          s.panelsWide != null && s.panelsWide > 0
            ? Math.round(s.panelsWide)
            : metresToPanels(s.widthM, panelWm);
        const tall =
          s.panelsTall != null && s.panelsTall > 0
            ? Math.round(s.panelsTall)
            : metresToPanels(s.heightM, panelHm);
        // Cycle through the curated dual-color presets so each
        // imported screen renders with its own panel-grid palette on
        // the pixel-map canvas — important when 3+ screens come in
        // from the same PDF and the producer needs to tell them apart
        // at a glance. We also push the preset's `light` value into
        // the badge color field for visual consistency.
        const preset =
          LED_PANEL_COLOR_PRESETS[idx % LED_PANEL_COLOR_PRESETS.length];
        additions.push(
          newLedScreen(defaultLedPanelKey, {
            name: screenName,
            color: preset.light,
            panelColorDark: preset.dark,
            panelColorLight: preset.light,
            panelsWide: wide,
            panelsTall: tall,
            notes: s.notes || "",
          }),
        );
      });
      if (additions.length > 0) {
        setLedScreens((all) => [...all, ...additions]);
      }
    }

    // Stages — cross-PDF dedup on case-insensitive stage name.
    if (selection.stageIndexes.size > 0) {
      const additions: Stage[] = [];
      const stageNameKey = (s: string) =>
        s.trim().toLowerCase().replace(/\s+/g, " ");
      const existingStageNames = new Set<string>();
      for (const s of stages) {
        const k = stageNameKey(s.name);
        if (k) existingStageNames.add(k);
      }
      extracted.stages.forEach((st, i) => {
        if (!selection.stageIndexes.has(i)) return;
        const stageName =
          st.name ||
          tr("stage.defaultNumberedName", {
            number: stages.length + additions.length + 1,
          });
        const dedupKey = stageNameKey(stageName);
        if (dedupKey && existingStageNames.has(dedupKey)) {
          summary.stages.skipped += 1;
          return;
        }
        existingStageNames.add(dedupKey);
        summary.stages.added += 1;
        const base = makeDefaultStage(stageName);
        additions.push({
          ...base,
          width: st.widthM > 0 ? st.widthM : base.width,
          depth: st.depthM > 0 ? st.depthM : base.depth,
          notes: st.notes || "",
        });
      });
      if (additions.length > 0) {
        setStages((all) => [...all, ...additions]);
      }
    }

    // Sound — cross-PDF dedup on case-insensitive item name. We use
    // name alone (rather than name+category) because the analyser
    // rarely emits the same name for two different physical items;
    // overly-strict matching would let "PA Mains" and "Subs" of the
    // same brand resurface twice across PDFs even when they are the
    // same hardware.
    if (selection.soundIndexes.size > 0) {
      const additions: SoundItem[] = [];
      const soundNameKey = (s: string) =>
        s.trim().toLowerCase().replace(/\s+/g, " ");
      const existingSoundNames = new Set<string>();
      for (const s of soundItems) {
        const k = soundNameKey(s.name);
        if (k) existingSoundNames.add(k);
      }
      extracted.sound.forEach((s, i) => {
        if (!selection.soundIndexes.has(i)) return;
        const itemName = s.name || "Sound";
        const dedupKey = soundNameKey(itemName);
        if (dedupKey && existingSoundNames.has(dedupKey)) {
          summary.sound.skipped += 1;
          return;
        }
        existingSoundNames.add(dedupKey);
        summary.sound.added += 1;
        const base = makeSoundItem();
        additions.push({
          ...base,
          name: itemName,
          qty: Math.max(1, Math.round(s.qty || 1)),
          weightPerUnit: s.weightKg != null ? Math.max(0, s.weightKg) : 0,
          powerPerUnit: s.watts != null ? Math.max(0, Math.round(s.watts)) : 0,
          notes: s.notes || "",
        });
      });
      if (additions.length > 0) {
        setSoundItems((all) => [...all, ...additions]);
      }
    }

    return summary;
  };

  // ---- Crew Report ----

  const dispatchBriefEmails = useCallback(
    async (
      data: ReturnType<typeof buildBrief>,
      recipients: { crewId: string; freelancerUserId: string }[],
      notificationType: "send_request" | "share_brief",
    ) => {
      const token = await getToken();
      if (!token) throw new Error(tr("crew.dispatch.signIn"));
      const baseUrl =
        (typeof import.meta !== "undefined" &&
          (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL) ||
        "/";
      const post = async (withId: string | null) => {
        const response = await fetch(`${baseUrl}api/portal/briefs`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            ...(withId ? { id: withId } : {}),
            ...(currentProjectId ? { project_id: currentProjectId } : {}),
            ...(venueId ? { venue_id: venueId } : {}),
            data,
            recipients,
            send_email: true,
            notification_type: notificationType,
          }),
        });
        const json = (await response.json().catch(() => null)) as {
          ok?: boolean;
          error?: string;
          brief?: { id?: string } | null;
          delivery?: {
            sent?: number;
            skipped?: number;
            alreadySent?: number;
          };
        } | null;
        return { response, json };
      };

      let result = await post(activeBriefId);
      if (
        !result.response.ok &&
        activeBriefId &&
        (result.response.status === 403 || result.response.status === 404)
      ) {
        setActiveBriefId(null);
        result = await post(null);
      }
      if (!result.response.ok || !result.json?.ok || !result.json.brief?.id) {
        throw new Error(
          result.json?.error ||
            tr("crew.dispatch.sendErrorStatus", { status: result.response.status }),
        );
      }
      setActiveBriefId(result.json.brief.id);
      const deliveryToast = briefDeliveryToast(result.json.delivery);
      toast[deliveryToast.kind](
        tr(deliveryToast.messageKey, deliveryToast.params),
      );
      return result.json;
    },
    [activeBriefId, currentProjectId, getToken, venueId, tr],
  );

  /** Send brief requests to a batch of linked freelancers. The flow is:
   *    1. Add a Requested crew row for each freelancer (so the
   *       producer's call sheet shows the pending headcount/cost
   *       immediately, even before the freelancer responds).
   *    2. POST the full brief + recipient list to
   *       `/api/portal/briefs`. Reuses `activeBriefId` if we've
   *       already created the server brief for this project so the
   *       freelancers all see the same brief id.
   *    3. Cache the returned brief.id back in state so subsequent
   *       sends append to the same brief, and the producer's polling
   *       loop has something to address.
   *
   *  Failures bubble back through `sendError`; optimistic crew rows
   *  are rolled back on the same path so the call sheet stays in sync
   *  with what the server actually accepted. */
  const sendCrewRequests = useCallback(
    async (rows: {
      crewId?: string;
      userId: string;
      fullName: string;
      primaryRole: string | null;
        /** Replacement requests preserve the exact declined role slot,
         *  even when the directory profile's primary role differs. */
        role?: CrewMember["role"];
      phone?: string;
      dietaryTags?: string[];
      allergens?: string[];
    }[]) => {
      if (
        currentProjectIsArchived ||
        currentProjectServerStatus === "completed" ||
        currentProjectServerStatus === "archived"
      ) {
        setSendError(tr("project.status.terminalDispatchDisabled"));
        return;
      }
      if (rows.length === 0 || sendingRequests) return;
      const uniqueRows = Array.from(
        new Map(rows.map((row) => [row.userId, row])).values(),
      ).filter((row) => {
        const existing = row.crewId
          ? crew.find((member) => member.id === row.crewId)
          : crew.find(
              (member) => member.freelancerUserId === row.userId,
            );
        // A replacement targets the existing declined roster slot by its
        // immutable crew id. Reuse that local row (and its planned windows)
        // rather than growing the active roster denominator. Other
        // requested/accepted rows remain ineligible for mutation.
        return row.crewId
          ? !existing?.requestStatus || existing.requestStatus === "declined"
          : !existing?.requestStatus;
      });
      if (uniqueRows.length === 0) return;
      // Seed every new row with the project's full schedule so the
      // producer can immediately tick days off — same default as the
      // manual + Add crew button. Computed once outside the map so a
      // batch send doesn't re-walk the date range per freelancer.
      const defaultDays = expandProjectDays(reportDate, reportEndDate);
      // Auto-fill call/off times from the project schedule covering
      // the seeded days. Earliest setup-time → latest downrig-time
      // across all phases that touch the run, so the producer sees a
      // realistic shift window on the new row out of the box.
      const projSchedule = buildProjectSchedule(
        reportDate,
        reportEndDate,
        extraSchedule,
      );
      const previousMembersById = new Map<string, CrewMember>();
      const createdMemberIds = new Set<string>();
      const requestMembers: CrewMember[] = uniqueRows.map((r) => {
        const existing = r.crewId
          ? crew.find((member) => member.id === r.crewId)
          : undefined;
        if (existing) {
          previousMembersById.set(existing.id, existing);
          return {
            ...existing,
            name: r.fullName,
            freelancerUserId: r.userId,
            requestStatus: "requested" as CrewRequestStatus,
            declineReason: null,
            phone: r.phone ?? existing.phone,
            dietaryTags:
              r.dietaryTags && r.dietaryTags.length > 0
                ? [...r.dietaryTags]
                : existing.dietaryTags,
            allergens:
              r.allergens && r.allergens.length > 0
                ? [...r.allergens]
                : existing.allergens,
          };
        }
        const m = makeCrewMember(r.fullName);
        createdMemberIds.add(m.id);
        m.role = skillToCrewRole(r.primaryRole);
        if (r.role) m.role = r.role;
        m.freelancerUserId = r.userId;
        m.requestStatus = "requested" as CrewRequestStatus;
        m.declineReason = null;
        // Copy contact + catering data from the portal directory so
        // the producer sees phone/food/allergens on the call sheet
        // the moment the row appears — no need to wait for the
        // freelancer to accept the brief.
        if (r.phone) m.phone = r.phone;
        if (r.dietaryTags && r.dietaryTags.length > 0)
          m.dietaryTags = [...r.dietaryTags];
        if (r.allergens && r.allergens.length > 0)
          m.allergens = [...r.allergens];
        if (defaultDays.length > 0) {
          m.assignedDates = [...defaultDays];
          const t = pickScheduleTimesForDates(defaultDays, projSchedule, {
            callTime: m.callTime,
            offTime: m.offTime,
          });
          m.callTime = t.callTime;
          m.offTime = t.offTime;
        }
        return m;
      });
      const requestMembersById = new Map(
        requestMembers.map((member) => [member.id, member]),
      );
      const nextCrew = [
        ...crew.map(
          (member) => requestMembersById.get(member.id) ?? member,
        ),
        ...requestMembers.filter((member) => createdMemberIds.has(member.id)),
      ];
      setSendingRequests(true);
      setSendError(null);
      // Optimistic — render the Requested rows immediately. We undo
      // this in the catch block on a network failure so the request
      // can be retried without orphan rows hanging around.
      setCrew(nextCrew);
      try {
        // Build the brief from the next crew so each new freelancer's
        // assignment is present in the payload. recipientCrewId stays
        // null on this batch send — each freelancer is addressed via
        // the top-level recipients[] list, not via the legacy
        // single-recipient share-link channel.
        const data = buildBrief({
          ...briefInput,
          crew: nextCrew,
          recipientCrewId: null,
        });
        const recipients = requestMembers.map((m) => ({
          crewId: m.id,
          freelancerUserId: m.freelancerUserId!,
        }));
        await dispatchBriefEmails(data, recipients, "send_request");
      } catch (e) {
        const msg =
          e instanceof Error ? e.message : tr("crew.dispatch.sendError");
        setSendError(msg);
        // Roll back the optimistic rows so the producer can re-tick
        // and try again without ending up with duplicates.
        setCrew((all) =>
          all
            .filter((member) => !createdMemberIds.has(member.id))
            .map(
              (member) =>
                previousMembersById.get(member.id) ?? member,
            ),
        );
      } finally {
        setSendingRequests(false);
      }
    },
    [
      crew,
      briefInput,
      sendingRequests,
      dispatchBriefEmails,
      reportDate,
      reportEndDate,
      extraSchedule,
      currentProjectIsArchived,
      currentProjectServerStatus,
      tr,
    ],
  );

  const sendLinkedCrewRequests = useCallback(
    (members: CrewMember[]) =>
      sendCrewRequests(
        members
          .filter(
            (member): member is CrewMember & { freelancerUserId: string } =>
              !!member.freelancerUserId && !member.requestStatus,
          )
          .map((member) => ({
            crewId: member.id,
            userId: member.freelancerUserId,
            fullName: member.name,
            primaryRole: member.role,
            phone: member.phone,
            dietaryTags: member.dietaryTags,
            allergens: member.allergens,
          })),
      ),
    [sendCrewRequests],
  );

  /** Replacement dispatch targets the existing declined producer row by
   *  crew id, preserving its planned windows and exact role. The old
   *  declined assignment remains immutable server history, while accepted
   *  roles held by the same freelancer remain untouched. */
  const replaceCrewRole = useCallback(
    (member: CrewMember, candidate: FreelancerCandidate) =>
      sendCrewRequests([
        {
          crewId: member.id,
          userId: candidate.userId,
          fullName: candidate.fullName,
          primaryRole: member.role,
          role: member.role,
          phone: candidate.phone,
          dietaryTags: candidate.dietaryTags,
          allergens: candidate.allergens,
        },
      ]),
    [sendCrewRequests],
  );

  const emailAssignedCrewBriefs = useCallback(async () => {
    if (sendingRequests) return;
    const recipients = crew
      .filter(
        (member): member is CrewMember & { freelancerUserId: string } =>
          Boolean(member.freelancerUserId),
      )
      .map((member) => ({
        crewId: member.id,
        freelancerUserId: member.freelancerUserId,
      }));
    if (recipients.length === 0) {
      toast.error(tr("crew.dispatch.noLinkedEmail"));
      return;
    }
    setSendingRequests(true);
    setSendError(null);
    try {
      const data = buildBrief({
        ...briefInput,
        crew,
        recipientCrewId: null,
      });
      await dispatchBriefEmails(data, recipients, "share_brief");
      const linkedIds = new Set(recipients.map((recipient) => recipient.crewId));
      setCrew((members) =>
        members.map((member) =>
          linkedIds.has(member.id)
            ? { ...member, requestStatus: member.requestStatus ?? "requested" }
            : member,
        ),
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : tr("crew.dispatch.emailError");
      setSendError(message);
      toast.error(message);
    } finally {
      setSendingRequests(false);
    }
  }, [
    briefInput,
    crew,
    dispatchBriefEmails,
    sendingRequests,
    tr,
  ]);

  /** Producer-side polling. Whenever the producer is on the Crew tab
   *  and we have a server brief id, fetch the assignments every 15s
   *  and reconcile each crew row's `requestStatus` /
   *  `briefAssignmentId` with the server's truth. We additionally
   *  derive a "no reply" status when the assignment has been pending
   *  for more than 24 hours — the server doesn't track that itself,
   *  it just reports `decision: "pending"` + `createdAt`. */
  useEffect(() => {
    if (mainView !== "crew" || !activeBriefId) return;
    let cancelled = false;
    const baseUrl =
      (typeof import.meta !== "undefined" &&
        (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL) ||
      "/";
    const NO_REPLY_AFTER_MS = 24 * 60 * 60 * 1000;
    const fetchAssignments = async () => {
      try {
        const token = await getToken();
        if (cancelled) return;
        const res = await fetch(
          `${baseUrl}api/portal/briefs/${activeBriefId}/assignments`,
          {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          },
        );
        if (cancelled || !res.ok) return;
        const json = (await res.json()) as {
          ok?: boolean;
          assignments?: Array<{
            id: string;
            freelancerUserId: string;
            crewId: string | null;
            // `too_late` is set server-side on first-to-accept-wins
            // briefs when a sibling candidate accepts before this one.
            decision:
              | "pending"
              | "accepted"
              | "declined"
              | "too_late";
            shiftResponses?: Record<string, "accepted" | "declined"> | null;
            declineReason?: string | null;
            createdAt: string;
          }>;
        };
        if (cancelled || !json.ok || !Array.isArray(json.assignments)) return;
        const now = Date.now();
        const byRoleSlot = new Map<
          string,
          {
            id: string;
            status: CrewRequestStatus;
            shiftResponses?: Record<string, "accepted" | "declined">;
            declineReason: string | null;
          }
        >();
        for (const a of json.assignments) {
          const created = Date.parse(a.createdAt);
          let status: CrewRequestStatus;
          if (
            a.decision === "accepted" &&
            a.shiftResponses &&
            Object.values(a.shiftResponses).includes("declined")
          ) {
            status = "partially_accepted";
          } else if (a.decision === "accepted") status = "accepted";
          else if (a.decision === "declined") status = "declined";
          else if (a.decision === "too_late") status = "too_late";
          else if (
            Number.isFinite(created) &&
            now - created > NO_REPLY_AFTER_MS
          )
            status = "no-reply";
          else status = "requested";
          // crewId is the immutable producer row / role-slot identity.
          // Never collapse a second role merely because it belongs to the
          // same freelancer account.
          byRoleSlot.set(`${a.freelancerUserId}\u0000${a.crewId ?? ""}`, {
            id: a.id,
            status,
            shiftResponses:
              a.shiftResponses &&
              typeof a.shiftResponses === "object"
                ? { ...a.shiftResponses }
                : undefined,
            declineReason:
              typeof a.declineReason === "string"
                ? a.declineReason
                : null,
          });
        }
        // Patch in-place by the producer crew row, not account identity.
        // Manual in-house
        // rows are left exactly as the producer entered them.
        setCrew((all) => {
          let changed = false;
          const next = all.map((m) => {
            if (!m.freelancerUserId) return m;
            const sa = byRoleSlot.get(`${m.freelancerUserId}\u0000${m.id}`);
            if (!sa) return m;
            if (
              m.requestStatus === sa.status &&
              m.briefAssignmentId === sa.id &&
              m.declineReason === sa.declineReason &&
              JSON.stringify(m.shiftResponses ?? {}) ===
                JSON.stringify(sa.shiftResponses ?? {})
            )
              return m;
            changed = true;
            return {
              ...m,
              requestStatus: sa.status,
              briefAssignmentId: sa.id,
              shiftResponses: sa.shiftResponses,
              declineReason: sa.declineReason,
            };
          });
          return changed ? next : all;
        });
      } catch {
        /* swallow — next interval will retry */
      }
    };
    void fetchAssignments();
    // SSE gives producers near-real-time response updates while the
    // interval remains as a resilient fallback for dropped connections.
    const unsubscribeCrewResponses = subscribeCrewResponses(
      getToken,
      () => {
        if (!cancelled) {
          void fetchAssignments();
        }
      },
    );
    const t = window.setInterval(fetchAssignments, 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
      unsubscribeCrewResponses();
    };
  }, [mainView, activeBriefId, getToken]);

  /** Days covered by each schedule phase ({setup, rehearsal, show,
   *  downrig} → ISO date arrays), derived from the producer's
   *  reportDate/reportEndDate plus extraSchedule. Threaded down to
   *  MasterCrewSheet so each crew row can offer one-click "fill from
   *  Setup days", "from Show days", etc. quick-pick buttons. Empty
   *  phases are omitted so the row only shows buttons for phases the
   *  producer has actually scheduled. */
  const phaseDays = useMemo<Partial<Record<SchedulePhaseKey, string[]>>>(() => {
    const sched = buildProjectSchedule(
      reportDate,
      reportEndDate,
      extraSchedule,
    );
    const out: Partial<Record<SchedulePhaseKey, string[]>> = {};
    (Object.keys(sched) as SchedulePhaseKey[]).forEach((k) => {
      const segs = sched[k];
      if (!segs || segs.length === 0) return;
      const set = new Set<string>();
      for (const seg of segs) {
        for (const d of expandProjectDays(seg.from, seg.to || seg.from)) {
          set.add(d);
        }
      }
      const days = [...set].sort();
      if (days.length > 0) out[k] = days;
    });
    return out;
  }, [reportDate, reportEndDate, extraSchedule]);

  const phaseShiftTimes = useMemo<CrewShiftTimeMap>(() => {
    const schedule = buildProjectSchedule(
      reportDate,
      reportEndDate,
      extraSchedule,
    );
    const times: CrewShiftTimeMap = {};
    for (const phaseName of Object.keys(schedule) as CrewShiftPhaseKey[]) {
      for (const segment of schedule[phaseName] ?? []) {
        if (
          !segment.timeTbd &&
          (!segment.fromTime || !segment.toTime)
        ) {
          continue;
        }
        for (const dateKey of expandProjectDays(
          segment.from,
          segment.to || segment.from,
        )) {
          times[crewShiftAssignmentKey(dateKey, phaseName)] = {
            startTime: segment.timeTbd ? "" : segment.fromTime ?? "",
            endTime: segment.timeTbd ? "" : segment.toTime ?? "",
            timeTbd: segment.timeTbd === true,
          };
        }
      }
    }
    return times;
  }, [reportDate, reportEndDate, extraSchedule]);

  useEffect(() => {
    const allowedKeys = new Set(scheduledShiftKeys(phaseDays));
    setCrew((current) => {
      let changed = false;
      const next = current.map((member) => {
        const legacyKeys = (member.assignedDates ?? []).flatMap((dateKey) =>
          (Object.keys(phaseDays) as CrewShiftPhaseKey[])
            .filter((phaseName) => phaseDays[phaseName]?.includes(dateKey))
            .map((phaseName) =>
              crewShiftAssignmentKey(dateKey, phaseName),
            ),
        );
        const selected = filterShiftSelectionsToSchedule(
          member.assignedShiftPhases ?? legacyKeys,
          allowedKeys,
        );
        const selectedKeys = [...selected].sort();
        const assignedDates = assignedDatesFromShiftPhases(selected);
        const assignedShiftWindows = shiftWindowsForSelections(
          selected,
          phaseShiftTimes,
          member.assignedShiftWindows ?? {},
          member.assignedShiftTimes ?? {},
        );
        const assignedShiftTimes = firstShiftTimesFromWindows(
          selected,
          assignedShiftWindows,
        );
        const assignedShiftTasks = Object.fromEntries(
          selectedKeys.flatMap((key) => {
            const tasks = member.assignedShiftTasks?.[key];
            return tasks?.length ? [[key, [...tasks]]] : [];
          }),
        );
        const summary = summarizeShiftWindows(
          selected,
          assignedShiftWindows,
          {
            startTime: member.callTime,
            endTime: member.offTime,
          },
        );
        const nextMember: CrewMember = {
          ...member,
          assignedDates,
          assignedShiftPhases: selectedKeys,
          assignedShiftTimes,
          assignedShiftWindows,
          assignedShiftTasks,
          callTime: summary.startTime,
          offTime: summary.endTime,
        };
        if (
          JSON.stringify(nextMember.assignedDates) !==
            JSON.stringify(member.assignedDates ?? []) ||
          JSON.stringify(nextMember.assignedShiftPhases) !==
            JSON.stringify(member.assignedShiftPhases ?? []) ||
          JSON.stringify(nextMember.assignedShiftTimes) !==
            JSON.stringify(member.assignedShiftTimes ?? {}) ||
          JSON.stringify(nextMember.assignedShiftWindows) !==
            JSON.stringify(member.assignedShiftWindows ?? {}) ||
          JSON.stringify(nextMember.assignedShiftTasks) !==
            JSON.stringify(member.assignedShiftTasks ?? {}) ||
          nextMember.callTime !== member.callTime ||
          nextMember.offTime !== member.offTime
        ) {
          changed = true;
        }
        return nextMember;
      });
      return changed ? next : current;
    });
  }, [phaseDays, phaseShiftTimes]);

  /** Earliest call → latest off across the project-schedule segments
   *  that cover the given assigned days. Memoised so MasterCrewSheet
   *  can call it on every day-chip toggle without re-walking the whole
   *  schedule unless a phase or the show dates actually change. */
  const getCrewTimesForDates = useCallback(
    (
      dates: ReadonlyArray<string>,
      defaults: { callTime: string; offTime: string },
    ) => {
      const sched = buildProjectSchedule(
        reportDate,
        reportEndDate,
        extraSchedule,
      );
      return pickScheduleTimesForDates(dates, sched, defaults);
    },
    [reportDate, reportEndDate, extraSchedule],
  );

  const addCrew = () => {
    // Auto-assign the new crew member to the project's full schedule
    // (load-in → load-out, derived from reportDate / reportEndDate)
    // so they're "on for the whole run" by default. The producer can
    // untick individual day-chips on the Crew tab to drop them off
    // specific days. Call/off times are derived from the project
    // schedule so the row's shift covers the actual on-site window
    // (earliest setup → latest downrig across the seeded days).
    const fresh = makeCrewMember();
    const assignedShiftPhases = scheduledShiftKeys(phaseDays);
    const assignedDates = assignedDatesFromShiftPhases(
      new Set(assignedShiftPhases),
    );
    const assignedShiftTimes = shiftTimesForSelections(
      assignedShiftPhases,
      phaseShiftTimes,
    );
    const assignedShiftWindows = shiftWindowsForSelections(
      assignedShiftPhases,
      phaseShiftTimes,
    );
    const summary = summarizeShiftWindows(
      assignedShiftPhases,
      assignedShiftWindows,
      { startTime: fresh.callTime, endTime: fresh.offTime },
    );
    setCrew((all) => [
      ...all,
      {
        ...fresh,
        assignedDates,
        assignedShiftPhases,
        assignedShiftTimes,
        assignedShiftWindows,
        callTime: summary.startTime,
        offTime: summary.endTime,
      },
    ]);
  };
  const updateCrew = (id: string, patch: Partial<CrewMember>) => {
    setCrew((all) => all.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  };
  const saveCrewShifts = async (
    id: string,
    patch: Partial<CrewMember>,
  ): Promise<void> => {
    const nextCrew = crew.map((member) =>
      member.id === id ? { ...member, ...patch } : member,
    );
    const data: PersistedV2 = { ...buildPersistedData(), crew: nextCrew };

    if (projectSaveTimer.current) {
      clearTimeout(projectSaveTimer.current);
      projectSaveTimer.current = null;
    }
    ++projectSaveVersion.current;

    const run = async () => {
      const token = await getToken();
       if (!token) throw new Error(tr("crew.shifts.authError"));
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      };
      const body = {
        ...projectIdentityPayload(
          data.projectName || "",
          data.venue || "",
          data.venueId,
        ),
        client: data.client || "",
        client_id: data.clientId || null,
        easyjob_number: data.easyjobNumber || null,
        data,
      };
      const res = await fetch(
        currentProjectId ? `/api/projects/${currentProjectId}` : "/api/projects",
        {
          method: currentProjectId ? "PATCH" : "POST",
          headers,
          body: JSON.stringify(body),
        },
      );
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.project) {
        throw new Error(
          json?.error ||
            `Could not save shifts${res.status ? ` (${res.status})` : ""}.`,
        );
      }

      const serverCrew = Array.isArray(json.project.data?.crew)
        ? json.project.data.crew.map(normalizeCrewMember)
        : nextCrew;
      const persisted = { ...data, crew: serverCrew };
      try {
        localStorage.setItem(STORAGE_KEY_V2, JSON.stringify(persisted));
      } catch {
        // The authoritative server save succeeded; local cache is best effort.
      }
      suppressCloudSave.current = true;
      setCrew(serverCrew);
      const savedTime = new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
      setSavedAt(savedTime);
      setCloudSavedAt(savedTime);
      if (!currentProjectId && json.project.id) {
        setCurrentProjectId(json.project.id);
        try {
          localStorage.setItem("ehs-current-project-id", json.project.id);
        } catch {
          // Project remains available from the server response.
        }
      }
    };

    const queued = cloudSaveQueue.current.catch(() => undefined).then(run);
    cloudSaveQueue.current = queued.catch(() => undefined);
    await queued;
  };
  const removeCrew = (id: string) => {
    setCrew((all) => all.filter((m) => m.id !== id));
  };
  const duplicateCrew = (id: string) => {
    setCrew((all) => {
      const i = all.findIndex((m) => m.id === id);
      if (i < 0) return all;
      const src = all[i];
      const copy: CrewMember = {
        ...src,
        id:
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? `crew-${crypto.randomUUID()}`
            : `crew-${Date.now()}`,
        name: src.name,
        freelancerUserId: undefined,
        requestStatus: undefined,
        briefAssignmentId: undefined,
      };
      const next = [...all];
      next.splice(i + 1, 0, copy);
      return next;
    });
  };

  // ---- Sound Report ----
  const addSoundItem = () => {
    setSoundItems((all) => [...all, makeSoundItem()]);
  };

  /** Map an EHS library sub-category onto the in-app SoundCategory bucket
   *  used by the Sound Report. Anything we can't classify falls through to
   *  "Other" so the row is still visible. */
  const mapLibrarySoundCategory = (it: LibraryItem) => {
    const s = it.subCategory.toUpperCase();
    if (s.includes("PA")) return "PA Mains" as const;
    if (s.includes("SUB")) return "Subs" as const;
    if (s.includes("MONITOR")) return "Monitors" as const;
    if (s.includes("WIRELESS")) return "Mic Wireless" as const;
    if (s.includes("INPUT")) return "Mic Wired" as const;
    if (s.includes("CONSOLE")) return "Console" as const;
    if (s.includes("DI")) return "DI" as const;
    if (s.includes("STAND")) return "Stand" as const;
    if (s.includes("CABLE")) return "Cable" as const;
    if (s.includes("AMPLIFIER") || s.includes("SPEAKER"))
      return "PA Mains" as const;
    return "Other" as const;
  };

  /** Insert a library pick into whichever tab the picker was opened from. */
  const handleLibraryPick = (it: LibraryItem) => {
    const target = pickerTarget;
    if (!target) return;
    if (target.kind === "sound") {
      const base = makeSoundItem();
      setSoundItems((all) => [
        ...all,
        {
          ...base,
          name: it.name,
          category: mapLibrarySoundCategory(it),
          weight: it.weight,
          watts: it.watts,
          notes: it.notes ?? "",
        },
      ]);
    } else if (target.kind === "lighting") {
      const base = makeShowFixture();
      setShowFixtures((all) => [
        ...all,
        {
          ...base,
          name: it.name,
          weight: it.weight,
          watts: it.watts,
          notes: it.notes ?? "",
        },
      ]);
    } else if (target.kind === "power") {
      const circuitId = target.circuitId;
      const phase = target.phase;
      setPower((p) => {
        // Defensive: if the targeted circuit was deleted before the user
        // could pick, just append the item to the first remaining circuit
        // (or no-op if the plan is empty).
        if (!p.circuits.some((c) => c.id === circuitId)) {
          if (p.circuits.length === 0) return p;
          const fallback = p.circuits[0];
          return {
            ...p,
            circuits: p.circuits.map((c) =>
              c.id === fallback.id
                ? {
                    ...c,
                    items: [
                      ...c.items,
                      {
                        ...makePowerItem(phase),
                        name: it.name,
                        wattsPerUnit: it.watts,
                        notes: it.notes ?? "",
                      },
                    ],
                  }
                : c,
            ),
          };
        }
        return {
          ...p,
          circuits: p.circuits.map((c) =>
            c.id === circuitId
              ? {
                  ...c,
                  items: [
                    ...c.items,
                    {
                      ...makePowerItem(phase),
                      name: it.name,
                      wattsPerUnit: it.watts,
                      notes: it.notes ?? "",
                    },
                  ],
                }
              : c,
          ),
        };
      });
    }
    closePicker();
  };
  const updateSoundItem = (id: string, patch: Partial<SoundItem>) => {
    setSoundItems((all) =>
      all.map((it) => (it.id === id ? { ...it, ...patch } : it)),
    );
  };
  const removeSoundItem = (id: string) => {
    setSoundItems((all) => all.filter((it) => it.id !== id));
  };
  const duplicateSoundItem = (id: string) => {
    setSoundItems((all) => {
      const i = all.findIndex((it) => it.id === id);
      if (i < 0) return all;
      const src = all[i];
      const copy: SoundItem = {
        ...src,
        id:
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? `snd-${crypto.randomUUID()}`
            : `snd-${Date.now()}`,
        name: src.name ? `${src.name} (copy)` : "",
      };
      const next = [...all];
      next.splice(i + 1, 0, copy);
      return next;
    });
  };

  // ---- Lighting → Power Plan ----
  const addPowerCircuit = () => {
    setPower((p) => ({
      ...p,
      circuits: [...p.circuits, makePowerCircuit(p.circuits.length + 1)],
    }));
  };
  const updatePowerCircuit = (
    id: string,
    patch: Partial<Omit<PowerCircuit, "items">>,
  ) => {
    setPower((p) => ({
      ...p,
      circuits: p.circuits.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    }));
  };
  const removePowerCircuit = (id: string) => {
    setPower((p) => ({
      ...p,
      circuits: p.circuits.filter((c) => c.id !== id),
    }));
  };
  const addPowerItem = (circuitId: string, phase: PowerPhase = "L1") => {
    setPower((p) => ({
      ...p,
      circuits: p.circuits.map((c) =>
        c.id === circuitId
          ? { ...c, items: [...c.items, makePowerItem(phase)] }
          : c,
      ),
    }));
  };
  const updatePowerItem = (
    circuitId: string,
    itemId: string,
    patch: Partial<PowerItem>,
  ) => {
    setPower((p) => ({
      ...p,
      circuits: p.circuits.map((c) =>
        c.id === circuitId
          ? {
              ...c,
              items: c.items.map((it) =>
                it.id === itemId ? { ...it, ...patch } : it,
              ),
            }
          : c,
      ),
    }));
  };
  const removePowerItem = (circuitId: string, itemId: string) => {
    setPower((p) => ({
      ...p,
      circuits: p.circuits.map((c) =>
        c.id === circuitId
          ? { ...c, items: c.items.filter((it) => it.id !== itemId) }
          : c,
      ),
    }));
  };
  const duplicatePowerItem = (circuitId: string, itemId: string) => {
    setPower((p) => ({
      ...p,
      circuits: p.circuits.map((c) => {
        if (c.id !== circuitId) return c;
        const i = c.items.findIndex((it) => it.id === itemId);
        if (i < 0) return c;
        const src = c.items[i];
        const copy: PowerItem = {
          ...src,
          id:
            typeof crypto !== "undefined" && "randomUUID" in crypto
              ? `pwi-${crypto.randomUUID()}`
              : `pwi-${Date.now()}`,
          name: src.name ? `${src.name} (copy)` : "",
        };
        const next = [...c.items];
        next.splice(i + 1, 0, copy);
        return { ...c, items: next };
      }),
    }));
  };

  // ---- Lighting → Power Plan (v2 distros) ----
  const addDistro = (presetId: DistroPresetId = "cee-32-3ph-6x16") => {
    setPower((p) => ({
      ...p,
      distros: [...p.distros, makeDistro(presetId, p.distros.length + 1)],
    }));
  };
  const updateDistro = (
    id: string,
    patch: Partial<Omit<Distro, "channels" | "channelMapping" | "id">>,
  ) => {
    setPower((p) => ({
      ...p,
      distros: p.distros.map((d) => (d.id === id ? { ...d, ...patch } : d)),
    }));
  };
  const removeDistro = (id: string) => {
    setPower((p) => ({
      ...p,
      distros: p.distros.filter((d) => d.id !== id),
    }));
  };
  /** Empty every channel's drops on a distro while keeping the distro
   *  shell, preset, mapping, and "feeds" selections. Used by the
   *  per-distro "Reset distro" button to quickly start a card over
   *  without losing its identity / placement in the rack list. */
  const resetDistro = (id: string) => {
    setPower((p) => ({
      ...p,
      distros: p.distros.map((d) =>
        d.id === id
          ? {
              ...d,
              channels: d.channels.map((c) => ({ ...c, drops: [] })),
            }
          : d,
      ),
    }));
  };
  const applyDistroPreset = (id: string, presetId: DistroPresetId) => {
    setPower((p) => ({
      ...p,
      distros: p.distros.map((d) =>
        d.id === id ? applyPresetToDistro(d, presetId) : d,
      ),
    }));
  };
  const updateDistroChannelMapping = (
    id: string,
    mapping: ChannelMapping,
  ) => {
    setPower((p) => ({
      ...p,
      distros: p.distros.map((d) =>
        d.id === id ? { ...d, channelMapping: mapping } : d,
      ),
    }));
  };
  const updateDistroChannel = (
    distroId: string,
    channelIndex: number,
    patch: Partial<Omit<Channel, "drops" | "id" | "index">>,
  ) => {
    setPower((p) => ({
      ...p,
      distros: p.distros.map((d) =>
        d.id === distroId
          ? {
              ...d,
              channels: d.channels.map((c) =>
                c.index === channelIndex ? { ...c, ...patch } : c,
              ),
            }
          : d,
      ),
    }));
  };
  const addDrop = (
    distroId: string,
    channelIndex: number,
    drop: {
      trussId: string;
      fixtureRef: string;
      qty: number;
      cable?: DropCableKind;
    },
  ) => {
    setPower((p) => ({
      ...p,
      distros: p.distros.map((d) =>
        d.id === distroId
          ? {
              ...d,
              channels: d.channels.map((c) =>
                c.index === channelIndex
                  ? {
                      ...c,
                      drops: [
                        ...c.drops,
                        makeDrop(drop.trussId, drop.fixtureRef, drop.qty, drop.cable),
                      ],
                    }
                  : c,
              ),
            }
          : d,
      ),
    }));
  };
  const updateDrop = (
    distroId: string,
    channelIndex: number,
    dropId: string,
    patch: Partial<Omit<Drop, "id">>,
  ) => {
    setPower((p) => ({
      ...p,
      distros: p.distros.map((d) =>
        d.id === distroId
          ? {
              ...d,
              channels: d.channels.map((c) =>
                c.index === channelIndex
                  ? {
                      ...c,
                      drops: c.drops.map((dr) =>
                        dr.id === dropId ? { ...dr, ...patch } : dr,
                      ),
                    }
                  : c,
              ),
            }
          : d,
      ),
    }));
  };
  const removeDrop = (
    distroId: string,
    channelIndex: number,
    dropId: string,
  ) => {
    setPower((p) => ({
      ...p,
      distros: p.distros.map((d) =>
        d.id === distroId
          ? {
              ...d,
              channels: d.channels.map((c) =>
                c.index === channelIndex
                  ? { ...c, drops: c.drops.filter((dr) => dr.id !== dropId) }
                  : c,
              ),
            }
          : d,
      ),
    }));
  };

  // Apply an advisory rebalance suggestion: move N units of a fixture
  // from the source channel to the destination channel. If the
  // destination already has a drop of the same fixture+truss+cable,
  // merge into it; otherwise create a new drop. If the source drop
  // reaches 0 it is removed.
  const applyDistroSuggestion = (
    distroId: string,
    suggestion: DistroSuggestion,
  ) => {
    setPower((p) => ({
      ...p,
      distros: p.distros.map((d) => {
        if (d.id !== distroId) return d;
        // Locate the source drop and the destination channel up-front
        // so this is transactional: if either is missing (suggestion
        // went stale because mapping/preset changed), we no-op rather
        // than half-applying and silently losing fixtures.
        const src = d.channels.find((c) => c.index === suggestion.fromChannelIndex);
        if (!src) return d;
        const dst = d.channels.find((c) => c.index === suggestion.toChannelIndex);
        if (!dst) return d;
        const srcDrop = src.drops.find(
          (dr) =>
            dr.fixtureRef === suggestion.fixtureRef &&
            dr.trussId === suggestion.trussId,
        );
        if (!srcDrop) return d;
        const moveQty = Math.min(srcDrop.qty, Math.max(1, suggestion.qty));
        if (moveQty <= 0) return d;
        const cable = srcDrop.cable;
        return {
          ...d,
          channels: d.channels.map((c) => {
            if (c.index === suggestion.fromChannelIndex) {
              const remaining = srcDrop.qty - moveQty;
              return {
                ...c,
                drops:
                  remaining > 0
                    ? c.drops.map((dr) =>
                        dr.id === srcDrop.id ? { ...dr, qty: remaining } : dr,
                      )
                    : c.drops.filter((dr) => dr.id !== srcDrop.id),
              };
            }
            if (c.index === suggestion.toChannelIndex) {
              const existing = c.drops.find(
                (dr) =>
                  dr.fixtureRef === suggestion.fixtureRef &&
                  dr.trussId === suggestion.trussId &&
                  (dr.cable ?? "") === (cable ?? ""),
              );
              if (existing) {
                return {
                  ...c,
                  drops: c.drops.map((dr) =>
                    dr.id === existing.id
                      ? { ...dr, qty: dr.qty + moveQty }
                      : dr,
                  ),
                };
              }
              return {
                ...c,
                drops: [
                  ...c.drops,
                  makeDrop(
                    suggestion.trussId,
                    suggestion.fixtureRef,
                    moveQty,
                    cable,
                  ),
                ],
              };
            }
            return c;
          }),
        };
      }),
    }));
  };

  // Apply an auto-suggested layout: append N new distros to the plan,
  // each pre-filled with channels and drops. Preserves all existing
  // distros + legacy circuits. The user can edit/remove afterwards.
  const applyPowerLayoutSuggestion = (suggested: SuggestedDistro[]) => {
    if (suggested.length === 0) return;
    setPower((p) => {
      const startIndex = p.distros.length + 1;
      const newDistros: Distro[] = suggested.map((s, i) => {
        const base = makeDistro(s.presetId, startIndex + i);
        // Apply feedsTrusses + drop blueprints onto channels.
        return {
          ...base,
          feedsTrusses: [...s.feedsTrusses],
          channels: base.channels.map((c) => {
            const drops = s.drops
              .filter((d) => d.channelIndex === c.index)
              .map((d) => makeDrop(d.trussId, d.fixtureRef, d.qty));
            return drops.length > 0 ? { ...c, drops } : c;
          }),
        };
      });
      return { ...p, distros: [...p.distros, ...newDistros] };
    });
  };

  // ---- Stage Report ----
  const addStage = () => {
    setStages((all) => [
      ...all,
      makeDefaultStage(
        tr("stage.defaultNumberedName", { number: all.length + 1 }),
      ),
    ]);
  };
  const updateStage = (id: string, patch: Partial<Stage>) => {
    setStages((all) =>
      all.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    );
  };
  const removeStage = (id: string) => {
    setStages((all) => all.filter((s) => s.id !== id));
  };
  const duplicateStage = (id: string) => {
    setStages((all) => {
      const i = all.findIndex((s) => s.id === id);
      if (i < 0) return all;
      const src = all[i];
      const copy: Stage = {
        ...src,
        id:
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `stage-${Date.now()}`,
        name: `${src.name} (copy)`,
        rails: { ...src.rails },
        // Deep-copy so the duplicate's manual placements + custom rails
        // can be edited without mutating the original stage.
        manualPlacements: src.manualPlacements.map((p) => ({ ...p })),
        customRails: src.customRails.map((c) => ({
          ...c,
          id:
            typeof crypto !== "undefined" && "randomUUID" in crypto
              ? crypto.randomUUID()
              : `${c.id}-copy-${Math.random().toString(36).slice(2, 8)}`,
        })),
      };
      const next = [...all];
      next.splice(i + 1, 0, copy);
      return next;
    });
  };

  /** Download a Stage Build Sheet as a real PDF file — no popup window,
   *  no browser print dialog, no "select Save as PDF in the destination
   *  dropdown" friction. The HTML is rendered into a hidden iframe,
   *  rasterised with html2canvas, and assembled into a multi-page A4
   *  PDF by jsPDF, which then triggers the browser's native download.
   *
   *  Loads the EHS logo for branding; falls back to a logo-less header
   *  if the asset can't be fetched. */
  const exportStage = async (id: string) => {
    const stage = stages.find((s) => s.id === id);
    if (!stage) return;
    const calc = computeStage(stage);
    let logoDataUrl: string | null = null;
    try {
      logoDataUrl = await getLogoDataUrl(ehsLogo);
    } catch {
      logoDataUrl = null;
    }
    const html = buildStageReportHtml({
      stage,
      calc,
      project: {
        venue,
        date: reportDate,
        endDate: reportEndDate || undefined,
        preparedBy: engineer,
      },
      logoDataUrl,
      locale: i18nLocale === "no" ? "nb-NO" : "en-US",
      copy: {
        untitled: tr("stage.untitled"), productionTool: tr("export.stage.productionTool"), buildSheet: tr("export.stageBuildSheet"), generated: tr("export.stage.generated"),
        print: tr("export.stage.print"), close: tr("common.close"), venueProject: tr("export.stage.venueProject"), date: tr("export.stage.date"), projectManager: tr("export.stage.projectManager"),
        layoutMode: tr("export.stage.layoutMode"), manualPlacement: tr("export.stage.manualPlacement"), autoTiled: tr("export.stage.autoTiled"), buildDirection: tr("export.stage.buildDirection"),
        rightToLeft: tr("stage.direction.rightToLeft"), leftToRight: tr("stage.direction.leftToRight"), maleSideFaces: tr("export.stage.maleSideFaces"), overrides: (count) => tr("export.stage.overrides", { count }),
        layout: tr("export.stage.layout"), noDecksManual: tr("export.stage.noDecksManual"), handrail: tr("export.stage.handrail"), leg: tr("export.stage.leg"),
        maleEdges: tr("export.stage.maleEdges"), maleEdgesDetail: tr("export.stage.maleEdgesDetail"), connectorGuidance: tr("export.stage.connectorGuidance"),
        width: tr("export.stage.width"), depth: tr("export.stage.depth"), area: tr("export.stage.area"), totalWeight: tr("export.stage.totalWeight"), cannotTile: tr("export.stage.cannotTile"),
        decks: tr("export.stage.decks"), size: tr("export.stage.size"), quantity: tr("export.stage.quantity"), unit: tr("export.stage.unit"), total: tr("export.stage.total"), noDecks: tr("export.stage.noDecks"),
        subtotal: tr("export.stage.subtotal"), legs: tr("export.stage.legs"), perDeck: tr("export.stage.perDeck"), sharedCorners: tr("stage.legs.sharedCorners"), pieces: tr("stage.unit.pieces"),
        unitWeight: tr("export.stage.unitWeight"), bracingRequired: tr("export.stage.bracingRequired"), buildSequence: tr("export.stage.buildSequence"), deck: tr("export.stage.deck"),
        maleSide: tr("export.stage.maleSide"), legsToInstall: tr("export.stage.legsToInstall"), sequenceHelp: tr("export.stage.sequenceHelp"), loadCapacity: tr("export.stage.loadCapacity"),
        distributedLoad: tr("export.stage.distributedLoad"), placedAreaOnly: tr("export.stage.placedAreaOnly"), ratedSwl: tr("export.stage.ratedSwl"), capacityHelp: tr("export.stage.capacityHelp"),
        handrails: tr("stage.handrails"), side: tr("export.stage.side"), length: tr("export.stage.length"), weight: tr("export.stage.weight"), noHandrails: tr("export.stage.noHandrails"),
        notes: tr("stage.notes"), grandTotal: tr("export.stage.grandTotal"), footer: tr("export.stage.footer"), popupError: tr("export.stage.popupError"),
        connectorLabel: { N: tr("stage.side.upstage"), E: tr("stage.side.right"), S: tr("stage.side.downstage"), W: tr("stage.side.left") },
        connectorShort: { N: tr("stage.short.N"), E: tr("stage.short.E"), S: tr("stage.short.S"), W: tr("stage.short.W") },
        railSide: { front: tr("stage.rail.front"), back: tr("stage.rail.back"), left: tr("stage.rail.left"), right: tr("stage.rail.right") },
        legsAdded: (count) => tr(count === 1 ? "export.stage.leg" : "export.stage.legs"), deckCount: (count) => tr(count === 1 ? "export.stage.deck" : "export.stage.decks"), legCount: (count) => tr(count === 1 ? "export.stage.leg" : "export.stage.legs"),
      },
    });
    const filename = pdfFilename(
      [
        tr("export.stageBuildSheet"),
        stage.name.trim() || tr("export.untitledStage"),
        venue,
        reportDate,
      ],
      tr("export.pdfFilenameFallback"),
    );
    try {
      await downloadHtmlAsPdf(html, filename);
    } catch (err) {
      console.error("[stage export] PDF download failed:", err);
      // We intentionally don't fall back to `window.open` here — the
      // user gesture token has expired during the `await` above, so any
      // popup open would be blocked by the browser. A clear alert lets
      // the user retry (which gives us a fresh activation token) or
      // report the issue.
      alert(
        tr("export.pdfError"),
      );
    }
  };

  /** Open a printable Power Plan crew manifest in a new window. The
   *  popup is opened SYNCHRONOUSLY (in the click handler, before any
   *  async work) so browsers don't classify it as a programmatic
   *  pop-up and block it. We then load the EHS logo asynchronously
   *  (same pattern as `exportStageBuildSheet`) so the manifest header
   *  matches the Stage Build Sheet's branding. The new window
   *  includes Print / Save as PDF and Download JSON controls. */
  const exportPowerPlan = async () => {
    const targetWin = window.open("", "_blank");
    if (targetWin) {
      targetWin.document.write(
        `<!doctype html><html lang="${i18nLocale === "no" ? "nb-NO" : "en"}"><meta charset="utf-8"><title>${tr("export.generatingPowerPlanTitle")}</title><body style="font:14px system-ui;padding:24px;color:#64748b">${tr("export.generatingPowerPlanBody")}</body></html>`,
      );
    }
    let logoDataUrl: string | null = null;
    try {
      logoDataUrl = await getLogoDataUrl(ehsLogo);
    } catch {
      logoDataUrl = null;
    }
    const result = exportPowerPlanToCrew({
      plan: power,
      fixtures: allLightingFixtures,
      systems,
      project: {
        venue,
        date: reportDate,
        endDate: reportEndDate || undefined,
        preparedBy: engineer,
      },
      logoDataUrl,
      targetWin,
      locale: i18nLocale,
      copy: {
        documentTitle: tr("export.powerPlan.documentTitle"),
        productionTool: tr("export.powerPlan.productionTool"),
        manifest: tr("export.powerPlan.manifest"),
        generated: tr("export.powerPlan.generated"),
        print: tr("export.powerPlan.print"),
        downloadJson: tr("export.powerPlan.downloadJson"),
        close: tr("export.powerPlan.close"),
        venueProject: tr("export.powerPlan.venueProject"),
        date: tr("export.powerPlan.date"),
        projectManager: tr("export.powerPlan.projectManager"),
        distros: tr("export.powerPlan.distros"),
        totalLoad: tr("export.powerPlan.totalLoad"),
        worstLeg: tr("export.powerPlan.worstLeg"),
        unpowered: tr("export.powerPlan.unpowered"),
        racks: tr("export.powerPlan.racks"),
        fixtures: tr("export.powerPlan.fixtures"),
        breakdown: tr("export.powerPlan.breakdown"),
        connectedLoad: tr("export.powerPlan.connectedLoad"),
        feeds: tr("export.powerPlan.feeds"),
        phases: tr("export.powerPlan.phases"),
        channels: tr("export.powerPlan.channels"),
        phase: tr("export.powerPlan.phase"),
        watts: tr("export.powerPlan.watts"),
        amps: tr("export.powerPlan.amps"),
        truss: tr("export.powerPlan.truss"),
        fixture: tr("export.powerPlan.fixture"),
        quantity: tr("export.powerPlan.quantity"),
        cable: tr("export.powerPlan.cable"),
        channelSubtotal: tr("export.powerPlan.channelSubtotal"),
        breaker: tr("export.powerPlan.breaker"),
        noDrops: tr("export.powerPlan.noDrops"),
        distroFallback: tr("export.powerPlan.distroFallback"),
        powerPlanFallback: tr("export.powerPlan.powerPlanFallback"),
        noDistros: tr("export.powerPlan.noDistros"),
        unpoweredWarning: (count) => tr(count === 1 ? "export.powerPlan.unpoweredWarningOne" : "export.powerPlan.unpoweredWarning", { count: count.toLocaleString(i18nLocale === "no" ? "nb-NO" : "en-US") }),
        footer: tr("export.powerPlan.footer"),
        feederUtilization: tr("export.powerPlan.feederUtilization"),
        imbalance: tr("export.powerPlan.imbalance"),
        grandTotal: (watts, amps) => tr("export.powerPlan.grandTotal", { watts, amps }),
      },
    });
    setPowerExportToast(
      result.ok
        ? tr("export.powerPlanSuccess")
        : tr("export.popupError"),
    );
  };

  /** Stable dismiss callback for the inline Power export toast. We
   *  memoize so the toast's auto-dismiss timer effect doesn't reset
   *  on unrelated parent rerenders. */
  const dismissPowerExportToast = useCallback(
    () => setPowerExportToast(null),
    [],
  );

  /** Open a printable Client Pack — a single 11-section client-facing
   *  PDF combining cover, overview, schedule, crew, rigging, lighting,
   *  sound, stage, LED, risk summary and cost. Same sync-popup pattern
   *  as `exportPowerPlan` so pop-up blockers don't swallow the new tab.
   *
   *  Maps each App-level state slice into the export's `ClientPackInput`
   *  shape; per-system rigging metrics are computed via the existing
   *  `computeMetrics` helper so SWL/peak math stays in one place. */
  const exportClientPackPdf = async () => {
    const targetWin = window.open("", "_blank");
    if (targetWin) {
      targetWin.document.write(
        `<!doctype html><meta charset="utf-8"><title>${tr("export.generatingClientPack")}</title><body style="font:14px system-ui;padding:24px;color:#64748b">${tr("export.generatingClientPack")}</body>`,
      );
    }

    const schedule = buildProjectSchedule(reportDate, reportEndDate, extraSchedule);
    const schedulePhases: ClientPackSchedulePhase[] = (
      ["setup", "rehearsal", "show", "downrig"] as const
    )
      .filter((k) => (schedule[k]?.length ?? 0) > 0)
      .map((k) => ({
        key: k,
        label: tr(SCHEDULE_PHASE_LABEL_KEYS[k]),
        segments: schedule[k] ?? [],
      }));

    const packSystems: ClientPackSystem[] = systems.map((sys) => {
      const m = computeMetrics(sys);
      const trussNames = sys.riggingRows
        .map((r) => getRowItem(r)?.name ?? "")
        .filter((n): n is string => !!n);
      return {
        id: sys.id,
        name: sys.name,
        pointCount: sys.pointCount,
        hoistName: getHoist(sys.hoistIndex).label,
        truss: trussNames,
        metrics: {
          static: m.static,
          dynamic: m.dynamic,
          peak: m.peak,
          swl: m.swl,
          headroom: m.headroom,
        },
      };
    });

    let logoDataUrl: string | null = null;
    try {
      logoDataUrl = await getLogoDataUrl(ehsLogo);
    } catch {
      logoDataUrl = null;
    }

    // Render each LED screen's pixel map to a PNG data URL so the Client
    // Pack can embed the same diagram the producer sees on screen. Done
    // in parallel; failures per-screen are tolerated (we just skip that
    // figure rather than blocking the whole export).
    const blobToDataUrl = (blob: Blob) =>
      new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => reject(r.error ?? new Error("FileReader failed"));
        r.readAsDataURL(blob);
      });
    const ledPixelMaps: Record<string, string> = {};
    await Promise.all(
      allLedScreens.map(async (screen) => {
        try {
          const { blob } = await renderScreenPngBlob({
            screen,
            panels: ledPanels,
            settings: ledSettings,
            logoDataUrl,
            filenameFallback: tr("export.ledScreenFilenameFallback"),
          });
          ledPixelMaps[screen.id] = await blobToDataUrl(blob);
        } catch (err) {
          console.warn(`Skipped pixel map for ${screen.name}:`, err);
        }
      }),
    );

    const result = exportClientPack({
      project: {
        eventName: projectName,
        client,
        venue,
        date: reportDate,
        endDate: reportEndDate || undefined,
        preparedBy: engineer,
        summary: "",
      },
      schedule: schedulePhases,
      systems: packSystems,
      power,
      fixtures: allLightingFixtures,
      crew,
      sound: soundItems,
      stages,
      ledScreens: allLedScreens,
      ledSettings,
      ledPanels,
      ledPixelMaps,
      logoDataUrl,
      targetWin,
      locale: i18nLocale === "no" ? "nb-NO" : "en-US",
      copy: {
        clientPack: tr("header.clientPack"),
        downloadPdf: tr("export.clientPack.downloadPdf"),
        print: tr("common.print"),
        close: tr("common.close"),
        generatingPdf: tr("export.clientPack.generatingPdf"),
        pdfError: tr("export.clientPack.pdfError"),
        footerAdvisory: tr("export.clientPack.footerAdvisory"),
        notSpecified: tr("export.clientPack.notSpecified"),
        generated: tr("export.clientPack.generated"),
        riskSafe: tr("export.clientPack.risk.safe"),
        riskWarning: tr("export.clientPack.risk.warning"),
        riskOverload: tr("export.clientPack.risk.overload"),
        noIssuesDetected: tr("export.clientPack.noIssuesDetected"),
        noIssuesDetail: tr("export.clientPack.noIssuesDetail"),
        riskAreaRigging: tr("export.clientPack.risk.areaRigging"),
        riskAreaPower: tr("export.clientPack.risk.areaPower"),
        riskAreaCrew: tr("export.clientPack.risk.areaCrew"),
        riskAreaSchedule: tr("export.clientPack.risk.areaSchedule"),
        riskPeakOverload: tr("export.clientPack.risk.peakOverload"),
        riskPeakWarning: tr("export.clientPack.risk.peakWarning"),
        riskFeederOverload: tr("export.clientPack.risk.feederOverload"),
        riskFeederWarning: tr("export.clientPack.risk.feederWarning"),
        riskPhaseImbalance: tr("export.clientPack.risk.phaseImbalance"),
        riskUnpoweredOne: tr("export.clientPack.risk.unpoweredOne"),
        riskUnpoweredMany: tr("export.clientPack.risk.unpoweredMany"),
        riskMissingCallOne: tr("export.clientPack.risk.missingCallOne"),
        riskMissingCallMany: tr("export.clientPack.risk.missingCallMany"),
        riskNoCrew: tr("export.clientPack.risk.noCrew"),
        riskUndatedSegmentOne: tr("export.clientPack.risk.undatedSegmentOne"),
        riskUndatedSegmentMany: tr("export.clientPack.risk.undatedSegmentMany"),
        riskNoSchedule: tr("export.clientPack.risk.noSchedule"),
        unnamed: tr("export.clientPack.unnamed"),
        distroFallback: tr("export.clientPack.distro"),
        tbd: tr("export.callSheet.tbd"),
        processorFallback: tr("export.clientPack.processor"),
        ledScreenFallback: tr("export.clientPack.ledScreenFallback"),
        pixelMap: tr("export.clientPack.pixelMap"),
        filenameFallback: tr("header.clientPack"),
        labels: {
          brand: tr("export.clientPack.brand"),
          client: tr("export.clientPack.client"), venue: tr("export.clientPack.venue"),
          date: tr("export.clientPack.date"), preparedBy: tr("export.clientPack.preparedBy"),
          overviewSection: tr("export.clientPack.section.overview"),
          totalCrew: tr("export.clientPack.totalCrew"), riggingSystems: tr("export.clientPack.riggingSystems"),
          lightingFixtures: tr("export.clientPack.lightingFixtures"), distros: tr("export.clientPack.distros"),
          soundItems: tr("export.clientPack.soundItems"), stages: tr("export.clientPack.stages"),
          ledScreens: tr("export.clientPack.ledScreens"),
          scheduleSection: tr("export.clientPack.section.schedule"), phase: tr("export.clientPack.phase"),
          time: tr("export.clientPack.time"), crewSection: tr("export.clientPack.section.crew"),
          name: tr("export.clientPack.name"), role: tr("export.clientPack.role"),
          call: tr("export.clientPack.call"), off: tr("export.clientPack.off"),
          hours: tr("export.clientPack.hours"), hotel: tr("export.clientPack.hotel"),
          dayRate: tr("export.clientPack.dayRate"), hotelNeeded: tr("export.clientPack.hotelNeeded"),
          roomsOne: tr("export.clientPack.rooms.one"), roomsMany: tr("export.clientPack.rooms.many"),
          nightsOne: tr("export.clientPack.nights.one"), nightsMany: tr("export.clientPack.nights.many"),
          crewTotalOne: tr("export.clientPack.crewTotal.one"), crewTotalMany: tr("export.clientPack.crewTotal.many"),
          totals: tr("export.clientPack.totals"),
          riggingSection: tr("export.clientPack.section.rigging"), system: tr("export.clientPack.system"),
          trusses: tr("export.clientPack.trusses"), pts: tr("export.clientPack.pts"),
          motor: tr("export.clientPack.motor"), staticLoad: tr("export.clientPack.static"),
          dynamicLoad: tr("export.clientPack.dynamic"), peakSwl: tr("export.clientPack.peakSwl"),
          util: tr("export.clientPack.util"), status: tr("export.clientPack.status"),
          lightingSection: tr("export.clientPack.section.lighting"), fixtures: tr("export.clientPack.fixtures"),
          totalLoad: tr("export.clientPack.totalLoad"), unpowered: tr("export.clientPack.unpowered"),
          phaseCount: tr("export.clientPack.phaseCount"),
          distro: tr("export.clientPack.distro"), feed: tr("export.clientPack.feed"),
          totalW: tr("export.clientPack.totalW"), worstLeg: tr("export.clientPack.worstLeg"),
          imbalance: tr("export.clientPack.imbalance"),
          soundSection: tr("export.clientPack.section.sound"), item: tr("export.clientPack.item"),
          category: tr("export.clientPack.category"), qty: tr("export.clientPack.qty"),
          weight: tr("export.clientPack.weight"), power: tr("export.clientPack.power"),
          placementNotes: tr("export.clientPack.placementNotes"),
          rowsOne: tr("export.clientPack.rows.one"), rowsMany: tr("export.clientPack.rows.many"),
          piecesOne: tr("export.clientPack.pieces.one"), piecesMany: tr("export.clientPack.pieces.many"),
          stageSection: tr("export.clientPack.section.stage"), stage: tr("export.clientPack.stage"),
          dimensions: tr("export.clientPack.dimensions"), legHeight: tr("export.clientPack.legHeight"),
          area: tr("export.clientPack.area"), buildWeight: tr("export.clientPack.buildWeight"),
          loadCapacity: tr("export.clientPack.loadCapacity"),
          stageOne: tr("export.clientPack.stageCount.one"), stageMany: tr("export.clientPack.stageCount.many"),
          ledSection: tr("export.clientPack.section.led"), screens: tr("export.clientPack.screens"),
          cabinets: tr("export.clientPack.cabinets"), pixels: tr("export.clientPack.pixels"),
          peakPower: tr("export.clientPack.peakPower"), screen: tr("export.clientPack.screen"),
          panelType: tr("export.clientPack.panelType"), grid: tr("export.clientPack.grid"),
          resolution: tr("export.clientPack.resolution"), processor: tr("export.clientPack.processor"),
          portsNeeded: tr("export.clientPack.portsNeeded"), processorLoad: tr("export.clientPack.processorLoad"),
          riskSection: tr("export.clientPack.section.risk"), riskArea: tr("export.clientPack.area"),
          detail: tr("export.clientPack.detail"), costSection: tr("export.clientPack.section.cost"),
          department: tr("export.clientPack.department"), headcount: tr("export.clientPack.headcount"),
          cost: tr("export.clientPack.cost"), totalCrewCost: tr("export.clientPack.totalCrewCost"),
          costFootnote: tr("export.clientPack.costFootnote"),
        },
      },
    });
    if (!result.ok) {
      alert(
        tr("export.clientPackPopupError"),
      );
    }
  };

  /** Open a printable Show Simulation — walks through 10 phases
   *  (Load-in, Rigging, Lighting setup, LED setup, Sound setup, Stage
   *  build, Testing, Rehearsal, Show, Load-out) and emits a readiness
   *  score + final verdict. Reuses the same data-mapping pattern as
   *  the Client Pack export. */
  const simulateShow = async () => {
    const targetWin = window.open("", "_blank");
    if (targetWin) {
      targetWin.document.write(
        `<!doctype html><meta charset="utf-8"><title>${tr("export.runningSimulation")}</title><body style="font:14px system-ui;padding:24px;color:#64748b">${tr("export.runningSimulation")}</body>`,
      );
    }

    const schedule = buildProjectSchedule(reportDate, reportEndDate, extraSchedule);
    const schedulePhases: ClientPackSchedulePhase[] = (
      ["setup", "rehearsal", "show", "downrig"] as const
    )
      .filter((k) => (schedule[k]?.length ?? 0) > 0)
      .map((k) => ({
        key: k,
        label: tr(SCHEDULE_PHASE_LABEL_KEYS[k]),
        segments: schedule[k] ?? [],
      }));

    const packSystems: ClientPackSystem[] = systems.map((sys) => {
      const m = computeMetrics(sys);
      const trussNames = sys.riggingRows
        .map((r) => getRowItem(r)?.name ?? "")
        .filter((n): n is string => !!n);
      return {
        id: sys.id,
        name: sys.name,
        pointCount: sys.pointCount,
        hoistName: getHoist(sys.hoistIndex).label,
        truss: trussNames,
        metrics: {
          static: m.static,
          dynamic: m.dynamic,
          peak: m.peak,
          swl: m.swl,
          headroom: m.headroom,
        },
      };
    });

    let logoDataUrl: string | null = null;
    try {
      logoDataUrl = await getLogoDataUrl(ehsLogo);
    } catch {
      logoDataUrl = null;
    }

    // Pull the currently-active floor plan from the in-memory library
    // so the simulation PDF ends with the venue drawing the producer
    // is looking at on the Rigg Plan tab. `imageDataUrl` is always a
    // raster (images stay as-is, PDFs are pre-rasterised), so it
    // embeds cleanly in the simulation HTML.
    const activeFloorPlan: FloorPlan | null = floorPlanLibrary.activeId
      ? (floorPlanLibrary.plans.find(
          (p) => p.id === floorPlanLibrary.activeId,
        ) ?? null)
      : null;

    const input: ShowSimulationInput = {
      locale: i18nLocale,
      copy: tr,
      project: {
        eventName: projectName,
        client,
        venue,
        date: reportDate,
        endDate: reportEndDate || undefined,
        preparedBy: engineer,
        summary: "",
      },
      schedule: schedulePhases,
      systems: packSystems,
      power,
      fixtures: allLightingFixtures,
      crew,
      sound: soundItems,
      stages,
      ledScreens: allLedScreens,
      ledSettings,
      ledPanels,
      floorPlanDataUrl: activeFloorPlan?.imageDataUrl ?? null,
      floorPlanFileName: activeFloorPlan?.fileName ?? null,
      logoDataUrl,
      targetWin,
    };
    const result = exportShowSimulation(input);
    if (!result.ok) {
      alert(
        tr("export.simulationPopupError"),
      );
    }
  };

  const addShowFixture = () =>
    setShowFixtures((all) => [...all, makeShowFixture()]);

  const updateShowFixture = (id: string, patch: Partial<ShowFixture>) => {
    // Linked rows: route DMX/position overlay fields into linkedMeta.
    // Base fields (name/qty/weight/watts/systemId) ignored — must be
    // edited on the rigging report.
    if (id.startsWith("linked-")) {
      const sourceRowId = id.slice("linked-".length);
      setLinkedMeta((all) => {
        const prev = all[sourceRowId] ?? defaultLinkedMeta();
        const next: LinkedMeta = {
          ...prev,
          ...(patch.dmxChannels !== undefined && {
            dmxChannels: patch.dmxChannels,
          }),
          ...(patch.dmxModeIndex !== undefined && {
            dmxModeIndex: patch.dmxModeIndex,
          }),
          ...(patch.beamAngle !== undefined && { beamAngle: patch.beamAngle }),
          ...(patch.position !== undefined && { position: patch.position }),
          ...(patch.circuit !== undefined && { circuit: patch.circuit }),
          ...(patch.universe !== undefined && { universe: patch.universe }),
          ...(patch.startAddress !== undefined && {
            startAddress: patch.startAddress,
          }),
          ...(patch.notes !== undefined && { notes: patch.notes }),
        };
        return { ...all, [sourceRowId]: next };
      });
      return;
    }
    setShowFixtures((all) =>
      all.map((f) => (f.id === id ? { ...f, ...patch } : f)),
    );
  };

  const removeShowFixture = (id: string) => {
    if (id.startsWith("linked-")) return; // can't remove linked rows here
    setShowFixtures((all) => all.filter((f) => f.id !== id));
  };

  const duplicateShowFixture = (id: string) => {
    // Duplicating a linked row creates a standalone editable copy.
    // Strip mode metadata so the standalone copy gets the plain numeric
    // DMX input (modes are inventory-driven and not meaningful once
    // detached from the rigging row); preserve the resolved channel count
    // as the starting numeric value.
    const source = allLightingFixtures.find((f) => f.id === id);
    if (!source) return;
    const copy: ShowFixture = {
      ...source,
      id: newId("fx"),
      linked: false,
      sourceRowId: undefined,
      dmxModeIndex: undefined,
      availableDmxModes: undefined,
    };
    setShowFixtures((all) => [...all, copy]);
  };

  const lightingTotals = useMemo(() => {
    let qty = 0,
      weight = 0,
      watts = 0,
      channels = 0;
    for (const f of allLightingFixtures) {
      qty += f.qty;
      weight += f.weight * f.qty;
      watts += f.watts * f.qty;
      channels += f.dmxChannels * f.qty;
    }
    const universesUsed = new Set(
      allLightingFixtures
        .filter((f) => f.dmxChannels > 0)
        .map((f) => f.universe),
    ).size;
    return { qty, weight, watts, channels, universesUsed };
  }, [allLightingFixtures]);

  const submitCustom = () => {
    if (!modalTarget) return;
    const item: InventoryItem = {
      name: `${custName || "Custom"} (${parseFloat(custWeight) || 0}kg)`,
      weight: parseFloat(custWeight) || 0,
      wattage: parseFloat(custWatt) || 0,
      area: parseFloat(custArea) || 0,
      ...(modalTarget === "LED Screen" && custBracket.trim()
        ? { bracketName: custBracket.trim() }
        : {}),
    };
    const key =
      modalTarget === "Fixtures"
        ? "fixtureRows"
        : modalTarget === "LED Screen"
          ? "ledRows"
          : "riggingRows";
    updateRowsKey(key, (rows) => [
      ...rows,
      makeCustomRow(modalTarget, item),
    ]);
    closeModal();
  };

  const downloadCsv = () => {
    const esc = (v: string | number) => {
      const s = String(v ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows: string[] = [];
    const csvHoistLabel = (hoist: Hoist) =>
      hoist.swl > 0 ? hoist.label : tr("rigging.print.noMotor");
    const motorsSection = tr("rigging.print.motorsSupport");
    rows.push(
      [
        tr("rigging.csv.projectVenue"),
        tr("rigging.csv.projectDate"),
        tr("rigging.csv.engineer"),
        tr("rigging.print.system"),
        tr("rigging.print.section"),
        tr("rigging.print.item"),
        tr("rigging.print.qty"),
        tr("rigging.csv.unitWeightKg"),
        tr("rigging.csv.totalWeightKg"),
        tr("rigging.csv.unitPowerW"),
        tr("rigging.csv.totalPowerW"),
        tr("rigging.csv.unitAreaM2"),
        tr("rigging.csv.totalAreaM2"),
        tr("rigging.csv.systemPoints"),
        tr("rigging.csv.systemDynamicFactor"),
        tr("rigging.print.hoist"),
        tr("rigging.csv.hoistSwlKg"),
      ]
        .map(esc)
        .join(","),
    );

    for (const sys of systems) {
      const hoist = getHoist(sys.hoistIndex);
      const lines: { row: Row; section: string }[] = [
        ...sys.riggingRows.map((r) => ({ row: r, section: motorsSection })),
        ...sys.fixtureRows.map((r) => ({ row: r, section: tr("rigging.print.lightingFixtures") })),
        ...sys.ledRows.map((r) => ({ row: r, section: tr("rigging.print.ledOther") })),
      ];

      // Hoist row(s) — record the hoist contribution itself
      rows.push(
        [
          venue,
          reportDate,
          engineer,
          sys.name,
          motorsSection,
          csvHoistLabel(hoist),
          sys.pointCount,
          hoist.weight,
          (hoist.weight * sys.pointCount).toFixed(2),
          hoist.watt,
          hoist.watt * sys.pointCount,
          0,
          0,
          sys.pointCount,
          sys.dynamicFactor,
          csvHoistLabel(hoist),
          hoist.swl,
        ]
          .map(esc)
          .join(","),
      );

      for (const { row, section } of lines) {
        const it = getRowItem(row);
        if (!it) continue;
        rows.push(
          [
            venue,
            reportDate,
            engineer,
            sys.name,
            section,
            it.name,
            row.qty,
            it.weight.toFixed(2),
            (it.weight * row.qty).toFixed(2),
            it.wattage,
            it.wattage * row.qty,
            it.area,
            (it.area * row.qty).toFixed(2),
            sys.pointCount,
            sys.dynamicFactor,
            csvHoistLabel(hoist),
            hoist.swl,
          ]
            .map(esc)
            .join(","),
        );
      }
    }

    // Per-system totals + per-point loads as a separate block
    rows.push("");
    rows.push(
      [
        tr("rigging.print.system"),
        tr("rigging.print.hoist"),
        tr("rigging.points"),
        tr("rigging.dynamicFactor"),
        tr("rigging.csv.staticTotalKg"),
        tr("rigging.csv.dynamicTotalKg"),
        tr("rigging.csv.peakPointKg"),
        tr("rigging.csv.swlKg"),
        tr("rigging.csv.headroomKg"),
        tr("rigging.print.status"),
      ]
        .map(esc)
        .join(","),
    );
    for (const { system, metrics } of allMetrics) {
      // No hoist selected → no SWL constraint, so neither "OVERLOAD"
      // nor the 85 %-headroom warning applies.
      const hasHoist = metrics.swl > 0;
      const over = hasHoist && metrics.peak > metrics.swl;
      const status = !hasHoist
        ? tr("rigging.print.noMotor")
        : over
          ? tr("rigging.status.overload")
          : metrics.peak / metrics.swl > 0.85
            ? tr("rigging.status.caution")
            : tr("common.ok");
      rows.push(
        [
          system.name,
          csvHoistLabel(getHoist(system.hoistIndex)),
          system.pointCount,
          system.dynamicFactor,
          metrics.static.toFixed(2),
          metrics.dynamic.toFixed(2),
          metrics.peak.toFixed(2),
          metrics.swl,
          metrics.headroom.toFixed(2),
          status,
        ]
          .map(esc)
          .join(","),
      );
    }

    rows.push("");
    rows.push(
      [
        tr("rigging.print.system"),
        tr("rigging.print.point"),
        tr("rigging.csv.distributionPct"),
        tr("rigging.print.staticKg"),
        tr("rigging.print.dynamicKg"),
        tr("rigging.csv.swlUtilPct"),
        tr("rigging.print.status"),
      ]
        .map(esc)
        .join(","),
    );
    for (const { system, metrics } of allMetrics) {
      const hasHoist = metrics.swl > 0;
      metrics.factors.forEach((f, i) => {
        const dLoad = metrics.dynamicPointLoads[i];
        const sLoad = metrics.staticPointLoads[i];
        const util = hasHoist ? (dLoad / metrics.swl) * 100 : 0;
        const over = hasHoist && dLoad > metrics.swl;
        const status = !hasHoist
          ? tr("rigging.print.noMotor")
          : over
            ? tr("rigging.status.overload")
            : util > 85
              ? tr("rigging.status.caution")
              : tr("common.ok");
        rows.push(
          [
            system.name,
            `P${i + 1}`,
            (f * 100).toFixed(1),
            sLoad.toFixed(2),
            dLoad.toFixed(2),
            util.toFixed(1),
            status,
          ]
            .map(esc)
            .join(","),
        );
      });
    }

    const csv = "\uFEFF" + rows.join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const safeVenue = (venue || "rigging-report")
      .replace(/[^a-z0-9_-]+/gi, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40);
    a.href = url;
    a.download = `${safeVenue || "rigging-report"}-${reportDate}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const cleanupProjectState = useCallback(() => {
    suppressCloudSave.current = true;
    if (projectSaveTimer.current) {
      clearTimeout(projectSaveTimer.current);
      projectSaveTimer.current = null;
    }
    // Truly empty starting system: no truss row, no motor — so the
    // Rigging Report comes up blank instead of carrying over the
    // pre-seeded "4× FD34" row + first hoist.
    const fresh = makeEmptySystem("LX1");
    setProjectName("");
    setVenue("");
    setVenueId(null);
    setEasyjobNumber("");
    setClient("");
    setClientId(null);
    setReportDate(new Date().toISOString().slice(0, 10));
    setReportEndDate("");
    setExtraSchedule({});
    setEngineer(authenticatedProjectManagerName);
    projectManagerAutofillPendingRef.current =
      !authenticatedProjectManagerName;
    setBriefDescription("");
    setClientContact("");
    setSystems([fresh]);
    setActiveSystemId(fresh.id);
    setShowFixtures([]);
    setLinkedMeta({});
    setLedScreens([]);
    setLedLinkedMeta({});
    setLedSettings(DEFAULT_LED_SETTINGS);
    setStages([]);
    setCrew([]);
    setActiveBriefId(null);
    setSendError(null);
    setSoundItems([]);
    setInspection({ ...EMPTY_INSPECTION });
    setPower(defaultPowerPlan());
    // DEFAULT_RIGG_PLAN now starts with `venue: null` and an empty
    // trussById, so this returns the Rigg Plan tab to a truly blank
    // "no venue, no trusses" state rather than the legacy 20×12 m
    // default venue.
    setRiggPlan({ ...DEFAULT_RIGG_PLAN, trussById: {} });
    setFloorPlanLibrary(emptyFloorPlanLibrary());
    setMainView("oversikt");
    // Also wipe any in-flight modal/picker/form state so a Reset
    // mid-session doesn't leave a half-filled "Add custom item"
    // dialog or library picker open over the now-empty report.
    setPickerTarget(null);
    setModalTarget(null);
    setCustName("");
    setCustWeight("");
    setCustWatt("");
    setCustArea("");
    setCustBracket("");
    setShareOpen(false);
    setCurrentProjectId(null);
    setCurrentProjectAccessRole(null);
    setCurrentProjectServerStatus("draft");
    setCurrentProjectIsArchived(false);
    setCloudSavedAt("");
    try {
      localStorage.removeItem(STORAGE_KEY_V2);
      localStorage.removeItem("ehs-current-project-id");
    } catch { /* ignore */ }
  }, [authenticatedProjectManagerName]);

  const resetAll = () => {
    if (!confirm(tr("reset.confirm"))) return;
    cleanupProjectState();
  };

  const hydrateFromData = useCallback((d: Partial<PersistedV2>) => {
    if (d.theme) setThemePref(d.theme);
    setProjectName(resolveProjectName(d.projectName, d.venue));
    setVenue(d.venue ?? "");
    setVenueId(d.venueId ?? null);
    setEasyjobNumber(typeof d.easyjobNumber === "string" ? d.easyjobNumber : "");
    setClient(d.client ?? "");
    setClientId(d.clientId ?? null);
    setReportDate(d.reportDate ?? new Date().toISOString().slice(0, 10));
    setReportEndDate(d.reportEndDate ?? "");
    setExtraSchedule(d.extraSchedule ?? {});
    setEngineer(d.engineer ?? "");
    setBriefDescription(d.briefDescription ?? "");
    setClientContact(d.clientContact ?? "");
    const sysList = d.systems && d.systems.length > 0 ? d.systems : [makeEmptySystem("LX1")];
    setSystems(sysList);
    setActiveSystemId(
      d.activeSystemId && sysList.some((s) => s.id === d.activeSystemId)
        ? d.activeSystemId
        : sysList[0].id,
    );
    setShowFixtures(d.showFixtures ?? []);
    setLinkedMeta(d.linkedMeta ?? {});
    setLedScreens((d.ledScreens ?? []).map((s) => ({ ...s, panelKey: migrateLedPanelKey(s.panelKey) })));
    setLedLinkedMeta(() => {
      const raw = d.ledLinkedMeta ?? {};
      const out: Record<string, LedLinkedMeta> = {};
      for (const [k, v] of Object.entries(raw)) {
        out[k] = { ...v, panelKey: migrateLedPanelKey(v.panelKey) };
      }
      return out;
    });
    setLedSettings(normalizeLedSettings(d.ledSettings));
    setLedSystemState(
      d.ledSystem ? normalizeLedSystem(d.ledSystem) : { ...EMPTY_LED_SYSTEM },
    );
    setStages(
      (d.stages ?? []).map((stage) =>
        normalizeStage(stage, tr("stage.defaultName")),
      ),
    );
    setCrew((d.crew ?? []).map(normalizeCrewMember));
    setSoundItems((d.soundItems ?? []).map(normalizeSoundItem));
    setPower(normalizePowerPlan(d.power));
    setRiggPlan(normalizeRiggPlan(d.riggPlan));
    setActiveBriefId(d.activeBriefId ?? null);
    setInspection(d.inspection ?? { ...EMPTY_INSPECTION });
    if (d.mainView) setMainView(d.mainView);
    setPickerTarget(null);
    setModalTarget(null);
  }, []);

  const flushPendingSave = useCallback(async () => {
    if (projectSaveTimer.current) {
      clearTimeout(projectSaveTimer.current);
      projectSaveTimer.current = null;
    }
    ++projectSaveVersion.current;
    await cloudSaveRef.current(buildPersistedData());
  }, [buildPersistedData]);

  const loadProject = useCallback(async (
    id: string,
    options: { flushCurrent?: boolean } = {},
  ) => {
    try {
      if (options.flushCurrent !== false) {
        await flushPendingSave();
      }
      const token = await getToken();
      if (!token) return;
      const res = await fetch(`/api/projects/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const json = await res.json();
      const p = json.project;
      if (!p?.data) return;
      hydrateFromData({
        ...(p.data as Partial<PersistedV2>),
        projectName:
          p.name ??
          (p.data as Partial<PersistedV2>).projectName ??
          (p.data as Partial<PersistedV2>).venue ??
          p.venue ??
          "",
        venueId: p.venue_id ?? (p.data as Partial<PersistedV2>).venueId,
        clientId: p.client_id ?? (p.data as Partial<PersistedV2>).clientId,
        venue: p.venue ?? (p.data as Partial<PersistedV2>).venue,
        client: p.client ?? (p.data as Partial<PersistedV2>).client,
        easyjobNumber:
          typeof p.easyjob_number === "string"
            ? p.easyjob_number
            : typeof p.easyjobNumber === "string"
              ? p.easyjobNumber
            : (p.data as Partial<PersistedV2>).easyjobNumber,
      });
      setMainView("oversikt");
      setCurrentProjectId(id);
      hydratedProjectRouteRef.current = id;
      setCurrentProjectAccessRole(p.accessRole ?? null);
      setCurrentProjectIsArchived(p.isArchived === true);
      setCurrentProjectServerStatus(normalizeProjectStatus(p.status));
      setCloudSavedAt(
        new Date(p.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      );
      try { localStorage.setItem("ehs-current-project-id", id); } catch { /* ignore */ }
    } catch { /* network error */ }
  }, [getToken, hydrateFromData, flushPendingSave]);

  // Project URLs are first-class routes, not merely a side effect of the
  // database click handler. Keep the latest loader in a ref so editing the
  // project (which changes buildPersistedData/flushPendingSave identities)
  // cannot retrigger route hydration and overwrite in-progress work.
  const loadProjectRef = useRef(loadProject);
  useEffect(() => {
    loadProjectRef.current = loadProject;
  }, [loadProject]);
  useEffect(() => {
    const routeProjectId = projectIdFromPath(location);
    if (!routeProjectId) {
      hydratedProjectRouteRef.current = null;
      return;
    }
    setGlobalView(null);
    if (hydratedProjectRouteRef.current === routeProjectId) return;
    hydratedProjectRouteRef.current = routeProjectId;
    // On direct navigation/reload there is no previous in-memory project to
    // flush. Saving localStorage here could overwrite the requested server
    // project before it is fetched.
    void loadProjectRef.current(routeProjectId, { flushCurrent: false });
  }, [location]);

  const newProject = useCallback(async () => {
    await flushPendingSave();
    cleanupProjectState();
  }, [flushPendingSave, cleanupProjectState]);

  const saveAsNewProject = useCallback(async () => {
    try {
      const token = await getToken();
      if (!token) return;
      const data = buildPersistedData();
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          ...projectIdentityPayload(projectName, venue, venueId),
          client: client || "",
          client_id: clientId || null,
          easyjob_number: easyjobNumber || null,
          data,
        }),
      });
      if (res.ok) {
        const json = await res.json();
        if (json.project?.id) {
          setMainView("oversikt");
          setCurrentProjectId(json.project.id);
          setCurrentProjectAccessRole("owner");
          setCurrentProjectServerStatus(
            normalizeProjectStatus(json.project.status),
          );
          try { localStorage.setItem("ehs-current-project-id", json.project.id); } catch { /* ignore */ }
          setCloudSavedAt(
            new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          );
        }
      }
    } catch { /* network error */ }
  }, [
    getToken,
    buildPersistedData,
    projectName,
    venue,
    venueId,
    client,
    clientId,
    easyjobNumber,
  ]);

  const handleProjectDelete = useCallback((deletedId: string) => {
    if (currentProjectId === deletedId) {
      cleanupProjectState();
    }
  }, [currentProjectId, cleanupProjectState]);

  const linkedUnsentFreelancers = useMemo(() => {
    const alreadyRequested = new Set(
      crew
        .filter((member) => member.freelancerUserId && member.requestStatus)
        .map((member) => member.freelancerUserId!),
    );
    const seen = new Set<string>();
    return crew.flatMap((member) => {
      const id = member.freelancerUserId;
      if (!id || member.requestStatus || alreadyRequested.has(id) || seen.has(id)) {
        return [];
      }
      seen.add(id);
      return [{ id, name: member.name || id }];
    });
  }, [crew]);

  const nextProjectStatus = getNextProjectStatus(currentProjectServerStatus);
  const projectIsTerminal =
    currentProjectIsArchived ||
    currentProjectServerStatus === "completed" ||
    currentProjectServerStatus === "archived";

  const changeProjectStatus = useCallback(async (reason?: string) => {
    const target = getNextProjectStatus(currentProjectServerStatus);
    if (!currentProjectId || !target || statusChanging) return;
    setStatusChanging(true);
    setStatusChangeError("");
    try {
      // Persist crew and project edits first so activation dispatch sees the
      // latest linked freelancers. The status endpoint owns dispatch and is
      // idempotent; the client does not issue a second brief request batch.
      try {
        await flushPendingSave();
      } catch (saveCause) {
        throw new Error(
          saveCause instanceof Error
            ? `${tr("project.status.saveBeforeTransitionError")} ${saveCause.message}`
            : tr("project.status.saveBeforeTransitionError"),
        );
      }
      const token = await getToken();
      if (!token) throw new Error(tr("project.status.authError"));
      const res = await fetch(`/api/projects/${currentProjectId}/status`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ status: target, ...(reason ? { reason } : {}) }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok || !json.project) {
        throw new Error(json?.error || tr("project.status.error"));
      }
      const confirmedStatus = normalizeProjectStatus(
        json.status ?? json.project.status,
        target,
      );
      setCurrentProjectServerStatus(confirmedStatus);
      const dispatchedBriefId =
        json.dispatch?.briefId ?? json.dispatch?.brief?.id ?? null;
      if (typeof dispatchedBriefId === "string" && dispatchedBriefId) {
        setActiveBriefId(dispatchedBriefId);
      }
      setStatusDialogOpen(false);
    } catch (cause) {
      setStatusChangeError(
        cause instanceof Error ? cause.message : tr("project.status.error"),
      );
    } finally {
      setStatusChanging(false);
    }
  }, [
    currentProjectId,
    currentProjectServerStatus,
    flushPendingSave,
    getToken,
    statusChanging,
    tr,
  ]);

  const retryFailedDispatch = useCallback(async () => {
    if (
      !currentProjectId ||
      currentProjectServerStatus !== "active" ||
      dispatchRetryLoading
    ) {
      return;
    }
    setDispatchRetryLoading(true);
    setDispatchRetryError("");
    try {
      const token = await getToken();
      if (!token) throw new Error(tr("project.status.authError"));
      const res = await fetch(`/api/projects/${currentProjectId}/status`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          status: "active",
          retryFailedDispatch: true,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || tr("project.status.retry.error"));
      }
      if (
        json.dispatch?.failed === true ||
        json.dispatch?.status === "failed" ||
        json.dispatch?.outcome === "failed"
      ) {
        throw new Error(
          json.dispatch?.error || json.error || tr("project.status.retry.error"),
        );
      }
      // This operational retry deliberately leaves lifecycle state untouched.
      // The server is authoritative for idempotency and may report a no-op.
      const dispatchedBriefId =
        json.dispatch?.briefId ?? json.dispatch?.brief?.id ?? null;
      if (typeof dispatchedBriefId === "string" && dispatchedBriefId) {
        setActiveBriefId(dispatchedBriefId);
      }
      const alreadySent =
        json.dispatch?.alreadySent === true ||
        json.dispatch?.status === "already_sent" ||
        json.dispatch?.status === "noop";
      setDispatchRetryResult(alreadySent ? "alreadySent" : "sent");
    } catch (cause) {
      setDispatchRetryError(
        cause instanceof Error ? cause.message : tr("project.status.retry.error"),
      );
    } finally {
      setDispatchRetryLoading(false);
    }
  }, [
    currentProjectId,
    currentProjectServerStatus,
    dispatchRetryLoading,
    getToken,
    tr,
  ]);

  const metricsByActive = useMemo(() => computeMetrics(activeSystem), [activeSystem]);

  const allMetrics = useMemo(
    () => systems.map((s) => ({ system: s, metrics: computeMetrics(s) })),
    [systems],
  );

  /** Per-system summary the Rigg Plan tab needs — id, name, hoist points,
   *  static/peak load and SWL — derived from the same metrics that drive
   *  the Rigging Report so the floor plan can never disagree with it. */
  const riggPlanSystems = useMemo<RiggPlanSystemInfo[]>(
    () =>
      allMetrics.map(({ system, metrics }) => ({
        id: system.id,
        name: system.name,
        pointCount: system.pointCount,
        staticKg: metrics.static,
        peakKg: metrics.peak,
        swlKg: metrics.swl,
      })),
    [allMetrics],
  );

  const projectTotals = useMemo(() => {
    let totalStatic = 0,
      totalDynamic = 0,
      totalPower = 0,
      totalMotorPower = 0,
      totalPoints = 0,
      totalArea = 0,
      overloadedPoints = 0;
    for (const { metrics } of allMetrics) {
      totalStatic += metrics.static;
      totalDynamic += metrics.dynamic;
      totalPower += metrics.power;
      totalMotorPower += metrics.motorPower;
      totalPoints += metrics.factors.length;
      totalArea += metrics.area;
      // A "no motor" system has no SWL, so by definition no overload.
      if (metrics.swl > 0) {
        overloadedPoints += metrics.dynamicPointLoads.filter(
          (d) => d > metrics.swl,
        ).length;
      }
    }
    return {
      totalStatic,
      totalDynamic,
      totalPower,
      totalMotorPower,
      totalPoints,
      totalArea,
      overloadedPoints,
    };
  }, [allMetrics]);

  const renderItemRow = (
    row: Row,
    listKey: "riggingRows" | "fixtureRows" | "ledRows",
  ) => {
    const items: InventoryItem[] = row.custom
      ? [row.custom]
      : inventory[row.category as Category];
    const item = getRowItem(row);
    const subtotal = item ? item.weight * row.qty : 0;

    return (
      <div className="item-row" key={row.id}>
        <select
          value={row.custom ? 0 : row.selectedIndex}
          onChange={(e) =>
            updateRowsKey(listKey, (rows) =>
              rows.map((r) =>
                r.id === row.id
                  ? { ...r, selectedIndex: Number(e.target.value) }
                  : r,
              ),
            )
          }
          disabled={!!row.custom}
        >
          {items.map((it, i) => (
            <option key={i} value={i}>
              {it.name}
            </option>
          ))}
        </select>
        <NumberField
          min={0}
          value={row.qty}
          transform={(n) => Math.max(0, n || 0)}
          emptyValue={0}
          onCommit={(qty) =>
            updateRowsKey(listKey, (rows) =>
              rows.map((r) =>
                r.id === row.id
                  ? { ...r, qty }
                  : r,
              ),
            )
          }
        />
        <div className="row-subtotal" title={tr("rigging.rowTotalWeight")}>
          {subtotal.toFixed(1)}
          <span>kg</span>
        </div>
        <button
          className="btn btn-del"
          onClick={() =>
            updateRowsKey(listKey, (rows) => rows.filter((r) => r.id !== row.id))
          }
          aria-label={tr("common.remove")}
        >
          ×
        </button>
      </div>
    );
  };

  const sectionTotal = (rows: Row[]) =>
    rows.reduce((sum, r) => {
      const it = getRowItem(r);
      return sum + (it ? it.weight * r.qty : 0);
    }, 0);

  const peakColor =
    metricsByActive.swl > 0 && metricsByActive.peak > metricsByActive.swl
      ? "var(--danger)"
      : "var(--secondary)";
  const peakUtil =
    metricsByActive.swl > 0 ? metricsByActive.peak / metricsByActive.swl : 0;
  const utilPct = Math.min(100, peakUtil * 100);
  const utilBarColor =
    peakUtil > 1
      ? "var(--danger)"
      : peakUtil > 0.85
        ? "var(--warning)"
        : "var(--primary)";

  // Phase C — derived metrics for the Crew Adequacy meter on the
  // Crew Report tab. We roll up the existing rigging / LED /
  // lighting / stage data so the meter "just updates" as the
  // producer fills in the other tabs (matches the Slice 3
  // acceptance criterion).
  //
  //   - hoistPoints: sum of every system's pointCount (each hoist
  //     is one rigging point);
  //   - fixtureCount: total qty across every system's fixtureRows
  //     (lighting fixtures only — rigging trusses & LED don't
  //     count toward the LD's fixture count);
  //   - ledArea: sum of `area` across LED rows on every system,
  //     using the same getRowItem() lookup the rest of the app
  //     uses;
  //   - stageArea: sum from computeStageTotals(), the canonical
  //     stage roll-up.
  //
  // The other AdequacyMetrics inputs (setupDays, ledWallCount,
  // ticketed) live as a tiny inline form on the panel itself —
  // they don't have an obvious source elsewhere in the app and
  // adding state for them at this level would be ceremony.
  const adequacyMetrics = useMemo(() => {
    let hoistPoints = 0;
    let fixtureCount = 0;
    let ledArea = 0;
    for (const sys of systems) {
      hoistPoints += sys.pointCount;
      for (const row of sys.fixtureRows) {
        fixtureCount += row.qty;
      }
      for (const row of sys.ledRows) {
        const item = getRowItem(row);
        if (item) ledArea += item.area * row.qty;
      }
    }
    // computeStageTotals takes both the stages and their per-stage
    // calcs (the calc carries the area in m²) — mirror what
    // StageReportView does upstream.
    const stageCalcs = stages.map((s) => computeStage(s));
    const stageArea = computeStageTotals(stages, stageCalcs).totalArea;
    return { hoistPoints, fixtureCount, ledArea, stageArea };
  }, [systems, stages]);

  // ====================================================================
  // PLAN B — Overview / AppShell helpers
  // ====================================================================

  const dateLabel = useMemo(() => {
    if (!reportDate) return "";
    const start = new Date(reportDate);
    const startStr = start.toLocaleDateString(dateLocale, {
      day: "numeric",
      month: "short",
    });
    if (!reportEndDate || reportEndDate === reportDate) return startStr;
    const end = new Date(reportEndDate);
    const endStr = end.toLocaleDateString(dateLocale, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
    return `${startStr} – ${endStr}`;
  }, [reportDate, reportEndDate, dateLocale]);

  const overviewCrewDays = useMemo(() => {
    const seen = new Map<string, { label: string; phase: string }>();
    const order = ["setup", "rehearsal", "show", "downrig"] as const;
    for (const phase of order) {
      const days = (phaseDays as Record<string, string[] | undefined>)[phase] ?? [];
      for (const d of days) {
        if (!seen.has(d)) {
          const dt = new Date(d);
          const wd = dt.toLocaleDateString(dateLocale, { weekday: "short" });
          const dn = dt.getDate();
          const cap = wd.charAt(0).toUpperCase() + wd.slice(1, 3);
          seen.set(d, { label: `${cap} ${dn}`, phase });
        }
      }
    }
    return [...seen.entries()].map(([date, v]) => ({ date, label: v.label, phase: v.phase }));
  }, [phaseDays, dateLocale]);

  const overviewCrewDayHeaders = useMemo(
    () => overviewCrewDays.map((d) => d.label),
    [overviewCrewDays],
  );

  const overviewCrewRows = useMemo<OverviewCrewRow[]>(() => {
    return crew.slice(0, 8).map((c) => {
      const status: OverviewCrewRow["status"] =
        c.requestStatus === "accepted"
          ? "confirmed"
          : c.requestStatus === "declined" ||
              c.requestStatus === "too_late" ||
              c.requestStatus === "no-reply"
            ? "declined"
            : c.requestStatus === "requested"
              ? "pending"
              : c.assignedDates && c.assignedDates.length > 0
                ? "confirmed"
                : "draft";
      const blocks = overviewCrewDays.map(({ date }) => {
        const onDay = (c.assignedDates ?? []).includes(date);
        const time =
          onDay && c.callTime && c.offTime ? `${c.callTime}–${c.offTime}` : null;
        return { dayLabel: date, timeLabel: time };
      });
      return {
        id: c.id,
        name: c.name,
        role: c.role,
        status,
        blocks,
      };
    });
  }, [crew, overviewCrewDays]);

  const overviewCrewSummary = useMemo(() => {
    const total = crew.length;
    const confirmed = crew.filter(
      (c) =>
        c.requestStatus === "accepted" ||
        (!c.requestStatus && (c.assignedDates ?? []).length > 0),
    ).length;
    const pending = crew.filter((c) => c.requestStatus === "requested").length;
    const declined = crew.filter(
      (c) =>
        c.requestStatus === "declined" ||
        c.requestStatus === "no-reply" ||
        c.requestStatus === "too_late",
    ).length;
    if (total === 0) return tr("overview.crewSummary.none");
    return tr("overview.crewSummary.line", { confirmed: String(confirmed), total: String(total), pending: String(pending), declined: String(declined) });
  }, [crew, tr]);

  const overviewKpis = useMemo<OverviewKpi[]>(() => {
    const totalCrew = crew.length;
    const confirmed = crew.filter(
      (c) =>
        c.requestStatus === "accepted" ||
        (!c.requestStatus && (c.assignedDates ?? []).length > 0),
    ).length;
    const peakKg = projectTotals.totalDynamic;
    const peakTon = peakKg / 1000;
    const totalSwl = systems.reduce((sum, s) => {
      const h = getHoist(s.hoistIndex);
      return sum + (h.swl ?? 0) * s.pointCount;
    }, 0);
    const totalSwlTon = totalSwl / 1000;
    const ledPanels = ledTotals.panels;
    const ledMax = Math.max(64, ledPanels);
    const totalKw = projectTotals.totalPower / 1000;
    return [
      {
        label: tr("overview.kpi.crew"),
        value: String(totalCrew),
        caption: totalCrew > 0 ? `· ${tr("overview.kpi.confirmedOf", { confirmed: String(confirmed) })}` : "",
        progressValue: confirmed,
        progressMax: Math.max(1, totalCrew),
        progressColor: "#F88000",
        trend:
          totalCrew > 0
            ? {
                label: tr("overview.kpi.readyPct", { pct: String(Math.round((confirmed / Math.max(1, totalCrew)) * 100)) }),
                tone: "up",
              }
            : undefined,
      },
      {
        label: tr("overview.kpi.peakLoad"),
        value: peakTon.toFixed(2),
        caption: tr("overview.kpi.tonnes"),
        progressValue: peakTon,
        progressMax: Math.max(0.001, totalSwlTon),
        progressColor:
          projectTotals.overloadedPoints > 0 ? "#f43f5e" : "#F88000",
        trend:
          projectTotals.overloadedPoints > 0
            ? { label: tr("overview.kpi.overloadCount", { n: String(projectTotals.overloadedPoints) }), tone: "down" }
            : totalSwlTon > 0
              ? { label: tr("overview.kpi.swlCap", { value: totalSwlTon.toFixed(1) }), tone: "neutral" }
              : undefined,
      },
      {
        label: tr("overview.kpi.ledPanels"),
        value: String(ledPanels),
        caption:
          ledPanels > 0
            ? (ledTotals.screens === 1
                ? tr("overview.kpi.inScreens", { n: String(ledTotals.screens) })
                : tr("overview.kpi.inScreensPlural", { n: String(ledTotals.screens) }))
            : "",
        progressValue: ledPanels,
        progressMax: ledMax,
        progressColor: "#F88000",
        trend:
          ledPanels > 0
            ? { label: `${ledTotals.areaM2.toFixed(1)} m²`, tone: "neutral" }
            : undefined,
      },
      {
        label: tr("overview.kpi.power"),
        value: totalKw.toFixed(1),
        caption: "kW",
        progressValue: totalKw,
        progressMax: Math.max(0.001, totalKw * 1.25),
        progressColor: "#F88000",
        trend:
          projectTotals.totalPoints > 0
            ? {
                label: tr("overview.kpi.hoistPoints", { n: String(projectTotals.totalPoints) }),
                tone: "neutral",
              }
            : undefined,
      },
    ];
  }, [crew, projectTotals, systems, ledTotals, tr]);

  const overviewSystems = useMemo<OverviewSystemCard[]>(() => {
    const cards: OverviewSystemCard[] = [];
    for (const s of systems.slice(0, 4)) {
      const m = allMetrics.find((x) => x.system.id === s.id)?.metrics;
      cards.push({
        id: s.id,
        title: s.name,
        subtitle: `${tr("overview.system.points", { n: String(s.pointCount) })} · ${getHoist(s.hoistIndex).label}`,
        icon: "rig",
        rows: [
          { label: tr("overview.system.static"), value: `${(m?.static ?? 0).toFixed(0)} kg` },
          {
            label: tr("overview.system.peakLoad"),
            value: `${(m?.peak ?? 0).toFixed(0)} kg`,
            warn: !!m && m.swl > 0 && m.peak > m.swl,
          },
          { label: tr("overview.system.power"), value: `${((m?.power ?? 0) / 1000).toFixed(1)} kW` },
        ],
      });
    }
    if (allLedScreens.length > 0) {
      cards.push({
        id: "led-summary",
        title: tr("overview.system.ledWall"),
        subtitle: allLedScreens.length === 1
          ? tr("overview.system.screens", { n: String(allLedScreens.length), panels: String(ledTotals.panels) })
          : tr("overview.system.screensPlural", { n: String(allLedScreens.length), panels: String(ledTotals.panels) }),
        icon: "led",
        rows: [
          { label: tr("overview.system.area"), value: `${ledTotals.areaM2.toFixed(1)} m²` },
          { label: tr("overview.system.power"), value: `${(ledTotals.powerW / 1000).toFixed(1)} kW` },
          { label: tr("overview.system.weight"), value: `${ledTotals.weightKg.toFixed(0)} kg` },
        ],
      });
    }
    if (soundItems.length > 0) {
      const totalKg = soundItems.reduce(
        (sum, i) => sum + (i.weightPerUnit ?? 0) * (i.qty ?? 1),
        0,
      );
      cards.push({
        id: "sound-summary",
        title: tr("overview.system.sound"),
        subtitle: soundItems.length === 1
          ? tr("overview.system.units", { n: String(soundItems.length) })
          : tr("overview.system.unitsPlural", { n: String(soundItems.length) }),
        icon: "sound",
        rows: [{ label: tr("overview.system.weight"), value: `${totalKg.toFixed(0)} kg` }],
      });
    }
    if (allLightingFixtures.length > 0) {
      const qty = allLightingFixtures.reduce((s, f) => s + f.qty, 0);
      const watts = allLightingFixtures.reduce(
        (s, f) => s + f.qty * f.watts,
        0,
      );
      cards.push({
        id: "lights-summary",
        title: tr("overview.system.lights"),
        subtitle: tr("overview.system.fixturesTotalPlural", { n: String(qty) }),
        icon: "lights",
        rows: [{ label: tr("overview.system.power"), value: `${(watts / 1000).toFixed(1)} kW` }],
      });
    }
    if (stages.length > 0) {
      cards.push({
        id: "stage-summary",
        title: tr("overview.system.stage"),
        subtitle: stages.length === 1
          ? tr("overview.system.stageUnits", { n: String(stages.length) })
          : tr("overview.system.stageUnitsPlural", { n: String(stages.length) }),
        icon: "stage",
        rows: [],
      });
    }
    return cards;
  }, [systems, allMetrics, allLedScreens, ledTotals, soundItems, allLightingFixtures, stages, tr]);

  const overviewActivity = useMemo<OverviewActivityItem[]>(() => {
    const items: OverviewActivityItem[] = [];
    if (savedAt) {
      items.push({
        id: "saved",
        title: tr("overview.activity.saved"),
        body: tr("overview.activity.savedBody"),
        timeLabel: savedAt,
        tone: "success",
      });
    }
    if (projectTotals.overloadedPoints > 0) {
      items.push({
        id: "overload",
        title: tr("overview.activity.overloadTitle", { n: String(projectTotals.overloadedPoints) }),
        body: tr("overview.activity.overloadBody"),
        timeLabel: tr("overview.activity.now"),
        tone: "warning",
      });
    }
    if (activeBriefId) {
      items.push({
        id: "brief",
        title: tr("overview.activity.briefShared"),
        body: tr("overview.activity.briefSharedBody"),
        timeLabel: tr("overview.activity.active"),
        tone: "info",
      });
    } else if (crew.length > 0) {
      items.push({
        id: "no-brief",
        title: tr("overview.activity.noBrief"),
        body: tr("overview.activity.noBriefBody"),
        timeLabel: "—",
        tone: "neutral",
      });
    }
    if (systems.length === 0 && crew.length === 0) {
      items.push({
        id: "empty",
        title: tr("overview.activity.welcome"),
        body: tr("overview.activity.welcomeBody"),
        timeLabel: "—",
        tone: "info",
      });
    }
    return items;
  }, [savedAt, projectTotals.overloadedPoints, activeBriefId, crew.length, systems.length, tr]);

  const overviewBadges = useMemo<Partial<Record<ShellView, number>>>(
    () => ({
      rigging: systems.length,
      lighting: allLightingFixtures.length,
      led: allLedScreens.length,
      stage: stages.length,
      sound: soundItems.length,
      crew: crew.length,
    }),
    [
      systems.length,
      allLightingFixtures.length,
      allLedScreens.length,
      stages.length,
      soundItems.length,
      crew.length,
    ],
  );

  const projectStatus = currentProjectServerStatus;

  const userEmail = user?.primaryEmailAddress?.emailAddress ?? undefined;
  const userName =
    user?.fullName || user?.firstName || userEmail || tr("overview.defaultUser");
  const userInitial = (
    user?.firstName?.[0] ||
    userEmail?.[0] ||
    "U"
  ).toUpperCase();

  const handleShellSignOut = useCallback(() => {
    try {
      sessionStorage.setItem("ehs-skip-dev-auto-signin", "1");
    } catch {
      /* sessionStorage may be unavailable */
    }
    try {
      localStorage.removeItem("ehs-user-role");
    } catch {
      /* localStorage may be unavailable */
    }
    void clerk.signOut();
  }, [clerk]);

  const shellPrimaryActions: ShellAction[] = useMemo(
    () => [
      {
        id: "share",
        label: tr("shell.action.shareBrief"),
        icon: ShellShare2,
        variant: "primary",
        onClick: () => void emailAssignedCrewBriefs(),
        title: tr("shell.action.shareBriefTitle"),
      },
    ],
    [emailAssignedCrewBriefs, tr],
  );

  const shellSecondaryActions: ShellAction[] = useMemo(
    () => [
      {
        id: "client-pack",
        label: tr("shell.action.clientPack"),
        icon: ShellFileText,
        variant: "secondary",
        onClick: exportClientPackPdf,
        title: tr("shell.action.clientPackTitle"),
      },
      {
        id: "simulate",
        label: tr("shell.action.simulate"),
        icon: ShellPlayCircle,
        variant: "secondary",
        onClick: simulateShow,
        title: tr("shell.action.simulateTitle"),
      },
      {
        id: "led-project-pdf",
        label: tr("shell.action.ledProjectPdf"),
        icon: ShellFileDown,
        variant: "secondary",
        onClick: async () => {
          // Switch to the LED tab first so the canvas SVG is mounted
          // in the DOM — the export reads `.led-canvas` directly. We
          // wait two animation frames so the new view is painted
          // before we serialize the SVG.
          if (mainView !== "led") {
            setMainView("led");
            await new Promise<void>((r) =>
              requestAnimationFrame(() => requestAnimationFrame(() => r())),
            );
          }
          try {
            const { downloadLedProjectPdf } = await import(
              "./lib/ledProjectPdf"
            );
            await downloadLedProjectPdf({
              screens: allLedScreens,
              panels: ledPanels,
              settings: ledSettings,
              beamCatalog: ledBeamsCatalog,
              projectName,
              venue,
              client,
              reportDate,
              logoSrc: ehsLogo,
              locale: i18nLocale === "no" ? "nb-NO" : "en-GB",
              copy: {
                projectPack: tr("export.ledPdf.projectPack"), powerDrawing: tr("export.ledPdf.powerDrawing"), signalDrawing: tr("export.ledPdf.signalDrawing"),
                technicalSummary: tr("export.ledPdf.technicalSummary"), cableSummary: tr("export.ledPdf.cableSummary"), project: tr("export.ledPdf.project"), venue: tr("export.ledPdf.venue"), client: tr("export.ledPdf.client"), date: tr("export.ledPdf.date"),
                screens: tr("export.ledPdf.screens"), panels: tr("export.ledPdf.panels"), totalPixels: tr("export.ledPdf.totalPixels"), area: tr("export.ledPdf.area"), weight: tr("export.ledPdf.weight"), maxOutput: tr("export.ledPdf.maxOutput"), averageOutput: tr("export.ledPdf.averageOutput"), outputsNeeded: tr("export.ledPdf.outputsNeeded"), peakWhite: tr("export.ledPdf.peakWhite"), oneThirdMax: tr("export.ledPdf.oneThirdMax"),
                screen: tr("export.ledPdf.screen"), panel: tr("export.ledPdf.panel"), grid: tr("export.ledPdf.grid"), pixels: tr("export.ledPdf.pixels"), maxWatts: tr("export.ledPdf.maxWatts"), averageWatts: tr("export.ledPdf.averageWatts"), amps: tr("export.ledPdf.amps"), total: tr("export.ledPdf.total"), signalJumpers: tr("export.ledPdf.signalJumpers"), signalLength: tr("export.ledPdf.signalLength"), powerJumpers: tr("export.ledPdf.powerJumpers"), powerLength: tr("export.ledPdf.powerLength"), brackets: tr("export.ledPdf.brackets"), unnamed: tr("export.ledPdf.unnamed"), continued: tr("export.ledPdf.continued"), noCanvas: tr("export.ledPdf.noCanvas"), noScreens: tr("export.ledPdf.noScreens"), cableFootnote: tr("export.ledPdf.cableFootnote"), filenameFallback: tr("export.ledPdf.filenameFallback"), productTitle: tr("global.workspace.productionTool"),
              },
            });
          } catch (err) {
            console.error("[LED project PDF] export failed:", err);
            const msg =
              err instanceof Error && !isLedExportError(err)
                ? err.message
                : tr("export.ledPdf.error");
            alert(msg);
          }
        },
        title: tr("shell.action.ledProjectPdfTitle"),
      },
    ],
    [
      exportClientPackPdf,
      simulateShow,
      tr,
      mainView,
      allLedScreens,
      ledPanels,
      ledSettings,
      projectName,
      venue,
      client,
      reportDate,
    ],
  );

  const activeDispatchRetryAction: ShellAction = {
    id: "retry-dispatch",
    label: tr("project.status.action.retryDispatch"),
    icon: ShellRotateCcw,
    variant: "secondary",
    onClick: () => {
      setDispatchRetryError("");
      setDispatchRetryResult(null);
      setDispatchRetryOpen(true);
    },
    title: tr("project.status.retry.title", {
      name: projectName || tr("shell.breadcrumb.untitled"),
    }),
  };

  const shellOverflowActions: ShellAction[] = useMemo(
    () => [
      {
        id: "open-projects",
        label: tr("projects.title"),
        icon: ShellFolderOpen,
        onClick: () => setProjectsOpen(true),
      },
      {
        id: "save-as-new",
        label: tr("projects.saveAs"),
        icon: ShellCopy,
        onClick: () => void saveAsNewProject(),
        title: tr("projects.saveAsTitle"),
      },
      {
        id: "export-report",
        label: tr("shell.action.printReport"),
        icon: ShellFileDown,
        onClick: () => {
          if (mainView !== "rigging") {
            setMainView("rigging");
            requestAnimationFrame(() =>
              requestAnimationFrame(() => window.print()),
            );
          } else {
            window.print();
          }
        },
        title: tr("shell.action.printReportTitle"),
      },
      {
        id: "csv",
        label: tr("shell.action.downloadCsv"),
        icon: ShellDownload,
        onClick: downloadCsv,
      },
      {
        id: "help",
        label: tr("shell.help"),
        icon: ShellHelpCircle,
        onClick: () => setHelpOpen(true),
      },
    ],
    [mainView, downloadCsv, simulateShow, resetAll, saveAsNewProject, tr],
  );

  const projectMetaSlot = (
    <>
      <div className="meta-field">
        <label>{tr("project.easyjobId")}</label>
        <input
          type="text"
          value={easyjobNumber}
          onChange={(e) => setEasyjobNumber(e.target.value)}
          placeholder={tr("project.easyjobPlaceholder")}
          maxLength={100}
        />
      </div>
      <div className="meta-field">
        <label>{tr("project.projectName")}</label>
        <input
          type="text"
          value={projectName}
          onChange={(event) => setProjectName(event.target.value)}
          placeholder={tr("project.placeholder.projectName")}
          maxLength={200}
        />
      </div>
      <div className="meta-field">
        <label>{tr("project.venue")}</label>
        <div style={{ display: "flex", gap: 8, alignItems: "center", minWidth: 0 }}>
          <input
            list="project-venue-options"
            type="text"
            value={venue}
            onChange={e => {
              const nextVenue = e.target.value;
              const match = venuesOptions.find(
                option => option.name.localeCompare(nextVenue, undefined, { sensitivity: "accent" }) === 0,
              );
              setVenue(nextVenue);
              setVenueId(match?.id ?? null);
            }}
            placeholder={tr("project.select.venue")}
            style={{ flex: 1, minWidth: 0 }}
          />
          <datalist id="project-venue-options">
            {venuesOptions.map(option => <option key={option.id} value={option.name} />)}
          </datalist>
          {venueId && (
            <button
              type="button"
              className="ehs-ghost-btn"
              style={{ padding: "0 8px", minHeight: 44, fontSize: 13 }}
              onClick={() => setShowVenueSpecs(true)}
            >
              {tr("project.specs")}
            </button>
          )}
        </div>
      </div>
      <div className="meta-field">
        <label>{tr("project.client")}</label>
        <div style={{ display: "flex", alignItems: "center", minWidth: 0 }}>
          <input
            list="project-client-options"
            type="text"
            value={client}
            onChange={e => {
              const nextClient = e.target.value;
              const match = clientsOptions.find(
                option => option.companyName.localeCompare(nextClient, undefined, { sensitivity: "accent" }) === 0,
              );
              setClient(nextClient);
              setClientId(match?.id ?? null);
            }}
            placeholder={tr("project.select.client")}
            style={{ flex: 1, minWidth: 0 }}
          />
          <datalist id="project-client-options">
            {clientsOptions.map(option => <option key={option.id} value={option.companyName} />)}
          </datalist>
        </div>
      </div>
      <div className="meta-field">
        <label>{tr("project.clientContact")}</label>
        <input
          type="text"
          value={clientContact}
          onChange={(e) => setClientContact(e.target.value)}
          placeholder={tr("project.placeholder.clientContact")}
        />
      </div>
      <div className="meta-field">
        <label>{tr("project.schedule")}</label>
        <ScheduleField
          reportDate={reportDate}
          reportEndDate={reportEndDate}
          extraSchedule={extraSchedule}
          onChangeReportDate={setReportDate}
          onChangeReportEndDate={setReportEndDate}
          onChangeExtraSchedule={setExtraSchedule}
        />
      </div>
      <div className="meta-field">
        <label>{tr("project.projectManager")}</label>
        <input
          type="text"
          value={engineer}
          onChange={(e) => setEngineer(e.target.value)}
          placeholder={tr("project.placeholder.manager")}
        />
      </div>
      <div
        className="meta-field meta-field--full"
        style={{ gridColumn: "1 / -1" }}
      >
        <label>{tr("project.brief")}</label>
        <textarea
          value={briefDescription}
          onChange={(e) => setBriefDescription(e.target.value)}
          placeholder={tr("project.placeholder.brief")}
          rows={12}
          style={{
            width: "100%",
            resize: "vertical",
            minHeight: 220,
            padding: "12px 14px",
            border: "1px solid rgba(255, 255, 255, 0.12)",
            borderRadius: 6,
            background: "var(--input-bg, #ffffff)",
            color: "var(--text-main, #0f172a)",
            fontSize: 14,
            fontFamily: "inherit",
            lineHeight: 1.5,
            boxSizing: "border-box",
            outline: "none",
          }}
        />
      </div>
    </>
  );

  if (globalView) {
    return (
      <div className="container">
        <GlobalShell
          view={globalView}
          onChangeView={navigateGlobalView}
          userInitial={userInitial}
          userName={userName}
          userRole={tr("shell.userRole.producer")}
          themePref={themePref}
          onChangeTheme={setThemePref}
          onSignOut={handleShellSignOut}
          onHelp={() => setHelpOpen(true)}
        >
          {globalView === "home" ? (
            <HomeDashboard stats={dashboardStats} onNavigate={navigateGlobalView} />
          ) : globalView === "projects" ? (
            <ProjectsDatabasePage
              getToken={getToken}
              canPermanentlyDelete={canPermanentlyDeleteProjects}
              onOpenProject={(id) => {
                void loadProject(id).then(() => {
                  setGlobalView(null);
                  navigate(`/project/${id}`);
                });
              }}
              onNewProject={() => {
                void newProject().then(() => {
                  setGlobalView(null);
                  navigate("/project/new");
                });
              }}
              onProjectDeleted={(id) => {
                handleProjectDelete(id);
              }}
            />
          ) : globalView === "venues" ? (
            <VenuesDatabasePage getToken={getToken} />
          ) : globalView === "clients" ? (
            <ClientsDatabasePage
              getToken={getToken}
              onProjectCloned={(id) => {
                void loadProject(id).then(() => {
                  setGlobalView(null);
                  navigate(`/project/${id}`);
                });
              }}
            />
          ) : globalView === "crew" ? (
            <CrewDirectoryPage getToken={getToken} />
          ) : globalView === "calendar" ? (
            <MasterCalendarPage
              getToken={getToken}
              onOpenProject={(id) => {
                void loadProject(id).then(() => {
                  setGlobalView(null);
                  navigate(`/project/${id}`);
                });
              }}
            />
          ) : globalView === "transport" ? (
            <TransportDashboard
              getToken={getToken}
              onOpenProject={(id) => {
                void loadProject(id).then(() => {
                  setGlobalView(null);
                  navigate(`/project/${id}`);
                });
              }}
            />
          ) : globalView === "tasks" ? (
            <GlobalTaskBoard
              getToken={getToken}
              onOpenProject={(id) => {
                void loadProject(id).then(() => {
                  setGlobalView(null);
                  navigate(`/project/${id}`);
                });
              }}
            />
          ) : globalView === "economy" ? (
            <EconomyDashboard
              getToken={getToken}
              onOpenProject={(id) => {
                void loadProject(id).then(() => {
                  setGlobalView(null);
                  navigate(`/project/${id}`);
                });
              }}
            />
          ) : globalView === "settings" ? (
            <SettingsPage />
          ) : (
            null
          )}
        </GlobalShell>
        <HelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />
      </div>
    );
  }

  return (
    <div className="container">
      <AppShell
        view={mainView as ShellView}
        onChangeView={(v) => setMainView(v as MainView)}
        workspaceLabel={tr("global.workspace.productionTool")}
        workspaceLogoSrc={ehsLogo}
        projectTitle={projectName || tr("shell.breadcrumb.untitled")}
        projectStatus={projectStatus}
        onProjectStatusClick={
          currentProjectId &&
          currentProjectAccessRole !== "viewer" &&
          nextProjectStatus
            ? () => {
                setStatusChangeError("");
                setStatusDialogOpen(true);
              }
            : undefined
        }
        badges={overviewBadges}
        showCatering={!!activeBriefId}
        showHotel={!!activeBriefId}
        savedAt={savedAt}
        primaryActions={
          currentProjectAccessRole === "viewer" || projectIsTerminal
            ? []
            : shellPrimaryActions
        }
        secondaryActions={
          currentProjectServerStatus === "active" &&
          (currentProjectAccessRole === "owner" ||
            currentProjectAccessRole === "editor")
            ? [activeDispatchRetryAction, ...shellSecondaryActions]
            : shellSecondaryActions
        }
        overflowActions={
          projectIsTerminal
            ? shellOverflowActions.filter((action) => action.id !== "save-as-new")
            : shellOverflowActions
        }
        themePref={themePref}
        onChangeTheme={setThemePref}
        userInitial={userInitial}
        userName={userName}
        userRole={tr("shell.userRole.producer")}
        userEmail={userEmail}
        onSignOut={handleShellSignOut}
        onHelp={() => setHelpOpen(true)}
        onHome={() => navigateGlobalView("home")}
        onOpenProjects={() => navigateGlobalView("projects")}
        cloudSavedAt={cloudSavedAt}
        onResetProject={
          currentProjectAccessRole === "viewer" || projectIsTerminal
            ? undefined
            : resetAll
        }
        deleteProjectTrigger={
          canPermanentlyDeleteProjects && currentProjectId ? (
            <DeleteProjectDialog
              projectId={currentProjectId}
              projectName={projectName || tr("shell.breadcrumb.untitled")}
              projectStatus={currentProjectServerStatus}
              getToken={getToken}
              onSuccess={() => {
                handleProjectDelete(currentProjectId);
                navigateGlobalView("projects");
              }}
              trigger={
                <button
                  type="button"
                  title={tr("project.delete.title")}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    height: 22,
                    padding: "0 8px",
                    marginLeft: 4,
                    fontSize: 11,
                    fontWeight: 600,
                    lineHeight: 1,
                    color: "var(--danger)",
                    background: "transparent",
                    border: "1px solid var(--danger)",
                    borderRadius: 999,
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  <ShellTrash2 size={11} />
                  <span>{tr("project.delete.title")}</span>
                </button>
              }
            />
          ) : undefined
        }
        readOnly={
          projectIsTerminal ||
          (currentProjectAccessRole === "viewer" && mainView !== "chat")
        }
        readOnlyLabel={
          projectIsTerminal
            ? tr("shell.readOnly.terminal")
            : tr("shell.readOnly.viewer")
        }
      >
      {mainView === "oversikt" && (
        <OverviewView
          projectTitle={projectName || tr("shell.breadcrumb.untitled")}
          dateLabel={dateLabel}
          venueLabel={venue}
          metaSlot={projectMetaSlot}
          kpis={overviewKpis}
          crewRows={overviewCrewRows}
          crewDayHeaders={overviewCrewDayHeaders}
          crewSummary={overviewCrewSummary}
          systems={overviewSystems}
          hotelSummary={
            activeBriefId
              ? {
                  headline: tr("overview.hotelActive"),
                  sub: tr("overview.hotelActiveSub"),
                  cta: { label: tr("overview.openHotelTab"), onClick: () => setMainView("hotel") },
                }
              : null
          }
          cateringSummary={
            activeBriefId
              ? {
                  headline: tr("overview.cateringActive"),
                  sub: tr("overview.cateringActiveSub"),
                  cta: { label: tr("overview.openCateringTab"), onClick: () => setMainView("catering") },
                }
              : null
          }
          activity={overviewActivity}
          onJump={(v) => setMainView(v as MainView)}
        />
      )}

      <div className="header" style={{ display: "none" }}>
        {/* Top row — logo on the left, signed-in user pinned to the
            absolute top-right (matches the GigSync/Lovable layout). */}
        <div className="header-top-row">
          <div className="header-left">
            <img src={ehsLogo} alt="EHS Logo" className="header-logo-img" />
            <div className="header-title">
              <span className="header-eyebrow">LYD · LYS · BILDE</span>
              <h1>
                Production <span className="header-title-accent">Tool</span>
              </h1>
            </div>
          </div>
          <div className="header-account">
            <ThemeSegmentedControl
              pref={themePref}
              onChange={setThemePref}
            />
            <Link
              href="/portal"
              title={tr("shell.freelancePortalTitle")}
              className="btn btn-pill header-portal-link"
            >
              {/* Lucide-style "users" glyph for Portal. */}
              <svg
                className="btn-pill-icon"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
              <span>{tr("shell.freelancePortal")}</span>
            </Link>
            <SignOutButton />
          </div>
        </div>
        <div className="header-actions">
          {/* Document actions — below the top row.
              Uniform pill row inspired by the GigSync/Lovable layout: every
              secondary action is a small outlined ghost pill, only "Share
              with Crew" is filled in EHS orange as the primary CTA. */}
          <div className="header-doc-actions">
            <span className="autosave-pill" title={tr("shell.savedLocally")}>
              ● {tr("shell.savedAt", { time: savedAt })}
            </span>
            {!projectIsTerminal ? <button
              className="btn btn-pill"
              onClick={resetAll}
              title={tr("header.reset")}
            >
              <span className="btn-pill-icon" aria-hidden>↻</span>
              <span>{tr("header.reset")}</span>
            </button> : null}
            <button
              className="btn btn-pill"
              onClick={downloadCsv}
              title={tr("shell.action.downloadCsv")}
            >
              <span className="btn-pill-icon" aria-hidden>⬇</span>
              <span>CSV</span>
            </button>
            <button
              className="btn btn-pill"
              onClick={() => {
                if (mainView !== "rigging") {
                  setMainView("rigging");
                  requestAnimationFrame(() =>
                    requestAnimationFrame(() => window.print()),
                  );
                } else {
                  window.print();
                }
              }}
            >
              <span className="btn-pill-icon" aria-hidden>↗</span>
              <span>{tr("header.exportReport")}</span>
            </button>
            <button
              className="btn btn-pill"
              onClick={exportClientPackPdf}
              title={tr("shell.action.clientPackTitle")}
            >
              <span className="btn-pill-icon" aria-hidden>▤</span>
              <span>{tr("header.clientPack")}</span>
            </button>
            <button
              className="btn btn-pill"
              onClick={simulateShow}
              title={tr("shell.action.simulateShowTitle")}
            >
              <span className="btn-pill-icon" aria-hidden>▶</span>
              <span>{tr("header.simulateShow")}</span>
            </button>
            {!projectIsTerminal ? <button
              className="btn btn-pill btn-pill-primary"
              onClick={() => void emailAssignedCrewBriefs()}
              title={tr("crew.dispatch.emailAssignedHint")}
            >
              <span className="btn-pill-icon" aria-hidden>↗</span>
              <span>{tr("header.shareWithCrew")}</span>
            </button> : null}
          </div>
        </div>
      </div>

      {/* PROJECT META — moved to OverviewView's metaSlot. Hidden chrome
          retained so any references to the legacy DOM still work for
          print/export paths that may query for it. */}
      <div className="system-identity project-card" style={{ display: "none" }}>
        <div className="project-meta">
          <div className="meta-field">
            <label>{tr("project.projectName")}</label>
            <input
              type="text"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder={tr("project.placeholder.projectName")}
            />
          </div>
          <div className="meta-field">
            <label>{tr("project.venue")}</label>
            <input
              type="text"
              value={venue}
              onChange={(e) => setVenue(e.target.value)}
              placeholder={tr("project.select.venue")}
            />
          </div>
          <div className="meta-field">
            <label>{tr("project.client")}</label>
            <input
              type="text"
              value={client}
              onChange={(e) => setClient(e.target.value)}
              placeholder={tr("project.placeholder.client")}
            />
          </div>
          <div className="meta-field">
            <label>{tr("project.schedule")}</label>
            <ScheduleField
              reportDate={reportDate}
              reportEndDate={reportEndDate}
              extraSchedule={extraSchedule}
              onChangeReportDate={setReportDate}
              onChangeReportEndDate={setReportEndDate}
              onChangeExtraSchedule={setExtraSchedule}
            />
          </div>
          <div className="meta-field">
            <label>{tr("project.projectManager")}</label>
            <input
              type="text"
              value={engineer}
              onChange={(e) => setEngineer(e.target.value)}
              placeholder={tr("project.placeholder.manager")}
            />
          </div>
        </div>
      </div>

      {/* TOP-LEVEL VIEW SWITCHER — replaced by the AppShell sidebar
          nav. Hidden so visual chrome is gone but any keyboard handlers
          / e2e selectors that reach for view-tabs keep working. */}
      <div className="view-switcher no-print" style={{ display: "none" }}>
        <button
          className={`view-tab ${mainView === "rigging" ? "is-active" : ""}`}
          onClick={() => setMainView("rigging")}
        >
          {tr("view.rigging")}
        </button>
        <button
          className={`view-tab ${mainView === "lighting" ? "is-active" : ""}`}
          onClick={() => setMainView("lighting")}
        >
          {tr("view.lighting")}
          {allLightingFixtures.length > 0 && (
            <span className="view-tab-badge">
              {allLightingFixtures.length}
            </span>
          )}
        </button>
        <button
          className={`view-tab ${mainView === "led" ? "is-active" : ""}`}
          onClick={() => setMainView("led")}
        >
          {tr("view.led")}
        </button>
        <button
          className={`view-tab ${mainView === "stage" ? "is-active" : ""}`}
          onClick={() => setMainView("stage")}
        >
          {tr("view.stage")}
          {stages.length > 0 && (
            <span className="view-tab-badge">{stages.length}</span>
          )}
        </button>
        <button
          className={`view-tab ${mainView === "sound" ? "is-active" : ""}`}
          onClick={() => setMainView("sound")}
        >
          {tr("view.sound")}
          {soundItems.length > 0 && (
            <span className="view-tab-badge">{soundItems.length}</span>
          )}
        </button>
        <button
          className={`view-tab ${mainView === "crew" ? "is-active" : ""}`}
          onClick={() => setMainView("crew")}
        >
          {tr("view.crew")}
          {crew.length > 0 && (
            <span className="view-tab-badge">{crew.length}</span>
          )}
        </button>
        {/* Catering tab is only available once the brief has been
            saved server-side — local-only briefs have no portal-linked
            crew to aggregate, and the endpoint is keyed on the
            server brief id. */}
        {activeBriefId && (
          <button
            className={`view-tab ${mainView === "catering" ? "is-active" : ""}`}
            onClick={() => setMainView("catering")}
          >
            {tr("view.catering")}
          </button>
        )}
        {/* Hotel tab gates on activeBriefId for the same reason as
            Catering: hotel logistics are aggregated per brief from
            the brief's confirmed crew, so there's nothing to show
            without one. */}
        {activeBriefId && (
          <button
            className={`view-tab ${mainView === "hotel" ? "is-active" : ""}`}
            onClick={() => setMainView("hotel")}
          >
            {tr("view.hotel")}
          </button>
        )}
        <button
          className={`view-tab ${mainView === "riggPlan" ? "is-active" : ""}`}
          onClick={() => setMainView("riggPlan")}
        >
          {tr("view.riggPlan")}
          {systems.length > 0 && (
            <span className="view-tab-badge">{systems.length}</span>
          )}
        </button>
      </div>

      {mainView === "rigging" && <>

      {/* PROJECT-WIDE SUMMARY */}
      <div className="dashboard project-summary">
        <div className="dash-item">
            <span>{tr("rigging.summary.systems")}</span>
          <strong>{systems.length}</strong>
          <small>{tr("rigging.summary.total")}</small>
        </div>
        <div className="dash-item">
          <span>{tr("rigging.summary.hoists")}</span>
          <strong>{projectTotals.totalPoints}</strong>
          <small>{tr("rigging.summary.points")}</small>
        </div>
        <div className="dash-item">
          <span>{tr("rigging.summary.projectStatic")}</span>
          <strong>{projectTotals.totalStatic.toFixed(1)}</strong>
          <small>kg</small>
        </div>
        <div className="dash-item">
          <span>{tr("rigging.summary.projectDynamic")}</span>
          <strong>{projectTotals.totalDynamic.toFixed(1)}</strong>
          <small>kg</small>
        </div>
        <div className="dash-item">
          <span>{tr("rigging.summary.projectPower")}</span>
          <strong>{projectTotals.totalPower.toLocaleString()}</strong>
          <small>W</small>
        </div>
        <div className="dash-item">
          <span>{tr("rigging.summary.motorPower")}</span>
          <strong>{projectTotals.totalMotorPower.toLocaleString()}</strong>
          <small>W</small>
        </div>
        <div className="dash-item">
          <span>{tr("rigging.summary.overloads")}</span>
          <strong
            style={{
              color:
                projectTotals.overloadedPoints > 0
                  ? "var(--danger)"
                  : "var(--success)",
            }}
          >
            {projectTotals.overloadedPoints}
          </strong>
          <small>{tr(projectTotals.overloadedPoints === 1 ? "rigging.summary.point" : "rigging.summary.points")}</small>
        </div>
      </div>

      {/* SYSTEM MINI CARDS — at-a-glance per-system summary */}
      {systems.length > 1 && (
        <div className="system-mini-grid">
          {allMetrics.map(({ system, metrics }) => {
            const hasHoist = metrics.swl > 0;
            const over = hasHoist && metrics.peak > metrics.swl;
            const util = hasHoist ? metrics.peak / metrics.swl : 0;
            const isActive = system.id === activeSystem.id;
            return (
              <button
                key={system.id}
                className={`system-mini ${isActive ? "is-active" : ""} ${over ? "is-over" : ""}`}
                onClick={() => setActiveSystemId(system.id)}
              >
                <div className="mini-name">{system.name || tr("common.unnamed")}</div>
                <div className="mini-stats">
                  <span>
                    <strong>{metrics.peak.toFixed(0)}</strong>
                    <small>{tr("rigging.summary.kgPeak")}</small>
                  </span>
                  <span>
                    <strong>{system.pointCount}</strong>
                    <small>{tr("rigging.summary.pts")}</small>
                  </span>
                  <span>
                    <strong>{hasHoist ? metrics.swl : "—"}</strong>
                    <small>SWL</small>
                  </span>
                </div>
                <div className="mini-bar">
                  <div
                    className="mini-bar-fill"
                    style={{
                      width: `${Math.min(100, util * 100)}%`,
                      background: over
                        ? "var(--danger)"
                        : util > 0.85
                          ? "var(--warning)"
                          : "var(--primary)",
                    }}
                  />
                </div>
                {over && <span className="mini-over-tag">{tr("rigging.status.overload")}</span>}
              </button>
            );
          })}
        </div>
      )}

      {/* SYSTEM TABS */}
      <div className="system-tabs no-print">
        <div className="tabs-list">
          {systems.map((s) => {
            const m = computeMetrics(s);
            const over = m.swl > 0 && m.peak > m.swl;
            const isActive = s.id === activeSystem.id;
            return (
              <div
                key={s.id}
                className={`system-tab ${isActive ? "is-active" : ""} ${over ? "is-over" : ""}`}
                onClick={() => setActiveSystemId(s.id)}
                role="tab"
              >
                <span className="tab-name">{s.name || tr("common.unnamed")}</span>
                {over && <span className="tab-over">⚠</span>}
                <span
                  className="tab-close"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeSystem(s.id);
                  }}
                  aria-label={tr("rigging.action.removeSystem")}
                  title={
                    systems.length > 1
                      ? tr("rigging.action.removeSystem")
                      : tr("rigging.action.clearSystem")
                  }
                >
                  ×
                </span>
              </div>
            );
          })}
        </div>
        <div className="tabs-actions">
          <button className="btn btn-tab-action" onClick={duplicateActiveSystem}>
            {tr("common.duplicate")}
          </button>
          <button className="btn btn-tab-action btn-tab-add" onClick={addSystem}>
            {tr("rigging.action.newSystem")}
          </button>
        </div>
      </div>

      {/* ACTIVE SYSTEM IDENTITY */}
      <div className="system-identity active-system-card">
        <div className="sys-id-main">
          <label>{tr("rigging.referenceId")}</label>
          <input
            type="text"
            value={activeSystem.name}
            onChange={(e) => updateActiveSystem({ name: e.target.value })}
            placeholder={tr("rigging.referencePlaceholder")}
          />
        </div>
      </div>

      {/* ACTIVE SYSTEM DASHBOARD */}
      <div className="dashboard">
        <div className="dash-item">
          <span>{tr("rigging.summary.staticLoad")}</span>
          <strong>{metricsByActive.static.toFixed(1)}</strong>
          <small>kg</small>
        </div>
        <div className="dash-item">
          <span>{tr("rigging.summary.peakLoad")}</span>
          <strong style={{ color: peakColor }}>
            {metricsByActive.peak.toFixed(1)}
          </strong>
          <small>kg</small>
        </div>
        <div className="dash-item">
          <span>{tr("rigging.summary.swlHeadroom")}</span>
          <strong
            style={{
              color:
                metricsByActive.swl > 0 && metricsByActive.headroom < 0
                  ? "var(--danger)"
                  : "var(--text-main)",
            }}
          >
            {metricsByActive.swl <= 0
              ? "—"
              : metricsByActive.headroom >= 0
                ? metricsByActive.headroom.toFixed(0)
                : `−${Math.abs(metricsByActive.headroom).toFixed(0)}`}
          </strong>
          <small>kg</small>
        </div>
        <div className="dash-item">
          <span>{tr("rigging.summary.totalArea")}</span>
          <strong>{metricsByActive.area.toFixed(1)}</strong>
          <small>m²</small>
        </div>
        <div className="dash-item">
          <span>{tr("rigging.summary.equipmentPower")}</span>
          <strong>{metricsByActive.power.toLocaleString()}</strong>
          <small>W</small>
        </div>
        <div className="dash-item">
          <span>{tr("rigging.summary.motorPower")}</span>
          <strong>{metricsByActive.motorPower.toLocaleString()}</strong>
          <small>W</small>
        </div>
      </div>

      <div className="util-bar-wrap">
        <div className="util-bar-label">
          <span>{tr("rigging.peakUtilization", { name: activeSystem.name })}</span>
          <strong style={{ color: utilBarColor }}>
            {(peakUtil * 100).toFixed(1)}%
          </strong>
        </div>
        <div className="util-bar-track">
          <div
            className="util-bar-fill"
            style={{ width: `${utilPct}%`, background: utilBarColor }}
          />
          <div
            className="util-bar-marker"
            style={{ left: "85%" }}
            title={tr("rigging.caution85")}
          />
          <div
            className="util-bar-marker util-marker-danger"
            style={{ left: "100%" }}
            title={tr("rigging.swl100")}
          />
        </div>
        <div className="util-bar-legend">
          <span>0 kg</span>
          <span>{tr("rigging.caution85")}</span>
          <span>
            SWL {metricsByActive.swl > 0 ? `${metricsByActive.swl} kg` : "—"}
          </span>
        </div>
      </div>

      <div className="main-grid">
        <div className="card">
          <h2>
            {tr("rigging.section.motors")}
            <span className="card-total">
              {(
                activeSystem.pointCount *
                getHoist(activeSystem.hoistIndex).weight
              ).toFixed(1)}{" "}
              kg
            </span>
          </h2>
          <div className="motor-config">
            <div className="motor-config-grid">
              <div>
                <label className="field-label">{tr("rigging.points")}</label>
                <select
                  value={activeSystem.pointCount}
                  onChange={(e) =>
                    updateActiveSystem({ pointCount: Number(e.target.value) })
                  }
                >
                  {[2, 3, 4, 5, 6, 7, 8].map((n) => (
                    <option key={n} value={n}>
                      {tr("rigging.pointCount", { count: n })}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="field-label">{tr("rigging.dynamicFactor")}</label>
                <select
                  value={activeSystem.dynamicFactor}
                  onChange={(e) =>
                    updateActiveSystem({ dynamicFactor: Number(e.target.value) })
                  }
                >
                  <option value={1.0}>{tr("rigging.factor.static")}</option>
                  <option value={1.25}>{tr("rigging.factor.standard")}</option>
                  <option value={1.5}>{tr("rigging.factor.heavy")}</option>
                  <option value={2.0}>{tr("rigging.factor.critical")}</option>
                </select>
              </div>
            </div>
            <label className="field-label" style={{ marginTop: 10 }}>
              {tr("rigging.motorType")}
            </label>
            <select
              value={activeSystem.hoistIndex}
              onChange={(e) =>
                updateActiveSystem({ hoistIndex: Number(e.target.value) })
              }
            >
              {/* "None" lets the producer mark a system as dead-hung /
                  pre-rigged from venue infrastructure — the motor row
                  contributes 0 kg / 0 W and the per-point SWL warning
                  stops firing for this system. */}
              <option value={-1}>{tr("common.none")}</option>
              {hoistModels.map((h, i) => (
                <option key={i} value={i}>
                  {h.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="card">
          <h2>
            {tr("rigging.section.truss")}
            <span className="card-total">
              {sectionTotal(activeSystem.riggingRows).toFixed(1)} kg
            </span>
          </h2>
          <div>
            {activeSystem.riggingRows.map((r) =>
              renderItemRow(r, "riggingRows"),
            )}
          </div>
          {activeSystem.riggingRows.length === 0 && (
            <div className="empty-row">{tr("rigging.empty.truss")}</div>
          )}
          <button
            className="btn btn-add"
            onClick={() =>
              updateRowsKey("riggingRows", (rows) => [
                ...rows,
                makeRow("Truss"),
              ])
            }
          >
            {tr("rigging.action.addTruss")}
          </button>
          <button
            className="btn btn-add btn-custom"
            onClick={() => openModal("Truss")}
          >
            {tr("rigging.action.manualItem")}
          </button>
        </div>

        <div className="card">
          <h2>
            {tr("rigging.section.fixtures")}
            <span className="card-total">
              {sectionTotal(activeSystem.fixtureRows).toFixed(1)} kg
            </span>
          </h2>
          <div>
            {activeSystem.fixtureRows.map((r) =>
              renderItemRow(r, "fixtureRows"),
            )}
          </div>
          {activeSystem.fixtureRows.length === 0 && (
            <div className="empty-row">{tr("rigging.empty.fixtures")}</div>
          )}
          <button
            className="btn btn-add"
            onClick={() =>
              updateRowsKey("fixtureRows", (rows) => [
                ...rows,
                makeRow("Fixtures"),
              ])
            }
          >
            {tr("rigging.action.addFixture")}
          </button>
          <button
            className="btn btn-add btn-custom"
            onClick={() => openModal("Fixtures")}
          >
            {tr("rigging.action.manualItem")}
          </button>
        </div>

        <div className="card">
          <h2>
            {tr("rigging.section.led")}
            <span className="card-total">
              {sectionTotal(activeSystem.ledRows).toFixed(1)} kg
            </span>
          </h2>
          <div>
            {activeSystem.ledRows.map((r) => renderItemRow(r, "ledRows"))}
          </div>
          {activeSystem.ledRows.length === 0 && (
            <div className="empty-row">{tr("rigging.empty.led")}</div>
          )}
          <button
            className="btn btn-add"
            onClick={() =>
              updateRowsKey("ledRows", (rows) => [
                ...rows,
                makeRow("LED Screen"),
              ])
            }
          >
            {tr("rigging.action.addItem")}
          </button>
          <button
            className="btn btn-add btn-custom"
            onClick={() => openModal("LED Screen")}
          >
            {tr("rigging.action.manualItem")}
          </button>
        </div>

        <div className="card full-width">
          <h2>{tr("rigging.section.calculations", { name: activeSystem.name })}</h2>
          <div className="analysis-container">
            <div className="points-summary">
              {metricsByActive.factors.map((f, i) => {
                const sLoad = metricsByActive.staticPointLoads[i];
                const dLoad = metricsByActive.dynamicPointLoads[i];
                const pct = Math.round(f * 100);
                const util =
                  metricsByActive.swl > 0 ? dLoad / metricsByActive.swl : 0;
                const isDanger =
                  metricsByActive.swl > 0 && dLoad > metricsByActive.swl;
                const isWarning = !isDanger && util > 0.85;
                return (
                  <div
                    className={`point-box ${isDanger ? "is-danger" : isWarning ? "is-warning" : ""}`}
                    key={i}
                  >
                    {isDanger && (
                      <div className="overload-badge">
                        <span>⚠</span> {tr("rigging.status.overload")}
                      </div>
                    )}
                    {isWarning && (
                      <div className="overload-badge warning-badge">
                        <span>⚠</span> {tr("rigging.status.caution")}
                      </div>
                    )}
                    <span className="point-label">
                      {tr("rigging.pointLabel", { point: i + 1, pct })}
                    </span>
                    <span className="p-val">
                      {dLoad.toFixed(1)}
                      <small>kg</small>
                    </span>
                    <span className="p-dyn">{tr("rigging.staticLoadValue", { value: sLoad.toFixed(0) })}</span>
                    <div className="point-util-bar">
                      <div
                        className="point-util-fill"
                        style={{
                          width: `${Math.min(100, util * 100)}%`,
                          background: isDanger
                            ? "white"
                            : isWarning
                              ? "var(--warning)"
                              : "var(--primary)",
                        }}
                      />
                    </div>
                    <span className="p-util-text">
                      {tr("rigging.swlUtilization", { pct: (util * 100).toFixed(0) })}
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="chart-section">
              <div className="chart-legend">
                <span>
                  <i style={{ background: "var(--static-bar)" }} /> {tr("rigging.static")}
                </span>
                <span>
                  <i style={{ background: "var(--secondary)" }} /> {tr("rigging.dynamicValue", { factor: activeSystem.dynamicFactor })}
                </span>
                <span>
                  <i style={{ background: "var(--danger)" }} /> {tr("rigging.overSwl")}
                </span>
              </div>
              <div className="bar-chart">
                {metricsByActive.factors.map((_, i) => {
                  const sLoad = metricsByActive.staticPointLoads[i];
                  const dLoad = metricsByActive.dynamicPointLoads[i];
                  const denom =
                    Math.max(metricsByActive.peak, metricsByActive.swl) || 1;
                  const sH = (sLoad / denom) * 240;
                  const dH = (dLoad / denom) * 240;
                  // Without an SWL constraint (no motor), the dynamic
                  // bar should use the neutral colour — otherwise any
                  // positive load would falsely paint red.
                  const barColor =
                    metricsByActive.swl > 0 && dLoad > metricsByActive.swl
                      ? "var(--danger)"
                      : "var(--secondary)";
                  return (
                    <div className="bar-group" key={i}>
                      <div className="bars-side-by-side">
                        <div
                          className="bar"
                          style={{
                            height: `${sH}px`,
                            background: "var(--static-bar)",
                          }}
                          data-value={sLoad.toFixed(0)}
                        />
                        <div
                          className="bar"
                          style={{ height: `${dH}px`, background: barColor }}
                          data-value={dLoad.toFixed(0)}
                        />
                      </div>
                    </div>
                  );
                })}
                {/* SWL guideline — only meaningful when a motor is
                    selected; for no-motor systems we hide it instead
                    of drawing a misleading "SWL 0kg" line at the
                    chart floor. */}
                {metricsByActive.swl > 0 && (
                  <div
                    className="swl-line"
                    style={{
                      bottom: `${(metricsByActive.swl / (Math.max(metricsByActive.peak, metricsByActive.swl) || 1)) * 240}px`,
                    }}
                    title={`SWL ${metricsByActive.swl}kg`}
                  >
                    <span>SWL {metricsByActive.swl}kg</span>
                  </div>
                )}
              </div>
              <div className="vis-container">
                {metricsByActive.factors.map((f, i) => (
                  <div className="vis-point" key={i}>
                    <div className="vis-arrow" />
                    <span className="vis-pct">{Math.round(f * 100)}%</span>
                    <span className="vis-label">P{i + 1}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* PRINT PER-SYSTEM PAGES */}
          <div className="print-only print-systems">
            {allMetrics.map(({ system, metrics }) => (
              <div className="print-system-page" key={system.id}>
                <h3 className="print-system-title">
                  {system.name} — {getHoist(system.hoistIndex).label}
                </h3>
                <div className="print-system-stats">
                  <span>
                    {tr("rigging.print.static")}: <strong>{metrics.static.toFixed(1)} kg</strong>
                  </span>
                  <span>
                    {tr("rigging.print.dynamic", { factor: system.dynamicFactor })}:{" "}
                    <strong>{metrics.dynamic.toFixed(1)} kg</strong>
                  </span>
                  <span>
                    {tr("rigging.print.peakPoint")}:{" "}
                    <strong
                      style={{
                        color:
                          metrics.swl > 0 && metrics.peak > metrics.swl
                            ? "var(--danger)"
                            : "inherit",
                      }}
                    >
                      {metrics.peak.toFixed(1)} kg
                    </strong>
                  </span>
                  <span>
                    {tr("rigging.print.swl")}:{" "}
                    <strong>
                      {metrics.swl > 0 ? `${metrics.swl} kg` : "—"}
                    </strong>
                  </span>
                  <span>
                    {tr("rigging.print.headroom")}:{" "}
                    <strong
                      style={{
                        color:
                          metrics.swl > 0 && metrics.headroom < 0
                            ? "var(--danger)"
                            : "inherit",
                      }}
                    >
                      {metrics.swl > 0
                        ? `${metrics.headroom.toFixed(0)} kg`
                        : "—"}
                    </strong>
                  </span>
                </div>
                <table className="print-table print-points-table">
                  <thead>
                    <tr>
                      <th>{tr("rigging.print.point")}</th>
                      <th>%</th>
                      <th>{tr("rigging.print.staticKg")}</th>
                      <th>{tr("rigging.print.dynamicKg")}</th>
                      <th>{tr("rigging.print.swlUtil")}</th>
                      <th>{tr("rigging.print.status")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {metrics.factors.map((f, i) => {
                      const dLoad = metrics.dynamicPointLoads[i];
                      const sLoad = metrics.staticPointLoads[i];
                      const hasHoist = metrics.swl > 0;
                      const util = hasHoist ? dLoad / metrics.swl : 0;
                      const over = hasHoist && dLoad > metrics.swl;
                      const status = !hasHoist
                        ? "—"
                        : over
                           ? tr("rigging.status.overload")
                          : util > 0.85
                             ? tr("rigging.status.caution")
                             : tr("common.ok");
                      return (
                        <tr key={i} className={over ? "print-over-row" : ""}>
                          <td>P{i + 1}</td>
                          <td>{Math.round(f * 100)}%</td>
                          <td>{sLoad.toFixed(1)}</td>
                          <td>{dLoad.toFixed(1)}</td>
                          <td>{hasHoist ? `${(util * 100).toFixed(0)}%` : "—"}</td>
                          <td>{status}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <table className="print-table print-manifest-table">
                  <thead>
                    <tr>
                      <th>{tr("rigging.print.section")}</th>
                      <th>{tr("rigging.print.item")}</th>
                      <th>{tr("rigging.print.qty")}</th>
                      <th>{tr("rigging.print.unitWeight")}</th>
                      <th>{tr("rigging.print.totalWeight")}</th>
                      <th>{tr("rigging.print.power")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      ...system.riggingRows.map((r) => ({
                        row: r,
                        section: tr("rigging.print.motorsSupport"),
                      })),
                      ...system.fixtureRows.map((r) => ({
                        row: r,
                        section: tr("rigging.print.lightingFixtures"),
                      })),
                      ...system.ledRows.map((r) => ({
                        row: r,
                        section: tr("rigging.print.ledOther"),
                      })),
                    ].map(({ row, section }) => {
                      const it = getRowItem(row);
                      if (!it) return null;
                      return (
                        <tr key={row.id}>
                          <td>{section}</td>
                          <td>{it.name}</td>
                          <td>{row.qty}</td>
                          <td>{it.weight.toFixed(2)} kg</td>
                          <td>{(it.weight * row.qty).toFixed(2)} kg</td>
                          <td>{(it.wattage * row.qty).toLocaleString()} W</td>
                        </tr>
                      );
                    })}
                    <tr className="print-table-total">
                      <td colSpan={4}>{tr("rigging.print.payloadTotal")}</td>
                      <td>{metrics.payload.toFixed(2)} kg</td>
                      <td>{metrics.power.toLocaleString()} W</td>
                    </tr>
                    <tr className="print-table-grand">
                      <td colSpan={4}>
                        {system.hoistIndex < 0
                          ? tr("rigging.print.staticNoMotor")
                          : tr("rigging.print.staticIncludingHoists", { count: system.pointCount })}
                      </td>
                      <td>{metrics.static.toFixed(2)} kg</td>
                      <td>{metrics.motorPower.toLocaleString()} W</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            ))}

            <div className="print-system-page">
              <h3 className="print-system-title">{tr("rigging.print.projectTotals")}</h3>
              <table className="print-table">
                <thead>
                  <tr>
                    <th>{tr("rigging.print.system")}</th>
                    <th>{tr("rigging.print.hoist")}</th>
                    <th>{tr("rigging.print.pts")}</th>
                    <th>{tr("rigging.print.staticKg")}</th>
                    <th>{tr("rigging.print.dynamicKg")}</th>
                    <th>{tr("rigging.print.peakKg")}</th>
                    <th>{tr("rigging.print.swl")}</th>
                    <th>{tr("rigging.print.status")}</th>
                  </tr>
                </thead>
                <tbody>
                  {allMetrics.map(({ system, metrics }) => {
                    const hasHoist = metrics.swl > 0;
                    const over = hasHoist && metrics.peak > metrics.swl;
                    const status = !hasHoist
                      ? tr("rigging.print.noMotor")
                      : over
                        ? tr("rigging.status.overload")
                        : tr("common.ok");
                    return (
                      <tr key={system.id} className={over ? "print-over-row" : ""}>
                        <td>{system.name}</td>
                        <td>{getHoist(system.hoistIndex).label}</td>
                        <td>{system.pointCount}</td>
                        <td>{metrics.static.toFixed(1)}</td>
                        <td>{metrics.dynamic.toFixed(1)}</td>
                        <td>{metrics.peak.toFixed(1)}</td>
                        <td>{hasHoist ? metrics.swl : "—"}</td>
                        <td>{status}</td>
                      </tr>
                    );
                  })}
                  <tr className="print-table-grand">
                    <td colSpan={2}>{tr("rigging.print.projectTotal")}</td>
                    <td>{projectTotals.totalPoints}</td>
                    <td>{projectTotals.totalStatic.toFixed(1)}</td>
                    <td>{projectTotals.totalDynamic.toFixed(1)}</td>
                    <td colSpan={3}>
                      {tr("rigging.print.motorPowerValue", { value: projectTotals.totalMotorPower.toLocaleString() })}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div className="footer">
            <div className="footer-company">EHS AS</div>
            <div className="footer-address">
              Kjeller vest 3, 2007 Kjeller, Norway | Tel: 22 38 90 20 |
              www.ehs.no
            </div>
            <div className="footer-disclaimer">
              Calculations based on EXE Rise D8+ Specifications. Motor weights
              include 24m of chain. Specifications (Safety Factor 8:1).
            </div>
          </div>
        </div>
      </div>

      </>}

      {mainView === "stage" && (
        <StageReportView
          stages={stages}
          onAdd={addStage}
          onUpdate={updateStage}
          onRemove={removeStage}
          onDuplicate={duplicateStage}
          onExport={exportStage}
        />
      )}

      {mainView === "crew" && (
        <CrewReportView
          crew={crew}
          onAdd={addCrew}
          onUpdate={updateCrew}
          onSaveShifts={saveCrewShifts}
          onRemove={removeCrew}
          onDuplicate={duplicateCrew}
          onSendLinkedRequests={sendLinkedCrewRequests}
          onReplaceRole={replaceCrewRole}
          readOnly={projectIsTerminal || currentProjectAccessRole === "viewer"}
          sendingLinkedRequests={sendingRequests}
          activeBriefId={activeBriefId}
          getToken={getToken}
          adequacyMetrics={adequacyMetrics}
          getTimesForDates={getCrewTimesForDates}
          phaseDays={phaseDays}
          phaseShiftTimes={phaseShiftTimes}
          brief={{
            projectName,
            venue,
            clientContact: {
              name: clientContact || client,
            },
            productionContact: {
              name: engineer,
            },
            venueContact: {
              name:
                venuesOptions.find((option) => option.id === venueId)
                  ?.technicalContactName ?? "",
              phone:
                venuesOptions.find((option) => option.id === venueId)
                  ?.technicalContactPhone ?? "",
            },
          }}
        />
      )}

      {mainView === "catering" && activeBriefId && (
        <CateringView briefId={activeBriefId} getToken={getToken} />
      )}

      {mainView === "hotel" && activeBriefId && (
        <HotelView briefId={activeBriefId} getToken={getToken} />
      )}

      {mainView === "sound" && (
        <SoundReportView
          items={soundItems}
          onAdd={addSoundItem}
          onAddFromLibrary={() => setPickerTarget({ kind: "sound" })}
          onUpdate={updateSoundItem}
          onRemove={removeSoundItem}
          onDuplicate={duplicateSoundItem}
        />
      )}

      {mainView === "riggPlan" && (
        <RiggPlanView
          plan={riggPlan}
          systems={riggPlanSystems}
          onUpdateVenue={updateRiggPlanVenue}
          onAddVenue={addRiggPlanVenue}
          onDeleteVenue={deleteRiggPlanVenue}
          onUpdateTruss={updateRiggPlanTruss}
          onDeleteSystem={removeSystem}
          onJumpToRigging={() => setMainView("rigging")}
          onApplyExtractedItems={applyExtractedItems}
          projectName={projectName}
          floorPlans={floorPlanLibrary.plans}
          activeFloorPlanId={floorPlanLibrary.activeId}
          onAddFloorPlan={addFloorPlan}
          onRemoveFloorPlan={removeFloorPlan}
          onSelectFloorPlan={selectFloorPlan}
        />
      )}

      {mainView === "inspection" && (
        <InspectionView
          data={inspection}
          onChange={setInspection}
        />
      )}

      {mainView === "tasks" && (
        <ProjectTaskBoard projectId={currentProjectId} accessRole={currentProjectAccessRole || "viewer"} />
      )}

      {mainView === "chat" && (
        <ProjectChat projectId={currentProjectId} />
      )}

      {mainView === "led" && (
        <LedScreenReportView
          screens={allLedScreens}
          panels={ledPanels}
          settings={ledSettings}
          totals={ledTotals}
          linkedCount={linkedLedScreens.length}
          standaloneCount={ledScreens.length}
          selectedScreenId={selectedLedScreenId}
          onSelectScreen={setSelectedLedScreenId}
          onAddScreen={addLedScreen}
          onUpdateScreen={updateLedScreen}
          onUpdateCustomPanel={updateLedCustomPanel}
          onRemoveScreen={removeLedScreen}
          onDuplicateScreen={duplicateLedScreen}
          onUpdateSettings={updateLedSettings}
          onExportScreen={exportLedScreen}
          onResetScreenPositions={() => {
            // Strip every per-screen position override on the canvas in
            // one go. Linked screens (sourceRowId-keyed in
            // ledLinkedMeta) currently can't be dragged, so we only
            // need to clear standalone ledScreens here.
            setLedScreens((all) =>
              all.map((s) =>
                s.posX === undefined && s.posY === undefined
                  ? s
                  : { ...s, posX: undefined, posY: undefined },
              ),
            );
          }}
          onJumpToRigging={() => setMainView("rigging")}
          ledSystem={ledSystemState}
          onLedSystemChange={setLedSystemState}
          beamsCatalog={ledBeamsCatalog}
        />
      )}

      {mainView === "lighting" && (
        <LightingPlanView
          fixtures={allLightingFixtures}
          linkedCount={linkedFixtures.length}
          standaloneCount={showFixtures.length}
          systems={systems}
          totals={lightingTotals}
          onAdd={addShowFixture}
          onUpdate={updateShowFixture}
          onRemove={removeShowFixture}
          onDuplicate={duplicateShowFixture}
          onJumpToRigging={() => setMainView("rigging")}
          onAddFromLibrary={() => setPickerTarget({ kind: "lighting" })}
          onAddPowerItemFromLibrary={(circuitId, phase) =>
            setPickerTarget({ kind: "power", circuitId, phase })
          }
          power={power}
          onAddPowerCircuit={addPowerCircuit}
          onUpdatePowerCircuit={updatePowerCircuit}
          onRemovePowerCircuit={removePowerCircuit}
          onAddPowerItem={addPowerItem}
          onUpdatePowerItem={updatePowerItem}
          onRemovePowerItem={removePowerItem}
          onDuplicatePowerItem={duplicatePowerItem}
          onAddDistro={addDistro}
          onUpdateDistro={updateDistro}
          onRemoveDistro={removeDistro}
          onResetDistro={resetDistro}
          onExportPowerPlan={exportPowerPlan}
          powerExportToast={powerExportToast}
          onDismissPowerExportToast={dismissPowerExportToast}
          onApplyDistroPreset={applyDistroPreset}
          onUpdateDistroChannelMapping={updateDistroChannelMapping}
          onUpdateDistroChannel={updateDistroChannel}
          onAddDrop={addDrop}
          onUpdateDrop={updateDrop}
          onRemoveDrop={removeDrop}
          onApplyDistroSuggestion={applyDistroSuggestion}
          onApplyPowerLayoutSuggestion={applyPowerLayoutSuggestion}
        />
      )}

      {shareOpen ? (
        <ShareBriefModal
          state={briefInput}
          onClose={() => setShareOpen(false)}
        />
      ) : null}

      {showVenueSpecs && venueId ? (() => {
        const v = venuesOptions.find(o => o.id === venueId);
        if (!v) return null;

        const renderObj = (obj: any) => {
          if (!obj || typeof obj !== 'object') return null;
          return (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 13, marginTop: 4 }}>
              {Object.entries(obj).filter(([_, val]) => val).map(([k, val]) => (
                <div key={k} style={{ background: "var(--input-bg)", padding: 8, borderRadius: 6 }}>
                  <div style={{ fontSize: 10, textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 2 }}>{k.replace(/([A-Z])/g, ' $1')}</div>
                  <div>{String(val)}</div>
                </div>
              ))}
            </div>
          );
        };

        return (
          <div className="modal-backdrop" onClick={() => setShowVenueSpecs(false)}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 700 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
                <h2>{tr("venueSpecs.title", { name: v.name })}</h2>
                <button className="btn-close" onClick={() => setShowVenueSpecs(false)}>×</button>
              </div>
              <div style={{ display: "grid", gap: 16 }}>
                {v.riggingSpecs && Object.values(v.riggingSpecs).some(Boolean) && (
                  <div>
                    <strong>{tr("venueSpecs.riggingStage")}</strong>
                    {renderObj(v.riggingSpecs)}
                  </div>
                )}
                {v.powerInfrastructure && Object.values(v.powerInfrastructure).some(Boolean) && (
                  <div>
                    <strong>{tr("venueSpecs.powerInfrastructure")}</strong>
                    {renderObj(v.powerInfrastructure)}
                  </div>
                )}
                {v.logisticsAccess && Object.values(v.logisticsAccess).some(Boolean) && (
                  <div>
                    <strong>{tr("venueSpecs.logisticsAccess")}</strong>
                    {renderObj(v.logisticsAccess)}
                  </div>
                )}
                {v.siteFacilities && Object.values(v.siteFacilities).some(Boolean) && (
                  <div>
                    <strong>{tr("venueSpecs.siteFacilities")}</strong>
                    {renderObj(v.siteFacilities)}
                  </div>
                )}
                {(!v.riggingSpecs && !v.powerInfrastructure && !v.logisticsAccess && !v.siteFacilities) && (
                  <div style={{ color: "var(--text-muted)" }}>{tr("venueSpecs.empty")}</div>
                )}
              </div>
            </div>
          </div>
        );
      })() : null}

      <HelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />

      <ProjectListModal
        open={projectsOpen}
        onClose={() => setProjectsOpen(false)}
        onOpen={loadProject}
        onNew={newProject}
        onDelete={handleProjectDelete}
        currentProjectId={currentProjectId}
        getToken={getToken}
        canPermanentlyDelete={canPermanentlyDeleteProjects}
      />

      <EquipmentPicker
        open={pickerTarget !== null}
        tab={
          pickerTarget?.kind === "sound"
            ? "sound"
            : pickerTarget?.kind === "lighting"
              ? "lighting"
              : pickerTarget?.kind === "power"
                ? "power"
                : undefined
        }
        onClose={closePicker}
        onPick={handleLibraryPick}
      />

      {modalTarget && (
        <div className="modal-backdrop" onClick={closeModal}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3>{tr("customItem.title")}</h3>
            <input
              type="text"
              placeholder={tr("customItem.name")}
              value={custName}
              onChange={(e) => setCustName(e.target.value)}
            />
            <input
              type="number"
              placeholder={tr("customItem.weight")}
              value={custWeight}
              onChange={(e) => setCustWeight(e.target.value)}
            />
            <input
              type="number"
              placeholder={tr("customItem.power")}
              value={custWatt}
              onChange={(e) => setCustWatt(e.target.value)}
            />
            <input
              type="number"
              placeholder={tr("customItem.area")}
              step="0.01"
              value={custArea}
              onChange={(e) => setCustArea(e.target.value)}
            />
            {modalTarget === "LED Screen" && (
              <input
                type="text"
                placeholder={tr("customItem.bracket")}
                value={custBracket}
                onChange={(e) => setCustBracket(e.target.value)}
              />
            )}
            <div className="modal-actions">
              <button className="btn btn-export" onClick={submitCustom}>
                {tr("common.add")}
              </button>
              <button className="btn btn-custom" onClick={closeModal}>
                {tr("common.cancel")}
              </button>
            </div>
          </div>
        </div>
      )}
      </AppShell>
      {currentProjectId && nextProjectStatus ? (
        <ProjectStatusDialog
          open={statusDialogOpen}
          onOpenChange={(open) => {
            if (!statusChanging) setStatusDialogOpen(open);
          }}
          fromStatus={currentProjectServerStatus}
          toStatus={nextProjectStatus}
          projectName={projectName || tr("shell.breadcrumb.untitled")}
          eligibleFreelancers={linkedUnsentFreelancers}
          loading={statusChanging}
          error={statusChangeError}
          onConfirm={changeProjectStatus}
        />
      ) : null}
      {currentProjectId && currentProjectServerStatus === "active" ? (
        <ProjectStatusDialog
          open={dispatchRetryOpen}
          onOpenChange={(open) => {
            if (!dispatchRetryLoading) setDispatchRetryOpen(open);
          }}
          fromStatus="active"
          toStatus="active"
          projectName={projectName || tr("shell.breadcrumb.untitled")}
          loading={dispatchRetryLoading}
          error={dispatchRetryError}
          dispatchRetry
          dispatchRetryResult={dispatchRetryResult}
          onConfirm={retryFailedDispatch}
        />
      ) : null}
    </div>
  );
}

type LightingPlanViewProps = {
  fixtures: ShowFixture[];
  linkedCount: number;
  standaloneCount: number;
  systems: System[];
  totals: {
    qty: number;
    weight: number;
    watts: number;
    channels: number;
    universesUsed: number;
  };
  onAdd: () => void;
  onUpdate: (id: string, patch: Partial<ShowFixture>) => void;
  onRemove: (id: string) => void;
  onDuplicate: (id: string) => void;
  onJumpToRigging: () => void;
  onAddFromLibrary: () => void;
  onAddPowerItemFromLibrary: (circuitId: string, phase: PowerPhase) => void;
  power: PowerPlan;
  onAddPowerCircuit: () => void;
  onUpdatePowerCircuit: (
    id: string,
    patch: Partial<Omit<PowerCircuit, "items">>,
  ) => void;
  onRemovePowerCircuit: (id: string) => void;
  onAddPowerItem: (circuitId: string, phase?: PowerPhase) => void;
  onUpdatePowerItem: (
    circuitId: string,
    itemId: string,
    patch: Partial<PowerItem>,
  ) => void;
  onRemovePowerItem: (circuitId: string, itemId: string) => void;
  onDuplicatePowerItem: (circuitId: string, itemId: string) => void;
  onAddDistro: (presetId?: DistroPresetId) => void;
  onUpdateDistro: (
    id: string,
    patch: Partial<Omit<Distro, "channels" | "channelMapping" | "id">>,
  ) => void;
  onRemoveDistro: (id: string) => void;
  onResetDistro: (id: string) => void;
  onExportPowerPlan: () => void;
  powerExportToast: string | null;
  onDismissPowerExportToast: () => void;
  onApplyDistroPreset: (id: string, presetId: DistroPresetId) => void;
  onUpdateDistroChannelMapping: (id: string, mapping: ChannelMapping) => void;
  onUpdateDistroChannel: (
    distroId: string,
    channelIndex: number,
    patch: Partial<Omit<Channel, "drops" | "id" | "index">>,
  ) => void;
  onAddDrop: (
    distroId: string,
    channelIndex: number,
    drop: { trussId: string; fixtureRef: string; qty: number; cable?: DropCableKind },
  ) => void;
  onUpdateDrop: (
    distroId: string,
    channelIndex: number,
    dropId: string,
    patch: Partial<Omit<Drop, "id">>,
  ) => void;
  onRemoveDrop: (distroId: string, channelIndex: number, dropId: string) => void;
  onApplyDistroSuggestion: (distroId: string, suggestion: DistroSuggestion) => void;
  onApplyPowerLayoutSuggestion: (suggested: SuggestedDistro[]) => void;
};

function LightingPlanView({
  fixtures,
  linkedCount,
  standaloneCount,
  systems,
  totals,
  onAdd,
  onUpdate,
  onRemove,
  onDuplicate,
  onJumpToRigging,
  onAddFromLibrary,
  onAddPowerItemFromLibrary,
  power,
  onAddPowerCircuit,
  onUpdatePowerCircuit,
  onRemovePowerCircuit,
  onAddPowerItem,
  onUpdatePowerItem,
  onRemovePowerItem,
  onDuplicatePowerItem,
  onAddDistro,
  onUpdateDistro,
  onRemoveDistro,
  onResetDistro,
  onExportPowerPlan,
  powerExportToast,
  onDismissPowerExportToast,
  onApplyDistroPreset,
  onUpdateDistroChannelMapping,
  onUpdateDistroChannel,
  onAddDrop,
  onUpdateDrop,
  onRemoveDrop,
  onApplyDistroSuggestion,
  onApplyPowerLayoutSuggestion,
}: LightingPlanViewProps) {
  const { t: tr } = useI18n();
  const systemNameById = new Map(systems.map((s) => [s.id, s.name]));

  // Group the fixture list by the rigging system (LX) each fixture is
  // assigned to, so the producer sees one collapsible block per truss
  // instead of one long flat table. The order mirrors the order of
  // systems on the Rigging Report (LX1 first, LX2 next…) and an
  // "Unassigned" bucket is appended for rows with no systemId. Groups
  // with no fixtures are not rendered at all. We track *collapsed*
  // ids (not expanded ids) so newly-added groups default to open.
  const UNASSIGNED_ID = "__unassigned__";
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
    () => new Set(),
  );
  const toggleGroup = (id: string) =>
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const isGroupOpen = (id: string) => !collapsedGroups.has(id);

  type FixtureGroup = {
    id: string;
    name: string;
    fixtures: ShowFixture[];
  };
  const fixtureGroups: FixtureGroup[] = (() => {
    const groupMap = new Map<string, ShowFixture[]>();
    for (const f of fixtures) {
      const key = f.systemId || UNASSIGNED_ID;
      const list = groupMap.get(key);
      if (list) list.push(f);
      else groupMap.set(key, [f]);
    }
    const ordered: FixtureGroup[] = [];
    // 1. Real systems in their Rigging Report order.
    for (const sys of systems) {
      const list = groupMap.get(sys.id);
      if (list && list.length > 0) {
        ordered.push({ id: sys.id, name: sys.name, fixtures: list });
        groupMap.delete(sys.id);
      }
    }
    // 2. Orphan systemIds (fixture references a deleted system) so the
    //    rows still surface — labelled with "—" if we have no name.
    for (const [id, list] of groupMap) {
      if (id === UNASSIGNED_ID) continue;
      ordered.push({
        id,
        name: systemNameById.get(id) || "—",
        fixtures: list,
      });
    }
    // 3. Unassigned bucket goes last (typically extra/standalone fixtures
    //    that haven't picked a truss yet).
    const unassigned = groupMap.get(UNASSIGNED_ID);
    if (unassigned && unassigned.length > 0) {
      ordered.push({
        id: UNASSIGNED_ID,
        name: tr("lighting.unassigned"),
        fixtures: unassigned,
      });
    }
    return ordered;
  })();

  // Single per-fixture <tr> renderer. Hoisted out of the inline `.map`
  // so the same JSX is reused for every group without duplication. All
  // edit / overflow / linked-row logic stays identical to the previous
  // ungrouped table.
  const renderFixtureRow = (f: ShowFixture) => {
    const totalChans = f.dmxChannels * f.qty;
    const endAddr = totalChans > 0 ? f.startAddress + totalChans - 1 : 0;
    const overflow = endAddr > 512;
    const totalWt = f.weight * f.qty;
    const totalW = f.watts * f.qty;
    const linkedSysName = f.linked
      ? systemNameById.get(f.systemId) ?? "—"
      : "";
    return (
      <tr
        key={f.id}
        className={f.linked ? "fx-row-linked" : undefined}
      >
        <td>
          {f.linked ? (
            <div className="fx-linked-cell">
              <span
                className="fx-link-badge"
                title={tr("lighting.fromRiggingSystem", { name: linkedSysName })}
              >
                {linkedSysName}
              </span>
              <span className="fx-linked-name" title={f.name}>
                {f.name}
              </span>
            </div>
          ) : (
            <input
              type="text"
              value={f.name}
              onChange={(e) => onUpdate(f.id, { name: e.target.value })}
              placeholder={tr("lighting.fixturePlaceholder")}
              className="fx-input fx-input-name"
              aria-label={tr("lighting.fixtureName")}
            />
          )}
        </td>
        <td>
          {f.linked ? (
            <span className="fx-readonly fx-readonly-num">{f.qty}</span>
          ) : (
            <NumberField
              min={1}
              step={1}
              value={f.qty}
              transform={(n) => Math.max(1, Math.floor(n || 1))}
              emptyValue={1}
              onCommit={(qty) => onUpdate(f.id, { qty })}
              className="fx-input fx-input-num"
              aria-label={tr("lighting.quantity")}
            />
          )}
        </td>
        <td>
          {f.linked ? (
            <span className="fx-readonly fx-readonly-num">
              {f.weight.toFixed(1)}
            </span>
          ) : (
            <NumberField
              step="0.1"
              min={0}
              value={f.weight}
              transform={(n) => Math.max(0, n || 0)}
              emptyValue={0}
              onCommit={(weight) => onUpdate(f.id, { weight })}
              className="fx-input fx-input-num"
              aria-label={tr("lighting.weightPerFixture")}
            />
          )}
        </td>
        <td>
          {f.linked ? (
            <span className="fx-readonly fx-readonly-num">{f.watts}</span>
          ) : (
            <NumberField
              min={0}
              value={f.watts}
              transform={(n) => Math.max(0, n || 0)}
              emptyValue={0}
              onCommit={(watts) => onUpdate(f.id, { watts })}
              className="fx-input fx-input-num"
              aria-label={tr("lighting.powerPerFixture")}
            />
          )}
        </td>
        <td>
          {f.availableDmxModes && f.availableDmxModes.length > 0 ? (
            <div className="fx-mode-cell">
              <select
                value={
                  f.dmxModeIndex === null || f.dmxModeIndex === undefined
                    ? -1
                    : f.dmxModeIndex
                }
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (v === -1) {
                    onUpdate(f.id, {
                      dmxModeIndex: null,
                      dmxChannels: f.dmxChannels,
                    });
                  } else {
                    onUpdate(f.id, { dmxModeIndex: v });
                  }
                }}
                className="fx-input fx-input-select fx-mode-select"
                aria-label={tr("lighting.dmxMode")}
              >
                {f.availableDmxModes.map((m, i) => (
                  <option key={i} value={i}>
                    {m.name} ({m.channels}ch)
                  </option>
                ))}
                <option value={-1}>{tr("lighting.custom")}</option>
              </select>
              {f.dmxModeIndex === null ? (
                <NumberField
                  min={0}
                  step={1}
                  value={f.dmxChannels}
                  transform={(n) => Math.max(0, Math.floor(n || 0))}
                  emptyValue={0}
                  onCommit={(dmxChannels) =>
                    onUpdate(f.id, { dmxChannels })
                  }
                  className="fx-input fx-input-num fx-mode-custom"
                  aria-label={tr("lighting.customDmxChannels")}
                />
              ) : (
                <span
                  className="fx-mode-channels"
                  aria-label={tr("lighting.dmxChannels")}
                >
                  {f.dmxChannels}
                </span>
              )}
            </div>
          ) : (
            <NumberField
              min={0}
              step={1}
              value={f.dmxChannels}
              transform={(n) => Math.max(0, Math.floor(n || 0))}
              emptyValue={0}
              onCommit={(dmxChannels) =>
                onUpdate(f.id, { dmxChannels })
              }
              className="fx-input fx-input-num"
              aria-label={tr("lighting.dmxChannels")}
            />
          )}
        </td>
        <td>
          {f.linked ? (
            <span className="fx-readonly">{linkedSysName}</span>
          ) : (
            <select
              value={f.systemId}
              onChange={(e) => onUpdate(f.id, { systemId: e.target.value })}
              className="fx-input fx-input-select"
              aria-label={tr("lighting.trussAssignment")}
            >
              <option value="">—</option>
              {systems.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          )}
        </td>
        <td>
          <NumberField
            step="0.1"
            value={f.position}
            transform={(n) => n || 0}
            emptyValue={0}
            onCommit={(position) => onUpdate(f.id, { position })}
            className="fx-input fx-input-num"
            aria-label={tr("lighting.positionOnTruss")}
          />
        </td>
        <td>
          <input
            type="text"
            value={f.circuit}
            onChange={(e) => onUpdate(f.id, { circuit: e.target.value })}
            placeholder="—"
            className="fx-input fx-input-circuit"
            aria-label={tr("lighting.powerCircuit")}
          />
        </td>
        <td>
          <NumberField
            min={1}
            step={1}
            value={f.universe}
            transform={(n) => Math.max(1, Math.floor(n || 1))}
            emptyValue={1}
            onCommit={(universe) => onUpdate(f.id, { universe })}
            className="fx-input fx-input-num"
            aria-label={tr("lighting.dmxUniverse")}
          />
        </td>
        <td>
          <NumberField
            min={1}
            max={512}
            step={1}
            value={f.startAddress}
            transform={(n) =>
              Math.max(1, Math.min(512, Math.floor(n || 1)))
            }
            emptyValue={1}
            onCommit={(startAddress) =>
              onUpdate(f.id, { startAddress })
            }
            className="fx-input fx-input-num"
            aria-label={tr("lighting.dmxStartAddress")}
          />
        </td>
        <td
          className={`fx-end ${overflow ? "fx-end-over" : ""}`}
          title={
            overflow
              ? tr("lighting.overflow")
              : ""
          }
        >
          {endAddr || "—"}
          {overflow && " ⚠"}
        </td>
        <td className="fx-total">{totalWt.toFixed(1)}</td>
        <td className="fx-total">{totalW.toLocaleString()}</td>
        <td className="fx-actions">
          <button
            className="fx-row-btn"
            onClick={() => onDuplicate(f.id)}
            title={
              f.linked
                ? tr("lighting.copyStandalone")
                : tr("lighting.duplicateRow")
            }
            aria-label={
              f.linked ? tr("lighting.copyStandalone") : tr("lighting.duplicateRow")
            }
          >
            ⎘
          </button>
          {f.linked ? (
            <button
              className="fx-row-btn fx-row-btn-jump"
              onClick={onJumpToRigging}
              title={tr("lighting.editOnRigging")}
              aria-label={tr("lighting.editOnRigging")}
            >
              ↗
            </button>
          ) : (
            <button
              className="fx-row-btn fx-row-btn-del"
              onClick={() => onRemove(f.id)}
              title={tr("lighting.deleteRow")}
              aria-label={tr("lighting.deleteRow")}
            >
              ×
            </button>
          )}
        </td>
      </tr>
    );
  };

  return (
    <>
      <div className="dashboard project-summary">
        <div className="dash-item">
          <span>{tr("lighting.summary.fixtures")}</span>
          <strong>{totals.qty}</strong>
          <small>{tr("lighting.summary.units")}</small>
        </div>
        <div className="dash-item">
          <span>{tr("lighting.summary.weight")}</span>
          <strong>{totals.weight.toFixed(1)}</strong>
          <small>kg</small>
        </div>
        <div className="dash-item">
          <span>{tr("lighting.summary.power")}</span>
          <strong>{totals.watts.toLocaleString()}</strong>
          <small>W</small>
        </div>
        <div className="dash-item">
          <span>{tr("lighting.summary.dmxChannels")}</span>
          <strong>{totals.channels.toLocaleString()}</strong>
          <small>{tr("lighting.summary.used")}</small>
        </div>
        <div className="dash-item">
          <span>{tr("lighting.summary.universes")}</span>
          <strong>{totals.universesUsed}</strong>
          <small>{tr("lighting.summary.active")}</small>
        </div>
        <div className="dash-item">
          <span>{tr("lighting.summary.lines")}</span>
          <strong>{fixtures.length}</strong>
          <small>{tr("lighting.summary.entries")}</small>
        </div>
      </div>

      <PowerPlanView
        plan={power}
        fixtures={fixtures}
        systems={systems}
        onAddCircuit={onAddPowerCircuit}
        onUpdateCircuit={onUpdatePowerCircuit}
        onRemoveCircuit={onRemovePowerCircuit}
        onAddItem={onAddPowerItem}
        onAddItemFromLibrary={onAddPowerItemFromLibrary}
        onUpdateItem={onUpdatePowerItem}
        onRemoveItem={onRemovePowerItem}
        onDuplicateItem={onDuplicatePowerItem}
        onAddDistro={onAddDistro}
        onUpdateDistro={onUpdateDistro}
        onRemoveDistro={onRemoveDistro}
        onResetDistro={onResetDistro}
        onExportPowerPlan={onExportPowerPlan}
        powerExportToast={powerExportToast}
        onDismissPowerExportToast={onDismissPowerExportToast}
        onApplyDistroPreset={onApplyDistroPreset}
        onUpdateDistroChannelMapping={onUpdateDistroChannelMapping}
        onUpdateDistroChannel={onUpdateDistroChannel}
        onAddDrop={onAddDrop}
        onUpdateDrop={onUpdateDrop}
        onRemoveDrop={onRemoveDrop}
        onApplyDistroSuggestion={onApplyDistroSuggestion}
        onApplyPowerLayoutSuggestion={onApplyPowerLayoutSuggestion}
      />

      <div className="card">
        <h2>
          {tr("lighting.fixtureList")}
          <span className="card-total">
            {tr(fixtures.length === 1 ? "lighting.lineCount" : "lighting.lineCountPlural", { count: fixtures.length })}
            {linkedCount > 0 && (
              <span className="fx-source-tally">
                {" "}
                {tr("lighting.sourceTally", { linked: linkedCount, standalone: standaloneCount })}
              </span>
            )}
          </span>
        </h2>
        <div className="lighting-help">
          {tr("lighting.help")}{" "}
          <button
            type="button"
            className="link-btn"
            onClick={onJumpToRigging}
          >
            {tr("lighting.openRigging")}
          </button>
        </div>
        {fixtures.length === 0 ? (
          <div className="lighting-empty">
            {tr("lighting.empty.prefix")}{" "}
            <button
              type="button"
              className="link-btn"
              onClick={onJumpToRigging}
            >
              {tr("lighting.riggingReport")}
            </button>{" "}
            {tr("lighting.empty.middle")}{" "}
            <strong>{tr("lighting.addExtra")}</strong>{tr("lighting.empty.suffix")}
          </div>
        ) : (
          <div className="fx-table-wrap">
            <table className="fx-table">
              <thead>
                <tr>
                  <th style={{ minWidth: 200 }}>{tr("lighting.table.fixture")}</th>
                  <th>{tr("lighting.table.quantity")}</th>
                  <th>{tr("lighting.table.weight")}</th>
                  <th>{tr("lighting.table.power")}</th>
                  <th>{tr("lighting.table.dmx")}</th>
                  <th>{tr("lighting.table.truss")}</th>
                  <th>{tr("lighting.table.position")}</th>
                  <th>{tr("lighting.table.circuit")}</th>
                  <th>{tr("lighting.table.universe")}</th>
                  <th>{tr("lighting.table.address")}</th>
                  <th>{tr("lighting.table.end")}</th>
                  <th>{tr("lighting.table.totalWeight")}</th>
                  <th>{tr("lighting.table.totalPower")}</th>
                  <th></th>
                </tr>
              </thead>
              {fixtureGroups.map((g) => {
                const open = isGroupOpen(g.id);
                const gQty = g.fixtures.reduce((n, f) => n + f.qty, 0);
                const gWt = g.fixtures.reduce(
                  (n, f) => n + f.weight * f.qty,
                  0,
                );
                const gW = g.fixtures.reduce(
                  (n, f) => n + f.watts * f.qty,
                  0,
                );
                const gChans = g.fixtures.reduce(
                  (n, f) => n + f.dmxChannels * f.qty,
                  0,
                );
                return (
                  <tbody key={g.id} className="fx-group">
                    <tr
                      className={`fx-group-header ${open ? "is-open" : "is-closed"}`}
                      onClick={() => toggleGroup(g.id)}
                    >
                      <td colSpan={14}>
                        <div className="fx-group-row">
                          <span
                            className="fx-group-toggle"
                            aria-hidden="true"
                          >
                            {open ? "▾" : "▸"}
                          </span>
                          <strong className="fx-group-name">{g.name}</strong>
                          <span className="fx-group-meta">
                            {g.fixtures.length}{" "}
                            {tr(g.fixtures.length === 1 ? "lighting.line" : "lighting.lines")} ·{" "}
                            {tr("lighting.groupMeta", { qty: gQty, weight: gWt.toFixed(1), power: gW.toLocaleString() })}
                            {gW.toLocaleString()} W
                            {gChans > 0 ? (
                              <> · {tr("lighting.channelsValue", { count: gChans.toLocaleString() })}</>
                            ) : null}
                          </span>
                        </div>
                      </td>
                    </tr>
                    {open && g.fixtures.map((f) => renderFixtureRow(f))}
                  </tbody>
                );
              })}
              {fixtures.length > 0 && (
                <tfoot>
                  <tr>
                    <td colSpan={12} style={{ textAlign: "right" }}>
                      <strong>{tr("lighting.totals")}</strong>
                    </td>
                    <td className="fx-total">{totals.weight.toFixed(1)}</td>
                    <td className="fx-total">
                      {totals.watts.toLocaleString()}
                    </td>
                    <td></td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
        <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <button className="btn btn-soft" onClick={onAddFromLibrary}>
            {tr("lighting.fromLibrary")}
          </button>
          <button className="btn btn-export" onClick={onAdd}>
            {tr("lighting.addExtra")}
          </button>
          <span className="lighting-help" style={{ marginLeft: 4 }}>
            {tr("lighting.oneOffHint")}
          </span>
        </div>
      </div>
    </>
  );
}

/* ───────────── Schedule field (compact popover) ─────────────
 * Shows a single trigger pill summarising the production schedule
 * (e.g. "Setup Jun 14 → Downrig Jun 18 · 4 phases"). Clicking the
 * trigger opens a small popover with one row per phase: Setup,
 * Rehearsal, Show, and Downrig. Each row has From/To date inputs.
 * Click-outside or pressing Escape closes the popover. The "Show"
 * phase writes back to reportDate/reportEndDate; the others live in
 * extraSchedule. */

const SCHEDULE_PHASES_ORDER: SchedulePhaseKey[] = [
  "setup",
  "rehearsal",
  "show",
  "downrig",
];

function addIsoCalendarDay(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return "";
  const date = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  );
  if (
    date.getUTCFullYear() !== Number(match[1]) ||
    date.getUTCMonth() !== Number(match[2]) - 1 ||
    date.getUTCDate() !== Number(match[3])
  ) {
    return "";
  }
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function fmtShortDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function summariseSchedule(
  reportDate: string,
  reportEndDate: string,
  extra: ExtraSchedule,
  addDatesLabel: string,
): { label: string; phaseCount: number; hasTbdTime: boolean } {
  // Flatten every phase's segments into a single (from, to) list and
  // pick the global min / max so the trigger pill always shows the
  // full active span — even when the producer entered separate days
  // across multiple phases (e.g. Setup Apr 29, Show May 5).
  const segs: Array<{ from: string; to: string }> = [];
  let hasTbdTime = false;
  if (reportDate || reportEndDate) {
    segs.push({ from: reportDate, to: reportEndDate || reportDate });
    hasTbdTime = extra.show?.[0]?.timeTbd === true;
  }
  const phasesUsed = new Set<SchedulePhaseKey>();
  if (reportDate || reportEndDate) phasesUsed.add("show");
  (["setup", "rehearsal", "downrig"] as const).forEach((k) => {
    const arr = extra[k];
    if (!arr) return;
    let used = false;
    for (const ph of arr) {
      if (ph.from || ph.to) {
        segs.push({ from: ph.from, to: ph.to });
        if (ph.timeTbd) hasTbdTime = true;
        used = true;
      }
    }
    if (used) phasesUsed.add(k);
  });
  // Show may also have additional days under `extra.show[1..]`.
  const showExtra = extra.show ?? [];
  for (let i = 1; i < showExtra.length; i++) {
    const s = showExtra[i];
    if (s.from || s.to) {
      segs.push({ from: s.from, to: s.to });
      if (s.timeTbd) hasTbdTime = true;
    }
  }
  if (segs.length === 0) {
    return { label: addDatesLabel, phaseCount: 0, hasTbdTime: false };
  }
  const fromIso = segs
    .map((p) => p.from || p.to)
    .filter(Boolean)
    .sort()[0];
  const toIso = segs
    .map((p) => p.to || p.from)
    .filter(Boolean)
    .sort()
    .slice(-1)[0];
  const span =
    fromIso && toIso && fromIso !== toIso
      ? `${fmtShortDate(fromIso)} → ${fmtShortDate(toIso)}`
      : fmtShortDate(fromIso || toIso || "");
  return { label: span, phaseCount: phasesUsed.size, hasTbdTime };
}

function ScheduleField({
  reportDate,
  reportEndDate,
  extraSchedule,
  onChangeReportDate,
  onChangeReportEndDate,
  onChangeExtraSchedule,
}: {
  reportDate: string;
  reportEndDate: string;
  extraSchedule: ExtraSchedule;
  onChangeReportDate: (v: string) => void;
  onChangeReportEndDate: (v: string) => void;
  onChangeExtraSchedule: (
    updater: (prev: ExtraSchedule) => ExtraSchedule,
  ) => void;
}) {
  const { t: tr } = useI18n();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    // Capture phase so native date pickers can't swallow Escape before us.
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  const summary = summariseSchedule(
    reportDate,
    reportEndDate,
    extraSchedule,
    tr("schedule.addDates"),
  );

  type PhaseSide = "from" | "to" | "fromTime" | "toTime";

  const emptySeg = (): ScheduleSegment => ({
    from: "",
    to: "",
    fromTime: "",
    toTime: "",
    timeTbd: false,
  });

  /** Display-side segments for one phase. Always returns at least one
   *  segment (the editor never collapses to zero rows). For Show, the
   *  first segment is synthesized from `reportDate`/`reportEndDate`
   *  plus the times stored at `extraSchedule.show[0]`; subsequent
   *  segments come straight from `extraSchedule.show[1..]`. */
  const getSegments = (key: SchedulePhaseKey): ScheduleSegment[] => {
    if (key === "show") {
      const arr = extraSchedule.show ?? [];
      const primary: ScheduleSegment = {
        from: reportDate,
        to: reportEndDate,
        fromTime: arr[0]?.fromTime ?? "",
        toTime: arr[0]?.toTime ?? "",
        timeTbd: arr[0]?.timeTbd === true,
      };
      const rest = arr.slice(1);
      return [primary, ...rest];
    }
    const arr = extraSchedule[key] ?? [];
    return arr.length > 0 ? arr : [emptySeg()];
  };

  const phaseSegments = (
    key: SchedulePhaseKey,
    schedule: ExtraSchedule,
  ): ScheduleSegment[] => {
    if (key !== "show") return schedule[key] ?? [];
    return [
      {
        from: reportDate,
        to: reportEndDate,
        fromTime: schedule.show?.[0]?.fromTime ?? "",
        toTime: schedule.show?.[0]?.toTime ?? "",
        timeTbd: schedule.show?.[0]?.timeTbd === true,
      },
      ...(schedule.show ?? []).slice(1),
    ];
  };

  const lastPhaseDate = (
    key: SchedulePhaseKey,
    schedule: ExtraSchedule,
  ): string => {
    const segments = phaseSegments(key, schedule);
    for (let idx = segments.length - 1; idx >= 0; idx -= 1) {
      const date = segments[idx].to || segments[idx].from;
      if (addIsoCalendarDay(date)) return date;
    }
    return "";
  };

  const defaultDateForAddedDay = (
    key: SchedulePhaseKey,
    schedule: ExtraSchedule,
  ): string => {
    const withinPhase = lastPhaseDate(key, schedule);
    if (withinPhase) return addIsoCalendarDay(withinPhase);

    const phaseIndex = SCHEDULE_PHASES_ORDER.indexOf(key);
    for (let idx = phaseIndex - 1; idx >= 0; idx -= 1) {
      const previousPhaseDate = lastPhaseDate(
        SCHEDULE_PHASES_ORDER[idx],
        schedule,
      );
      if (previousPhaseDate) return addIsoCalendarDay(previousPhaseDate);
    }
    return "";
  };

  const setSegment = (
    key: SchedulePhaseKey,
    idx: number,
    side: PhaseSide,
    value: string,
  ) => {
    // Show segment 0's calendar dates always live on
    // reportDate/reportEndDate so the rest of the app keeps working
    // unchanged. Its times live alongside any extra show days in
    // `extraSchedule.show[0]`.
    if (key === "show" && idx === 0) {
      if (side === "from") {
        const previousFrom = reportDate;
        onChangeReportDate(value);
        if (
          !reportEndDate ||
          reportEndDate === previousFrom ||
          (value && reportEndDate < value)
        ) {
          onChangeReportEndDate(value);
        }
        return;
      }
      if (side === "to") {
        onChangeReportEndDate(
          value && reportDate && value < reportDate ? reportDate : value,
        );
        return;
      }
      onChangeExtraSchedule((prev) => {
        const arr = [...(prev.show ?? [])];
        const cur = arr[0] ?? emptySeg();
        const next = { ...cur, [side]: value };
        const sameDay =
          !reportDate ||
          !reportEndDate ||
          reportDate === reportEndDate;
        if (
          sameDay &&
          side === "fromTime" &&
          next.toTime &&
          value &&
          next.toTime < value
        ) {
          next.toTime = value;
        } else if (
          sameDay &&
          side === "toTime" &&
          next.fromTime &&
          value &&
          value < next.fromTime
        ) {
          next.toTime = next.fromTime;
        }
        arr[0] = next;
        return { ...prev, show: arr };
      });
      return;
    }
    onChangeExtraSchedule((prev) => {
      const arr = [...(prev[key] ?? [])];
      // Pad up to idx so the user can edit a freshly added row
      // even before any other slot is populated.
      while (arr.length <= idx) arr.push(emptySeg());
      const cur = arr[idx];
      const next: ScheduleSegment = { ...cur, [side]: value };
      if (side === "from") {
        if (
          !next.to ||
          next.to === cur.from ||
          (value && next.to < value)
        ) {
          next.to = value;
        }
      } else if (side === "to" && value && next.from && value < next.from) {
        next.to = next.from;
      } else {
        const sameDay = !next.from || !next.to || next.from === next.to;
        if (
          sameDay &&
          side === "fromTime" &&
          next.toTime &&
          value &&
          next.toTime < value
        ) {
          next.toTime = value;
        } else if (
          sameDay &&
          side === "toTime" &&
          next.fromTime &&
          value &&
          value < next.fromTime
        ) {
          next.toTime = next.fromTime;
        }
      }
      arr[idx] = next;
      const out: ExtraSchedule = { ...prev };
      // Drop trailing empties so we don't accumulate dead segments.
      while (
        arr.length > 0 &&
        !arr[arr.length - 1].from &&
        !arr[arr.length - 1].to &&
        !arr[arr.length - 1].fromTime &&
        !arr[arr.length - 1].toTime &&
        !arr[arr.length - 1].timeTbd
      ) {
        // For show, never drop slot 0 — it carries the primary times
        // even when the row appears empty in storage.
        if (key === "show" && arr.length === 1) break;
        arr.pop();
      }
      if (arr.length === 0) {
        delete out[key];
      } else {
        out[key] = arr;
      }
      return out;
    });
  };

  const setTimeTbd = (
    key: SchedulePhaseKey,
    idx: number,
    enabled: boolean,
  ) => {
    onChangeExtraSchedule((prev) => {
      const arr = [...(prev[key] ?? [])];
      while (arr.length <= idx) arr.push(emptySeg());
      const cur = arr[idx];
      arr[idx] = {
        ...cur,
        timeTbd: enabled,
        ...(enabled ? { fromTime: "", toTime: "" } : {}),
      };
      const out: ExtraSchedule = { ...prev };
      while (
        arr.length > 0 &&
        !arr[arr.length - 1].from &&
        !arr[arr.length - 1].to &&
        !arr[arr.length - 1].fromTime &&
        !arr[arr.length - 1].toTime &&
        !arr[arr.length - 1].timeTbd
      ) {
        if (key === "show" && arr.length === 1) break;
        arr.pop();
      }
      if (arr.length === 0) delete out[key];
      else out[key] = arr;
      return out;
    });
  };

  const addDay = (key: SchedulePhaseKey) => {
    if (key === "show" && !reportDate && !reportEndDate) {
      const defaultDate = defaultDateForAddedDay(key, extraSchedule);
      if (defaultDate) {
        onChangeReportDate(defaultDate);
        onChangeReportEndDate(defaultDate);
        return;
      }
    }
    onChangeExtraSchedule((prev) => {
      const arr = [...(prev[key] ?? [])];
      const defaultDate = defaultDateForAddedDay(key, prev);
      const newSegment: ScheduleSegment = {
        ...emptySeg(),
        from: defaultDate,
        to: defaultDate,
      };
      // For Show the first storage slot is reserved for the primary
      // times; tap-to-add must always create a *new* row beyond that.
      if (key === "show" && arr.length === 0) arr.push(emptySeg());
      arr.push(newSegment);
      return { ...prev, [key]: arr };
    });
  };

  const removeDay = (key: SchedulePhaseKey, idx: number) => {
    if (key === "show" && idx === 0) return; // primary show row is fixed
    onChangeExtraSchedule((prev) => {
      const arr = [...(prev[key] ?? [])];
      if (idx < 0 || idx >= arr.length) return prev;
      arr.splice(idx, 1);
      const out: ExtraSchedule = { ...prev };
      // For show, keep the storage slot 0 as long as it carries times,
      // otherwise drop the whole entry to keep the schedule tidy.
      if (arr.length === 0) {
        delete out[key];
      } else if (
        key === "show" &&
        arr.length === 1 &&
        !arr[0].fromTime &&
        !arr[0].toTime &&
        !arr[0].timeTbd
      ) {
        delete out.show;
      } else {
        out[key] = arr;
      }
      return out;
    });
  };

  const clearAll = () => {
    onChangeReportDate("");
    onChangeReportEndDate("");
    onChangeExtraSchedule(() => ({}));
    setOpen(false);
  };

  const clearPhase = (key: SchedulePhaseKey) => {
    if (key === "show") {
      onChangeReportDate("");
      onChangeReportEndDate("");
    }
    onChangeExtraSchedule((prev) => {
      if (!(key in prev)) return prev;
      const out = { ...prev };
      delete out[key];
      return out;
    });
  };

  return (
    <div style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          width: "100%",
          padding: "9px 10px",
          border: "1px solid var(--border-color)",
          borderRadius: 8,
          background: "var(--input-bg)",
          color: "var(--text-main)",
          font: "inherit",
          fontWeight: 600,
          fontSize: 14,
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <span
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {summary.label}
          {summary.phaseCount > 1 ? (
            <span
              style={{
                marginLeft: 6,
                fontSize: 11,
                fontWeight: 700,
                color: "var(--text-muted)",
              }}
            >
              · {tr("schedule.phaseCount", { count: summary.phaseCount })}
            </span>
          ) : null}
          {summary.hasTbdTime ? (
            <span
              style={{
                marginLeft: 6,
                fontSize: 11,
                fontWeight: 800,
                color: "var(--text-muted)",
              }}
            >
              · {tr("schedule.timeTbd")}
            </span>
          ) : null}
        </span>
        <span
          aria-hidden
          style={{
            opacity: 0.6,
            transform: open ? "rotate(180deg)" : "none",
            transition: "transform 120ms",
          }}
        >
          ▾
        </span>
      </button>
      {open ? (
        <>
          {/* Transparent click-catcher: closes the popover on any
           *  click outside the dialog without depending on document
           *  event delegation. */}
          <div
            onMouseDown={() => setOpen(false)}
            aria-hidden
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 49,
              background: "transparent",
            }}
          />
          <div
            role="dialog"
            aria-label={tr("schedule.projectSchedule")}
            onMouseDown={(e) => e.stopPropagation()}
            style={{
              position: "absolute",
              top: "calc(100% + 6px)",
              left: 0,
              zIndex: 50,
              width: "min(560px, calc(100vw - 24px))",
              maxWidth: 560,
              padding: 12,
              background: "var(--card-bg)",
              border: "1px solid var(--border-color)",
              borderRadius: 10,
              boxShadow: "0 10px 30px rgba(0,0,0,0.18)",
              display: "grid",
              gap: 8,
            }}
          >
          {SCHEDULE_PHASES_ORDER.map((key) => {
            const segments = getSegments(key);
            const phaseActive = segments.some(
              (segment) =>
                segment.from ||
                segment.to ||
                segment.fromTime ||
                segment.toTime ||
                segment.timeTbd,
            );
            const inputStyle = {
              padding: "6px 8px",
              border: "1px solid var(--border-color)",
              borderRadius: 6,
              background: "var(--input-bg)",
              color: "var(--text-main)",
              font: "inherit",
              fontSize: 13,
              width: "100%",
              minWidth: 0,
              boxSizing: "border-box",
            } as const;
            const arrowStyle = {
              color: "var(--text-muted)",
              textAlign: "center" as const,
              fontSize: 12,
            };
            const subLabelStyle = {
              fontSize: 10,
              fontWeight: 700,
              textTransform: "uppercase" as const,
              letterSpacing: 0.3,
              color: "var(--text-muted)",
              opacity: 0.8,
            };
            return (
              <div
                key={key}
                style={{
                  display: "grid",
                    gridTemplateColumns: "76px minmax(0, 1fr)",
                  alignItems: "start",
                  gap: 8,
                  paddingBottom: 4,
                }}
              >
                <div
                  style={{
                    paddingTop: 8,
                    display: "grid",
                    gap: 5,
                  }}
                >
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 800,
                      textTransform: "uppercase",
                      letterSpacing: 0.4,
                      color: "var(--text-muted)",
                    }}
                  >
                    {tr(SCHEDULE_PHASE_LABEL_KEYS[key])}
                  </span>
                  <button
                    type="button"
                    onClick={() => clearPhase(key)}
                    disabled={!phaseActive}
                    aria-label={tr("schedule.clearPhase", { phase: tr(SCHEDULE_PHASE_LABEL_KEYS[key]) })}
                    style={{
                      justifySelf: "start",
                      background: "transparent",
                      border: "none",
                      color: "var(--text-muted)",
                      fontSize: 10,
                      fontWeight: 700,
                      textTransform: "uppercase",
                      letterSpacing: 0.3,
                      padding: 0,
                      cursor: phaseActive ? "pointer" : "default",
                      opacity: phaseActive ? 0.85 : 0.35,
                    }}
                  >
                    {tr("schedule.clear")}
                  </button>
                </div>
                <div style={{ display: "grid", gap: 10 }}>
                  {segments.map((ph, idx) => {
                    const removable = !(key === "show" && idx === 0);
                    return (
                      <div
                        key={idx}
                        style={{
                          display: "grid",
                          gap: 6,
                          padding:
                            segments.length > 1 ? "6px 8px" : 0,
                          border:
                            segments.length > 1
                              ? "1px solid var(--border-color)"
                              : "none",
                          borderRadius: 6,
                          background:
                            segments.length > 1
                              ? "var(--input-bg)"
                              : "transparent",
                        }}
                      >
                        {segments.length > 1 ? (
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "center",
                            }}
                          >
                            <span style={subLabelStyle}>
                              {tr("schedule.dayCount", { count: idx + 1 })}
                            </span>
                            {removable ? (
                              <button
                                type="button"
                                aria-label={tr("schedule.removePhaseDay", { phase: tr(SCHEDULE_PHASE_LABEL_KEYS[key]), count: idx + 1 })}
                                onClick={() => removeDay(key, idx)}
                                style={{
                                  background: "transparent",
                                  border: "none",
                                  color: "var(--text-muted)",
                                  fontSize: 14,
                                  lineHeight: 1,
                                  cursor: "pointer",
                                  padding: "2px 6px",
                                }}
                              >
                                ×
                              </button>
                            ) : null}
                          </div>
                        ) : null}
                        {/* Date row */}
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns:
                              "36px minmax(136px, 1fr) 14px minmax(136px, 1fr)",
                            alignItems: "center",
                            gap: 6,
                          }}
                        >
                          <span style={subLabelStyle}>{tr("schedule.day")}</span>
                          <input
                            type="date"
                            value={ph.from}
                            aria-label={tr("schedule.phaseDayFrom", { phase: tr(SCHEDULE_PHASE_LABEL_KEYS[key]), count: idx + 1 })}
                            onChange={(e) =>
                              setSegment(key, idx, "from", e.target.value)
                            }
                            style={inputStyle}
                          />
                          <span aria-hidden style={arrowStyle}>
                            →
                          </span>
                          <input
                            type="date"
                            value={ph.to}
                            min={ph.from || undefined}
                            aria-label={tr("schedule.phaseDayTo", { phase: tr(SCHEDULE_PHASE_LABEL_KEYS[key]), count: idx + 1 })}
                            onChange={(e) =>
                              setSegment(key, idx, "to", e.target.value)
                            }
                            style={inputStyle}
                          />
                        </div>
                        {/* Time row */}
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns:
                              "36px minmax(0, 1fr) 14px minmax(0, 1fr) auto",
                            alignItems: "center",
                            gap: 6,
                          }}
                        >
                          <span style={subLabelStyle}>{tr("schedule.time")}</span>
                          {ph.timeTbd ? (
                            <span
                              style={{
                                gridColumn: "2 / 5",
                                justifySelf: "start",
                                padding: "5px 12px",
                                border: "1px solid color-mix(in srgb, var(--primary) 45%, var(--border-color))",
                                borderRadius: 999,
                                background:
                                  "color-mix(in srgb, var(--primary) 12%, var(--input-bg))",
                                color: "var(--text-main)",
                                fontSize: 12,
                                fontWeight: 800,
                                textAlign: "center",
                                letterSpacing: 0.4,
                              }}
                            >
                              TBD
                            </span>
                          ) : (
                            <>
                              <input
                                type="time"
                                value={ph.fromTime ?? ""}
                                aria-label={tr("schedule.phaseDayStartTime", { phase: tr(SCHEDULE_PHASE_LABEL_KEYS[key]), count: idx + 1 })}
                                onChange={(e) =>
                                  setSegment(
                                    key,
                                    idx,
                                    "fromTime",
                                    e.target.value,
                                  )
                                }
                                style={inputStyle}
                              />
                              <span aria-hidden style={arrowStyle}>
                                →
                              </span>
                              <input
                                type="time"
                                value={ph.toTime ?? ""}
                                aria-label={tr("schedule.phaseDayEndTime", { phase: tr(SCHEDULE_PHASE_LABEL_KEYS[key]), count: idx + 1 })}
                                onChange={(e) =>
                                  setSegment(
                                    key,
                                    idx,
                                    "toTime",
                                    e.target.value,
                                  )
                                }
                                style={inputStyle}
                              />
                            </>
                          )}
                          <label
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 4,
                              color: "var(--text-muted)",
                              fontSize: 10,
                              fontWeight: 800,
                              cursor: "pointer",
                              whiteSpace: "nowrap",
                              padding: "5px 8px",
                              border: "1px solid var(--border-color)",
                              borderRadius: 999,
                              background: ph.timeTbd
                                ? "color-mix(in srgb, var(--primary) 12%, var(--input-bg))"
                                : "var(--input-bg)",
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={ph.timeTbd === true}
                              onChange={(event) =>
                                setTimeTbd(key, idx, event.target.checked)
                              }
                              aria-label={tr("schedule.phaseDayTimeTbd", { phase: tr(SCHEDULE_PHASE_LABEL_KEYS[key]), count: idx + 1 })}
                              style={{
                                width: 15,
                                height: 15,
                                margin: 0,
                                accentColor: "var(--primary)",
                                cursor: "pointer",
                              }}
                            />
                            TBD
                          </label>
                        </div>
                      </div>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => addDay(key)}
                    style={{
                      justifySelf: "start",
                      background: "transparent",
                      border: "1px dashed var(--border-color)",
                      borderRadius: 6,
                      color: "var(--text-muted)",
                      fontSize: 11,
                      fontWeight: 700,
                      textTransform: "uppercase",
                      letterSpacing: 0.3,
                      padding: "4px 10px",
                      cursor: "pointer",
                    }}
                  >
                    {tr("schedule.addDay")}
                  </button>
                </div>
              </div>
            );
          })}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginTop: 6,
              paddingTop: 8,
              borderTop: "1px dashed var(--border-color)",
            }}
          >
            <button
              type="button"
              onClick={clearAll}
              style={{
                background: "transparent",
                border: "none",
                color: "var(--text-muted)",
                fontSize: 12,
                cursor: "pointer",
                padding: "4px 6px",
              }}
            >
              {tr("schedule.reset")}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              style={{
                background: "var(--primary)",
                color: "white",
                border: "none",
                borderRadius: 6,
                padding: "6px 14px",
                fontWeight: 700,
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              {tr("schedule.done")}
            </button>
          </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

export default App;
