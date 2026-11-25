/**
 * Plain-language dates for market makers.
 *
 * A typed date matches one Eastern Time instant, usually 11:59 PM ET, which is
 * when a Cheddar date outcome is read. "March 31" and "end of March" are the
 * same match. Ladders (month-ends, quarter-ends) are just a list of those matches.
 */

const TZ = "America/New_York";

const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

export interface DateMatch {
  date: Date;
  /** Outcome name, e.g. "By Mar 31, 2027". */
  label: string;
  /** Confirmation line, e.g. "Mar 31, 2027 · 11:59 PM ET". */
  when: string;
  kind: "day" | "month" | "quarter" | "relative";
}

interface Wall {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
}

export function etParts(date: Date): Wall {
  const bag: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  }).formatToParts(date)) {
    if (p.type !== "literal") bag[p.type] = p.value;
  }
  let hour = Number(bag.hour);
  if (hour === 24) hour = 0;
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(bag.weekday ?? "");
  return {
    year: Number(bag.year),
    month: Number(bag.month),
    day: Number(bag.day),
    hour,
    minute: Number(bag.minute),
    weekday,
  };
}

/** Offset of America/New_York from UTC at this instant, in milliseconds (EST is -5h). */
function tzOffsetMs(instant: Date): number {
  const p = etParts(instant);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - instant.getTime();
}

/** A wall-clock time in Eastern Time, as a UTC instant. */
export function easternTime(year: number, month: number, day: number, hour: number, minute: number): Date {
  const wall = Date.UTC(year, month - 1, day, hour, minute, 0);
  let utc = wall;
  for (let i = 0; i < 2; i++) utc = wall - tzOffsetMs(new Date(utc));
  return new Date(utc);
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function endOfMonth(year: number, month: number, hour: number, minute: number): Date {
  return easternTime(year, month, daysInMonth(year, month), hour, minute);
}

function addMonths(year: number, month: number, delta: number): { year: number; month: number } {
  const i = year * 12 + (month - 1) + delta;
  return { year: Math.floor(i / 12), month: (i % 12) + 1 };
}

function addDays(year: number, month: number, day: number, delta: number): { year: number; month: number; day: number } {
  const t = new Date(Date.UTC(year, month - 1, day + delta));
  return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() };
}

const dayFmt = new Intl.DateTimeFormat("en-US", { timeZone: TZ, month: "short", day: "numeric", year: "numeric" });

export function formatDayEt(date: Date): string {
  return dayFmt.format(date);
}

/** Clock in Eastern Time, with a normal space before AM/PM. */
export function formatClockEt(date: Date): string {
  const p = etParts(date);
  const h = p.hour % 12 || 12;
  const ap = p.hour < 12 ? "AM" : "PM";
  return `${h}:${String(p.minute).padStart(2, "0")} ${ap}`;
}

export function formatWhenEt(date: Date): string {
  return `${formatDayEt(date)} · ${formatClockEt(date)} ET`;
}

export function byLabel(date: Date): string {
  return `By ${formatDayEt(date)}`;
}

/** A phrase matchDate understands. End-of-day matches omit the clock. */
export function phraseFor(date: Date): string {
  const p = etParts(date);
  const day = formatDayEt(date);
  if (p.hour === 23 && p.minute === 59) return day;
  return `${day} ${formatClockEt(date)}`;
}

function finish(date: Date, kind: DateMatch["kind"]): DateMatch {
  return { date, label: byLabel(date), when: formatWhenEt(date), kind };
}

function parseTime(rest: string): { hour: number; minute: number } | null {
  const s = rest.trim().replace(/^at\s+/, "");
  if (!s) return { hour: 23, minute: 59 };
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/.exec(s);
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = m[2] ? Number(m[2]) : 0;
  if (minute > 59) return null;
  const ap = m[3];
  if (ap) {
    if (hour < 1 || hour > 12) return null;
    if (ap === "pm" && hour !== 12) hour += 12;
    if (ap === "am" && hour === 12) hour = 0;
  } else if (hour > 23) {
    return null;
  }
  return { hour, minute };
}

