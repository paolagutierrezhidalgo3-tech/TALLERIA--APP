// Pure date/row-math for the calendar view -- kept out of calendar.tsx (a
// React/JSX module) so it has direct unit coverage: this repo's test suite
// has no JSX parsing/rendering harness (see components/workspace.test.ts),
// so a .test.ts file can only import from a plain .ts module like this one.
import { localMinutesOfDay, zonedTimeToUtc } from './domain';
import type { ViewQuery } from './queries';

// A "day" here is always a plain Y-M-D string, never an instant -- pure
// calendar-date arithmetic, no timezone involved. Converting a range
// boundary into the real instant the workshop's timezone means is the
// caller's job, via zonedTimeToUtc, exactly as horarios/excepciones do.
export function addDaysISO(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
function startOfWeekISO(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return addDaysISO(iso, -(weekday === 0 ? 6 : weekday - 1));
}
export function rangeDatesForMode(anchor: string, mode: 'day' | 'week'): { startISO: string; endISO: string } {
  if (mode === 'day') return { startISO: anchor, endISO: addDaysISO(anchor, 1) };
  const startISO = startOfWeekISO(anchor);
  return { startISO, endISO: addDaysISO(startISO, 7) };
}
// The exact query the calendar view needs for a given anchor/mode, shared
// between the component that builds it (workspace.tsx, to fetch) and the
// component that checks whether what's currently loaded still matches it
// (also workspace.tsx, to avoid ever showing one date's citas under another
// while a newer range is still loading -- see calendarKeyRef there).
export function calendarQueryFor(anchor: string, mode: 'day' | 'week', timezone: string): ViewQuery {
  const { startISO, endISO } = rangeDatesForMode(anchor, mode);
  return { view: 'calendar', offset: 0, search: '', status: 'all', range_start: new Date(zonedTimeToUtc(startISO, '00:00', timezone)).toISOString(), range_end: new Date(zonedTimeToUtc(endISO, '00:00', timezone)).toISOString() };
}
export function toMinutes(hhmm: string): number { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; }
export function fromMinutes(total: number): string { const h = Math.floor(total / 60) % 24, m = total % 60; return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0'); }
// Noon UTC never shifts to a different calendar date once formatted in any
// real timezone (offsets never exceed +14/-12), so it is safe to use purely
// to render a label for a Y-M-D string -- never used for actual scheduling.
export function noon(iso: string) { return new Date(iso + 'T12:00:00Z'); }
// Row containing an instant, given the real-instant boundary of each row
// edge on this date (see DayGrid) -- clamped into [0, rows-1] so a cita
// starting before, or ending after, the displayed window is clipped to the
// edge row instead of being hidden or placed at the wrong end of the day.
//
// Known, narrow, cosmetic-only limitation: on the ~2 nights a year a
// workshop's timezone changes its clock, the nominal half-hour labels
// between roughly 01:00 and 04:00 stop mapping to distinct real instants --
// a spring-forward night collapses two of them onto the same real moment
// (the skipped hour), a fall-back night has two real moments share one
// label (the repeated hour). A cita that actually straddles that literal
// transition can size a row or two short of its real duration there -- it
// is never hidden or placed on the wrong day, only, in that one rare
// window, drawn slightly shorter than its true length. No car workshop's
// business hours reach 1-4am, so no real cita is expected to ever exercise
// this; a fixed nominal-label grid cannot represent a night that isn't 24
// real hours long without a different row model, which is out of scope
// here.
export function rowContaining(instant: number, boundaries: number[]): number {
  const rows = boundaries.length - 1;
  for (let r = 0; r < rows; r++) if (instant < boundaries[r + 1]) return r;
  return rows - 1;
}
export function endRowExclusive(instant: number, boundaries: number[]): number {
  const rows = boundaries.length - 1;
  for (let r = 1; r <= rows; r++) if (instant <= boundaries[r]) return r;
  return rows;
}
// "Past" for the calendar, always on the WORKSHOP's clock: a calendar date
// before the workshop's today (both plain YYYY-MM-DD, so they compare as
// strings), or a slot whose real start instant is not in the future -- the
// same rule the server applies to a new appointment (starts_at <= now() is
// rejected). Past days and slots are shown neutral and never offer to create
// a cita: the server would refuse it, and a past day's exceptions aren't
// loaded by workspace_snapshot (it only returns them from today on), so its
// open/closed hours can't be shown reliably either.
export function isPastDay(dateISO: string, todayISO: string): boolean {
  return dateISO < todayISO;
}
export function isPastSlot(dateISO: string, slotStart: number, todayISO: string, now: number): boolean {
  return isPastDay(dateISO, todayISO) || slotStart <= now;
}
// The start "Nueva cita" proposes for a day in the week view: the day's
// opening time, unless that day is the workshop's today and the opening has
// already passed -- then the next half hour still ahead (real instants, so a
// DST change can't propose a time already gone), or null when no half hour
// is left today (the editor then opens with an empty date).
export function suggestedStart(dateISO: string, openingMinutes: number, todayISO: string, now: number, timeZone: string): number | null {
  const opening = zonedTimeToUtc(dateISO, fromMinutes(openingMinutes), timeZone);
  if (dateISO !== todayISO || opening > now) return opening;
  for (let minutes = Math.ceil((localMinutesOfDay(new Date(now), timeZone) + 1) / 30) * 30; minutes < 1440; minutes += 30) {
    const candidate = zonedTimeToUtc(dateISO, fromMinutes(minutes), timeZone);
    if (candidate > now) return candidate;
  }
  return null;
}
