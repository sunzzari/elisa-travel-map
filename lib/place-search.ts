/**
 * AROUND TOWN SEARCH - the one rule for "which saved places match what she typed".
 *
 * Elisa, 2026-10-05: "i want a search feature. either keyword search or claude ai
 * search like 'jian bing in rowland heights' or chinese food near me. and i want
 * to be able to search by name".
 *
 * Keyword search, on purpose: no Claude call and no paid lookup, so a search
 * costs nothing (her rule, 2026-09-28). It only ever finds her own saved places,
 * and only by words that are written on them.
 *
 * Pure: no Notion, no network, no Node. The website runs it in the browser and
 * `/api/around-town/search` runs it for the Sunzzari app, so the two cannot
 * answer differently. There is no Swift copy.
 */

import { SEARCH_AREAS, searchAreaRegion, citiesForArea, addressCities } from './place-areas'

export interface SearchablePlace {
  id: string
  name: string
  kind: 'restaurant' | 'activity'
  region: 'la' | 'sfBay' | null
  neighborhood: string
  location: string
  goodFor: string[]
  topDishes: string
  comments: string
  address: string
  branchAddresses?: string[]
  preference: string | null
  wantToTry: boolean
  beenThere: boolean
}

/** Been / want / rated words in the question. The same meaning as the chips. */
export interface StatusFilters {
  wantToTry: boolean
  haventBeen: boolean
  beenThere: boolean
  topChoice: boolean
}

export interface PlaceSearchResult {
  /** Matching places, best first: a match on the name outranks the rest. */
  ids: string[]
  /** She asked for "near me". Distance is worked out on her device, never here. */
  nearMe: boolean
  filters: StatusFilters
  /** How the question was read, to show under the box. Empty for a plain name. */
  understood: string
}

// MARK: - Word lists

/** Words that carry no meaning in a question about where to eat. */
const FILLER = new Set([
  'a', 'an', 'the', 'in', 'at', 'on', 'of', 'for', 'to', 'by', 'with', 'and', 'or', 'near',
  'around', 'food', 'foods', 'restaurant', 'restaurants', 'place', 'places', 'spot', 'spots',
  'good', 'best', 'great', 'some', 'any', 'me', 'i', 'we', 'us', 'my', 'our', 'where', 'what',
  'whats', 'find', 'show', 'is', 'are', 'that', 'eat', 'get', 'can', 'do', 'somewhere', 'have',
])

const NEAR_ME = ['near me', 'nearby', 'near by', 'close by', 'close to me', 'around me', 'near here', 'around here']

const STATUS_PHRASES: Array<[string, keyof StatusFilters]> = [
  ['havent been to', 'haventBeen'], ['havent been', 'haventBeen'], ['havent tried', 'haventBeen'],
  ['have not been', 'haventBeen'], ['have not tried', 'haventBeen'], ['not been to', 'haventBeen'],
  ['not tried', 'haventBeen'], ['never been', 'haventBeen'], ['never tried', 'haventBeen'],
  ['want to try', 'wantToTry'], ['wanna try', 'wantToTry'], ['wishlist', 'wantToTry'],
  ['top choice', 'topChoice'], ['top choices', 'topChoice'], ['favorite', 'topChoice'],
  ['favorites', 'topChoice'], ['favourite', 'topChoice'], ['favourites', 'topChoice'],
  ['been there', 'beenThere'], ['weve been', 'beenThere'], ['been to', 'beenThere'],
  ['already tried', 'beenThere'],
]

const STATUS_LABEL: Record<keyof StatusFilters, string> = {
  wantToTry: 'Want to try',
  haventBeen: "Haven't been",
  beenThere: 'Been there',
  topChoice: 'Top Choice',
}

/**
 * A type word, and the Good For tags it also means. The word itself still
 * matches as text, so "cafe" finds a place called "Cafe Dulce" too.
 * Tags are her Good For options as they are in Notion.
 */
const TYPES: Record<string, string[]> = {
  cafe: ['Coffee', 'Bakery', 'Pastries', 'HK Café'],
  cafes: ['Coffee', 'Bakery', 'Pastries', 'HK Café'],
  'coffee shop': ['Coffee'],
  chinese: ['Chinese', 'Szechuan', 'Dim Sum', 'HK BBQ', 'HK Café'],
  japanese: ['Japanese', 'Sushi', 'Ramen', 'Izakaya'],
  mexican: ['Mexican', 'Tacos'],
  noodle: ['Noodles', 'Ramen'],
  noodles: ['Noodles', 'Ramen'],
  barbecue: ['BBQ', 'Korean BBQ', 'HK BBQ'],
  kbbq: ['Korean BBQ'],
  drinks: ['Cocktails', 'Bar', 'Wine', 'Happy Hour', 'Speakeasy'],
  bars: ['Cocktails', 'Bar', 'Speakeasy'],
  sweets: ['Dessert', 'Cake', 'Pastries', 'Bakery'],
  desserts: ['Dessert', 'Cake'],
  takeout: ['Take Out'],
  'to go': ['Take Out'],
  sichuan: ['Szechuan'],
  'bubble tea': ['Boba'],
  'milk tea': ['Boba'],
  patio: ['Outdoor Dining'],
  outdoor: ['Outdoor Dining'],
  outside: ['Outdoor Dining'],
}

