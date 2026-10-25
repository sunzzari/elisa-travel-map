/**
 * AROUND TOWN - the parts both the server and the browser need.
 *
 * Kept apart from `aroundtown.ts` on purpose. That file imports the geocoder,
 * which imports `node:fs` to read the coordinate table, so a client component
 * importing a single colour constant from it drags Node into the browser
 * bundle and the build fails. Types, colours and the pure region rules live
 * here; anything that touches Notion or Google lives there.
 */

import type { TripItem } from './types'
import { AWAY_AREAS } from './place-areas'

export type AroundTownKind = 'restaurant' | 'activity'
/** The two home areas Around Town always had. */
export type AroundTownRegion = 'la' | 'sfBay'
/** Any area on Elisa's Map: a home area, or an `AWAY_AREAS` key ("hong kong", "vienna"). */
export type MapArea = string

export interface AroundTownMeta {
  kind: AroundTownKind
  region: MapArea | null
  neighborhood: string
  locationText: string
  preference: string | null
  goodFor: string[]
  topDishes: string
  comments: string
  thinkingAbout: boolean
  done: boolean
  /** Street address from Notion; empty when none has been set. */
  address: string
  /** Pin colour, matching the phone exactly. */
  color: string
}

export interface AroundTownData {
  items: TripItem[]
  meta: Record<string, AroundTownMeta>
}

/** Rating colours, for the rating buttons on the edit form. Not pin colours. */
export const PREFERENCE_COLORS: Record<string, string> = {
  'Top Choice': '#54A0FF',
  Great: '#70C17C',
  Good: '#FBBF24',
  Bad: '#FF6B6B',
}
/**
 * Pin colours. Elisa, 2026-10-11: "make want to try as a special colored pin.
 * also havent tried vs tried. thats how i want you to color them." Three
 * colours and nothing else; the rating is in the row and the sheet, not the pin.
 */
export const WANT_TO_TRY_COLOR = '#FBBF24'
export const HAVENT_TRIED_COLOR = '#54A0FF'
export const TRIED_COLOR = '#8E8E93'

export const PREFERENCES = ['Top Choice', 'Great', 'Good', 'Bad'] as const

/** The Restaurant Guide's Location options, as they are in Notion. */
export const RESTAURANT_LOCATIONS = [
  'Denver', 'East Bay', 'Hong Kong', 'Joshua Tree', 'Koh Samui', 'LA', 'LA / OC', 'LA / SF',
  'Marin', 'Maui', 'Napa', 'NYC', 'OC', 'OC / San Diego', 'Paris', 'San Diego', 'SF', 'SF / LA',
  'SF / Marin', 'SF / Napa', 'Singapore', 'Vancouver', 'Tuscany', 'Burgundy', 'Sardinia',
  'Liguria', 'Park City', 'Chengdu', 'Shanghai', 'Vienna',
]

/** Been there is a fact, so it wins over a Want to Try tick left on. */
export function colorFor(m: Pick<AroundTownMeta, 'done' | 'thinkingAbout'>): string {
  if (m.done) return TRIED_COLOR
  return m.thinkingAbout ? WANT_TO_TRY_COLOR : HAVENT_TRIED_COLOR
}

// MARK: - Region classification
//
// Ported from `AroundTownItem.Region` in the iOS app. Both clients must place
// and reject the same rows, so these lists are the same lists. Short tokens are
// matched on word boundaries so a foreign city can never match "la".

