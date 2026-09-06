/** Advanced per-screen engineering inspector.
 *
 *  Surfaces the touring-grade fields added in Phase 1: brightness,
 *  refresh, bit depth, HDR, curve, rotation, voltage region, power
 *  factor / overhead, broadcast / camera-safe.
 *
 *  All fields are optional on `LedScreen`; this inspector writes
 *  through `onUpdate` to the parent state. Empty input = clear field
 *  (= fall back to settings default).
 */

import type {
  LedCurveType,
  LedScanRateProfile,
  LedScreen,
  LedTransparencyMode,
  LedVoltageRegion,
} from "../../lib/led";
import type { PowerEstimate } from "../../lib/led/engine/power";
import { useT } from "../../lib/i18n/I18nContext";
import type { TranslationKey } from "../../lib/i18n/types";

const CURVE_OPTION_KEYS: Record<LedCurveType, TranslationKey> = {
  flat: "led.advanced.option.curve.flat",
  concave: "led.advanced.option.curve.concave",
  convex: "led.advanced.option.curve.convex",
  polyline: "led.advanced.option.curve.polyline",
};
const TRANSPARENCY_OPTION_KEYS: Record<LedTransparencyMode, TranslationKey> = {
  opaque: "led.advanced.option.transparency.opaque",
  mesh: "led.advanced.option.transparency.mesh",
  transparent: "led.advanced.option.transparency.transparent",
};
const VOLTAGE_OPTION_KEYS: Record<LedVoltageRegion, TranslationKey> = {
  "EU-230": "led.advanced.option.voltage.eu230",
  "US-120": "led.advanced.option.voltage.us120",
  "US-208": "led.advanced.option.voltage.us208",
  "JP-100": "led.advanced.option.voltage.jp100",
};
const SCAN_OPTION_KEYS: Record<LedScanRateProfile, TranslationKey> = {
  "studio-50": "led.advanced.option.scan.studio50",
  "studio-60": "led.advanced.option.scan.studio60",
  "live-60": "led.advanced.option.scan.live60",
  custom: "led.advanced.option.scan.custom",
};

export function AdvancedScreenInspector({
  screen,
  power,
  onUpdate,
}: {
  screen: LedScreen;
  /** Pre-computed by the validation runner so this component stays
   *  free of engine imports at render time. */
  power: PowerEstimate | undefined;
  onUpdate: (patch: Partial<LedScreen>) => void;
}) {
  const t = useT();
  return <EngineeringFields screen={screen} power={power} onUpdate={onUpdate} t={t} />;
}