const REGION_WORDS: Array<[string, 'la' | 'sfBay']> = [
  ['los angeles', 'la'], ['san francisco', 'sfBay'], ['bay area', 'sfBay'], ['sf bay', 'sfBay'],
]
const REGION_LABEL = { la: 'LA', sfBay: 'SF Bay' } as const

// MARK: - Text

/** Lower case, no accents, no apostrophes ("haven't" -> "havent"), words only. */
export function cleanText(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['‘’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

const ACRONYMS = new Set(['sgv', 'sfv', 'dtla', 'oc', 'kbbq'])
const titled = (s: string) => (ACRONYMS.has(s) ? s.toUpperCase() : s.replace(/\b[a-z]/g, c => c.toUpperCase()))

/** Removes `phrase` from `text` when it is there as whole words. */
function take(text: string, phrase: string): string | null {
  const padded = ` ${text} `
  const at = padded.indexOf(` ${phrase} `)
  if (at === -1) return null
  return (padded.slice(0, at) + ' ' + padded.slice(at + phrase.length + 2)).replace(/\s+/g, ' ').trim()
}

const longestFirst = (a: string, b: string) => b.length - a.length

const singular = (w: string) => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w)

/** A typed word matches when a word on the place starts with it; "tacos" also finds "taco". */
function wordMatches(words: string[], token: string): boolean {
  const stem = singular(token)
  return words.some(w => w.startsWith(token) || w.startsWith(stem))
}

/** The whole word is there, give or take a plural: "taco" is "tacos", "brea" is not "bread". */
function wholeWordMatches(words: string[], token: string): boolean {
  const stem = singular(token)
  return words.some(w => w === token || singular(w) === stem)
}

// MARK: - Reading the question

interface AreaAsk { word: string; cities: Set<string>; region: 'la' | 'sfBay' | null }
interface TypeAsk { word: string; tags: Set<string> }

interface Parsed {
  nearMe: boolean
  filters: StatusFilters
  region: 'la' | 'sfBay' | null
  areas: AreaAsk[]
  types: TypeAsk[]
  words: string[]
}

function parse(query: string): Parsed {
  let rest = cleanText(query)
  const filters: StatusFilters = { wantToTry: false, haventBeen: false, beenThere: false, topChoice: false }
  let nearMe = false
  let region: Parsed['region'] = null
  const areas: AreaAsk[] = []
  const types: TypeAsk[] = []

  for (const phrase of [...NEAR_ME].sort(longestFirst)) {
    const next = take(rest, phrase)
    if (next !== null) { rest = next; nearMe = true }
  }
  for (const [phrase, key] of [...STATUS_PHRASES].sort((a, b) => longestFirst(a[0], b[0]))) {
    const next = take(rest, phrase)
    if (next !== null) { rest = next; filters[key] = true }
  }
  for (const word of Object.keys(SEARCH_AREAS).sort(longestFirst)) {
    const next = take(rest, word)
    if (next !== null) {
      rest = next
      areas.push({ word, cities: new Set(SEARCH_AREAS[word]), region: searchAreaRegion(word) })
    }
  }
  for (const [phrase, r] of REGION_WORDS) {
    const next = take(rest, phrase)
    if (next !== null) { rest = next; region = r }
  }
  // "la" and "sf" only as the place she is asking about ("tacos in la", "sushi sf"),
  // never inside a name such as "La Brea".
  const short = rest.match(/(?:^| )(?:in |at |near )?(la|sf)$/)
  if (short && rest.split(' ').length > 1) {
    region = short[1] === 'la' ? 'la' : 'sfBay'
    rest = rest.slice(0, short.index).trim()
  }
  for (const word of Object.keys(TYPES).sort(longestFirst)) {
    const next = take(rest, word)
    if (next !== null) {
      rest = next
      types.push({ word, tags: new Set(TYPES[word].map(cleanText)) })
    }
  }

  const all = rest.split(' ').filter(Boolean)
  let words = all.filter(w => !FILLER.has(w))
  const understoodSomething =
    nearMe || region !== null || areas.length > 0 || types.length > 0 || Object.values(filters).some(Boolean)
  // "The Best" is a fair thing to type when it is a name: with nothing else to
  // go on, the small words are the search.
  if (words.length === 0 && !understoodSomething) words = all

  return { nearMe, filters, region, areas, types, words }
}

// MARK: - Matching

interface Indexed {
  place: SearchablePlace
  nameWords: string[]
  words: string[]
  tags: Set<string>
  cities: Set<string>
}

function index(place: SearchablePlace): Indexed {
  const nameWords = cleanText(place.name).split(' ').filter(Boolean)
  const words = cleanText(
    [place.name, place.neighborhood, place.location, place.goodFor.join(' '), place.topDishes, place.comments, place.address].join(' ')
  ).split(' ').filter(Boolean)
  // Her Location carries an area for some rows ("Marin", "East Bay"); "LA" and "SF" are skipped as too broad.
  const cities = citiesForArea(`${place.neighborhood} / ${place.location}`)
  for (const address of [place.address, ...(place.branchAddresses ?? [])]) {
    for (const city of addressCities(address)) cities.add(city)
  }
  return { place, nameWords, words, tags: new Set(place.goodFor.map(cleanText)), cities }
}

function matches(p: Indexed, q: Parsed, applyStatus: boolean): boolean {
  const { place } = p
  if (q.region && place.region !== q.region) return false
  for (const area of q.areas) {
    if (area.region && place.region && place.region !== area.region) return false
    let inArea = false
    for (const city of p.cities) if (area.cities.has(city)) { inArea = true; break }
    if (!inArea) return false
  }
  for (const type of q.types) {
    let has = wordMatches(p.words, type.word.split(' ')[0]) && type.word.split(' ').every(w => wordMatches(p.words, w))
    if (!has) for (const tag of p.tags) if (type.tags.has(tag)) { has = true; break }
    if (!has) return false
  }
  if (applyStatus) {
    if (q.filters.wantToTry && !place.wantToTry) return false
    if (q.filters.haventBeen && place.beenThere) return false
    if (q.filters.beenThere && !place.beenThere) return false
    if (q.filters.topChoice && place.preference !== 'Top Choice') return false
  }
  return true
}

function understoodLine(q: Parsed): string {
  const parts: string[] = [
    ...q.types.map(t => titled(t.word)),
    ...(q.words.length ? [`"${q.words.join(' ')}"`] : []),
    ...q.areas.map(a => titled(a.word)),
  ]
  if (q.region) parts.push(REGION_LABEL[q.region])
  for (const key of Object.keys(q.filters) as Array<keyof StatusFilters>) {
    if (q.filters[key]) parts.push(STATUS_LABEL[key])
  }
  if (q.nearMe) parts.push('near you')
  // A plain name needs no explaining back to her.
  const onlyWords = parts.length === (q.words.length ? 1 : 0)
  return onlyWords ? '' : parts.join(' · ')
}

/**
 * The places matching `query`, best first.
 *
 * `applyStatus: false` leaves the been / want / rated words to the caller, who
 * gets them back in `filters`. The Sunzzari app needs that: it saves those ticks
 * to Notion itself, so its own copy is newer than the one the server searched.
 */
export function searchPlaces(
  query: string,
  places: SearchablePlace[],
  { applyStatus = true }: { applyStatus?: boolean } = {}
): PlaceSearchResult {
  const q = parse(query)
  const candidates = places.map(index).filter(p => matches(p, q, applyStatus))

  // Her own words, in two strengths. Whole words are what she meant: "la brea"
  // is La Brea, not every LA place with "bread" in its notes. A word she is
  // still typing ("best" on the way to "Bestia") counts when it starts a word in
  // the NAME; and when no place has all her words whole, starts-with is used
  // everywhere, so a half-typed question still finds something.
  const whole = candidates.filter(p => q.words.every(w => wholeWordMatches(p.words, w)))
  const starts = candidates.filter(p => q.words.every(w => wordMatches(p.words, w)))
  const kept =
    whole.length === 0
      ? starts
      : starts.filter(p => whole.includes(p) || q.words.every(w => wordMatches(p.nameWords, w)))

  const hits = kept
    .map((p, order) => ({
      id: p.place.id,
      order,
      // How many of her words are in the NAME: a name match is what she meant.
      inName: q.words.filter(w => wordMatches(p.nameWords, w)).length,
    }))
    .sort((a, b) => b.inName - a.inName || a.order - b.order)
  return { ids: hits.map(h => h.id), nearMe: q.nearMe, filters: q.filters, understood: understoodLine(q) }
}

// MARK: - Near me

/** "Near me" is 5 miles. */
export const NEAR_ME_KM = 8.05
/** With nothing that close, the nearest few are shown instead, and she is told. */
export const NEAR_ME_FALLBACK_COUNT = 5

/**
 * Nearest first, within 5 miles; or the 5 nearest when nothing is that close.
 * `distanceKm` returns null for a place with no pin, which near-me cannot place.
 *
 * Twin of `AroundTownMapView.nearest` in sunzzari-app: the same two numbers.
 * It lives on each device because her location is never sent to this server.
 */
export function nearest<T>(items: T[], distanceKm: (item: T) => number | null): { items: T[]; widened: boolean } {
  const placed = items
    .map(item => ({ item, km: distanceKm(item) }))
    .filter((x): x is { item: T; km: number } => x.km !== null)
    .sort((a, b) => a.km - b.km)
  const close = placed.filter(x => x.km <= NEAR_ME_KM)
  if (close.length > 0 || placed.length === 0) return { items: close.map(x => x.item), widened: false }
  return { items: placed.slice(0, NEAR_ME_FALLBACK_COUNT).map(x => x.item), widened: true }
}
