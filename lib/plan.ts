import type { DayBundle, Trip, TripItem, TripLeg } from './types'
import { groupDays, planDay, SCHEDULED_STATUSES, type PlannedItem } from './day'

// The Plan tab: the trip as it is being planned, before anyone is on it.
//
// Web only on purpose. lib/day.ts has a hand-kept Swift twin
// (TripDayPlanner.swift), so this file only CALLS it and never changes it; the
// phone has no planning screen to keep in step with.
//
// The rule that shapes everything here is her 2026-09-07 one: "dont ever take
// your recommendations as accepted by me unless i explicitly state". Only the
// statuses she sets herself count as plans or as things to do. Shortlisted and
// Researching are Considering, never To-do.

export const CONSIDERING_STATUSES = new Set(['Shortlisted', 'Researching'])
const TRANSPORT_TYPES = new Set(['Flight', 'Train', 'Ferry', 'Car Rental'])

export function isCommitted(item: TripItem): boolean {
  return SCHEDULED_STATUSES.has(item.status ?? '')
}

export function isConsidering(item: TripItem): boolean {
  return CONSIDERING_STATUSES.has(item.status ?? '')
}

/**
 * The four groups every control speaks in: the chip row, the summary tiles and
 * the map's Considering switch all switch these, and nothing else. Elisa,
 * 2026-10-18 (audit H1): "replace the layer and status chip rows with one
 * Booked / Planned / To book / Considering row, keep the map switch." Before,
 * Considering had four switches and "Planned" meant two different things.
 * Every live item sits in exactly one group, hotels included.
 */
// Three choices, Elisa 2026-10-18: "its not clear what the difference is
// between considering, planned, to book, booked ... can we clean up the
// choices?" -> Idea / Planned / Booked. A legacy Reservation Pending row
// counts as Planned (on a day, not booked yet). The id stays 'considering'.
// Labels are her Notion statuses, Elisa 2026-10-19: "booked and planned are
// overlapping so thats very confusing phrasing. use what i use on my notion".
export type Group = 'booked' | 'planned' | 'considering'
export const GROUPS: { id: Group; label: string; statuses: string[] }[] = [
  { id: 'booked', label: 'Confirmed', statuses: ['Confirmed'] },
  { id: 'planned', label: 'Assigned', statuses: ['Assigned', 'Reservation Pending'] },
  { id: 'considering', label: 'Shortlisted', statuses: ['Shortlisted', 'Researching'] },
]
export const ALL_GROUPS: Group[] = GROUPS.map(g => g.id)

export function groupOf(item: TripItem): Group | null {
  return GROUPS.find(g => g.statuses.includes(item.status ?? ''))?.id ?? null
}

/** A gap worked out from her own dates. A fact, never written as a task. */
export interface Gap {
  kind: 'no-hotel' | 'no-transport'
  date: string
  leg: string
  text: string
}

export interface PlanDay {
  date: string
  dayNumber: number
  totalDays: number
  leg: string
  /** False on the last day: you fly home, nobody sleeps on the trip that night. */
  isNight: boolean
  hotel: TripItem | null
  /** Her plans for the day, in time order: timed first, then the rest. */
  committed: PlannedItem[]
  /** Candidates for this day: dated ones, plus undated ones on this day's leg. */
  considering: TripItem[]
  toBook: TripItem[]
  gaps: Gap[]
}

export interface TripPlan {
  days: PlanDay[]
  /** Everything still to book, across the trip (Reservation Pending). */
  toBook: TripItem[]
  gaps: Gap[]
  counts: { booked: number; planned: number; toBook: number; considering: number }
}

