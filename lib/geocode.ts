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

function cacheKey(venue: string, city: string): string {
  return `geocode:${venue.toLowerCase().trim()}:${city.toLowerCase().trim()}`
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
export async function geocodeItem(item: {
  venue: string
  name: string
  legCity: string
  address?: string
}): Promise<Coordinates | null> {
  if (item.address?.trim()) {
    const byAddress = await geocodeVenue(item.address, '')
    if (byAddress) return byAddress
  }
  if (item.venue.trim()) {
    const byVenue = await geocodeVenue(item.venue, item.legCity)
    if (byVenue) return byVenue
  }
  if (item.name.trim()) {
    const byName = await geocodeVenue(item.name, item.legCity)
    if (byName) return byName
  }
  return null
}

export async function geocodeVenue(
  venue: string,
  city: string
): Promise<Coordinates | null> {
  // A city on its own is not an item's location, it is context for a name.
  // Returning the city centre here is what silently defeated the name lookup.
  if (!venue.trim()) return null

  const query = [venue, city].filter(Boolean).join(', ')
  const key = cacheKey(venue, city)

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
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&key=${GEOCODING_API_KEY}`
  let data: { status?: string; results?: Array<{ geometry: { location: Coordinates } }> }
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
    data = await res.json()
  } catch {
    return null
  }

  const first = data.results?.[0]
  if (data.status !== 'OK' || !first) return null

  const location = first.geometry.location

  // Store in cache (30 days)
  await withRedis(async client => {
    await client.set(key, JSON.stringify(location), { EX: 60 * 60 * 24 * 30 })
    return null
  })

  return location
}
