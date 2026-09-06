import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  assignedDatesFromShiftPhases,
  crewShiftAssignmentKey,
  filterShiftSelectionsToSchedule,
  scheduledShiftKeys,
  shiftWindowsWithLegacyFallback,
  type CrewShiftPhaseKey,
  type CrewShiftTime,
  type CrewShiftTimeMap,
  type CrewShiftWindowMap,
} from "../lib/crewShiftAssignments";
import type { CrewMember } from "../lib/crew";
import { useT } from "../lib/i18n/I18nContext";

const PHASES = [
  { key: "setup", labelKey: "portal.brief.phase.setup" },
  { key: "rehearsal", labelKey: "portal.brief.phase.rehearsal" },
  { key: "show", labelKey: "portal.brief.phase.show" },
  { key: "downrig", labelKey: "portal.brief.phase.loadOut" },
] as const;

type ShiftMode = "full" | "four" | "custom";
type ShiftTaskMap = Record<string, string[]>;

const ROLE_TASKS: Record<string, string[]> = {
  Rigging: [
    "Motor Hang",
    "Truss Assembly",
    "Bridle Calc",
    "Safety Check",
    "Load-out",
  ],
  "Lighting FOH": [
    "FOH Op",
    "Patching",
    "Fixtures Hang",
    "Focus Spotlights",
    "Plot Patching",
  ],
  "Video / LED": [
    "Wall Assembly",
    "Signal Patch",
    "Processor Config",
    "Media Server Setup",
  ],
  Sound: [
    "PA Fly",
    "Stage Patch",
    "FOH Mix",
    "System Alignment",
    "Soundcheck",
  ],
  Lighting: ["Fixtures Hang", "Patching", "Focus Spotlights", "Plot Patching"],
  "AV FOH": ["Signal Patch", "Playback", "FOH Op"],
  "System Tech": ["System Config", "Signal Patch", "Troubleshooting"],
};

type Props = {
  crew: CrewMember;
  phaseDays: Partial<Record<CrewShiftPhaseKey, ReadonlyArray<string>>>;
  phaseShiftTimes?: CrewShiftTimeMap;
  rolePeers: ReadonlyArray<CrewMember>;
  onSave: (
    dates: ReadonlyArray<string>,
    shiftPhases: ReadonlyArray<string>,
    shiftTimes: CrewShiftTimeMap,
    shiftWindows: CrewShiftWindowMap,
    shiftTasks: ShiftTaskMap,
  ) => Promise<void>;
  onApplyToRole: (
    shiftPhases: ReadonlyArray<string>,
    shiftTimes: CrewShiftTimeMap,
    shiftWindows: CrewShiftWindowMap,
    shiftTasks: ShiftTaskMap,
  ) => void;
};

function minutes(time: string): number | null {
  if (!/^\d{2}:\d{2}$/.test(time)) return null;
  const [hours, mins] = time.split(":").map(Number);
  if (hours < 0 || hours > 23 || mins < 0 || mins > 59) return null;
  return hours * 60 + mins;
}