function withYear(month: number, day: number, year: number | null, hour: number, minute: number, now: Date): Date | null {
  if (day < 1 || day > 31) return null;
  const on = (yy: number) => (day <= daysInMonth(yy, month) ? easternTime(yy, month, day, hour, minute) : null);
  if (year != null) return on(year);
  const y = etParts(now).year;
  const thisYear = on(y);
  if (thisYear && thisYear.getTime() + 60_000 >= now.getTime()) return thisYear;
  return on(y + 1);
}

function monthEnd(month: number, year: number | null, hour: number, minute: number, now: Date): Date {
  if (year != null) return endOfMonth(year, month, hour, minute);
  const y = etParts(now).year;
  const thisYear = endOfMonth(y, month, hour, minute);
  if (thisYear.getTime() + 60_000 >= now.getTime()) return thisYear;
  return endOfMonth(y + 1, month, hour, minute);
}

function normalize(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[\u202f\u00a0]/g, " ")
    .replace(/[.,]+/g, " ")
    .replace(/(\d)(?:st|nd|rd|th)\b/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Match a market maker's date. Empty and unrecognized text return null.
 * A missing year means the next time that date is still ahead. A missing
 * clock means 11:59 PM ET.
 */
export function matchDate(input: string, now = new Date()): DateMatch | null {
  let s = normalize(input);
  if (!s) return null;
  s = s.replace(/^(by|before|on|end of)\s+/, "").trim();
  const today = etParts(now);

  if (s === "today" || s === "tomorrow") {
    const d = addDays(today.year, today.month, today.day, s === "tomorrow" ? 1 : 0);
    return finish(easternTime(d.year, d.month, d.day, 23, 59), "relative");
  }

  if (s === "eom" || s === "this month" || s === "the month" || s === "month") {
    return finish(endOfMonth(today.year, today.month, 23, 59), "month");
  }
  if (s === "next month") {
    const n = addMonths(today.year, today.month, 1);
    return finish(endOfMonth(n.year, n.month, 23, 59), "month");
  }
  if (s === "eoy" || s === "this year" || s === "the year" || s === "year") {
    return finish(easternTime(today.year, 12, 31, 23, 59), "relative");
  }
  if (s === "next year") return finish(easternTime(today.year + 1, 12, 31, 23, 59), "relative");

  let m = /^in\s+(\d+)\s+(day|days|week|weeks|month|months)$/.exec(s);
  if (m) {
    const n = Number(m[1]);
    if (n < 1 || n > 520) return null;
    const unit = m[2] ?? "";
    if (unit.startsWith("month")) {
      const shifted = addMonths(today.year, today.month, n);
      const day = Math.min(today.day, daysInMonth(shifted.year, shifted.month));
      return finish(easternTime(shifted.year, shifted.month, day, 23, 59), "relative");
    }
    const days = unit.startsWith("week") ? n * 7 : n;
    const d = addDays(today.year, today.month, today.day, days);
    return finish(easternTime(d.year, d.month, d.day, 23, 59), "relative");
  }

  m = /^(this\s+|next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)$/.exec(s);
  if (m) {
    const which = (m[1] ?? "").trim();
    const target = WEEKDAYS.indexOf(m[2] ?? "");
    let delta = (target - today.weekday + 7) % 7;
    // "next Friday" on a Friday means a week out. On any other day it means the coming Friday.
    if (which === "next" && delta === 0) delta = 7;
    const d = addDays(today.year, today.month, today.day, delta);
    return finish(easternTime(d.year, d.month, d.day, 23, 59), "relative");
  }

  m = /^q([1-4])(?:\s+(\d{4}))?(?:\s+(.+))?$/.exec(s);
  if (m) {
    const time = parseTime(m[3] ?? "");
    if (!time) return null;
    const q = Number(m[1]);
    const year = m[2] ? Number(m[2]) : null;
    if (year != null && (year < 2000 || year > 2100)) return null;
    return finish(monthEnd(q * 3, year, time.hour, time.minute, now), "quarter");
  }

  m = /^(\d{4})-(\d{2})-(\d{2})(?:[ t](.+))?$/.exec(s);
  if (m) {
    const time = parseTime(m[4] ?? "");
    if (!time) return null;
    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);
    if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
    return finish(easternTime(year, month, day, time.hour, time.minute), "day");
  }

  m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?:\s+(.+))?$/.exec(s);
  if (m) {
    const time = parseTime(m[4] ?? "");
    if (!time) return null;
    const month = Number(m[1]);
    const day = Number(m[2]);
    if (month < 1 || month > 12) return null;
    let year = m[3] ? Number(m[3]) : null;
    if (year != null && year < 100) year += 2000;
    const date = withYear(month, day, year, time.hour, time.minute, now);
    return date ? finish(date, "day") : null;
  }

  m = /^([a-z]+)\s+(\d{1,2})(?:\s+(\d{4}))?(?:\s+(.+))?$/.exec(s);
  if (m && MONTHS[m[1] ?? ""]) {
    const time = parseTime(m[4] ?? "");
    if (!time) return null;
    const year = m[3] ? Number(m[3]) : null;
    if (year != null && (year < 2000 || year > 2100)) return null;
    const date = withYear(MONTHS[m[1] ?? ""]!, Number(m[2]), year, time.hour, time.minute, now);
    return date ? finish(date, "day") : null;
  }

  m = /^(\d{1,2})\s+([a-z]+)(?:\s+(\d{4}))?(?:\s+(.+))?$/.exec(s);
  if (m && MONTHS[m[2] ?? ""]) {
    const time = parseTime(m[4] ?? "");
    if (!time) return null;
    const year = m[3] ? Number(m[3]) : null;
    if (year != null && (year < 2000 || year > 2100)) return null;
    const date = withYear(MONTHS[m[2] ?? ""]!, Number(m[1]), year, time.hour, time.minute, now);
    return date ? finish(date, "day") : null;
  }

  m = /^([a-z]+)(?:\s+(\d{4}))?(?:\s+(.+))?$/.exec(s);
  if (m && MONTHS[m[1] ?? ""] && parseTime(m[3] ?? "")) {
    const time = parseTime(m[3] ?? "")!;
    const year = m[2] ? Number(m[2]) : null;
    if (year != null && (year < 2000 || year > 2100)) return null;
    return finish(monthEnd(MONTHS[m[1] ?? ""]!, year, time.hour, time.minute, now), "month");
  }

  return null;
}

