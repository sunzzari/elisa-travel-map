/**
 * Pins saved in Notion: the ONE place a place's location is read and written.
 *
 * Restaurant Guide, Activities and Trip Items each carry:
 *   Address         text    the street address (main branch for a chain)
 *   Latitude        number  the pin for that address
 *   Longitude       number
 *   Other Branches  text    a chain's other branches, one per line:
 *                           "address | lat, lng"
 *
 * Every pin comes from a free source (OpenStreetMap or the US Census geocoder)
 * and passed the area checks in lib/place-lookup.ts or the backfill scripts.
 * Nothing here calls a geocoder. The phone never parses these columns: it asks
 * this server (`/api/around-town`, `/api/trips/[tripId]/pins`) and draws the
 * answer, so the rule lives once.
 */

import type { Coordinates } from './types'

export interface BranchPin extends Coordinates {
  address: string
}

export interface SavedPin {
  coordinates: Coordinates | null
  branches: BranchPin[]
}

const num = (prop: any): number | null =>
  prop?.type === 'number' && typeof prop.number === 'number' && Number.isFinite(prop.number) ? prop.number : null

const text = (prop: any): string =>
  prop?.type === 'rich_text' ? (prop.rich_text ?? []).map((t: any) => t.plain_text).join('') : ''

/** One "address | lat, lng" line; null when it does not parse. */
export function parseBranchLine(line: string): BranchPin | null {
  const bar = line.lastIndexOf('|')
  if (bar < 0) return null
  const address = line.slice(0, bar).trim()
  const [lat, lng] = line.slice(bar + 1).split(',').map(s => Number(s.trim()))
  if (!address || !Number.isFinite(lat) || !Number.isFinite(lng)) return null
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null
  return { address, lat, lng }
}

export function formatBranchLine(b: BranchPin): string {
  return `${b.address} | ${b.lat.toFixed(6)}, ${b.lng.toFixed(6)}`
}

/** Reads the saved pin and branches from a Notion page's properties. */
export function readSavedPin(properties: Record<string, any>): SavedPin {
  const lat = num(properties['Latitude'])
  const lng = num(properties['Longitude'])
  const coordinates = lat !== null && lng !== null && (lat !== 0 || lng !== 0) ? { lat, lng } : null
  const branches = text(properties['Other Branches'])
    .split('\n')
    .map(parseBranchLine)
    .filter((b): b is BranchPin => b !== null)
  return { coordinates, branches }
}

/** Notion property values for a pin. `null` clears it (address kept, not placed). */
export function pinProperties(pin: Coordinates | null, branches?: BranchPin[]): Record<string, any> {
  const props: Record<string, any> = {
    Latitude: { number: pin ? Number(pin.lat.toFixed(6)) : null },
    Longitude: { number: pin ? Number(pin.lng.toFixed(6)) : null },
  }
  if (branches !== undefined) {
    const value = branches.map(formatBranchLine).join('\n').slice(0, 2000)
    props['Other Branches'] = { rich_text: value ? [{ type: 'text', text: { content: value } }] : [] }
  }
  return props
}

/**
 * A branch is drawn as its own pin with this id, so the map can tell the pins
 * apart while every tap still opens the one place. Notion ids never contain "~".
 */
export const branchId = (placeId: string, index: number) => `${placeId}~${index + 1}`
export const placeIdOf = (id: string) => id.split('~')[0]
export const isBranchId = (id: string) => id.includes('~')
