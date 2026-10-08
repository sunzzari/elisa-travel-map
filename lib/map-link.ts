/**
 * A pin from a map link Elisa pastes.
 *
 * The free map sources cannot place every address (ten Chengdu restaurants on
 * 2026-10-08, none found). Her answer to what should happen then: "i think you
 * should figure out a way to ask me to help". So she opens the place in Google
 * or Apple Maps, taps Share, and pastes the link; the coordinates are read out
 * of it here. No geocoder is called and nothing is paid for: this only follows
 * the link's own redirect and reads the address it lands on.
 *
 * The pin is still checked against the place's area by the caller
 * (`pinInArea`), exactly like a looked-up one.
 */

import type { Coordinates } from './types'

/** Only map hosts are ever fetched, on every hop, so a pasted link cannot aim the server anywhere else. */
const MAP_HOSTS = /^(maps\.app\.goo\.gl|goo\.gl|(www\.|maps\.)?google\.[a-z.]{2,6}|maps\.apple\.com|maps\.apple)$/i

const valid = (lat: number, lng: number) =>
  Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && (lat !== 0 || lng !== 0)

/** Coordinates written in a map URL, or null. The place's own marker wins over the camera position. */
export function coordsInMapUrl(url: string): Coordinates | null {
  const text = decodeURIComponent(url)
  const patterns = [
    /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/,                               // Google: the place marker
    /[?&](?:q|query|ll|sll|center|coordinate|destination)=(-?\d+\.\d+),\s*(-?\d+\.\d+)/, // Google and Apple: a dropped pin
    /@(-?\d+\.\d+),(-?\d+\.\d+)/,                                    // Google: where the camera is
  ]
  for (const re of patterns) {
    const m = text.match(re)
    if (!m) continue
    const lat = Number(m[1]), lng = Number(m[2])
    if (valid(lat, lng)) return { lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)) }
  }
  return null
}

export class MapLinkError extends Error {}

const HOW = 'Open the place in Google Maps, tap Share, copy the link and paste it here.'

/**
 * Follows a pasted map link (a short share link redirects to the full one) and
 * returns the pin it names. Throws `MapLinkError` with a message she can act on.
 */
export async function pinFromMapLink(link: string): Promise<Coordinates> {
  let url = link.trim()
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url
  for (let hop = 0; hop < 5; hop++) {
    let parsed: URL
    try { parsed = new URL(url) } catch { throw new MapLinkError(`That is not a link. ${HOW}`) }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new MapLinkError(`That is not a map link. ${HOW}`)
    if (!MAP_HOSTS.test(parsed.hostname)) throw new MapLinkError(`That is not a Google Maps or Apple Maps link. ${HOW}`)
    const here = coordsInMapUrl(url)
    if (here) return here
    let res: Response
    try {
      res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(8000), cache: 'no-store',
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; sunzzari-pins/1.0)' } })
    } catch {
      throw new MapLinkError('The map link could not be opened just now. Try again in a minute.')
    }
    const next = res.headers.get('location')
    if (!next) break
    url = new URL(next, url).toString()
  }
  throw new MapLinkError(`That link does not say where the place is. ${HOW}`)
}
