import assert from "node:assert/strict";
import { test } from "node:test";
import type { RosterRow } from "./crewRoster.ts";
import { dailyCallSheetHtml } from "./dailyCallSheetExport.ts";
import { HtmlToPdfError, pdfFilename } from "./htmlToPdf.ts";

const copy = {
  notProvided: "Not provided", noKeyContacts: "No key contacts provided", noTasks: "No tasks provided",
  hotelRequired: "Required", hotelRequiredDates: (dates: string) => `Required (${dates})`, hotelNotRequired: "Not required",
  noneProvided: "None provided", empty: "No confirmed, accepted, or partially accepted crew with shifts on this date.",
  logoAlt: "EHS company logo", title: "Daily call sheet", crewRole: "Crew / role", windows: "Windows",
  timeline: "24-hour timeline", tasks: "Tasks", hotel: "Hotel", cateringDietaryAllergens: "Catering / dietary / allergens",
  phone: "Phone", keyContacts: "Key contacts", filename: "Daily Call Sheet",
};

const row = (patch: Partial<RosterRow> = {}): RosterRow => ({
  source: "gig",
  id: "gig-1",
  gigId: "gig-1",
  freelancerUserId: "user-1",
  name: "Alex & Co",
  role: "Lighting",
  status: "partially_accepted",
  assignedDates: ["2026-06-01"],
  callTime: "",
  offTime: "",
  assignedShiftPhases: ["2026-06-01::setup", "2026-06-01::show"],
  assignedShiftTimes: {},
  assignedShiftWindows: {
    "2026-06-01::setup": [{ startTime: "08:00", endTime: "12:00" }],
    "2026-06-01::show": [{ startTime: "18:00", endTime: "23:00" }],
  },
  assignedShiftTasks: {
    "2026-06-01::setup": ["Build & test"],
    "2026-06-01::show": ["Declined task must not print"],
  },
  shiftResponses: {
    "2026-06-01::setup::0": "accepted",
    "2026-06-01::show::0": "declined",
  },
  hotelRequired: false,
  hotelDates: [],
  dietaryTags: [],
  allergens: [],
  profileless: false,
  phone: "",
  roomKey: null,
  roommateName: null,
  dayRate: 0,
  notes: "",
  ...patch,
});

test("daily call sheet excludes declined windows and their phase tasks", () => {
  const html = dailyCallSheetHtml({
    date: "2026-06-01",
    projectName: "<Project>",
    rows: [row()],
    locale: "en",
    copy,
  });
  assert.match(html, /08:00–12:00/);
  assert.doesNotMatch(html, /18:00–23:00/);
  assert.match(html, /Build &amp; test/);
  assert.doesNotMatch(html, /Declined task must not print/);
  assert.match(html, /&lt;Project&gt;/);
  assert.match(html, /Alex &amp; Co/);
  assert.match(html, /class="logo" src="\/logo\.png"/);
  assert.match(html, /@page\{size:A4 landscape;margin:10mm\}/);
  assert.match(html, /grid-template-columns:repeat\(7,1fr\)/);
  assert.match(html, /<span>00<\/span><span>04<\/span><span>08<\/span><span>12<\/span><span>16<\/span><span>20<\/span><span>24<\/span>/);
  assert.match(html, /<footer class="contacts-footer">/);
  assert.doesNotMatch(html, />\s*\|\s*</);
});

test("daily call sheet excludes pending and declined crew rows", () => {
  const html = dailyCallSheetHtml({
    date: "2026-06-01",
    rows: [row({ status: "requested" }), row({ id: "gig-2", status: "declined" })],
    locale: "en",
    copy,
  });
  assert.match(html, /No confirmed, accepted, or partially accepted crew/);
  assert.match(html, /<td colspan="7" class="empty">/);
  assert.doesNotMatch(html, /Alex &amp; Co/);
});

test("PDF filenames use caller-provided localized fallback copy", () => {
  assert.equal(pdfFilename([undefined, "  "], "Eksport"), "Eksport.pdf");
});

test("HTML-to-PDF failures expose stable codes instead of user copy", () => {
  const cause = new Error("browser detail");
  const error = new HtmlToPdfError("render-failed", cause);
  assert.equal(error.message, "[html-to-pdf:render-failed]");
  assert.equal(error.cause, cause);
});