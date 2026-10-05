/**
 * Does an address sit in the area Elisa named for a place?
 *
 * Her notes name areas the way people talk: "WeHo", "626", "The Valley",
 * "Mission / WeHo". A street address names a city. This file is the one
 * translation between the two, used by the server's place lookup and by the
 * pin backfill scripts on her Mac, so a place is judged the same way however
 * it was added.
 *
 * It only ever says yes. A no means "not proven by the city name", and the
 * caller falls back to the distance check, then to her review list.
 */

const SAN_GABRIEL_VALLEY = [
  'alhambra', 'altadena', 'arcadia', 'azusa', 'baldwin park', 'city of industry', 'claremont',
  'covina', 'diamond bar', 'duarte', 'el monte', 'glendora', 'hacienda heights', 'industry',
  'irwindale', 'la puente', 'la verne', 'monrovia', 'monterey park', 'pasadena', 'pomona',
  'rosemead', 'rowland heights', 'san dimas', 'san gabriel', 'san marino', 'sierra madre',
  'south el monte', 'south pasadena', 'temple city', 'walnut', 'west covina',
]

const SAN_FERNANDO_VALLEY = [
  'arleta', 'burbank', 'calabasas', 'canoga park', 'chatsworth', 'encino', 'granada hills',
  'hidden hills', 'lake balboa', 'mission hills', 'north hills', 'north hollywood', 'northridge',
  'pacoima', 'panorama city', 'reseda', 'san fernando', 'sherman oaks', 'studio city',
  'sun valley', 'sunland', 'sylmar', 'tarzana', 'toluca lake', 'tujunga', 'universal city',
  'valley village', 'van nuys', 'west hills', 'winnetka', 'woodland hills',
]

// The lists below are the areas the way she labels them (her Neighborhood
// values, 2026-10-05) plus the cities an address in that area can name. They
// exist for the search ("cafe in the south bay"); a note naming one of them is
// also read by the lookup, which only ever says yes.

const WESTSIDE = [
  'santa monica', 'venice', 'culver city', 'sawtelle', 'westwood', 'brentwood', 'palms',
  'mar vista', 'marina del rey', 'playa vista', 'playa del rey', 'century city',
  'pacific palisades', 'beverly hills', 'west los angeles', 'west la',
]

const SOUTH_BAY = [
  'manhattan beach', 'hermosa beach', 'redondo beach', 'torrance', 'gardena', 'el segundo',
  'hawthorne', 'lawndale', 'lomita', 'san pedro', 'palos verdes estates', 'rancho palos verdes',
]

const EASTSIDE = [
  'silverlake', 'silver lake', 'echo park', 'los feliz', 'highland park', 'eagle rock',
  'atwater village', 'glassell park',
]

const DOWNTOWN_LA = ['downtown', 'arts district', 'little tokyo', 'dtla']

const ORANGE_COUNTY = [
  'anaheim', 'irvine', 'costa mesa', 'tustin', 'huntington beach', 'newport beach', 'fullerton',
  'laguna beach', 'santa ana', 'orange', 'garden grove', 'westminster', 'buena park',
]

const EAST_BAY = [
  'east bay', 'oakland', 'berkeley', 'emeryville', 'alameda', 'albany', 'walnut creek',
  'el cerrito', 'san leandro',
]

const MARIN = [
  'marin', 'mill valley', 'san rafael', 'larkspur', 'sausalito', 'tiburon', 'novato',
  'corte madera', 'san anselmo', 'kentfield', 'point reyes', 'point reyes station',
]

const WINE_COUNTRY = ['napa', 'sonoma', 'healdsburg', 'yountville', 'st helena', 'calistoga', 'sebastopol']

const PENINSULA = [
  'palo alto', 'menlo park', 'burlingame', 'san mateo', 'redwood city', 'mountain view',
  'half moon bay', 'daly city',
]

