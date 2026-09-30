import { Client } from '@notionhq/client'
import { PREFERENCES, RESTAURANT_LOCATIONS } from './aroundtown-shared'
import type { AroundTownKind } from './aroundtown-shared'

/**
 * Around Town writes. Server only. Every page id that comes in from the browser
 * is checked against its parent database before anything is written, so the
 * passcode can never be used to edit an unrelated Notion page.
 */

const notion = new Client({ auth: process.env.NOTION_TOKEN })

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

/** Which Around Town database a page lives in, or null if it is not one of ours. */
export async function kindOfPage(pageId: string): Promise<AroundTownKind | null> {
  if (!/^[0-9a-f]{32}$/.test(bare(pageId))) return null
  let page: any
  try {
    page = await notion.pages.retrieve({ page_id: pageId })
  } catch {
    return null
  }
  const parent = page?.parent?.database_id ? bare(page.parent.database_id) : ''
  if (parent === bare(RESTAURANT_GUIDE_DB)) return 'restaurant'
  if (parent === bare(ACTIVITIES_DB)) return 'activity'
  return null
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
  if (p.address !== undefined) props['Address'] = text(p.address)
  if (kind === 'restaurant') {
    if (p.comments !== undefined) props['Comments'] = text(p.comments)
    if (p.topDishes !== undefined) props['Top Dishes'] = text(p.topDishes)
    if (p.preference !== undefined) {
      props['Preference'] = { select: p.preference ? { name: p.preference } : null }
    }
  }
  return props
}

export async function updatePlace(pageId: string, kind: AroundTownKind, patch: PlacePatch): Promise<void> {
  const props = properties(kind, patch)
  if (Object.keys(props).length === 0) return
  await notion.pages.update({ page_id: pageId, properties: props })
}

export async function createPlace(place: NewPlace): Promise<string> {
  const props = properties(place.kind, place)
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
  return page.id
}
