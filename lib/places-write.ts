import { Client } from '@notionhq/client'
import { PREFERENCES, RESTAURANT_LOCATIONS } from './aroundtown-shared'
import type { AroundTownKind } from './aroundtown-shared'
import { areaFor, pinAddress, pinInArea } from './place-lookup'
import { pinProperties } from './saved-pins'
import type { Coordinates } from './types'
import type { Caller } from './edit-auth'

/**
 * Around Town writes. Server only. Every page id that comes in from the browser
 * is checked against its parent database before anything is written, so the
 * passcode can never be used to edit an unrelated Notion page.
 */

const serverNotion = new Client({ auth: process.env.NOTION_TOKEN })

/**
 * The Notion client a save runs as. The website (passcode) uses the server's
 * key. The Sunzzari app uses ITS OWN key, so a key that can only read is
 * refused by Notion itself and can never write through this server.
 */
export function notionFor(caller: Caller): Client {
  return caller.via === 'notion' ? new Client({ auth: caller.token }) : serverNotion
}

const RESTAURANT_GUIDE_DB = '9078462d-842a-4233-82d9-dbd07014782b'
const ACTIVITIES_DB = 'ca04eea9-94f9-4be5-a075-5e509d236ccb'

// Notion rejects a single rich-text run over 2000 characters.
const MAX_TEXT = 2000

export interface PlacePatch {
  beenThere?: boolean
  thinkingAbout?: boolean
  preference?: string | null
  comments?: string
  topDishes?: string
  address?: string
  /**
   * The pin for `address`, from a lookup candidate she tapped. Checked against
   * the place's area before it is saved. Absent: the server pins the address
   * itself, or saves it unpinned and it shows under "not on the map".
   */
  pin?: Coordinates
}

/** What a save did about the location, so both apps can say so. */
export interface LocationResult {
  placed: boolean
  pin: Coordinates | null
}

export interface NewPlace extends PlacePatch {
  kind: AroundTownKind
  name: string
  neighborhood?: string
  /** Restaurants: one of RESTAURANT_LOCATIONS. Activities: free text. */
  location?: string
}

export class PlaceInputError extends Error {}

const bare = (id: string) => id.replace(/-/g, '').toLowerCase()

function text(value: string): any {
  const v = value.trim().slice(0, MAX_TEXT)
  return { rich_text: v ? [{ type: 'text', text: { content: v } }] : [] }
}

function str(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new PlaceInputError(`${field} must be text`)
  return value
}

function bool(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw new PlaceInputError(`${field} must be true or false`)
  return value
}

/** Accepts only known fields with the right types; anything else is refused. */
export function parsePatch(body: any): PlacePatch {
  if (!body || typeof body !== 'object') throw new PlaceInputError('Expected a JSON object')
  const out: PlacePatch = {}
  if ('beenThere' in body) out.beenThere = bool(body.beenThere, 'beenThere')
  if ('thinkingAbout' in body) out.thinkingAbout = bool(body.thinkingAbout, 'thinkingAbout')
  if ('comments' in body) out.comments = str(body.comments, 'comments')
  if ('topDishes' in body) out.topDishes = str(body.topDishes, 'topDishes')
  if ('address' in body) out.address = str(body.address, 'address')
  if ('lat' in body || 'lng' in body) {
    const lat = body.lat, lng = body.lng
    if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng) ||
      Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      throw new PlaceInputError('lat and lng must be numbers, sent together')
    }
    if (out.address === undefined) throw new PlaceInputError('a pin is only saved with its address')
    out.pin = { lat, lng }
  }
  if ('preference' in body) {
    const p = body.preference
    if (p !== null && !(PREFERENCES as readonly string[]).includes(p)) {
      throw new PlaceInputError('preference must be Top Choice, Great, Good, Bad or null')
    }
    out.preference = p
  }
  return out
}

export function parseNewPlace(body: any): NewPlace {
  const patch = parsePatch(body)
  const kind = body.kind
  if (kind !== 'restaurant' && kind !== 'activity') throw new PlaceInputError('kind must be restaurant or activity')
  const name = str(body.name ?? '', 'name').trim()
  if (!name || name.length > 200) throw new PlaceInputError('name is required (200 characters max)')
  const place: NewPlace = { ...patch, kind, name }
  if ('neighborhood' in body) place.neighborhood = str(body.neighborhood, 'neighborhood')
  if ('location' in body) {
    const location = str(body.location, 'location').trim()
    if (kind === 'restaurant' && location && !RESTAURANT_LOCATIONS.includes(location)) {
      throw new PlaceInputError('location must be one of the Restaurant Guide options')
    }
    place.location = location
  }
  return place
}

export interface OurPage {
  kind: AroundTownKind
  neighborhood: string
  location: string
}

