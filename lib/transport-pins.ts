import type { BranchPin } from './saved-pins'
import type { Coordinates, TripItem } from './types'

/**
 * Where a flight or train goes on the map: a pin where it LEAVES and a pin
 * where it ARRIVES. Elisa, 2026-10-18, as a universal travel map rule:
 * "flights should always map to the airport they fly out of. same with trains.
 * they should map to the station they leave from", then "for flights they
 * should map to where they leave and arrive. same for trains."
 *
 * Then: "always search for a specific station or airport. dont just assume
 * theres only one in the city. it should always come from my travel booking."
 * So the ends come ONLY from what the booking says: airport codes in the row's
 * text ("San Francisco (SFO)"), or stations it names ("Wien Westbahnhof").
 * A city name alone ("to Vienna") is never turned into a guessed station or
 * airport; such a row stays off the map and says what it needs.
 *
 * The departure is the item's own pin; the arrival rides as a second pin on
 * the same item (the "Other Branches" mechanism a chain uses), so tapping
 * either opens the item. Free lookups only: Nominatim for airports (it knows
 * codes like SFO), Photon for stations. Never a paid call.
 */

const UA = 'elisa-travel-map/1.0 (personal trip map)'

export const TRANSPORT_TYPES = new Set(['Flight', 'Train'])

/**
 * Stations named in the row's own text, in order: "Salzburg Hbf 10:52 to Wien
 * Westbahnhof 13:22" -> ["Salzburg Hbf", "Wien Westbahnhof"]. The name often
 * says only the city ("to Vienna"), and Vienna has several main stations; the
 * notes say which one. Two named stations win over the name's cities.
 */
const STATION_PHRASE = /((?:\p{Lu}[\p{L}.'-]*\s+){0,3}(?:Hbf|Hauptbahnhof|\p{Lu}?[\p{L}]*bahnhof|Station|Gare(?:\s+(?:de|du|d')\s*\p{L}+)?|Stazione(?:\s+\p{L}+)*|Centraal|Central Station))/gu
export function stationsInText(text: string): string[] {
  const found = [...text.matchAll(STATION_PHRASE)].map(m => m[1].trim())
  return found.filter((s, i) => found.indexOf(s) === i)
}

const wait = (ms: number) => new Promise(r => setTimeout(r, ms))
let lastNominatim = 0

/** An airport by its IATA code, as the booking gives it ("SFO", "VIE"). */
async function airport(code: string): Promise<{ name: string; pin: Coordinates } | null> {
  // Nominatim asks for at most one request a second.
  const gap = Date.now() - lastNominatim
  if (gap < 1100) await wait(1100 - gap)
  lastNominatim = Date.now()
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=3&q=${encodeURIComponent(`${code} airport`)}`
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000), cache: 'no-store' })
  if (!res.ok) return null
  const hit = ((await res.json()) as any[]).find(r => r.type === 'aerodrome')
  return hit ? { name: `${String(hit.display_name).split(',')[0]} (${code})`, pin: { lat: +(+hit.lat).toFixed(6), lng: +(+hit.lon).toFixed(6) } } : null
}

/**
 * Airport codes in the order the booking lists them: "San Francisco (SFO) ...
 * Frankfurt (FRA) ... Vienna (VIE)" -> SFO, FRA, VIE. The first is where you
 * leave, the last where you land. A bare code in the name counts too ("SFO to
 * Vienna"), but only a code, never a city.
 */
export function airportCodes(text: string): string[] {
  const inBrackets = [...text.matchAll(/\(([A-Z]{3})\)/g)].map(m => m[1])
  const found = inBrackets.length ? inBrackets : [...text.matchAll(/\b([A-Z]{3})\b/g)].map(m => m[1])
  return found.filter((c, i) => found.indexOf(c) === i)
}

async function photon(params: Record<string, string>): Promise<any[]> {
  const url = `https://photon.komoot.io/api/?${new URLSearchParams(params)}`
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000), cache: 'no-store' })
  return res.ok ? ((await res.json()).features ?? []) : []
}

/** A station as the booking names it ("Salzburg Hbf", "Wien Westbahnhof"). */
async function station(named: string): Promise<{ name: string; pin: Coordinates } | null> {
  const hit = (await photon({ q: named.replace(/\bhbf\b/i, 'Hauptbahnhof'), osm_tag: 'railway:station', limit: '1' }))[0]
  return hit ? { name: hit.properties.name as string, pin: { lat: +hit.geometry.coordinates[1].toFixed(6), lng: +hit.geometry.coordinates[0].toFixed(6) } } : null
}

/** The two ends the booking names, or null when it does not name both. */
export function bookedEnds(item: TripItem): [string, string] | null {
  if (item.type === 'Flight') {
    const codes = airportCodes(item.notes)
    const all = codes.length >= 2 ? codes : airportCodes([item.name, item.notes].join(' '))
    return all.length >= 2 ? [all[0], all[all.length - 1]] : null
  }
  for (const text of [item.notes, item.name, [item.venue, item.address].join(' ')]) {
    const named = stationsInText(text)
    if (named.length >= 2) return [named[0], named[1]]
  }
  return null
}

/** Departure pin plus the arrival as a second pin, or null if either end is unknown. */
export async function transportPins(item: TripItem): Promise<{ pin: Coordinates; arrival: BranchPin } | null> {
  const ends = bookedEnds(item)
  if (!ends) return null
  const find = item.type === 'Flight' ? airport : station
  const from = await find(ends[0])
  if (!from) return null
  const to = await find(ends[1])
  if (!to) return null
  return { pin: from.pin, arrival: { address: `Arrives: ${to.name}`, ...to.pin } }
}
