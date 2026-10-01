import { Client } from '@notionhq/client'
import { geocodeVenue } from './geocode'
import { readSavedPin } from './saved-pins'
import type { SavedPin } from './saved-pins'
import type { TripItem } from './types'
import {
  regionFromText,
  regionFromCoords,
  colorFor,
} from './aroundtown-shared'
import type {
  AroundTownKind,
  AroundTownRegion,
  AroundTownMeta,
  AroundTownData,
} from './aroundtown-shared'

export type { AroundTownKind, AroundTownRegion, AroundTownMeta, AroundTownData }

/**
 * AROUND TOWN - the LA and SF Bay places, on the same map as the trips.
 *
 * Deliberately returns `TripItem`s rather than a type of its own. The map, the
 * clusterer, the InfoWindow and the not-on-the-map list all speak TripItem, and
 * an Around Town place is the same kind of thing: a name, a pin, a note. The
 * iOS app made the opposite choice and ended up with three hand-copied maps,
 * where a tapped cluster did nothing on two of them. Everything Around Town
 * needs on top of a TripItem - how much she liked it, whether we have been -
 * rides alongside in `meta`, keyed by id.
 *
 * Dates are always null. An Around Town place is never assigned to a day.
 */

const notion = new Client({ auth: process.env.NOTION_TOKEN })

// Resolved live 2026-09-14. The Restaurant Guide id in STRUCTURE.md is the
// PAGE id and a `databases.retrieve` on it fails; this is the database.
const RESTAURANT_GUIDE_DB = '9078462d-842a-4233-82d9-dbd07014782b'
const ACTIVITIES_DB = 'ca04eea9-94f9-4be5-a075-5e509d236ccb'

// MARK: - Geocoder inputs, same shape as the phone

const CITY_BY_LOCATION: Record<string, string> = {
  la: 'Los Angeles, CA',
  sf: 'San Francisco, CA',
  oc: 'Orange County, CA',
  'san diego': 'San Diego, CA',
  napa: 'Napa, CA',
  marin: 'Marin County, CA',
  'east bay': 'Oakland, CA',
}

function metroHint(locationText: string): string {
  return regionFromText(locationText) === 'sfBay'
    ? 'San Francisco Bay Area, CA'
    : 'Los Angeles, CA'
}

/**
 * Notion's coarse Location select mapped to a real city. Using the metro
 * instead sent every San Diego and Napa row to Los Angeles, where the lookup
 * found nothing and fell back to a city centre.
 */
function locationCity(locationText: string): string {
  const first = (locationText.split('/')[0] ?? '').trim().toLowerCase()
  return CITY_BY_LOCATION[first] ?? metroHint(locationText)
}

// MARK: - Notion readers (same helpers as lib/notion.ts)

function getText(prop: any): string {
  if (!prop) return ''
  if (prop.type === 'title') return prop.title?.map((t: any) => t.plain_text).join('') ?? ''
  if (prop.type === 'rich_text') return prop.rich_text?.map((t: any) => t.plain_text).join('') ?? ''
  if (prop.type === 'select') return prop.select?.name ?? ''
  return ''
}

function getCheckbox(prop: any): boolean {
  return prop?.type === 'checkbox' ? prop.checkbox ?? false : false
}

function getMultiSelect(prop: any): string[] {
  return prop?.type === 'multi_select' ? prop.multi_select.map((o: any) => o.name) : []
}

async function queryAll(databaseId: string): Promise<any[]> {
  const out: any[] = []
  let cursor: string | undefined
  do {
    const res: any = await notion.databases.query({
      database_id: databaseId,
      start_cursor: cursor,
      page_size: 100,
    })
    out.push(...res.results)
    cursor = res.next_cursor ?? undefined
  } while (cursor)
  return out
}

// MARK: - Build

interface Raw {
  id: string
  url: string
  name: string
  kind: AroundTownKind
  region: AroundTownRegion | null
  neighborhood: string
  locationText: string
  preference: string | null
  goodFor: string[]
  topDishes: string
  comments: string
  thinkingAbout: boolean
  done: boolean
  address: string
  saved: SavedPin
}

function rawRestaurants(pages: any[]): Raw[] {
  const out: Raw[] = []
  for (const page of pages) {
    const p = page.properties
    const name = getText(p['Name'])
    if (!name) continue
    const locationText = getText(p['Location'])
    const neighborhood = getText(p['Neighborhood'])
    const region = regionFromText(locationText)
    // A blank Location is still a candidate IF the neighborhood itself reads as
    // LA or the Bay ("Rokusho", blank Location, Neighborhood "Hollywood"). It is
    // not a candidate just because a neighborhood exists: 11 rows carry a blank
    // Location and a Chengdu or Shanghai neighborhood, and admitting those put
    // eleven Chinese restaurants in the LA not-on-the-map list. Same rule as the
    // phone.
    const neighborhoodRegion = locationText === '' ? regionFromText(neighborhood) : null
    if (region === null && neighborhoodRegion === null) continue
    const preference = getText(p['Preference']) || null
    out.push({
      id: page.id,
      url: page.url,
      name,
      kind: 'restaurant',
      region: region ?? neighborhoodRegion,
      neighborhood,
      locationText,
      preference,
      goodFor: getMultiSelect(p['Good For']),
      topDishes: getText(p['Top Dishes']),
      comments: getText(p['Comments']),
      thinkingAbout: getCheckbox(p['Thinking About']),
      done: getCheckbox(p['Been There?']),
      address: getText(p['Address']),
      saved: readSavedPin(p),
    })
  }
  return out
}

