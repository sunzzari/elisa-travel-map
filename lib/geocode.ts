import type { Coordinates } from './types'

const GEOCODING_API_KEY = process.env.GOOGLE_MAPS_API_KEY!

async function withRedis<T>(fn: (client: import('redis').RedisClientType) => Promise<T>): Promise<T | null> {
  if (!process.env.REDIS_URL) return null
  const { createClient } = await import('redis')
  const client = createClient({ url: process.env.REDIS_URL }) as import('redis').RedisClientType
  try {
    await client.connect()
    return await fn(client)
  } catch {
    return null
  } finally {
    await client.disconnect().catch(() => {})
  }
}

function cacheKey(venue: string, context: string, country: string | null): string {
  return `geocode:${venue.toLowerCase().trim()}:${context.toLowerCase().trim()}:${country ?? 'any'}`
}

interface AddressComponent { short_name: string; types: string[] }

/**
 * Result types that describe an AREA rather than a place.
 *
 * A result made only of these is a city, a district or a postcode - never an
 * item's location. This file already refused to geocode a bare city for that
 * reason; the same rule has to apply to the ANSWER, because a country-
 * constrained query that finds nothing does not fail, it falls back to the
 * city named in the query. Constraining "Shibuya Crossing" to Austria returns
 * Vienna, and "Baroque Hall - St. Peter restaurant" returns Salzburg. Both look
 * like a successful geocode and both are wrong.
 */
const AREA_ONLY_TYPES = new Set([
  'locality',
  'sublocality',
  'sublocality_level_1',
  'neighborhood',
  'administrative_area_level_1',
  'administrative_area_level_2',
  'administrative_area_level_3',
  'administrative_area_level_4',
  'colloquial_area',
  'postal_code',
  'country',
  'continent',
  'political',
])

function isAreaOnly(types: string[] | undefined): boolean {
  if (!types || types.length === 0) return false
  return types.every(t => AREA_ONLY_TYPES.has(t))
}

function countryOfResult(components: AddressComponent[] | undefined): string | null {
  return components?.find(c => c.types.includes('country'))?.short_name ?? null
}

/**
 * ISO-2 country for a place name ("Salzburg", "Salzburg + Vienna, Austria").
 *
 * This is the anchor for the country guard below. Cached hard, because the
 * answer for a trip's own location never changes and every item on that trip
 * asks the same question.
 */
async function countryOf(place: string): Promise<string | null> {
  const clean = place.trim()
  if (!clean) return null
  const key = `geocode:cc:${clean.toLowerCase()}`

  const cached = await withRedis(async client => client.get(key))
  if (cached) return cached

  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(clean)}&key=${GEOCODING_API_KEY}`
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
    const data = await res.json() as {
      status?: string
      results?: Array<{ address_components?: AddressComponent[] }>
    }
    if (data.status !== 'OK') return null
    const cc = countryOfResult(data.results?.[0]?.address_components)
    if (!cc) return null
    await withRedis(async client => {
      await client.set(key, cc, { EX: 60 * 60 * 24 * 90 })
      return null
    })
    return cc
  } catch {
    return null
  }
}

/**
 * Best coordinate for a trip item, most specific source first.
 *
 * The bug this replaces: callers did
 *   geocodeVenue(item.venue, item.legCity) ?? geocodeVenue(item.name, ...)
 * and a BLANK venue does not fail - it geocodes the bare city and returns the
 * city centre. So the `??` never fell through, and the item's actual name was
 * never looked up. Every China item has a blank `Provider / Venue`, so all 62
 * landed on three city-centre pins and the map looked empty of real places.
 *
 * A bare city is never a location for an item. It is only used as the CONTEXT
 * for a name or venue.
 */
export async function geocodeItem(
  item: {
    venue: string
    name: string
    legCity: string
    address?: string
  },
  /**
   * The trip's own location, used when the item has no leg. Without it a venue
   * name is looked up against the whole planet: "Baroque Hall - St. Peter
   * restaurant" on the Vienna trip has a blank leg, and Google put it in
   * Adelaide, South Australia. One pin on the wrong continent stretches the
   * map fit until the actual trip is a dot.
   */
  region = ''
): Promise<Coordinates | null> {
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

export async function geocodeVenue(
  venue: string,
  city: string,
  region = ''
): Promise<Coordinates | null> {
  // A city on its own is not an item's location, it is context for a name.
  // Returning the city centre here is what silently defeated the name lookup.
  if (!venue.trim()) return null

  // The country comes from the leg, or failing that from the trip's own
  // location. The QUERY still only ever carries the leg city: a trip location
  // reads like "Salzburg + Vienna, Austria", and pasting that onto a venue name
  // turns a findable hotel into a city. "Park Hyatt Vienna" constrained to AT is
  // Am Hof 2; the same name with the trip location appended is just Vienna.
  const expected = await countryOf(city.trim() || region.trim())

  const query = [venue, city.trim()].filter(Boolean).join(', ')
  const key = cacheKey(venue, city.trim(), expected)

  // Try cache first
  const cached = await withRedis(async client => {
    const val = await client.get(key)
    return val ? JSON.parse(val) as Coordinates : null
  })
  if (cached) return cached

  // Call Geocoding API. Build sandboxes can fail to reach maps.googleapis.com
  // (the 30-day cache expires, so builds hit a cold miss). Fail soft to null so
  // prerender never crashes; runtime revalidation backfills coordinates where
  // the network works.
  // components=country: is the constraint; the check below is the belt, because
  // the API still answers with a near-miss when the constraint finds nothing.
  const constraint = expected ? `&components=country:${expected}` : ''
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}${constraint}&key=${GEOCODING_API_KEY}`
  let data: {
    status?: string
    results?: Array<{
      geometry: { location: Coordinates }
      address_components?: AddressComponent[]
      types?: string[]
    }>
  }
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
    data = await res.json()
  } catch {
    return null
  }

  const first = data.results?.[0]
  if (data.status !== 'OK' || !first) return null

  // Never return a place in the wrong country. Elisa, 2026-09-08: "add a
  // safeguard so you never geocode things to the wrong country." A miss here
  // is reported as no location, which puts the item in the "not on the map"
  // list where she can see it, rather than on a map pin that lies.
  if (expected) {
    const got = countryOfResult(first.address_components)
    if (got && got !== expected) return null
  }

  // ...and never return the city we used as context dressed up as the venue.
  // The caller falls through to its next source, and if nothing resolves the
  // item is reported as having no location instead of getting a pin that lies.
  if (isAreaOnly(first.types)) return null

  const location = first.geometry.location

  // Store in cache (30 days)
  await withRedis(async client => {
    await client.set(key, JSON.stringify(location), { EX: 60 * 60 * 24 * 30 })
    return null
  })

  return location
}