export type LadderPreset = "month" | "months" | "quarters" | "year";

/** The next date boundary of a kind, then the ones after it. Already-passed ends are skipped. */
export function dateLadder(preset: LadderPreset, now = new Date()): DateMatch[] {
  const t = etParts(now);
  if (preset === "month") return [finish(monthEnd(t.month, null, 23, 59, now), "month")];
  if (preset === "year") {
    const dec = easternTime(t.year, 12, 31, 23, 59);
    return [finish(dec.getTime() + 60_000 >= now.getTime() ? dec : easternTime(t.year + 1, 12, 31, 23, 59), "relative")];
  }
  if (preset === "months") {
    const out: DateMatch[] = [];
    let y = t.year;
    let m = t.month;
    for (let i = 0; i < 8 && out.length < 4; i++) {
      const end = endOfMonth(y, m, 23, 59);
      if (end.getTime() + 60_000 >= now.getTime()) out.push(finish(end, "month"));
      const n = addMonths(y, m, 1);
      y = n.year;
      m = n.month;
    }
    return out;
  }
  const out: DateMatch[] = [];
  let y = t.year;
  let q = Math.ceil(t.month / 3);
  for (let i = 0; i < 8 && out.length < 4; i++) {
    const end = endOfMonth(y, q * 3, 23, 59);
    if (end.getTime() + 60_000 >= now.getTime()) out.push(finish(end, "quarter"));
    q += 1;
    if (q === 5) {
      q = 1;
      y += 1;
    }
  }
  return out;
}

