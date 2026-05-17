import { NextResponse } from 'next/server'
import { fetchAllTrips, fetchTripItems } from '@/lib/notion'
import { geocodeVenue } from '@/lib/geocode'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ tripId: string }> }
) {
  const { tripId } = await params
  const trips = await fetchAllTrips()
  const trip = trips.find(t => t.id.replace(/-/g, '') === tripId)

  if (!trip) {
    return NextResponse.json({ error: 'Trip not found' }, { status: 404 })
  }

  const items = await fetchTripItems(trip.id)

  // Geocode items without coordinates
  const geocoded = await Promise.all(
    items.map(async item => {
      const coords = await geocodeVenue(item.venue, item.legCity)
        ?? (item.name !== item.venue ? await geocodeVenue(item.name, item.legCity) : null)
      return { ...item, coordinates: coords ?? undefined }
    })
  )

  return NextResponse.json({ trip, items: geocoded })
}
