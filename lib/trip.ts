import type { Trip } from './types'

/**
 * The trip you are on, or the next one up.
 *
 * DATE-BASED ON PURPOSE. Trip Status is not reliable for this: on 2026-09-06,
 * mid-way through Park City (Sep 4-7), that trip's Notion Trip Status still
 * read "Planning". Nothing flips it to "In Progress", so anything keying off
 * status would have shown no live trip while she was standing in it.
 */
export function findLiveTrip(trips: Trip[], today: string): Trip | null {
  return trips.find(t =>
    t.status !== 'Completed' &&
    t.status !== 'Cancelled' &&
    t.departureDate != null &&
    t.departureDate <= today &&
    (t.returnDate ?? t.departureDate)! >= today
  ) ?? null
}

/** The soonest trip that has not started yet. */
export function findNextTrip(trips: Trip[], today: string): Trip | null {
  return [...trips]
    .filter(t => t.status !== 'Completed' && t.status !== 'Cancelled' && t.departureDate && t.departureDate > today)
    .sort((a, b) => (a.departureDate ?? '').localeCompare(b.departureDate ?? ''))[0] ?? null
}

export function tripSlug(trip: Trip): string {
  return trip.id.replace(/-/g, '')
}

/** Whole days from `today` until departure. Negative once the trip has begun. */
export function daysUntil(dateStr: string, today: string): number {
  const a = Date.parse(`${today}T00:00:00Z`)
  const b = Date.parse(`${dateStr}T00:00:00Z`)
  if (Number.isNaN(a) || Number.isNaN(b)) return 0
  return Math.round((b - a) / 86400000)
}
