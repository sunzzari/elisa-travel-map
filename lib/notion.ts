import { Client } from '@notionhq/client'
import type { Trip, TripItem, ItemType, ItemPriority, ItemStatus, TripStatus, TripLeg, TripTask, Loaded } from './types'
import { readSavedPin } from './saved-pins'

const notion = new Client({ auth: process.env.NOTION_TOKEN })

const TRAVEL_PLANNING_DB = '72792a7e-eb9e-468a-a376-fd1e7284401c'
const TRIP_ITEMS_DB = '9947ef07-3483-472b-b452-f2ebc23edabe'
const TRIP_LEGS_DB = 'fee283c0-9ee7-46ff-8758-fbc58fba496d'
// REST database ids, not the MCP data-source ids in STRUCTURE.md (the two differ).
const MASTER_PROJECTS_DB = '763924d2-f70a-4249-b058-8f9a2c2989be'
const CENTRAL_TASKS_DB = '8a4e5b6d-8645-4cf3-bf25-fb806d88bc4a'

export const TRIP_ITEMS_DATABASE_ID = TRIP_ITEMS_DB

function getCheckbox(prop: any): boolean {
  if (!prop) return false
  if (prop.type === 'checkbox') return prop.checkbox ?? false
  return false
}

function getText(prop: any): string {
  if (!prop) return ''
  if (prop.type === 'title') return prop.title?.map((t: any) => t.plain_text).join('') ?? ''
  if (prop.type === 'rich_text') return prop.rich_text?.map((t: any) => t.plain_text).join('') ?? ''
  if (prop.type === 'select') return prop.select?.name ?? ''
  if (prop.type === 'date') return prop.date?.start ?? ''
  return ''
}

function getDateStart(prop: any): string | null {
  return prop?.type === 'date' ? prop.date?.start ?? null : null
}

function getDateEnd(prop: any): string | null {
  return prop?.type === 'date' ? prop.date?.end ?? null : null
}

/** One Trip Items page. The list reads and the write read-back share it, so they cannot disagree. */
export function parseTripItem(page: any, tripUrl: string): TripItem {
  const saved = readSavedPin(page.properties)
  return {
    id: page.id,
    url: page.url,
    name: getText(page.properties['Name']),
    type: (getText(page.properties['Type']) as ItemType) || null,
    priority: (getText(page.properties['Priority']) as ItemPriority) || null,
    status: (getText(page.properties['Status']) as ItemStatus) || null,
    legCity: getText(page.properties['Leg / City']),
    venue: getText(page.properties['Provider / Venue']),
    notes: getText(page.properties['Notes']),
    tripUrl,
    date: getDateStart(page.properties['Date']),
    dateEnd: getDateEnd(page.properties['Date']),
    assignedToDate: getDateStart(page.properties['Assigned to Date']),
    assignedToDateEnd: getDateEnd(page.properties['Assigned to Date']),
    timeText: getText(page.properties['Time']),
    address: getText(page.properties['Address']),
    confirmationNumber: getText(page.properties['Confirmation #']),
    bookedVia: getText(page.properties['Booked Via']),
    reservationRequired: getCheckbox(page.properties['Reservation Required']),
    reservationMade: getCheckbox(page.properties['Reservation Made']),
    // A saved pin is the item's location; geocodeItem only fills the rest.
    ...(saved.coordinates ? { coordinates: saved.coordinates } : {}),
    ...(saved.branches.length ? { branches: saved.branches } : {}),
  }
}

export async function fetchAllTrips(): Promise<Trip[]> {
  const response = await notion.databases.query({
    database_id: TRAVEL_PLANNING_DB,
    sorts: [{ property: 'Departure Date', direction: 'descending' }],
  })

  return response.results.map((page: any) => ({
    id: page.id,
    url: page.url,
    name: getText(page.properties['Trip Name']),
    location: getText(page.properties['Location']),
    departureDate: page.properties['Departure Date']?.date?.start ?? null,
    returnDate: page.properties['Return Date']?.date?.start ?? null,
    status: (getText(page.properties['Trip Status']) as TripStatus) || null,
    coverImage: page.properties['Cover Image']?.url ?? page.cover?.external?.url ?? page.cover?.file?.url ?? null,
    timeZone: getText(page.properties['Time Zone']),
  }))
}

