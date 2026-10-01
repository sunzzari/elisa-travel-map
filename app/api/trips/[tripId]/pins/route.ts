import { NextResponse } from 'next/server'
import { fetchAllTrips, fetchTripItems } from '@/lib/notion'
import { geocodeItem } from '@/lib/geocode'

/**
 * Every known pin for one trip's items, for the Sunzzari app: the same answer
 * the web itinerary draws (saved pin, then the saved table). The phone keeps
 * reading trip content from Notion for offline use; only WHERE things are
 * comes from here, so the two maps cannot disagree.
 *
 *   { pins: { "<item page id>": { lat, lng, branches: [{ address, lat, lng }] } } }
 * An item with no known location is simply absent.
 */
export const revalidate = 300

export async function GET(_request: Request, { params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params
  const trips = await fetchAllTrips()
  const trip = trips.find(t => t.id.replace(/-/g, '') === tripId.replace(/-/g, ''))
  if (!trip) return NextResponse.json({ error: 'Trip not found' }, { status: 404 })

  const items = await fetchTripItems(trip.id)
  const pins: Record<string, { lat: number; lng: number; branches: { address: string; lat: number; lng: number }[] }> = {}
  for (const item of items) {
    const c = await geocodeItem(item, trip.location)
    if (!c) continue
    pins[item.id] = { lat: c.lat, lng: c.lng, branches: item.branches ?? [] }
  }
  return NextResponse.json({ pins })
}