const LA_PHRASES = [
  'los angeles', 'orange county', 'san diego', 'santa monica', 'culver city',
  'west hollywood', 'los feliz', 'echo park', 'silver lake', 'silverlake',
  'highland park', 'eagle rock', 'little tokyo', 'exposition park',
  'universal city', 'long beach', 'manhattan beach', 'hermosa beach',
  'redondo beach', 'beverly hills', 'san gabriel', 'monterey park',
  'el segundo', 'playa vista', 'marina del rey', 'san pedro',
  'sherman oaks', 'studio city', 'thousand oaks', 'santa clarita',
  'newport beach', 'laguna beach', 'huntington beach', 'costa mesa',
]
const LA_WORDS = [
  'la', 'oc', 'socal', 'hollywood', 'venice', 'pasadena', 'koreatown',
  'chinatown', 'brentwood', 'westwood', 'sawtelle', 'malibu', 'burbank',
  'glendale', 'arcadia', 'alhambra', 'torrance', 'calabasas', 'dtla',
  'getty', 'yamashiro', 'larchmont', 'anaheim', 'irvine', 'fullerton',
]
const SF_PHRASES = [
  'san francisco', 'east bay', 'mill valley', 'walnut creek', 'half moon bay',
  'point reyes', 'palo alto', 'mountain view', 'san mateo', 'san jose',
  'san rafael', 'daly city', 'santa cruz', 'santa rosa', 'russian hill',
  'nob hill', 'hayes valley', 'north beach', 'castro', 'sunset district',
]
const SF_WORDS = [
  'sf', 'bay', 'marin', 'napa', 'sonoma', 'oakland', 'berkeley', 'sausalito',
  'healdsburg', 'petaluma', 'novato', 'tiburon', 'alameda', 'emeryville',
  'richmond', 'presidio', 'soma', 'mission', 'peninsula', 'sfo', 'yountville',
  'sebastopol', 'larkspur', 'corte', 'burlingame', 'menlo',
]

export function regionFromText(location: string): AroundTownRegion | null {
  const loc = location.toLowerCase()
  if (!loc) return null
  const words = new Set(loc.split(/[^a-z0-9]+/i).filter(Boolean))
  const isLA = LA_PHRASES.some(p => loc.includes(p)) || LA_WORDS.some(w => words.has(w))
  const isSF = SF_PHRASES.some(p => loc.includes(p)) || SF_WORDS.some(w => words.has(w))
  if (isLA) return 'la'          // "LA / SF" - the coordinate decides later
  if (isSF) return 'sfBay'
  return null
}

/**
 * Authoritative once a coordinate exists, and the geocode reject: a pin outside
 * both boxes is not an Around Town place, it is a bad lookup.
 */
export function regionFromCoords(lat: number, lng: number): AroundTownRegion | null {
  if (lat >= 32.5 && lat <= 34.9 && lng >= -119.5 && lng <= -116.7) return 'la'
  if (lat >= 36.8 && lat <= 38.9 && lng >= -123.3 && lng <= -121.4) return 'sfBay'
  return null
}

/**
 * The area a FIT may span. Deliberately TIGHTER than `regionFromCoords`.
 * Elisa, 2026-09-15: *"when im on LA in the sunzzari app it also zooms out to
 * san diego. i only want LA proper. not even orange county."*
 *
 * `regionFromCoords` stays wide ON PURPOSE - it decides whether a place is kept
 * at all, so narrowing it would strip every San Diego and Orange County place
 * off the map instead of merely leaving it out of the frame. A place outside
 * this box keeps its pin and stays clickable; it just never stretches the frame.
 *
 * LA proper is LA County, coast through the San Gabriel Valley: Long Beach,
 * San Pedro, Torrance and the beach cities at the south edge; Malibu and
 * Calabasas west; Santa Clarita at the north edge; Pasadena, Arcadia and
 * Monterey Park east. Anaheim (-117.91) and Fullerton (-117.92) sit just outside
 * the eastern edge; Irvine, Newport, Costa Mesa and Huntington Beach sit below
 * the southern edge.
 *
 * Twin of `AroundTownItem.Region.containsForFit` in sunzzari-app. Same numbers.
 */
export function fitAreaContains(
  region: AroundTownRegion,
  lat: number,
  lng: number
): boolean {
  if (region === 'la') {
    return lat >= 33.7 && lat <= 34.45 && lng >= -118.95 && lng <= -117.95
  }
  return regionFromCoords(lat, lng) === 'sfBay'
}

// MARK: - Elisa's Map: every area, home and away
//
// Elisa, 2026-10-25: "maybe around town should be changed to "Elisa's Map" but
// default filter to LA. then i can pan to wherever. but hong kong restaurants
// should not come up for if im in LA. it should be harder to expalnd my search
// but it should be possible". LA and the Bay keep their own rules above; a
// travel Location ("Vienna", "Hong Kong") is an area too, sized by `AWAY_AREAS`.

export const HOME_AREAS: AroundTownRegion[] = ['la', 'sfBay']