export async function fetchTripItems(tripId: string): Promise<TripItem[]> {
  const allItems: TripItem[] = []
  let cursor: string | undefined
  const normalizedTripId = tripId.replace(/-/g, '')

  do {
    const response: any = await notion.databases.query({
      database_id: TRIP_ITEMS_DB,
      start_cursor: cursor,
      page_size: 100,
    })

    for (const page of response.results as any[]) {
      const tripRelation: any[] = page.properties['Trip']?.relation ?? []
      const linkedTripId = tripRelation[0]?.id

      if (!linkedTripId) continue
      if (linkedTripId.replace(/-/g, '') !== normalizedTripId) continue

      allItems.push(parseTripItem(page, page.url))
    }

    cursor = response.next_cursor ?? undefined
  } while (cursor)

  return allItems
}

export async function fetchTripLegCount(tripId: string): Promise<number> {
  const response: any = await notion.databases.query({
    database_id: TRIP_LEGS_DB,
    filter: {
      property: 'Trip',
      relation: { contains: tripId },
    },
  })
  return response.results.length
}

export async function fetchAllTripItems(): Promise<TripItem[]> {
  const allItems: TripItem[] = []
  let cursor: string | undefined

  do {
    const response: any = await notion.databases.query({
      database_id: TRIP_ITEMS_DB,
      start_cursor: cursor,
      page_size: 100,
    })

    for (const page of response.results as any[]) {
      const tripRelation: any[] = page.properties['Trip']?.relation ?? []
      if (tripRelation.length === 0) continue

      allItems.push(parseTripItem(page, `https://www.notion.so/${tripRelation[0].id.replace(/-/g, '')}`))
    }

    cursor = response.next_cursor ?? undefined
  } while (cursor)

  return allItems
}

function failure(what: string, err: unknown): { ok: false; error: string } {
  console.error(`[notion] ${what} failed:`, err)
  return { ok: false, error: `Could not load ${what} from Notion` }
}

/** The trip's legs, in order. Read only: legs are fixed at trip start. */
export async function fetchTripLegs(tripId: string): Promise<Loaded<TripLeg[]>> {
  try {
    const response: any = await notion.databases.query({
      database_id: TRIP_LEGS_DB,
      filter: { property: 'Trip', relation: { contains: tripId } },
      sorts: [{ property: 'Leg Order', direction: 'ascending' }],
    })
    return {
      ok: true,
      value: response.results.map((page: any) => ({
        id: page.id,
        name: getText(page.properties['Leg Name']),
        order: page.properties['Leg Order']?.number ?? null,
        startDate: getDateStart(page.properties['Start Date']),
        endDate: getDateStart(page.properties['End Date']),
        nights: page.properties['Nights']?.number ?? null,
      })),
    }
  } catch (err) {
    return failure('the legs', err)
  }
}

/**
 * Open Central Tasks for the trip: Master Project whose `Linked Trip` is this
 * trip, then its tasks that are not Done. These are her tasks, written only
 * under the booking-task gate, so they are the To-do and nothing inferred is.
 */
export async function fetchTripTasks(tripId: string): Promise<Loaded<TripTask[]>> {
  try {
    const projects: any = await notion.databases.query({
      database_id: MASTER_PROJECTS_DB,
      filter: { property: 'Linked Trip', relation: { contains: tripId } },
    })
    const tasks: TripTask[] = []
    for (const project of projects.results as any[]) {
      let cursor: string | undefined
      do {
        const response: any = await notion.databases.query({
          database_id: CENTRAL_TASKS_DB,
          start_cursor: cursor,
          filter: {
            and: [
              { property: 'Linked Project', relation: { contains: project.id } },
              { property: 'Work Status', select: { does_not_equal: 'Done' } },
            ],
          },
        })
        for (const page of response.results as any[]) {
          tasks.push({
            id: page.id,
            url: page.url,
            title: getText(page.properties['Task Title']),
            workStatus: getText(page.properties['Work Status']),
            dueDate: getDateStart(page.properties['Due Date']),
            targetDate: getDateStart(page.properties['Target Date']),
          })
        }
        cursor = response.next_cursor ?? undefined
      } while (cursor)
    }
    tasks.sort((a, b) => (a.dueDate ?? a.targetDate ?? '9999').localeCompare(b.dueDate ?? b.targetDate ?? '9999'))
    return { ok: true, value: tasks }
  } catch (err) {
    return failure('the trip tasks', err)
  }
}
