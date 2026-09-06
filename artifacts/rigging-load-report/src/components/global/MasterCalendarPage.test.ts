import assert from "node:assert/strict";
import test from "node:test";
import { eachDayOfInterval, parseISO } from "date-fns";
import {
  getLanesForWeek,
  getProjectTitle,
  isValidCalendarDate,
  type CalendarProject,
} from "./MasterCalendarPage";

const t = () => "Production";
const project = (id: string, startDate: string | null, endDate: string | null = null): CalendarProject => ({
  id, name: null, startDate, endDate, easyjob_number: null, crewCount: null, status: null,
});
const week = eachDayOfInterval({ start: parseISO("2025-01-06"), end: parseISO("2025-01-12") });

test("resolves calendar titles from a name, category/location, and generic fallback", () => {
  assert.equal(getProjectTitle({ ...project("1", null), name: "  Named show  " }, t), "Named show");
  assert.equal(getProjectTitle({ ...project("2", null), category: "Concert", venue: "Arena" }, t), "Concert // Arena");
  assert.equal(getProjectTitle({ ...project("3", null), category: "Corporate", client: "Acme" }, t), "Corporate // Acme");
  assert.equal(getProjectTitle(project("4", null), t), "Production");
});

test("clips multi-day projects to the visible week", () => {
  const [span] = getLanesForWeek(week, [project("span", "2025-01-04", "2025-01-14")]);
  assert.deepEqual(
    { startIdx: span.startIdx, span: span.span, isClippedLeft: span.isClippedLeft, isClippedRight: span.isClippedRight },
    { startIdx: 0, span: 7, isClippedLeft: true, isClippedRight: true },
  );
});

test("allocates non-overlapping lanes and flags overflow lanes", () => {
  const lanes = getLanesForWeek(week, [
    project("one", "2025-01-06", "2025-01-08"),
    project("two", "2025-01-06", "2025-01-07"),
    project("three", "2025-01-06"),
    project("overflow", "2025-01-06"),
    project("later", "2025-01-09"),
  ]);
  assert.deepEqual(lanes.map(({ project: item, lane }) => [item.id, lane]), [
    ["one", 0], ["two", 1], ["three", 2], ["overflow", 3], ["later", 0],
  ]);
  assert.equal(lanes.some((lane) => lane.lane >= 3), true);
});

test("ignores malformed calendar dates", () => {
  assert.equal(isValidCalendarDate("2025-02-29"), false);
  assert.equal(isValidCalendarDate("not-a-date"), false);
  assert.equal(getLanesForWeek(week, [project("bad", "not-a-date")]).length, 0);
});