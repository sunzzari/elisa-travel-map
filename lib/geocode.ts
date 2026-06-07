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

export async function geocodeVenue(
  venue: string,
  city: string
): Promise<Coordinates | null> {
  if (!venue && !city) return null

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
