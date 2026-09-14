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
