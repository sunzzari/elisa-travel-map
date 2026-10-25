import { Client } from '@notionhq/client'
import { geocodeVenue } from './geocode'
import { readSavedPin, pinProperties } from './saved-pins'
import { regionFromRowText } from './place-areas'
import { areaFor, areaForRegion, pinAddress } from './place-lookup'
import type { SavedPin } from './saved-pins'
import type { TripItem } from './types'
import {
  regionFromText,
  regionFromCoords,
  colorFor,
  fitAreaContains,
  areaFromText,
  areaFromCoords,
  inAwayArea,
  mapAreas,
  isHomeArea,
} from './aroundtown-shared'
import type {
  AroundTownKind,
  AroundTownRegion,
  AroundTownMeta,
  AroundTownData,
  MapArea,
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
  /** LA, the Bay, or a travel area ("vienna"). */
  region: MapArea | null
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
    // A travel Location ("Vienna") is an area of Elisa's Map; the default
    // answer leaves those out again (`fetchAroundTown`).
    const region = areaFromText(locationText)
    // A blank Location is still a candidate IF the neighborhood itself reads as
    // LA or the Bay ("Rokusho", blank Location, Neighborhood "Hollywood"). It is
    // not a candidate just because a neighborhood exists: 11 rows carry a blank
    // Location and a Chengdu or Shanghai neighborhood, and admitting those put
    // eleven Chinese restaurants in the LA not-on-the-map list. Same rule as the
    // phone.
    //
    // A blank Location whose row names a California city or ZIP is ours too
    // (`regionFromRowText`): "Yu Ji Stone Mill Chinese Crepes", neighborhood
    // "Rowland Heights, CA", was being dropped here and so could not be found.
    const address = getText(p['Address'])
    const neighborhoodRegion = locationText === ''
      ? regionFromText(neighborhood) ?? regionFromRowText(neighborhood, address)
      : null
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
      address,
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
    const region = areaFromText(locationText)
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

// MARK: - Pins for rows added outside the apps

/** Addresses that could not be pinned, so they are not looked up on every read. */
const unpinnable = new Map<string, number>()
const RETRY_AFTER_MS = 24 * 60 * 60 * 1000
/** A read never waits on more than this many lookups; the rest wait for the next read. */
const MAX_PINS_PER_READ = 5

/**
 * Gives a pin to rows that have a street address and no pin, and saves it.
 *
 * Elisa, 2026-09-30: "how are we making sure all places have locations for the
 * future". A place added through the apps is pinned when it is saved. A row
 * typed into Notion, or added by a skill, has an address and nothing else, and
 * stayed off the map until someone tapped Find it.
 *
 * Her own address, the free geocoders (`pinAddress`), and the same area check a
 * save uses: a pin outside the row's LA or Bay box is not saved. A row with no
 * address is never guessed. Once saved the row has a pin and is not looked up
 * again, so a second read does nothing.
 */
async function pinAddressedRows(raws: Raw[]): Promise<void> {
  const now = Date.now()
  // LA and the Bay only: a travel row is pinned when it is saved, or by the
  // sweep, where its own area check runs.
  const waiting = raws.filter(r =>
    r.address.trim() !== '' && !r.saved.coordinates && isHomeArea(r.region) &&
    now - (unpinnable.get(r.id + '|' + r.address) ?? 0) > RETRY_AFTER_MS
  ).slice(0, MAX_PINS_PER_READ)

  for (const raw of waiting) {
    try {
      const area = await areaFor(raw.kind, raw.neighborhood, raw.locationText)
        ?? areaForRegion(raw.kind, raw.region as AroundTownRegion, raw.neighborhood)
      const found = await pinAddress(area, raw.address)
      if (!found) {
        unpinnable.set(raw.id + '|' + raw.address, now)
        continue
      }
      const pin = { lat: found.lat, lng: found.lng }
      await notion.pages.update({ page_id: raw.id, properties: pinProperties(pin) })
      raw.saved = { ...raw.saved, coordinates: pin }
      console.log(`Around Town: pinned "${raw.name}" from its address (${found.source})`)
    } catch (err) {
      // A failed lookup or save leaves the row as it was: listed, with no pin.
      unpinnable.set(raw.id + '|' + raw.address, now)
      console.error(`Around Town: could not pin "${raw.name}":`, err)
    }
  }
}

/**
 * `world` adds every travel area (Elisa's Map). Without it the answer is LA and
 * the Bay only, exactly as before, which is what phones on an older build read.
 */
export async function fetchAroundTown(opts: { world?: boolean } = {}): Promise<AroundTownData> {
  const [restaurantPages, activityPages] = await Promise.all([
    queryAll(RESTAURANT_GUIDE_DB),
    queryAll(ACTIVITIES_DB),
  ])

  const raws = [...rawRestaurants(restaurantPages), ...rawActivities(activityPages)]
    .filter(r => opts.world || r.region === null || isHomeArea(r.region))
  await pinAddressedRows(raws)

  const items: TripItem[] = []
  const meta: Record<string, AroundTownMeta> = {}

  for (const raw of raws) {
    // The fallback drops the neighborhood. For most activities that produces
    // the SAME string as the first attempt, so asking twice is one wasted
    // request per row and no new information.
    // The pin saved in Notion wins (free sources, area-checked when saved).
    // The saved table is only a fallback for rows that have none; neither is
    // a network call.
    // A travel row uses its saved pin only: the table and the venue lookup
    // are LA and Bay sources, and asked about "Demel" they would answer in LA.
    const away = raw.region !== null && !isHomeArea(raw.region)
    const primary = geoCity(raw)
    const fallback = geoCityFallback(raw)
    let coords = raw.saved.coordinates ?? (away ? null : await geocodeVenue(raw.name, primary))
    if (!coords && !away && fallback !== primary) {
      coords = await geocodeVenue(raw.name, fallback)
    }

    // A coordinate outside its area is a bad lookup, not a place. It is
    // dropped to no-coordinate, which puts the row in the not-on-the-map list
    // rather than on a pin that lies. LA and the Bay by their boxes; a travel
    // row by its own area's reach.
    const placedRegion = !coords ? null
      : away ? (inAwayArea(raw.region!, coords.lat, coords.lng) ? raw.region : null)
      : regionFromCoords(coords.lat, coords.lng)
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
        ? { branches: raw.saved.branches.filter(b => areaFromCoords(b.lat, b.lng) !== null) }
        : {}),
    })
  }

  return { items, meta }
}

