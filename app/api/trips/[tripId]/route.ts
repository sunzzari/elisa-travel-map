import { NextResponse } from 'next/server'
import { fetchAllTrips, fetchTripItems } from '@/lib/notion'
import { geocodeItem } from '@/lib/geocode'

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
      const coords = await geocodeItem(item, trip.location)
      return { ...item, coordinates: coords ?? undefined }
    })
  )

  return NextResponse.json({ trip, items: geocoded })
}
