// Trip item time parsing.
//
// The Notion `Time` property is deliberately free text: real trips carry a mix
// of specific times ("9:30am", "19:00") and rough ones ("morning", "evening"),
// and most items carry nothing at all. This module turns any of those into a
// sort key plus a label.
//
// The rule that matters: a rough word is displayed as the WORD. It is never
// rendered as the clock time we anchored it to, because that would be a
// precision nobody entered.
//
// The Swift twin of this file is Sunzzari/Services/TripTime.swift. The bucket
// table and the anchors must stay identical in both.

export interface ParsedTime {
  /** Minutes since midnight for ordering. ALL_DAY sorts above everything. */
  sortKey: number
  /** What to show. Null means show nothing and group under "Anytime". */
  label: string | null
  /** True only when a real clock time was given. Drives 12:30 vs "Midday". */
  exact: boolean
  /** True when the item belongs in the "Anytime" group rather than the timeline. */
  anytime: boolean
}

/** Sorts above every real time, for items that run the whole day. */
export const ALL_DAY = -1

/** Sorts below every real time, so untimed items trail the timeline. */
export const NO_TIME = 100000

const ANYTIME: ParsedTime = { sortKey: NO_TIME, label: null, exact: false, anytime: true }

// Rough time words and the minute they anchor to.
//
// Matched LONGEST PHRASE FIRST (see the sort below), which is structural, not
// a property of how this list happens to be ordered. Substring collisions are
// everywhere here: "afternoon" contains "noon", "late night" contains
// "night", "early morning" contains "morning". Hand-ordering this list got
// "Late afternoon" wrong once already - it matched "noon" and sorted to 12:00.
const RAW_BUCKETS: [string, number][] = [
  ['all day', ALL_DAY],
  ['allday', ALL_DAY],
  ['full day', ALL_DAY],
  ['first thing', 6 * 60],
  ['sunrise', 6 * 60],
  ['dawn', 6 * 60],
  ['early morning', 7 * 60],
  ['breakfast', 8 * 60],
  ['late morning', 10 * 60 + 30],
  ['morning', 9 * 60],
  ['midday', 12 * 60 + 30],
  ['noon', 12 * 60],
  ['lunch', 12 * 60 + 30],
  ['late afternoon', 16 * 60 + 30],
  ['early afternoon', 13 * 60 + 30],
  ['afternoon', 15 * 60],
  ['golden hour', 18 * 60 + 30],
  ['sunset', 18 * 60 + 30],
  ['aperitivo', 18 * 60 + 30],
  ['apero', 18 * 60 + 30],
  ['drinks', 18 * 60 + 30],
  ['dinner', 19 * 60 + 30],
  ['evening', 19 * 60 + 30],
  ['late night', 22 * 60 + 30],
  ['night', 21 * 60 + 30],
  ['nightcap', 22 * 60],
]

const BUCKETS: [string, number][] = [...RAW_BUCKETS].sort((a, b) => b[0].length - a[0].length)

/** "9:30am", "9:30 AM", "19:00", "6:35p", "9am", "9 am" -> minutes. */
function parseClock(raw: string): number | null {
  const match = raw.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p)?$/i)
  if (!match) return null

  let hour = Number(match[1])
  const minute = match[2] ? Number(match[2]) : 0
  const suffix = match[3]?.toLowerCase()

  if (minute > 59) return null
  if (suffix) {
    if (hour < 1 || hour > 12) return null
    const pm = suffix.startsWith('p')
    if (hour === 12) hour = pm ? 12 : 0
    else if (pm) hour += 12
  } else {
    // No am/pm marker. A bare 1-2 digit number is a date fragment as often as
    // a time, so require either a colon or a 24h-looking hour.
    if (!match[2]) return null
    if (hour > 23) return null
  }

  return hour * 60 + minute
}

function formatClock(minutes: number): string {
  const hour24 = Math.floor(minutes / 60) % 24
  const minute = minutes % 60
  const suffix = hour24 < 12 ? 'AM' : 'PM'
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12
  return `${hour12}:${String(minute).padStart(2, '0')} ${suffix}`
}

function titleCase(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/**
 * @param timeText the Notion `Time` property, free text
 * @param isoDate  `Assigned to Date` or `Date`, used only if it carries a time
 */
export function parseTime(timeText: string | null | undefined, isoDate?: string | null): ParsedTime {
  const raw = (timeText ?? '').trim()

  if (raw) {
    const lower = raw.toLowerCase()

    // "anytime" is an explicit statement that there is no time.
    if (lower === 'anytime' || lower === 'any time' || lower === 'tbd' || lower === 'flexible') {
      return ANYTIME
    }

    // A clock time, possibly a range ("7:30pm-9pm"): the start orders it.
    const start = lower.split(/\s*(?:-|–|—|to|until|till)\s*/)[0].trim()
    const clock = parseClock(start.replace(/\s+/g, ''))
    if (clock !== null) {
      // Show what she typed when it is already a clean time, so "7:30pm-9pm"
      // keeps its range instead of being flattened to the start.
      return { sortKey: clock, label: raw, exact: true, anytime: false }
    }

    for (const [word, anchor] of BUCKETS) {
      if (lower.includes(word)) {
        return {
          sortKey: anchor,
          label: titleCase(raw),
          exact: false,
          anytime: false,
        }
      }
    }

    // Unrecognized but she wrote something. Show her words verbatim; we have
    // no basis to place it on the timeline, so it groups under Anytime.
    return { sortKey: NO_TIME, label: titleCase(raw), exact: false, anytime: true }
  }

  // No Time property. Fall back to a time component on the date field, which
  // nothing carries today but which the schema allows.
  if (isoDate && isoDate.includes('T')) {
    const hhmm = isoDate.split('T')[1]?.slice(0, 5)
    const [h, m] = (hhmm ?? '').split(':').map(Number)
    if (Number.isFinite(h) && Number.isFinite(m)) {
      const minutes = h * 60 + m
      return { sortKey: minutes, label: formatClock(minutes), exact: true, anytime: false }
    }
  }

  return ANYTIME
}

/** Sort comparator: earlier first, all-day pinned to the top. */
export function byTime(a: ParsedTime, b: ParsedTime): number {
  return a.sortKey - b.sortKey
}
