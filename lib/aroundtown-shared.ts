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

export type AroundTownKind = 'restaurant' | 'activity'
export type AroundTownRegion = 'la' | 'sfBay'

export interface AroundTownMeta {
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
  /** Street address from Notion; empty when none has been set. */
  address: string
  /** Pin colour, matching the phone exactly. */
  color: string
}

export interface AroundTownData {
  items: TripItem[]
  meta: Record<string, AroundTownMeta>
}

/** Same hexes as `AroundTownItem.swift`, so a place is the same colour on both. */
export const PREFERENCE_COLORS: Record<string, string> = {
  'Top Choice': '#54A0FF',
  Great: '#70C17C',
  Good: '#FBBF24',
  Bad: '#FF6B6B',
}
export const NOT_RATED_COLOR = '#E2E8F0'
export const ACTIVITY_COLOR = '#A78BFA'
export const BEEN_THERE_COLOR = '#8E8E93'

export const PREFERENCES = ['Top Choice', 'Great', 'Good', 'Bad'] as const

/** The Restaurant Guide's Location options, as they are in Notion. */
export const RESTAURANT_LOCATIONS = [
  'Denver', 'East Bay', 'Hong Kong', 'Joshua Tree', 'Koh Samui', 'LA', 'LA / OC', 'LA / SF',
  'Marin', 'Maui', 'Napa', 'NYC', 'OC', 'OC / San Diego', 'Paris', 'San Diego', 'SF', 'SF / LA',
  'SF / Marin', 'SF / Napa', 'Singapore', 'Vancouver', 'Tuscany', 'Burgundy', 'Sardinia',
  'Liguria', 'Park City', 'Chengdu', 'Shanghai',
]

/**
 * A rating wins. Elisa, 2026-10-07: "there is a color legend that's always on
 * the map, but the colors don't actually show ... so it's completely pointless".
 * She was right: a place is only rated once we have been, and "been there" grey
 * was applied first, so 239 of 414 pins were grey and the four rating colours
 * showed on one. Grey now means been there and NOT rated.
 */
export function colorFor(m: Pick<AroundTownMeta, 'kind' | 'done' | 'preference'>): string {
  if (m.kind === 'activity') return m.done ? BEEN_THERE_COLOR : ACTIVITY_COLOR
  if (m.preference && PREFERENCE_COLORS[m.preference]) return PREFERENCE_COLORS[m.preference]
  return m.done ? BEEN_THERE_COLOR : NOT_RATED_COLOR
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
