import type { Coordinates } from './types'
import staticCacheFile from '@/data/geocache.json'

/**
 * WHERE A PLACE IS - read-only, and free.
 *
 * As of 2026-09-30 nothing in this app calls a paid geocoder. A place's pin
 * comes from, in order:
 *
 * 1. Its SAVED PIN in Notion (Latitude / Longitude, lib/saved-pins.ts). Every
 *    saved pin came from a free source (OpenStreetMap or the US Census) and
 *    passed the area checks in lib/place-lookup.ts or the backfill scripts.
 * 2. The SAVED TABLE `data/geocache.json`: 600-odd trip items placed by Google
 *    before it was switched off, kept because a coordinate for a named place
 *    never changes.
 * 3. Nothing. The place shows under "not on the map", where "Find it" (website
 *    and phone) or the weekly sweep gives it a pin.
 *
 * History, so nobody reintroduces it: on 2026-09-08 a deleted Redis cache in
 * front of Google Geocoding ran up $97 in two days, and the Geocoding API was
 * switched off. On 2026-09-28 Elisa set the rule "make sure YOU DO NOT MAKE ME
 * PAY MORE THAN THE $100 CREDIT". The Google code that lived here is deleted,
 * not disabled, so no setting can bring a bill back.
 */

type CacheValue = Coordinates | string | null
const table = staticCacheFile as Record<string, CacheValue>

function tableGet(key: string): CacheValue | undefined {
  return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined
}

/** ISO-2 country for a place name, from the saved table only. */
function countryOf(place: string): string | null {
  const clean = place.trim()
  if (!clean) return null
  const v = tableGet(`geocode:cc:${clean.toLowerCase()}`)
  return typeof v === 'string' ? v : null
}

/**
 * Best known pin for a trip item, most specific source first.
 *
 * A saved pin wins. After it the saved table is tried by address, then venue,
 * then name. A bare city is never an item's location: the leg city is only the
 * context the table's keys were built with.
 */
export async function geocodeItem(
  item: {
    venue: string
    name: string
    legCity: string
    address?: string
    coordinates?: Coordinates
  },
  /** The trip's own location, used when the item has no leg. */
  region = ''
): Promise<Coordinates | null> {
  if (item.coordinates) return item.coordinates
  if (item.address?.trim()) {
    const byAddress = await geocodeVenue(item.address, '', region)
    if (byAddress) return byAddress
  }
  if (item.venue.trim()) {
    const byVenue = await geocodeVenue(item.venue, item.legCity, region)
    if (byVenue) return byVenue
  }
  if (item.name.trim()) {
    const byName = await geocodeVenue(item.name, item.legCity, region)
    if (byName) return byName
  }
  return null
}

/** A pin from the saved table, or null. Never a network call. */
export async function geocodeVenue(venue: string, city: string, region = ''): Promise<Coordinates | null> {
  if (!venue.trim()) return null
  const expected = countryOf(city.trim() || region.trim())
  const query = [venue, city.trim()].filter(Boolean).join(', ')
  const v = tableGet(`geocode:${query.toLowerCase().trim()}:${expected ?? 'any'}`)
  return v && typeof v === 'object' ? v : null
}
