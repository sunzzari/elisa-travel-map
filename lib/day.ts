import type { DayBundle, TripItem } from './types'
import { parseTime, type ParsedTime } from './time'

const TYPE_ORDER: Record<string, number> = {
  Hotel: 0,
  Restaurant: 1,
  Activity: 2,
  Flight: 3,
  Train: 4,
  Ferry: 5,
  'Car Rental': 6,
  Other: 7,
}

function displayDate(item: TripItem): string | null {
  return item.assignedToDate ?? item.date
}

function displayDateEnd(item: TripItem): string | null {
  return item.assignedToDateEnd ?? item.dateEnd
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setUTCDate(next.getUTCDate() + days)
  return next
}

function parseDateOnly(dateStr: string): Date | null {
  const [year, month, day] = dateStr.split('-').map(Number)
  if (!year || !month || !day) return null
  return new Date(Date.UTC(year, month - 1, day))
}

function formatDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function expandedDates(item: TripItem): string[] {
  const start = displayDate(item)
  if (!start) return []

  const end = displayDateEnd(item)
  if (item.type === 'Hotel' && end) {
    const startDate = parseDateOnly(start)
    const endDate = parseDateOnly(end)
    if (startDate && endDate && endDate > startDate) {
      const dates: string[] = []
      for (let cursor = startDate; cursor < endDate; cursor = addDays(cursor, 1)) {
        dates.push(formatDateOnly(cursor))
      }
      return dates
    }
  }

  return [start]
}

function itemSort(a: TripItem, b: TripItem): number {
  const typeDiff = (TYPE_ORDER[a.type ?? ''] ?? 99) - (TYPE_ORDER[b.type ?? ''] ?? 99)
  if (typeDiff !== 0) return typeDiff
  return a.name.localeCompare(b.name)
}

export function groupDays(items: TripItem[]): DayBundle[] {
  const confirmedByDate = new Map<string, TripItem[]>()
  const possibilitiesByDate = new Map<string, TripItem[]>()
  const legCitiesByDate = new Map<string, Set<string>>()

  for (const item of items) {
    if (!item.status || item.status === 'Cancelled') continue
    const dates = expandedDates(item)
    if (dates.length === 0) continue

    for (const date of dates) {
      if (item.legCity) {
        const cities = legCitiesByDate.get(date) ?? new Set<string>()
        cities.add(item.legCity)
        legCitiesByDate.set(date, cities)
      }
    }

    const target = item.status === 'Confirmed' ? confirmedByDate : possibilitiesByDate
    for (const date of dates) {
      const list = target.get(date) ?? []
      list.push(item)
      target.set(date, list)
    }
  }

  const datelessPossibilities = items.filter(item =>
    item.status &&
    item.status !== 'Cancelled' &&
    item.status !== 'Confirmed' &&
    !displayDate(item) &&
    !!item.legCity
  )

  for (const [date, cities] of legCitiesByDate) {
    for (const item of datelessPossibilities) {
      if (!cities.has(item.legCity)) continue
      const list = possibilitiesByDate.get(date) ?? []
      if (!list.some(existing => existing.id === item.id)) list.push(item)
      possibilitiesByDate.set(date, list)
    }
  }

  const allDates = Array.from(new Set([...confirmedByDate.keys(), ...possibilitiesByDate.keys()])).sort()
  return allDates.map(dateString => ({
    id: dateString,
    dateString,
    confirmed: [...(confirmedByDate.get(dateString) ?? [])].sort(itemSort),
    possibilities: [...(possibilitiesByDate.get(dateString) ?? [])].sort(itemSort),
  })).filter(day => day.confirmed.length > 0 || day.possibilities.length > 0)
}

/** Statuses that put an item on the day's timeline rather than in "if you have time". */
export const SCHEDULED_STATUSES = new Set(['Confirmed', 'Assigned', 'Reservation Pending'])

export interface PlannedItem {
  item: TripItem
  time: ParsedTime
}

export interface DayPlan {
  dateString: string
  /** 1-based position in the trip, for "Day 3 of 4". Null when dates are missing. */
  dayNumber: number | null
  totalDays: number | null
  legCity: string
  /** Scheduled items in time order, all-day pinned first. */
  timeline: PlannedItem[]
  /** Scheduled items with no usable time. */
  anytime: PlannedItem[]
  /** Shortlisted / Researching: candidates, not commitments. */
  options: TripItem[]
  /** The hotel covering this night, if one is booked. */
  hotel: TripItem | null
  /** Needs action: reservation required and not made, or still pending. */
  needsBooking: TripItem[]
}

