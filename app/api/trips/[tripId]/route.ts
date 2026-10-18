import { NextResponse } from 'next/server'
import { fetchAllTrips } from '@/lib/notion'
import { loadTripItems } from '@/lib/trip-items'

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

  const items = await loadTripItems(trip)

  return NextResponse.json({ trip, items })
}
