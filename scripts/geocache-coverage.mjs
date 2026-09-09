/**
 * How many trip items can be placed on the map from data/geocache.json alone,
 * with no network calls. Mirrors geocodeItem()'s address -> venue -> name
 * fallback and its country anchoring, so the number it prints is what the map
 * will actually show.
 *
 *   node scripts/geocache-coverage.mjs [--list-missing]
 */
import { readFileSync } from 'node:fs'
import { Client } from '@notionhq/client'

const table = JSON.parse(readFileSync('data/geocache.json', 'utf8'))
const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split('\n').filter(l => l.includes('='))
    .map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])
)
const notion = new Client({ auth: env.NOTION_TOKEN })
const txt = p => !p ? '' : p.type === 'title' ? (p.title ?? []).map(t => t.plain_text).join('')
  : p.type === 'rich_text' ? (p.rich_text ?? []).map(t => t.plain_text).join('') : ''

const countryOf = place => {
  const clean = place.trim()
  if (!clean) return null
  const v = table[`geocode:cc:${clean.toLowerCase()}`]
  return typeof v === 'string' ? v : null
}
const lookup = (venue, city, region) => {
  if (!venue.trim()) return null
  const expected = countryOf(city.trim() || region.trim())
  const query = [venue, city.trim()].filter(Boolean).join(', ')
  const v = table[`geocode:${query.toLowerCase().trim()}:${expected ?? 'any'}`]
  return v && typeof v === 'object' ? v : null
}
const place = (item, region) =>
  (item.address.trim() && lookup(item.address, '', region)) ||
  (item.venue.trim() && lookup(item.venue, item.legCity, region)) ||
  (item.name.trim() && lookup(item.name, item.legCity, region)) || null

const trips = await notion.databases.query({ database_id: '72792a7e-eb9e-468a-a376-fd1e7284401c' })
const tripById = new Map(trips.results.map(t => [t.id, { name: txt(t.properties['Trip Name']), location: txt(t.properties['Location']) }]))

const items = []
let cursor
do {
  const r = await notion.databases.query({ database_id: '9947ef07-3483-472b-b452-f2ebc23edabe', start_cursor: cursor, page_size: 100 })
  for (const p of r.results) items.push({
    trip: (p.properties['Trip']?.relation ?? [])[0]?.id,
    name: txt(p.properties['Name']), venue: txt(p.properties['Provider / Venue']),
    legCity: txt(p.properties['Leg / City']), address: txt(p.properties['Address']),
  })
  cursor = r.next_cursor ?? undefined
} while (cursor)

const per = new Map()
const missing = []
for (const it of items) {
  const trip = tripById.get(it.trip)
  if (!trip) continue
  const row = per.get(trip.name) ?? { total: 0, placed: 0 }
  row.total++
  if (place(it, trip.location)) row.placed++
  else missing.push(`${trip.name} :: ${it.name} :: venue="${it.venue}" city="${it.legCity}"`)
  per.set(trip.name, row)
}

let t = 0, p = 0
for (const [name, r] of [...per].sort((a, b) => b[1].total - a[1].total)) {
  t += r.total; p += r.placed
  console.log(`${String(r.placed).padStart(3)}/${String(r.total).padEnd(4)} ${Math.round(r.placed / r.total * 100).toString().padStart(3)}%  ${name}`)
}
console.log(`${String(p).padStart(3)}/${String(t).padEnd(4)} ${Math.round(p / t * 100)}%  TOTAL`)
if (process.argv.includes('--list-missing')) console.log('\n' + missing.join('\n'))