function addDay(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

function datesBetween(start: string, endInclusive: string): string[] {
  const out: string[] = []
  // A guard against a typo'd year turning one trip into a decade of chips.
  for (let d = start; d <= endInclusive && out.length < 120; d = addDay(d, 1)) out.push(d)
  return out
}

/**
 * Every day of the trip, not only the days that already hold something: a
 * blank day is exactly what a planning view has to show. Departure to Return,
 * else the legs' span, else whatever days have items.
 */
export function tripDates(trip: Trip, legs: TripLeg[], items: TripItem[]): string[] {
  if (trip.departureDate) return datesBetween(trip.departureDate, trip.returnDate ?? trip.departureDate)
  const starts = legs.map(l => l.startDate).filter(Boolean) as string[]
  const ends = legs.map(l => l.endDate ?? l.startDate).filter(Boolean) as string[]
  if (starts.length) return datesBetween(starts.sort()[0], ends.sort()[ends.length - 1])
  return groupDays(items).map(d => d.dateString)
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

/** The leg you wake up in on this date. Leg end dates are checkout days. */
export function legOn(date: string, legs: TripLeg[]): string {
  const sleeping = legs.find(l => l.startDate && l.startDate <= date && (!l.endDate || date < l.endDate))
  if (sleeping) return sleeping.name
  return legs.find(l => l.endDate === date)?.name ?? ''
}

function byName(a: TripItem, b: TripItem): number {
  return a.name.localeCompare(b.name)
}

export function buildPlan(trip: Trip, legs: TripLeg[], items: TripItem[]): TripPlan {
  const live = items.filter(i => i.status && i.status !== 'Cancelled')
  const dates = tripDates(trip, legs, live)
  const bundles = new Map(groupDays(live).map(b => [b.dateString, b]))
  const lastDate = dates[dates.length - 1]

  // Undated candidates belong to every day of their leg: "around the areas
  // where ill be going". Matched on the leg name, the canonical Leg / City value.
  const undatedConsidering = live.filter(i => isConsidering(i) && !(i.assignedToDate ?? i.date))

  const days: PlanDay[] = dates.map((date, index) => {
    const bundle: DayBundle = bundles.get(date) ?? { id: date, dateString: date, confirmed: [], possibilities: [] }
    const p = planDay(bundle, dates)
    // With legs, the legs decide: a night needs a hotel only when a leg is
    // sleeping there. Vienna 2026 departs Dec 26 on an overnight flight and the
    // first leg starts Dec 27, so Dec 26 is not an unbooked night. Without legs,
    // every night but the last does.
    const hasLegs = legs.length > 0
    const leg = hasLegs ? legOn(date, legs) : p.legCity
    const isNight = hasLegs
      ? legs.some(l => l.startDate && l.startDate <= date && (!l.endDate || date < l.endDate))
      : date !== lastDate || dates.length === 1

    const committed = [...p.timeline, ...p.anytime]
    // Candidates: the ones dated this day, plus the undated ones on this day's
    // leg. groupDays fans undated candidates out by the leg text of whatever is
    // dated that day, which puts Salzburg ideas on a flight day; the Trip Legs
    // dates are the better answer when the trip has them.
    const datedHere = bundle.possibilities.filter(i => isConsidering(i) && !!(i.assignedToDate ?? i.date))
    const legCandidates = leg ? undatedConsidering.filter(i => i.legCity && same(i.legCity, leg)) : []
    const considering = [...(hasLegs ? datedHere : p.options), ...legCandidates]
      .filter((item, i, list) => list.findIndex(c => c.id === item.id) === i)
      .sort(byName)

    const gaps: Gap[] = []
    if (isNight && (!p.hotel || p.hotel.status === 'Assigned')) {
      gaps.push({
        kind: 'no-hotel', date, leg,
        text: p.hotel ? `${p.hotel.name} not booked yet` : 'No hotel booked tonight',
      })
    }
    const legRow = legs.find(l => l.startDate === date && l.name === leg)
    if (legRow) {
      // A booked arrival is a Confirmed transport item on the leg's first day.
      // One still being booked is already under To book, so it is not a gap.
      const arrivals = live.filter(i =>
        TRANSPORT_TYPES.has(i.type ?? '') && (i.assignedToDate ?? i.date) === date &&
        (i.status === 'Confirmed' || i.status === 'Reservation Pending')
      )
      if (arrivals.length === 0) gaps.push({ kind: 'no-transport', date, leg, text: `No booked way into ${leg}` })
    }

    return {
      date,
      dayNumber: index + 1,
      totalDays: dates.length,
      leg,
      isNight,
      hotel: p.hotel,
      committed,
      considering,
      toBook: committed.map(c => c.item).filter(i => i.status === 'Reservation Pending'),
      gaps,
    }
  })

  return {
    days,
    toBook: live.filter(i => i.status === 'Reservation Pending').sort((a, b) =>
      (a.assignedToDate ?? a.date ?? '').localeCompare(b.assignedToDate ?? b.date ?? '') || byName(a, b)),
    gaps: days.flatMap(d => d.gaps),
    counts: {
      booked: live.filter(i => i.status === 'Confirmed').length,
      planned: live.filter(i => i.status === 'Assigned' || i.status === 'Reservation Pending').length,
      toBook: live.filter(i => i.status === 'Reservation Pending').length,
      considering: live.filter(isConsidering).length,
    },
  }
}

/**
 * Pin numbers for one day: 1, 2, 3 in the day's order, hotels left unnumbered
 * (they are where you sleep, not a stop). Keyed by item id.
 */
export function stopNumbers(day: PlanDay): Map<string, number> {
  const out = new Map<string, number>()
  let n = 0
  for (const { item } of day.committed) {
    if (item.type === 'Hotel') continue
    out.set(item.id, ++n)
  }
  return out
}