function itemTime(item: TripItem): ParsedTime {
  return parseTime(item.timeText, item.assignedToDate ?? item.date)
}

export function needsBooking(item: TripItem): boolean {
  if (item.status === 'Cancelled') return false
  if (item.status === 'Reservation Pending') return true
  return item.reservationRequired && !item.reservationMade
}

export function planDay(day: DayBundle, allDates: string[]): DayPlan {
  const scheduled = [
    ...day.confirmed,
    ...day.possibilities.filter(i => SCHEDULED_STATUSES.has(i.status ?? '')),
  ].filter((item, index, list) => list.findIndex(c => c.id === item.id) === index)

  const planned = scheduled.map(item => ({ item, time: itemTime(item) }))
  const timeline = planned.filter(p => !p.time.anytime).sort((a, b) => a.time.sortKey - b.time.sortKey)
  const anytime = planned.filter(p => p.time.anytime).sort((a, b) => itemSort(a.item, b.item))

  const scheduledIds = new Set(scheduled.map(i => i.id))
  const options = day.possibilities
    .filter(i => !scheduledIds.has(i.id))
    .filter(i => i.status === 'Shortlisted' || i.status === 'Researching')
    .sort(itemSort)

  const hotel = day.confirmed.find(i => i.type === 'Hotel')
    ?? day.possibilities.find(i => i.type === 'Hotel' && SCHEDULED_STATUSES.has(i.status ?? ''))
    ?? null

  const index = allDates.indexOf(day.dateString)

  return {
    dateString: day.dateString,
    dayNumber: index >= 0 ? index + 1 : null,
    totalDays: allDates.length || null,
    legCity: scheduled[0]?.legCity || day.possibilities[0]?.legCity || '',
    timeline,
    anytime,
    options,
    hotel,
    needsBooking: scheduled.filter(needsBooking),
  }
}

/** Today as yyyy-MM-dd in the viewer's own timezone, which is where they are. */
export function todayString(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

/**
 * The day to open on: today if the trip covers it, otherwise the first day.
 * Deliberately date-based - Park City was live on 2026-09-06 with its Notion
 * Trip Status still reading "Planning", so status cannot be trusted here.
 */
export function pickOpeningDate(days: DayBundle[]): string | null {
  if (days.length === 0) return null
  const today = todayString()
  if (days.some(d => d.dateString === today)) return today
  const upcoming = days.find(d => d.dateString > today)
  return upcoming?.dateString ?? days[days.length - 1].dateString
}

export function dayIntro(day: DayBundle): string {
  if (day.confirmed.length === 0 && day.possibilities.length === 0) return ''
  const weekday = formatLongDate(day.dateString, { weekday: 'long' }).split(',')[0]
  const transit = day.confirmed.find(item => ['Flight', 'Train', 'Ferry', 'Car Rental'].includes(item.type ?? ''))
  if (transit) return `${weekday} is a travel day.`
  const hotel = day.confirmed.find(item => item.type === 'Hotel' && displayDate(item) === day.dateString)
  if (hotel) return `${weekday} you check in at ${hotel.name}${hotel.legCity ? ` in ${hotel.legCity}` : ''}.`
  if (day.confirmed.length === 1) return `${weekday}'s anchor is ${day.confirmed[0].name}.`
  if (day.confirmed.length === 0) return `${weekday} is open. A few candidates if you want to fill it.`
  const leg = day.confirmed[0]?.legCity || day.possibilities[0]?.legCity
  return leg ? `${weekday} in ${leg}.` : `${weekday} on the trip.`
}

export function formatLongDate(dateStr: string, options?: Intl.DateTimeFormatOptions): string {
  const date = parseDateOnly(dateStr)
  if (!date) return dateStr
  return date.toLocaleDateString('en-US', { timeZone: 'UTC', ...(options ?? { weekday: 'long', month: 'long', day: 'numeric' }) })
}

export function formatShortDate(dateStr: string): string {
  const date = parseDateOnly(dateStr)
  if (!date) return dateStr
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}