function EngineeringFields({
  screen,
  power,
  onUpdate,
  t,
}: {
  screen: LedScreen;
  power: PowerEstimate | undefined;
  onUpdate: (patch: Partial<LedScreen>) => void;
  t: ReturnType<typeof useT>;
}) {
  return (
    <div className="led-adv-inspector">
      {/* ── Display ─────────────────────────────────────────────── */}
      <section className="led-adv-section">
        <header className="led-adv-section-head">
          <span>{t("led.advanced.section.display")}</span>
        </header>
        <div className="led-adv-fields">
          <NumField
            label={t("led.advanced.brightness")}
            value={screen.brightnessNits}
            onCommit={(v) => onUpdate({ brightnessNits: v })}
            placeholder="5000"
            min={0}
            step={100}
          />
          <NumField
            label={t("led.advanced.refresh")}
            value={screen.refreshRateHz}
            onCommit={(v) => onUpdate({ refreshRateHz: v })}
            placeholder="3840"
            min={0}
            step={10}
          />
          <label className="led-field">
            <span className="led-field-label">{t("led.advanced.bitDepth")}</span>
            <select
              className="led-input"
              value={screen.bitDepth ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                onUpdate({
                  bitDepth: v ? (Number(v) as 8 | 10 | 12) : undefined,
                });
              }}
            >
              <option value="">{t("led.advanced.default")}</option>
              <option value="8">8-bit</option>
              <option value="10">10-bit</option>
              <option value="12">12-bit</option>
            </select>
          </label>
          <BoolField
            label={t("led.advanced.hdr")}
            value={!!screen.hdrEnabled}
            onChange={(v) => onUpdate({ hdrEnabled: v || undefined })}
          />
        </div>
      </section>

      {/* ── Physical ────────────────────────────────────────────── */}
      <section className="led-adv-section">
        <header className="led-adv-section-head">
          <span>{t("led.advanced.section.physical")}</span>
        </header>
        <div className="led-adv-fields">
          <SelectField
            label={t("led.advanced.curve")}
            value={screen.curveType ?? "flat"}
            options={Object.entries(CURVE_OPTION_KEYS).map(([value, key]) => ({ value: value as LedCurveType, label: t(key) }))}
            onChange={(v) => onUpdate({ curveType: v })}
          />
          <NumField
            label={t("led.advanced.curveAngle")}
            value={screen.curveAnglePerSeam}
            onCommit={(v) => onUpdate({ curveAnglePerSeam: v })}
            placeholder="0"
            min={-30}
            max={30}
            step={0.5}
            disabled={
              !screen.curveType || screen.curveType === "flat"
            }
          />
          <label className="led-field">
            <span className="led-field-label">{t("led.advanced.cabinetRotation")}</span>
            <select
              className="led-input"
              value={screen.cabinetRotation ?? 0}
              onChange={(e) =>
                onUpdate({
                  cabinetRotation: Number(e.target.value) as
                    | 0
                    | 90
                    | 180
                    | 270,
                })
              }
            >
              <option value={0}>0°</option>
              <option value={90}>90°</option>
              <option value={180}>{t("led.advanced.rotation.upsideDown")}</option>
              <option value={270}>270°</option>
            </select>
          </label>
          <SelectField
            label={t("led.advanced.transparency")}
            value={screen.transparencyMode ?? "opaque"}
            options={Object.entries(TRANSPARENCY_OPTION_KEYS).map(([value, key]) => ({ value: value as LedTransparencyMode, label: t(key) }))}
            onChange={(v) => onUpdate({ transparencyMode: v })}
          />
        </div>
      </section>

      {/* ── Power ───────────────────────────────────────────────── */}
      <section className="led-adv-section">
        <header className="led-adv-section-head">
          <span>{t("led.advanced.section.power")}</span>
          {power && (
            <span className="led-adv-section-meter">
              {power.totalWatts.toFixed(0)} W · {power.amps.toFixed(1)} A @{" "}
              {power.voltage} V
            </span>
          )}
        </header>
        <div className="led-adv-fields">
          <SelectField
            label={t("led.advanced.voltageRegion")}
            value={screen.voltageRegion ?? "EU-230"}
            options={Object.entries(VOLTAGE_OPTION_KEYS).map(([value, key]) => ({ value: value as LedVoltageRegion, label: t(key) }))}
            onChange={(v) => onUpdate({ voltageRegion: v })}
          />
          <NumField
            label={t("led.advanced.cabinetsPerPowerChain")}
            value={screen.maxCabinetsPerPowerChain}
            onCommit={(v) => onUpdate({ maxCabinetsPerPowerChain: v })}
            placeholder="6"
            min={1}
            step={1}
          />
          <NumField
            label={t("led.advanced.psuOverhead")}
            value={screen.powerOverheadPct}
            onCommit={(v) => onUpdate({ powerOverheadPct: v })}
            placeholder="25"
            min={0}
            max={100}
            step={1}
          />
          <NumField
            label={t("led.advanced.powerFactor")}
            value={screen.powerFactor}
            onCommit={(v) => onUpdate({ powerFactor: v })}
            placeholder="0.95"
            min={0}
            max={1}
            step={0.01}
          />
        </div>
        {power && power.chainsRequired !== null && (
          <p className="led-adv-meter-row">
            {t("led.advanced.powerChains", {
              cabinets: power.enabledCabinets,
              chains: power.chainsRequired,
              perChain: power.cabinetsPerChain ?? "—",
            })}
          </p>
        )}
      </section>

      {/* ── Data / Signal ───────────────────────────────────────── */}
      <section className="led-adv-section">
        <header className="led-adv-section-head">
          <span>{t("led.advanced.section.dataSignal")}</span>
        </header>
        <div className="led-adv-fields">
          <NumField
            label={t("led.advanced.cabinetsPerDataChain")}
            value={screen.maxCabinetsPerDataChain}
            onCommit={(v) => onUpdate({ maxCabinetsPerDataChain: v })}
            placeholder="16"
            min={1}
            step={1}
          />
          <BoolField
            label={t("led.advanced.backupSignal")}
            value={!!screen.backupSignalEnabled}
            onChange={(v) => onUpdate({ backupSignalEnabled: v || undefined })}
          />
          <BoolField
            label={t("led.advanced.loopOut")}
            value={!!screen.signalLoopEnabled}
            onChange={(v) => onUpdate({ signalLoopEnabled: v || undefined })}
          />
        </div>
      </section>

      {/* ── Broadcast ───────────────────────────────────────────── */}
      <section className="led-adv-section">
        <header className="led-adv-section-head">
          <span>{t("led.advanced.section.broadcast")}</span>
        </header>
        <div className="led-adv-fields">
          <BoolField
            label={t("led.advanced.cameraSafe")}
            value={!!screen.cameraSafeMode}
            onChange={(v) => onUpdate({ cameraSafeMode: v || undefined })}
          />
          <SelectField
            label={t("led.advanced.scanProfile")}
            value={screen.scanRateProfile ?? "live-60"}
            options={Object.entries(SCAN_OPTION_KEYS).map(([value, key]) => ({ value: value as LedScanRateProfile, label: t(key) }))}
            onChange={(v) => onUpdate({ scanRateProfile: v })}
          />
          <BoolField
            label={t("led.advanced.genlock")}
            value={!!screen.genlockEnabled}
            onChange={(v) => onUpdate({ genlockEnabled: v || undefined })}
          />
        </div>
      </section>
    </div>
  );
}

// ───────────────────────────────────────── tiny field helpers ─────

function NumField({
  label,
  value,
  onCommit,
  placeholder,
  min,
  max,
  step,
  disabled,
}: {
  label: string;
  value: number | undefined;
  onCommit: (v: number | undefined) => void;
  placeholder?: string;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
}) {
  return (
    <label className="led-field">
      <span className="led-field-label">{label}</span>
      <input
        className="led-input"
        type="number"
        value={value ?? ""}
        placeholder={placeholder}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === "") return onCommit(undefined);
          const n = Number(raw);
          if (Number.isFinite(n)) onCommit(n);
        }}
      />
    </label>
  );
}

function BoolField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="led-field led-field-check">
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="led-field-label">{label}</span>
    </label>
  );
}

function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (v: T) => void;
}) {
  return (
    <label className="led-field">
      <span className="led-field-label">{label}</span>
      <select
        className="led-input"
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