const plain = (prop: any): string =>
  prop?.type === 'select' ? prop.select?.name ?? ''
    : prop?.type === 'rich_text' ? (prop.rich_text ?? []).map((t: any) => t.plain_text).join('')
    : ''

/** Which Around Town database a page lives in (and where it is), or null if it is not one of ours. */
export async function kindOfPage(notion: Client, pageId: string): Promise<OurPage | null> {
  if (!/^[0-9a-f]{32}$/.test(bare(pageId))) return null
  let page: any
  try {
    page = await notion.pages.retrieve({ page_id: pageId })
  } catch {
    return null
  }
  const parent = page?.parent?.database_id ? bare(page.parent.database_id) : ''
  const kind: AroundTownKind | null =
    parent === bare(RESTAURANT_GUIDE_DB) ? 'restaurant' : parent === bare(ACTIVITIES_DB) ? 'activity' : null
  if (!kind) return null
  return {
    kind,
    neighborhood: kind === 'restaurant' ? plain(page.properties?.['Neighborhood']) : '',
    location: plain(page.properties?.['Location']),
  }
}

/**
 * The Address, Latitude and Longitude values for a save. One rule for both
 * apps: a tapped candidate's pin is kept only inside the place's area; a typed
 * address is pinned by the free geocoders or saved unpinned; a place outside
 * LA and the Bay keeps its address and gets no pin.
 */
async function locationProperties(
  where: { kind: AroundTownKind; neighborhood: string; location: string },
  patch: PlacePatch
): Promise<{ props: Record<string, any>; result: LocationResult } | null> {
  if (patch.address === undefined) return null
  const address = patch.address.trim()
  if (!address) {
    return { props: { Address: text(''), ...pinProperties(null) }, result: { placed: false, pin: null } }
  }
  const area = await areaFor(where.kind, where.neighborhood, where.location)
  let pin: Coordinates | null = null
  if (area && patch.pin) {
    if (!pinInArea(area, patch.pin)) {
      throw new PlaceInputError('That spot is outside the area this place is filed under. Check its Location.')
    }
    pin = patch.pin
  } else if (area) {
    const found = await pinAddress(area, address)
    pin = found ? { lat: found.lat, lng: found.lng } : null
  }
  return { props: { Address: text(address), ...pinProperties(pin) }, result: { placed: pin !== null, pin } }
}

function properties(kind: AroundTownKind, p: PlacePatch): Record<string, any> {
  const props: Record<string, any> = {}
  const doneProp = kind === 'restaurant' ? 'Been There?' : 'Done?'
  if (p.beenThere !== undefined) {
    props[doneProp] = { checkbox: p.beenThere }
    // Been there takes a place off the want-to-try list, same as the phone.
    if (p.beenThere) props['Thinking About'] = { checkbox: false }
  }
  if (p.thinkingAbout !== undefined && !(p.beenThere === true)) {
    props['Thinking About'] = { checkbox: p.thinkingAbout }
  }
  if (kind === 'restaurant') {
    if (p.comments !== undefined) props['Comments'] = text(p.comments)
    if (p.topDishes !== undefined) props['Top Dishes'] = text(p.topDishes)
    if (p.preference !== undefined) {
      props['Preference'] = { select: p.preference ? { name: p.preference } : null }
    }
  }
  return props
}

export async function updatePlace(notion: Client, pageId: string, page: OurPage, patch: PlacePatch): Promise<LocationResult | null> {
  const location = await locationProperties(page, patch)
  const props = { ...properties(page.kind, patch), ...(location?.props ?? {}) }
  if (Object.keys(props).length === 0) return null
  await notion.pages.update({ page_id: pageId, properties: props })
  return location?.result ?? null
}

export async function createPlace(notion: Client, place: NewPlace): Promise<{ id: string; location: LocationResult | null }> {
  const location = await locationProperties(
    { kind: place.kind, neighborhood: place.neighborhood ?? '', location: place.location ?? '' }, place)
  const props = { ...properties(place.kind, place), ...(location?.props ?? {}) }
  props['Name'] = { title: [{ type: 'text', text: { content: place.name } }] }
  if (place.kind === 'restaurant') {
    if (place.neighborhood !== undefined) props['Neighborhood'] = text(place.neighborhood)
    if (place.location) props['Location'] = { select: { name: place.location } }
  } else {
    if (place.location !== undefined) props['Location'] = text(place.location)
    // Same defaults the phone uses for a new activity.
    props['Active?'] = { checkbox: true }
  }
  const page: any = await notion.pages.create({
    parent: { database_id: place.kind === 'restaurant' ? RESTAURANT_GUIDE_DB : ACTIVITIES_DB },
    properties: props,
  })
  return { id: page.id, location: location?.result ?? null }
}
