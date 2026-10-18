import type { Client } from '@notionhq/client'
import { parseTripItem, TRIP_ITEMS_DATABASE_ID } from './notion'
import type { TripItem } from './types'

/**
 * Status changes from the Plan tab. Server only.
 *
 * Her own click is her word, so this is the one place a Trip Item may be moved
 * UP to Assigned / Reservation Pending / Confirmed without a chat turn. It
 * enforces the same status tree the trip skills follow (/notion-new-trip Step
 * 4), so the map cannot write a row the itinerary would then lose:
 *   - Assigned, Reservation Pending and Confirmed all need `Assigned to Date`;
 *   - Confirmed sets `Reservation Made`, and a hotel needs its checkout date;
 *   - back to Shortlisted / Researching clears BOTH date fields (one stray
 *     legacy `Date` kept Vienna out of leg mode on 2026-09-07);
 *   - Drop is `Cancelled`. Nothing is ever deleted.
 */

export const EDITABLE_STATUSES = ['Researching', 'Shortlisted', 'Assigned', 'Reservation Pending', 'Confirmed', 'Cancelled'] as const
export type EditableStatus = typeof EDITABLE_STATUSES[number]
const DATED = new Set<string>(['Assigned', 'Reservation Pending', 'Confirmed'])
const UNDATED = new Set<string>(['Researching', 'Shortlisted'])
const MAX_TEXT = 2000

export class StatusInputError extends Error {}

export interface StatusChange {
  status: EditableStatus
  date?: string
  /** Hotels: the checkout day, exclusive, like every hotel row in Trip Items. */
  endDate?: string
  time?: string
  confirmationNumber?: string
  bookedVia?: string
}

const isDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)

function optionalText(body: any, key: string): string | undefined {
  const v = body?.[key]
  if (v === undefined || v === null) return undefined
  if (typeof v !== 'string') throw new StatusInputError(`${key} must be text`)
  if (v.length > MAX_TEXT) throw new StatusInputError(`${key} is too long`)
  return v.trim()
}

export function parseStatusChange(body: any): StatusChange {
  const status = body?.status
  if (!EDITABLE_STATUSES.includes(status)) throw new StatusInputError('Unknown status')
  const change: StatusChange = { status }
  if (DATED.has(status)) {
    if (!isDay(body.date)) throw new StatusInputError(`${status} needs a day`)
    change.date = body.date
    if (body.endDate !== undefined && body.endDate !== null && body.endDate !== '') {
      if (!isDay(body.endDate) || body.endDate <= body.date) throw new StatusInputError('Checkout must be after check-in')
      change.endDate = body.endDate
    }
  }
  change.time = optionalText(body, 'time')
  change.confirmationNumber = optionalText(body, 'confirmationNumber')
  change.bookedVia = optionalText(body, 'bookedVia')
  return change
}

const bare = (id: string) => id.replace(/-/g, '')

export interface TripItemPage {
  page: any
  tripId: string | null
}

/** The page, only if it is a row of Trip Items. Anything else is refused. */
export async function tripItemPage(notion: Client, pageId: string): Promise<TripItemPage | null> {
  if (!/^[0-9a-f]{32}$/.test(bare(pageId))) return null
  let page: any
  try {
    page = await notion.pages.retrieve({ page_id: pageId })
  } catch {
    return null
  }
  if (bare(page?.parent?.database_id ?? '') !== bare(TRIP_ITEMS_DATABASE_ID)) return null
  return { page, tripId: page.properties?.['Trip']?.relation?.[0]?.id ?? null }
}

function richText(text: string) {
  return text ? [{ type: 'text', text: { content: text.slice(0, MAX_TEXT) } }] : []
}

/** Existing Notes runs kept as they are, with one stamp line added. */
function stampedNotes(page: any, stamp: string) {
  const runs: any[] = page.properties?.['Notes']?.rich_text ?? []
  const kept = runs.map(r => ({
    type: 'text',
    text: { content: r.plain_text, link: r.href ? { url: r.href } : null },
    annotations: r.annotations,
  }))
  const lead = runs.length ? '\n' : ''
  return [...kept, { type: 'text', text: { content: `${lead}${stamp}` } }]
}

export async function applyStatusChange(
  notion: Client,
  target: TripItemPage,
  change: StatusChange,
  trip: { departureDate: string | null; returnDate: string | null } | null,
  today: string,
): Promise<TripItem> {
  const { page } = target
  const isHotel = page.properties?.['Type']?.select?.name === 'Hotel'

  if (change.date && trip?.departureDate) {
    const last = trip.returnDate ?? trip.departureDate
    if (change.date < trip.departureDate || change.date > last) {
      throw new StatusInputError(`Pick a day inside the trip (${trip.departureDate} to ${last})`)
    }
  }
  if (change.status === 'Confirmed' && isHotel && !change.endDate) {
    throw new StatusInputError('A booked hotel needs its checkout day')
  }

  const properties: Record<string, any> = {
    Status: { select: { name: change.status } },
  }
  if (DATED.has(change.status)) {
    properties['Assigned to Date'] = { date: { start: change.date, ...(change.endDate ? { end: change.endDate } : {}) } }
  } else if (UNDATED.has(change.status)) {
    // A time belongs to a day; with the day gone it would float. Confirmation #
    // and Booked Via stay: they are facts about a booking, not about the plan.
    properties['Assigned to Date'] = { date: null }
    properties['Date'] = { date: null }
    properties['Time'] = { rich_text: [] }
  }
  if (change.status === 'Confirmed') properties['Reservation Made'] = { checkbox: true }
  else if (change.status !== 'Cancelled') properties['Reservation Made'] = { checkbox: false }
  if (change.time !== undefined && DATED.has(change.status)) properties['Time'] = { rich_text: richText(change.time) }
  if (change.confirmationNumber !== undefined) properties['Confirmation #'] = { rich_text: richText(change.confirmationNumber) }
  if (change.bookedVia !== undefined) properties['Booked Via'] = { rich_text: richText(change.bookedVia) }

  const label = change.status === 'Cancelled' ? 'dropped' : `set to ${change.status}`
  const when = change.date ? ` for ${change.date}${change.endDate ? ` to ${change.endDate}` : ''}` : ''
  properties['Notes'] = { rich_text: stampedNotes(page, `[map ${today}] ${label}${when}`) }

  await notion.pages.update({ page_id: page.id, properties })

  // A 200 says Notion took the request, not that the row now agrees with
  // itself. Re-read through the same parser the page uses and check.
  const after: any = await notion.pages.retrieve({ page_id: page.id })
  const item = parseTripItem(after, page.url)
  const datesOk = DATED.has(change.status)
    ? item.assignedToDate === change.date && (item.assignedToDateEnd ?? undefined) === change.endDate
    : UNDATED.has(change.status)
      ? item.assignedToDate === null && item.date === null
      : true
  if (item.status !== change.status || !datesOk) {
    throw new Error(`Read-back mismatch: status ${item.status}, date ${item.assignedToDate}`)
  }
  return item
}