function addHours(time: string, hours: number): string {
  const start = minutes(time);
  if (start == null) return "";
  const value = (start + hours * 60) % 1440;
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

function durationHours(time?: CrewShiftTime): number {
  if (!time || time.timeTbd) return 0;
  const start = minutes(time.startTime);
  const end = minutes(time.endTime);
  if (start == null || end == null) return 0;
  return ((end - start + 1440) % 1440 || 1440) / 60;
}

function inferredMode(
  selected: boolean,
  value: CrewShiftTime | undefined,
  standard: CrewShiftTime | undefined,
): ShiftMode | undefined {
  if (!selected) return undefined;
  if (
    value &&
    standard &&
    value.startTime === standard.startTime &&
    value.endTime === standard.endTime
  ) return "full";
  if (
    value &&
    value.endTime === addHours(value.startTime, 4)
  ) return "four";
  return "custom";
}

export function AssignShiftsModal({
  crew,
  phaseDays,
  phaseShiftTimes = {},
  rolePeers,
  onSave,
  onApplyToRole,
}: Props) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Set<string>>(new Set());
  const [windows, setWindows] = useState<CrewShiftWindowMap>({});
  const [tasks, setTasks] = useState<ShiftTaskMap>({});
  const [customTasks, setCustomTasks] = useState<Record<string, string>>({});
  const [modes, setModes] = useState<Record<string, ShiftMode | undefined>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const presetTasks = ROLE_TASKS[crew.role] ?? [
    "General Support",
    "Site Prep",
    "Show Call",
  ];
  const availableKeys = useMemo(
    () => new Set(scheduledShiftKeys(phaseDays)),
    [phaseDays],
  );
  const days = useMemo(
    () => assignedDatesFromShiftPhases(availableKeys),
    [availableKeys],
  );
  const [focusDate, setFocusDate] = useState(days[0] ?? "");

  const openModal = () => {
    setSaveError("");
    const selections = filterShiftSelectionsToSchedule(
      crew.assignedShiftPhases ??
        (crew.assignedDates ?? []).flatMap((date) =>
          PHASES.filter((phase) => phaseDays[phase.key]?.includes(date))
            .map((phase) => crewShiftAssignmentKey(date, phase.key)),
        ),
      availableKeys,
    );
    const initialWindows: CrewShiftWindowMap = {};
    const initialModes: Record<string, ShiftMode | undefined> = {};
    for (const key of availableKeys) {
      const savedWindows = crew.assignedShiftWindows?.[key];
      const value = savedWindows?.[0] ?? crew.assignedShiftTimes?.[key] ?? phaseShiftTimes[key];
      if (savedWindows?.length) {
        initialWindows[key] = savedWindows.map((window) => ({ ...window }));
      } else if (value) {
        initialWindows[key] = [{ ...value }];
      }
      initialModes[key] = inferredMode(
        selections.has(key),
        value,
        phaseShiftTimes[key],
      );
      if ((savedWindows?.length ?? 0) > 1) initialModes[key] = "custom";
    }
    setDraft(selections);
    setWindows(initialWindows);
    setTasks(
      Object.fromEntries(
        Object.entries(crew.assignedShiftTasks ?? {}).map(([key, values]) => [
          key,
          [...values],
        ]),
      ),
    );
    setCustomTasks({});
    setModes(initialModes);
    setFocusDate(days[0] ?? "");
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [open]);

  const setPreset = (
    key: string,
    mode: ShiftMode | "clear",
    standard?: CrewShiftTime,
  ) => {
    setSaveError("");
    if (
      (mode === "full" || mode === "four") &&
      (!standard || standard.timeTbd || minutes(standard.startTime) == null)
    ) {
      return;
    }
    setDraft((current) => {
      const next = new Set(current);
      if (mode === "clear") next.delete(key);
      else next.add(key);
      return next;
    });
    if (mode === "clear") {
      setModes((current) => ({ ...current, [key]: undefined }));
      setWindows((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      setTasks((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      return;
    }
    const start = standard?.startTime || crew.callTime || "08:00";
    const nextTime =
      mode === "four"
        ? { startTime: start, endTime: addHours(start, 4) }
        : mode === "full"
          ? { startTime: start, endTime: standard?.endTime || crew.offTime || addHours(start, 8) }
          : windows[key]?.[0] ?? {
              startTime: start,
              endTime: standard?.endTime || crew.offTime || addHours(start, 8),
            };
    setWindows((current) => ({ ...current, [key]: [{ ...nextTime }] }));
    setModes((current) => ({ ...current, [key]: mode }));
  };

  const updateCustomTime = (
    key: string,
    index: number,
    side: "startTime" | "endTime",
    value: string,
  ) => {
    setWindows((current) => {
      const nextWindows = (current[key] ?? []).map((window) => ({ ...window }));
      const existing = nextWindows[index] ?? { startTime: "", endTime: "" };
      nextWindows[index] = { ...existing, [side]: value };
      return { ...current, [key]: nextWindows };
    });
  };

  const addWindow = (key: string, standard?: CrewShiftTime) => {
    const existing = windows[key] ?? [];
    const previous = existing.at(-1);
    const start = previous?.endTime || standard?.startTime || crew.callTime || "08:00";
    setDraft((current) => new Set(current).add(key));
    setModes((current) => ({ ...current, [key]: "custom" }));
    setWindows((current) => ({
      ...current,
      [key]: [
        ...(current[key] ?? []),
        { startTime: start, endTime: addHours(start, 4) },
      ],
    }));
  };

  const removeWindow = (key: string, index: number) => {
    setWindows((current) => ({
      ...current,
      [key]: (current[key] ?? []).filter((_, windowIndex) => windowIndex !== index),
    }));
  };

  const selectedWindows = useMemo(() => {
    const result: CrewShiftWindowMap = {};
    for (const key of draft) {
      const values = windows[key]?.filter(
        (window) =>
          minutes(window.startTime) != null && minutes(window.endTime) != null,
      );
      if (values?.length) result[key] = values.map((window) => ({ ...window }));
    }
    return result;
  }, [draft, windows]);

  const selectedTimes = useMemo(() => {
    const result: CrewShiftTimeMap = {};
    for (const key of draft) {
      const first = selectedWindows[key]?.[0];
      if (first) result[key] = { ...first };
    }
    return result;
  }, [draft, selectedWindows]);

  const selectedTasks = useMemo(
    () =>
      Object.fromEntries(
        [...draft].flatMap((key) =>
          tasks[key]?.length ? [[key, [...tasks[key]]]] : [],
        ),
      ),
    [draft, tasks],
  );

  const toggleTask = (key: string, task: string) => {
    setTasks((current) => {
      const values = current[key] ?? [];
      return {
        ...current,
        [key]: values.includes(task)
          ? values.filter((value) => value !== task)
          : [...values, task],
      };
    });
  };

  const addCustomTask = (key: string) => {
    const task = customTasks[key]?.trim();
    if (!task) return;
    setTasks((current) => ({
      ...current,
      [key]: current[key]?.includes(task)
        ? current[key]
        : [...(current[key] ?? []), task],
    }));
    setCustomTasks((current) => ({ ...current, [key]: "" }));
  };

  const totalHours = useMemo(
    () =>
      [...draft].reduce(
        (total, key) =>
          total +
          (windows[key] ?? []).reduce(
            (windowTotal, window) => windowTotal + durationHours(window),
            0,
          ),
        0,
      ),
    [draft, windows],
  );

  const save = async () => {
    const keys = [...draft].sort();
    setSaving(true);
    setSaveError("");
    try {
      await onSave(
        assignedDatesFromShiftPhases(draft),
        keys,
        selectedTimes,
        selectedWindows,
        selectedTasks,
      );
      setOpen(false);
    } catch (error) {
      setSaveError(
        error instanceof Error
          ? error.message
          : t("crew.shifts.error.save"),
      );
    } finally {
      setSaving(false);
    }
  };

  const applyToRole = async () => {
    const keys = [...draft].sort();
    setSaving(true);
    setSaveError("");
    try {
      await onSave(
        assignedDatesFromShiftPhases(draft),
        keys,
        selectedTimes,
        selectedWindows,
        selectedTasks,
      );
      onApplyToRole(keys, selectedTimes, selectedWindows, selectedTasks);
      setOpen(false);
    } catch (error) {
      setSaveError(
        error instanceof Error
          ? error.message
          : t("crew.shifts.error.save"),
      );
    } finally {
      setSaving(false);
    }
  };

  const barsForDate = (date: string) => {
    const current = {
      id: crew.id,
      name: crew.name || t("crew.shifts.selectedCrew"),
      windows: selectedWindows,
      selected: true,
    };
    return [
      current,
      ...rolePeers
        .filter((member) => member.id !== crew.id)
        .map((member) => ({
          id: member.id,
          name: member.name || member.role,
          windows: shiftWindowsWithLegacyFallback(
            member.assignedShiftWindows ?? {},
            member.assignedShiftTimes ?? {},
          ),
          selected: false,
        })),
    ].flatMap((member) => {
      const dayTimes = Object.entries(member.windows)
        .filter(([key]) => key.startsWith(`${date}::`))
        .flatMap(([, values]) => values)
        .filter((time) => minutes(time.startTime) != null && minutes(time.endTime) != null);
      if (dayTimes.length === 0) return [];
      return [{ ...member, dayTimes }];
    });
  };

  const selectedDayCount = assignedDatesFromShiftPhases(
    filterShiftSelectionsToSchedule(
      crew.assignedShiftPhases ??
        (crew.assignedDates ?? []).flatMap((date) =>
          PHASES.filter((phase) => phaseDays[phase.key]?.includes(date))
            .map((phase) => crewShiftAssignmentKey(date, phase.key)),
        ),
      availableKeys,
    ),
  ).length;

  return (
    <>
      <button
        type="button"
        className="roster-day-quickpick-btn"
        onClick={openModal}
        disabled={days.length === 0}
      >
         {t("crew.shifts.edit")}{selectedDayCount ? ` (${selectedDayCount}d)` : ""}
      </button>
      {open && typeof document !== "undefined"
        ? createPortal(
            <>
              <button
                type="button"
                className="crew-shift-matrix-backdrop"
                 aria-label={t("crew.shifts.closeAria")}
                onClick={() => {
                  if (!saving) setOpen(false);
                }}
              />
              <section className="crew-shift-matrix" role="dialog" aria-modal="true" aria-busy={saving}>
                <header className="crew-shift-matrix-header">
                  <div>
                     <p className="crew-shift-matrix-eyebrow">{t("crew.shifts.booking")} · {crew.role}</p>
                     <h3>{t("crew.shifts.assign", { name: crew.name || t("crew.shifts.crewMember") })}</h3>
                  </div>
                  <div className="shift-role-actions">
                    <button type="button" className="crew-shift-matrix-close" onClick={() => setOpen(false)} disabled={saving}>×</button>
                  </div>
                </header>

                <div className="crew-shift-matrix-scroll">
                  {days.map((date) => (
                    <fieldset className="crew-shift-day" key={date} disabled={saving}>
                      <legend>{date}</legend>
                      <div className="shift-preset-list">
                        {PHASES.filter((phase) => phaseDays[phase.key]?.includes(date)).map((phase) => {
                          const key = crewShiftAssignmentKey(date, phase.key);
                          const mode = modes[key];
                          const standard = phaseShiftTimes[key];
                          const hasStandardStart =
                            !!standard &&
                            !standard.timeTbd &&
                            minutes(standard.startTime) != null;
                          return (
                            <div className="shift-preset-row" key={key}>
                              <div className="shift-preset-title">
                                 <strong>{t(phase.labelKey)}</strong>
                                 <small>{standard?.timeTbd ? t("crew.shifts.timeTbd") : standard ? `${standard.startTime}–${standard.endTime}` : t("crew.shifts.noStandardTime")}</small>
                              </div>
                              <div className="shift-preset-buttons">
                                <button
                                  type="button"
                                  className={mode === "full" ? "is-active" : ""}
                                  disabled={!hasStandardStart || minutes(standard?.endTime ?? "") == null}
                                   title={!hasStandardStart ? t("crew.shifts.addPhaseTimeHint") : undefined}
                                  onClick={() => setPreset(key, mode === "full" ? "clear" : "full", standard)}
                                >
                                   {t("crew.shifts.fullPhase")}
                                </button>
                                <button
                                  type="button"
                                  className={mode === "four" ? "is-active" : ""}
                                  disabled={!hasStandardStart}
                                   title={!hasStandardStart ? t("crew.shifts.addPhaseStartHint") : undefined}
                                  onClick={() => setPreset(key, mode === "four" ? "clear" : "four", standard)}
                                >
                                   {t("crew.shifts.fourHourCall")}
                                </button>
                                 <button type="button" className={mode === "custom" ? "is-active" : ""} onClick={() => setPreset(key, mode === "custom" ? "clear" : "custom", standard)}>{t("crew.shifts.customHours")}</button>
                                 <button type="button" className="is-clear" onClick={() => setPreset(key, "clear")}>{t("crew.shifts.clear")}</button>
                              </div>
                              {mode === "custom" ? (
                                <div className="shift-window-list">
                                  {(windows[key] ?? []).map((window, index) => (
                                    <div className="shift-custom-times" key={`${key}-${index}`}>
                                      <span className="shift-window-label">
                                         {t("crew.shifts.callNumber", { number: index + 1 })}
                                      </span>
                                      <label>
                                         {t("crew.shifts.start")}
                                        <input
                                          type="time"
                                          value={window.startTime}
                                          onChange={(event) =>
                                            updateCustomTime(
                                              key,
                                              index,
                                              "startTime",
                                              event.target.value,
                                            )
                                          }
                                        />
                                      </label>
                                      <span>→</span>
                                      <label>
                                         {t("crew.shifts.end")}
                                        <input
                                          type="time"
                                          value={window.endTime}
                                          onChange={(event) =>
                                            updateCustomTime(
                                              key,
                                              index,
                                              "endTime",
                                              event.target.value,
                                            )
                                          }
                                        />
                                      </label>
                                      {(windows[key]?.length ?? 0) > 1 ? (
                                        <button
                                          type="button"
                                          className="shift-remove-window"
                                           aria-label={t("crew.shifts.removeCall", { number: index + 1 })}
                                          onClick={() => removeWindow(key, index)}
                                        >
                                           {t("common.remove")}
                                        </button>
                                      ) : null}
                                    </div>
                                  ))}
                                </div>
                              ) : null}
                              {draft.has(key) ? (
                                <button
                                  type="button"
                                  className="shift-add-window"
                                  onClick={() => addWindow(key, standard)}
                                >
                                   {t("crew.shifts.addSplitCall")}
                                </button>
                              ) : null}
                              <div className="shift-task-editor">
                                 <span>{t("crew.shifts.tasks")}</span>
                                <div className="shift-task-chips">
                                  {presetTasks.map((task) => (
                                    <button
                                      key={task}
                                      type="button"
                                      className={tasks[key]?.includes(task) ? "is-active" : ""}
                                      disabled={!draft.has(key)}
                                      onClick={() => toggleTask(key, task)}
                                    >
                                      {task}
                                    </button>
                                  ))}
                                  {(tasks[key] ?? [])
                                    .filter((task) => !presetTasks.includes(task))
                                    .map((task) => (
                                      <button
                                        key={task}
                                        type="button"
                                        className="is-active"
                                         title={t("crew.shifts.removeCustomTask")}
                                        onClick={() => toggleTask(key, task)}
                                      >
                                        {task} ×
                                      </button>
                                    ))}
                                </div>
                                <div className="shift-custom-task">
                                  <input
                                    value={customTasks[key] ?? ""}
                                     placeholder={t("crew.shifts.customTaskPlaceholder")}
                                    disabled={!draft.has(key)}
                                    onChange={(event) => setCustomTasks((current) => ({ ...current, [key]: event.target.value }))}
                                    onKeyDown={(event) => {
                                      if (event.key === "Enter") {
                                        event.preventDefault();
                                        addCustomTask(key);
                                      }
                                    }}
                                  />
                                   <button type="button" disabled={!draft.has(key)} onClick={() => addCustomTask(key)}>{t("common.add")}</button>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </fieldset>
                  ))}

                  {days.length > 0 ? (
                    <section className="shift-overlap">
                      <div className="shift-overlap-heading">
                         <div><strong>{t("crew.shifts.coverage")}</strong><small>{t("crew.shifts.coverageHint", { role: crew.role })}</small></div>
                        {days.length > 1 ? (
                          <select value={focusDate} onChange={(event) => setFocusDate(event.target.value)}>
                            {days.map((day) => <option key={day} value={day}>{day}</option>)}
                          </select>
                        ) : <span>{focusDate}</span>}
                      </div>
                      <div className="shift-hour-scale">
                        <div className="shift-hour-scale-spacer" />
                        <div className="shift-hour-scale-labels">
                          <span>00</span>
                          <span>06</span>
                          <span>12</span>
                          <span>18</span>
                          <span>24</span>
                        </div>
                      </div>
                      <div className="shift-overlap-rows">
                        {barsForDate(focusDate).map((member) => (
                          <div className="shift-overlap-row" key={member.id}>
                            <span title={member.name}>{member.name}</span>
                            <div className="shift-overlap-track">
                              {member.dayTimes.flatMap((time, index) => {
                                const start = minutes(time.startTime)!;
                                const end = minutes(time.endTime)!;
                                const length = (end - start + 1440) % 1440 || 1440;
                                const blocks = [
                                  { left: start, width: Math.min(length, 1440 - start) }
                                ];
                                if (length > 1440 - start) {
                                  blocks.push({ left: 0, width: length - (1440 - start) });
                                }
                                return blocks.map((block, blockIndex) => (
                                  <i
                                    key={`${time.startTime}-${time.endTime}-${index}-${blockIndex}`}
                                    className={member.selected ? "is-selected" : ""}
                                    title={`${member.name}: ${time.startTime}–${time.endTime}`}
                                    style={{ left: `${block.left / 14.4}%`, width: `${block.width / 14.4}%` }}
                                  />
                                ));
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    </section>
                  ) : null}
                </div>

                <footer className="crew-shift-matrix-footer">
                  <div>
                     <strong>{t("crew.shifts.totalBooked", { hours: Number.isInteger(totalHours) ? totalHours : totalHours.toFixed(1) })}</strong>
                    {saveError ? <p className="shift-save-error" role="alert">{saveError}</p> : null}
                  </div>
                  <div className="crew-shift-matrix-actions">
                     <button type="button" onClick={() => setOpen(false)} disabled={saving}>{t("common.cancel")}</button>
                    {rolePeers.length > 1 ? (
                      <button
                        type="button"
                         onClick={() => void applyToRole()}
                         disabled={saving}
                      >
                         {t("crew.shifts.applyToRole", { role: crew.role })}
                      </button>
                    ) : null}
                    <button type="button" className="is-primary" onClick={() => void save()} disabled={saving}>
                       {saving ? t("common.saving") : t("crew.shifts.save")}
                    </button>
                  </div>
                </footer>
              </section>
            </>,
            document.body,
          )
        : null}
    </>
  );
}