/** Same comparison the exchange uses: a date outcome is Yes when its instant is on or after the event. */
export function outcomeMatchesEvent(dateValueIso: string | null, event: Date): boolean | null {
  if (!dateValueIso) return null;
  const d = new Date(dateValueIso);
  if (Number.isNaN(d.getTime())) return null;
  return d.getTime() >= event.getTime();
}

export interface DateDraft {
  id: string;
  text: string;
  label: string;
  /** True once the maker renames the outcome away from the automatic "By …" label. */
  pinned: boolean;
  /** Server timestamp kept until the maker retypes the date. */
  lockedIso: string | null;
}

export interface ResolvedDate {
  label: string;
  iso: string;
  when: string;
  past: boolean;
}

export function blankDateDraft(id: string): DateDraft {
  return { id, text: "", label: "", pinned: false, lockedIso: null };
}

export function draftFromStored(id: string, label: string, iso: string): DateDraft {
  const date = new Date(iso);
  const phrase = Number.isNaN(date.getTime()) ? "" : phraseFor(date);
  const auto = phrase ? matchDate(phrase, date)?.label ?? "" : "";
  return {
    id,
    text: phrase,
    label: label || auto,
    pinned: !!label && label !== auto,
    lockedIso: Number.isNaN(date.getTime()) ? null : date.toISOString(),
  };
}

export function draftsFromLadder(preset: LadderPreset, now = new Date()): DateDraft[] {
  return dateLadder(preset, now).map((m, i) => ({
    id: `ladder-${preset}-${i}`,
    text: phraseFor(m.date),
    label: m.label,
    pinned: false,
    lockedIso: m.date.toISOString(),
  }));
}

export function resolveDateDraft(row: DateDraft, now = new Date()): ResolvedDate | null {
  const locked = row.lockedIso ? new Date(row.lockedIso) : null;
  const lockFresh = locked && !Number.isNaN(locked.getTime()) && row.text.trim() === phraseFor(locked);
  const match = matchDate(row.text, lockFresh ? locked! : now);
  const date = lockFresh ? locked! : match?.date;
  if (!date || Number.isNaN(date.getTime())) return null;
  const label = (row.pinned ? row.label.trim() : match?.label || byLabel(date)).slice(0, 80);
  if (!label) return null;
  return { label, iso: date.toISOString(), when: formatWhenEt(date), past: date.getTime() < now.getTime() };
}

export function applyDateText(row: DateDraft, text: string, now = new Date()): DateDraft {
  const match = matchDate(text, now);
  return {
    ...row,
    text,
    lockedIso: null,
    label: row.pinned ? row.label : match?.label ?? "",
  };
}

/** Matched dates, earliest first. Blank rows are dropped. */
export function datesForSubmit(rows: DateDraft[], now = new Date()): ResolvedDate[] {
  return rows
    .map((r) => resolveDateDraft(r, now))
    .filter((r): r is ResolvedDate => r != null)
    .sort((a, b) => a.iso.localeCompare(b.iso));
}

export function dateProblems(rows: DateDraft[], now = new Date()): string | null {
  const filled = rows.filter((r) => r.text.trim() || r.lockedIso);
  const resolved = filled.map((r) => ({ row: r, res: resolveDateDraft(r, now) }));
  const unmatched = resolved.find((r) => r.row.text.trim() && !r.res);
  if (unmatched) return `Couldn't match “${unmatched.row.text.trim()}”. Try “Mar 31” or “end of June”.`;
  const ok = resolved.map((r) => r.res).filter((r): r is ResolvedDate => r != null);
  if (ok.length < 2) return "Add at least two dates.";
  if (new Set(ok.map((r) => formatDayEt(new Date(r.iso)))).size !== ok.length) return "Two outcomes land on the same date.";
  if (new Set(ok.map((r) => r.label.toLowerCase())).size !== ok.length) return "Each date needs its own name.";
  return null;
}