/** Area words from her notes, mapped to the city names an address can carry. */
const ALIASES: Record<string, string[]> = {
  'weho': ['west hollywood'],
  '626': SAN_GABRIEL_VALLEY,
  'sgv': SAN_GABRIEL_VALLEY,
  'san gabriel valley': SAN_GABRIEL_VALLEY,
  'the valley': SAN_FERNANDO_VALLEY,
  'valley': SAN_FERNANDO_VALLEY,
  'sfv': SAN_FERNANDO_VALLEY,
  'san fernando valley': SAN_FERNANDO_VALLEY,
  'westside': WESTSIDE,
  'west side': WESTSIDE,
  'south bay': SOUTH_BAY,
  'eastside': EASTSIDE,
  'east side': EASTSIDE,
  'dtla': DOWNTOWN_LA,
  'downtown la': DOWNTOWN_LA,
  'east bay': EAST_BAY,
  'marin': MARIN,
  'marin county': MARIN,
  'wine country': WINE_COUNTRY,
  'peninsula': PENINSULA,
}

/**
 * Areas only the search may ask for. Kept out of `ALIASES` because the lookup
 * treats "OC" in a note as too broad to prove anything, and that stays true.
 */
const SEARCH_ONLY_ALIASES: Record<string, string[]> = {
  'oc': ORANGE_COUNTY,
  'orange county': ORANGE_COUNTY,
}

/** Every area word the search understands, with the cities it covers. */
export const SEARCH_AREAS: Record<string, string[]> = { ...ALIASES, ...SEARCH_ONLY_ALIASES }

const BAY_LISTS = new Set<string[]>([EAST_BAY, MARIN, WINE_COUNTRY, PENINSULA])

/**
 * Which side of the state an area word is on. Her labels repeat across the two
 * ("Downtown", "Chinatown" and "Richmond" exist in both), so an area match also
 * has to be in the right half.
 */
export function searchAreaRegion(word: string): 'la' | 'sfBay' | null {
  const list = SEARCH_AREAS[word]
  if (!list) return null
  return BAY_LISTS.has(list) ? 'sfBay' : 'la'
}

/**
 * Metro and state words prove nothing: "Los Angeles" is in addresses from
 * Venice to Eagle Rock, so a row noted "Hollywood, LA" must not pass on "LA".
 */
const TOO_BROAD = new Set([
  'la', 'los angeles', 'sf', 'san francisco', 'ca', 'california', 'usa', 'us', 'oc',
  'orange county', 'bay area', 'sf bay', 'la county',
])

const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()

/** The city names an area note allows, e.g. "Mission / WeHo, LA / SF" -> mission, west hollywood. */
export function citiesForArea(areaText: string): Set<string> {
  const out = new Set<string>()
  for (const raw of areaText.split(/[/,]/)) {
    const part = clean(raw)
    if (!part || TOO_BROAD.has(part)) continue
    for (const city of ALIASES[part] ?? [part]) out.add(city)
  }
  return out
}

/**
 * The address's city-level parts: every comma part after the street, with the
 * state, ZIP and country stripped. "623 N La Peer Dr, West Hollywood, CA 90069, USA"
 * -> ["west hollywood"]. "17316 Ventura Blvd, Encino, Los Angeles, CA" -> ["encino", "los angeles"].
 */
export function addressCities(address: string): string[] {
  return address.split(',').slice(1)
    .map(p => clean(p.replace(/\b[A-Z]{2}\s*\d{5}(-\d{4})?\b/, '').replace(/\b\d{5}(-\d{4})?\b/, '')))
    .filter(p => p && !/^(ca|usa|us|united states)$/.test(p))
}

/** True when the address names a city that the area note allows. */
export function addressInNamedArea(areaText: string, address: string): boolean {
  const allowed = citiesForArea(areaText)
  if (allowed.size === 0) return false
  return addressCities(address).some(c => allowed.has(c))
}
