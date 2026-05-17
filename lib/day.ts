import type { DayBundle, TripItem, TripNewsletter } from './types'

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

export function newsletterMap(newsletters: TripNewsletter[]): Record<string, TripNewsletter> {
  return Object.fromEntries(newsletters.map(newsletter => [newsletter.date, newsletter]))
}

export function newsletterProse(day: DayBundle, newslettersByDate: Record<string, TripNewsletter>): string | null {
  const prose = newslettersByDate[day.dateString]?.prose.trim()
  return prose || null
}

export function poolDisplayItems(day: DayBundle, prose: string | null): TripItem[] {
  const confirmedNames = new Set(day.confirmed.map(item => item.name.toLowerCase()))
  const confirmedIds = new Set(day.confirmed.map(item => item.id))
  const basePool = day.possibilities.filter(item =>
    !confirmedIds.has(item.id) &&
    !confirmedNames.has(item.name.toLowerCase())
  )
  if (!prose) return basePool
  return basePool.filter(item => item.name && prose.toLowerCase().includes(item.name.toLowerCase()))
}

export function displayItemsForDay(day: DayBundle, newslettersByDate: Record<string, TripNewsletter>): TripItem[] {
  const prose = newsletterProse(day, newslettersByDate)
  return [...day.confirmed, ...poolDisplayItems(day, prose)]
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
