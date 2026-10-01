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
