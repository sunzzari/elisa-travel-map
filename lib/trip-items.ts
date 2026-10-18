import { Client } from '@notionhq/client'
import { fetchTripItems } from './notion'
import { geocodeItem } from './geocode'
import { areaAroundPins, pinAddress } from './place-lookup'
import { pinProperties } from './saved-pins'
import { TRANSPORT_TYPES, transportPins } from './transport-pins'
import type { Trip, TripItem } from './types'

/**
 * A trip's items with every pin this server can find, for every reader: the
 * web trip page, the phone's pins, the trip JSON. One loader, so the three
 * cannot disagree about what is on the map.
 *
 * Pins come from, in order: the pin saved on the Notion row, the old saved
 * table (lib/geocode.ts), and, for a row that has an ADDRESS but no pin, the
 * free address lookup (OpenStreetMap / US Census), checked to land near the
 * trip's other pins and then SAVED to the row so it is asked once. Elisa,
 * 2026-10-18: "some of the items are not on the map. how do you make it so
 * that you are not missing to add items to the map?" Das LOFT had its full
 * street address and no pin.
 *
 * Never a paid lookup, and never a pin from a NAME alone: a name match picks
 * the wrong branch too easily to save without someone looking.
 */

const notion = new Client({ auth: process.env.NOTION_TOKEN })
const MAX_PINS_PER_READ = 5
const RETRY_AFTER_MS = 24 * 60 * 60 * 1000
const unpinnable = new Map<string, number>()

export async function loadTripItems(trip: Trip): Promise<TripItem[]> {
  const raw = await fetchTripItems(trip.id)
  const items = await Promise.all(raw.map(async item => {
    const coords = item.coordinates ?? await geocodeItem(item, trip.location)
    return { ...item, coordinates: coords ?? undefined }
  }))
  await pinTransport(items)
  await pinFromAddresses(items)
  return items
}

/**
 * Flights and trains: a pin where they leave and a pin where they arrive
 * (lib/transport-pins.ts), saved to the row once. A row that already has its
 * arrival pin is left alone, so a pin someone corrected by hand stays.
 */
async function pinTransport(items: TripItem[]): Promise<void> {
  const now = Date.now()
  const waiting = items.filter(i =>
    TRANSPORT_TYPES.has(i.type ?? '') && i.status !== 'Cancelled' && !(i.branches?.length) &&
    now - (unpinnable.get(i.id + '|' + i.name) ?? 0) > RETRY_AFTER_MS
  ).slice(0, 3)

  for (const item of waiting) {
    try {
      const found = await transportPins(item)
      if (!found) { unpinnable.set(item.id + '|' + item.name, now); continue }
      await notion.pages.update({ page_id: item.id, properties: pinProperties(found.pin, [found.arrival]) })
      item.coordinates = found.pin
      item.branches = [found.arrival]
      console.log(`Trip map: pinned "${item.name}" at both ends (${found.arrival.address})`)
    } catch (err) {
      unpinnable.set(item.id + '|' + item.name, now)
      console.error(`Trip map: could not pin "${item.name}" at both ends:`, err)
    }
  }
}

async function pinFromAddresses(items: TripItem[]): Promise<void> {
  const now = Date.now()
  const waiting = items.filter(i =>
    !i.coordinates && i.address.trim() !== '' && i.status !== 'Cancelled' &&
    now - (unpinnable.get(i.id + '|' + i.address) ?? 0) > RETRY_AFTER_MS
  ).slice(0, MAX_PINS_PER_READ)

  for (const item of waiting) {
    // Anchor on the item's own leg when it has pins, else the whole trip.
    const placed = items.filter(i => i.coordinates)
    const legPins = placed.filter(i => i.legCity && i.legCity === item.legCity).map(i => i.coordinates!)
    const area = areaAroundPins(item.legCity, legPins.length ? legPins : placed.map(i => i.coordinates!))
    if (!area) continue
    try {
      const found = await pinAddress(area, item.address)
      if (!found) { unpinnable.set(item.id + '|' + item.address, now); continue }
      const pin = { lat: found.lat, lng: found.lng }
      await notion.pages.update({ page_id: item.id, properties: pinProperties(pin) })
      item.coordinates = pin
      console.log(`Trip map: pinned "${item.name}" from its address (${found.source})`)
    } catch (err) {
      unpinnable.set(item.id + '|' + item.address, now)
      console.error(`Trip map: could not pin "${item.name}":`, err)
    }
  }
}
