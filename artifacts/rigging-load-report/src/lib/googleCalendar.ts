export type GoogleCalendarEvent = {
  title: string;
  start: Date;
  end: Date;
  details?: string;
  location?: string;
};

function toGoogleUtcTimestamp(value: Date, invalidDateMessage: string): string {
  if (Number.isNaN(value.getTime())) {
    throw new Error(invalidDateMessage);
  }
  return value
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

/** Build a standard pre-filled Google Calendar event URL. */
export function buildGoogleCalendarUrl(
  event: GoogleCalendarEvent,
  invalidDateMessage: string,
): string {
  const params = [
    ["action", "TEMPLATE"],
    ["text", event.title],
    [
      "dates",
      `${toGoogleUtcTimestamp(event.start, invalidDateMessage)}/${toGoogleUtcTimestamp(event.end, invalidDateMessage)}`,
    ],
    ["details", event.details ?? ""],
    ["location", event.location ?? ""],
  ]
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join("&");

  return `https://calendar.google.com/calendar/render?${params}`;
}