function rawActivities(pages: any[]): Raw[] {
  const out: Raw[] = []
  for (const page of pages) {
    const p = page.properties
    const name = getText(p['Name'])
    if (!name) continue
    const locationText = getText(p['Location'])
    const region = regionFromText(locationText)
    // A blank location is still a candidate; the geocode is validated against
    // the two boxes, so "Sushi making" is counted as having no map location
    // rather than disappearing.
    if (region === null && locationText !== '') continue
    out.push({
      id: page.id,
      url: page.url,
      name,
      kind: 'activity',
      region,
      neighborhood: '',
      locationText,
      preference: null,
      goodFor: [],
      topDishes: '',
      comments: '',
      thinkingAbout: getCheckbox(p['Thinking About']),
      done: getCheckbox(p['Done?']),
      address: getText(p['Address']),
      saved: readSavedPin(p),
    })
  }
  return out
}

/** Restaurants get neighborhood plus city; activities carry their own text. */
function geoCity(raw: Raw): string {
  if (raw.kind === 'activity') {
    return raw.locationText || metroHint(raw.locationText)
  }
  const city = locationCity(raw.locationText)
  const hood = raw.neighborhood
  return !hood || hood === raw.locationText ? city : `${hood}, ${city}`
}

/** Second attempt, without the neighborhood. Some rows only resolve that way. */
function geoCityFallback(raw: Raw): string {
  return raw.kind === 'restaurant'
    ? locationCity(raw.locationText)
    : metroHint(raw.locationText)
}

export async function fetchAroundTown(): Promise<AroundTownData> {
  const [restaurantPages, activityPages] = await Promise.all([
    queryAll(RESTAURANT_GUIDE_DB),
    queryAll(ACTIVITIES_DB),
  ])

  const raws = [...rawRestaurants(restaurantPages), ...rawActivities(activityPages)]

  const items: TripItem[] = []
  const meta: Record<string, AroundTownMeta> = {}

  for (const raw of raws) {
    // The fallback drops the neighborhood. For most activities that produces
    // the SAME string as the first attempt, so asking twice is one wasted
    // request per row and no new information.
    // The pin saved in Notion wins (free sources, area-checked when saved).
    // The saved table is only a fallback for rows that have none; neither is
    // a network call.
    const primary = geoCity(raw)
    const fallback = geoCityFallback(raw)
    let coords = raw.saved.coordinates ?? await geocodeVenue(raw.name, primary)
    if (!coords && fallback !== primary) {
      coords = await geocodeVenue(raw.name, fallback)
    }

    // A coordinate outside LA and the Bay is a bad lookup, not a place. It is
    // dropped to no-coordinate, which puts the row in the not-on-the-map list
    // rather than on a pin that lies.
    const placedRegion = coords ? regionFromCoords(coords.lat, coords.lng) : null
    const usable = placedRegion ? coords : null

    meta[raw.id] = {
      kind: raw.kind,
      region: placedRegion ?? raw.region,
      neighborhood: raw.neighborhood,
      locationText: raw.locationText,
      preference: raw.preference,
      goodFor: raw.goodFor,
      topDishes: raw.topDishes,
      comments: raw.comments,
      thinkingAbout: raw.thinkingAbout,
      done: raw.done,
      address: raw.address,
      color: colorFor(raw),
    }

    items.push({
      id: raw.id,
      url: raw.url,
      name: raw.name,
      type: raw.kind === 'restaurant' ? 'Restaurant' : 'Activity',
      priority: null,
      // Status drives pin colour on a trip. Around Town colours by preference,
      // so this stays empty rather than borrowing a trip word.
      status: null,
      legCity: raw.neighborhood || raw.locationText,
      venue: '',
      notes: [raw.topDishes, raw.comments].filter(Boolean).join(' - '),
      tripUrl: raw.url,
      date: null,
      dateEnd: null,
      assignedToDate: null,
      assignedToDateEnd: null,
      timeText: '',
      address: raw.address || raw.locationText,
      confirmationNumber: '',
      bookedVia: '',
      reservationRequired: false,
      reservationMade: false,
      coordinates: usable ?? undefined,
      // Every branch of a chain gets a pin (Elisa, 2026-09-30), with the same
      // reject as the main pin.
      ...(usable && raw.saved.branches.length
        ? { branches: raw.saved.branches.filter(b => regionFromCoords(b.lat, b.lng) !== null) }
        : {}),
    })
  }

  return { items, meta }
}
