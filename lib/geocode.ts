import { readFileSync, writeFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import type { Coordinates } from './types'
import staticCacheFile from '@/data/geocache.json'

const GEOCODING_API_KEY = process.env.GOOGLE_MAPS_API_KEY!

/**
 * COORDINATE CACHE - read this before changing anything below.
 *
 * Incident, 2026-09-08: a $97 Google Geocoding bill in two days. The cache was
 * a Redis Cloud instance that had been deleted; its host no longer resolves in
 * DNS. Every read failed, the failure was swallowed by a `catch {}`, and so
 * every render of every page geocoded all 668 trip items from scratch. Eleven
 * production builds in two days, each prerendering seven itinerary pages, plus
 * a Notion webhook that fired a full 668-item sync on any page event.
 *
 * Three rules came out of it, and all three are load-bearing:
 *
 * 1. THE CACHE IS A FILE IN THIS REPO (`data/geocache.json`), not a service.
 *    A coordinate for a named place never changes, so this is not really a
 *    cache - it is a lookup table that happens to be filled by an API. A file
 *    cannot be deleted out from under the app, costs nothing, needs no
 *    credentials, and is visible in `git diff`.
 *
 * 2. A MISS NEVER SILENTLY BECOMES AN API CALL AT SCALE. Live lookups are
 *    capped per process (`GEOCODE_LIVE_BUDGET`), refused outright during a
 *    production build, and every one of them is logged. The worst case is now
 *    a few cents, not unbounded.
 *
 * 3. FAILURES ARE CACHED TOO. A place that Google cannot resolve, or resolves
 *    into the wrong country, is stored as `null` so it is asked about once and
 *    never again. Transient failures (network, timeout) are NOT stored.
 *
 * To fill the table: `GEOCODE_WRITE_CACHE=1 npm run build` locally, then commit
 * `data/geocache.json`. That is the only context that writes the file - the
 * Vercel filesystem is read-only and production never writes it.
 */

type CacheValue = Coordinates | string | null

const staticCache = staticCacheFile as Record<string, CacheValue>
const runtimeCache = new Map<string, CacheValue>()

/** Local cache-filling run. Never true on Vercel: the filesystem is read-only. */
const WRITING_CACHE = process.env.GEOCODE_WRITE_CACHE === '1'

/**
 * Live lookups allowed per server process. A warm cache needs zero; this only
 * covers items added to Notion since the table was last filled, so it is a
 * ceiling on surprise, not a working budget.
 */
const LIVE_BUDGET = Number(
  process.env.GEOCODE_LIVE_BUDGET ?? (WRITING_CACHE ? Number.MAX_SAFE_INTEGER : 40)
)

let liveCalls = 0
let budgetWarned = false

function cacheGet(key: string): CacheValue | undefined {
  if (runtimeCache.has(key)) return runtimeCache.get(key)
  if (Object.prototype.hasOwnProperty.call(staticCache, key)) return staticCache[key]
  return undefined
}

function cacheSet(key: string, value: CacheValue): void {
  runtimeCache.set(key, value)
  if (WRITING_CACHE) writeThrough(key, value)
}

/**
 * Merge one entry into the file on disk.
 *
 * Read, merge, write a temp file, rename. `next build` forks worker processes
 * that geocode in parallel, so a plain write would let the last worker out
 * clobber every other worker's finds.
 */
function writeThrough(key: string, value: CacheValue): void {
  try {
    const file = join(process.cwd(), 'data', 'geocache.json')
    let onDisk: Record<string, CacheValue> = {}
    try {
      onDisk = JSON.parse(readFileSync(file, 'utf8')) as Record<string, CacheValue>
    } catch {
      onDisk = {}
    }
    onDisk[key] = value
    const sorted: Record<string, CacheValue> = {}
    for (const k of Object.keys(onDisk).sort()) sorted[k] = onDisk[k]
    const tmp = `${file}.${process.pid}.tmp`
    writeFileSync(tmp, `${JSON.stringify(sorted, null, 2)}\n`)
    renameSync(tmp, file)
  } catch (err) {
    console.warn('[geocode] could not write cache file:', err)
  }
}

/**
 * The single gate in front of Google. Every paid request passes through here.
 */
function canCallGoogle(what: string): boolean {
  if (process.env.GEOCODE_DISABLED === '1') return false

  // A production build prerenders every itinerary page. With a cold cache that
  // is 668 items per deploy, which is exactly how the bill was run up. Builds
  // read the table and never extend it; runtime revalidation backfills.
  if (process.env.NEXT_PHASE === 'phase-production-build' && !WRITING_CACHE) return false

  if (liveCalls >= LIVE_BUDGET) {
    if (!budgetWarned) {
      budgetWarned = true
      console.warn(
        `[geocode] live lookup budget of ${LIVE_BUDGET} exhausted in this process. ` +
        `Further misses return no location. Refill data/geocache.json with ` +
        `GEOCODE_WRITE_CACHE=1 npm run build.`
      )
    }
    return false
  }

  liveCalls += 1
  console.warn(`[geocode] live Google lookup ${liveCalls}/${LIVE_BUDGET}: ${what}`)
  return true
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

  const cached = cacheGet(key)
  if (cached !== undefined) return typeof cached === 'string' ? cached : null

  if (!canCallGoogle(`country of "${clean}"`)) return null

  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(clean)}&key=${GEOCODING_API_KEY}`
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
    const data = await res.json() as {
      status?: string
      results?: Array<{ address_components?: AddressComponent[] }>
    }
    // A definitive "no" is cached; a transport failure is not, because the next
    // run would inherit a wrong answer forever.
    if (data.status !== 'OK') {
      if (data.status === 'ZERO_RESULTS') cacheSet(key, null)
      return null
    }
    const cc = countryOfResult(data.results?.[0]?.address_components)
    cacheSet(key, cc)
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

  // Cache first, and a cached `null` is an answer: this place was looked up and
  // could not be placed. Asking again costs money and returns the same nothing.
  const cached = cacheGet(key)
  if (cached !== undefined) {
    return cached && typeof cached === 'object' ? cached : null
  }

  if (!canCallGoogle(`"${query}"`)) return null

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
    // Transport failure, not an answer. Left uncached on purpose.
    return null
  }

  const first = data.results?.[0]
  if (data.status !== 'OK' || !first) {
    if (data.status === 'ZERO_RESULTS') cacheSet(key, null)
    return null
  }

  // Never return a place in the wrong country. Elisa, 2026-09-08: "add a
  // safeguard so you never geocode things to the wrong country." A miss here
  // is reported as no location, which puts the item in the "not on the map"
  // list where she can see it, rather than on a map pin that lies.
  if (expected) {
    const got = countryOfResult(first.address_components)
    if (got && got !== expected) {
      cacheSet(key, null)
      return null
    }
  }

  // ...and never return the city we used as context dressed up as the venue.
  // The caller falls through to its next source, and if nothing resolves the
  // item is reported as having no location instead of getting a pin that lies.
  if (isAreaOnly(first.types)) {
    cacheSet(key, null)
    return null
  }

  const location = first.geometry.location
  cacheSet(key, location)
  return location
}
