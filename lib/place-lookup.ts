/**
 * THE place lookup for Around Town, used by the website, the phone and the
 * weekly sweep. Free sources only: OpenStreetMap search (Photon) for venues
 * and the US Census geocoder for street addresses. No key, no bill. Google is
 * gone from this path (Elisa 2026-09-28: "make sure YOU DO NOT MAKE ME PAY MORE
 * THAN THE $100 CREDIT").
 *
 * Ported from the checked backfill (~/Dropbox/claude/sunzzari/pins/pins-lib.mjs)
 * so a place added today is judged exactly the way the first 390 were. The
 * checks (Elisa 2026-09-28, "make sure that wronga ddresses arent added? such
 * as ones in wrong countries"):
 *   - the search is fenced to the place's area (LA or the SF Bay box)
 *   - a city, district or street is never a place
 *   - a restaurant must be food, an activity a venue
 *   - for a NAME match, `confident` also needs the name to match and the spot
 *     to sit in one of the neighborhoods she named (its city, or within a few
 *     km of it). A street address is never gated by the neighborhood: it is her
 *     loose label, not a boundary (her correction, 2026-10-01).
 * A person picking from the list is the final check; `confident` is what the
 * unattended sweep requires before it saves anything.
 */

import { regionFromText, regionFromCoords } from './aroundtown-shared'
import type { AroundTownKind, AroundTownRegion } from './aroundtown-shared'
import { addressInNamedArea } from './place-areas'
import type { Coordinates } from './types'

const USER_AGENT = 'sunzzari-pins/1.0 (+https://github.com/sunzzari/elisa-travel-map)'

interface Box { minLat: number; maxLat: number; minLng: number; maxLng: number }

/** Same numbers as `regionFromCoords`. */
const BOX: Record<AroundTownRegion, Box> = {
  la: { minLat: 32.5, maxLat: 34.9, minLng: -119.5, maxLng: -116.7 },
  sfBay: { minLat: 36.8, maxLat: 38.9, minLng: -123.3, maxLng: -121.4 },
}

const CITY_BY_LOCATION: Record<string, string> = {
  la: 'Los Angeles, CA', sf: 'San Francisco, CA', oc: 'Orange County, CA',
  'san diego': 'San Diego, CA', napa: 'Napa, CA', marin: 'Marin County, CA', 'east bay': 'Oakland, CA',
}

export interface Candidate extends Coordinates {
  name: string
  address: string
  source: 'OpenStreetMap' | 'US Census'
  /** Passed every check the unattended sweep needs. */
  confident: boolean
}

export interface PlaceArea {
  kind: AroundTownKind
  /** The note as she wrote it: neighborhood then Location. */
  areaText: string
  boxes: Box[]
  /**
   * One centre per area her note names. "Fairfax / Pacific Palisades" is two
   * places, not one; looked up as a single string it resolved to one wrong spot.
   */
  centers: Coordinates[]
}

// MARK: - HTTP

async function getJSON(url: string): Promise<any | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(8000),
      cache: 'no-store',
    })
    return res.ok ? await res.json() : null
  } catch {
    return null
  }
}

async function photon(params: Record<string, string>): Promise<any[] | null> {
  const data = await getJSON('https://photon.komoot.io/api/?' + new URLSearchParams({ limit: '8', lang: 'en', ...params }))
  return data ? data.features ?? [] : null
}

async function census(address: string): Promise<(Coordinates & { matched: string }) | null> {
  const data = await getJSON('https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?' +
    new URLSearchParams({ address, benchmark: 'Public_AR_Current', format: 'json' }))
  const m = data?.result?.addressMatches?.[0]
  return m ? { lat: m.coordinates.y, lng: m.coordinates.x, matched: m.matchedAddress } : null
}

// MARK: - Checks (same as pins-lib.mjs)

const bbox = (b: Box) => `${b.minLng},${b.minLat},${b.maxLng},${b.maxLat}`
const inBox = (b: Box, lat: number, lng: number) => lat >= b.minLat && lat <= b.maxLat && lng >= b.minLng && lng <= b.maxLng
const pointOf = (f: any): Coordinates => ({ lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0] })

function km(a: Coordinates, b: Coordinates): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * 6371 * Math.asin(Math.sqrt(h))
}

const GENERIC = new Set([
  'the', 'and', 'la', 'le', 'el', 'de', 'co', 'company', 'restaurant', 'cafe', 'caffe', 'coffee',
  'bar', 'kitchen', 'shop', 'house', 'dessert', 'desserts', 'bakery', 'noodle', 'noodles', 'rice',
  'bbq', 'grill', 'bistro', 'tea', 'seafood', 'deli', 'pizzeria', 'eatery', 'cantina', 'taqueria',
])