// Which area's "fit all" frame a pin belongs to (LA proper, the Bay, or a
// travel area), or null for a pin that stays on the map but never stretches the
// frame (San Diego).
const fitArea = (c: { lat: number; lng: number }): MapArea | null => {
  if (fitAreaContains('la', c.lat, c.lng)) return 'la'
  if (fitAreaContains('sfBay', c.lat, c.lng)) return 'sfBay'
  const area = areaFromCoords(c.lat, c.lng)
  return area && !isHomeArea(area) ? area : null
}

/**
 * Around Town as the Sunzzari app reads it: the same places, pins, branches,
 * colours and areas the /around-town page draws, flattened to one list. Built
 * here once so the cached route and the live route cannot answer differently.
 */
export async function aroundTownPlaces(opts: { world?: boolean } = {}) {
  const { items, meta } = await fetchAroundTown(opts)
  const places = items.map(item => {
    const m = meta[item.id]
    const c = item.coordinates
    return {
      id: item.id,
      url: item.url,
      name: item.name,
      kind: m.kind,
      region: m.region,
      neighborhood: m.neighborhood,
      location: m.locationText,
      preference: m.preference,
      goodFor: m.goodFor,
      topDishes: m.topDishes,
      comments: m.comments,
      wantToTry: m.thinkingAbout,
      beenThere: m.done,
      address: m.address,
      color: m.color,
      // The colour before "been there" greys it (Want to Try or Haven't Tried),
      // so the phone can un-grey a place the moment she unticks it.
      baseColor: colorFor({ ...m, done: false }),
      lat: c?.lat ?? null,
      lng: c?.lng ?? null,
      fitArea: c ? fitArea(c) : null,
      // `region` is the wide area (LA includes Orange County and San Diego),
      // which is what a search frames; `fitArea` is LA proper.
      branches: (item.branches ?? []).map(b => ({
        address: b.address, lat: b.lat, lng: b.lng, fitArea: fitArea(b),
        region: opts.world ? areaFromCoords(b.lat, b.lng) : regionFromCoords(b.lat, b.lng),
      })),
    }
  })
  if (!opts.world) return { generatedAt: new Date().toISOString(), places }
  return { generatedAt: new Date().toISOString(), places, areas: mapAreas(places) }
}
