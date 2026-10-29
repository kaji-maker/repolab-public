export const originalSource = `export function bookingDate(instant, timeZone) {
  return new Date(instant).toISOString().slice(0, 10);
}
`;

// Reviewed references for offline development; never included in live model context.
export const referenceSource = `export function bookingDate(instant, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date(instant));
  const get = type => parts.find(part => part.type === type).value;
  return get('year') + '-' + get('month') + '-' + get('day');
}
`;
export const incompleteSource = `export function bookingDate(instant, timeZone) {
  return new Date(Date.parse(instant) + 345 * 60 * 1000).toISOString().slice(0, 10);
}
`;

export const exampleReport = `Bookings must use the calendar date in the venue's IANA timezone, rather than the server's UTC calendar date.
For instant 2026-10-03T20:00:00Z at venue timezone Asia/Kathmandu, the expected date is 2026-10-04; the current app shows 2026-10-03.
For instant 2026-10-04T02:00:00Z at venue timezone America/Los_Angeles, the expected date is 2026-10-03; the current app shows 2026-10-04.
Existing UTC bookings must continue to return their UTC calendar date.`;

export const profileSummary = {
  id: "booking-timezone" as const,
  name: "Booking calendar dates",
  description:
    "A small JavaScript booking module that ignores the venue timezone.",
  report: exampleReport,
  origin: "Purpose-built demonstration fixture",
  scope:
    "One module, explicit timestamp/timezone/date examples; no uploaded repositories yet.",
};

export const baselineProbes = [
  {
    id: "utc-october",
    instant: "2026-10-04T12:00:00Z",
    timeZone: "UTC",
    expected: "2026-10-04",
  },
  {
    id: "utc-january",
    instant: "2026-01-15T12:00:00Z",
    timeZone: "UTC",
    expected: "2026-01-15",
  },
];