export const isHomeArea = (area: MapArea | null): area is AroundTownRegion =>
  area === 'la' || area === 'sfBay'

/** Centre and reach of every area, for the area menu and "Show places here". */
export interface MapAreaInfo { id: MapArea; label: string; lat: number; lng: number; radiusKm: number }

const HOME_INFO: Record<AroundTownRegion, MapAreaInfo> = {
  la: { id: 'la', label: 'LA', lat: 34.05, lng: -118.25, radiusKm: 120 },
  sfBay: { id: 'sfBay', label: 'SF Bay', lat: 37.77, lng: -122.42, radiusKm: 110 },
}

/** The travel area a Location names, as its `AWAY_AREAS` key, or null. */
export function awayAreaIdFor(location: string): MapArea | null {
  for (const part of location.split('/')) {
    const key = part.trim().toLowerCase()
    if (key && AWAY_AREAS[key]) return key
  }
  return null
}

/** The area a Location belongs to: home first ("LA / SF" is LA), then travel. */
export function areaFromText(location: string): MapArea | null {
  return regionFromText(location) ?? awayAreaIdFor(location)
}

function km(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const rad = Math.PI / 180
  const dLat = (bLat - aLat) * rad
  const dLng = (bLng - aLng) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLng / 2) ** 2
  return 2 * 6371 * Math.asin(Math.sqrt(h))
}

/** Whether a pin is inside a travel area's reach. */
export function inAwayArea(area: MapArea, lat: number, lng: number): boolean {
  const a = AWAY_AREAS[area]
  return !!a && km(a.lat, a.lng, lat, lng) <= a.radiusKm
}

/** The area a coordinate is in: LA or the Bay by their boxes, else the nearest travel area that reaches it. */
export function areaFromCoords(lat: number, lng: number): MapArea | null {
  const home = regionFromCoords(lat, lng)
  if (home) return home
  let best: MapArea | null = null
  let bestKm = Infinity
  for (const [id, a] of Object.entries(AWAY_AREAS)) {
    const d = km(a.lat, a.lng, lat, lng)
    if (d <= a.radiusKm && d < bestKm) { best = id; bestKm = d }
  }
  return best
}

/** The fit frame for any area: LA proper and the Bay as above, a travel area by its reach. */
export function areaFitContains(area: MapArea, lat: number, lng: number): boolean {
  return isHomeArea(area) ? fitAreaContains(area, lat, lng) : inAwayArea(area, lat, lng)
}

/** Her own spelling of the area, from the Notion Location options ("Koh Samui", "NYC"). */
export function areaLabel(area: MapArea): string {
  if (isHomeArea(area)) return HOME_INFO[area].label
  return RESTAURANT_LOCATIONS.find(l => l.toLowerCase() === area) ?? AWAY_AREAS[area]?.city.split(',')[0] ?? area
}

export function areaInfo(area: MapArea): MapAreaInfo | null {
  if (isHomeArea(area)) return HOME_INFO[area]
  const a = AWAY_AREAS[area]
  return a ? { id: area, label: areaLabel(area), lat: a.lat, lng: a.lng, radiusKm: a.radiusKm } : null
}

/** The area a map view's centre is in, for "Show places here". Same rule as a pin. */
export const areaAtCenter = areaFromCoords

/**
 * The areas of Elisa's Map that have places, for the area menu: LA and the Bay
 * first, then travel areas by how many places they hold.
 */
export function mapAreas(places: Array<{ region: MapArea | null }>): Array<MapAreaInfo & { count: number }> {
  const counts = new Map<MapArea, number>()
  for (const p of places) if (p.region) counts.set(p.region, (counts.get(p.region) ?? 0) + 1)
  const out: Array<MapAreaInfo & { count: number }> = []
  for (const [id, count] of counts) {
    const info = areaInfo(id)
    if (info) out.push({ ...info, label: areaLabel(id), count })
  }
  const homeFirst = (a: MapAreaInfo) => (a.id === 'la' ? 0 : a.id === 'sfBay' ? 1 : 2)
  return out.sort((a, b) => homeFirst(a) - homeFirst(b) || b.count - a.count || a.label.localeCompare(b.label))
}
