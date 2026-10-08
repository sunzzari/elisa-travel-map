import { Client } from '@notionhq/client'
import { PREFERENCES, RESTAURANT_LOCATIONS } from './aroundtown-shared'
import type { AroundTownKind } from './aroundtown-shared'
import { areaFor, pinAddress, pinInArea } from './place-lookup'
import { pinProperties, readSavedPin } from './saved-pins'
import { MapLinkError, pinFromMapLink } from './map-link'
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
  /**
   * A Google or Apple Maps share link she pasted because the free sources could
   * not place the address. The pin is read out of the link (lib/map-link.ts),
   * then checked against the place's area like any other.
   */
  mapLink?: string
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
  if ('mapLink' in body) {
    const link = str(body.mapLink, 'mapLink').trim()
    if (link.length > 2000) throw new PlaceInputError('mapLink is too long')
    if (link && out.pin) throw new PlaceInputError('send a map link or a pin, not both')
    if (link) out.mapLink = link
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
  /** The Address already saved, so a pasted map link can pin it without retyping it. */
  address: string
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
    address: plain(page.properties?.['Address']).trim(),
  }
}

/**
 * The Address, Latitude and Longitude values for a save. One rule for both
 * apps: a tapped candidate's pin is kept only inside the place's area; a typed
 * address is pinned by the free geocoders or saved unpinned; a pasted map link
 * gives the pin when they cannot. A place with no Location has no area, so it
 * keeps its address and gets no pin.
 */
async function locationProperties(
  where: { kind: AroundTownKind; neighborhood: string; location: string; address?: string },
  patch: PlacePatch
): Promise<{ props: Record<string, any>; result: LocationResult } | null> {
  // A map link alone pins the Address the row already has.
  if (patch.address === undefined && patch.mapLink && where.address) patch = { ...patch, address: where.address }
  if (patch.address === undefined) {
    if (patch.mapLink) throw new PlaceInputError('Add the address first, then paste the map link.')
    return null
  }
  if (patch.mapLink) {
    try {
      patch = { ...patch, pin: await pinFromMapLink(patch.mapLink) }
    } catch (err) {
      throw new PlaceInputError(err instanceof MapLinkError ? err.message : 'That map link could not be read.')
    }
  }
  const address = (patch.address ?? '').trim()
  if (!address) {
    return { props: { Address: text(''), ...pinProperties(null) }, result: { placed: false, pin: null } }
  }
  const area = await areaFor(where.kind, where.neighborhood, where.location)
  if (!area && patch.mapLink) throw new PlaceInputError('Set this place\'s Location first, then paste the map link.')
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
  // Elisa, 2026-10-07: "anytime a restaurnt is added to the guide location,
  // address, lattitude should ALWAYS be added", and on what to do when there is
  // no address to be found, 2026-10-08: "Block the add". This is the one gate
  // every add path goes through, so it is enforced here and not in each app.
  if (place.kind === 'restaurant') {
    const missing = [!place.location?.trim() && 'a Location', !place.address?.trim() && 'an Address'].filter(Boolean)
    if (missing.length) throw new PlaceInputError(`A restaurant needs ${missing.join(' and ')} before it can be saved.`)
  }
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

// MARK: - Incomplete restaurants

export interface IncompleteRow {
  id: string
  name: string
  location: string
  neighborhood: string
  address: string
  /** What the row lacks: any of "Location", "Address", "pin". Empty when it is only waiting on her review. */
  missing: string[]
  /** What Claude was unsure of, with its best candidate, for her to confirm or correct. */
  toVerify: string
  url: string
}

/**
 * THE definition of an incomplete Restaurant Guide row, read by the weekly
 * check, the fix skill, the Sunzzari session hook and the phone, so they can
 * never disagree about the count: a row with no Location, no Address or no pin
 * (unless she ticked `Skip Pin`), or one with a `To Verify` note waiting on her.
 *
 * It is the backstop for the one add path no gate can stop, a row typed
 * straight into Notion. `Skip Pin` and `To Verify` are optional columns: a
 * table without them reads as nothing skipped and nothing to verify.
 */
export async function incompleteRestaurants(notion: Client = serverNotion): Promise<IncompleteRow[]> {
  const pages: any[] = []
  let cursor: string | undefined
  do {
    const res: any = await notion.databases.query({ database_id: RESTAURANT_GUIDE_DB, start_cursor: cursor, page_size: 100 })
    pages.push(...res.results)
    cursor = res.has_more ? res.next_cursor : undefined
  } while (cursor)

  const out: IncompleteRow[] = []
  for (const page of pages) {
    const props = page.properties ?? {}
    const name = (props['Name']?.title ?? []).map((t: any) => t.plain_text).join('').trim()
    if (!name) continue
    const location = plain(props['Location'])
    const address = plain(props['Address']).trim()
    const toVerify = plain(props['To Verify']).trim()
    const skipPin = props['Skip Pin']?.checkbox === true
    const missing = [
      !location && 'Location',
      !skipPin && !address && 'Address',
      !skipPin && !readSavedPin(props).coordinates && 'pin',
    ].filter((m): m is string => !!m)
    if (missing.length === 0 && !toVerify) continue
    out.push({ id: page.id, name, location, neighborhood: plain(props['Neighborhood']), address, missing, toVerify, url: page.url ?? '' })
  }
  return out.sort((a, b) => a.location.localeCompare(b.location) || a.name.localeCompare(b.name))
}