const fold = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/&/g, ' and ').replace(/['’`]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()

/** 80% of the longer name's distinctive words shared. A miss costs a tap; a wrong match costs a pin that lies. */
export function nameMatches(rowName: string, candName: string | undefined): boolean {
  if (!candName) return false
  const a = fold(rowName)
  const b = fold(candName)
  if (!a || !b) return false
  if (a === b) return true
  const ta = a.split(' ').filter(t => !GENERIC.has(t))
  const tb = new Set(b.split(' ').filter(t => !GENERIC.has(t)))
  if (ta.length === 0 || tb.size === 0) return false
  const shared = ta.filter(t => tb.has(t)).length
  return shared / Math.max(ta.length, tb.size) >= 0.8 && ta.some(t => t.length >= 4)
}

/** True when the two names share at least one distinctive word (not "the", "cafe", "bar"...). */
function sharesNameWord(query: string, candName: string | undefined): boolean {
  if (!candName) return false
  const words = (s: string) => fold(s).split(' ').filter(t => t.length >= 3 && !GENERIC.has(t))
  const asked = words(query)
  // A query made only of generic words ("The Bar") cannot be judged this way.
  if (asked.length === 0) return true
  const have = new Set(words(candName))
  return asked.some(t => have.has(t))
}

const AREA_TYPES = new Set(['city', 'district', 'locality', 'county', 'state', 'country', 'street'])
const AREA_KEYS = new Set(['place', 'boundary', 'highway', 'landuse', 'route', 'waterway', 'railway:line'])
const isAreaOnly = (p: any) => AREA_KEYS.has(p.osm_key) || AREA_TYPES.has(p.type)

const FOOD: Record<string, Set<string>> = {
  amenity: new Set(['restaurant', 'cafe', 'fast_food', 'bar', 'pub', 'ice_cream', 'food_court', 'biergarten', 'nightclub']),
  shop: new Set(['bakery', 'pastry', 'coffee', 'confectionery', 'deli', 'tea', 'wine', 'alcohol', 'cheese', 'chocolate', 'ice_cream', 'beverages', 'food', 'seafood', 'butcher', 'bubble_tea']),
  craft: new Set(['brewery', 'winery', 'distillery', 'cider']),
}
const ACTIVITY_KEYS = new Set(['amenity', 'tourism', 'leisure', 'shop', 'historic', 'natural', 'building', 'man_made', 'club', 'sport', 'craft'])
const fits = (kind: AroundTownKind, p: any) =>
  kind === 'restaurant' ? FOOD[p.osm_key]?.has(p.osm_value) ?? false : ACTIVITY_KEYS.has(p.osm_key)

function addressOf(p: any): string {
  const street = [p.housenumber, p.street].filter(Boolean).join(' ')
  const cityLine = [p.city || p.locality || p.district, [p.state, p.postcode].filter(Boolean).join(' ')].filter(Boolean).join(', ')
  return [street, cityLine, p.country].filter(Boolean).join(', ')
}

// MARK: - Area

const centerCache = new Map<string, Coordinates | null>()

async function placeCenter(query: string, box: Box): Promise<Coordinates | null> {
  const key = `${query}|${bbox(box)}`
  if (centerCache.has(key)) return centerCache.get(key)!
  const feats = await photon({ q: query, osm_tag: 'place', bbox: bbox(box) })
  const f = (feats ?? []).find(x => { const p = pointOf(x); return inBox(box, p.lat, p.lng) })
  const hit = f ? pointOf(f) : null
  if (feats !== null) centerCache.set(key, hit)
  return hit
}

/**
 * Where a place is allowed to be, worked out before any search: the LA or Bay
 * box its Location names, and the neighborhood or named city inside it.
 * Null when the place is not an Around Town place (Paris, NYC): those get no pin.
 */
export async function areaFor(kind: AroundTownKind, neighborhood: string, location: string): Promise<PlaceArea | null> {
  const source = location || neighborhood
  const regions = new Set(source.split('/').map(s => regionFromText(s.trim())).filter((r): r is AroundTownRegion => r !== null))
  if (regions.size === 0 && kind === 'activity' && !location) regions.add('la')
  if (regions.size === 0) return null
  const boxes = [...regions].map(r => BOX[r])
  const first = (location.split('/')[0] ?? '').trim().toLowerCase()
  const city = CITY_BY_LOCATION[first] ?? (regions.has('sfBay') && !regions.has('la') ? 'San Francisco, CA' : 'Los Angeles, CA')
  const named = kind === 'restaurant'
    ? (neighborhood && neighborhood !== location ? neighborhood.split(/[/,]/) : [])
    : (location && !CITY_BY_LOCATION[first] ? [location] : [])
  const centers: Coordinates[] = []
  for (const part of named.map(s => s.trim()).filter(Boolean).slice(0, 4)) {
    for (const box of boxes) {
      const c = await placeCenter(kind === 'restaurant' ? `${part}, ${city}` : part, box)
      if (c) { centers.push(c); break }
    }
  }
  return { kind, areaText: [neighborhood, location].filter(Boolean).join(', '), boxes, centers }
}

/** G9, the saved-pin backstop: a pin outside its place's area is never saved or drawn. */
export function pinInArea(area: PlaceArea, pin: Coordinates): boolean {
  return area.boxes.some(b => inBox(b, pin.lat, pin.lng)) && regionFromCoords(pin.lat, pin.lng) !== null
}

/**
 * For a NAME match only: is this same-named venue the one in her neighborhood?
 * That is the one job the neighborhood does, telling a chain's branches apart
 * when nobody is there to pick. It is never applied to a street address.
 *
 * Elisa, 2026-10-01, on 18 correct addresses a distance-from-neighborhood check
 * had held back: "i think you are interpreting neighborhoods wrong. all those
 * addresses are correct". Her Neighborhood is a loose label - a street
 * ("Melrose"), a mall ("The Grove"), several areas at once - not a boundary.
 */
function nearNamedArea(area: PlaceArea, address: string, pin: Coordinates): boolean {
  if (addressInNamedArea(area.areaText, address)) return true
  const radius = area.kind === 'restaurant' ? 3 : 8
  return area.centers.some(c => km(c, pin) <= radius)
}

const nearestCenterKm = (area: PlaceArea, pin: Coordinates) =>
  area.centers.length ? Math.min(...area.centers.map(c => km(c, pin))) : 0

/** Whole words only: without the \b this would eat the "ste" in "Western Ave". */
const withoutUnit = (a: string) =>
  a.replace(/,?\s*(?:\b(?:suite|ste|unit|apt)\b\.?|#)\s*[\w-]+/gi, '').replace(/\s+,/g, ',')

// MARK: - Lookups

const looksLikeStreetAddress = (q: string) => /^\s*\d+[a-z]?\s+\S/i.test(q)

/**
 * A street address to a pin inside the area, or null. An address that lands in
 * the place's LA or Bay box is `confident`: the neighborhood does not gate it.
 */
export async function pinAddress(area: PlaceArea, fullAddress: string): Promise<Candidate | null> {
  // "Suite 130" defeats both geocoders; the building is what gets pinned.
  const address = withoutUnit(fullAddress)
  const c = await census(address)
  if (c && pinInArea(area, c)) {
    return { name: '', address: fullAddress.trim(), lat: Number(c.lat.toFixed(6)), lng: Number(c.lng.toFixed(6)),
      source: 'US Census', confident: true }
  }
  const hay = ` ${fold(address)} `
  for (const box of area.boxes) {
    for (const f of (await photon({ q: address, bbox: bbox(box) })) ?? []) {
      const p = f.properties
      // Only this exact address: its house number and a street word both appear.
      const houseOk = !!p.housenumber && !!p.street && hay.includes(` ${fold(p.housenumber)} `) &&
        fold(p.street).split(' ').some((w: string) => w.length >= 4 && hay.includes(` ${w} `))
      const pt = pointOf(f)
      if (!houseOk || !pinInArea(area, pt)) continue
      return { name: '', address: fullAddress.trim(), lat: Number(pt.lat.toFixed(6)), lng: Number(pt.lng.toFixed(6)),
        source: 'OpenStreetMap', confident: true }
    }
  }
  return null
}

/**
 * Up to five candidates for a name (or a typed street address), best first.
 * Nothing is saved here.
 */
export async function lookupPlace(query: string, area: PlaceArea): Promise<Candidate[]> {
  const q = query.trim()
  if (!q) return []
  if (looksLikeStreetAddress(q)) {
    const pin = await pinAddress(area, q)
    return pin ? [pin] : []
  }

  const found: (Candidate & { dist: number })[] = []
  for (const box of area.boxes) {
    const params: Record<string, string> = { q, bbox: bbox(box) }
    if (area.centers[0]) { params.lat = String(area.centers[0].lat); params.lon = String(area.centers[0].lng) }
    for (const f of (await photon(params)) ?? []) {
      const p = f.properties
      const pt = pointOf(f)
      if (isAreaOnly(p) || !fits(area.kind, p) || !pinInArea(area, pt)) continue
      // The venue's NAME has to share a real word with what was asked for.
      // OpenStreetMap also matches on street names: "The Alley" came back as
      // two unrelated restaurants on streets called "Alley" (seen on the phone,
      // 2026-10-01). Better no candidates and a typed address than wrong ones.
      if (!sharesNameWord(q, p.name)) continue
      // The same place mapped twice (a node and its building) is one candidate.
      if (found.some(c => km(c, pt) < 0.05 && fold(c.name) === fold(p.name ?? ''))) continue
      const address = addressOf(p)
      found.push({
        name: p.name ?? '', address, ...pt, source: 'OpenStreetMap',
        confident: nameMatches(q, p.name) && nearNamedArea(area, address, pt),
        dist: nearestCenterKm(area, pt),
      })
    }
  }
  found.sort((a, b) => Number(b.confident) - Number(a.confident)
    || Number(nameMatches(q, b.name)) - Number(nameMatches(q, a.name))
    || a.dist - b.dist)
  return found.slice(0, 5).map(({ dist: _dist, ...c }) => ({ ...c, lat: Number(c.lat.toFixed(6)), lng: Number(c.lng.toFixed(6)) }))
}
