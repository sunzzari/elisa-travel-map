/**
 * Rebuild data/geocache.json from Next's fetch cache.
 *
 * 2026-09-08: the Geocoding API was switched off after a $97 bill, which left
 * the new lookup table with no way to fill itself and the map with no pins.
 * These answers were already bought and paid for, though: `next build` stores
 * every fetch response under .next/cache/fetch-cache, including the Google
 * Geocoding responses from the builds that ran up the bill. This reads them
 * back out. No network calls, no API key needed.
 *
 * Notion is read only to tell the two kinds of request apart: a lookup of a
 * bare place name ("Vienna") is a country lookup, while "Park Hyatt Vienna,
 * Vienna" is a venue. The former are exactly the leg cities and trip locations,
 * so that set is the discriminator.
 *
 *   node scripts/recover-geocache.mjs [path-to-fetch-cache ...]
 *
 * The acceptance rules below MUST mirror lib/geocode.ts. If the guards there
 * change, a re-run of this script would otherwise disagree with the live code.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { Client } from '@notionhq/client'

const AREA_ONLY_TYPES = new Set([
  'locality', 'sublocality', 'sublocality_level_1', 'neighborhood',
  'administrative_area_level_1', 'administrative_area_level_2',
  'administrative_area_level_3', 'administrative_area_level_4',
  'colloquial_area', 'postal_code', 'country', 'continent', 'political',
])
const isAreaOnly = types => Array.isArray(types) && types.length > 0 && types.every(t => AREA_ONLY_TYPES.has(t))
const countryOfResult = c => c?.find(x => x.types.includes('country'))?.short_name ?? null

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split('\n').filter(l => l.includes('='))
    .map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])
)
const notion = new Client({ auth: env.NOTION_TOKEN })
const txt = p => !p ? '' : p.type === 'title' ? (p.title ?? []).map(t => t.plain_text).join('')
  : p.type === 'rich_text' ? (p.rich_text ?? []).map(t => t.plain_text).join('') : ''

// Every string the app would ever ask a country for: leg cities, and the trip
// locations used when an item has no leg.
const places = new Set()
const trips = await notion.databases.query({ database_id: '72792a7e-eb9e-468a-a376-fd1e7284401c' })
for (const t of trips.results) {
  const loc = txt(t.properties['Location']).trim()
  if (loc) places.add(loc.toLowerCase())
}
let cursor
do {
  const r = await notion.databases.query({ database_id: '9947ef07-3483-472b-b452-f2ebc23edabe', start_cursor: cursor, page_size: 100 })
  for (const p of r.results) {
    const city = txt(p.properties['Leg / City']).trim()
    if (city) places.add(city.toLowerCase())
  }
  cursor = r.next_cursor ?? undefined
} while (cursor)

const dirs = process.argv.slice(2)
if (dirs.length === 0) dirs.push(join('.next', 'cache', 'fetch-cache'))

const table = existsSync('data/geocache.json')
  ? JSON.parse(readFileSync('data/geocache.json', 'utf8'))
  : {}

const stats = { files: 0, geocodeResponses: 0, countries: 0, coords: 0, rejected: 0, unusable: 0 }

for (const dir of dirs) {
  if (!existsSync(dir)) { console.warn(`skipping missing directory: ${dir}`); continue }
  for (const name of readdirSync(dir)) {
    const file = join(dir, name)
    let entry
    try { entry = JSON.parse(readFileSync(file, 'utf8')) } catch { continue }
    stats.files++
    const url = entry?.data?.url ?? ''
    if (!url.includes('maps.googleapis.com/maps/api/geocode/json')) continue
    stats.geocodeResponses++

    let body
    try { body = JSON.parse(Buffer.from(entry.data.body, 'base64').toString('utf8')) } catch { continue }

    const parsed = new URL(url)
    const address = (parsed.searchParams.get('address') ?? '').trim()
    const components = parsed.searchParams.get('components') ?? ''
    const expected = components.startsWith('country:') ? components.slice('country:'.length) : null
    if (!address) continue

    const first = body?.results?.[0]
    if (body?.status !== 'OK' || !first) {
      // Only a definitive ZERO_RESULTS is an answer worth storing.
      if (body?.status === 'ZERO_RESULTS' && expected !== null) {
        table[`geocode:${address.toLowerCase()}:${expected}`] = null
        stats.rejected++
      } else {
        stats.unusable++
      }
      continue
    }

    // A bare place name with no country constraint is a countryOf() lookup.
    if (!expected && places.has(address.toLowerCase())) {
      const cc = countryOfResult(first.address_components)
      table[`geocode:cc:${address.toLowerCase()}`] = cc
      stats.countries++
      continue
    }

    const key = `geocode:${address.toLowerCase()}:${expected ?? 'any'}`
    const got = countryOfResult(first.address_components)
    if (expected && got && got !== expected) { table[key] = null; stats.rejected++; continue }
    if (isAreaOnly(first.types)) { table[key] = null; stats.rejected++; continue }
    table[key] = first.geometry.location
    stats.coords++
  }
}

const sorted = {}
for (const k of Object.keys(table).sort()) sorted[k] = table[k]
writeFileSync('data/geocache.json', `${JSON.stringify(sorted, null, 2)}\n`)

console.log(stats)
console.log('table entries:', Object.keys(sorted).length)
