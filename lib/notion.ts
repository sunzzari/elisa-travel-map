import { Client } from '@notionhq/client'
import type { Trip, TripItem, TripNewsletter, ItemType, ItemPriority, ItemStatus, TripStatus } from './types'

const notion = new Client({ auth: process.env.NOTION_TOKEN })

const TRAVEL_PLANNING_DB = '72792a7e-eb9e-468a-a376-fd1e7284401c'
const TRIP_ITEMS_DB = '9947ef07-3483-472b-b452-f2ebc23edabe'
const TRIP_LEGS_DB = 'fee283c0-9ee7-46ff-8758-fbc58fba496d'
const TRIP_NEWSLETTERS_DB = 'ecb29b52-040e-4765-aa39-a12f22b25472'

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

      allItems.push({
        id: page.id,
        url: page.url,
        name: getText(page.properties['Name']),
        type: (getText(page.properties['Type']) as ItemType) || null,
        priority: (getText(page.properties['Priority']) as ItemPriority) || null,
        status: (getText(page.properties['Status']) as ItemStatus) || null,
        legCity: getText(page.properties['Leg / City']),
        venue: getText(page.properties['Provider / Venue']),
        notes: getText(page.properties['Notes']),
        tripUrl: page.url,
        date: getDateStart(page.properties['Date']),
        dateEnd: getDateEnd(page.properties['Date']),
        assignedToDate: getDateStart(page.properties['Assigned to Date']),
        assignedToDateEnd: getDateEnd(page.properties['Assigned to Date']),
        reservationRequired: getCheckbox(page.properties['Reservation Required']),
      })
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

      allItems.push({
        id: page.id,
        url: page.url,
        name: getText(page.properties['Name']),
        type: (getText(page.properties['Type']) as ItemType) || null,
        priority: (getText(page.properties['Priority']) as ItemPriority) || null,
        status: (getText(page.properties['Status']) as ItemStatus) || null,
        legCity: getText(page.properties['Leg / City']),
        venue: getText(page.properties['Provider / Venue']),
        notes: getText(page.properties['Notes']),
        tripUrl: `https://www.notion.so/${tripRelation[0].id.replace(/-/g, '')}`,
        date: getDateStart(page.properties['Date']),
        dateEnd: getDateEnd(page.properties['Date']),
        assignedToDate: getDateStart(page.properties['Assigned to Date']),
        assignedToDateEnd: getDateEnd(page.properties['Assigned to Date']),
        reservationRequired: getCheckbox(page.properties['Reservation Required']),
      })
    }

    cursor = response.next_cursor ?? undefined
  } while (cursor)

  return allItems
}

async function fetchPageProse(pageId: string): Promise<string> {
  const response: any = await notion.blocks.children.list({
    block_id: pageId,
    page_size: 100,
  })

  return response.results
    .filter((block: any) => block.type === 'paragraph')
    .map((block: any) => block.paragraph?.rich_text?.map((t: any) => t.plain_text).join('') ?? '')
    .filter(Boolean)
    .join('\n\n')
}

export async function fetchTripNewsletters(tripId: string): Promise<TripNewsletter[]> {
  const response: any = await notion.databases.query({
    database_id: TRIP_NEWSLETTERS_DB,
    page_size: 100,
    filter: {
      property: 'Trip',
      relation: { contains: tripId },
    },
    sorts: [{ property: 'Date', direction: 'ascending' }],
  })

  const newsletters = await Promise.all(
    response.results.map(async (page: any): Promise<TripNewsletter> => ({
      id: page.id,
      tripId,
      date: getDateStart(page.properties['Date']) ?? '',
      prose: await fetchPageProse(page.id),
      generatedAt: getDateStart(page.properties['Generated At']),
      stale: getCheckbox(page.properties['Stale']),
      itemsHash: getText(page.properties['Items Hash']),
    }))
  )

  return newsletters.filter(newsletter => newsletter.date)
}
